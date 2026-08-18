import { afterEach, describe, expect, it, vi } from "vitest";
import { NightscoutAuth } from "./auth.js";
import { MAX_LIMIT, NightscoutClient } from "./client.js";
import { UpstreamContractError, UpstreamError } from "./errors.js";
import { _resetSecrets } from "../security/secrets.js";

afterEach(() => _resetSecrets());

const BASE = "https://ns.example.example";
const TOKEN = "guillaume-1a2b3c4d5e6f7890";
const JWT_A = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.signature-aaaaaaaaaaaa";
const JWT_B = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJiIn0.signature-bbbbbbbbbbbb";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Auth réelle, avec un fetch scripté — on teste l'assemblage, pas un mock d'auth. */
function makeClient(readResponses: Array<() => Response>, jwts = [JWT_A, JWT_B]) {
  const authFetch = vi.fn(async () => json({ token: jwts.shift() ?? JWT_B }));
  const auth = new NightscoutAuth(
    { baseUrl: BASE, token: TOKEN },
    { fetch: authFetch as unknown as typeof globalThis.fetch },
  );
  const readFetch = vi.fn(async () => (readResponses.shift() ?? (() => json({ status: 200, result: [] })))());
  const client = new NightscoutClient(
    { baseUrl: BASE },
    auth,
    { fetch: readFetch as unknown as typeof globalThis.fetch },
  );
  return { client, readFetch, authFetch };
}

describe("lecture v3", () => {
  it("renvoie result et envoie le JWT en en-tête, pas dans l'URL", async () => {
    const { client, readFetch } = makeClient([() => json({ status: 200, result: [{ sgv: 120 }] })]);
    const rows = await client.read("entries", { limit: 1 });

    expect(rows).toEqual([{ sgv: 120 }]);
    const [url, init] = readFetch.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(JWT_A);
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${JWT_A}`);
  });

  it("demande fields=_all par défaut — sans lui v3 tronque le document", async () => {
    const { client, readFetch } = makeClient([() => json({ status: 200, result: [] })]);
    await client.read("entries");
    expect(String((readFetch.mock.calls[0] as unknown[])[0])).toContain("fields=_all");
  });
});

describe("contrainte #5 — plafond de volume", () => {
  it("plafonne une limite délirante à MAX_LIMIT", async () => {
    const { client, readFetch } = makeClient([() => json({ status: 200, result: [] })]);
    await client.read("entries", { limit: 999_999 });
    expect(String((readFetch.mock.calls[0] as unknown[])[0])).toContain(`limit=${MAX_LIMIT}`);
  });

  it("plafonne aussi quand aucune limite n'est demandée", async () => {
    const { client, readFetch } = makeClient([() => json({ status: 200, result: [] })]);
    await client.read("entries");
    expect(String((readFetch.mock.calls[0] as unknown[])[0])).toContain(`limit=${MAX_LIMIT}`);
  });

  it("refuse un nom de collection qui n'est pas une constante propre", async () => {
    const { client } = makeClient([]);
    await expect(client.read("../devicestatus")).rejects.toThrow(UpstreamError);
    await expect(client.read("entries?x=1")).rejects.toThrow(UpstreamError);
  });
});

describe("expiration du JWT", () => {
  it("ré-échange une fois sur 401 puis rejoue la lecture", async () => {
    const { client, readFetch, authFetch } = makeClient([
      () => json({ message: "expired" }, 401),
      () => json({ status: 200, result: [{ sgv: 99 }] }),
    ]);

    expect(await client.read("entries")).toEqual([{ sgv: 99 }]);
    expect(readFetch).toHaveBeenCalledTimes(2);
    expect(authFetch).toHaveBeenCalledTimes(2); // échange initial + ré-échange

    const second = readFetch.mock.calls[1] as [string, RequestInit];
    expect((second[1].headers as Record<string, string>)["authorization"]).toBe(`Bearer ${JWT_B}`);
  });

  it("n'insiste pas après un second 401 — c'est un vrai refus", async () => {
    const { client, readFetch } = makeClient([
      () => json({}, 401),
      () => json({}, 401),
      () => json({ status: 200, result: [] }),
    ]);

    await expect(client.read("entries")).rejects.toThrow(/after a fresh exchange/);
    expect(readFetch).toHaveBeenCalledTimes(2); // pas de troisième tentative
  });
});

describe("contrat amont", () => {
  it("échoue bruyamment si l'enveloppe n'est pas { status, result }", async () => {
    const { client } = makeClient([() => json([{ sgv: 120 }])]);
    await expect(client.read("entries")).rejects.toThrow(UpstreamContractError);
  });

  it("échoue bruyamment sur un corps non-JSON", async () => {
    const { client } = makeClient([() => new Response("<html>502</html>", { status: 200 })]);
    await expect(client.read("entries")).rejects.toThrow(UpstreamContractError);
  });

  it("l'erreur porte le chemin, jamais l'URL ni le credential", async () => {
    const { client } = makeClient([() => json({}, 500)]);
    try {
      await client.read("entries");
      expect.unreachable("devait lever");
    } catch (err) {
      const e = err as UpstreamError;
      expect(e.path).toBe("/api/v3/entries");
      expect(e.message).not.toContain("http");
      expect(JSON.stringify(e, Object.getOwnPropertyNames(e))).not.toContain(JWT_A);
    }
  });
});
