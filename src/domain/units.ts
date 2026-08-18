import { UpstreamContractError } from "../upstream/errors.js";

/**
 * Résolution des unités glycémiques.
 *
 * `sgv` ne porte aucune unité. Elle vient du profil — et le sondage a trouvé
 * `units` à **deux endroits** : au niveau racine du profil, et dans chaque entrée
 * de `store` (`docs/DATA_MODEL.md`).
 *
 * Les deux concordent sur une instance à profil unique, donc une implémentation
 * naïve qui lit l'un ou l'autre paraît correcte et divergera silencieusement le
 * jour où un second profil existe avec d'autres unités. On lit donc l'entrée
 * **active** et on échoue bruyamment sur désaccord, plutôt que d'en préférer une.
 *
 * L'enjeu : Nightscout stocke en mg/dL et affiche en mmol/L selon ce réglage. Le
 * facteur est ~18. Une moyenne calculée sur la mauvaise hypothèse est fausse d'un
 * facteur 18 et reste un nombre plausible.
 */

export type GlucoseUnit = "mg/dL" | "mmol/L";

/** `mg/dl`, `mgdl`, `mmol`, `mmol/l`… — Nightscout n'est pas régulier là-dessus. */
export function normalizeUnit(raw: unknown): GlucoseUnit | undefined {
  if (typeof raw !== "string") return undefined;
  const v = raw.toLowerCase().replace(/[\s/]/g, "");
  if (v === "mgdl" || v === "mg") return "mg/dL";
  if (v === "mmoll" || v === "mmol") return "mmol/L";
  return undefined;
}

/** Bornes de TIR conventionnelles, exprimées dans l'unité demandée. */
export function targetRange(unit: GlucoseUnit): { readonly low: number; readonly high: number } {
  return unit === "mg/dL" ? { low: 70, high: 180 } : { low: 3.9, high: 10.0 };
}

/** mg/dL → mmol/L. Le facteur exact, pas 18. */
export function toMmol(mgdl: number): number {
  return mgdl / 18.018;
}

interface ProfileDoc {
  readonly defaultProfile?: unknown;
  readonly units?: unknown;
  readonly store?: Record<string, { readonly units?: unknown } | undefined>;
}

/**
 * Unité du profil actif.
 *
 * Échoue plutôt que de deviner : une unité mal résolue ne produit pas une erreur
 * visible plus tard, elle produit un chiffre faux et crédible.
 */
export function resolveUnit(profile: unknown): GlucoseUnit {
  if (typeof profile !== "object" || profile === null) {
    throw new UpstreamContractError("Profile document is not an object.", "<root>");
  }
  const p = profile as ProfileDoc;

  const name = typeof p.defaultProfile === "string" ? p.defaultProfile : undefined;
  if (!name) {
    throw new UpstreamContractError("Profile has no `defaultProfile` naming the active store.", "defaultProfile");
  }

  const active = p.store?.[name];
  if (!active) {
    throw new UpstreamContractError(
      `Profile store has no entry named by \`defaultProfile\`.`,
      "store",
    );
  }

  const storeUnit = normalizeUnit(active.units);
  const topUnit = normalizeUnit(p.units);

  if (!storeUnit && !topUnit) {
    throw new UpstreamContractError("Profile carries no recognizable `units`.", "units");
  }

  // Le désaccord est le cas qui compte. Le taire reviendrait à choisir au hasard
  // lequel des deux chiffres publier.
  if (storeUnit && topUnit && storeUnit !== topUnit) {
    throw new UpstreamContractError(
      `Profile units disagree: active store says ${storeUnit}, profile root says ${topUnit}. ` +
        "Refusing to guess — an aggregate computed on the wrong one is off by ~18x and still looks plausible.",
      "units",
    );
  }

  return storeUnit ?? topUnit ?? "mg/dL";
}
