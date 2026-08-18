import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, configFromEnv } from "./config.js";
import { _resetSecrets, scrubString } from "./security/secrets.js";
import { FAKE_TOKEN, FAKE_HASHED_SECRET } from "./testing/fixtures.js";

afterEach(() => _resetSecrets());

const TOKEN = FAKE_TOKEN;
const ok = { NIGHTSCOUT_URL: "https://ns.example.example", NIGHTSCOUT_TOKEN: TOKEN };

describe("boot gate", () => {
  it("accepts a well-formed https URL and subject token", () => {
    const cfg = configFromEnv({ env: ok, readToken: () => null });
    expect(cfg.baseUrl).toBe("https://ns.example.example");
    expect(cfg.host).toBe("ns.example.example");
  });

  it("refuses http:// — constraint #7", () => {
    expect(() =>
      configFromEnv({ env: { ...ok, NIGHTSCOUT_URL: "http://ns.example.example" } }),
    ).toThrow(ConfigError);
  });

  it("refuses an API_SECRET in the environment", () => {
    expect(() => configFromEnv({ env: { ...ok, API_SECRET: "hunter2hunter2" } })).toThrow(
      /read-only/,
    );
  });

  it("refuses a hashed API_SECRET passed as the token", () => {
    const sha1 = FAKE_HASHED_SECRET;
    expect(() =>
      configFromEnv({ env: { ...ok, NIGHTSCOUT_TOKEN: sha1 }, readToken: () => null }),
    ).toThrow(/write access/);
  });

  it("refuses a token embedded in the URL — a v1 habit that defeats ADR 0002", () => {
    expect(() =>
      configFromEnv({
        env: { ...ok, NIGHTSCOUT_URL: "https://ns.example.example/?token=abc" },
      }),
    ).toThrow(/must not carry credentials/);
  });

  it("warns but proceeds on an unexpected token shape", () => {
    const warn = vi.fn();
    configFromEnv({
      env: { ...ok, NIGHTSCOUT_TOKEN: "an-unusual-looking-credential" },
      readToken: () => null,
      warn,
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("falls back to the keychain when no env token is set", () => {
    const cfg = configFromEnv({
      env: { NIGHTSCOUT_URL: ok.NIGHTSCOUT_URL },
      readToken: (host) => (host === "ns.example.example" ? TOKEN : null),
    });
    expect(cfg.token).toBe(TOKEN);
  });

  it("registers the token for scrubbing before returning", () => {
    configFromEnv({ env: ok, readToken: () => null });
    expect(scrubString(`leaked ${TOKEN}`)).toBe("leaked [REDACTED]");
  });

  it("never echoes the token in the missing-credential error", () => {
    try {
      configFromEnv({ env: { NIGHTSCOUT_URL: ok.NIGHTSCOUT_URL }, readToken: () => null });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("ns.example.example");
      expect((err as Error).message).not.toContain(TOKEN);
    }
  });
});
