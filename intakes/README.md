<!-- generated-by: groundrules v1.10.0 -->
# intakes/ — Upstream notes (private)

This folder contains anything written **before** starting the project that provides domain
context: audit notes, scoping material, raw handoffs, external references.

## ⚠️ This folder is gitignored on purpose

`.gitignore` excludes `intakes/`. **This README is the only tracked file in it**, force-added
(`git add -f intakes/README.md`).

The reason is not tidiness. The notes here document **findings in third-party code that have not
been disclosed to their authors**. Publishing them would be an uncoordinated disclosure.

**Therefore:**

- Never `git add -f` anything else in this folder.
- Never quote its contents verbatim into a tracked file.
- Never name a third-party repository as vulnerable in a tracked document.
- The discipline for tracked docs is the one `docs/decisions/0001-language-and-stack.md` already
  follows: findings appear as **abstract rules**, with `§` references pointing back here.

Revisit this if disclosure ever happens. Until then it holds.

## Conventions

- **Read-only**: files here are *inputs*, captured as received — don't edit them to "fix" them;
  synthesize into `docs/` instead.
- **Binaries welcome**: spreadsheets, PDFs, screenshots belong here too — not just Markdown.
- No imposed structure. Prefer explicit names: `2026-05-11-client-call.md` over `notes.md`.
- Anything **synthesized, stable, and publishable** migrates to `docs/`. `intakes/` stays draft
  and private; `docs/` is the public, final version.

## Contents

- `HANDOFF.md` — the founding handoff (2026-08-18): why the evaluated third-party server was
  rejected, the audit findings that became this project's binding constraints, the ecosystem
  survey, and the open blockers. Synthesized into `docs/VISION.md` and
  `docs/decisions/0001-language-and-stack.md`.

## For Claude

If you need domain context at session start and the project docs are insufficient, **read this
folder** — then write what you learned into `docs/`, respecting the disclosure discipline above.
