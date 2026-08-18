<!-- generated-by: groundrules v1.10.0 -->
# Glossary — mcp-nightscout

Domain vocabulary for the project. One entry per term, alphabetical order.

Keep definitions short and precise. The goal: a new developer (or Claude) quickly understands the
domain language. Terms here are diabetes-management and Nightscout jargon — most of them are
load-bearing for computing an aggregate *correctly*, not just for reading the code.

---

## B

**Basal** — the continuous background insulin rate, expressed in units/hour and varying by time
of day. Part of the profile; one of the parameters a closed loop uses to compute doses.

**Bolus** — a discrete insulin dose, typically for a meal (meal bolus) or to correct a high
reading (correction bolus).

## C

**CGM** (Continuous Glucose Monitor) — the sensor producing a glucose reading every ~5 minutes,
so roughly 288 readings per day. The source of the `entries` collection and of essentially all
the data volume.

**Closed loop** — an automated system where an algorithm reads CGM data and adjusts insulin
delivery without user action. The reason profile parameters are safety-critical: change them and
you change what the pump delivers.

**CV** (Coefficient of Variation) — standard deviation divided by mean, as a percentage. The
standard measure of glucose *variability*. Below ~36% is generally considered stable.

## D

**DIA** (Duration of Insulin Action) — how long injected insulin keeps acting, in hours. Profile
parameter; feeds dose calculations.

## E

**Entries** — the Nightscout collection holding CGM readings. See `docs/DATA_MODEL.md`.

## G

**GMI** (Glucose Management Indicator) — an estimate of HbA1c derived from mean glucose over a
period. Formula-based, so it is only as correct as the mean underneath it — and as the units.

## H

**HbA1c** — a lab measure of average glycemia over ~3 months. GMI estimates it; it does not
replace it.

## I

**ICR** (Insulin-to-Carb Ratio) — grams of carbohydrate covered by one unit of insulin. Profile
parameter; safety-critical.

**ISF** (Insulin Sensitivity Factor) — how much one unit of insulin lowers glucose. Profile
parameter; safety-critical. Also called *correction factor*.

## M

**mg/dL** — the unit Nightscout stores glucose in internally. **mmol/L** — the unit much of the
world displays it in. The conversion factor is ~18 (`mg/dL ÷ 18.018 = mmol/L`). Confusing them
produces plausible-looking, badly wrong aggregates — see `docs/DATA_MODEL.md` § Units.

## N

**Nightscout** — the open-source, self-hosted CGM data platform this server reads. Each user runs
their own instance. It does **not backfill**: an instance only holds history from its own install
date onward.

## P

**Profile** — the Nightscout record holding basal, ISF, ICR, DIA and target ranges. The asset the
threat model protects.

## S

**SGV** (Sensor Glucose Value) — a single CGM reading, in mg/dL. The `sgv` field of `entries`.

## T

**TIR** (Time In Range) — the percentage of readings falling inside a target range, conventionally
70–180 mg/dL (3.9–10.0 mmol/L). One of the four V1 aggregates, and the one most exposed to a
units mistake.

**Treatment** — any logged event in Nightscout: a bolus, carbs, a temporary basal, a note. Carries
the free-text `notes` field that is the prompt-injection vector.

## U

**Uploader** — the phone app or bridge that pushes CGM and pump data into a Nightscout instance.
Relevant here because uploaders and other integrations hold **write** access, which is what makes
free-text fields untrusted input.
