/**
 * Secret scrubbing — the "by value" half of constraint #3 (`docs/SECURITY.md`).
 *
 * The house implementation in `mcp-standardnotes` scrubs by *pattern* only, with a
 * 32-character minimum. The Nightscout readable token on this instance is **27
 * characters** (measured 2026-08-18), so a pattern-only redactor never fires on it
 * and writes it to disk verbatim the first time an upstream call throws.
 * See `docs/LEARNINGS.md`.
 *
 * So: every secret is registered here, by value, together with its URL-encoded
 * forms, and scrubbing replaces those literals before any pattern runs.
 */

const PLACEHOLDER = "[REDACTED]";

/**
 * Below this length a "secret" is more likely to be a substring of ordinary text
 * than a credential; registering it would blank out unrelated output and make the
 * logs useless. Nothing Nightscout issues is anywhere near this short.
 */
const MIN_REGISTERABLE_LENGTH = 8;

/** Registered literals, longest first so a longer form wins over its own prefix. */
let registered: string[] = [];

/** Every encoding a secret can plausibly appear in once it has been through a URL. */
function variantsOf(secret: string): string[] {
  const out = new Set<string>([secret]);
  try {
    out.add(encodeURIComponent(secret));
    out.add(encodeURI(secret));
    // A value that has been round-tripped through a query string twice — rare,
    // but it costs nothing to cover and it is exactly the case nobody tests.
    out.add(encodeURIComponent(encodeURIComponent(secret)));
  } catch {
    // Malformed surrogate pairs: the literal alone still gets registered.
  }
  return [...out].filter((v) => v.length >= MIN_REGISTERABLE_LENGTH);
}

function reindex(values: Iterable<string>): void {
  registered = [...new Set(values)].toSorted((a, b) => b.length - a.length);
}

/**
 * Register a secret so it is scrubbed from every log line, error message and
 * rendered stack from now on.
 *
 * Call this for the token at boot **and for the JWT on every exchange** — the JWT
 * rotates, so a boot-time-only registration goes stale (ADR 0002).
 */
export function registerSecret(secret: string | undefined | null): void {
  if (!secret || secret.length < MIN_REGISTERABLE_LENGTH) return;
  reindex([...registered, ...variantsOf(secret)]);
}

/** Drop a secret from the registry — used when a JWT is replaced. */
export function forgetSecret(secret: string | undefined | null): void {
  if (!secret) return;
  const dead = new Set(variantsOf(secret));
  reindex(registered.filter((v) => !dead.has(v)));
}

/** Test seam. Never call this from server code. */
export function resetSecretsForTests(): void {
  registered = [];
}

/** How many literals are currently registered — for a boot-time sanity assertion. */
export function registeredCount(): number {
  return registered.length;
}

// ── Pattern level ───────────────────────────────────────────────────────────
// Defence in depth: catches a credential that was never registered (a secret in
// an upstream error we did not issue, a value from a misconfigured env).

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // `?token=…` — the v1 shape. v3 does not use it (ADR 0002), but an old URL, a
  // copy-pasted curl, or the instance's own error text still can.
  [/([?&]token=)[^&\s"'`]+/gi, `$1${PLACEHOLDER}`],
  [/(Authorization:\s*Bearer\s+)\S+/gi, `$1${PLACEHOLDER}`],
  [/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, `$1${PLACEHOLDER}`],
  [/(api-secret:\s*)\S+/gi, `$1${PLACEHOLDER}`],
  // JWT by shape: three base64url segments. Catches a JWT that rotated before it
  // could be registered.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, PLACEHOLDER],
  // Long opaque blob, last resort — for a credential that was never registered.
  //
  // Deliberately NOT the primary control (see the 27-character finding above), and
  // deliberately narrow. Two exclusions, both learned from a real rendered stack:
  //   * `/` and `+` are out of the class. With `/` in it, `example/tok-1a2b…` reads
  //     as one 34-char run and the pattern eats the URL and every stack file path
  //     along with the secret. A redactor that destroys the diagnostic is one that
  //     gets switched off the first time someone needs to debug.
  //   * a match must contain a digit AND a letter. Without that, hyphenated paths
  //     like `-Users-someone-Projets-mcp-nightscout` match on length alone.
  // Collateral damage that remains: long mixed identifiers (a UUID in a path) are
  // redacted. That is the right side of the trade — they are cheap to lose.
  [/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}={0,2}\b/g, PLACEHOLDER],
];

/** Object keys whose *value* is never safe to print, whatever it looks like. */
const SENSITIVE_KEY_RE =
  /\b(password|pw|secret|api[_-]?secret|token|accessToken|refreshToken|jwt|authorization|auth|credential|key)\b/i;

const MAX_DEPTH = 8;

/** Scrub a string: registered literals first, then patterns. */
export function scrubString(input: string): string {
  let out = input;
  for (const literal of registered) {
    if (literal && out.includes(literal)) out = out.split(literal).join(PLACEHOLDER);
  }
  for (const [re, replacement] of PATTERNS) {
    out = out.replace(re, replacement);
  }
  return out;
}

/**
 * Scrub an arbitrary value for structured logging.
 *
 * Errors are handled explicitly because **a stack is only produced when the error
 * is rendered** — a filter that inspects fields never sees it. That is the whole
 * point of applying this at format time (constraint #3, `docs/LEARNINGS.md`).
 */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[depth-limit]";
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint" || typeof value === "symbol") return String(value);
  if (typeof value === "function") return "[function]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: scrubString(value.message),
      stack: value.stack ? scrubString(value.stack) : undefined,
      ...(value.cause === undefined ? {} : { cause: scrubValue(value.cause, depth + 1) }),
    };
  }

  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));

  if (value instanceof URL) return scrubString(value.toString());

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? PLACEHOLDER : scrubValue(v, depth + 1);
  }
  return out;
}
