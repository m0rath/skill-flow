---
name: collector-runtime-builder
description: Builds scripts/collector.py - the pure-Python runtime that schedules and runs every target's fetch script, maintains collector.json, detects breakage and reports health. One-time build - the daemon then runs forever with no AI in the loop. Rebuild only when this spec changes.
version: "1.0"
---

# Collector Runtime Builder

## 0. Purpose

Builds `requirements.txt` (only if missing) and **`scripts/collector.py`**: one file holding all generic, vendor-independent runtime logic. Once it exists, everything recurring is plain Python — scheduling, running the product scripts, state bookkeeping, breakage detection, health, alerts.

The runtime **executes** scripts and **detects** breakage. It never writes code, never repairs, never studies a source. On breakage it marks the target `broken` and raises an alert; that alert is the signal for a collector-agent session.

```
schedule.json ─► daemon ─► run/fetch_advisories.py --since <cursor> ─► RUN_SUMMARY ─► collector.json (state, health, recent_runs, manifest, alerts)
                                                                        exit code   ─► run status
```

## 1. When this skill runs

Once, to create `scripts/collector.py`; again when this skill's `version` is newer than the `RUNTIME_VERSION` constant the file declares. Every edit to this skill bumps `version` and adds a changelog row (section 11). Never invoked as part of a collection run.

## 2. Repo resources

| File | Use |
|---|---|
| `schemas/collector.schema.json` | Every `collector.json` the runtime writes is validated against it with `jsonschema`, `__file__`-relative, never by eye |
| `schemas/advisory_record.schema.json` | Shape of one advisory record (the core validates with it; the runtime re-checks on store) |
| `.claude/skills/advisory-script-builder/SKILL.md`, `schedule-analysis/SKILL.md` | `--list` reads their frontmatter `version` / `core_version` (plain `key: "value"` line parse, no YAML library) |

## 3. CLI

```
python3 -m scripts.collector                                 # daemon (from the repo root)
python3 -m scripts.collector --list                          # classification of every target
python3 -m scripts.collector --run-once <vendor>/<product>
python3 -m scripts.collector --normalize <vendor>/<product>  # common schema to stdout, writes nothing
```

`--list` prints one header line — `runtime <RUNTIME_VERSION>/<skill version>  core <CORE_VERSION>/<core_version>  builder <version>  schedule <version>` — then one line per target: class, why stale (`registry` / `builder 1.0→1.1` / `core` / `study`), counts of failed IDs (and how many have ≥ 3 attempts), incomplete advisories and unaudited rejections, and per vendor whether `schedule.json` is missing, stale (`last_analysed` > 90 days) or out of date (`analysis_version` < skill version). The agent never classifies by hand.

---

## 4. Storage layout

```
vendors/<vendor>/
  source_study.json            # source-study output
  schedule.json                # schedule-analysis output
  <product>/
    advisories.json            # raw data keyed by advisory_id — the source of truth
    collector.json             # all metadata and state (schemas/collector.schema.json)
    research.json              # research agent's — never read, written or deleted here
    logs/<UTC start>.log       # one per run
    run/fetch_advisories.py    # the product's one script
scripts/core.py                # shared fetch engine (builder output)
scripts/collector.py           # this skill's output
requirements.txt               # five pinned deps (this skill's output, if missing)
```

Rules: `scripts/` holds Python only; vendor specifics live under `vendors/`. All writes atomic (tmp + `os.replace()`). Nothing is deleted except run logs beyond the newest 30 per target. `advisories.json` + `collector.json` are a target's complete state; `logs/` is diagnostics only.

### 4.1 `collector.json` — who writes what

The shape is `schemas/collector.schema.json`. Two writers, disjoint keys, each merging only its own:

| Keys | Writer |
|---|---|
| `target`, `status`, `builder_version`, `study`, `registry_hash`, `validated_at`, `last_dry_run_stats`, `repair`; `state.rejected[id].audit`; `state.failed[id].gave_up` | Collector agent |
| `state` (all else), `health`, `manifest`, `recent_runs`; `source_fingerprint` after a successful run | **Runtime** |
| `alerts` | Both — each adds and clears only its own codes |

The runtime honours `status` on every run (only `active` targets run) and never touches the agent's keys.

### 4.2 `requirements.txt` — written first, only if missing

```
requests==2.32.5
beautifulsoup4==4.14.2
lxml==6.0.2
jsonschema==4.25.1
apscheduler==3.11.0
```

`apscheduler` stays on 3.x. An existing file is left untouched. Never a sixth package (Playwright is installed separately when a study proves it necessary, and is never listed).

---

## 5. Classification (behind `--list`)

Every `(vendor_name, product_name)` in `registry.json` is a target keyed `<slug(vendor)>/<slug(product)>`.

**Slug rule** (one function, used everywhere a name becomes a path or key): lower-case; every character outside `a-z 0-9 . - _` → `_`; collapse runs of `_`; strip leading/trailing `_`. `NX-OS` → `nx-os`, `PAN-OS 10.x` → `pan-os_10.x`.

| Class | Condition |
|---|---|
| missing | No `collector.json` or no `run/fetch_advisories.py` |
| stale: registry | `registry_hash` ≠ current hash (5.1) |
| stale: study | `study.study_version` / `studied_at` ≠ `source_study.json` |
| stale: builder | `builder_version` < builder skill `version` |
| stale: core | `CORE_VERSION` in `scripts/core.py` < builder skill `core_version` (all targets) |
| broken / repairing | `status` says so |
| disabled | On disk, not in the registry |
| active | Everything else — the only class the daemon schedules |

### 5.1 `registry_hash`

```
sha256(canonical_json({
  "advisories":          products[].advisories if present else vendors[].advisories,
  "advisory_url":        vendors[].advisory_url,
  "advisory_id_pattern": vendors[].advisory_id_pattern,
  "csaf_url":            vendors[].csaf_url or null,
  "product":             the products[] entry minus updated_time and other script-maintained date-time fields
}))
```

`canonical_json`: sorted keys, `,`/`:` separators, UTF-8, `ensure_ascii=False`. Computed identically at build time (agent) and at every classification.

---

## 6. Scheduling (the daemon)

- apscheduler, one job per vendor from `vendors/<vendor>/schedule.json`: base `cron` with `jitter=jitter_s`, in `timezone`. During a `burst_windows[]` window the burst cron **replaces** the base for `duration_h`; bursts never stack. On firing, the vendor's active products run one after another, a few seconds apart.
- **Fallback** `DEFAULT_CRON = "0 */12 * * *"`, no jitter: no file, a file that fails `schemas`-style checks (bad cron, bad timezone), or `evidence.data_points < 10`.
- A run missed while the host was down executes once at start-up, never more.
- **Hot pickup:** before each run, re-read the target's `collector.json` and the vendor's `schedule.json`; hourly, rescan the registry and `vendors/` for new or removed targets. No restarts needed.
- Invalid registry at start-up → `critical` alert, refuse to start.
- Targets are isolated: one failing vendor never blocks another.

---

## 7. A collection run

### 7.1 Run the script

`python3 vendors/<v>/<p>/run/fetch_advisories.py --since <state.cursor>` (a `null` cursor = full backfill). The script reads `collector.json` read-only and handles its own retries, pacing, failed-ID retries and incomplete re-checks (builder skill, sections 3 and 5). The runtime passes nothing else on the command line and enforces only two things:

| Guard | Rule |
|---|---|
| Wall clock | 30 minutes, then stop cleanly. Status `timeout`: cursor unmoved, `consecutive_failures` and `last_success` unchanged, no failure alert. While `cursor` is still `null` (first backfill), reschedule 5 minutes later until a run completes — big backfills take several runs, each resuming where the last stopped |
| Exit code | `0` success · `1` partial · `2` failed (cursor must not move) · `3` config error (alert, not counted as a source failure) |

Never parse logs for the outcome; the exit code and the `RUN_SUMMARY {json}` stdout line are the contract.

### 7.2 Apply `RUN_SUMMARY` to `state`

| Summary field | State update |
|---|---|
| `new`, `updated` | Counted in the run record; `updated` IDs listed |
| `recovered` | Remove from `state.failed` |
| `failed[{id, status}]` | Add or update `state.failed[id]`: `status`, `attempts += 1`, `first_failed` (set once), `last_failed`; `reason` derived from status — `0` → `no_response`, `429`/`5xx` → `http_5xx`, other `4xx` → `http_4xx`. Entries with `gave_up` are never modified |
| `incomplete {id: {last_fetched, missing}}` / `complete` | Merge; remove completed IDs |
| `rejected[{id, reason, detail}]` | Add or refresh `state.rejected[id]` (`reason`, `detail`, `last_checked`, `count += 1`; `first_rejected` set once). An ID later stored is removed. `audit` is preserved as-is; a new rejection with a **different** `reason` clears it |
| `full_listing: true` | `state.last_full_listing = run start`; withdrawal tracking runs (section 9) |
| source fingerprint | Compared with stored (section 10); stored on a successful run |
| next cursor | `state.cursor`, only on exit code 0 |

### 7.3 Write

Atomic. Append the run record (section 11.1), refresh `health` and `manifest`, validate the file against the schema, then `os.replace()`. Prune logs beyond the newest 30.

---

## 8. Validation and the common schema

### 8.1 On store

The core already validates every record and rejects `date_published missing` and product mismatches. The runtime re-checks the shape against `schemas/advisory_record.schema.json` and the `advisory_id` key / pattern as a guard; a failure is a rejection with the reason, never a silent drop. A `null` workaround is normal data — never a warning.

### 8.2 `--normalize` — generated on demand, never stored

Prints one common-schema record per advisory to stdout:

```json
{
  "advisory_id": "cisco-sa-nxos-xyz",
  "vendor": "cisco",
  "product": "<vm_product_version>",
  "title": "<raw summary>",
  "summary": "<raw summary>",
  "cve_ids": ["CVE-2026-12345"],
  "version_affected": [ "<raw entries verbatim>" ],
  "workaround": "<string|null>",
  "date_published": "2026-09-10",
  "status": "active | withdrawn",
  "source_url": "<advisory_url with the ID substituted>",
  "additional_details": { "<copied whole>": "..." }
}
```

Only fields the raw record carries are mapped; nothing is invented. `status` is `withdrawn` when `state.withdrawn[id]` has `confirmed_at` or `missing_runs ≥ 3`. Severity, CVSS and fixed versions are **not** collected by the builder (its step 6 has no such fields), so they are absent here; adding them starts in the builder's step 6, not in this file.

---

## 9. Change and withdrawal tracking

A stored record is re-fetched only as a failed-ID retry or an incomplete re-check (builder section 5). Otherwise:

| Situation | Action |
|---|---|
| New ID | Store; `new` |
| Re-check gained or changed an important field | Replace; `updated` |
| Re-check found nothing new | Keep; move `incomplete[id].last_fetched` |
| Script reports the page says withdrawn | `state.withdrawn[id].confirmed_at = now`; keep the record |
| Full-listing run and a stored ID is absent | `state.withdrawn[id].missing_runs += 1` (create at 1) |
| ID seen again, not confirmed | Delete `state.withdrawn[id]` |
| A runner changed a stored record without reporting `updated` | Restore the stored version; warn |

---

## 10. Breakage detection (detect, never repair)

On any trigger: `status = broken`, alert, stop scheduling the target. Repair belongs to the agent.

**Fingerprint.** The core computes it and reports it in `RUN_SUMMARY`; the runtime compares it with `collector.json.source_fingerprint` (written by the agent at validation, refreshed by the runtime after each successful run):

```json
{
  "listing": { "content_type": "text/html", "status": 200, "item_count": 187, "structure_hash": "<sha256>" },
  "detail":  { "content_type": "text/html", "structure_hash": "<sha256>", "fields_found": { "summary": true, "workaround": true, "version_affected": true } }
}
```

`structure_hash`: HTML → DOM skeleton (tags + id/class, text removed); JSON → sorted key paths; XML → element paths.

| Trigger | Condition |
|---|---|
| Source change | `structure_hash` changed **and** a field ≥ 80 % populated over the baseline now returns nothing; or `content_type` changed; or the listing redirects to another host/path or answers 404/410 |
| Anomaly (baseline = last 30 runs) | 0 records while the median is > 0; more than 5× the median (product filter likely broke); `summary` / `version_affected` / `date_published` population below 50 % of baseline; more than 20 % of detail fetches rejected |

---

## 11. Health and alerts

### 11.1 Run record (`recent_runs`, newest first, capped at 30)

Exactly the schema's item shape:

```json
{
  "started": "...", "finished": "...", "exit_code": 0, "status": "success | partial | failed | timeout | config_error",
  "duration_s": 84, "full_listing": false, "ids_discovered": 12,
  "new": 7, "updated": 1, "recovered": 1, "failed": 0,
  "population": { "summary": 1.0, "version_affected": 0.95, "date_published": 1.0 },
  "rejected": [{ "id": "cisco-sa-xyz", "reason": "product mismatch", "detail": "primary: IOS XE only; text: IOS XE only" }],
  "http": { "requests": 41, "retries": 2, "429": 1, "5xx": 0 },
  "source_change_detected": false,
  "log": "vendors/cisco/nx-os/logs/2026-09-27T14-30-05Z.log"
}
```

`health` after every run: `last_run`, `last_success` (exit 0), `consecutive_failures` (exit 2 streak), `source_available`, `records_last_24h` (rolling `new + updated`), `schedule_next`. `manifest`: `records`, `latest_advisory`.

### 11.2 Alerts

`collector.json.alerts` holds the **open** alerts, keyed by code: `{ "<code>": { "message", "since" } }`. Raising an alert whose key exists is a no-op (no re-print); the key is deleted when the condition clears. Every raise prints one line to stdout (the daemon log). Alerts with no target (invalid registry) go to stdout only.

| Code | Level | Condition |
|---|---|---|
| `run_failures` | error | 3 consecutive `failed` runs |
| `listing_unreachable` | error | Listing unreachable > 24 h |
| `retry_exhausted` | warning | Any `state.failed[id].attempts ≥ 3` without `gave_up` — names the IDs and last status |
| `source_change` | warning | Section 10 source trigger (target also `broken`) |
| `anomaly` | warning | Section 10 anomaly trigger (target also `broken`) |
| `rejections` | warning | A rejection with any reason other than `product mismatch` — an in-scope advisory is being lost |
| `audit_due` | info | `state.rejected` entries without `audit` after the first completed backfill |
| `registry_invalid` | critical | At start-up; the daemon refuses to start |

The agent writes its own codes (`broken`, `coverage_gap`, `repair_done`, …) and clears them itself. An `error`, `warning` or `critical` line in the daemon log is the only signal that an AI session is needed.

---

## 12. Hard constraints

1. Executes the product scripts; never writes or edits them, the core, or `registry.json`.
2. Raw `advisories.json` is the source of truth; the common schema is never written to disk.
3. No third-party enrichment.
4. Detection only, never repair.
5. Python 3.11; only the five pinned dependencies.
6. Repo root from `__file__`, never from the working directory.
7. Writes only its own `collector.json` keys (4.1); every write validates against the schema.

---

## 13. Definition of done

`python3 -m scripts.validate runtime` checks the first three boxes (file exists, compiles, `RUNTIME_VERSION` equals this skill's `version`, loads both schemas `__file__`-relative, imports only the five packages). The rest are run by hand.

- [ ] `requirements.txt` exists with exactly the five pinned packages.
- [ ] `scripts/collector.py` compiles; `RUNTIME_VERSION` matches; schemas loaded `__file__`-relative.
- [ ] Only the five pinned dependencies are imported.
- [ ] `--list` prints the version header and every target with class and counts, from a directory other than the repo root.
- [ ] `--run-once <target>` maps the exit code to a status, appends a schema-valid run record with `log`, and the resulting `collector.json` validates against `schemas/collector.schema.json`.
- [ ] A run stopped at 30 minutes is `timeout`, cursor unmoved; a `null`-cursor target is rescheduled 5 minutes later.
- [ ] `state.failed`, `incomplete`, `rejected`, `withdrawn` are merged per 7.2 and 9; `audit` and `gave_up` survive every write.
- [ ] Jitter comes from `schedule.json.jitter_s`; a burst replaces the base cron for `duration_h`; a missing or invalid schedule falls back to `DEFAULT_CRON`.
- [ ] `--normalize` prints 8.2 and writes nothing.
- [ ] The daemon schedules only `active` targets and refuses to start on an invalid registry.

---

## 14. Changelog

| version | change |
|---|---|
| 1.0 | Initial. `collector.json` per `schemas/collector.schema.json` (keyed `failed` / `incomplete` / `rejected` / `withdrawn` maps, `alerts{code: {message, since}}`, typed run records); writer ownership (4.1); jitter and bursts from `schedule.json`; retry/pacing policy left to the core, runtime enforces only wall clock and exit codes; `timeout` status; stale-by-study classification; `--list` version header incl. schedule skill; severity/CVSS removed from `--normalize` (not collected) |
