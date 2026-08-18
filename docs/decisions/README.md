<!-- generated-by: groundrules v1.10.0 -->
# Architecture Decisions (ADR)

This folder contains the project's **Architecture Decision Records**: each structural decision made during the project is recorded in a file.

## Format

Inspired by [Michael Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). See `0000-template.md`.

## Naming convention

`NNNN-title-kebab.md` where NNNN is a 4-digit incremental integer.

## When to create an ADR

When a decision:
- has a **long-term impact** on the architecture
- is **hard to reverse**
- has **explicit tradeoffs** worth documenting
- might be **revisited later** (better to freeze the context now)

No ADR needed for trivial choices or implementation details.

## Disclosure discipline

ADRs in this repository are public. The constraints several of them carry derive from an audit of
third-party code whose findings have **not been disclosed to their author**. So: state findings as
**abstract rules** with `§` references pointing into the gitignored `intakes/`, and never name a
third-party repository as vulnerable. `0001` is the model to follow.

## Index

| # | Title | Status | Date |
|---|---|---|---|
| 0000 | Template | — | — |
| [0001](0001-language-and-stack.md) | Language and stack: TypeScript on the official MCP SDK | Accepted | 2026-08-18 |

## Decisions closed by 0001 — reopening requires a new ADR

- **stdio, local only** — no HTTP transport, no listening port.
- **Read-only** — this server never writes to a Nightscout instance.

## Known open questions awaiting an ADR

- **Nightscout API v1 vs v3** — blocked on having a live instance to probe (`PLAN.md`).
- **Free-text neutralization strategy** for `notes` — delimit, truncate, or strip (`docs/SECURITY.md`).
