import type { NightscoutAuth } from "./auth.js";
import { logger } from "../security/logger.js";
import { UpstreamContractError, UpstreamError } from "./errors.js";

/**
 * Client HTTP Nightscout **v3** (ADR 0002).
 *
 * Chaque lecture porte `Authorization: Bearer <jwt>` en en-tête : aucune URL de
 * lecture ne contient de credential. Sur un `401` reçu pour une lecture qui
 * fonctionnait, le JWT est ré-échangé **une seule fois** puis la requête rejouée.
 *
 * C'est le point de passage obligé de toute lecture, donc c'est ici qu'on plafonne
 * le volume (contrainte #5) : un plafond posé dans les outils se contourne en
 * ajoutant un outil.
 */

/** Enveloppe v3, telle que sondée sur l'instance : `{ status, result }`. */
interface V3Envelope {
  readonly status: number;
  readonly result: readonly unknown[];
}

/**
 * Plafond dur, côté serveur, quoi que demande le modèle.
 *
 * `entries` grossit d'environ 288 documents par jour. Ce plafond n'est pas un
 * réglage de confort : sans lui, une seule question mal cadrée fait transiter des
 * dizaines de milliers de relevés vers le contexte du modèle, qui se met alors à
 * faire de l'arithmétique dessus — exactement ce que la contrainte #5 interdit.
 */
export const MAX_LIMIT = 1000;

export interface ClientDeps {
  readonly fetch?: typeof globalThis.fetch;
}

export interface ReadOptions {
  /** Plafonné à `MAX_LIMIT`, silencieusement mais journalisé. */
  readonly limit?: number;
  /** Paramètres v3 supplémentaires (`sort$desc`, `date$gte`, …). */
  readonly params?: Readonly<Record<string, string | number>>;
  /** `fields=_all` par défaut : sans lui v3 ne renvoie qu'un sous-ensemble. */
  readonly fields?: string;
}

export class NightscoutClient {
  readonly #baseUrl: string;
  readonly #auth: NightscoutAuth;
  readonly #fetch: typeof globalThis.fetch;

  constructor(config: { readonly baseUrl: string }, auth: NightscoutAuth, deps: ClientDeps = {}) {
    this.#baseUrl = config.baseUrl;
    this.#auth = auth;
    this.#fetch = deps.fetch ?? globalThis.fetch;
  }

  /**
   * Lit une collection v3 et renvoie `result`.
   *
   * `collection` n'est jamais une donnée d'entrée : les appelants sont des outils
   * qui passent une constante. Le paramètre est malgré tout vérifié, parce que la
   * garantie « ce n'est jamais de l'entrée utilisateur » est vraie aujourd'hui et
   * cesse de l'être dès qu'un outil prend un nom de collection en argument.
   */
  async read(collection: string, options: ReadOptions = {}): Promise<readonly unknown[]> {
    if (!/^[a-z]+$/.test(collection)) {
      throw new UpstreamError(`Invalid collection name.`, "/api/v3/<collection>");
    }

    const path = `/api/v3/${collection}`;
    const requested = options.limit ?? MAX_LIMIT;
    const limit = Math.min(Math.max(1, Math.floor(requested)), MAX_LIMIT);
    if (requested > limit) {
      logger.warn("limit capped server-side", { collection, requested, applied: limit });
    }

    const search = new URLSearchParams({
      limit: String(limit),
      fields: options.fields ?? "_all",
    });
    for (const [k, v] of Object.entries(options.params ?? {})) {
      search.set(k, String(v));
    }

    const body = await this.#getJson(path, search);

    if (!isEnvelope(body)) {
      throw new UpstreamContractError(
        "v3 response is not the expected `{ status, result }` envelope.",
        "<root>",
      );
    }
    return body.result;
  }

  /** GET authentifié, avec un unique ré-échange de JWT sur 401. */
  async #getJson(path: string, search: URLSearchParams): Promise<unknown> {
    let response = await this.#send(path, search, await this.#auth.getJwt());

    if (response.status === 401) {
      // Un JWT expiré ressemble exactement à un token révoqué depuis ici. On tente
      // le ré-échange une fois ; si le second 401 arrive, c'est un vrai refus et
      // insister ne ferait que marteler l'amont.
      logger.debug("401 on a v3 read, re-exchanging the JWT once", { path });
      response = await this.#send(path, search, await this.#auth.refresh());
    }

    if (!response.ok) {
      throw new UpstreamError(
        response.status === 401
          ? "Upstream refused the credential after a fresh exchange."
          : "Upstream read failed.",
        path,
        response.status,
      );
    }

    try {
      return await response.json();
    } catch {
      throw new UpstreamContractError("Upstream returned a non-JSON body.", "<root>");
    }
  }

  async #send(path: string, search: URLSearchParams, jwt: string): Promise<Response> {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}?${search.toString()}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${jwt}` },
      });
    } catch (cause) {
      // Contrainte #2 : chemin seul, pas de cause rattachée — elle ferait revivre
      // l'URL, et l'en-tête, dans la trace rendue.
      logger.debug("v3 read transport failure", cause);
      throw new UpstreamError("Upstream read failed (transport).", path);
    }
  }
}

function isEnvelope(value: unknown): value is V3Envelope {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["status"] === "number" && Array.isArray(v["result"]);
}
