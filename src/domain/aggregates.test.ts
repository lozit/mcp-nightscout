import { describe, expect, it } from "vitest";
import { summarize, THRESHOLDS_MGDL } from "./aggregates.js";

/** Fabrique n relevés valant tous v, espacés de 5 min. */
const flat = (v: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ date: 1_700_000_000_000 + i * 300_000, sgv: v }));

/** Transforme une liste de valeurs en relevés horodatés régulièrement. */
const at = (values: readonly number[]) =>
  values.map((sgv, i) => ({ date: 1_700_000_000_000 + i * 300_000, sgv }));

describe("moyenne, écart-type, CV", () => {
  it("calcule une moyenne vérifiable à la main", () => {
    const s = summarize(at([100, 110, 120, 130, 140]), "mg/dL", 1);
    expect(s.mean).toBe(120); // (100+110+120+130+140)/5
  });

  it("utilise l'écart-type d'échantillon (n-1), pas celui de population", () => {
    // [100,110,120,130,140] : moyenne 120, somme des carrés des écarts = 1000.
    // n-1 -> sqrt(1000/4) = 15.81 ; n -> sqrt(1000/5) = 14.14.
    const s = summarize(at([100, 110, 120, 130, 140]), "mg/dL", 1);
    expect(s.sd).toBe(16); // 15.81 arrondi à l'entier en mg/dL
    expect(s.sd).not.toBe(14);
  });

  it("CV = SD / moyenne x 100", () => {
    const s = summarize(at([100, 110, 120, 130, 140]), "mg/dL", 1);
    expect(s.cv).toBeCloseTo((15.811 / 120) * 100, 0);
  });

  it("signale qu'un seul relevé ne permet ni SD ni CV", () => {
    const s = summarize(at([120]), "mg/dL", 1);
    expect(s.sd).toBe(0);
    expect(s.caveats.join(" ")).toContain("at least 2 readings");
  });

  it("refuse une fenêtre vide plutôt que de rendre NaN", () => {
    expect(() => summarize([], "mg/dL", 1)).toThrow(/nothing to summarize/);
  });
});

describe("GMI", () => {
  it("applique la formule de Bergenstal sur la moyenne en mg/dL", () => {
    // 3.31 + 0.02392 x 154 = 6.99
    const s = summarize(flat(154, 10), "mg/dL", 1);
    expect(s.gmi).toBe(7.0);
  });

  it("donne le même GMI quelle que soit l'unité d'affichage", () => {
    // Le GMI est un % d'HbA1c : il ne dépend pas de l'unité choisie pour afficher
    // la glycémie. S'il bougeait, c'est que la conversion aurait fui dans le calcul.
    const mgdl = summarize(flat(154, 10), "mg/dL", 1);
    const mmol = summarize(flat(154, 10), "mmol/L", 1);
    expect(mmol.gmi).toBe(mgdl.gmi);
  });
});

describe("bandes du consensus", () => {
  it("classe chaque valeur dans la bonne bande, bornes comprises", () => {
    const s = summarize(at([40, 60, 100, 200, 300]), "mg/dL", 1);
    expect(s.bands).toEqual({
      veryLow: 20,
      low: 20,
      inRange: 20,
      high: 20,
      veryHigh: 20,
    });
  });

  it("range les valeurs limites du bon côté", () => {
    // 70 et 180 sont DANS la cible ; 54 est dans "bas", pas "très bas".
    const s = summarize(at([THRESHOLDS_MGDL.low, THRESHOLDS_MGDL.high, THRESHOLDS_MGDL.veryLow]), "mg/dL", 1);
    expect(s.bands.inRange).toBeCloseTo(66.7, 1);
    expect(s.bands.low).toBeCloseTo(33.3, 1);
    expect(s.bands.veryLow).toBe(0);
  });

  it("les bandes somment à 100", () => {
    const s = summarize(at([50, 65, 80, 120, 190, 260, 300]), "mg/dL", 1);
    const total = Object.values(s.bands).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("n'utilise pas les cibles du profil — les seuils sont fixes", () => {
    const s = summarize(flat(120, 10), "mg/dL", 1);
    expect(s.thresholds).toEqual({ veryLow: 54, low: 70, high: 180, veryHigh: 250 });
  });

  it("exprime les seuils dans l'unité d'affichage", () => {
    const s = summarize(flat(120, 10), "mmol/L", 1);
    expect(s.thresholds.low).toBeCloseTo(3.9, 1);
    expect(s.thresholds.high).toBeCloseTo(10.0, 1);
  });
});

describe("couverture", () => {
  it("compte les relevés attendus à un toutes les 5 minutes", () => {
    const s = summarize(flat(120, 288), "mg/dL", 24);
    expect(s.expected).toBe(288);
    expect(s.coverage).toBe(1);
  });

  it("avertit sous 70 % de couverture", () => {
    // 3 relevés sur 24 h : la moyenne a l'air normale, elle ne représente rien.
    const s = summarize(flat(120, 3), "mg/dL", 24);
    expect(s.coverage).toBeLessThan(0.7);
    expect(s.caveats.join(" ")).toContain("unrepresentative");
  });

  it("n'avertit pas sur une couverture pleine", () => {
    const s = summarize(flat(120, 288), "mg/dL", 24);
    expect(s.caveats.join(" ")).not.toContain("unrepresentative");
  });

  it("dit toujours que les bandes sont des parts de relevés, pas du temps", () => {
    const s = summarize(flat(120, 288), "mg/dL", 24);
    expect(s.caveats.join(" ")).toContain("not time-weighted");
  });
});

describe("cohérence entre unités", () => {
  it("convertit moyenne et écart-type sans changer le CV", () => {
    // Le CV est un rapport : il est sans unité et doit être identique.
    const values = at([100, 110, 120, 130, 140]);
    const mgdl = summarize(values, "mg/dL", 1);
    const mmol = summarize(values, "mmol/L", 1);
    expect(mmol.cv).toBe(mgdl.cv);
    expect(mmol.mean).toBeCloseTo(120 / 18.018, 1);
  });

  it("donne les mêmes bandes dans les deux unités", () => {
    const values = at([50, 65, 80, 120, 190, 260]);
    expect(summarize(values, "mmol/L", 1).bands).toEqual(summarize(values, "mg/dL", 1).bands);
  });
});

describe("doublons et densité — les anomalies qu'il ne faut pas masquer", () => {
  it("écarte les horodatages identiques et le dit", () => {
    // Un import d'historique tournant pendant qu'un pont écrit produit exactement
    // ça : le même instant deux fois.
    const doubled = [
      { date: 1000, sgv: 100 },
      { date: 1000, sgv: 100 },
      { date: 2000, sgv: 200 },
    ];
    const s = summarize(doubled, "mg/dL", 1);
    expect(s.count).toBe(2);
    expect(s.duplicatesDropped).toBe(1);
    expect(s.caveats.join(" ")).toContain("duplicate timestamp");
  });

  it("les doublons ne biaisent plus la moyenne", () => {
    // Sans déduplication : (100+100+200)/3 = 133. Avec : (100+200)/2 = 150.
    const s = summarize(
      [
        { date: 1000, sgv: 100 },
        { date: 1000, sgv: 100 },
        { date: 2000, sgv: 200 },
      ],
      "mg/dL",
      1,
    );
    expect(s.mean).toBe(150);
  });

  it("ne plafonne PAS une couverture supérieure à 1", () => {
    // Le défaut trouvé sur données réelles : 2243 relevés pour 288 attendus
    // s'affichaient comme "couverture 100 %", ce qui lisait une anomalie comme
    // une situation parfaite.
    const dense = Array.from({ length: 576 }, (_, i) => ({
      date: 1_700_000_000_000 + i * 150_000, // un relevé / 2.5 min
      sgv: 120,
    }));
    const s = summarize(dense, "mg/dL", 24);
    expect(s.coverage).toBeGreaterThan(1);
    expect(s.caveats.join(" ")).toContain("Density is");
    expect(s.caveats.join(" ")).toContain("second uploader or a backfill");
  });

  it("publie l'intervalle médian réellement observé", () => {
    const s = summarize(flat(120, 10), "mg/dL", 1);
    expect(s.medianIntervalSeconds).toBe(300); // 5 min
  });

  it("ne crie pas à la densité sur un flux nominal", () => {
    const s = summarize(flat(120, 288), "mg/dL", 24);
    expect(s.coverage).toBe(1);
    expect(s.caveats.join(" ")).not.toContain("Density is");
  });
});

describe("médiane", () => {
  it("est publiée et résiste aux valeurs extrêmes", () => {
    // Moyenne tirée par le 400 ; médiane non.
    const s = summarize(at([100, 110, 120, 130, 400]), "mg/dL", 1);
    expect(s.median).toBe(120);
    expect(s.mean).toBe(172);
  });

  it("moyenne les deux valeurs centrales sur un effectif pair", () => {
    expect(summarize(at([100, 110, 130, 140]), "mg/dL", 1).median).toBe(120);
  });
});
