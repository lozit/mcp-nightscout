import { describe, expect, it } from "vitest";
import { configFromEnv } from "../config.js";
import { logger } from "./logger.js";
import { FAKE_TOKEN } from "../testing/fixtures.js";

/**
 * The acceptance test for constraint #3, stated as behaviour rather than as unit
 * coverage: trigger a real throw whose message and stack both carry the token,
 * push it through the real logger, and read what actually lands on stderr.
 *
 * `docs/VISION.md` acceptance criterion 2.
 */
describe("no token reaches stderr from a real rendered stack", () => {
  it("scrubs a 27-character token a pattern-only redactor would miss", () => {
    const TOKEN = FAKE_TOKEN;
    expect(TOKEN.length).toBeLessThan(32);
    expect(/\b[A-Za-z0-9+/_-]{32,}={0,2}\b/.test(TOKEN)).toBe(false);

    configFromEnv({
      env: { NIGHTSCOUT_URL: "https://ns.example.example", NIGHTSCOUT_TOKEN: TOKEN },
      readToken: () => null,
    });

    const captured: string[] = [];
    const realWrite = process.stderr.write.bind(process.stderr);
    (process.stderr as unknown as { write: unknown }).write = (chunk: unknown) => {
      captured.push(String(chunk));
      return true;
    };

    try {
      try {
        throw new Error(
          `fetch failed: GET https://ns.example.example/api/v2/authorization/request/${TOKEN}`,
        );
      } catch (err) {
        logger.error("upstream call failed", err);
      }
    } finally {
      (process.stderr as unknown as { write: unknown }).write = realWrite;
    }

    const output = captured.join("");
    expect(output).not.toBe("");
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(TOKEN);
    // La moitié hexadécimale du token utilisé, pas une constante figée : une
    // assertion qui porte sur une chaîne absente du test passe toujours.
    expect(output).not.toContain(FAKE_TOKEN.split("-")[1]!);
    expect(output).toContain("upstream call failed"); // the diagnostic survives
  });
});
