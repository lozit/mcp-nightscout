<!-- generated-by: groundrules v1.10.0 -->
# Architecture — mcp-nightscout

**Living** snapshot of the current architecture. Updated as the structure evolves.

For the **why** behind choices → see `docs/decisions/`.

> **Status: intended, not built.** Nothing below exists in code yet. This file records the
> shape the seven constraints in [ADR 0001](decisions/0001-language-and-stack.md) imply, so the
> first commits have a target. Rewrite it to describe reality as soon as reality exists.

## Overview

A single process, spawned by an MCP host (Claude Desktop / Claude Code) and speaking MCP over
**stdio**. It opens no port and accepts no inbound connection. Its only outbound dependency is
one HTTPS Nightscout instance.

```
MCP host  ──stdio──▶  mcp-nightscout  ──HTTPS──▶  Nightscout instance
(spawns)              (this process)              (upstream, read-only use)
```

Data crosses two trust boundaries, in opposite directions, and each has a mandatory gate:

- **Outbound (us → Nightscout)**: carries the token. Gate = *nothing containing the token may
  ever be rendered into a log, an error, or a tool result.*
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

### Nightscout client

Async HTTPS client. Catches upstream errors and re-throws carrying **the path only**, dropping
the cause, because the underlying error object embeds the full URL — query string and token
included. Validates every identifier it interpolates into a path (`^[0-9a-fA-F]{24}$`).

### Tool layer

~10 read tools. Each caps volume server-side and bounds date ranges, whatever the model asks
for. No tool writes.

### Sanitizer

Neutralizes third-party-writable free text (notably `notes`) on the way out. Read-only removes
the exploitable *consequence* of an injected instruction, not the *vector* — this component is
what addresses the vector.

### Aggregator

Computes mean, TIR, CV and GMI **server-side and deterministically**. Its purpose is volume
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

- **No instance to test against yet** — the whole design is unvalidated against real payloads.
- **API v1 vs v3 undecided** — v1's `?token=` query string is the root cause of the
  token-in-URL and token-in-exception problems; v3 would remove them at the source. Blocked on
  having an instance. Record the outcome as an ADR.
- **The sanitizer has no settled strategy yet** (delimit / truncate / strip). Likely its own ADR.
- **Correct-looking aggregates are the quiet risk** — they must be checked by hand against
  Nightscout's reports, not merely reviewed.
