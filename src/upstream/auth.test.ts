import { afterEach, describe, expect, it, vi } from "vitest";
import { NightscoutAuth } from "./auth.js";
import { UpstreamContractError, UpstreamError } from "./errors.js";
import { _resetSecrets, scrubString } from "../security/secrets.js";

afterEach(() => _resetSecrets());

const CONFIG = { baseUrl: "https://ns.example.example", token: "guillaume-1a2b3c4d5e6f7890" };
const JWT_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.signature-aaaaaaaaaaaa";
const JWT_B = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiIn0.signature-bbbbbbbbbbbb";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("échange token → JWT", () => {
  it("échange une fois puis sert le cache", async () => {
    const fetch = vi.fn(async () => jsonResponse({ token: JWT_A }));
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });

    expect(auth.hasJwt).toBe(false);
    expect(await auth.getJwt()).toBe(JWT_A);
    expect(await auth.getJwt()).toBe(JWT_A);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("encode le token dans le chemin", async () => {
    const fetch = vi.fn(async () => jsonResponse({ token: JWT_A }));
    const auth = new NightscoutAuth(
      { ...CONFIG, token: "a/../b-1a2b3c4d5e6f7890" },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    await auth.getJwt();
    const called = String((fetch.mock.calls[0] as unknown[])[0]);
    // Le chemin ne doit pas pouvoir se déplacer ailleurs.
    expect(called).not.toContain("/../");
    expect(called).toContain("%2F..%2F");
  });

  it("refresh() force un nouvel échange et remplace le JWT", async () => {
    const bodies = [JWT_A, JWT_B];
    const fetch = vi.fn(async () => jsonResponse({ token: bodies.shift() }));
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });

    expect(await auth.getJwt()).toBe(JWT_A);
    expect(await auth.refresh()).toBe(JWT_B);
    expect(await auth.getJwt()).toBe(JWT_B);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("partage un échange en vol entre appels concurrents", async () => {
    let resolveIt: ((r: Response) => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveIt = resolve;
        }),
    );
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });

    const all = Promise.all([auth.getJwt(), auth.getJwt(), auth.getJwt()]);
    resolveIt?.(jsonResponse({ token: JWT_A }));

    expect(await all).toEqual([JWT_A, JWT_A, JWT_A]);
    // Le point du test : une rafale de 401 ne doit pas produire N échanges.
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("enregistre le JWT au scrubbing dès l'obtention", async () => {
    const fetch = vi.fn(async () => jsonResponse({ token: JWT_A }));
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });
    await auth.getJwt();
    expect(scrubString(`Authorization: Bearer ${JWT_A}`)).not.toContain("signature-aaaa");
  });
});

describe("erreurs assainies", () => {
  it("ne met jamais le token dans le message ni le chemin d'erreur", async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: "nope" }, 401));
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });

    await expect(auth.getJwt()).rejects.toThrow(UpstreamError);
    try {
      await auth.getJwt();
    } catch (err) {
      const e = err as UpstreamError;
      expect(e.path).toBe("/api/v2/authorization/request/<token>");
      expect(e.path).not.toContain(CONFIG.token);
      expect(e.message).not.toContain(CONFIG.token);
      expect(e.status).toBe(401);
    }
  });

  it("ne rattache pas la cause d'une panne transport (elle ferait revivre l'URL)", async () => {
    const fetch = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED https://ns.example.example/api/v2/.../${CONFIG.token}`);
    });
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });
    try {
      await auth.getJwt();
      expect.unreachable("devait lever");
    } catch (err) {
      expect((err as Error).cause).toBeUndefined();
      expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toContain(CONFIG.token);
    }
  });

  it("échoue bruyamment si la réponse n'a pas de champ token", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: 200 }));
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(auth.getJwt()).rejects.toThrow(UpstreamContractError);
  });

  it("échoue bruyamment sur un corps non-JSON", async () => {
    const fetch = vi.fn(async () => new Response("<html>502</html>", { status: 200 }));
    const auth = new NightscoutAuth(CONFIG, { fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(auth.getJwt()).rejects.toThrow(UpstreamContractError);
  });
});
