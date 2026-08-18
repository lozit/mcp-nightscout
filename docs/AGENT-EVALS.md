<!-- generated-by: groundrules v1.10.0 -->
# Agent evals — mcp-nightscout

> A log of the **agent's own** observed failure modes on this project — recurring mistakes,
> hallucinations, drifts — and the guard added for each. Reverse-chronological (newest at
> the top). This is **meta**: it's about how the agent behaves *here*, not about the
> project's domain.

**How this differs from `docs/LEARNINGS.md`**: LEARNINGS captures rules about the *project*
(domain gotchas, stack pitfalls, conventions). AGENT-EVALS captures patterns about the
*agent* (what it gets wrong on this repo, and the rule/guard that should stop it). An eval
entry usually produces a fix in `CLAUDE.md` or `.claude/rules/` — link it.

**When to add an entry**: when the agent repeats a mistake, fabricates a fact/API, drifts
from an instruction, or you catch a hallucination. Capture it at the next checkpoint
(see `CLAUDE.md` → "Capture at checkpoints" — typically before a push/release).

**Failure modes to watch for on this repo specifically** — no occurrence logged yet, these are
predictions from the project's shape, to be confirmed or deleted:

- **Inventing Nightscout field names.** `docs/DATA_MODEL.md` is written from documentation, not
  from a live instance, and v1/v3 differ. An agent filling a gap plausibly is the expected
  failure. Guard: no field name enters code without a real payload or the API reference open.
- **Quietly reintroducing a write path.** "Just a `PUT` for convenience", "behind a flag",
  "forward compatibility". The closed decision is in `CLAUDE.md` and ADR 0001.
- **Letting the token into an error path.** The failure is invisible in review — it only shows
  when an upstream call actually fails and a traceback is *rendered*.
- **Leaking audit material into tracked files.** Quoting `intakes/` verbatim, or naming a
  third-party repo as vulnerable in a tracked doc.
- **Confident arithmetic.** Computing or "sanity-checking" an aggregate in-context instead of
  deferring to the server-side implementation, and mixing mg/dL with mmol/L while doing it.

---

<!-- Example entry format:

## YYYY-MM-DD — Invents config keys that don't exist

**Observed**: proposed `app.config.ts` keys (`retryBudget`, `edgeRegion`) that aren't in the
schema — twice in one session.
**Trigger**: asked to "tune performance config" without being pointed at the schema file.
**Guard added**: `CLAUDE.md` now says "never propose a config key without first reading
`src/config/schema.ts`; if unsure, say so."
**Status**: watching — re-evaluate after a few sessions.

-->
