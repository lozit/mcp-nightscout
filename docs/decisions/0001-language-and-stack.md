# 0001 — Language and stack: TypeScript on the official MCP SDK

- **Status**: Accepted
- **Date**: 2026-08-18

## Context

An internal audit handoff (kept in `intakes/`, not published — it documents
undisclosed findings in a third-party server) fixes the frame: written from
scratch, stdio-only, read-only, and a list of pitfalls extracted from auditing
an existing Nightscout MCP server. The stack was the one open item. Candidates
were the three Tier 1 MCP SDKs that fit a personal tool: TypeScript, Python, Go.

## Decision

**TypeScript, modeled on `mcp-freestyle`** — the closest sibling: health data,
an upstream cloud API, stdio, a keychain-stored secret, and a 3-dependency
runtime footprint (`@modelcontextprotocol/sdk`, a keyring binding, `zod`).

Why not the others, in one line each:

- **Python** — its draw was `ColebyPearson/nightscout-mcp` (MIT), whose two-level
  log scrubbing the audit flags as the best implementation among the repos
  reviewed. The *pattern* ports in an afternoon; a whole toolchain added for one
  pattern does not pay.
- **Go** — a single static binary would kill the LaunchAgent/PATH failure class,
  but that pain is already paid and documented fleet-wide; a third language for
  one ~10-tool server is the wrong level to fix it at.

This is **not** the internal Bun/Elysia reference stack for HTTP services: an
MCP stdio server consumed by Claude Desktop/Code runs on the Node runtime those
hosts spawn.

## Constraints carried in from the audit (language-independent)

These bind the implementation regardless of the paragraph above; each traces to
a finding in the internal audit (§ references point into `intakes/`):

1. **Pinned dependencies and a committed lockfile** (finding §2.10).
2. **Exception sanitization**: catch upstream HTTP errors, re-throw with the
   path only — never the URL, which carries the token (§2.5).
3. **Two-level log scrubbing** — by value (the literal token and its URL-encoded
   forms) *and* by pattern, applied where the traceback is rendered, not only
   where records are filtered (Coleby's `logging_setup.py` insight).
4. **Every identifier interpolated into a URL is validated** — Mongo ObjectId =
   `^[0-9a-fA-F]{24}$` (§2.2).
5. **Server-side, bounded, deterministic aggregation** — counts capped
   server-side, date ranges bounded (§2.8); the model never does arithmetic over
   thousands of readings (§5.5).
6. **Free-text fields are neutralized** before entering tool results — the
   `notes` field is third-party-writable and reaches the model verbatim
   otherwise (§2, "le point que personne ne traite").
7. **`NIGHTSCOUT_URL` must be `https://`** — refuse to start otherwise (§2.15).

## Consequences

- Conventions (lint, tests, CI shape) follow `mcp-standardnotes`, the house MCP
  with the most complete apparatus.
- The v1-vs-v3 API question (§5.2) stays open until a real instance exists to
  probe; v3 would remove the token-in-query-string problem at the root and is
  the preferred outcome of that probe.
