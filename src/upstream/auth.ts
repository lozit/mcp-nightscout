import { logger } from "../security/logger.js";
import { forgetSecret, registerSecret } from "../security/secrets.js";
import { UpstreamContractError, UpstreamError } from "./errors.js";

/**
 * Flux d'authentification v3 (ADR 0002).
 *
 * Le token `readable` est échangé une fois contre un JWT court via
 * `/api/v2/authorization/request/{token}`, puis chaque lecture v3 porte
 * `Authorization: Bearer <jwt>` en en-tête. Le token ne se retrouve donc dans
 * aucune URL de lecture.
 *
 * L'échange est **la seule requête qui porte le token dans son chemin**. C'est
 * pour cette raison que le chemin exposé dans les erreurs est masqué ici, en plus
 * du scrubbing : ne pas y mettre le secret vaut mieux que compter sur le nettoyage.
 *
 * Le JWT ne quitte jamais la mémoire (ADR 0002) : il est ré-obtenable depuis le
 * token, donc le persister ajouterait une seconde copie d'un secret sans gain.
 */

/** Chemin affiché dans les erreurs — jamais celui réellement appelé. */
const EXCHANGE_PATH_FOR_ERRORS = "/api/v2/authorization/request/<token>";

export interface AuthDeps {
  readonly fetch?: typeof globalThis.fetch;
}

export class NightscoutAuth {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof globalThis.fetch;

  /** JWT courant, mémoire seulement. */
  #jwt: string | undefined;
  /**
   * Échange en cours, partagé.
   *
   * Sans cela, N lectures concurrentes qui prennent un 401 déclenchent N
   * échanges : le serveur voit une rafale, et les N-1 JWT obtenus en trop sont
   * enregistrés au scrubbing sans jamais servir.
   */
  #inFlight: Promise<string> | undefined;

  constructor(config: { readonly baseUrl: string; readonly token: string }, deps: AuthDeps = {}) {
    this.#baseUrl = config.baseUrl;
    this.#token = config.token;
    this.#fetch = deps.fetch ?? globalThis.fetch;
  }

  /** JWT courant, en l'échangeant si on n'en a pas encore. */
  async getJwt(): Promise<string> {
    if (this.#jwt) return this.#jwt;
    return this.#exchange();
  }

  /**
   * Force un nouvel échange — à appeler sur un `401` reçu pour une lecture qui
   * fonctionnait auparavant, c'est-à-dire un JWT expiré (ADR 0002).
   */
  async refresh(): Promise<string> {
    return this.#exchange();
  }

  /** Test seam : indique si un JWT est en cache, sans le révéler. */
  get hasJwt(): boolean {
    return this.#jwt !== undefined;
  }

  #exchange(): Promise<string> {
    // Un échange déjà en vol sert tout le monde.
    this.#inFlight ??= this.#doExchange().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async #doExchange(): Promise<string> {
    // Le token vient de notre propre configuration, mais il est interpolé dans un
    // chemin : on l'encode systématiquement. Un `/` ou un `..` dans un secret mal
    // saisi ne doit pas pouvoir déplacer la requête ailleurs.
    const url = `${this.#baseUrl}/api/v2/authorization/request/${encodeURIComponent(this.#token)}`;

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch (cause) {
      // Contrainte #2 : chemin seul, et on ne rattache pas la cause — elle
      // ferait revivre l'URL complète dans la trace rendue.
      logger.debug("token exchange transport failure", cause);
      throw new UpstreamError("Token exchange failed (transport).", EXCHANGE_PATH_FOR_ERRORS);
    }

    if (!response.ok) {
      throw new UpstreamError(
        response.status === 401
          ? "Token exchange refused. The token may be revoked, or not a `readable` subject."
          : "Token exchange failed.",
        EXCHANGE_PATH_FOR_ERRORS,
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new UpstreamContractError("Token exchange returned a non-JSON body.", "<root>");
    }

    const jwt = (body as { token?: unknown } | null)?.token;
    if (typeof jwt !== "string" || jwt.length === 0) {
      // Ne jamais rejouer le corps dans le message : il contient le JWT quand
      // l'échange réussit, et de l'inconnu quand il échoue.
      throw new UpstreamContractError(
        "Token exchange response has no `token` field of type string.",
        "token",
      );
    }

    // Enregistrer le nouveau JWT **avant** de rendre la main, oublier l'ancien :
    // le JWT tourne, donc un enregistrement fait une seule fois au démarrage se
    // périme (docs/LEARNINGS.md).
    registerSecret(jwt);
    if (this.#jwt && this.#jwt !== jwt) forgetSecret(this.#jwt);
    this.#jwt = jwt;

    logger.debug("token exchanged", { jwtLength: jwt.length });
    return jwt;
  }
}
