# Brief: research ONE advisory into one research.json entry

You were given a target (`<vendor>/<product>`) and one `advisory_id`. Research it and save its entry. Run every command from the repository root (it is the parent of the folder holding this file); use absolute paths, because the working directory can reset between shell calls.

Tool: `python3 -m scripts.research_tool` (run from the repository root). First run `python3 -m scripts.validate research-inputs <target> <advisory_id>`: if it fails, stop and report the failing check in `unclear=`.

## Mandatory rules
1. **Never use the `advisories` MCP server** (any `mcp__advisories__*` tool). It is out of scope for this project and blocked. Advisory data comes only from the project's `advisories.json`; read yours with `python3 -m scripts.research_tool show <target> <id>`.
2. **`cisco/ios` means classic Cisco IOS only.** IOS XE or IOS XR syntax and documents are never proof for IOS.
3. **Read-only everywhere.** Never edit `registry.json` or any file under `vendors/`. Your only project write happens through `python3 -m scripts.research_tool merge …`, which validates and saves `research.json` atomically under a lock. Keep your draft entry in your scratchpad (or the system temp folder), never in the repository. **Never create any file inside the repository**, including by shell redirect (`> file`) or a script's output path: put every output under your scratchpad subfolder.
3a. **Do the work yourself.** Never start subagents or background agents, even for a batch. The orchestrator runs at most 6 researchers at once, and an agent that spawns its own children breaks that cap. It can also hand back before its children have saved anything.
4. **Never run anything against a device.** This is documentation research only.

## Method — read these first, in this order
- `templates/rules_card.md`: **every rule on one page.** Follow it.
- `.claude/skills/mitigation-research/SKILL.md` **section 5 only**: the exact output format. Open the rest of the skill, `.claude/skills/workaround-triage/SKILL.md` or `.claude/skills/evidence-collection/SKILL.md` only when the card doesn't settle a question; the skill wins over the card.
- `schemas/research.schema.json` only if `check` reports a schema error you don't understand.
- `knowledge/mitigations/<vendor>_<product>.md`, if it exists: **read it first.** Its Basics (modes, save steps, common syntax and doc URLs) and Patterns (recurring plans) are verified vendor evidence. Reuse their quotes and URLs without re-fetching for the trains and dates the entry lists (rules: `knowledge/mitigations/README.md`). Put every entry you relied on in the entry's `knowledge_used` (e.g. `["fortinet_fortios#B01", "fortinet_fortios#P01"]`); saving logs each use.
- `vendors/<vendor>/source_study.json`: skim it for vendor quirks.
- Other entries in `vendors/<vendor>/<product>/research.json`: a plan for the same action and train may be reused. Its quotes were verified when it was saved, so reuse them without re-fetching when the train matches and the entry's `saved_at` is within 180 days (the same rule as knowledge). An entry with no `saved_at` was saved on 2026-09-28 or 2026-09-29. Otherwise re-fetch. Search the file; do not read it whole if it is large.

## Vendor signatures and virtual patches
A FortiGuard / FMWP virtual patch, IPS signature or Threat ID named in the advisory (often in `solution`, e.g. "Virtual Patch named \"FG-VD-60389.0day.\" is available in FMWP db update …") is an **on-device candidate**: a vendor security control, licensed features count (mitigation-research, step 4). Research how it is applied and checked on this product by CLI (evidence-collection), and its coverage limits (which traffic or paths it inspects). Record it like any other candidate; don't leave it only in `open_questions` unless its CLI can't be sourced.

## Sources — vendor only
Allowed hosts are the registrable domains printed by `python3 -m scripts.research_tool hosts <vendor>`, plus their subdomains.
- Fetch pages on allowed hosts directly. Search only with `site:<domain>`, and open only results on an allowed host.
- **Excluded, even under the vendor's domain:** hosts whose first label is `community`, `forum`, `forums`, `learningnetwork`, `answers`, `ideas`, `supportforums` or `live`, and any user post, thread or comment.
- Every command, mode, check and claim is quoted verbatim (≤ 400 characters per quote) from a cited allowed-host page. Never write syntax from memory; a gap goes to `open_questions`.
- If a fetch tool returns a summary, ask it for the verbatim sentences or syntax lines. Quotes must be the page's own text.
- **Quotes from the advisory itself:** take them from the collected record (`show <target> <id>`). It is the vendor's text stored verbatim; cite the advisory's own URL. Anything the record doesn't hold (e.g. FortiGuard's "Component" side panel) needs a verbatim fetch of that page. Never infer it from another advisory's layout or a summary. When FortiGuard's coarse "Component" panel disagrees with the advisory's title or summary (e.g. "SSL-VPN" versus a ZTNA-proxy title), the title and summary win: they name the specific component. Note the conflict in `open_questions`. If you can't get it verbatim, it is a gap in `open_questions`.
- Fetch politely (≤ 2 requests per second per host). If a fetch fails, retry once, then treat the source as unavailable.
- **PDFs count.** A vendor guide that exists only as a PDF on an allowed host is a valid source: `verify-quotes` reads PDFs. To check a quote locally, run `python3 -c "from scripts import research_tool as rt; t=rt.page_text('<url>'); print(rt.quote_on('<quote>', t))"`.

## Save early and resume
Other researchers can stall and be restarted. Write your draft file as soon as the triage block and vulnerable check are done, and update it after each finished mitigation. **If a draft for your advisory already exists** in the scratchpad (named as in Deliver, step 1), or pages exist in your subfolder, read them first and continue from them instead of starting over.

## Deliver
Other researchers work on other advisories at the same time. Never edit `research.json` directly and never re-save other entries: `merge` locks the file and saves only yours.
1. Write the entry (the advisory object only, not wrapped in its ID; no `fp`, the tool sets it) to a draft file **named after your advisory**, e.g. `<scratchpad>/<vendor>_<product>_<advisory_id>.draft.json`. Other researchers share the scratchpad, so never use a generic name like `draft.json`. Put every downloaded page and temporary file in your own subfolder (`<scratchpad>/<vendor>_<product>_<advisory_id>/`), and never move, rename or delete files outside it.
2. Run `python3 -m scripts.research_tool merge <target> <advisory_id> <draft file>`. Fix every `CHECK FAILED` item and re-run until it prints `SAVED`. `check` in place of `merge` is a dry run.
3. Run `python3 -m scripts.research_tool verify-quotes <target> <advisory_id>`. It fetches every cited page and checks each quote is on it. Fix every `quote not on page` (split the entry per page, or cite the right URL) and re-merge until it reports 0 problems. A `page not fetchable` for fortiguard.com is fine when the quote is in the collected record.
4. Your final message is ONE line: `<advisory_id> <status> [<not_mitigatable_reason>] triage=<class> knowledge=<ids used or none> refetched=<vendor pages you fetched that a knowledge entry could have held, or none> high=<confidence of each High mitigation> tiers=<tier list> site_values=<y/n> unclear=<anything unclear in the skills or schema, or none>`.

Budget: aim to finish within about 30 tool calls (reuse of a knowledge pattern or saved plan: about 12). If sources are unreachable, save `RESEARCH_REQUIRED` with concrete `open_questions` rather than looping.
