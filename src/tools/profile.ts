import type { NightscoutClient } from "../upstream/client.js";
import { asUntrustedField } from "../domain/freetext.js";
import { normalizeUnit, resolveUnit, type GlucoseUnit } from "../domain/units.js";
import { UpstreamContractError } from "../upstream/errors.js";

/**
 * Lecture du profil thérapeutique.
 *
 * C'est **l'actif que le modèle de menace protège** (ADR 0001) : basal, ISF, ICR et
 * DIA sont les paramètres qu'une boucle fermée utilise pour calculer une dose
 * d'insuline. Ce serveur les lit et ne les écrira jamais.
 *
 * Deux pièges traités ici, tous deux capables de produire une réponse fausse et
 * crédible :
 *
 * 1. **Tout est segmenté par heure de la journée.** « L'ISF est de 45 » est faux par
 *    construction : il vaut 45 *pendant certains segments*. Chaque valeur est donc
 *    rendue avec ses segments, jamais aplatie en scalaire.
 * 2. **Les cibles glycémiques du profil sont en unités d'affichage**, contrairement
 *    à `sgv` qui est toujours stocké en mg/dL. Elles ne passent donc **pas** par la
 *    conversion appliquée aux relevés.
 */

export interface Segment {
  /** Heure locale de début, `HH:MM`. */
  readonly from: string;
  readonly value: number;
}

export interface TherapyProfile {
  readonly name: string;
  readonly timezone: string | undefined;
  readonly unit: GlucoseUnit;
  /** Durée d'action de l'insuline, en heures. Scalaire, celui-là. */
  readonly dia: number | undefined;
  /** Débit de base, U/h, par segment. */
  readonly basal: readonly Segment[];
  /** Sensibilité à l'insuline (ISF), dans l'unité d'affichage, par segment. */
  readonly insulinSensitivity: readonly Segment[];
  /** Ratio glucides/insuline (ICR), g/U, par segment. */
  readonly carbRatio: readonly Segment[];
  /** Cibles basses et hautes, dans l'unité d'affichage, par segment. */
  readonly targetLow: readonly Segment[];
  readonly targetHigh: readonly Segment[];
  readonly caveats: readonly string[];
}

export interface ProfileReport {
  readonly active: TherapyProfile;
  /** Noms des autres profils enregistrés — tiers-écrits, donc neutralisés. */
  readonly otherProfiles: readonly string[];
  readonly caveats: readonly string[];
}

function toSegments(raw: unknown): readonly Segment[] {
  if (!Array.isArray(raw)) return [];
  const out: Segment[] = [];
  for (const item of raw) {
    const s = item as { time?: unknown; value?: unknown };
    if (typeof s.value !== "number") continue;
    // `time` est une étiquette produite par Nightscout, pas un champ libre écrit
    // par un uploader — mais on la borne quand même : elle est rendue au modèle.
    const from = typeof s.time === "string" ? s.time.slice(0, 5) : "??:??";
    out.push({ from, value: s.value });
  }
  return out;
}

export async function therapyProfile(client: NightscoutClient): Promise<ProfileReport> {
  const docs = await client.read("profile", { limit: 1 });
  const doc = docs[0];
  if (doc === undefined) {
    throw new UpstreamContractError("No profile document on the instance.", "profile");
  }

  const p = doc as {
    defaultProfile?: unknown;
    store?: Record<string, unknown>;
  };
  const name = typeof p.defaultProfile === "string" ? p.defaultProfile : undefined;
  if (!name || typeof p.store !== "object" || p.store === null) {
    throw new UpstreamContractError(
      "Profile has no `defaultProfile` naming an entry of `store`.",
      "defaultProfile",
    );
  }

  const active = p.store[name] as Record<string, unknown> | undefined;
  if (!active) {
    throw new UpstreamContractError("The active profile is missing from `store`.", "store");
  }

  // L'unité vient du même résolveur que partout ailleurs : il échoue bruyamment si
  // le profil se contredit, plutôt que d'en préférer une silencieusement.
  const unit = resolveUnit(doc);

  const caveats: string[] = [
    "Values are time-segmented: each one holds only from its `from` time until the next segment. " +
      "A single figure for basal, ISF or ICR is wrong by construction.",
    "Read-only: this server never writes a profile. These parameters drive dosing calculations.",
  ];

  const storeUnit = normalizeUnit(active["units"]);
  if (storeUnit && storeUnit !== unit) {
    caveats.push(`Profile-level unit is ${unit} but the active store says ${storeUnit}.`);
  }

  // Les noms de profil sont des étiquettes choisies par l'utilisateur et remontées
  // par l'instance : même statut que `device`, donc neutralisés (ADR 0005). Pas
  // d'index ici — la déduplication vise les champs répétés à chaque relevé, et un
  // profil n'apparaît qu'une fois.
  const others = Object.keys(p.store)
    .filter((key) => key !== name)
    .map((key) => asUntrustedField("profileName", key));

  return {
    active: {
      name: asUntrustedField("profileName", name),
      timezone: typeof active["timezone"] === "string" ? active["timezone"] : undefined,
      unit,
      dia: typeof active["dia"] === "number" ? active["dia"] : undefined,
      basal: toSegments(active["basal"]),
      insulinSensitivity: toSegments(active["sens"]),
      carbRatio: toSegments(active["carbratio"]),
      targetLow: toSegments(active["target_low"]),
      targetHigh: toSegments(active["target_high"]),
      caveats,
    },
    otherProfiles: others,
    caveats,
  };
}
