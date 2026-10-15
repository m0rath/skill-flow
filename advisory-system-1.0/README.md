# Advisory collection system — 1.0

Everything at version 1.0: four skills, the collector agent, the runtime, the shared core, the validators, the schemas.

```
.claude/agents/collector.md                 the agent (judgment only; invokes the skills, judges results)
.claude/skills/source-study/                studies a vendor site once -> vendors/<v>/source_study.json
.claude/skills/advisory-script-builder/     study -> scripts/core.py (once) + vendors/<v>/<p>/run/fetch_advisories.py
.claude/skills/collector-runtime-builder/   -> scripts/collector.py (the daemon) + requirements.txt
.claude/skills/schedule-analysis/           stored dates -> vendors/<v>/schedule.json
scripts/core.py          CORE_VERSION 1.0   shared fetch engine; reads source_study.json, never the registry's hints
scripts/collector.py     RUNTIME_VERSION 1.0 daemon, --list, --run-once, --normalize; writes collector.json per the schema
scripts/validate.py                         builder-inputs / builder-output / source-study / schedule / runtime / collector
schemas/collector.schema.json               collector.json contract (two writers: agent and runtime, disjoint keys)
schemas/advisory_record.schema.json         one stored advisory (additional_details = builder step 6 keys)
templates/fetch_advisories.py               product-script skeleton (VENDOR, PRODUCT, STUDY_VERSION, STUDIED_AT + hooks)
templates/headers.json                      browser header fingerprint
tests/run_e2e.sh                            offline end-to-end test against tests/synthetic_vendor (no internet)
```

## Run the offline test

```
pip install -r requirements.txt
# the header fingerprint needs a browser version: `chromium --version` or `google-chrome --version` must work
bash tests/run_e2e.sh        # prints "ALL PASSED"
```

It starts a fake vendor on 127.0.0.1:8765 and drives the real code through: all validators, a dry run, a backfill,
a delta run, failed-ID retry/alert/recovery, product-mismatch rejection + audit override, withdrawal, source-change
detection -> broken, --check-ids, --normalize, and the schedule (jitter_s, Wednesday burst). It restores registry.json
and removes vendors/acme afterwards.

## First real target (what the agent will do)

1. `python3 -m scripts.validate builder-inputs cisco IOS --reason new_target` -> blocked `study_missing`
2. source-study skill -> `vendors/cisco/source_study.json`; `python3 -m scripts.validate source-study cisco`
3. advisory-script-builder -> `vendors/cisco/ios/run/fetch_advisories.py`; `validate builder-output cisco/ios`;
   `python3 vendors/cisco/ios/run/fetch_advisories.py --dry-run --limit 5` from another directory
4. agent writes `collector.json` (agent section 3.2); `validate collector cisco/ios`
5. daemon backfills on DEFAULT_CRON; after the first full run, schedule-analysis -> `vendors/cisco/schedule.json`

## Notes

- `registry.json` still carries `parameter_mapping`. The builder ignores it; the source-study skill reads only the
  `_note` tips. The long "how to fetch" prose there belongs in each vendor's `source_study.json` now.
- Severity / CVSS are not collected (not in builder step 6). Add them there and in the study before mapping them anywhere.
- Weekday numbers in crontab (0 = Sunday) are translated for apscheduler (0 = Monday) in `crontab_trigger()`;
  write schedule.json in standard crontab terms.
- The runtime derives `state.failed[id].reason` from the HTTP status (`no_response` / `http_4xx` / `http_5xx`)
  because `RUN_SUMMARY.failed[]` carries only `{id, status}`.
