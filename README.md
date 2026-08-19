# mcp-nightscout

> **What** — an MCP server giving an AI assistant read-only access to a Nightscout instance: glucose readings and deterministic, server-side aggregates (mean, median, SD, CV, GMI, time-in-range bands).
> **For** — people running their own Nightscout who want to discuss their data with an assistant without handing it write access.
> **Deployed** — not deployed, and not published to npm. Runs locally over stdio.
> **Run** — `npm ci && npm run build && npm run login`, then point your MCP client at `dist/index.js`.

## Status

**Working, early.** Two tools ship and have been exercised against a real Nightscout
instance (v15.0.7) over API v3. 131 tests. Version `0.0.0` — the tool surface is still
moving, and nothing is published anywhere.

What is done: the transport, the v3 auth flow, unit resolution, volume caps, secret
scrubbing, free-text neutralization, and aggregates whose figures were **checked by hand
against Nightscout's own Distribution report** — mean, median and standard deviation agree
to the rounding, and the two remaining gaps are documented conventions rather than
unexplained drift ([ADR 0004](docs/decisions/0004-aggregation-method.md)).

What is not: roughly half the intended tool surface, and anything touching `treatments`
(see [Limits](#limits)).

## Tools

| Tool | What it returns |
|---|---|
| `nightscout_recent_glucose` | Recent CGM readings over a window of up to 24 h, with trend and the resolved unit. Non-CGM entries are discarded and counted. |
| `nightscout_glucose_summary` | Mean, median, sample SD, CV, GMI and the five consensus time-in-range bands, over a sliding window of N days **or a single calendar day** framed in the profile's time zone. |

Both are read-only and cap their own volume server-side.

## Setup

Requires Node 20+.

```sh
npm ci
npm run build
npm run login        # stores the token in your OS keychain, input is hidden
```

`npm run login` asks for your Nightscout URL and a token. Create the token as a
**`readable` subject** in Nightscout's Admin Tools — never the admin `API_SECRET`, which
the server refuses at boot.

Then register the server with your MCP client:

```jsonc
{
  "mcpServers": {
    "nightscout": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-nightscout/dist/index.js"],
      "env": { "NIGHTSCOUT_URL": "https://your-nightscout-instance" }
    }
  }
}
```

The URL is not a secret and travels in plain configuration. The token stays in the
keychain — it never needs to appear in a config file, an environment variable, or a
command line.

To check the whole chain without an MCP client:

```sh
npm run smoke                  # readings hidden, aggregates and shapes shown
npm run smoke -- --date 2026-08-17   # a calendar day, comparable to a Nightscout report
npm run smoke -- --full        # includes real readings; puts health data on screen
```

## Two closed decisions

Neither is up for reopening without a new ADR.

- **stdio, local only** — no HTTP transport, no listening port. This is not cosmetic: it
  deletes fail-open auth, tokens in request URLs, non-constant-time comparison, DNS
  rebinding and missing rate limiting as concerns, structurally rather than by mitigation.
- **Read-only** — this server will never write to a Nightscout instance. The threat model
  is **treatment alteration, not data leakage**: a Nightscout profile holds basal, ISF, ICR
  and DIA, the parameters a closed loop uses to compute insulin doses. A server able to
  write those is a server able to change what a pump delivers.

## Limits

- **`treatments` and `devicestatus` are untested.** They were empty on the instance used to
  build this, so no tool reads them yet, no insulin- or carb-dependent figure exists, and
  the shape of the `notes` field is unknown.
- **Free-text neutralization bounds an injection, it does not prevent one.**
  Third-party-written fields (`device` today, `notes` later) are stripped of control
  characters, truncated, tagged `[untrusted:…]`, and published **once per response** with
  readings referencing them by integer index — so a hostile payload appears one time rather
  than 288. The module deliberately does **not** try to detect instructions: any pattern
  list is bypassable, and shipping one would trade a real bound for a false sense of
  safety. Hostile text still reaches the model, on one line, bounded and labelled
  ([ADR 0005](docs/decisions/0005-free-text-neutralization.md)).
- **Band percentages are shares of readings, not time-weighted.** They coincide only while
  readings are evenly spaced. Every response carries its own `coverage` so a figure
  computed over a sparse window announces itself.
- **Thresholds are the fixed international consensus values**, not your profile's personal
  targets — so the numbers stay comparable. If your Nightscout report is configured
  differently, the figures will differ, and the applied thresholds ship in every response
  to make that explainable.

## Why another one

The existing Nightscout MCP servers are solo projects, most of them exposing write tools,
none of them treating the free-text fields of a shared instance as the prompt-injection
surface they are. This one is written from scratch against an explicit threat model. It
aims for a modest set of read tools and verifiable aggregates — not feature parity with
anything.

## Documentation

- [`docs/decisions/`](docs/decisions/) — the structural decisions, with their tradeoffs
- [`docs/SECURITY.md`](docs/SECURITY.md) — threat model, secret handling, incident record
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — the upstream shapes, probed rather than assumed
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components and the two trust boundaries

## License

[MIT](LICENSE)
