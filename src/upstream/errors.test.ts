import { describe, expect, it } from "vitest";
import { assertValidIdentifier, InvalidIdentifierError, UpstreamError } from "./errors.js";

describe("assertValidIdentifier", () => {
  it("accepts the 24-hex ObjectId shape probed on the live instance", () => {
    const id = "68a2b1c4d5e6f7089a1b2c3d";
    expect(id).toHaveLength(24);
    expect(assertValidIdentifier(id)).toBe(id);
  });

  it("rejects a path-traversal attempt", () => {
    // The reason the guard exists: HTTP clients normalize `..` per RFC 3986, so
    // this would turn a scoped read into an arbitrary one.
    expect(() => assertValidIdentifier("../devicestatus")).toThrow(InvalidIdentifierError);
  });

  it("rejects a slash even inside an otherwise valid-looking id", () => {
    expect(() => assertValidIdentifier("68a2b1c4d5e6f708/9a1b2c3d")).toThrow(
      InvalidIdentifierError,
    );
  });

  it("rejects a UUID — widening must be a deliberate re-probe, not a silent pass", () => {
    expect(() => assertValidIdentifier("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toThrow(
      InvalidIdentifierError,
    );
  });

  it("never echoes the rejected value back", () => {
    const hostile = "../../etc/passwd-CANARY";
    try {
      assertValidIdentifier(hostile);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).not.toContain("CANARY");
      expect((err as Error).message).toContain("24 hex");
    }
  });
});

describe("UpstreamError", () => {
  it("carries a path and status but no URL", () => {
    const err = new UpstreamError("upstream refused", "/api/v3/entries", 401);
    expect(err.path).toBe("/api/v3/entries");
    expect(err.status).toBe(401);
    expect(err.message).not.toContain("http");
  });
});
