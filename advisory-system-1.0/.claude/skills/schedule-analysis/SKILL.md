---
name: schedule-analysis
description: Turns one vendor's stored advisory publish dates into a polling schedule at vendors/<vendor>/schedule.json, which the runtime daemon follows. Offline only - no HTTP. Runs once per vendor after its first backfill, and again when the analysis is older than 90 days. Goal - poll each vendor as often as it publishes, and no more.
version: "1.0"
---

# Schedule Analysis

## 0. Purpose

Reads the `date_published` values already stored in a vendor's `advisories.json` files, finds the publishing pattern, and writes `vendors/<vendor>/schedule.json`. The daemon (`scripts/collector.py`) uses it to decide how often to run that vendor's fetch scripts. No HTTP: all evidence is on disk. Without a valid file the daemon polls every 12 hours (`DEFAULT_CRON`), so a missing schedule is safe.

```
source-study → script-builder → first backfill → schedule-analysis → schedule.json → daemon
```

## 1. Triggers

The collector agent invokes with `vendor_name` and one `reason`:

| `reason` | When |
|---|---|
| `new_vendor` | No `schedule.json`, and at least one product has finished its first backfill |
| `stale` | `last_analysed` older than 90 days |
| `spec_changed` | This skill's `version` is newer than the file's `analysis_version` |

A vendor with no finished backfill is not analysed; `DEFAULT_CRON` covers it.

## 2. Inputs

| Input | Used for |
|---|---|
| `registry.json` | The vendor's product list → which `advisories.json` files to read |
| `vendors/<vendor>/<product>/advisories.json` | `additional_details.date_published` of every record — the only evidence |
| `vendors/<vendor>/source_study.json` | `fields.date_published.notes` (does the date carry a time?) and any documented release days / timezone |
| `vendors/<vendor>/schedule.json` | Previous analysis, for `changed_from_previous` |

## 3. Analysis

**3.1 Date set**

1. Collect `date_published` from every product's `advisories.json`; skip records without one.
2. Deduplicate by `advisory_id` across products (one advisory, one publication).
3. Window: last 365 days. Fewer than 10 dates → widen to all history. Still fewer than 10 → write nothing, return `skipped`.

**3.2 Evidence**

| Measure | Rule |
|---|---|
| `advisories_per_week` | `data_points ÷ (window span in days ÷ 7)`; span = oldest→newest date, minimum 7 days |
| `weekday_histogram` | Count per `Mon`…`Sun` |
| `week_of_month_histogram` | Count per `"<ordinal> <weekday>"`, e.g. `"2nd Tue"` |
| `hour_histogram` | Only if the study says the date carries a time; otherwise `null`. Stored dates are `YYYY-MM-DD` — never infer an hour |

**3.3 Batching → burst windows**

| Rule | Threshold | Burst |
|---|---|---|
| Weekly | One weekday ≥ 50 % of advisories | `*/30 * * * <weekday>` |
| Monthly | One (ordinal, weekday) ≥ 40 % | `*/30 * <dom-range> * <weekday>`, e.g. 2nd Tuesday = `*/30 * 8-14 * 2` |

Below threshold → no burst, even for a vendor "known" to batch; record what they document under `documented_release_days` instead. Batching and base rate are independent: Cisco is `moderate` *with* a Wednesday burst.

**3.4 Base rate**

| `pattern` | `advisories_per_week` | `cron` | `jitter_s` |
|---|---|---|---|
| `frequent` | > 5 | `0 */2 * * *` | 720 |
| `moderate` | 1 – 5 | `0 */6 * * *` | 2160 |
| `sparse` | < 1 | `0 3 * * *` | 3600 |

`jitter_s` = 10 % of the interval, capped at 3600; the daemon passes it to apscheduler so runs never hit a predictable instant.

**3.5 Timezone** — a documented release timezone (vendor site or study) → use it. Otherwise `"UTC"` with `timezone_source: "default"`. Never infer from headquarters; a 24 h burst absorbs the error.

## 4. Output — `schedule.json`

```json
{
  "vendor": "cisco",
  "analysis_version": "1.0",
  "last_analysed": "2026-10-06T11:18:30Z",
  "timezone": "UTC",
  "pattern": "moderate",
  "cron": "0 */6 * * *",
  "jitter_s": 2160,
  "burst_windows": [
    { "reason": "weekly: Wed = 71%", "cron": "*/30 * * * 3", "duration_h": 24 }
  ],
  "evidence": {
    "data_points": 212,
    "window": { "from": "2025-10-06", "to": "2026-10-05", "days": 365 },
    "advisories_per_week": 4.1,
    "weekday_histogram": { "Mon": 12, "Tue": 18, "Wed": 150, "Thu": 20, "Fri": 10, "Sat": 1, "Sun": 1 },
    "week_of_month_histogram": { "1st Wed": 38, "2nd Wed": 41, "3rd Wed": 36, "4th Wed": 35 },
    "hour_histogram": null,
    "batching_rule": "weekly",
    "documented_release_days": "Wednesdays; semiannual IOS bundles Mar/Sep",
    "timezone_source": "default",
    "products_read": ["nx-os", "ios"],
    "changed_from_previous": "sparse → moderate; added Wed burst"
  }
}
```

Rules:

- Crons are standard 5-field crontab for apscheduler's `CronTrigger.from_crontab()` — no seconds, no `@daily`, no `L`/`#`. Note apscheduler **ANDs** day-of-month and weekday (Vixie cron ORs them); the monthly burst relies on this.
- During a burst the burst cron **replaces** the base cron for `duration_h` (24), on the vendor's clock; bursts never stack or overlap.
- All products of the vendor share this schedule; the daemon runs their scripts a few seconds apart.

## 5. Daemon behaviour (context only)

No file, invalid file, or `data_points < 10` → `DEFAULT_CRON = "0 */12 * * *"`, no jitter. A run missed during downtime executes once at start-up, never more.

## 6. Hard constraints

1. Write only `schedule.json`. Never touch the daemon, scripts, `registry.json`, `source_study.json` or `collector.json`.
2. No HTTP.
3. Bursts need a histogram over threshold — evidence, not reputation.
4. Fewer than 10 dates → no file. Never pad or lower the threshold.

## 7. Definition of done and hand-off

`python3 -m scripts.validate schedule <vendor>` checks: file parses; every cron is valid 5-field crontab; `timezone` is IANA or `"UTC"`; `pattern` matches 3.4 for `evidence.advisories_per_week`; `jitter_s` matches 3.4; each burst has `reason`, `cron`, `duration_h`; `evidence.data_points ≥ 10`; `last_analysed` is ISO-8601 UTC; `analysis_version` equals this skill's `version`. Fix and re-run; if it cannot pass, delete the file.

Last line printed to stdout:

```json
{
  "outcome": "written | skipped | failed",
  "file": "vendors/cisco/schedule.json",
  "skipped_reason": "<only when skipped, e.g. '4 dated advisories across 2 products'>",
  "failed_check": "<only when failed>",
  "summary": { "pattern": "moderate", "advisories_per_week": 4.1, "bursts": 1, "data_points": 212 },
  "changed_from_previous": "<one line, or null>"
}
```

`skipped` is normal: the agent re-invokes after the next backfill adds data.

## 8. Changelog

| version | change | validator update |
|---|---|---|
| 1.0 | Initial. Offline only — evidence from stored `advisories.json`, pooled across products, deduplicated by `advisory_id`, 365-day window. `pattern` is rate-only; batching lives in `burst_windows` with thresholds (50 % weekday / 40 % week-of-month) and a `reason` each. `hour_histogram` only when the date carries a time. `jitter_s`, `analysis_version`, `evidence.data_points`, `evidence.window`, hand-off JSON | `scripts.validate schedule` checks the section 7 list |
