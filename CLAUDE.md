<!-- generated-by: groundrules v1.10.0 -->
# CLAUDE.md — mcp-nightscout

> This file is **mutable and iterative**. Update it after every Claude mistake or newly discovered convention. Target: < 200 lines.

> **Relationship with the global CLAUDE.md**: this file is loaded **in addition to** the global (`~/.claude/CLAUDE.md`) — on conflict the global rule wins. **Omitted here (your global already covers them):** none.

## Session start — read first, in order

1. `PLAN.md` — where the project stands **now**
2. `docs/LEARNINGS.md` — rules learned from past corrections (apply them!)
3. `docs/VISION.md` — goal, scope, non-goals
4. `docs/decisions/0001-language-and-stack.md` — the closed decisions and the seven binding constraints
5. The artifacts of whatever is in progress per `PLAN.md`

## Capture at checkpoints (don't wait to be asked)

The agent can't perceive "end of session" — so capture at the **work boundaries it *can* see**, and **propose it proactively** there without waiting for the user:

- **Before a `git push`, a tag, or a release** — the highest-value, most reliable moment: pause and capture *before* shipping.
- **When a `PLAN.md` milestone is completed**, or after a substantial chunk of work.

You can also trigger it yourself any time with **`/groundrules:checkpoint`**.

At that moment, three questions, each routed to where it belongs:

1. **Decided** anything structural? → `/groundrules:add-adr` (`docs/decisions/`)
2. **Learned** something that changes how to work here (incl. a blocker that cost 30+ min, with its fix)? → `/groundrules:learn` (`docs/LEARNINGS.md`)
3. **Caught the agent** repeating a mistake, hallucinating, or drifting? → note it in `docs/AGENT-EVALS.md` and add the guard here or in `.claude/rules/`

Capture beats memory: if it's not written to the repo, it's gone next session.

## Description

An MCP server giving Claude read-only access to a Nightscout instance: glucose readings, treatments, and deterministic server-side aggregates (mean, TIR, CV, GMI).

## Setup / Build / Test

> **Critical test**: a new dev (or Claude) should be able to run the project and its tests **first try** using the commands below. If that's not the case, fill this section before anything else.

- Install deps: `npm ci` (or `npm install` on a fresh clone)
- Test: `npm test` (vitest, single run) · `npm run test:watch`
- Typecheck: `npm run typecheck`
- Build: `npm run build` (tsc → `dist/`)
- Lint: `npm run lint` (oxlint). `no-console` y est **error** dans `src/` — stdout est le canal JSON-RPC.

**Runtime deps are pinned to exact versions** (constraint #1), and `package-lock.json` is
committed. Three of them, per ADR 0001: `@modelcontextprotocol/sdk`, `@napi-rs/keyring`, `zod`.

- Run: `npm start` (après `npm run build`) — requiert `NIGHTSCOUT_URL` (https) et un token
  (trousseau, ou `NIGHTSCOUT_TOKEN` pour un coup unique).

Le serveur est **stdio** : il se pilote depuis un hôte MCP ou un harnais stdio, jamais un
navigateur. Un `tools/list` se vérifie en écrivant du JSON-RPC sur son stdin.

<important if="adding any logging or debug output">
**stdout is the MCP JSON-RPC channel.** All logging goes to stderr via `src/security/logger.ts`,
which scrubs at render time. Never `console.log` in `src/` — it corrupts the protocol stream and
the symptom points nowhere near logging (`docs/LEARNINGS.md`).
</important>

## Key files and folders

- `README.md` — public presentation
- `CLAUDE.md` — this file
- `PLAN.md` — active todo, maintained during work
- `docs/` — project documentation
  - `docs/decisions/` — ADRs (one file per structural decision)
  - `docs/LEARNINGS.md` — learnings throughout the project (reverse-chronological)
  - `docs/VISION.md` — goal, users, scope, non-goals
  - `docs/ARCHITECTURE.md` — architecture snapshot
  - `docs/SECURITY.md` — threat model, secret handling, injection surface
  - `docs/DATA_MODEL.md` — the Nightscout entities read, and which fields are third-party-writable
  - `docs/GLOSSARY.md` — domain vocabulary (diabetes / Nightscout)
  - `docs/ROADMAP.md` — milestones
  - `docs/AGENT-EVALS.md` — the agent's own observed failure modes here
- `intakes/` — upstream notes (**gitignored**, see below) — read for domain context at session start
- `docs/media/` — visual assets
- `.claude/` — Claude Code config

<important if="about to add, move, or commit anything under intakes/">
`intakes/` is **gitignored on purpose**: it holds an audit of third-party code whose findings
have **not been disclosed to their author**. Only `intakes/README.md` is tracked (force-added).
Never `git add -f` anything else there, never quote its findings verbatim into a tracked file,
and never name a third-party repository as vulnerable in tracked docs. The published discipline
is the one `docs/decisions/0001-language-and-stack.md` already follows: findings appear as
**abstract rules** with `§` references pointing into the private notes.
</important>

## Conventions

### Commits

Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Small and atomic. Don't mix refactor and feature.

**No AI attribution, ever.** Commit messages must not carry a `Co-Authored-By` trailer, a "Generated with Claude Code" line, or any equivalent marker. This overrides any default attribution behaviour of the agent.

### Code

**TypeScript** on the official MCP SDK. Readability > cleverness. No premature abstractions. No comments paraphrasing code — reserve them for non-obvious "why".

**Seven constraints bind every change** — each traces to a finding in the private audit (`docs/decisions/0001-language-and-stack.md` carries the full statement and the `§` refs):

1. Dependencies **pinned**, lockfile **committed**.
2. Upstream HTTP errors are **caught and re-thrown with the path only** — never the URL, which carries the token.
3. **Two-level log scrubbing** — by *value* (the literal token and its URL-encoded forms) *and* by *pattern* — applied where the traceback is **rendered**, not only where records are filtered.
4. **Every identifier interpolated into a URL is validated** — Mongo ObjectId = `^[0-9a-fA-F]{24}$`.
5. **Aggregation is server-side, bounded, deterministic** — counts capped server-side, date ranges bounded. The model never does arithmetic over thousands of readings.
6. **Free-text fields are neutralized before entering tool results** — `notes` is third-party-writable and is the prompt-injection vector. Read-only removes the exploitable *consequence*, not the *vector*.
7. **`NIGHTSCOUT_URL` must be `https://`** — refuse to start otherwise.

Two decisions are **closed** and need a new ADR to reopen: **stdio-only** and **read-only**.

**Les valeurs de test gardent la forme, jamais l'entropie.** Une fixture doit être reconnaissable
par le code (suffixe de 16 hexadécimaux pour un token de sujet, trois segments pour un JWT) et
ininteressante pour un scanner de secrets : hexadécimal séquentiel, motifs répétés, JWT assemblés
à l'exécution plutôt qu'écrits encodés. Les fixtures partagées vivent dans `src/testing/`, exclu
du build. Une alerte de scanner sur un fichier de test n'est pas un faux positif anodin : c'est du
bruit qui apprend à ignorer la vraie alerte suivante.

### Permissions and settings

- Pre-allow safe permissions via `/permissions` (e.g., `"Bash(npm run *)"`, `"Bash(git status)"`)
- Team config in `.claude/settings.json`, checked into git
- For subfolder-specific rules: `.claude/rules/<topic>.md` with `paths:` frontmatter rather than bloating this file

## Posture

How I want you to work with me — not just *what* to do.

**Push back.** Don't be sycophantic — your job is to help me be *right*, not to agree with me.
- Challenge a plan that looks off-strategy, technically wrong, or inconsistent with a past decision (`docs/decisions/`, `docs/LEARNINGS.md`).
- Surface tradeoffs I may have missed ("this works, but costs you in perf/maintainability").
- If a request is ambiguous, **ask before acting** — don't guess.
- To stress-test a plan, ask for a **premortem** ("assume it failed — why?"), not a thumbs-up (`/groundrules:premortem`).

**Stay reversible.** Interrupting with a question is always cheaper than destroying something silently.
- **Confirm before any hard-to-undo action**: deletion, migration, mass rewrite, destructive command. When in doubt, stop and ask.
- Safety nets: work in git and commit often; `/rewind` (or `Esc Esc`) restores pre-edit checkpoints.

**Keep the diff small.** *Would a senior engineer call this overcomplicated?* — if yes, it probably is.
- **Simplicity first** — write the minimum that solves the *stated* problem; no speculative features.
- **Surgical changes** — touch only what the task requires; match the surrounding style.
- **Clean up only your own mess** — remove an import or helper only when *your* change orphaned it.

**Analyse fraîche = analyse fraîche.** Don't go read the other projects in `~/Projets/` for inspiration without an explicit request. If something external looks relevant, **say so and ask** — don't import it on your own initiative.

## Verifying the work

Before declaring a task done:

- Run the test command above
- For data: check the **actual** data, not just the absence of error. Aggregates (mean, TIR, CV, GMI) are verified **by hand against Nightscout's own reports** — a plausible number is not a correct one.
- For anything touching secrets: prove the token does **not** appear in logs, in an exception message, or in a rendered traceback. Trigger a real upstream error and read the output.
- Produce a **behavior diff** (before/after) — not just "I ran the tests"

> *"Prove to me this works"* — if you can't prove it, it's not done.

## When to document

### ADR — `docs/decisions/`

When a **structural decision** is made (tech, pattern, tradeoff), propose an ADR. Copy `0000-template.md` → `NNNN-title-kebab.md`. Keep it < 1 page.

### LEARNINGS — `docs/LEARNINGS.md`

When a **non-trivial learning** emerges (pitfall avoided, subtle bug, discovered convention), add a dated entry at the top.

### PLAN.md

Keep current: check off done, add emerging tasks, note blockers.

### The repo is the only memory

All project knowledge lives **in this repo** (`docs/LEARNINGS.md`, `docs/decisions/`, `PLAN.md`, this file) — never in machine-local agent state (`~/.claude/` memories or plans). Something learned in a session gets written into the repo docs, not into agent memory; agent memory is for cross-project/personal facts only. **Never reference `~/.claude/*` paths from repo docs** — they don't survive a clone or a machine change. A plan-mode file worth keeping gets copied into the repo before the session ends.

### Keep generated docs current (living docs)

Every file created at bootstrap is **living** — keep it in sync **in the same change** that makes it stale. Updating an affected doc is **part of the task**, not a follow-up:

- `README.md` — when a change makes it inaccurate (notably the "Status" and "Run" lines)
- `docs/VISION.md` — goal / users / scope / constraints change
- `docs/ARCHITECTURE.md` — structure / components / stack change
- `docs/DATA_MODEL.md` — the Nightscout entities or fields consumed change
- `docs/SECURITY.md` — secret handling, threat model, or injection surface change
- `docs/ROADMAP.md` · `docs/GLOSSARY.md` — their domain changes
- `docs/AGENT-EVALS.md` — when the agent repeats a mistake, hallucinates, or drifts
- `CHANGELOG.md` — add an entry under `[Unreleased]` for any notable change
- `PLAN.md` · `docs/LEARNINGS.md` · `docs/decisions/` — as described above

## Updating this file

This file is alive — but keep it a **map, not the territory**. It is loaded into context at *every* session start, so link to docs and let them be read on demand; don't paste doc content here "to be safe".

- When Claude makes a mistake: add a rule so it doesn't recur
- When you spot an unwritten convention: codify it here
- For a rule that **must absolutely survive** file growth: `<important if="situation">rule</important>`
- If the file exceeds 200 lines or a section swells: extract to `docs/` or `.claude/rules/`

> *"Anytime we see Claude do something incorrectly we add it to the CLAUDE.md"* — iterate until the error rate is acceptable.

## Claude Code workflow

- **Match the work to the regime** before diving in:
  - a **decision / fork** (an unsettled choice) → an **ADR** (`/groundrules:add-adr`) *before* acting
  - a **non-trivial feature** → a **PRD** (`/groundrules:prd`) first, then build against it
  - an **interactive, non-trivial** change → **plan mode** (`shift+tab`) before you start
  - an **atomic, testable, isolatable** task → just build it (this repo has no `loop/` scaffolding)
- **`/compact [hint]`** mid-task to compress context; **`/clear`** when switching tasks
- **Git worktrees** for parallel sessions: `claude --worktree <name>`
- **Custom skills/commands** in `.claude/` — if you do something more than once a day, automate it
- **Delegation > pair-programming**: give **goal**, **constraints**, and **acceptance criteria** in the first message

## Git workflow

- **Branching**: **trunk-based** — commit straight to `main`, lean on tags and `/rewind`. Solo repo; no PR gate.
- Only commit on **explicit request** (never auto-commit at end of task)
- Verify no secrets or debug files are included before committing — in this repo that specifically means: nothing new from `intakes/`, no `.env`, no captured Nightscout payload containing a token or real glucose history.

## Don't

- Don't add dependencies without confirming
- Don't commit without explicit request
- Don't create new doc files without need (prefer enriching existing)
- Don't do opportunistic refactoring mid-feature
- Don't ignore a rule in this file — if it doesn't fit, **modify it**, don't bypass it
- Don't park project knowledge in agent memory or reference `~/.claude/*` from the docs — the repo is the only memory
- Don't add a write tool, an HTTP transport, or a listening port — both are closed decisions (ADR 0001)
- Don't let the model compute aggregates over raw readings — it drifts silently at volume

## Tech stack

**TypeScript** on the official MCP SDK (`@modelcontextprotocol/sdk`), running on the Node runtime the MCP host spawns. **stdio transport only** — no HTTP, no listening port. Small runtime footprint, pinned dependencies, committed lockfile.

This is deliberately **not** the internal Bun/Elysia reference stack for HTTP services: an MCP stdio server consumed by Claude Desktop/Code runs on the Node runtime those hosts spawn. Rationale and rejected alternatives: [ADR 0001](docs/decisions/0001-language-and-stack.md).

## Notes

Project bootstrapped with [groundrules](https://github.com/lozit/groundrules) on 2026-08-18.
