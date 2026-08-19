import { describe, expect, it } from "vitest";
import { clampDays, DEFAULT_DAYS, findEpisodes, MAX_DAYS } from "./episodes.js";

const T0 = 1_755_000_000_000;
/** n relevés à `value`, espacés de 5 min, à partir de `offset` intervalles. */
const run = (value: number, n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ date: T0 + (offset + i) * 300_000, sgv: value }));

describe("clampDays", () => {
  it("borne, plancher, valeur par défaut", () => {
    expect(clampDays(undefined)).toBe(DEFAULT_DAYS);
    expect(clampDays(9999)).toBe(MAX_DAYS);
    expect(clampDays(0)).toBe(1);
  });
});

describe("findEpisodes", () => {
  it("ne retient pas un relevé isolé sous le seuil", () => {
    // Un point isolé est presque toujours un artefact de capteur.
    const readings = [...run(120, 3), ...run(60, 1, 3), ...run(120, 3, 4)];
    expect(findEpisodes(readings, "mg/dL")).toHaveLength(0);
  });

  it("retient deux relevés consécutifs sous le seuil", () => {
    const readings = [...run(120, 3), ...run(60, 2, 3), ...run(120, 3, 5)];
    const eps = findEpisodes(readings, "mg/dL");
    expect(eps).toHaveLength(1);
    expect(eps[0]?.kind).toBe("low");
    expect(eps[0]?.readings).toBe(2);
    expect(eps[0]?.durationMinutes).toBe(5);
  });

  it("distingue quinze courts épisodes d'un seul long — ce que le TIR ne dit pas", () => {
    // Même temps total sous le seuil, forme temporelle opposée.
    const long = [...run(60, 15)];
    const scattered = Array.from({ length: 15 }, (_, i) => run(60, 2, i * 10)).flat();

    expect(findEpisodes(long, "mg/dL")).toHaveLength(1);
    expect(findEpisodes(scattered, "mg/dL")).toHaveLength(15);
  });

  it("coupe l'épisode sur un trou de données trop long", () => {
    // 2 relevés bas, une heure de silence, 2 relevés bas : deux épisodes, pas un
    // seul d'une heure — on ne sait pas ce qui s'est passé entre les deux.
    const readings = [...run(60, 2), ...run(60, 2, 14)];
    const eps = findEpisodes(readings, "mg/dL");
    expect(eps).toHaveLength(2);
  });

  it("ne coupe pas sur un trou court", () => {
    const readings = [...run(60, 2), ...run(60, 2, 4)];
    expect(findEpisodes(readings, "mg/dL")).toHaveLength(1);
  });

  it("marque comme sévère un épisode franchissant le seuil très bas", () => {
    const eps = findEpisodes([...run(50, 3)], "mg/dL");
    expect(eps[0]?.severe).toBe(true);
    expect(eps[0]?.peak).toBe(50);
  });

  it("détecte aussi les hyperglycémies, avec leur pic", () => {
    const eps = findEpisodes([...run(220, 2), ...run(300, 2, 2)], "mg/dL");
    expect(eps).toHaveLength(1);
    expect(eps[0]?.kind).toBe("high");
    expect(eps[0]?.peak).toBe(300);
    expect(eps[0]?.severe).toBe(true);
  });

  it("range les bornes du bon côté : 70 et 180 ne sont pas des épisodes", () => {
    expect(findEpisodes([...run(70, 5), ...run(180, 5, 5)], "mg/dL")).toHaveLength(0);
  });

  it("rend les pics dans l'unité d'affichage", () => {
    const eps = findEpisodes([...run(54, 3)], "mmol/L");
    expect(eps[0]?.peak).toBeCloseTo(3.0, 1);
  });

  it("rend les épisodes en ordre chronologique, tous types confondus", () => {
    const readings = [...run(300, 2), ...run(120, 2, 2), ...run(50, 2, 4)];
    const eps = findEpisodes(readings, "mg/dL");
    expect(eps.map((e) => e.kind)).toEqual(["high", "low"]);
    expect(eps[0]!.start < eps[1]!.start).toBe(true);
  });

  it("ne rend rien sur une fenêtre vide", () => {
    expect(findEpisodes([], "mg/dL")).toHaveLength(0);
  });
});
