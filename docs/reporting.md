# Reporting

The reporting service answers the questions a depot manager asks every morning, as data or as a
file, and measures an operation against its own baseline without overclaiming.

**What feeds it, today.** The reports read narrow projection tables, one row per day per thing.
The consumers that fill those tables from the event streams are not built yet, so on a fresh
installation every report returns its header and no rows until you load the projections
yourself. The tables, the queries, the export, and the baseline arithmetic are complete and
tested against a real database; the feed from the streams is the next piece of work.

## The reports

Reports are named and fixed. A caller chooses one and gives it a date range and optionally a
hub; nobody sends a query, so there is nothing to inject into and no way to read another
tenant's rows. `GET /v1/reports` lists them.

| Report                 | What it shows                                                   |
| ---------------------- | --------------------------------------------------------------- |
| `delivery_performance` | delivered, attempted, and returned, by day and hub              |
| `failed_deliveries`    | every failed attempt with its reason, so reasons can be counted |
| `cash_position`        | what each driver holds and what has been banked, by day         |
| `hub_throughput`       | parcels in and out of each hub, and the exceptions they raised  |
| `exception_ageing`     | open exceptions by type and how long the oldest has waited      |
| `linehaul_utilisation` | how full each trip left, and what did not come off              |

A range is at most a quarter, and a report returns at most fifty thousand rows, so one export
cannot take the database down.

## Export

Add `format=csv` and the response is a file with a proper header and a filename. A cell that a
spreadsheet would run as a formula is defused, so an operator's report can never execute
anything when it is opened.

## Baselines

`GET /v1/baselines/comparison` takes a metric, a baseline window, and a measured window, and
compares them as two rates. It reports both rates, the difference, and a 95 per cent interval
around the difference, and gives one of four verdicts:

| Verdict               | Meaning                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `improved`            | the whole interval is on the better side of zero                                             |
| `worsened`            | the whole interval is on the worse side                                                      |
| `indistinguishable`   | the interval includes zero; the difference could be noise, whatever the headline number says |
| `not_enough_evidence` | fewer than 384 deliveries in a window; no comparison is worth making                         |

Windows that overlap are refused, because the same days on both sides flatter whichever side is
worse. A `lane` narrows both windows to one hub for a matched comparison.

This is the mechanism behind any value claim the product makes about itself: two weeks of
measurement at onboarding is the baseline, and improvements are reported with their interval or
not at all.
