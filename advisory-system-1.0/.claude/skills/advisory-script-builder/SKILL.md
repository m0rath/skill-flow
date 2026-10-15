---
name: advisory-script-builder
description: Writes the Python code that fetches security advisories for one vendor-product pair, built entirely from the vendor's source_study.json (the output of the source-study skill). Produces the shared fetch core (scripts/core.py, first build only) and one self-contained fetch script per product, then tests it with a dry run. One-time build task - the generated scripts run forever on a scheduler without AI. Use only when the collector agent needs a script built or rebuilt.
version: "1.0"
core_version: "1.0"
---

# Advisory Script Builder

## 0. In one paragraph

The **source-study skill** studies a vendor's website once and writes `vendors/<vendor>/source_study.json`. **This skill** reads that file and turns it into code: one shared core (`scripts/core.py`) plus one script per product (`vendors/<vendor>/<product>/run/fetch_advisories.py`) that downloads the product's advisories into `advisories.json`. It then **tests** the script with `--dry-run --limit 5` and hands the result to the collector agent. It never studies a website itself, never collects data for real, and never writes `collector.json`.

The flow is always: **study → build → test → hand off**.

```
source-study skill            this skill                               scheduler (no AI)
───────────────────           ──────────────────────────────────────   ─────────────────
vendors/<v>/source_study.json ──► scripts/core.py (first build only)   runs the script
                                  vendors/<v>/<p>/run/fetch_advisories.py ──► advisories.json
                                  --dry-run --limit 5  (the test)
                                  result JSON ──► collector agent
```

---

## 1. When this skill runs

Only the collector agent (`.claude/agents/collector.md`) invokes it, stating `vendor_name`, `product_name` and **one or more triggers**:

| `reason` | Meaning | Extra input the agent passes |
|---|---|---|
| `new_target` | The vendor-product pair has no script yet | — |
| `registry_changed` | The target's URLs or names in `registry.json` changed | — |
| `study_changed` | `vendors/<vendor>/source_study.json` is newer than what the script was built from (`studied_at` or `study_version` differ from the values stamped in `collector.json`) | the old `study_version` and `studied_at` |
| `repair` | The vendor changed their site and parsers broke, or a validation retry | a `failure_report` (section 2.3) |
| `spec_changed` | This skill's `version` is newer than the target's `collector.json.builder_version` | the old `builder_version` |

Rules:

- The agent states the trigger(s). This skill never infers one by diffing state.
- Several triggers can apply at once — satisfy all of them in one build.
- **No trigger stated** → `outcome: "blocked"`, `blocked_reason: "invalid_invocation"`.
- **Triggers stated but the target is provably current** (script exists, registry entry unchanged, study unchanged, `builder_version` equals `version`, nothing broken) → `outcome: "not_needed"`, write nothing. "Provably" means the registry and the study were actually read (stages B and E passed).

### 1.1 Invocation order

Every invocation runs these stages in order. A stop at A–E writes no files and makes no HTTP requests.

**Stages A–E are one command**, run first with the inputs exactly as given:

```
python3 -m scripts.validate builder-inputs "<vendor_name>" "<product_name>" \
    --reason <trigger> [--reason <trigger>…] [--failure-report <file>]
```

If it exits 1, copy its `blocked_reason` / `blocked_detail` into the section 11 result and stop. If it exits 0, all of stages A–E passed; continue to stage F (the listing probe).

| Stage | Checks | Stop outcome |
|---|---|---|
| **A. Repo resources** | `templates/fetch_advisories.py` exists; `templates/headers.json` and `schemas/advisory_record.schema.json` exist and parse | `blocked` / `resources_missing` |
| **B. Registry and inputs** | `registry.json` parses; `vendor_name` / `product_name` match exactly (2.0); required keys present (2.1); no slug collision (section 3) | `blocked` / `invalid_registry` |
| **C. Trigger decision** | At least one trigger stated; target not provably current | `blocked` / `invalid_invocation`, or `not_needed` |
| **D. Failure report** | Only for `repair` or when a report is given: shape of 2.3 | `blocked` / `invalid_failure_report` |
| **E. Source study** | `source_study.json` exists, is complete, and is usable (2.4) | `blocked` / `study_missing`, `study_incomplete`, `study_stale`, `auth_required` |
| **F. Listing probe** | The listing answers over `requests` (or Playwright, only if the study declared the fallback) | `blocked` / `listing_unreachable` |
| **G. Build and test** | Write core (first build / migration) and product script; run the definition of done (section 10) | `built`, or `failed` |
| **H. Hand-off** | Print the section 11 result JSON to stdout. Always runs | — |

The hand-off is the last thing printed; stdout is the only channel the agent reads.

---

## 2. Inputs

| Input | What it is |
|---|---|
| `registry.json` | Repo-root registry: URLs, names, ID pattern (2.1). **Carries no field locations.** |
| `vendor_name`, `product_name` | Exact registry values (2.0) |
| `reason` | The trigger(s) from section 1 |
| `source_study.json` | `vendors/<vendor>/source_study.json` — **the only source of selectors, JSON paths, pagination, product names and quirks** (2.4) |
| `failure_report` | On `repair`: what broke (2.3) |

Never fetch advisories for other products, even if they appear on the same page.

### 2.0 Input validation (stage B)

`vendor_name` and `product_name` must match a registry entry exactly — case-sensitive, no trimming. Only the *matched registry value* becomes a folder name. Never build a path from an unvalidated input.

### 2.1 Registry schema (the parts the script reads)

```json
{
  "vendors": [
    {
      "vendor_name": "<string>",
      "advisory_id_pattern": "<regex>",     // every advisory ID matches it
      "advisories": "<url>",                // listing page or API
      "advisory_url": "<url template>",     // detail page, contains {advisory_id}
      "csaf_url": "<url template>",         // OPTIONAL CSAF twin, contains {advisory_id}
      "products": [
        {
          "product_name": "<string>",
          "vm_product_version": "<string>",
          "advisories": "<url>",            // OPTIONAL product-scoped listing (overrides vendor-level)
          "updated_time": "<ISO-8601 or empty>",
          "output_file": "...", "allowed_functions": [], "cli_reference": "..."   // NOT read by this script
        }
      ]
    }
  ]
}
```

- Stage B requires `advisory_id_pattern`, `advisory_url` and an `advisories` URL (vendor- or product-level).
- The script reads only `advisories`, `advisory_url`, `csaf_url`, `advisory_id_pattern`, `product_name`, `vm_product_version`, `updated_time`. It may write back `updated_time` (atomically: tmp file + `os.replace()`).
- **`csaf_url` — CSAF first, detail page as fallback, per field:**

  | Field | First choice | Fallback |
  |---|---|---|
  | `cve_ids`, `version_affected`, `affects_product()` | CSAF | detail page |
  | `summary`, `workaround`, `additional_details.security_details` | detail page | CSAF `notes` / `remediations` |
  | `date_published` and the other `additional_details` fields | detail page | CSAF |

  No `csaf_url` → detail page only. CSAF 404 → page only, not re-checked. CSAF non-404 failure or non-JSON body → page only, advisory marked incomplete with `csaf` in `missing` (section 5). Never mix CSAF and page entries inside one `version_affected`; each entry's `source` says where it came from.

### 2.2 Code constraints

- Python 3.11 compatible.
- Third-party imports: only `requests`, `beautifulsoup4`, `lxml`, `jsonschema`. `playwright` only when `source_study.json` has `headless_fallback.needed: true` with evidence.
- No credentials, cookies or browser by default — plain anonymous `requests`.
- Repo root is located from `__file__`, never from the working directory, never absolute.

### 2.3 `failure_report` shape (stage D)

Required for `repair`. `target`, `attempt`, `phase` (`"validation"` | `"self-heal"`) and `reason` non-empty; `failing_fields` present when `phase` is `"validation"`.

```json
{
  "target": "cisco/nx-os",
  "attempt": 2,
  "phase": "validation | self-heal",
  "reason": "<one line>",
  "stats": { "<failing --dry-run stats>": "..." },
  "failing_fields": ["version_affected"],
  "fingerprint_diff": { "<self-heal only>": "..." },
  "http_evidence": [{ "url": "...", "status": 403, "note": "..." }],
  "snapshots": ["<URLs of pages that changed>"]
}
```

Fix exactly what the report shows. Never widen a repair into a rewrite.

### 2.4 What the builder reads from `source_study.json` (stage E)

This is the contract between the two skills. The source-study skill (version 1.0) writes the keys in the left column; the builder uses each one exactly where the right column says. **Nothing in the parser comes from anywhere else.**

| Study key | Used in | How |
|---|---|---|
| `vendor`, `study_version`, `studied_at` | stage E, section 11 | `vendor` must equal `vendor_name`. `study_version` and `studied_at` are stamped into the script (`STUDY_VERSION`, `STUDIED_AT`) and reported in the result so the agent can detect `study_changed` later |
| `listing.content_type` | step 2 | Picks the parser (`json` / `xml` / `html` / `text`) |
| `listing.real_endpoint` | step 1 | When not `null`, the listing is a JS shell: fetch **this** URL with `requests`, never the shell |
| `listing.pagination`, `listing.pagination_example` | step 3 | The scheme and the worked template become the pagination loop |
| `listing.product_filter` | step 4 | A server-side filter is used verbatim; `"client-side"` means filter after listing, before detail fetches |
| `listing.rows_have_dates` | step 5, section 5 | Decides whether `--since` pruning and the 7-day re-check rule apply |
| `listing.feed` | step 3 | Informational; the registry `advisories` URL stays the listing. Noted in `notes` |
| `listing.coverage` | section 11 | `reaches_full_history: false` → reported in `notes` with `gap` and `alternative_discovery`. The script does **not** use an alternative route on its own (IDs come only from the registry listing); a human decides whether to change the registry URL |
| `product_match.primary`, `.text_fallback` | step 7 | The two sources `affects_product()` reads, in that order |
| `product_match.names.match`, `.never_match` | step 7 | Exact spellings to accept; sibling products that must never count |
| `product_match.old_document_example` | section 10 | Used as a `--check-ids` test case on rebuilds |
| `fields.<f>.location`, `.notes` | step 6, step 7 | One `parse_<f>()` per field, built from the location; the notes drive quirk handling |
| `fields.title` | step 6 | Fallback for `summary` when `fields.summary` is absent or empty |
| `fields.date_published` | step 6 | The **full fallback chain** the study recorded, applied in order down to revision-history text |
| `fields.affected_products.kinds`, `.bound_convention` | step 6 version contract | Which `kind`s the parser must handle; `bound_convention` sets `to_inclusive` / `from_inclusive` for ranges |
| `fields.other_details.*` | step 6 | Map 1:1 to record `additional_details.*` (same sub-keys; the record key is `additional_details`, the study calls the group `other_details`) |
| `variations` | step 7 | Each listed variation must be handled by the parsers (present/absent sections, single/multi-product tables) |
| `workaround_sentinel` | step 7, section 11 | The vendor's "no workaround" boilerplate. Still stored **verbatim** in `workaround`; the dry run counts how many records equal it (`workaround_sentinel_hits`) so the agent sees it is being matched |
| `unresolved_hints` | step 6 | Each listed field falls back to the step 6 default rule; echoed in `notes` |
| `headless_fallback` | step 1 | `needed: true` with `evidence` is the only permission to import Playwright |
| `auth` | stage E | `required: true` → stop with `blocked` / `auth_required` (the generated code never carries credentials; a human decides) |
| `rate_limit` | step 8 | Request pace for the session; absent → the default 2 req/s per host |

**Stage E is complete when all of these hold** (checked by `scripts.validate builder-inputs`):

| Check | Failure |
|---|---|
| File exists at `vendors/<vendor>/source_study.json` and parses | `study_missing` |
| `vendor` equals `vendor_name`; `study_version`, `studied_at`, `listing`, `product_match`, `fields` present | `study_incomplete` |
| `listing` has `content_type`, `pagination`, `pagination_example`, `product_filter`, `rows_have_dates`, `coverage` | `study_incomplete` |
| `product_match` has `primary`, `text_fallback`, `names.match` (non-empty), `names.never_match` | `study_incomplete` |
| `fields` has every core field (`title`, `advisory_id`, `cve_ids`, `advisory_url`, `date_published`, `workaround`, `summary`, `affected_products`) and `other_details` — each with a `location` (string or `null`) or listed in `unresolved_hints` | `study_incomplete` |
| `fields.affected_products.kinds` is a non-empty list | `study_incomplete` |
| `workaround_sentinel` key present (value may be `null`); `headless_fallback.needed` present, with `evidence` when true | `study_incomplete` |
| `study_version` is one this builder understands (currently `1.0`) | `study_stale` |
| `auth.required` is not `true` | `auth_required` |

A field the study examined and recorded as **absent** (`location: null` with a note such as "not present") is not a blocker: its parser returns `None`.

---

## 3. What to build (architecture)

```
scripts/
  core.py                       # ONE shared engine for all vendors: registry, session, pagination, delta, storage
vendors/
  <vendor>/
    source_study.json           # input (from the source-study skill) — never written here
    <product>/
      advisories.json           # output (section 6)
      logs/<datetime>.log       # one log per run (UTC start time)
      run/fetch_advisories.py   # the product's ONE script: parsers + a call into scripts/core.py
```

- **Core:** vendor-agnostic, written once on the first build, migrated only when `core_version` is newer than its `CORE_VERSION`. Vendor behaviour goes through hooks in the product script, never into the core. **Otherwise (core already exists and its `CORE_VERSION` already equals `core_version`):** skip core work entirely — no write, no migration, no stop — and continue straight to writing the product script.
- **One script per product, nothing at vendor level.** Products of the same vendor each carry their own copy of the parsing code — deliberate, so fixing one never breaks another. For a second product, start from the sibling's script and adapt it.
- **Folder slug:** lower-case; spaces and anything outside `a-z 0-9 . - _` → `_`; runs of `_` collapse. `PAN-OS` → `pan-os`. The slug is only a filesystem transform of a validated registry value.
- **Slug collisions** (`NX OS` and `NX-OS` both → `nx-os`) are caught at stage B.

Two versions in this file's frontmatter; **every edit to this skill bumps one and adds a changelog entry (section 12):**

- `version` — the product-script spec. The agent stamps it into `collector.json.builder_version`.
- `core_version` — the shared core's spec. `scripts/core.py` declares `CORE_VERSION`; when older, the core is migrated once before any product script is rebuilt. Bump only for changes to the core (fetching, delta, validation, storage, hook interface, CLI, exit codes).

### Repo resources (use, don't re-derive)

| File | What it is |
|---|---|
| `templates/fetch_advisories.py` | Product-script skeleton: path setup, `VENDOR` / `PRODUCT` / `STUDY_VERSION` / `STUDIED_AT` constants, hook stubs, the call into the core |
| `templates/headers.json` | Full browser header fingerprint with `{chrome_major}` placeholder, plus the per-OS command to read the installed version |
| `schemas/advisory_record.schema.json` | JSON Schema for one record; loaded `__file__`-relative and validated with `jsonschema` |
| `knowledge/playbook.md` | Shared source-pattern knowledge base; consult when a fetch behaves unexpectedly |

---

## 4. Build steps

Two registry URLs, two jobs — never mix them:

- The **listing** URL discovers advisory IDs. Nothing else.
- The **detail** URL (`advisory_url` with `{advisory_id}`) is where every field comes from.

### Step 1 — Open the listing (the stage F probe)

1. URL: `products[].advisories` if present, else `vendors[].advisories`. If the study's `listing.real_endpoint` is not `null`, the page is a JS shell — fetch that endpoint instead (with the page's `Referer`), still with `requests`.
2. Headers: the **complete** fingerprint from `templates/headers.json`, `{chrome_major}` filled from the installed browser. Never a trimmed or made-up set, never a bot pattern, never personal identifiers. Advertise only encodings the client can decode.
3. Follow redirects; timeout ≥ 30 s; 3 retries with exponential backoff on 5xx / connection errors; honour `Retry-After`.
4. Playwright only when `headless_fallback.needed` is `true` in the study. Declare it in a code comment and the run log with the study's evidence.
5. If `requests` (and Playwright where permitted) fail → `blocked` / `listing_unreachable` with every attempt's URL, status and note. Nothing has been written yet.
6. If the listing is reached successfully, continue to Step 2 (parser selection).

### Step 2 — Parser for the listing

Take `listing.content_type` from the study, confirm it against the live response, and record the decision in a code comment:

| Type | Parse with |
|---|---|
| `json` | `json` |
| `xml` (incl. RSS/Atom) | `xml.etree` / `lxml` |
| `html` | `BeautifulSoup` (lxml parser) |
| `text` / CSV | line / CSV parser |

If the live type contradicts the study, stop and report it in `notes` as evidence for a re-study — do not improvise. If the live type matches the study, continue to Step 3 (pagination).

### Step 3 — Pagination

Implement `listing.pagination` using `pagination_example.template`; verify with `pagination_example.worked`. Loop until no next page, an empty page, or all items older than `--since` (section 5). Never hard-code a page count.

**Safety net (core):** cap at **500 pages**; stop if a page yields no unseen ID. Either → log an error, exit 2, cursor unmoved.

### Step 4 — Narrow to the requested product

`listing.product_filter` from the study: a server-side filter is used verbatim; `"client-side"` means filter the listing by `product_match.names` **before** any detail fetch. Never fetch detail pages for other products.

### Step 5 — Collect the IDs to fetch

- Collect `(advisory_id, date_published, date_updated)` per matching row (`date_updated` only when `rows_have_dates`).
- Every ID must match `advisory_id_pattern`; mismatches are logged as warnings and skipped (a burst signals a source change).
- Deduplicate. Keep an ID when it is new, in `state.failed`, or an incomplete advisory due for re-check (section 5).
- Sort oldest → newest so an interrupted run is resumable.

### Step 6 — Fields to extract

Every field is resolved from the study's `fields` block. The default rule applies only when the location is `null`, listed in `unresolved_hints`, or finds nothing on the page.

| Record field | Study location | Default rule when unresolved / absent |
|---|---|---|
| `advisory_id` | `fields.advisory_id` | The listing ID, confirmed on the detail page; must match `advisory_id_pattern` |
| `cve_ids` | `fields.cve_ids` | The advisory's own CVE field; else every `CVE-\d{4}-\d{4,}` in the body. Deduplicated, page order. `[]` only when none exist |
| `summary` | `fields.summary`, then `fields.title` | Title / summary paragraph |
| `advisory_url` | *(not read; `fields.advisory_url` is recorded only)* | Always the registry template with `advisory_id` substituted. If the study's location differs, say so in `notes` |
| `version_affected` | `fields.affected_products` (`.kinds`, `.bound_convention`) | Every affected version as the vendor defines it, as **version-contract objects** (below). Never a bare string |
| `workaround` | `fields.workaround` | Section titled Workaround / Mitigation / Recommended Actions. Stored verbatim, even when it equals `workaround_sentinel` |
| `additional_details.date_published` | `fields.date_published` (full chain) | Each fallback in the study's order, down to the earliest revision-history date. None → record rejected with `date_published missing` |
| `additional_details.cwe_capec_mitre` | `fields.other_details.cwe_capec_mitre` | Only if present; may list several |
| `additional_details.security_details` | `fields.other_details.security_details` | Solution / fixed software / required configuration / exploitation status / technical details — verbatim, line breaks kept, page order. **Hidden mitigations live here** |
| `additional_details.bug_details` | `fields.other_details.bug_details` | List of `{ "<bug_id>": "<description>" }`, best-effort (one extra request per ID; failure → `null` description, never fails the advisory) |
| `additional_details.impact` | `fields.other_details.impact` | Only if present |
| `additional_details.discovered` | `fields.other_details.discovered` | Only if present |
| `additional_details.attack_type` | `fields.other_details.attack_type` | Only if present |
| `additional_details.reference` | `fields.other_details.reference` | Only if present; may list several |

Rules: a `null` location means "try the default rule, then **omit the key**" — never write an empty string. Extract nothing that is not in this table.

**Version contract** — every `version_affected` entry:

| Field | Rule |
|---|---|
| `product` | Required; the vendor's full name (`Cisco IOS`, `PAN-OS`). Must be the target per `product_match.names`; a `never_match` product is dropped with a warning |
| `kind` | Required: `exact`, `range`, `branch`, or `all` — only kinds listed in `fields.affected_products.kinds` are expected; a new one is logged and reported in `notes` |
| `version` | Required for `exact` and `branch` |
| `from` / `to` | For `range`; `null` = open; at least one set |
| `from_inclusive` / `to_inclusive` | Required for every set bound. From the source (CVE-5 `lessThan` → `false`, `lessThanOrEqual` → `true`; CSAF `vers:` `<` / `<=`; prose per the study's `bound_convention`). Unknown → `null` plus a warning; never guessed |
| `raw` | Required; the vendor's own text or the exact source value |
| `source` | `csaf`, `cve5.versions`, `listing`, `html`, `text`, or a vendor field name |

Store every form the vendor publishes (versions *and* ranges), only entries marked affected, never expanding or collapsing.

### Step 7 — One parser function per field

- All hooks live in `run/fetch_advisories.py`: `parse_cve_ids(doc)`, `parse_summary(doc)`, `parse_version_affected(doc, product)`, `parse_workaround(doc)`, `parse_additional_details(doc, fields)` (where `fields` is the study's `other_details.*` plus `date_published`, each as `{location, notes}`), plus the listing hooks `listing_request`, `parse_listing`, `detail_url` and the checks `affects_product`, `is_withdrawn` — exactly the template's hook set, one `parse_*` per step 6 field, each built from the study's `location` and `notes`.
- Each `variations` entry in the study is handled explicitly (section present vs absent, single vs multi-product table, etc.).
- A parser returns the value or `None`; it logs a warning instead of raising.
- Normalise: strip and collapse whitespace, but keep line breaks in `workaround` and `security_details`. Never reword. Dates → `YYYY-MM-DD`.

**`affects_product(doc, product) -> True | (False, detail) | None`** reads the two study sources in order:

1. `product_match.primary` (structured). Names the target as affected → `True`.
2. `product_match.text_fallback` (prose). Names the target → `True`, even when the structured source listed hardware families or nothing.

| Result | When | Core's action |
|---|---|---|
| `True` | Either source names the target | Store |
| `(False, detail)` | Both sources read, neither names the target | `rejected`, reason `product mismatch` |
| `None` | The data could not be read (fetch failed) | `state.failed`, retried next run — never a rejection |

`never_match` products never count. A text-accepted advisory takes `version_affected` from that prose (`source: "text"`); no versions named → `[]`, which makes it incomplete.

### Step 8 — Fetch details and store

- Build the URL from `advisory_url`, fetch, parse, **write to disk after each advisory**.
- Pace: the study's `rate_limit` if set, else ≤ 2 req/s per host. Retries with backoff, honour `Retry-After`.
- Per-advisory retry (core): 3 retries on 5xx / connection errors; exhausted → `state.failed` with last status (0 if no response), log, continue. A 4xx other than 429 is recorded once, not retried.

---

## 5. Delta and resume

The scheduler decides *when*; the script makes every run incremental and interruptible.

- `--since <cursor>`: resume point for discovering new IDs. No `--since` → **full backfill** (no depth limit; only the 500-page cap). The registry's `updated_time` is **never** a resume point.
- Load `advisories.json` first (missing → `{}`). Read `collector.json` read-only (the runtime writes it from `RUN_SUMMARY`).
- **Every advisory is stored**, workaround or not. Missing fields → `null` / `[]` / absent key.
- **Download what we don't have.** Re-download a stored advisory only in the two cases below.
- **Case 1 — retry failed downloads:** every `state.failed` entry (unless `gave_up`) is fetched by its detail URL on every run.
- **Case 2 — re-check incomplete advisories** (CSAF missing, or empty `workaround`, `cve_ids`, `version_affected`, `security_details`): re-fetch when the listing row's updated date is newer than `last_fetched`, or — when `rows_have_dates` is false — when last fetched > 7 days ago. A full listing scan runs at most once per 24 h (`state.last_full_listing`). A fresh copy that fills or changes an important field and validates **replaces** the record (`updated`); it never removes information. A failed re-check keeps the record, leaves `last_fetched` alone, reports `recheck_failed`.
- `gave_up` IDs are never fetched.
- `--limit N` (manual aid) caps downloads + retries + re-checks, oldest first.
- After a successful full run, set the product's `updated_time` to the run start (ISO-8601, UTC).
- `--dry-run` ignores cursors and takes the **5 newest** matching advisories.
- **Remembered rejections:** `product mismatch` IDs are skipped until the row updates or 30 days pass — unless `audit.verdict` is `wrong`. Other reasons are retried every run.
- `--check-ids <id>[,<id>…]`: fetch each ID, run all parsers and `affects_product()`, print one JSON per ID (`id`, `affects_product`, `detail`, `date_published`, `cve_ids`, `version_affected`, `validation_errors`). Writes nothing.
- All writes atomic (`.tmp` + `os.replace()`). Re-running after an interruption continues with no duplicate work.

---

## 6. Output format

`vendors/<vendor>/<product>/advisories.json` — one object keyed by `advisory_id`:

```json
{
  "<advisory_id>": {
    "advisory_id": "<same as the key>",
    "cve_ids": ["CVE-2026-12345"],
    "summary": "<string | null>",
    "version_affected": [
      { "product": "<full name>", "kind": "exact", "version": "<v>", "raw": "<vendor text>", "source": "<where>" },
      { "product": "<full name>", "kind": "range", "from": "<v|null>", "from_inclusive": true,
        "to": "<v|null>", "to_inclusive": false, "raw": "<vendor text>", "source": "<where>" }
    ],
    "workaround": "<string | null>",
    "additional_details": { "date_published": "YYYY-MM-DD", "<other step 6 keys>": "..." }
  }
}
```

- The six core keys are always present. `additional_details` holds only step 6 keys.
- A missing workaround is normal: store `null`, log at INFO, never skip.
- UTF-8, `indent=2`, `ensure_ascii=False`, sorted keys.

---

## 7. Script shape, CLI, exit codes

```
python vendors/<vendor>/<product>/run/fetch_advisories.py [--dry-run] [--limit N] [--since <cursor>] [--check-ids <ids>] [--registry <path>]
```

Built from `templates/fetch_advisories.py`: keep its path setup and `main(...)` call; fill `VENDOR`, `PRODUCT`, `STUDY_VERSION`, `STUDIED_AT`; implement the hooks.

**`RUN_SUMMARY`** — every non-dry run ends with one stdout line `RUN_SUMMARY {json}` carrying: `new`, `updated`, `recovered`, `failed` (`[{"id","status"}]`), `incomplete` (`{id: {"last_fetched","missing":[…]}}`), `complete`, `rejected` (`[{"id","reason","detail"}]`), `full_listing`, listing IDs seen, HTTP counters, source fingerprint, log path, next cursor.

| Exit | Meaning |
|---|---|
| 0 | success — cursor may advance |
| 1 | partial — some detail fetches failed (`state.failed`) |
| 2 | failed — listing unreachable, page cap hit, or aborted; cursor must not move |
| 3 | config error — bad registry, unknown target, bad arguments |

**Run logging (core):** one file per run at `logs/<UTC start, e.g. 2026-09-27T14-30-05Z>.log`, also streamed to stdout. `--dry-run` and `--check-ids` log to stdout only.

### 7.1 The test: `--dry-run --limit 5`

This is the validation contract: listing plus 5 detail fetches, nothing written, exactly one JSON object on stdout:

```json
{
  "target": "cisco/nx-os",
  "dry_run": true,
  "study": { "study_version": "1.0", "studied_at": "<ISO-8601>" },
  "ids_discovered": 12,
  "records": { "<advisory_id>": { "<section 6 record>": "..." } },
  "rejected": [ { "id": "...", "reason": "product mismatch", "detail": "..." } ],
  "stats": {
    "records": 5,
    "schema_valid_rate": 1.0,
    "cve_ids_populated": 1.0,
    "summary_populated": 1.0,
    "version_affected_populated": 0.8,
    "version_kind_mix": { "exact": 0.9, "range": 0.1 },
    "version_product_match_rate": 1.0,
    "version_source_mix": { "csaf": 1.0, "page": 0.0 },
    "date_published_parse_rate": 1.0,
    "product_match_rate": 1.0,
    "workaround_sentinel_hits": 2,
    "study_field_coverage": { "workaround": 0.6, "security_details": 1.0, "impact": 0.0 }
  }
}
```

| Stat | Meaning |
|---|---|
| `schema_valid_rate` | Records passing `schemas/advisory_record.schema.json` |
| `cve_ids_populated` | Records with ≥ 1 CVE |
| `version_kind_mix` | Share of each `kind`; compared with the previous build — a kind appearing or disappearing goes in `notes` |
| `version_product_match_rate` | `version_affected` entries whose `product` is the target |
| `version_source_mix` | Records whose versions came from CSAF vs page (only with `csaf_url`) |
| `date_published_parse_rate` | Records with a `YYYY-MM-DD` `date_published` |
| `product_match_rate` | Fetched advisories for which `affects_product()` returned `True` — below 1.0 means the filter or the hook is wrong |
| `workaround_sentinel_hits` | Records whose `workaround` equals the study's `workaround_sentinel` (0 when the sentinel is `null`) |
| `study_field_coverage` | For every field whose study `location` is **not** `null`: the fraction of records where the parser found it. A `0.0` here on a field the study says exists is a parser bug, not a vendor gap |

A completed dry run exits 0 **even with poor numbers** — the thresholds belong to the agent. Never tune a parser to inflate a stat; check `source_study.json` to decide whether a low number is a bug or an honest gap.

### 7.2 Core layout

```
CORE_VERSION = "<x.y>"                 # equals this skill's core_version
load_registry()                        # validates, returns vendor + product entries (exit 3 on failure)
check_hooks(module)                    # product script defines every required hook and constant
setup_logging(target)                  # log file + stdout (stdout only on --dry-run / --check-ids)
Http(interval)                         # requests.Session: full browser headers, 3 retries with backoff, pacing from the study's rate_limit
detect_type(response)                  # "json" | "xml" | "html" | "text"
iter_listing(...)                      # (advisory_id, date_published, date_updated); pagination + 500-page cap + product filter
fetch_advisory(id)                     # section 6 record via the product script's hooks; per-advisory retry policy
Store.load() / Store.add() / Store.save_atomic()
main(vendor, product, argv, parser)    # parser = the calling product script's module
```

---

## 8. Source playbook

`knowledge/playbook.md` (repo root) holds field-proven source patterns. Consult it when a fetch behaves unexpectedly. Vendor-specific findings are already in `source_study.json`.

---

## 9. Hard constraints

1. Only the requested vendor-product.
2. Only the fields in step 6 — no full page text, no third-party enrichment, no CVSS math.
3. No mitigation or CLI generation.
4. Output schema is exactly section 6.
5. Deterministic and resumable.
6. Log, don't guess. Never fabricate values.
7. Never write before stage F passes.
8. **Never study the source yourself and never edit `source_study.json` or `registry.json`.** A study gap is reported in `notes` for a re-study; a registry fault is `invalid_registry`.

---

## 10. Definition of done (stage G) — build, then test

Every box must tick. Iterating inside the invocation is normal and unlimited. If a box cannot tick, return `outcome: "failed"` naming it with evidence. Never hand over `built` with an unticked box; never bend a constraint to force one. Otherwise (every box ticks), continue to stage H (section 11) and print the hand-off result with `outcome: "built"`.

**Build checks**

- [ ] `python3 -m scripts.validate builder-output <vendor>/<product>` passes: core and script exist and compile; `CORE_VERSION` equals `core_version`; schema loaded `__file__`-relative; every template hook defined; `VENDOR` / `PRODUCT` are the exact registry values; `STUDY_VERSION` / `STUDIED_AT` equal the study file; only allowed imports (Playwright only if the study declared the fallback); no `vendors/<vendor>/*.py`.
- [ ] One `parse_*` function per step 6 field, each traceable to a study `location` (or to the default rule for a field the study marked `null` / unresolved).
- [ ] `affects_product()` reads both `product_match` sources and returns `None` (never `False`) when data could not be read.
- [ ] `registry.json` untouched.

**Test checks**

- [ ] `python3 vendors/<vendor>/<product>/run/fetch_advisories.py --dry-run --limit 5` exits 0 **from a directory other than the repo root** and prints the 7.1 JSON.
- [ ] `study_field_coverage` has no `0.0` for a field the study locates — or the gap is explained in `notes` by the study's own `notes` for that field (e.g. "only present on advisories with a fix").
- [ ] Every `variations` entry from the study appears in at least one dry-run record or `--check-ids` result, or is noted as not sampled.
- [ ] On rebuild or repair: `--check-ids` over every ID in `state.rejected`, the last `recent_runs[].rejected`, and the study's `product_match.old_document_example`; verdicts in `notes`. No previously stored ID may become a rejection.
- [ ] On `spec_changed`: the regression guard (section 12) passes. When `spec_changed` is not among the stated triggers, this box is not applicable and counts as ticked; continue to the test checks.

---

## 11. Hand-off — every invocation ends with a result (stage H)

```json
{
  "outcome": "built | not_needed | blocked | failed",
  "blocked_reason": "<code below — only when blocked>",
  "blocked_detail": "<one line of specifics — only when blocked>",
  "failed_check": "<the box that cannot tick, plus evidence — only when failed>",
  "files_written": ["scripts/core.py", "vendors/<vendor>/<product>/run/fetch_advisories.py"],
  "core_created": false,
  "core_migrated": false,
  "headless_fallback": false,
  "study": { "study_version": "1.0", "studied_at": "<ISO-8601>" },
  "dry_run_stats": { "<7.1 stats block from the final test run>": "..." },
  "applied_changes": ["<changelog versions applied, on spec_changed>"],
  "notes": ["<source lacks field X per study>", "<unresolved hint Y used default rule>", "<coverage gap>", "<--check-ids verdicts>"]
}
```

- `built`: all section 10 boxes ticked; carries `dry_run_stats` and `study`. The agent judges the stats, then writes `collector.json` itself (stamping `builder_version`, `study_version`, `studied_at`). **This skill never writes `collector.json`.**
- `not_needed` and `blocked`: no files written (`files_written` is `[]`).
- `failed`: files may exist; harmless because the agent activates nothing without `built`. Counts as one of the agent's 3 attempts.

| `blocked_reason` | Stage | Cause | Agent action | Counts against 3 retries? |
|---|---|---|---|---|
| `resources_missing` | A | Template or schema missing / unparsable | Critical alert — repository broken | No |
| `invalid_registry` | B | Registry unparsable, target not found, inexact input, missing key, slug collision | Critical alert | No |
| `invalid_invocation` | C | No trigger stated | Agent bug: re-invoke with `reason` | No |
| `invalid_failure_report` | D | Report required but missing / malformed | Agent bug: re-invoke with a well-formed report | No |
| `study_missing` | E | No `source_study.json` | Run the source-study skill, then re-invoke | No |
| `study_incomplete` | E | A 2.4 key missing or malformed | Run source-study in re-study mode, then re-invoke | No |
| `study_stale` | E | `study_version` not understood by this builder | Run source-study (its version bumped), then re-invoke | No |
| `auth_required` | E | Study says the source needs login / token / cookie | Human decision — generated code never carries credentials | No |
| `listing_unreachable` | F | Listing fails over `requests` (and Playwright where permitted) | Record evidence; re-invoke after backoff; alert a human when exhausted | Yes |

---

## 12. Changelog — how a skill change reaches the scripts

Newest first. The agent reads the entries between a target's `builder_version` and the current `version` and passes them as rebuild instructions. Each entry states **core** (bumps `core_version`?), **scripts** (what every product script changes), **study** (re-study needed?), **regression** (fields allowed to differ between the old and new dry-run records; all others must be identical).

**Regression guard on `spec_changed`:** run `--dry-run --limit 5` with the old script (saved before rebuilding) and the new one; compare records field by field; only listed fields may differ.

| version | core | scripts | study | regression |
|---|---|---|---|---|
| 1.0 | yes (core 1.0) — initial core: `resolve_fields` takes the study's `fields` block; `Http(interval)` paced from the study's `rate_limit`; `check_hooks` requires `STUDY_VERSION` / `STUDIED_AT`; dry-run JSON carries `study`, `workaround_sentinel_hits`, `study_field_coverage` | Initial product-script spec: every selector, product name and quirk comes from `source_study.json` through the contract in 2.4; `summary` reads `fields.summary` (fallback `fields.title`); version kinds and inclusivity from `fields.affected_products.kinds` / `.bound_convention`; record key `additional_details` mapped 1:1 from the study's `other_details` | no (study 1.0 carries every key in 2.4) | all (first build) |