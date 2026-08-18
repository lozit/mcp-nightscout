<!-- generated-by: groundrules v1.10.0 -->
# Roadmap — mcp-nightscout

**Long-term** breakdown into deliverable milestones / increments.

> Distinct from `PLAN.md` (the **active** todo right now): the roadmap describes the trajectory,
> not the current task. Structural decisions go in `docs/decisions/`.

## Condensed vision

~10 read tools and four hand-verifiable aggregates over a personal Nightscout instance, over
stdio, read-only, with the token and the free-text injection surface both handled by design
rather than by patch.

## Milestones

### Milestone 0 — Get an instance running

- **Goal**: unblock everything else.
- **Scope**: stand up a Nightscout instance and start it collecting.
- **Exit criteria**: an instance exists, is reachable over `https://`, and has a *readable*-role
  token issued.
- **Why it was first, and urgent**: nothing was testable against real payloads without it, and
  Nightscout **does not backfill** — it only holds history from its own install date, so every
  day of delay was a day of history permanently lost.
- **Status**: **Shipped** (2026-08-18) — instance en ligne, version 15.0.7, `apiEnabled`,
  lectures anonymes refusées, token `readable` émis.

### Milestone 1 — Decide v1 vs v3

- **Goal**: settle the API version before writing a client against the wrong one.
- **Scope**: probe the live instance. v1 puts the token in the query string — the root cause of
  the token-in-URL and token-in-exception problems. v3 (`/api/v3/`, role/subject model, JWT via
  `/api/v2/authorization/request/{token}`) removes them at the source rather than scrubbing after
  the fact.
- **Exit criteria**: an ADR recording the choice and the evidence behind it.
- **Status**: **Shipped** (2026-08-18) — **v3**, with the probe table as evidence.
  [ADR 0002](decisions/0002-nightscout-api-v3.md).

### Milestone 2 — Safe skeleton

- **Goal**: make the security-critical parts exist *before* the features that need them.
- **Scope**: project scaffold with pinned deps and a committed lockfile · boot gate (https-only,
  reject admin secret) · **v3 token→JWT exchange with in-memory caching and re-exchange on 401** ·
  two-level log scrubbing · sanitized exceptions · id validation.
- **Exit criteria**: a real upstream failure is triggered and the token appears nowhere — not in
  the message, not in the rendered traceback, not on disk. The JWT is never persisted.
- **Status**: **Shipped** (2026-08-18) — 52 tests. Le token ne fuit ni dans un message, ni
  dans une trace rendue, ni sur disque : démontré par diff de comportement, pas seulement par
  couverture unitaire.

### Milestone 3 — First read tool end-to-end

- **Goal**: validate the whole chain on one tool before widening it to ten.
- **Scope**: one read tool, with server-side caps and bounded date ranges, plus free-text
  neutralization applied on the way out.
- **Exit criteria**: it returns correct data from the real instance, hostile text in `notes`
  comes back neutralized, and the volume cap holds regardless of what the model asks for.
- **Status**: **Shipped** (2026-08-18) — `nightscout_recent_glucose` lit l'instance réelle,
  valeurs comparées à la main aux rapports Nightscout. Plafond de volume en place dans le client.
  Réserve assumée : la neutralisation est éprouvée sur `device`, pas sur `notes`, tant que
  `treatments` reste vide.

### Milestone 4 — The tool surface

- **Goal**: reach useful coverage.
- **Scope**: roughly ten read tools across entries, treatments and profile.
- **Exit criteria**: the questions the operator actually asks can be answered without dropping to
  raw data.
- **Status**: Upcoming.

### Milestone 5 — Verified aggregates

- **Goal**: numbers that are right, not merely plausible.
- **Scope**: mean, TIR, CV, GMI — server-side, bounded, deterministic.
- **Exit criteria**: each one **matches Nightscout's own report over the same window, checked by
  hand**. Units resolved from the profile, not assumed.
- **Status**: **Shipped** (2026-08-18). Vérifié à la main sur la journée du 2026-08-17 : moyenne,
  médiane et écart-type concordent à l'arrondi. Les deux écarts subsistants sont des conventions
  d'inclusivité (la valeur 180 en cible, la borne de fin de journée exclusive), chiffrées dans
  [ADR 0004](decisions/0004-aggregation-method.md).

## Out of scope (for now)

- Write tools of any kind, including flagged or "forward-compatible" ones.
- HTTP / remote transport, and the auth and rate-limiting layers it would drag in.
- Advanced clinical analytics (GRI, LBGI/HBGI, AGP, TIR with confidence intervals) — a clinical
  correctness risk, distinct from security and far costlier to validate.
- Multi-user or multi-instance support.
- Packaging and distribution: nothing to release until Milestone 5 holds.
