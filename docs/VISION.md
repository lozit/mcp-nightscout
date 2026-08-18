<!-- generated-by: groundrules v1.10.0 -->
# Vision — mcp-nightscout

> Synthesis of the project intent. Source: `intakes/HANDOFF.md` (file — gitignored, not copied here), cross-read with `README.md` and `docs/decisions/0001-language-and-stack.md`. Update when intent evolves (rare; tactical decisions go in `docs/decisions/`).

## Goal

Give an AI assistant **read-only** access to a personal Nightscout instance, so its owner can
discuss their own glucose data with it — without ever handing that assistant the ability to
alter the instance.

Success looks like: roughly **ten read tools** and a small set of **verifiable aggregates**
(mean, time in range, coefficient of variation, GMI), computed **server-side and
deterministically**, whose numbers match Nightscout's own reports when checked by hand. Not
feature parity with anything.

The project is written **from scratch** against an explicit threat model. That threat model is
**treatment alteration, not data leakage**: Nightscout profiles carry basal, ISF, ICR and DIA —
the parameters that drive dosing calculations in a closed-loop setup. A server that can write
those is a server that can change what a pump delivers.

## Users / personas

- **Primary — the instance owner.** Someone running their own Nightscout who wants to ask
  questions of their data conversationally. Solo use; the operator, the data subject and the
  developer are the same person.
- **Implicitly in scope — anyone with write access to that instance.** Uploaders, phone apps
  and third-party integrations write into it. They are not users of this server, but their
  input reaches the model through it, which makes them part of the threat model rather than
  part of the audience.

## Constraints

**Closed by design** — reopening either requires a new ADR:

- **stdio, local only.** No HTTP transport, no listening port. This is not cosmetic: it deletes
  an entire class of vulnerabilities (fail-open auth, token in request URLs, non-constant-time
  token comparison, DNS rebinding, missing rate limiting) without writing a line of code.
- **Read-only.** This server will never write to a Nightscout instance.

**Binding implementation constraints** — the full statement, with references into the private
audit notes, lives in [ADR 0001](decisions/0001-language-and-stack.md):

1. Pinned dependencies, committed lockfile.
2. Sanitized exceptions — re-raise with the path only; the URL carries the token.
3. Two-level log scrubbing (by value *and* by pattern), applied where the traceback is
   **rendered**, not only where records are filtered.
4. Every identifier interpolated into a URL is validated.
5. Aggregation is server-side, bounded and deterministic.
6. Free-text fields are neutralized before entering tool results.
7. `NIGHTSCOUT_URL` must be `https://` — refuse to start otherwise.

**Stack**: TypeScript on the official MCP SDK, on the Node runtime the MCP host spawns.

**Instance**: live since 2026-08-18 (version 15.0.7), reached over **API v3** with a `readable`
token exchanged for a short-lived JWT — the token never enters a data-fetch URL
([ADR 0002](decisions/0002-nightscout-api-v3.md)). This removes the project's founding blocker;
history now accumulates from that date, and no earlier (Nightscout does not backfill).

**Disclosure constraint**: the audit that produced the constraints above documents findings in
third-party code that have **not been disclosed to their author**. The notes stay in the
gitignored `intakes/`. Tracked documents carry the findings as **abstract rules** with `§`
references, and never name a third-party repository as vulnerable.

## Out of scope for V1 (non-goals)

- **Any write tool**, of any kind — including "opt-in", "behind a flag", or "forward
  compatible". A read-only flag that exists in config but is not yet enforced is not a
  guarantee; treat that pattern as a known anti-pattern, not a model.
- **HTTP or remote transport**, and therefore any auth layer, rate limiter or origin check.
- **Advanced clinical analytics** — GRI, LBGI/HBGI, AGP, TIR with confidence intervals. These
  are a *clinical correctness* risk, which is a different and far more expensive risk to
  validate than a security one. V1 stays with metrics that can be checked by hand against
  Nightscout's own reports.
- **Model-side arithmetic over raw readings.** Tempting and wrong: over thousands of points,
  LLM arithmetic drifts silently. Server-side aggregation exists to reduce volume
  deterministically, not to be clever.
- **Multi-user or multi-instance support.**
- **Being a Nightscout replacement.** This is a client.

## V1 acceptance criteria

> **État au 2026-08-18** — 1 ✅ · 2 ✅ · 3 ✅ (unitaire ; aucun outil ne prend encore d'identifiant)
> · 4 ⚠️ partiel (éprouvé sur `device`, `notes` inaccessible) · **5 ✅ vérifié à la main contre le
> rapport Distribution de Nightscout, journée du 2026-08-17 : moyenne, médiane et écart-type
> concordent à l'arrondi ; les deux écarts restants sont des conventions d'inclusivité, chiffrées
> et documentées ([ADR 0004](decisions/0004-aggregation-method.md))** · 6 ✅ · 7 ✅ · 8 ✅

1. The server refuses to start on a non-`https://` URL, and on an admin-secret credential.
2. A real upstream HTTP failure is triggered and the token appears **nowhere** — not in the
   exception message, not in the rendered traceback, not on disk.
3. An identifier that is not a valid Mongo ObjectId is rejected before any URL is built.
4. A treatment carrying hostile text in `notes` reaches the model **neutralized**, and the
   handling is documented in `docs/SECURITY.md`.
5. Mean, TIR, CV and GMI over a chosen window **match Nightscout's own report**, verified by
   hand — not merely plausible.
6. Requested volume is capped server-side and date ranges are bounded, regardless of what the
   model asks for.
7. Dependencies are pinned and the lockfile is committed.
8. The whole thing runs over stdio from a stock MCP host with no listening port opened.

---

Further reading:
- `intakes/` — raw upstream notes (**gitignored**; private audit material)
- `docs/decisions/` — structural decisions made during the project
- `docs/LEARNINGS.md` — non-trivial learnings
- `docs/ARCHITECTURE.md` — architecture snapshot
- `docs/SECURITY.md` — threat model and controls
