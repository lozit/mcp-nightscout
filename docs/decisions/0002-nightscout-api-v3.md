<!-- generated-by: groundrules v1.10.0 -->
# 0002 — Talk to Nightscout over API v3

**Date**: 2026-08-18
**Status**: Accepted

## Context

ADR 0001 left the v1-vs-v3 choice open, blocked on a real instance to probe.
The instance now exists (`<instance>`, self-reported version
**15.0.7**, `apiEnabled: true`), so the question is decidable rather than
theoretical.

The audit that seeded this project traced two of its findings — the token
logged in cleartext, and the token leaked in exception messages — to a single
root cause shared by all six surveyed servers: v1 carries the access token in
the URL query string (`?token=…`), so the token rides inside every request URL,
every log line, and every error object that echoes a URL.

## Decision

**Use API v3, authenticated by the token→JWT exchange.** The server holds a
`readable`-role token, calls `/api/v2/authorization/request/{token}` once to
obtain a short-lived JWT, and sends `Authorization: Bearer <jwt>` on every v3
read. The token appears in exactly one request (the exchange) and never in a
data-fetch URL.

## Probe results (2026-08-18)

Empirical, against the live instance — the first field data of the project:

| Probe | Result | Reading |
|---|---|---|
| `GET /api/v1/status.json` (no token) | `401 Unauthorized` | anonymous reads refused — the healthy config |
| `GET /api/v1/status.json?token=…` | `200`, version `15.0.7` | ≥14 ⇒ v3 is embedded; token works |
| `GET /api/v3/status` | `401` | v3 endpoint **present**, auth required (not a 404) |
| `GET /api/v3/entries?limit=1` + Bearer JWT | `200` | the JWT exchange works and v3 reads succeed in-header |

## Alternatives considered

- **v1 with `?token=`** — rejected. It is the documented root cause of the
  token-in-URL and token-in-exception findings. Choosing it would mean
  *scrubbing* the token out of logs and errors after the fact; v3 removes it
  from those surfaces entirely. Log scrubbing (ADR-to-come / SECURITY.md) stays
  as defence-in-depth, not as the primary control.

## Consequences

### Positive
- The token never enters a data-fetch URL, so it cannot reach access logs or a
  URL-bearing exception. The two audit findings are eliminated at the source.
- v3's role/subject model fits the read-only posture: a `readable` subject, not
  the admin `API_SECRET`.

### Negative / Tradeoffs
- **JWT lifetime must be managed.** The exchange returns a short-lived JWT; the
  server must cache it, detect expiry (a `401` on a previously-working read),
  and re-exchange from the stored token. This is new state the v1 path didn't
  have. The readable token stays in the keychain; the JWT stays in memory only.
- v3's response envelope and paging differ from v1 — the HTTP client is written
  against v3 shapes from the start.

### Neutral
- The `readable` token is created as a Nightscout *subject*, managed in the
  instance's Admin Tools, outside this repo.

## Notes

Supersedes the open consequence in
[ADR 0001](0001-language-and-stack.md) §Consequences ("the v1-vs-v3 API
question stays open"). Probe method: three `curl` calls with
`-w '%{http_code}'`; the token and JWT values were never recorded.
