/**
 * Upstream error handling — constraint #2 (`docs/SECURITY.md`).
 *
 * Under v3 the credential travels in a header, not the URL (ADR 0002), so a
 * URL-bearing error is no longer the primary leak path. Two reasons this still
 * matters: the **token→JWT exchange** is one request that does carry the token in
 * its path, and any error object we did not construct may embed whatever it likes.
 *
 * So the rule stands: re-throw with the **path only**, and drop the cause. A
 * retained `cause` keeps the original message alive in the rendered stack, which
 * is exactly where the scrubber's "by value" registration has to save us instead.
 */

/** An upstream call failed. Carries no URL, no query string, no credential. */
export class UpstreamError extends Error {
  override readonly name = "UpstreamError";

  /** Request path only — never the full URL. */
  readonly path: string;
  /** HTTP status, when there was a response at all. */
  readonly status: number | undefined;

  constructor(message: string, path: string, status?: number) {
    super(message);
    this.path = path;
    this.status = status;
  }
}

/**
 * The upstream response did not match what we expect.
 *
 * A shape mismatch must surface as a loud failure, never as a plausible-looking
 * reading: this server's output is glucose data someone may reason about.
 */
export class UpstreamContractError extends Error {
  override readonly name = "UpstreamContractError";

  readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.field = field;
  }
}

/** Raised before any request is built, when an identifier fails validation. */
export class InvalidIdentifierError extends Error {
  override readonly name = "InvalidIdentifierError";
}

/**
 * Nightscout v3 identifiers, as probed on the live instance: 24-character hex
 * Mongo ObjectIds (`docs/DATA_MODEL.md`).
 *
 * The guard exists because HTTP clients normalize `..` segments per RFC 3986, so
 * an unvalidated identifier turns a scoped read into an arbitrary one.
 *
 * If a legitimate read ever fails this check, **re-probe and widen it
 * deliberately** — do not relax it to make a call succeed.
 */
const IDENTIFIER_RE = /^[0-9a-fA-F]{24}$/;

export function assertValidIdentifier(candidate: string): string {
  if (!IDENTIFIER_RE.test(candidate)) {
    // Length only. The value is attacker-controlled and echoing it back into a
    // log or a tool result is how you get the log to carry the payload.
    throw new InvalidIdentifierError(
      `Not a valid Nightscout identifier (expected 24 hex characters, got ${candidate.length}).`,
    );
  }
  return candidate;
}
