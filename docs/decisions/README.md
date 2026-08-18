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
| [0002](0002-nightscout-api-v3.md) | Talk to Nightscout over API v3 | Accepted | 2026-08-18 |
| [0003](0003-dependency-majors.md) | Dependency majors: TypeScript 7, zod 4, @types/node 26 | Accepted | 2026-08-18 |
| [0004](0004-aggregation-method.md) | Méthode d'agrégation glycémique | Accepted | 2026-08-18 |

## Decisions closed by 0001 — reopening requires a new ADR

- **stdio, local only** — no HTTP transport, no listening port.
- **Read-only** — this server never writes to a Nightscout instance.

## Settled by 0002

- **API version: v3**, authenticated by the token→JWT exchange. Decided against the live instance,
  with probe results recorded in the ADR.

## Known open questions awaiting an ADR

- **Free-text neutralization strategy** for `notes` — delimit, truncate, or strip (`docs/SECURITY.md`).
- **Identifier validation under v3** — constraint #4 is written for a Mongo ObjectId
  (`^[0-9a-fA-F]{24}$`), which is a v1 shape. v3 addresses documents by an `identifier` field whose
  guaranteed form has not been probed. Settle it against the instance before the client validates
  anything; do not relax the guard to make a call succeed.
