import type { NightscoutClient } from "../upstream/client.js";
import { THRESHOLDS_MGDL } from "../domain/aggregates.js";
import { fromStorage, resolveUnit, type GlucoseUnit } from "../domain/units.js";
import { UpstreamContractError } from "../upstream/errors.js";

/**
 * Détection d'épisodes hypo- et hyperglycémiques.
 *
 * Granularité propre : l'outil rend des **intervalles**, pas des relevés. Son volume
 * dépend du nombre d'épisodes, pas de la durée de la fenêtre — d'où un outil séparé
 * avec son propre plafond (ADR 0006).
 *
 * C'est ce qu'un pourcentage de temps en cible ne dit pas : 5 % passés sous 70,
 * c'est une heure et quart sur une journée, mais **une hypoglycémie d'une heure et
 * quart n'est pas la même chose que quinze épisodes de cinq minutes**. La forme
 * temporelle est l'information ; l'agrégat la détruit.
 */

export const MAX_DAYS = 30;
export const DEFAULT_DAYS = 7;
const MAX_DOCUMENTS = 30_000;

/**
 * Un relevé isolé sous le seuil est le plus souvent un artefact de capteur. Deux
 * relevés consécutifs, c'est dix minutes — assez pour être réel.
 */
const MIN_READINGS = 2;

/**
 * Un trou plus court que cela ne coupe pas un épisode en deux : un relevé manquant
 * au milieu d'une hypoglycémie ne la termine pas.
 */
const MAX_GAP_MS = 20 * 60_000;

export interface Episode {
  readonly kind: "low" | "high";
  readonly start: string;
  readonly end: string;
  readonly durationMinutes: number;
  readonly readings: number;
  /** Valeur la plus extrême atteinte, dans l'unité d'affichage. */
  readonly peak: number;
  /** Vrai si l'épisode franchit aussi le seuil « très bas » ou « très haut ». */
  readonly severe: boolean;
}

export interface EpisodeReport {
  readonly unit: GlucoseUnit;
  readonly days: number;
  readonly thresholds: { readonly low: number; readonly high: number };
  readonly episodes: readonly Episode[];
  readonly counts: { readonly low: number; readonly high: number; readonly severe: number };
  readonly caveats: readonly string[];
}

export function clampDays(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_DAYS;
  return Math.min(Math.max(1, Math.floor(requested)), MAX_DAYS);
}

interface Timed {
  readonly date: number;
  readonly sgv: number;
}

/** Regroupe en épisodes les relevés franchissant un seuil. Fonction pure. */
export function findEpisodes(readings: readonly Timed[], unit: GlucoseUnit): readonly Episode[] {
  const sorted = readings.toSorted((a, b) => a.date - b.date);
  const episodes: Episode[] = [];

  for (const kind of ["low", "high"] as const) {
    const matches = (v: number): boolean =>
      kind === "low" ? v < THRESHOLDS_MGDL.low : v > THRESHOLDS_MGDL.high;
    const isSevere = (v: number): boolean =>
      kind === "low" ? v < THRESHOLDS_MGDL.veryLow : v > THRESHOLDS_MGDL.veryHigh;

    let run: Timed[] = [];
    const flush = (): void => {
      if (run.length < MIN_READINGS) {
        run = [];
        return;
      }
      const first = run[0]!;
      const last = run[run.length - 1]!;
      const values = run.map((r) => r.sgv);
      const peakRaw = kind === "low" ? Math.min(...values) : Math.max(...values);
      episodes.push({
        kind,
        start: new Date(first.date).toISOString(),
        end: new Date(last.date).toISOString(),
        durationMinutes: Math.round((last.date - first.date) / 60_000),
        readings: run.length,
        peak: fromStorage(peakRaw, unit),
        severe: values.some(isSevere),
      });
      run = [];
    };

    for (const r of sorted) {
      const previous = run[run.length - 1];
      if (matches(r.sgv)) {
        // Un trou trop long clôt l'épisode : on ne sait pas ce qui s'est passé
        // entre les deux, et le supposer continu allongerait une durée publiée.
        if (previous && r.date - previous.date > MAX_GAP_MS) flush();
        run.push(r);
      } else {
        flush();
      }
    }
    flush();
  }

  return episodes.toSorted((a, b) => a.start.localeCompare(b.start));
}

export async function glucoseEpisodes(
  client: NightscoutClient,
  requestedDays: number | undefined,
  now: () => number = Date.now,
): Promise<EpisodeReport> {
  const days = clampDays(requestedDays);

  const profiles = await client.read("profile", { limit: 1 });
  const profile = profiles[0];
  if (profile === undefined) {
    throw new UpstreamContractError("No profile document — cannot resolve units.", "profile");
  }
  const unit = resolveUnit(profile);

  const since = now() - days * 86_400_000;
  const { docs, truncated } = await client.readWindow("entries", {
    timeField: "date",
    since,
    maxDocuments: MAX_DOCUMENTS,
  });

  const readings: Timed[] = [];
  for (const doc of docs) {
    const e = doc as { type?: unknown; sgv?: unknown; date?: unknown };
    if (e.type === "sgv" && typeof e.sgv === "number" && typeof e.date === "number") {
      readings.push({ date: e.date, sgv: e.sgv });
    }
  }

  const episodes = findEpisodes(readings, unit);
  const caveats: string[] = [
    `An episode needs at least ${MIN_READINGS} consecutive readings past the threshold: a single ` +
      "outlier is usually a sensor artefact.",
    `A gap longer than ${MAX_GAP_MS / 60_000} minutes ends an episode — what happened in between is ` +
      "unknown, and assuming continuity would inflate a published duration.",
    "Durations are measured between the first and last reading of the episode, so they understate " +
      "it by up to one sampling interval on each side.",
  ];
  if (truncated) {
    caveats.push("Reading cap reached — the window is incomplete and older episodes are missing.");
  }
  if (readings.length === 0) {
    caveats.push("No CGM readings in the window.");
  }

  return {
    unit,
    days,
    thresholds: {
      low: fromStorage(THRESHOLDS_MGDL.low, unit),
      high: fromStorage(THRESHOLDS_MGDL.high, unit),
    },
    episodes,
    counts: {
      low: episodes.filter((e) => e.kind === "low").length,
      high: episodes.filter((e) => e.kind === "high").length,
      severe: episodes.filter((e) => e.severe).length,
    },
    caveats,
  };
}
