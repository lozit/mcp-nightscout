import { afterEach, describe, expect, it, vi } from "vitest";
import { NightscoutAuth } from "./auth.js";
import { MAX_LIMIT, NightscoutClient } from "./client.js";
import { UpstreamContractError, UpstreamError } from "./errors.js";
import { resetSecretsForTests } from "../security/secrets.js";
import { FAKE_TOKEN, FAKE_JWT_A, FAKE_JWT_B } from "../testing/fixtures.js";

afterEach(() => resetSecretsForTests());

const BASE = "https://ns.example.example";
const TOKEN = FAKE_TOKEN;
const JWT_A = FAKE_JWT_A;
const JWT_B = FAKE_JWT_B;

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

/** Page de n documents dont `date` croît depuis `from`. */
const page = (from: number, n: number, step = 300_000) =>
  Array.from({ length: n }, (_, i) => ({ date: from + i * step, sgv: 120 }));

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

describe("readWindow — pagination ascendante à filtre unique", () => {
  it("n'envoie jamais deux filtres sur le champ temporel", async () => {
    // Le défaut trouvé sur l'instance réelle : `date$gte` + `date$lt` ensemble
    // faisaient remonter tout l'historique au lieu de la fenêtre demandée.
    const { client, readFetch } = makeClient([
      () => json({ status: 200, result: page(1000, 5) }),
    ]);
    await client.readWindow("entries", {
      timeField: "date",
      since: 1000,
      until: 9_999_999,
      maxDocuments: 10_000,
    });
    const url = String((readFetch.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("date%24gte");
    expect(url).not.toContain("date%24lt");
    expect(url).toContain("sort=date"); // ascendant
  });

  it("applique la borne haute localement et s'arrête dès qu'elle est franchie", async () => {
    const { client } = makeClient([
      () => json({ status: 200, result: page(1000, MAX_LIMIT) }),
    ]);
    const cutoff = 1000 + 10 * 300_000;
    const { docs } = await client.readWindow("entries", {
      timeField: "date",
      since: 1000,
      until: cutoff,
      maxDocuments: 10_000,
    });
    expect(docs).toHaveLength(10); // strictement avant la borne
    for (const d of docs) expect((d as { date: number }).date).toBeLessThan(cutoff);
  });

  it("enchaîne les pages en remontant la borne basse", async () => {
    const { client, readFetch } = makeClient([
      () => json({ status: 200, result: page(1000, MAX_LIMIT) }),
      () => json({ status: 200, result: page(1000 + MAX_LIMIT * 300_000, 7) }),
    ]);
    const { docs, truncated } = await client.readWindow("entries", {
      timeField: "date",
      since: 1000,
      maxDocuments: 10_000,
    });
    expect(docs).toHaveLength(MAX_LIMIT + 7);
    expect(truncated).toBe(false);
    // La deuxième requête part au-delà du dernier document de la première.
    const second = decodeURIComponent(String((readFetch.mock.calls[1] as unknown[])[0]));
    expect(second).toContain(`date$gte=${1000 + (MAX_LIMIT - 1) * 300_000 + 1}`);
  });

  it("s'arrête au plafond de documents et le signale", async () => {
    const { client } = makeClient([
      () => json({ status: 200, result: page(1000, MAX_LIMIT) }),
      () => json({ status: 200, result: page(1_000_000_000, MAX_LIMIT) }),
      () => json({ status: 200, result: page(2_000_000_000, MAX_LIMIT) }),
    ]);
    const { docs, truncated } = await client.readWindow("entries", {
      timeField: "date",
      since: 0,
      maxDocuments: 1500,
    });
    expect(truncated).toBe(true);
    expect(docs.length).toBeGreaterThanOrEqual(1500);
  });

  it("ne boucle pas si la borne ne progresse pas", async () => {
    const same = () => json({ status: 200, result: page(1000, MAX_LIMIT, 0) });
    const { client, readFetch } = makeClient([same, same, same, same]);
    const { docs } = await client.readWindow("entries", {
      timeField: "date",
      since: 1000,
      maxDocuments: 100_000,
    });
    expect(readFetch.mock.calls.length).toBeLessThanOrEqual(2);
    expect(docs.length).toBe(MAX_LIMIT);
  });

  it("rend une fenêtre vide sans erreur", async () => {
    const { client } = makeClient([() => json({ status: 200, result: [] })]);
    const { docs, truncated } = await client.readWindow("entries", {
      timeField: "date",
      since: 0,
      maxDocuments: 100,
    });
    expect(docs).toHaveLength(0);
    expect(truncated).toBe(false);
  });
});

describe("readWindow — les bornes sont vérifiées localement", () => {
  it("écarte ce qui précède la borne basse même si l'amont l'a laissé passer", async () => {
    // Le filtre serveur est un moyen, pas une garantie : un agrégat calculé sur
    // une fenêtre plus large que demandée ne lève rien, il rend un faux crédible.
    const { client } = makeClient([() => json({ status: 200, result: page(0, 100) })]);
    const { docs } = await client.readWindow("entries", {
      timeField: "date",
      since: 50 * 300_000,
      maxDocuments: 10_000,
    });
    expect(docs).toHaveLength(50);
    for (const d of docs) {
      expect((d as { date: number }).date).toBeGreaterThanOrEqual(50 * 300_000);
    }
  });

  it("écarte ce qui dépasse la borne haute", async () => {
    const { client } = makeClient([() => json({ status: 200, result: page(0, 100) })]);
    const { docs } = await client.readWindow("entries", {
      timeField: "date",
      since: 0,
      until: 30 * 300_000,
      maxDocuments: 10_000,
    });
    expect(docs).toHaveLength(30);
  });
});
