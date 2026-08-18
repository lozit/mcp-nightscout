import { afterEach, describe, expect, it } from "vitest";
import {
  _resetSecrets,
  forgetSecret,
  registerSecret,
  scrubString,
  scrubValue,
} from "./secrets.js";
import { FAKE_OPAQUE_BLOB, FAKE_TOKEN, fakeJwt } from "../testing/fixtures.js";

afterEach(() => _resetSecrets());

/**
 * The token measured on the live instance is 27 characters. This length is the
 * whole reason the value-registration half of constraint #3 exists: the house
 * pattern-only redactor uses a 32-character minimum and never fires on it.
 */
const REAL_LENGTH_TOKEN = FAKE_TOKEN; // même forme, même ordre de longueur

describe("value-level scrubbing (the half a pattern-only redactor misses)", () => {
  it("scrubs a token shorter than the 32-char pattern threshold", () => {
    const token = FAKE_TOKEN;
    expect(token.length).toBeLessThan(32); // the finding, asserted

    // Sanity: the pattern-only approach genuinely does not catch it.
    expect(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/.test(token)).toBe(false);

    registerSecret(token);
    expect(scrubString(`GET failed for ${token}`)).toBe("GET failed for [REDACTED]");
  });

  it("scrubs the URL-encoded form of a registered secret", () => {
    const token = "a b+c/d-0123456789abcdef";
    registerSecret(token);
    const encoded = encodeURIComponent(token);
    expect(encoded).not.toBe(token);
    expect(scrubString(`path?x=${encoded}`)).not.toContain(encoded);
  });

  it("scrubs a doubly-encoded form", () => {
    const token = "tok/en-0123456789abcdef";
    registerSecret(token);
    const twice = encodeURIComponent(encodeURIComponent(token));
    expect(scrubString(twice)).not.toContain("tok");
  });

  it("ignores values too short to be a credential", () => {
    registerSecret("abc");
    expect(scrubString("abc def")).toBe("abc def");
  });

  it("forgets a rotated JWT so only the current one is registered", () => {
    const oldJwt = fakeJwt("rotated");
    registerSecret(oldJwt);
    expect(scrubString(oldJwt)).toBe("[REDACTED]");
    forgetSecret(oldJwt);
    // The literal is gone from the registry; the generic long-blob pattern may
    // still catch it, so assert on the registry behaviour via a short value.
    const shortish = "short-0123456789abcdef";
    registerSecret(shortish);
    forgetSecret(shortish);
    expect(scrubString(shortish)).toBe(shortish);
  });
});

describe("pattern-level scrubbing (defence in depth)", () => {
  it("scrubs a bearer header even if the JWT was never registered", () => {
    const jwt = fakeJwt("x");
    const payload = jwt.split(".")[1]!;
    const line = `Authorization: Bearer ${jwt}`;
    expect(scrubString(line)).toContain("[REDACTED]");
    expect(scrubString(line)).not.toContain(payload);
  });

  it("scrubs a v1 ?token= query parameter", () => {
    const out = scrubString("https://example.example/api/v1/entries?token=secret-value&count=1");
    expect(out).not.toContain("secret-value");
    expect(out).toContain("count=1"); // only the credential goes
  });

  it("scrubs a bare JWT by shape", () => {
    const jwt = fakeJwt("abc");
    expect(scrubString(`token was ${jwt}`)).not.toContain(jwt.split(".")[1]!);
  });
});

describe("scrubValue", () => {
  it("redacts by key name regardless of the value's shape", () => {
    const out = scrubValue({ token: "x", jwt: "y", authorization: "z", sgv: 120 }) as Record<
      string,
      unknown
    >;
    expect(out["token"]).toBe("[REDACTED]");
    expect(out["jwt"]).toBe("[REDACTED]");
    expect(out["authorization"]).toBe("[REDACTED]");
    expect(out["sgv"]).toBe(120); // data survives
  });

  it("scrubs a registered secret out of a rendered stack — the case a filter misses", () => {
    registerSecret(REAL_LENGTH_TOKEN);
    const err = new Error(`request to /api/v2/authorization/request/${REAL_LENGTH_TOKEN} failed`);
    const out = scrubValue(err) as { message: string; stack?: string };
    expect(out.message).not.toContain(REAL_LENGTH_TOKEN);
    expect(out.stack ?? "").not.toContain(REAL_LENGTH_TOKEN);
  });

  it("scrubs a nested cause", () => {
    registerSecret(REAL_LENGTH_TOKEN);
    const err = new Error("outer", { cause: new Error(`inner ${REAL_LENGTH_TOKEN}`) });
    expect(JSON.stringify(scrubValue(err))).not.toContain(REAL_LENGTH_TOKEN);
  });

  it("scrubs a URL object", () => {
    registerSecret(REAL_LENGTH_TOKEN);
    const url = new URL(`https://example.example/api/v2/authorization/request/${REAL_LENGTH_TOKEN}`);
    expect(scrubValue(url)).not.toContain(REAL_LENGTH_TOKEN);
  });

  it("stops at the depth limit instead of recursing forever", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    expect(() => JSON.stringify(scrubValue(cyclic))).not.toThrow();
  });
});

describe("the last-resort blob pattern does not eat the diagnostic", () => {
  it("leaves a URL path intact when nothing is registered", () => {
    const line = "GET https://ns.example.example/api/v3/entries?limit=1 failed";
    expect(scrubString(line)).toBe(line);
  });

  it("leaves a hyphenated filesystem path intact", () => {
    const line = "at file:///Users/someone/Projets-mcp-nightscout-workspace/src/index.js:6:9";
    expect(scrubString(line)).toBe(line);
  });

  it("still redacts a genuine long opaque credential", () => {
    const blob = FAKE_OPAQUE_BLOB;
    expect(blob.length).toBeGreaterThanOrEqual(32);
    expect(scrubString(`x-api-key ${blob}`)).toContain("[REDACTED]");
  });

  it("keeps the registered token scrubbed even though the blob pattern narrowed", () => {
    const token = FAKE_TOKEN;
    registerSecret(token);
    const out = scrubString(`GET https://ns.example.example/api/v2/authorization/request/${token}`);
    expect(out).not.toContain(token);
    expect(out).toContain("https://ns.example.example/api/v2/authorization/request/");
  });
});
