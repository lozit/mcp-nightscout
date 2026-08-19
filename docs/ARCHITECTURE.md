<!-- generated-by: groundrules v1.10.0 -->
# Architecture — mcp-nightscout

**Living** snapshot of the current architecture. Updated as the structure evolves.

For the **why** behind choices → see `docs/decisions/`.

> **Status: partly built.** Components marked ✅ exist and are under test. The tool layer,
> the sanitizer and the aggregator do not exist yet — `src/index.ts` has not been written, so
> there is no runnable server. Update each marker in the change that lands the component.

## Overview

A single process, spawned by an MCP host (Claude Desktop / Claude Code) and speaking MCP over
**stdio**. It opens no port and accepts no inbound connection. Its only outbound dependency is
one HTTPS Nightscout instance.

```
MCP host  ──stdio──▶  mcp-nightscout  ──HTTPS──▶  Nightscout instance
(spawns)              (this process)              (upstream, read-only use)
```

Data crosses two trust boundaries, in opposite directions, and each has a mandatory gate:

- **Outbound (us → Nightscout)**: carries the credential. Under v3 the token is exchanged once
  for a JWT and every read is `Authorization: Bearer` **in-header**, so the credential is not in
  the URL to begin with ([ADR 0002](decisions/0002-nightscout-api-v3.md)). Gate = *nothing
  containing the token or the JWT may ever be rendered into a log, an error, or a tool result* —
  now defence-in-depth rather than the primary control.
- **Inbound (Nightscout → model)**: carries text written by third parties. Gate = *no free-text
  field reaches the model without neutralization.*

Most of the design is those two gates.

## Stack

**TypeScript** on the official MCP SDK (`@modelcontextprotocol/sdk`), on the Node runtime the
MCP host spawns. stdio transport only. Small runtime footprint, pinned dependencies, committed
lockfile. Deliberately not the internal Bun/Elysia HTTP stack — see ADR 0001.

## Components

### Config / boot gate

Reads `NIGHTSCOUT_URL` and the credential. **Refuses to start** if the URL is not `https://`,
or if the credential offered is an admin `API_SECRET` rather than a *readable*-role token.
Failing closed at boot is cheaper than defending every call site.

### Logging / scrubbing

Registers the token's literal and URL-encoded forms **at startup**, then scrubs on two levels:
by *value* and by *pattern* (`token=`, `Bearer`, `api-secret:`). Applied both at filter time
**and at format time** — a filter never sees a traceback, which is only rendered during
formatting. This must exist before the first component that can throw.

### Auth / JWT — `src/upstream/auth.ts` ✅

Exchanges the `readable` token for a short-lived JWT via `/api/v2/authorization/request/{token}`,
once, and caches it **in memory only** — the token lives in the keychain, the JWT is never
persisted. Detects expiry as a `401` on a previously-working read and re-exchanges. This is state
the v1 path would not have had; it is the cost of getting the token out of the URL (ADR 0002).

Two details that are not obvious from the description:

- **The exchange is the one request carrying the token in its path**, so the path exposed in its
  errors is masked (`/api/v2/authorization/request/<token>`) *in addition to* being scrubbed.
  Not putting the secret there beats cleaning it afterwards.
- **A single in-flight exchange is shared.** Without it, a burst of concurrent reads all taking a
  401 triggers N exchanges: upstream sees a stampede, and the N-1 surplus JWTs get registered for
  scrubbing without ever being used.

### Nightscout client — `src/upstream/client.ts` ✅

Async HTTPS client against **v3** shapes (envelope and paging differ from v1). Sends
`Authorization: Bearer <jwt>`. Catches upstream errors and re-throws carrying **the path only**,
dropping the cause — an error object can still embed a URL, and the exchange call is the one
request that does carry the token. Validates every identifier it interpolates into a path.

> **Open**: the validation shape. `^[0-9a-fA-F]{24}$` is the v1 Mongo ObjectId; v3 addresses
> documents by an `identifier` field whose guaranteed form is unprobed. Settle it before writing
> the guard — and if a real call fails against it, probe rather than relax it.

### Tool layer — `src/tools/` (2 outils)

`nightscout_recent_glucose` et `nightscout_glucose_summary`. Chaque outil borne sa fenêtre,
s'appuie sur le plafond de volume du client, et aucun n'écrit.

Deux choses que ces outils établissent comme modèle pour les suivants :
- **Ils lisent le profil avant les données.** Sans unité résolue, un chiffre publié n'a pas de
  sens ; mieux vaut un appel de plus qu'une moyenne fausse d'un facteur 18.
- **Ils comptent et signalent ce qu'ils écartent.** `entries` mélange `sgv`, `mbg` et `cal` ;
  filtrer en silence donnerait un décompte inexplicable côté modèle.

### Sanitizer — `src/domain/freetext.ts`

Neutralise le texte libre tiers-écrit en sortie. La lecture seule supprime la *conséquence*
exploitable d'une instruction injectée, pas le *vecteur* — c'est ce composant qui traite le
vecteur.

Appliqué à `entries.device`, qui a le même statut que `notes` et présente l'avantage d'exister
dans les données réelles. Stratégie arrêtée par
[ADR 0005](decisions/0005-free-text-neutralization.md) : contrôles et séparateurs Unicode
normalisés, caractères de structure retirés, troncature à 200 caractères, balisage
`[untrusted:<champ>]` — et **déduplication**, les valeurs distinctes étant publiées une fois par
réponse et référencées par index entier. Sur 24 h, la même charge utile potentielle apparaissait
288 fois ; elle apparaît une fois.

Ce qu'il ne fait **pas**, délibérément : détecter des instructions. Toute liste de motifs se
contourne, et en livrer une échangerait une borne réelle contre une fausse assurance.

### Aggregator — `src/domain/aggregates.ts`

Computes mean, median, SD, CV, GMI and the consensus bands **server-side and deterministically**,
en mg/dL, converti seulement en sortie ([ADR 0004](decisions/0004-aggregation-method.md)). Its purpose is volume
reduction, not intelligence: the model must never do arithmetic over thousands of readings.

## Main flows

1. **Boot** — validate URL scheme and credential kind → register scrub values → connect stdio.
   Any failure here is fatal and silent about the secret.
2. **Read** — tool call → argument validation (ids, bounds, caps) → HTTPS GET → sanitize free
   text → return.
3. **Aggregate** — same as read, then deterministic reduction; only the aggregate crosses to
   the model.
4. **Error** — upstream failure → catch → re-throw with path only → scrubbed at render.

## Environments

- **Local**: the only one. Spawned over stdio by the MCP host.
- **Staging / Production**: none, and none planned. Not deployed anywhere.

## Points of attention

- **The instance is live and the API version is settled (v3)** — but only `status` and a
  one-row `entries` read have actually been exercised. Every payload shape below that is still
  unvalidated.
- **JWT lifetime is unmeasured** — the re-exchange path (401 on a previously-working read) is
  the least-tested branch by nature, and the one that fails at 3am. Give it a deliberate test.
- **Identifier validation shape is unresolved under v3** — see the client component above.
- **La neutralisation n'est éprouvée que sur `device`.** Le contrat ne changera pas pour `notes`,
  mais la longueur typique des valeurs, si — re-vérifier le jour où `treatments` porte des données.
- **Correct-looking aggregates are the quiet risk** — they must be checked by hand against
  Nightscout's reports, not merely reviewed.
