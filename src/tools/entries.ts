import type { NightscoutClient } from "../upstream/client.js";
import { asUntrustedField } from "../domain/freetext.js";
import { fromStorage, resolveUnit, targetRange, type GlucoseUnit } from "../domain/units.js";
import { UpstreamContractError } from "../upstream/errors.js";

/**
 * Lecture des relevés CGM récents.
 *
 * Premier outil de bout en bout : il traverse toute la chaîne (auth, client v3,
 * unités, neutralisation) sur les deux seules collections peuplées de l'instance.
 */

/**
 * Fenêtre maximale. 24 h font déjà ~288 relevés ; au-delà, un outil de lecture
 * brute cesse d'être une lecture et devient un déversement dans le contexte.
 * Les fenêtres longues sont le domaine des agrégats (contrainte #5).
 */
export const MAX_HOURS = 24;
export const DEFAULT_HOURS = 3;

export interface Reading {
  readonly at: string;
  readonly value: number;
  readonly unit: GlucoseUnit;
  readonly trend: string | undefined;
  /** Champ tiers-écrit : neutralisé et balisé (contrainte #6). */
  readonly device: string;
}

export interface RecentGlucose {
  readonly unit: GlucoseUnit;
  readonly targetRange: { readonly low: number; readonly high: number };
  readonly windowHours: number;
  readonly count: number;
  readonly readings: readonly Reading[];
  /** Renseigné quand quelque chose a été écarté — le silence serait trompeur. */
  readonly notes: readonly string[];
}

interface RawEntry {
  readonly date?: unknown;
  readonly sgv?: unknown;
  readonly type?: unknown;
  readonly direction?: unknown;
  readonly device?: unknown;
}

/**
 * Transforme des documents `entries` bruts en relevés publiables.
 *
 * Séparé de tout appel réseau pour être testable sur des charges utiles figées.
 */
export function toReadings(
  raw: readonly unknown[],
  unit: GlucoseUnit,
): { readonly readings: readonly Reading[]; readonly notes: readonly string[] } {
  const notes: string[] = [];
  const readings: Reading[] = [];
  let skippedType = 0;
  let skippedShape = 0;

  for (const doc of raw) {
    const e = doc as RawEntry;

    // `type` n'est pas toujours `sgv` : la collection contient aussi des relevés
    // capillaires (`mbg`) et des calibrations (`cal`). Les moyenner ensemble
    // corrompt silencieusement tout agrégat (`docs/DATA_MODEL.md`).
    if (e.type !== "sgv") {
      skippedType += 1;
      continue;
    }
    if (typeof e.sgv !== "number" || typeof e.date !== "number") {
      skippedShape += 1;
      continue;
    }

    readings.push({
      at: new Date(e.date).toISOString(),
      // `sgv` est stocké en mg/dL quelle que soit l'unité du profil : convertir
      // ici, sinon on étiquette une valeur mg/dL comme des mmol/L.
      value: fromStorage(e.sgv, unit),
      unit,
      trend: typeof e.direction === "string" ? e.direction : undefined,
      device: asUntrustedField("device", e.device),
    });
  }

  if (skippedType > 0) {
    notes.push(`${skippedType} entries skipped: not a CGM reading (type is not "sgv").`);
  }
  if (skippedShape > 0) {
    notes.push(`${skippedShape} entries skipped: missing or non-numeric sgv/date.`);
  }

  return { readings, notes };
}

/** Borne la fenêtre demandée, sans jamais faire confiance à l'argument reçu. */
export function clampHours(requested: number | undefined): number {
  if (typeof requested !== "number" || !Number.isFinite(requested)) return DEFAULT_HOURS;
  return Math.min(Math.max(1, Math.floor(requested)), MAX_HOURS);
}

export async function recentGlucose(
  client: NightscoutClient,
  requestedHours: number | undefined,
  now: () => number = Date.now,
): Promise<RecentGlucose> {
  const windowHours = clampHours(requestedHours);

  // Le profil d'abord : sans unité résolue, un chiffre publié n'a pas de sens.
  const profiles = await client.read("profile", { limit: 1 });
  const profile = profiles[0];
  if (profile === undefined) {
    throw new UpstreamContractError(
      "No profile document — cannot resolve glucose units.",
      "profile",
    );
  }
  const unit = resolveUnit(profile);

  const since = now() - windowHours * 3_600_000;
  const raw = await client.read("entries", {
    params: { "date$gte": since, "sort$desc": "date" },
  });

  const { readings, notes } = toReadings(raw, unit);

  return {
    unit,
    targetRange: targetRange(unit),
    windowHours,
    count: readings.length,
    readings,
    notes,
  };
}
