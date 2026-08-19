import type { NightscoutClient } from "../upstream/client.js";
import { asUntrustedField } from "../domain/freetext.js";
import { fromStorage, resolveUnit, targetRange, type GlucoseUnit } from "../domain/units.js";
import { UpstreamContractError } from "../upstream/errors.js";

/**
 * Dernier relevé connu.
 *
 * Granularité dégénérée — un point — donc un outil à part entière (ADR 0006), avec
 * le plafond qui va avec : une lecture, jamais une fenêtre.
 *
 * Ce que cet outil doit dire et que les autres n'ont pas à dire : **l'âge du
 * relevé**. Un CGM décroche, un pont s'arrête, un téléphone se met en veille. Une
 * valeur de 180 vieille de quatre heures et une valeur de 180 datant de trois
 * minutes n'appellent pas la même lecture, et rien dans la valeur elle-même ne les
 * distingue.
 */

/**
 * Au-delà, le relevé cesse d'être « actuel ». Deux intervalles nominaux : assez
 * pour absorber un retard de transmission, pas assez pour masquer un décrochage.
 */
const STALE_AFTER_SECONDS = 600;

export interface Glance {
  readonly at: string;
  readonly ageSeconds: number;
  /** Vrai si le relevé a dépassé le seuil de fraîcheur. */
  readonly stale: boolean;
  readonly value: number;
  readonly unit: GlucoseUnit;
  readonly targetRange: { readonly low: number; readonly high: number };
  /** `below`, `in-range` ou `above`, selon les seuils du consensus. */
  readonly position: "below" | "in-range" | "above";
  readonly trend: string | undefined;
  readonly device: string;
  readonly caveats: readonly string[];
}

export async function currentGlucose(
  client: NightscoutClient,
  now: () => number = Date.now,
): Promise<Glance> {
  const profiles = await client.read("profile", { limit: 1 });
  const profile = profiles[0];
  if (profile === undefined) {
    throw new UpstreamContractError(
      "No profile document — cannot resolve glucose units.",
      "profile",
    );
  }
  const unit = resolveUnit(profile);

  // `sort$desc` seul, sans filtre temporel : on veut le dernier relevé, quel que
  // soit son âge. Filtrer sur une fenêtre récente rendrait « aucun relevé » là où
  // la réponse utile est « le dernier date d'il y a six heures ».
  const rows = await client.read("entries", {
    limit: 1,
    params: { "sort$desc": "date", "type$eq": "sgv" },
  });
  const row = rows[0] as { date?: unknown; sgv?: unknown; direction?: unknown; device?: unknown } | undefined;

  if (!row || typeof row.sgv !== "number" || typeof row.date !== "number") {
    throw new UpstreamContractError(
      "No CGM reading available on the instance.",
      "entries",
    );
  }

  const ageSeconds = Math.max(0, Math.round((now() - row.date) / 1000));
  const stale = ageSeconds > STALE_AFTER_SECONDS;
  const value = fromStorage(row.sgv, unit);
  const range = targetRange(unit);

  const caveats: string[] = [];
  if (stale) {
    caveats.push(
      `This reading is ${Math.round(ageSeconds / 60)} minutes old, past the ${STALE_AFTER_SECONDS / 60}-minute ` +
        "freshness threshold. The sensor, the uploader or the phone may be disconnected — treat it as a " +
        "last known value, not a current one.",
    );
  }

  return {
    at: new Date(row.date).toISOString(),
    ageSeconds,
    stale,
    value,
    unit,
    targetRange: range,
    position: value < range.low ? "below" : value > range.high ? "above" : "in-range",
    trend: typeof row.direction === "string" ? row.direction : undefined,
    device: asUntrustedField("device", row.device),
    caveats,
  };
}
