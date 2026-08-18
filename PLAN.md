<!-- generated-by: groundrules v1.10.0 -->
# PLAN — mcp-nightscout

**Active** plan/todo for the project. Maintained by Claude during work.

This file differs from the long-term roadmap (`docs/ROADMAP.md`): it describes what is happening **now**.

## In progress

- [ ] (nothing yet — pre-code)

## Up next

- [ ] Scaffold the TypeScript project: `package.json`, `tsconfig.json`, **pinned** deps, committed lockfile, lint + test runner. Fill `CLAUDE.md` → Setup/Build/Test in the same change.
- [ ] Implement the config gate first: refuse to boot unless `NIGHTSCOUT_URL` is `https://`; accept a *readable*-role token, never the admin `API_SECRET`.
- [ ] Implement two-level log scrubbing (by value **and** by pattern) **before** the first network call exists — it must be in place the first time an upstream error can be rendered.
- [ ] Implement the Nightscout HTTP client with sanitized exceptions (path only, never the URL).
- [ ] First read tool end-to-end against a real instance, to validate the whole chain before widening.

## Ideas — to triage

- [ ] Decide the free-text neutralization strategy for `notes` (delimit / truncate / strip) — likely deserves its own ADR.
- [ ] Decide whether aggregates are separate tools or parameters on the read tools.

## Waiting / blocked

- [ ] **BLOCKER — no Nightscout instance exists.** Nothing is testable against real payloads until one does. **Time-sensitive**: Nightscout does not backfill, so it only holds history from its own install date — every day of delay is a day of history permanently lost.
- [ ] **API v1 or v3?** Blocked on the instance above. All six surveyed repos use v1 with `?token=` in the query string — the root cause of the token-in-URL and token-in-exception findings. v3 (`/api/v3/`, role/subject model, JWT via `/api/v2/authorization/request/{token}`) would remove the problem at the root rather than scrub it after the fact. **Preferred outcome of the probe.** Record the result as an ADR.

## Recently done

- [x] Frame fixed and published: stdio-only, read-only, TypeScript on the official MCP SDK — [ADR 0001](docs/decisions/0001-language-and-stack.md) (2026-08-18)
- [x] Project bootstrapped (2026-08-18)

---

**Convention**: Claude updates this file at the start/end of each session. Completed tasks stay in "Recently done" for ~1 week then are archived (deleted or moved to CHANGELOG).

**Status vocabulary**: `[ ]` to do · `[~]` delivered, in review / awaiting validation · `[x]` done & validated. Annotate reverts and key commits inline (e.g. `reverted (commit abc123)`) — intermediate states are information, don't erase them.
