<!-- generated-by: groundrules v1.10.0 -->
# Data Model — mcp-nightscout

**Living** description of the data model. Update it whenever the schema changes.

For the **why** behind choices → see `docs/decisions/`.

> **Status: probed against the live instance on 2026-08-18** (version 15.0.7, **API v3**,
> [ADR 0002](decisions/0002-nightscout-api-v3.md)). This server owns **no database and no schema
> of its own** — it stores nothing. What follows describes the *upstream* collections it reads.
>
> `entries` and `profile` are recorded from **real payload shapes**. `treatments` and
> `devicestatus` were **empty at probe time** and are therefore **not characterized** — see the
> warning on each. Nothing below is inferred from v1 documentation without being labelled as such.
>
> Probe method: field names and types only, values never retrieved. Re-run it and rewrite this
> file in the same change whenever the shapes move.

## Response envelope (v3)

Every v3 read returns the same two-key envelope:

```jsonc
{ "status": 200, "result": [ /* documents */ ] }
```

- No `paging` object. Paging is driven by **request parameters** (`limit`, `skip`), not by
  envelope metadata — so the client must track its own position.
- `fields=_all` is required to get the full document; without it v3 returns a reduced field set.
  Every probe above used it, so the tables below are the *full* shapes.

## Identifiers — constraint #4, settled

**v3 addresses documents by `identifier`. There is no `_id` in a v3 response** (`_id` probed as
absent on every collection).

On this instance `identifier` is a **24-character hex Mongo ObjectId** — measured, on both
`entries` and `profile`:

```
id_class: { "identifier": "24-hex-objectid", "_id": "absent-or-null" }
```

**So constraint #4's `^[0-9a-fA-F]{24}$` is the correct shape — but for the right reason, not the
one originally written.** It is correct because these documents originate from an ObjectId-issuing
path, not because v3 guarantees the format. v3 permits other identifier forms for documents
created through the v3 API, so a future uploader could introduce UUID-shaped identifiers on this
same instance.

**Rule**: validate with `^[0-9a-fA-F]{24}$`. If a real, legitimate read ever fails that check,
**re-probe and widen the pattern deliberately** — do not relax the guard to make a call succeed.
The guard exists because HTTP clients normalize `..` per RFC 3986, which turns an unvalidated
identifier into an arbitrary path (`docs/LEARNINGS.md`).

## Entities

### `entries` — CGM readings ✅ probed

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | 24-hex ObjectId. Validate before interpolating into any path. |
| `date` | number | **The time key** — epoch milliseconds. |
| `dateString` | string | ISO 8601, redundant with `date`. Prefer `date`; it needs no parsing. |
| `sysTime` | string | Server-side timestamp, ISO 8601. |
| `utcOffset` | number | Minutes. Needed to render a local-time-of-day view (AGP-style binning). |
| `sgv` | number | Sensor glucose value. **Units are not carried on the reading** — see below. |
| `type` | string | `sgv`, `mbg`, `cal`… **Filter deliberately: not every entry is a CGM reading**, and averaging across types silently corrupts every aggregate. |
| `device` | string | Third-party-populated. Treat as untrusted text. |
| `srvCreated` | number | Server insert time, epoch ms. |
| `srvModified` | number | Server modify time, epoch ms. Useful as an incremental-sync cursor. |

### `profile` — therapy settings ✅ probed

**Read-only, always.** These are the parameters a closed-loop system uses to compute doses;
writing them is the exact harm this project exists to avoid.

| Field | Type | Notes |
|---|---|---|
| `identifier` | string | 24-hex ObjectId |
| `defaultProfile` | string | Names which key of `store` is active |
| `store` | object | Map of **profile name → settings**. One entry on this instance. Profile names are user-chosen labels — treat them as untrusted text, and avoid echoing them where not needed. |
| `units` | string | **Top-level** units |
| `startDate` | string | ISO 8601 |
| `created_at` | string | ISO 8601 — note `profile` uses `created_at`, `entries` uses `date`. The time key is **not** uniform across collections. |
| `mills` | number | Epoch ms, mirrors `startDate` |
| `srvCreated` / `srvModified` | number | Epoch ms |

Each `store[<name>]` entry:

| Field | Type | Notes |
|---|---|---|
| `units` | string | **Also present here** — see the units warning below |
| `dia` | number | Duration of insulin action, hours |
| `carbs_hr` | number | Carb absorption rate |
| `delay` | number | |
| `timezone` | string | IANA zone — the authority for local-time binning, over `utcOffset` guesses |
| `basal` | array of `{time: string, value: number, timeAsSeconds: number}` | Time-segmented |
| `sens` | array of same | ISF, time-segmented |
| `carbratio` | array of same | ICR, time-segmented |
| `target_low` | array of same | **TIR's lower bound lives here** |
| `target_high` | array of same | **TIR's upper bound lives here** |

> All five therapy arrays are **time-segmented**, not scalar. A "the ISF is 45" answer is wrong
> by construction: it is 45 *during some segments*. Any tool reporting them must carry the
> segmentation or say explicitly which segment it read.

### `treatments` — logged events ⚠️ NOT probed

**The collection was empty at probe time** (`result: []`), so its shape is **unknown on this
instance** and is deliberately not tabulated here. The instance was installed the same day and
nothing has logged a treatment yet.

What is known without probing, and why it matters:

- This collection carries the **`notes` free-text field**, which is the project's
  prompt-injection vector (`docs/SECURITY.md`). It is written by any uploader or integration with
  write access, and reaches the model verbatim unless neutralized.
- **Consequence**: the neutralization strategy cannot be designed against real data yet, and the
  aggregates that need insulin/carb events (anything beyond pure CGM statistics) cannot be built
  or verified.

**Do not write client code or a `notes` sanitizer against assumed field names.** Re-probe once
the collection has data, then fill this section and remove this warning in the same change.

### `devicestatus` — pump / loop reporting ⚠️ NOT probed

Also empty at probe time. Not needed for V1, so its absence is a deferral rather than a blocker —
recorded so it is a decision and not an oversight.

## Units — the correctness trap, now with a concrete ambiguity

`sgv` carries **no unit of its own**. The unit comes from the profile — and the probe found
`units` in **two places**: at the profile top level, and inside each `store[<name>]` entry.

**Which one is authoritative is unresolved.** They agree on this instance (single profile), so a
naive implementation reading either will look correct and will diverge the first time a second
profile exists with different units.

Until it is settled: read `units` from the **active** store entry (`store[defaultProfile].units`),
and **fail loudly** if it disagrees with the top-level value rather than silently preferring one.

The stakes: Nightscout stores glucose in **mg/dL** and displays mmol/L per this setting. The
factor is ~18 (`mg/dL ÷ 18.018 = mmol/L`). TIR bounds move with it too — 70–180 mg/dL is
3.9–10.0 mmol/L. An aggregate computed on the wrong assumption is off by 18× and still looks like
a plausible number. This is the most likely source of a silently wrong result in the whole
project, which is why `docs/VISION.md` requires hand-verification against Nightscout's own reports.

## Access rules

None to enforce: read-only, single instance, single user. The only access decision happens at
boot (credential kind and URL scheme), not per document.

## Volume and paging

`entries` is by far the largest collection — a CGM writes ~288 readings/day, so a year is ~100k
documents. The envelope offers no paging metadata, so the client caps `limit` server-side and
bounds date ranges itself, regardless of what the model requests (constraint #5). `srvModified` is
the natural incremental cursor if sync is ever needed.

## Migrations

None. This server has no schema and no persistence.
