/**
 * Neutralisation du texte libre (contrainte #6).
 *
 * Tout champ écrit par un tiers arrive verbatim dans le contexte du modèle. Le cas
 * connu est `treatments.notes` ; `entries.device` a exactement le même statut et,
 * lui, existe déjà dans les données de l'instance (`docs/DATA_MODEL.md`).
 *
 * La lecture seule supprime la **conséquence exploitable** d'une instruction
 * injectée dans ce serveur, pas le **vecteur** : le texte entre quand même dans le
 * contexte, et le modèle dispose d'autres outils.
 *
 * Stratégie arrêtée par [ADR 0005](../../docs/decisions/0005-free-text-neutralization.md).
 * Le point de passage est unique et centralisé exprès : changer de stratégie doit
 * rester un changement d'un seul fichier.
 *
 * Ce que ce module ne fait **pas**, délibérément : chercher à *détecter* des
 * instructions. Filtrer « ignore les instructions précédentes » et consorts est une
 * course perdue — toute liste de motifs se contourne, et le faire donnerait une
 * fausse impression de sûreté. On agit sur ce qui est mesurable : le volume, les
 * caractères de structure, et le fait que ce soit balisé comme non fiable.
 */

/**
 * Au-delà, un champ « libre » n'est plus une étiquette d'appareil ou une note
 * courte : c'est une charge utile. Tronquer borne ce qu'une injection peut dire.
 */
const MAX_LENGTH = 200;

/**
 * Caractères de contrôle (`Cc`) et séparateurs de ligne/paragraphe Unicode
 * (`Zl`, `Zp`). Ce sont eux qui servent à simuler une fin de bloc et à faire
 * passer la suite pour autre chose que de la donnée.
 *
 * Écrit en propriétés Unicode plutôt qu'en plage d'échappements : la classe est
 * lisible, et elle couvre U+2028/U+2029 que les plages ASCII manquent toujours.
 */
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/gu;

/**
 * Caractères de balisage qui laisseraient le texte se faire passer pour de la
 * structure une fois rendu dans le contexte (clôture de bloc, fin de balise).
 */
const STRUCTURE_RE = /[`<>]/g;

export interface NeutralizedText {
  /** Valeur sûre à publier dans un résultat d'outil. */
  readonly value: string;
  /** Vrai si quelque chose a été retiré — utile pour le signaler au modèle. */
  readonly modified: boolean;
}

/**
 * Neutralise un champ texte libre venu de l'amont.
 *
 * Renvoie toujours une chaîne : un champ absent ou d'un type inattendu devient une
 * chaîne vide plutôt qu'un `undefined` qui se faufilerait jusqu'au rendu.
 */
export function neutralize(raw: unknown): NeutralizedText {
  if (typeof raw !== "string" || raw.length === 0) {
    return { value: "", modified: raw !== undefined && raw !== null && raw !== "" };
  }

  let out = raw.replace(CONTROL_RE, " ").replace(STRUCTURE_RE, "");
  out = out.replace(/\s+/g, " ").trim();

  let truncated = false;
  if (out.length > MAX_LENGTH) {
    out = out.slice(0, MAX_LENGTH);
    truncated = true;
  }

  return { value: out, modified: truncated || out !== raw };
}

/**
 * Enveloppe une valeur neutralisée pour le rendu, en la marquant explicitement
 * comme donnée tierce.
 *
 * Le balisage n'est pas une protection en soi — c'est ce qui permet au modèle de
 * *savoir* qu'il regarde une donnée et non une consigne. Il vient après la
 * neutralisation, jamais à sa place.
 */
export function asUntrustedField(name: string, raw: unknown): string {
  const { value, modified } = neutralize(raw);
  const suffix = modified ? " (neutralized)" : "";
  return `[untrusted:${name}${suffix}] ${value}`;
}

/**
 * Collecte les valeurs distinctes d'un champ tiers-écrit et les remplace par un
 * index (ADR 0005 §4).
 *
 * Sur une fenêtre de 24 h, `device` est identique sur les 288 relevés. Le répéter
 * coûte 27 % du poids de chaque relevé — mais surtout, il présente **288 fois** la
 * même surface d'injection au lieu d'une. La répétition est en elle-même un levier :
 * un texte répété des centaines de fois pèse davantage sur un modèle qu'une
 * occurrence unique, quel que soit son contenu.
 *
 * L'index rendu est un entier : il ne peut rien porter.
 */
export class UntrustedFieldIndex {
  readonly #name: string;
  readonly #byValue = new Map<string, number>();
  readonly #values: string[] = [];

  constructor(name: string) {
    this.#name = name;
  }

  /** Index de la valeur, en la neutralisant et en la déduplicant au passage. */
  indexOf(raw: unknown): number {
    const tagged = asUntrustedField(this.#name, raw);
    const known = this.#byValue.get(tagged);
    if (known !== undefined) return known;
    const next = this.#values.length;
    this.#values.push(tagged);
    this.#byValue.set(tagged, next);
    return next;
  }

  /** Valeurs distinctes, neutralisées et balisées, dans l'ordre des index. */
  values(): readonly string[] {
    return this.#values;
  }
}
