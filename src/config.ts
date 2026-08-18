import { readToken as keychainToken } from "./credentials.js";
import { registerSecret } from "./security/secrets.js";

/**
 * Configuration and the **boot gate**.
 *
 * Failing closed here is cheaper than defending every call site: if the URL scheme
 * or the credential kind is wrong, the process does not start (`docs/SECURITY.md`).
 *
 * Nothing in this module may appear in a log line or an error message. Errors below
 * name variables and hosts — never values.
 */

export interface NightscoutConfig {
  /** Validated `https://` origin, no trailing slash. */
  readonly baseUrl: string;
  /** Host, used as the keychain account key. Not a secret. */
  readonly host: string;
  /** The `readable`-role subject token. Registered for scrubbing before return. */
  readonly token: string;
}

export class ConfigError extends Error {
  override readonly name = "ConfigError";
}

/**
 * A Nightscout `API_SECRET` is conventionally stored and transmitted as its SHA-1
 * hex digest — 40 hex characters. A subject token never looks like that.
 *
 * Accepting an API_SECRET would hand this server admin capability, which is the
 * precise harm the read-only decision exists to prevent (ADR 0001). Refuse it.
 */
const SHA1_HEX_RE = /^[0-9a-f]{40}$/i;

/**
 * Nightscout issues subject tokens as `<subject-name>-<16 hex>`. This is a
 * **shape warning, not a gate**: the format is a convention rather than a
 * guarantee, so an unexpected shape is worth saying out loud but not worth
 * refusing to boot over. The things we are certain are wrong are refused above.
 */
const SUBJECT_TOKEN_RE = /-[0-9a-f]{16}$/i;

export interface ConfigDeps {
  readonly env?: Record<string, string | undefined>;
  readonly readToken?: (host: string) => string | null;
  readonly warn?: (message: string) => void;
}

export function configFromEnv(deps: ConfigDeps = {}): NightscoutConfig {
  const env = deps.env ?? process.env;
  const readToken = deps.readToken ?? keychainToken;
  const warn = deps.warn ?? (() => {});

  const rawUrl = env["NIGHTSCOUT_URL"];
  if (!rawUrl) {
    throw new ConfigError(
      "NIGHTSCOUT_URL is not set. Set it to your Nightscout site, e.g. https://example.example.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ConfigError("NIGHTSCOUT_URL is not a valid URL.");
  }

  // Constraint #7. A silent http:// would send the credential in clear.
  if (parsed.protocol !== "https:") {
    throw new ConfigError(
      `NIGHTSCOUT_URL must use https:// (got ${parsed.protocol.replace(":", "")}://). ` +
        "Refusing to start: the credential would travel in clear.",
    );
  }

  // A credential in the URL is a v1 habit and defeats ADR 0002 before we begin.
  if (parsed.username || parsed.password || parsed.searchParams.has("token")) {
    throw new ConfigError(
      "NIGHTSCOUT_URL must not carry credentials. Remove any userinfo or ?token= " +
        "parameter: the token is exchanged for a JWT and sent in a header (ADR 0002).",
    );
  }

  if (env["NIGHTSCOUT_API_SECRET"] || env["API_SECRET"]) {
    throw new ConfigError(
      "An API_SECRET is set in the environment. This server is read-only and must " +
        "never hold admin capability (ADR 0001). Create a `readable` subject in " +
        "Nightscout's Admin Tools and use its token instead.",
    );
  }

  const host = parsed.host;
  const baseUrl = parsed.origin;

  const token = env["NIGHTSCOUT_TOKEN"] ?? readToken(host);
  if (!token) {
    // Names only — never echo a value, not even truncated.
    throw new ConfigError(
      `No Nightscout token found for ${host}. Store one in your OS keychain, or ` +
        "set NIGHTSCOUT_TOKEN for a one-off run.",
    );
  }

  if (SHA1_HEX_RE.test(token)) {
    throw new ConfigError(
      "The configured credential looks like a hashed API_SECRET (40 hex characters), " +
        "not a subject token. Refusing to start: that would grant write access " +
        "this server must not have (ADR 0001).",
    );
  }

  if (!SUBJECT_TOKEN_RE.test(token)) {
    warn(
      "The configured token does not look like a Nightscout subject token " +
        "(expected a `-<16 hex>` suffix). Continuing, but check it was created as a " +
        "`readable` subject in Admin Tools.",
    );
  }

  // Register before returning, so the token is already scrubbed from any log line
  // or rendered stack produced by whatever the caller does next.
  registerSecret(token);

  return { baseUrl, host, token };
}
