import type { NightscoutClient } from "../upstream/client.js";
import { summarize, type Summary, type TimedReading } from "../domain/aggregates.js";
import { resolveUnit } from "../domain/units.js";
import { calendarDay, profileTimeZone } from "../domain/timewindow.js";
import { UpstreamContractError } from "../upstream/errors.js";

/**
 * Résumé glycémique sur une fenêtre longue.
 *
 * Contrepartie exacte de la contrainte #5 : on lit potentiellement des milliers de
 * relevés, et on n'en renvoie qu'une dizaine de nombres. C'est ce que
 * « l'agrégation côté serveur » veut dire — réduire le volume de façon
 * déterministe, pas être intelligent.
 */

/** 14 jours : la fenêtre de référence du consensus pour un rapport CGM. */
export const DEFAULT_DAYS = 14;
export const MAX_DAYS = 90;

/**
 * Plafond dur de documents lus pour un seul résumé. 90 jours à un relevé / 5 min
 * font ~25 900 ; on garde de la marge pour une instance qui écrirait plus dense.
 */
const MAX_DOCUMENTS = 30_000;

export function clampDays(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_DAYS;
  return Math.min(Math.max(1, Math.floor(requested)), MAX_DAYS);
}

export interface GlucoseSummary extends Summary {
  readonly days: number;
  readonly since: string;
  readonly until: string;
  /** Comment la fenêtre a été cadrée — décisif pour comparer à un rapport. */
  readonly window: string;
}

export interface SummaryOptions {
  readonly days?: number | undefined;
  /**
   * Jour calendaire `YYYY-MM-DD`, cadré minuit→minuit dans le fuseau du profil.
   *
   * C'est ce qu'il faut pour comparer à un rapport Nightscout, qui est calendaire :
   * une fenêtre glissante « dernières 24 h » couvre une autre période et produit un
   * écart légitime qui se lit comme un bug.
   */
  readonly date?: string | undefined;
}

export async function glucoseSummary(
  client: NightscoutClient,
  options: SummaryOptions = {},
  now: () => number = Date.now,
): Promise<GlucoseSummary> {
  const profiles = await client.read("profile", { limit: 1 });
  const profile = profiles[0];
  if (profile === undefined) {
    throw new UpstreamContractError(
      "No profile document — cannot resolve glucose units.",
      "profile",
    );
  }
  const unit = resolveUnit(profile);

  let since: number;
  let until: number | undefined;
  let days: number;
  let window: string;

  if (options.date) {
    const tz = profileTimeZone(profile);
    if (!tz) {
      throw new UpstreamContractError(
        "Profile carries no `timezone`, so a calendar day cannot be framed. " +
          "Use the sliding `days` window instead.",
        "timezone",
      );
    }
    const w = calendarDay(options.date, tz);
    since = w.since;
    until = w.until;
    // Une journée de bascule horaire ne fait pas 24 h : la couverture doit être
    // calculée sur la durée réelle, sinon elle affiche 104 % ou 96 %.
    days = (w.until - w.since) / 86_400_000;
    window = `calendar day ${w.label}`;
  } else {
    days = clampDays(options.days);
    since = now() - days * 86_400_000;
    window = `sliding, last ${days} day(s) — NOT aligned with a Nightscout report`;
  }

  const { docs, truncated } = await client.readWindow("entries", {
    timeField: "date",
    since,
    ...(until === undefined ? {} : { until }),
    maxDocuments: MAX_DOCUMENTS,
  });

  // Même filtre que l'outil de lecture : `entries` mélange sgv, mbg et cal, et
  // les moyenner ensemble corrompt tout ce qui suit.
  const sgv: TimedReading[] = [];
  let skipped = 0;
  for (const doc of docs) {
    const e = doc as { type?: unknown; sgv?: unknown; date?: unknown };
    if (e.type === "sgv" && typeof e.sgv === "number" && typeof e.date === "number") {
      sgv.push({ date: e.date, sgv: e.sgv });
    } else {
      skipped += 1;
    }
  }

  if (sgv.length === 0) {
    throw new UpstreamContractError(
      `No CGM readings in the last ${days} day(s) — nothing to summarize.`,
      "entries",
    );
  }

  const summary = summarize(sgv, unit, days * 24);
  const caveats = [...summary.caveats];
  if (skipped > 0) {
    caveats.push(`${skipped} document(s) skipped: not a CGM reading.`);
  }
  if (truncated) {
    caveats.push(
      `Reading cap of ${MAX_DOCUMENTS} documents reached — the window is incomplete ` +
        "and these figures describe only the most recent part of it.",
    );
  }

  return {
    ...summary,
    caveats,
    days,
    since: new Date(since).toISOString(),
    until: new Date(until ?? now()).toISOString(),
    window,
  };
}
