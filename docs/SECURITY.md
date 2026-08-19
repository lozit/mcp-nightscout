<!-- generated-by: groundrules v1.10.0 -->
# Security & Compliance — mcp-nightscout

**Living** document of security and privacy choices.

For the **why** behind structural decisions → see [ADR 0001](decisions/0001-language-and-stack.md).

> **Status: intended, not built.** Every control below is a requirement, not a description of
> shipped code. Turn each into a statement of fact as it lands.

## Threat model

The risk here is **treatment alteration, not data leakage**. A Nightscout profile holds basal,
ISF, ICR and DIA — the parameters a closed-loop system uses to compute insulin doses. A server
able to write those is a server able to change what a pump delivers. Confidentiality of glucose
history matters, but it is the second-order concern.

Two decisions follow from that and are **closed** (a new ADR is required to reopen either):

| Decision | Effect on the threat model |
|---|---|
| **stdio, local only** | No port, no inbound connection. Deletes fail-open auth, tokens in request URLs, non-constant-time comparison, DNS rebinding and missing rate limiting as concerns — structurally, not by mitigation. |
| **Read-only** | No tool can alter the instance. Removes the exploitable consequence of a successful prompt injection. |

## Authentication

- **Inbound**: none, and none needed — there is no inbound. The MCP host spawns the process; the
  OS process boundary is the perimeter.
- **Upstream (to Nightscout)**: a *readable*-role token. The admin `API_SECRET` must be
  **refused at boot** — accepting it would grant write capability the design promises not to have.

## Authorization / access control

Single user, single instance, read-only. No role model. The only access decision is the boot
gate: right kind of credential, right URL scheme, or the process does not start.

## Personal data (privacy)

- **Collected**: none by this server. It stores nothing and persists nothing.
- **Processed in transit**: continuous glucose readings, treatments (including insulin doses and
  carbs) and profile settings — health data about a single person, the operator themselves.
- **Retention**: zero. No cache, no database, no state file. Anything read is returned and
  dropped.
- **Where it ends up**: the MCP host's model context. That is a deliberate, informed choice by
  the operator, who is also the data subject. This is the main privacy consequence of the
  project and should stay stated plainly rather than buried.
- **Logs**: must never contain glucose values or treatment payloads at default verbosity, and
  must never contain the token at any verbosity.

## Secrets and configuration

- `NIGHTSCOUT_URL` — **must** be `https://`; the process refuses to start otherwise. A silent
  `http://` would send the secret in clear.
- The token — supplied by environment or keychain; never committed, never logged, never
  returned in a tool result or an error.
- **The token leaves data-fetch URLs entirely under API v3** ([ADR 0002](decisions/0002-nightscout-api-v3.md)):
  it is exchanged once for a JWT via `/api/v2/authorization/request/{token}`, and every read
  carries `Authorization: Bearer <jwt>` in a header. The scrubbing and exception-sanitizing below
  therefore protect against the token appearing where it should not — they are defence-in-depth,
  not the primary control, which is that the token is not in the URL to begin with.
- **Two-level scrubbing is mandatory**: by *value* (the literal token and its URL-encoded forms,
  registered at startup) **and** by *pattern* (`token=`, `Bearer`, `api-secret:`), applied at
  **format** time as well as filter time — a `logging.Filter`-equivalent never sees the
  traceback, which is only rendered when formatted. This is precisely what stops an upstream
  HTTP error from writing the token to disk.
- **Exceptions are sanitized**: catch upstream errors, re-throw with the **path only**, and drop
  the cause — the original error object embeds the full URL, query string included.
- **Measured 2026-08-18**: the readable token is **27 characters**, the exchanged JWT **187**. A
  length-thresholded pattern (the common `{32,}` form used by the house redactor in
  `mcp-standardnotes`) **does not match the token** — which is the concrete reason the *by value*
  half of the rule above is mandatory and not belt-and-braces. The JWT must be re-registered on
  every exchange, since it rotates. See `docs/LEARNINGS.md`.
- **stdout is the MCP protocol channel** — all logging goes to `stderr`. A stray `console.log`
  corrupts the JSON-RPC stream.
- `.env` is gitignored. `intakes/` is gitignored (see below).

## Attack surface and controls

| Surface | Control |
|---|---|
| **Free-text fields from the instance** (`notes` above all) | Third-party-writable by any uploader or integration with write access, and reaching the model verbatim by default. This is the **prompt-injection vector**. Read-only removes the exploitable consequence, not the vector. Strategy settled by [ADR 0005](decisions/0005-free-text-neutralization.md): control characters and Unicode line separators normalized, structure characters stripped, truncated at 200, tagged `[untrusted:…]`, and **deduplicated** — distinct values published once per response and referenced by integer index, so a hostile payload appears once rather than 288 times over 24 h. No attempt is made to *detect* instructions. |
| **Identifiers interpolated into URLs** | Validated before use — Mongo ObjectId = `^[0-9a-fA-F]{24}$`. HTTP clients normalize `..` segments per RFC 3986, so an unvalidated id turns a scoped request into an arbitrary one against any collection. |
| **Volume requested by the model** | Capped server-side; date ranges bounded. Never left to the model's choice. |
| **Transport** | HTTPS enforced at boot. No inbound transport exists. |
| **Dependencies** | Pinned, with a committed lockfile. |

## Disclosure

The constraints above derive from an audit of a third-party Nightscout MCP server. **Those
findings have not been disclosed to their author.** Consequently:

- The audit notes live in `intakes/`, which is **gitignored**. Only `intakes/README.md` is tracked.
- Tracked documents state the findings as **abstract rules** with `§` references into the private
  notes, and **never name a third-party repository as vulnerable**.
- Revisit this if and when disclosure happens; until then the discipline holds.

## Incidents survenus

### 2026-08-18 — token exposé dans un transcript

Le token `readable` a été fourni en clair sur une ligne de commande lors du premier test contre
l'instance, ce qui l'a inscrit dans un transcript de conversation et dans l'historique du shell.

- **Impact** : lecture seule des données de l'instance par quiconque disposait du transcript.
  Aucune capacité d'écriture — le sujet était bien `readable`, ce qui est précisément la raison
  pour laquelle la décision « lecture seule » (ADR 0001) porte ses fruits ici.
- **Traitement** : révocation du sujet dans Admin Tools et recréation d'un nouveau token.
- **Voie d'évasion** : la variable d'environnement était le seul moyen praticable de fournir le
  token — `src/credentials.ts` savait lire le trousseau mais rien ne savait y écrire.
- **Contrôle ajouté** : `mcp-nightscout-login` (`npm run login`), saisie masquée, écriture
  directe dans le trousseau. Le serveur démarre ensuite sans `NIGHTSCOUT_TOKEN`.
  Voir `docs/LEARNINGS.md`.

## Incident procedure

If the upstream token is exposed (committed, logged, or leaked into a transcript): revoke it in
Nightscout first, then rotate, then find how it escaped and add the control that would have
stopped it. Record the escape route in `docs/LEARNINGS.md` — the mechanism matters more than the
incident.
