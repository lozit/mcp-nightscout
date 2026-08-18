import { fromStorage, type GlucoseUnit } from "./units.js";

/**
 * Agrégats glycémiques — déterministes, côté serveur (contrainte #5).
 *
 * Tout est calculé en **mg/dL**, l'unité de stockage de Nightscout et celle dans
 * laquelle les seuils du consensus international et la formule du GMI sont
 * définis. La conversion vers l'unité d'affichage n'a lieu qu'en sortie : convertir
 * d'abord introduirait des erreurs d'arrondi dans chaque comparaison de seuil.
 *
 * Rappel de posture : la sécurité échoue bruyamment, l'arithmétique échoue en
 * silence. Chaque chiffre publié ici doit être vérifiable à la main contre les
 * rapports Nightscout, et chaque choix méthodologique est explicite plutôt que
 * caché dans une constante.
 */

/**
 * Seuils du consensus international (Battelino et al. 2019), en mg/dL.
 *
 * **Délibérément indépendants des cibles du profil.** `target_low`/`target_high`
 * du profil sont les cibles de *régulation* d'une boucle, propres à la personne ;
 * les bornes du TIR sont une convention de *mesure*, fixe, sans laquelle deux
 * chiffres ne sont pas comparables — ni entre personnes, ni avec la littérature.
 * Utiliser les cibles du profil produirait un « TIR » qui n'en est pas un.
 */
export const THRESHOLDS_MGDL = {
  veryLow: 54,
  low: 70,
  high: 180,
  veryHigh: 250,
} as const;

/** Intervalle nominal entre deux relevés CGM, en minutes. */
const CGM_INTERVAL_MINUTES = 5;

/**
 * En dessous de cette couverture, le consensus considère un rapport comme non
 * représentatif. On ne refuse pas de calculer — on le signale.
 */
const MIN_COVERAGE_RATIO = 0.7;

export interface Bands {
  readonly veryLow: number;
  readonly low: number;
  readonly inRange: number;
  readonly high: number;
  readonly veryHigh: number;
}

export interface Summary {
  readonly unit: GlucoseUnit;
  readonly windowHours: number;
  readonly count: number;
  /** Relevés attendus sur la fenêtre à un relevé / 5 min. */
  readonly expected: number;
  /**
   * `count / expected`, **non borné**.
   *
   * Une valeur nettement supérieure à 1 n'est pas une bonne nouvelle : elle
   * signale une base plus dense que le nominal — doublons, ou double
   * alimentation. La plafonner à 1 ferait passer une anomalie pour une couverture
   * parfaite, ce qui est exactement l'inverse de ce qu'on veut.
   */
  readonly coverage: number;
  /** Horodatages identiques écartés avant calcul. */
  readonly duplicatesDropped: number;
  /** Intervalle médian observé entre deux relevés, en secondes. */
  readonly medianIntervalSeconds: number | undefined;
  readonly mean: number;
  /** Médiane, dans l'unité d'affichage. Robuste aux valeurs extrêmes. */
  readonly median: number;
  /** Écart-type d'échantillon (n-1), dans l'unité d'affichage. */
  readonly sd: number;
  /** Coefficient de variation, en pourcentage. Sans unité. */
  readonly cv: number;
  /** Glucose Management Indicator, en % d'HbA1c estimée. */
  readonly gmi: number;
  /** Pourcentages par bande, sommant à 100. */
  readonly bands: Bands;
  readonly thresholds: {
    readonly veryLow: number;
    readonly low: number;
    readonly high: number;
    readonly veryHigh: number;
  };
  readonly caveats: readonly string[];
}

function round(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Calcule le résumé à partir de valeurs **en mg/dL telles que stockées**.
 *
 * `windowHours` sert à estimer la couverture : sans elle, 3 relevés sur 24 h
 * produiraient une moyenne d'apparence normale.
 */
export interface TimedReading {
  readonly date: number;
  readonly sgv: number;
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarize(
  readings: readonly TimedReading[],
  unit: GlucoseUnit,
  windowHours: number,
): Summary {
  const expected = Math.round((windowHours * 60) / CGM_INTERVAL_MINUTES);
  const caveats: string[] = [];

  if (readings.length === 0) {
    throw new Error("No readings in the window — nothing to summarize.");
  }

  // Déduplication par horodatage. Deux documents portant la même date sont le
  // même instant mesuré deux fois : les garder pondère la moyenne vers les
  // périodes dupliquées, sans que rien ne le signale. Ce cas se produit dès qu'un
  // import d'historique tourne pendant qu'un pont écrit déjà.
  const byDate = new Map<number, number>();
  for (const r of readings) {
    if (!byDate.has(r.date)) byDate.set(r.date, r.sgv);
  }
  const duplicatesDropped = readings.length - byDate.size;
  if (duplicatesDropped > 0) {
    caveats.push(
      `${duplicatesDropped} duplicate timestamp(s) dropped before computing. ` +
        "Duplicates bias every figure toward the periods that carry them.",
    );
  }

  const dates = [...byDate.keys()].sort((a, b) => a - b);
  const sgvMgdl = dates.map((d) => byDate.get(d)!);
  const n = sgvMgdl.length;

  // Intervalle médian réel : le meilleur indicateur de ce que la base contient
  // vraiment, indépendamment de ce qu'on suppose du capteur.
  let medianIntervalSeconds: number | undefined;
  if (dates.length >= 2) {
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i += 1) gaps.push((dates[i]! - dates[i - 1]!) / 1000);
    gaps.sort((a, b) => a - b);
    medianIntervalSeconds = Math.round(median(gaps));
  }

  const meanMgdl = sgvMgdl.reduce((a, b) => a + b, 0) / n;

  // Écart-type d'échantillon (n-1) : ces relevés sont un échantillon de la
  // glycémie sur la fenêtre, pas la population entière. Avec n≈288 l'écart avec
  // le diviseur n est sous 0,2 %, mais le choix doit être su pour qu'une
  // comparaison à la main qui diverge d'un cheveu soit interprétable.
  let sdMgdl = 0;
  if (n >= 2) {
    const variance = sgvMgdl.reduce((acc, x) => acc + (x - meanMgdl) ** 2, 0) / (n - 1);
    sdMgdl = Math.sqrt(variance);
  } else {
    caveats.push("Standard deviation and CV need at least 2 readings.");
  }

  const cv = meanMgdl > 0 ? (sdMgdl / meanMgdl) * 100 : 0;

  // Bergenstal et al. 2018. Définie sur la moyenne en mg/dL, d'où le calcul avant
  // toute conversion.
  const gmi = 3.31 + 0.02392 * meanMgdl;

  const counts = { veryLow: 0, low: 0, inRange: 0, high: 0, veryHigh: 0 };
  for (const v of sgvMgdl) {
    if (v < THRESHOLDS_MGDL.veryLow) counts.veryLow += 1;
    else if (v < THRESHOLDS_MGDL.low) counts.low += 1;
    else if (v <= THRESHOLDS_MGDL.high) counts.inRange += 1;
    else if (v <= THRESHOLDS_MGDL.veryHigh) counts.high += 1;
    else counts.veryHigh += 1;
  }
  const pct = (k: number): number => round((k / n) * 100, 1);
  const bands: Bands = {
    veryLow: pct(counts.veryLow),
    low: pct(counts.low),
    inRange: pct(counts.inRange),
    high: pct(counts.high),
    veryHigh: pct(counts.veryHigh),
  };

  const coverage = expected > 0 ? n / expected : 1;
  if (coverage > 1.5) {
    caveats.push(
      `Density is ${round(coverage, 1)}x the nominal one reading / 5 min ` +
        `(${n} distinct timestamps for ~${expected} expected` +
        (medianIntervalSeconds === undefined
          ? ""
          : `, median interval ${medianIntervalSeconds}s`) +
        "). The instance holds more data than a single CGM feed produces - check for a second " +
        "uploader or a backfill. These figures are computed on what is there.",
    );
  }
  if (coverage < MIN_COVERAGE_RATIO) {
    caveats.push(
      `Coverage is ${round(coverage * 100, 0)}% (${n} of ~${expected} expected readings). ` +
        "Below 70% the consensus treats a report as unrepresentative: gaps are not random, " +
        "and these percentages describe the readings that exist, not the time they cover.",
    );
  }

  // Ce que ces pourcentages sont vraiment. Nightscout calcule de la même façon, ce
  // qui rend la vérification à la main possible — mais l'approximation ne
  // disparaît pas parce que les deux la partagent.
  caveats.push(
    "Band percentages are shares of readings, not time-weighted. They coincide only " +
      "while readings are evenly spaced.",
  );

  const conv = (v: number): number => fromStorage(v, unit);

  return {
    unit,
    windowHours,
    count: n,
    expected,
    coverage: round(coverage, 3),
    duplicatesDropped,
    medianIntervalSeconds,
    mean: conv(meanMgdl),
    median: conv(median(sgvMgdl.slice().sort((a, b) => a - b))),
    // L'écart-type est un écart, pas une mesure : il se convertit par le facteur
    // d'échelle, sans décalage. Passer par `fromStorage` reste correct puisque la
    // conversion mg/dL→mmol/L est purement multiplicative.
    sd: conv(sdMgdl),
    cv: round(cv, 1),
    gmi: round(gmi, 1),
    bands,
    thresholds: {
      veryLow: conv(THRESHOLDS_MGDL.veryLow),
      low: conv(THRESHOLDS_MGDL.low),
      high: conv(THRESHOLDS_MGDL.high),
      veryHigh: conv(THRESHOLDS_MGDL.veryHigh),
    },
    caveats,
  };
}
