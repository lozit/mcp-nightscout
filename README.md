# mcp-nightscout

> **What** — an MCP server giving Claude read-only access to a Nightscout instance: glucose readings, treatments, and deterministic server-side aggregates (mean, TIR, CV, GMI).
> **For** — people running their own Nightscout who want to discuss their data with an AI assistant without handing it write access.
> **Deployed** — not deployed — runs locally over stdio.
> **Run** — no code yet; see status below.

## Status

**Pre-code.** The design frame is fixed and recorded in
[docs/decisions/0001-language-and-stack.md](docs/decisions/0001-language-and-stack.md):
TypeScript on the official MCP SDK, **stdio-only**, **read-only**, with a set of
security constraints inherited from auditing an existing implementation.

Two decisions are deliberately closed and not up for reopening without a new ADR:

- **stdio local only** — no HTTP transport, no network port. Most of the
  vulnerability classes the audit found disappear with the transport.
- **Read-only** — this server will never write to a Nightscout instance. The
  threat model is treatment alteration, not data leakage: Nightscout profiles
  drive dosing calculations in closed-loop setups.

## Why another one

The existing Nightscout MCP servers are solo projects, most of them exposing
write tools, none of them treating the free-text fields of a shared instance as
the prompt-injection surface they are. This one is written from scratch against
an explicit threat model. It aims for ~10 read tools and verifiable aggregates —
not feature parity with anything.

## License

[MIT](LICENSE)
