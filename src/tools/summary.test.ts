import { describe, expect, it, vi } from "vitest";
import { NightscoutAuth } from "../upstream/auth.js";
import { NightscoutClient } from "../upstream/client.js";
import { clampDays, DEFAULT_DAYS, glucoseSummary, MAX_DAYS } from "./summary.js";
import { UpstreamContractError } from "../upstream/errors.js";

const PROFILE = {
  defaultProfile: "Default",
  units: "mg/dl",
  store: { Default: { units: "mg/dl" } },
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function makeClient(results: unknown[][]) {
  const authFetch = vi.fn(async () =>
    json({ token: "eyJhbGciOiJIUzI1NiJ9.eyJhIjoxfQ.sig-aaaaaaaaaaaa" }),
  );
  const auth = new NightscoutAuth(
    { baseUrl: "https://ns.example.example", token: "guillaume-1a2b3c4d5e6f7890" },
    { fetch: authFetch as unknown as typeof globalThis.fetch },
  );
  const readFetch = vi.fn(async () => json({ status: 200, result: results.shift() ?? [] }));
  const client = new NightscoutClient(
    { baseUrl: "https://ns.example.example" },
    auth,
    { fetch: readFetch as unknown as typeof globalThis.fetch },
  );
  return { client, readFetch };
}

/** n relevés sgv espacés de 5 min, valeur constante. */
const entries = (value: number, n: number, from = 2_000_000_000_000) =>
  Array.from({ length: n }, (_, i) => ({
    type: "sgv",
    sgv: value,
    date: from + i * 300_000,
  }));

describe("clampDays", () => {
  it("borne, plancher et valeur par défaut", () => {
    expect(clampDays(undefined)).toBe(DEFAULT_DAYS);
    expect(clampDays(9999)).toBe(MAX_DAYS);
    expect(clampDays(0)).toBe(1);
    expect(clampDays(Number.NaN)).toBe(DEFAULT_DAYS);
  });
});

describe("glucoseSummary", () => {
  it("résume une fenêtre et publie la couverture", async () => {
    const { client } = makeClient([[PROFILE], entries(120, 288, 2_000_000_000_000 - 288 * 300_000)]);
    const out = await glucoseSummary(client, { days: 1 }, () => 2_000_000_000_000);

    expect(out.days).toBe(1);
    expect(out.unit).toBe("mg/dL");
    expect(out.mean).toBe(120);
    expect(out.count).toBe(288);
    expect(out.expected).toBe(288);
    expect(out.coverage).toBe(1);
    expect(out.bands.inRange).toBe(100);
  });

  it("écarte ce qui n'est pas un relevé CGM et le signale", async () => {
    const { client } = makeClient([
      [PROFILE],
      [
        ...entries(120, 10, 2_000_000_000_000 - 10 * 300_000),
        // Dans la fenêtre : c'est bien le TYPE qui doit les écarter, pas la date.
        { type: "mbg", sgv: 300, date: 2_000_000_000_000 - 9 * 300_000 },
        { type: "cal", date: 2_000_000_000_000 - 8 * 300_000 },
      ],
    ]);
    const out = await glucoseSummary(client, { days: 1 }, () => 2_000_000_000_000);
    expect(out.count).toBe(10);
    expect(out.caveats.join(" ")).toContain("2 document(s) skipped");
    // Le mbg à 300 aurait tiré la moyenne vers le haut s'il avait compté.
    expect(out.mean).toBe(120);
  });

  it("avertit d'une couverture insuffisante plutôt que de publier un chiffre muet", async () => {
    // 12 relevés sur 14 jours : la moyenne est calculable et ne représente rien.
    const { client } = makeClient([[PROFILE], entries(120, 12, 2_000_000_000_000 - 12 * 300_000)]);
    const out = await glucoseSummary(client, { days: 14 }, () => 2_000_000_000_000);
    expect(out.coverage).toBeLessThan(0.01);
    expect(out.caveats.join(" ")).toContain("unrepresentative");
  });

  it("échoue si aucun relevé CGM n'existe sur la fenêtre", async () => {
    const { client } = makeClient([[PROFILE], [{ type: "cal", date: 1 }]]);
    await expect(glucoseSummary(client, { days: 7 }, () => 2_000_000_000_000)).rejects.toThrow(
      UpstreamContractError,
    );
  });

  it("refuse de deviner si les unités du profil se contredisent", async () => {
    const conflicting = {
      defaultProfile: "Default",
      units: "mmol",
      store: { Default: { units: "mg/dl" } },
    };
    const { client } = makeClient([[conflicting], entries(120, 10)]);
    await expect(glucoseSummary(client, { days: 7 })).rejects.toThrow(/units disagree/);
  });

  it("pagine une fenêtre plus longue qu'une page", async () => {
    const { client, readFetch } = makeClient([
      [PROFILE],
      entries(120, 1000, 2_000_000_000_000 - 1500 * 300_000),
      entries(140, 500, 2_000_000_000_000 - 500 * 300_000),
    ]);
    const out = await glucoseSummary(client, { days: 7 }, () => 2_000_000_000_000);

    expect(out.count).toBe(1500);
    // profil + 2 pages
    expect(readFetch).toHaveBeenCalledTimes(3);
    // moyenne pondérée : (1000*120 + 500*140) / 1500 = 126.67
    expect(out.mean).toBe(127);
  });
});

describe("fenêtre calendaire", () => {
  const TZ_PROFILE = {
    defaultProfile: "Default",
    units: "mg/dl",
    store: { Default: { units: "mg/dl", timezone: "Europe/Paris" } },
  };

  /** Minuit parisien : 18/08 -> 17/08 22:00 UTC ; 29/03 -> 28/03 23:00 UTC. */
  const PARIS_DAY_START = Date.UTC(2026, 7, 17, 22, 0, 0);
  const PARIS_DST_DAY_START = Date.UTC(2026, 2, 28, 23, 0, 0);

  it("cadre minuit à minuit dans le fuseau du profil, pas en UTC", async () => {
    const { client, readFetch } = makeClient([
      [TZ_PROFILE],
      entries(120, 10, PARIS_DAY_START),
    ]);
    const out = await glucoseSummary(client, { date: "2026-08-18" });

    // Paris en aout est a UTC+2 : la journee locale commence a 22:00 UTC la veille.
    expect(out.since).toBe("2026-08-17T22:00:00.000Z");
    expect(out.until).toBe("2026-08-18T22:00:00.000Z");
    expect(out.window).toContain("Europe/Paris");

    const url = String((readFetch.mock.calls[1] as unknown[])[0]);
    expect(url).toContain("date%24gte");
    // La borne haute n'est PAS envoyée en second filtre : deux conditions sur le
    // même champ font remonter tout l'historique. Elle est appliquée localement.
    expect(url).not.toContain("date%24lt");
  });

  it("dit explicitement qu'une fenêtre glissante ne correspond pas à un rapport", async () => {
    const { client } = makeClient([[TZ_PROFILE], entries(120, 10)]);
    const out = await glucoseSummary(client, { days: 1 }, () => 2_000_000_000_000);
    expect(out.window).toContain("NOT aligned");
  });

  it("calcule la couverture sur la durée réelle du jour de bascule horaire", async () => {
    // 29 mars 2026 : la journee parisienne fait 23 h, donc 276 releves attendus,
    // pas 288. Sans cela la couverture afficherait 104 %.
    const { client } = makeClient([[TZ_PROFILE], entries(120, 276, PARIS_DST_DAY_START)]);
    const out = await glucoseSummary(client, { date: "2026-03-29" });
    expect(out.expected).toBe(276);
    expect(out.coverage).toBe(1);
  });

  it("refuse un jour calendaire si le profil ne déclare pas de fuseau", async () => {
    const noTz = {
      defaultProfile: "Default",
      units: "mg/dl",
      store: { Default: { units: "mg/dl" } },
    };
    const { client } = makeClient([[noTz], entries(120, 10)]);
    await expect(glucoseSummary(client, { date: "2026-08-18" })).rejects.toThrow(/timezone/);
  });
});

describe("la fenêtre calendaire ne déborde pas — régression du 2026-08-17", () => {
  const TZ = {
    defaultProfile: "Default",
    units: "mg/dl",
    store: { Default: { units: "mg/dl", timezone: "Europe/Paris" } },
  };

  it("écarte les relevés postérieurs à la fin de journée locale", async () => {
    // Sur l'instance réelle, une journée demandée rendait 2243 relevés (7,8 jours)
    // parce que la borne haute partait en second filtre et annulait la borne
    // basse. Ici l'amont renvoie deux jours d'affilée : un seul doit compter.
    const dayStart = Date.UTC(2026, 7, 16, 22, 0, 0); // minuit du 17 à Paris
    const twoDays = Array.from({ length: 576 }, (_, i) => ({
      type: "sgv",
      sgv: 120,
      date: dayStart + i * 300_000,
    }));
    const { client } = makeClient([[TZ], twoDays]);

    const out = await glucoseSummary(client, { date: "2026-08-17" });

    expect(out.count).toBe(288);
    expect(out.expected).toBe(288);
    expect(out.coverage).toBe(1);
    expect(out.caveats.join(" ")).not.toContain("Density is");
  });

  it("écarte aussi les relevés antérieurs au début de journée locale", async () => {
    const dayStart = Date.UTC(2026, 7, 16, 22, 0, 0); // minuit du 17 à Paris
    const spanning = Array.from({ length: 576 }, (_, i) => ({
      type: "sgv",
      sgv: 120,
      date: dayStart - 288 * 300_000 + i * 300_000,
    }));
    const { client } = makeClient([[TZ], spanning]);
    const out = await glucoseSummary(client, { date: "2026-08-17" });
    expect(out.count).toBe(288);
  });
});
