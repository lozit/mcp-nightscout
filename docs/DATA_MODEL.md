<!-- generated-by: groundrules v1.10.0 -->
# Data Model — mcp-nightscout

**Living** description of the data model. Update it whenever the schema changes.

For the **why** behind choices → see `docs/decisions/`.

> **Status: unverified.** This server owns **no database and no schema of its own** — it stores
> nothing. What follows describes the *upstream* Nightscout collections it reads. It is written
> from documentation and from reading other clients, **not** from probing a live instance: no
> instance exists yet. Treat every field as provisional until confirmed against real payloads,
> and correct this file in the same change that confirms them.
>
> The API version is also undecided (v1 vs v3) — see `PLAN.md`. Field names and shapes differ
> between them.

## Overview

Nightscout stores its data in MongoDB collections, exposed over a REST API. The ones relevant
here:

```
entries       — CGM readings (the bulk of the volume)
treatments    — insulin, carbs, notes, and other logged events
profile       — basal / ISF / ICR / DIA settings
devicestatus  — pump and loop reporting
```

Only `entries` and `treatments` are needed for V1's aggregates. `profile` matters mostly because
it is the **thing the threat model protects** — it is read-relevant for context (units, targets)
and must never be written.

## The field that drives the design

| Field | Where | Why it matters |
|---|---|---|
| `notes` | `treatments` | **Free text, third-party-writable.** Any uploader or integration with write access to the instance can put arbitrary content there, and it reaches the model verbatim unless neutralized. This is the prompt-injection vector, and it is a *data-model* fact before it is a security control. See `docs/SECURITY.md`. |

Treat any other free-text or third-party-populated field the same way as it is discovered
(`eventType` variants, device strings, `reason`, custom uploader fields). The rule is about
provenance, not about the specific field name.

## Entities

### `entries` — CGM readings

| Field | Type | Notes |
|---|---|---|
| `_id` | Mongo ObjectId | Validate as `^[0-9a-fA-F]{24}$` before interpolating into any path |
| `date` | epoch ms | Primary time key |
| `dateString` | ISO 8601 | Redundant with `date`; confirm which is authoritative |
| `sgv` | int | Sensor glucose value, **mg/dL** — see the units warning below |
| `direction` | string | Trend arrow (`Flat`, `FortyFiveUp`, …) |
| `type` | string | `sgv`, `mbg`, `cal` — filter deliberately; not every entry is a CGM reading |
| `device` | string | Third-party-populated |

### `treatments` — logged events

| Field | Type | Notes |
|---|---|---|
| `_id` | Mongo ObjectId | Validate before use |
| `created_at` | ISO 8601 | Time key — **note it differs from `entries.date`** in both name and format |
| `eventType` | string | `Meal Bolus`, `Correction Bolus`, `Temp Basal`, … — open vocabulary in practice |
| `insulin` | float | Units |
| `carbs` | float | Grams |
| `notes` | **free text** | **Neutralize before it reaches the model** |
| `enteredBy` | string | Third-party-populated |

### `profile` — therapy settings

Holds `basal`, `sens` (ISF), `carbratio` (ICR), `dia`, target ranges and `units`. **Read-only,
always.** These are the parameters a closed-loop system uses to compute doses; writing them is
the exact harm this project is built to avoid.

Its `units` field is what tells you how to interpret everything else.

### `devicestatus` — pump / loop reporting

Not needed for V1. Listed so its absence is a decision rather than an oversight.

## Units — the correctness trap

Nightscout stores glucose in **mg/dL** internally and converts to mmol/L for display, per the
profile's `units`. An aggregate computed on stored values and presented without that conversion
is off by a factor of ~18 and will still look like a plausible number. TIR thresholds have the
same problem: 70–180 mg/dL is 3.9–10.0 mmol/L.

Read `units` from the profile; never assume. This is the most likely source of a silently wrong
aggregate — see the acceptance criterion requiring hand-verification against Nightscout's own
reports (`docs/VISION.md`).

## Access rules

None to enforce: the server is read-only against a single instance owned by the single user.
The only access decision happens at boot (credential kind and URL scheme), not per row.

## Indexes and performance

Not ours — the upstream instance owns its indexes. What *is* ours: **volume control**. `entries`
is by far the largest collection (a CGM writes ~288 readings/day, so a year is ~100k rows). Every
query caps `count` server-side and bounds its date range, regardless of what the model requests.

## Migrations

None. This server has no schema and no persistence.
