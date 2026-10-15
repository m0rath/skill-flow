---
name: source-study
description: Studies one vendor's advisory website once and records everything a parser builder needs in vendors/<vendor>/source_study.json. One-time task per vendor - redo it only when the vendor changes their site. Consults and grows the shared playbook of source patterns at knowledge/playbook.md.
version: "1.0"
---

# Source Study

## What this skill does

It investigates **one vendor's advisory source** and writes findings to `vendors/<vendor>/source_study.json` — the vendor's **build spec**:

- Tells the advisory-script-builder skill the concrete selector or JSON path where each extracted field (title, advisory_id, cve_ids, dates, workaround, summary, affected_products, other_details, etc.) lives on the vendor's page.
- Lets each product's script be written correctly in one pass, not by trial-and-error.
- Collects no advisory data and writes no code. The JSON file is the only output.

## Inputs

- **`registry.json`** (repo root) — read directly as a local file, not fetched over HTTP. Each vendor/product entry carries its advisory listing URL under `products[].advisories` if present, otherwise `vendors[].advisories`. This URL is what step 1 of the procedure fetches over HTTP; `registry.json` itself is never fetched, only read.
- **`knowledge/playbook.md`** (repo root) — read before starting any study if it exists; if missing, skip this step and proceed as an initial run with no playbook to consult yet (see §3).

## When this skill runs

Only in three situations:

1. **New vendor** — appears in `registry.json` with no `source_study.json` yet.
2. **Source changed** — the runtime detected a redesign; the collector agent asks for a re-study, with failure evidence.
3. **Spec changed** — a changelog entry says `study: yes`, or this skill's `version` is newer than the study's `study_version`. Re-study only what the entry needs (e.g. a new field's location); keep the rest. **Every edit to this skill must bump `version` by one**, regardless of how small the change (e.g. moving definition-of-done checks into `scripts.validate` alone still bumps the version; it does not by itself require a re-study).

- Never re-run for cases the existing study already covers.
- A deleted-and-rebuilt folder with a preserved `source_study.json` is reused as-is.

---

## 1. Procedure

Work through these steps in order:

a. **Open the listing.** Use the registry URL (`products[].advisories` if present, otherwise `vendors[].advisories`), sending a real browser's complete header set — see the playbook rows about CDN blocks for why a trimmed header set gets 403'd or times out. If the request succeeds (no 403, no timeout), continue directly to step b (sampling the advisories). Otherwise, if it 403s or times out, retry once, then check the playbook for a known CDN-block pattern for this vendor — a pattern fix means a concrete adjustment the playbook row prescribes (e.g. adding a specific header, cookie, or User-Agent string known to satisfy that CDN), not a generic retry. Apply it and retry once more. If the fixed retry succeeds, continue to step b (sampling the advisories). If no playbook pattern matches this vendor's symptom, or the matched fix still fails, stop: record the failure (URL, status/error, headers sent) and report it rather than proceeding to sampling.

b. **Sample the advisories.**
   - Fetch 2–3 randomly chosen advisories and study them closely.
   - If fewer than 2 exist, sample all that exist and record the limited sample size — never assume 2–3 are available.

c. **Locate every field.** For each field the builder extracts, record a **concrete selector or JSON path**: `title`, `advisory_id`, `cve_ids`, `advisory_url`, `date_published` (if it exists), `workaround` (workarounds/mitigations, if the vendor mentions any), `summary` (description/problem, if it exists), and `affected_products` (product name and version). Group everything else under `other_details`, each only where the page actually carries it: `cwe_capec_mitre` (CWE/CAPEC/MITRE or other classification, can list multiple), `security_details` (any additional security info relevant to the workaround), `bug_details` (if the vendor provides it on the same advisory), `impact`, `discovered` (who/what found it), `attack_type`, and `reference`.

d. **Note the variations** across the samples:
   - Workaround present vs. absent, and the vendor's "no workarounds" boilerplate sentence if they always print one.
   - Bug IDs and IOC sections present vs. absent.
   - Single-product vs. multi-product affected tables.
   - **Affected-version kinds:** individual versions, ranges (inclusive bounds or not), whole branches, or "all versions" — often several at once. Record as `fields.affected_products.kinds`, one example each, and for every range example record its `bound_convention` (inclusive or exclusive upper bound) explicitly rather than leaving it in free-text notes.
   - Whether advisories update in place after publication, and whether listing rows carry an updated date (drives re-check of incomplete advisories).

e. **Check the registry hints.**
   - Read any `_`-prefixed `parameter_mapping` key (e.g. `_note`) first — a human's tip on reaching the data, never a field.
   - Verify each hint with one probe.
   - Anything unresolved, and any listing ID mismatching `advisory_id_pattern`, goes in `unresolved_hints`.
   - A human fixes the registry — never edit it yourself.

f. **Check for a JavaScript shell.** If the page renders normally, skip to step g. If it's an empty JS shell, the real source is the XHR endpoint the page calls, not the page itself. Work down this ladder, stopping at the first rung that works:
   i. **Grep the page and its JS bundles** for endpoint patterns: `fetch(`, `XMLHttpRequest`, `axios`, and URL fragments like `/api/`, `/services/`, `.json`, `graphql`. The bundle URLs are in the shell's `<script src>` tags.
   ii. **Probe the obvious candidates** found in step 1 with `requests` (one probe each, with the full header set plus the page's `Referer`).
   iii. **Only if both fail**, run a one-off Playwright page-load with request logging to capture the real traffic — this is a study-time tool only; it does not put Playwright into the generated script unless no `requests` path exists at all.

   Before concluding anything unusual, check the symptom against the playbook (section 3). If a rung succeeds, use that endpoint or page source and continue to step g.

   **If no rung succeeds:** record the symptom and whatever partial evidence was gathered, set `headless_fallback` with the best-available evidence, and flag the vendor for human review rather than leaving the study open-ended. Do not halt the study: continue through the remaining steps (listing mechanics, fields, product match, publish-date chain, machine-readable twin) recording best-effort or partial data wherever the JS shell blocks a location, and note each gap alongside the field it affects so the human reviewer and the builder both see exactly what is missing.

g. **Record the listing mechanics:** content type, pagination scheme with one worked `pagination_example`, product filter support, whether rows carry dates, where the total count lives (body or header), and RSS/Atom feed if any. Record `auth` if the listing or advisories require login, cookies, or a token, and `rate_limit` — a safe request pace for the generated runtime script, if the vendor's limits are known or discoverable.
   - **Coverage.** Page the listing to its end; record the oldest advisory reached.
     - If it stops short (a date filter, a row cap, older IDs with detail pages but no list entry), record `listing.coverage` with `reaches_full_history: false`, the gap, and any alternative discovery route (CVRF/CSAF index, sitemap, archive page).
     - The collector agent raises this as an alert — a quiet gap is how FortiOS silently lost everything before 2022.

g1. **Product match — two sources.** For `affects_product()`, record **two** locations:
   - `primary`: structured source naming affected products (CSAF product tree, a product field, the version table).
   - `text_fallback`: the vendor's own prose naming them ("Affected Products", "Vulnerable Products", CSAF `notes` of that title, the summary).
   - Check at least one **old** advisory for each — older documents often fill the structured source differently (e.g. Cisco's pre-2016 alerts list hardware families or nothing in CSAF, naming the product only in notes).
   - Record how the product is named in each, and the sibling products it must not match (e.g. IOS XE for an IOS target).

g2. **Publish date — the whole chain.**
   - Record the date field and every fallback down to the advisory's own text (a revision-history table, a "first published" line), with one example each.
   - Note advisories where none holds, so the builder knows they exist.

h. **Machine-readable twin.**
   - Check whether the vendor publishes CSAF (or CVRF) per advisory, including old ones whose page doesn't link it.
   - If yes: record the URL pattern, flag it for a human to set `vendors[].csaf_url` (never edit the registry yourself).
   - If no: record that none exists, leave the detail blank.

i. **Save the file** to `vendors/<vendor>/source_study.json`. No page copies (fixtures) are saved — the study records locations, not pages. Then run `python3 -m scripts.validate source-study <vendor>`. If the command itself errors out (missing module, stack trace, non-zero exit with no check report) rather than returning a list of pass/fail checks, stop immediately and report a tooling failure — this is not a fixable check and must not be retried in the fix loop. Otherwise, fix every failing check. Cap fix attempts per failing check at three. If a check passes within three attempts, move on to the next failing check (or, if none remain, proceed to report completion). If a check still fails after three attempts for a reason the skill cannot resolve (e.g. a genuinely unlocatable field), stop retrying it, record it in `unresolved_hints` instead of looping indefinitely, and flag the vendor for human review. Once validation passes, report completion to the invoking agent or user: the saved path, and a summary of any `unresolved_hints` or human-review flags left open.

Two habits behind every good study:

- **Verify with one probe before concluding.** A wrong route or a binary-looking byte can mimic a wall that isn't there.
- **Write down everything you find.** The study exists so the next build (or the next repair) starts where this one ended.

---

## 2. Output — `source_study.json`

One file per vendor at `vendors/<vendor>/source_study.json`:

```json
{
  "vendor": "<vendor_name>",
  "studied_at": "<ISO-8601>",
  "study_version": "<this skill's version when the study was written>",
  "urls_studied": ["<listing url>", "<sample advisory urls>"],
  "listing": {
    "content_type": "json | xml | html | text",
    "real_endpoint": "<XHR endpoint if the page is a JS shell, else null>",
    "pagination": "<scheme: page / offset / cursor / next-link / header-count>",
    "pagination_example": { "template": "<URL/request pattern with placeholders, e.g. ?page={n}>", "worked": "<one literal example URL or request>" },
    "product_filter": "<how to filter, or 'client-side'>",
    "rows_have_dates": true,
    "feed": "<RSS/Atom url, or null>",
    "coverage": { "reaches_full_history": true, "oldest_reachable": "<YYYY-MM-DD>", "gap": "<what cannot be reached, or null>", "alternative_discovery": "<route to the older IDs, or null>" }
  },
  "product_match": {
    "primary": "<structured location that names affected products>",
    "text_fallback": "<the vendor prose that names them, for documents whose structured source doesn't>",
    "names": { "match": ["<how the target product is written>"], "never_match": ["<sibling products>"] },
    "old_document_example": "<an old advisory ID and what each source says there>"
  },
  "fields": {
    "title": { "location": "<selector or JSON path>", "notes": "<quirks>" },
    "advisory_id": { "location": "<selector or JSON path>", "notes": "<quirks>" },
    "cve_ids": { "location": "<selector or JSON path>", "notes": "<quirks>" },
    "advisory_url": { "location": "<selector or JSON path>", "notes": "<quirks>" },
    "date_published": { "location": "<selector or JSON path>", "notes": "<quirks, or 'not present'>" },
    "workaround": { "location": "<selector or JSON path>", "notes": "<quirks, or 'not mentioned by vendor'>" },
    "summary": { "location": "<selector or JSON path>", "notes": "<quirks>" },
    "affected_products": { "location": "<selector or JSON path>", "notes": "<how name + version are recorded>", "kinds": ["<individual version | range | branch | all versions>"], "bound_convention": "<inclusive | exclusive, per range example>" },
    "other_details": {
      "cwe_capec_mitre": { "location": "<selector or JSON path, or null>", "notes": "<can list multiple>" },
      "security_details": { "location": "<selector or JSON path, or null>", "notes": "<anything relevant to the workaround>" },
      "bug_details": { "location": "<selector or JSON path, or null>", "notes": "<only if provided on the same advisory>" },
      "impact": { "location": "<selector or JSON path, or null>", "notes": "<quirks>" },
      "discovered": { "location": "<selector or JSON path, or null>", "notes": "<who/what found it>" },
      "attack_type": { "location": "<selector or JSON path, or null>", "notes": "<quirks>" },
      "reference": { "location": "<selector or JSON path, or null>", "notes": "<quirks>" }
    }
  },
  "variations": ["<observed differences across the samples>"],
  "workaround_sentinel": "<the vendor's 'no workaround' boilerplate sentence, or null> (information for downstream consumers; the workaround is still stored verbatim)",
  "unresolved_hints": ["<parameter_mapping hints that did not resolve>"],
  "headless_fallback": { "needed": false, "evidence": "<why plain HTTP failed, if true>" },
  "auth": { "required": false, "method": "<login flow, token, cookie, or null>", "credential_location": "<where the runtime script reads it: env var, config file, or null>", "expiry": "<refresh trigger or validity window, or null>", "notes": "<how the builder obtains/refreshes it>" },
  "rate_limit": "<safe request pace for the generated runtime script, if known>"
}
```

On a **re-study** after a source change: keep the old knowledge that still holds, update what changed, and note what changed and when.

---

## 3. The source playbook — `knowledge/playbook.md`

The playbook of field-proven source patterns lives at the **repository root: `knowledge/playbook.md`** — lying content-type headers, JS shells, CDN blocks, Salesforce portals, migrated publish dates, and every pattern learned since. It is the system's growing knowledge base, deliberately kept **outside** this skill so the running system can add to it without touching skill files.

- **Check it first.**
  - Read it before starting any study.
  - Look up every unexpected symptom there before concluding anything.
  - One clean build beats a day of debugging.
- **Grow it.** When this study uncovers a pattern the playbook doesn't cover, append one row (symptom, what it really is, what to do), phrased generically so it transfers to any vendor, with the vendor and date as evidence. The file's own header states the full append-only rules.
- **Pattern vs. quirk test:** ask whether the finding describes a *mechanism* that could recur at other vendors (a CDN block signature, a class of JS-shell symptom, a category of date-fallback behavior) or a *fact specific to this vendor* (their exact selectors, field names, product list, URL). The former is playbook-worthy once phrased generically; the latter is vendor-specific.
- Vendor-specific findings belong in that vendor's `source_study.json`, never in the playbook.
- **If missing** (e.g. fresh clone, or the first study ever run): treat this as an initial run — skip reading it and proceed with the study. No git-history recovery and no stop/flag are needed; the file simply doesn't exist yet.

---

## 4. Hard constraints

1. **Study only.** No parser code, no advisory data collected — `source_study.json` is the only output.
2. **`requests` first, always.** Recommend the Playwright fallback only with recorded evidence no plain-HTTP path works.
3. **Probe politely.** A handful of sample fetches; at most 2 requests/second per host.
4. **Never edit `registry.json`.** A wrong hint goes into `unresolved_hints` for a human to fix.

---

## 5. Definition of done

`python3 -m scripts.validate source-study <vendor>` passes. It checks that the file parses and has every key of section 2, the listing mechanics block with `coverage` (and `alternative_discovery` when the listing stops short), a `primary` and `text_fallback` product match, every field mapped or in `unresolved_hints`, more than one `date_published` location, `workaround_sentinel` present, and `headless_fallback.evidence` when `needed` is true. The boxes below are still yours to confirm:

- [ ] `vendors/<vendor>/source_study.json` exists and covers every field in the `fields` map (or lists it in `unresolved_hints`).
- [ ] Every `parameter_mapping` hint is either resolved to a location or recorded in `unresolved_hints`; every `_note` tip is verified or corrected in the study.
- [ ] Every listing ID seen matches `advisory_id_pattern`, or the mismatches are in `unresolved_hints`.
- [ ] The listing mechanics block is complete: content type, pagination, product filter, row dates, feed, and `coverage` (with `alternative_discovery` when the listing stops short).
- [ ] `product_match` names a `primary` and a `text_fallback` location, each checked on at least one old advisory.
- [ ] `fields.date_published` records the full fallback chain down to the advisory's own text.
- [ ] `workaround_sentinel` is set (the vendor's boilerplate sentence, or `null` after checking).
- [ ] `headless_fallback.needed` is `false`, or `true` with the recorded evidence that no `requests` path works.
