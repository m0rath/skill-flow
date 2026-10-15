# Research rules card (read this first)

A one-page summary of the rules in `mitigation-research` (1.37), `evidence-collection` (1.18) and `workaround-triage` (1.9). Where this card and a skill differ, the skill wins. Open a full skill only for: the exact JSON output format (mitigation-research §5), the triage table (workaround-triage), or a rule you need word for word.

## Status
- **MITIGATED:** every CVE has a `High` at confidence `high` or `very_high` on at least one affected train, and vulnerable_check, backup and evidence are filled. The tool enforces this.
- **RESEARCH_REQUIRED:** anything unfinished. `open_questions` says exactly what is missing and where you looked.
- **NOT_MITIGATABLE:** complete research, with one reason proven (`VULNERABLE_CODE_ALWAYS_REACHABLE`, `NO_CONFIG_CONTROL`, `NO_ACTIONITEM_FOUND`, `ALL_CANDIDATES_FAILED`, `CLI_UNAVAILABLE`). Never use it for a research gap. Partial fixes for other CVEs may stay in the entry.
- Upgrades are remediation, not mitigations. Don't record them.

## Validated (the gate for High)
Validated means one of these:
- a vendor statement that the change prevents exploitation;
- a vendor-stated precondition removed ("only if X is enabled", or the vendor's own "not affected if check shows Y" made true);
- vendor docs showing every path is closed.
Anything else is Low, even when it is the only candidate.
- **A vendor "determine whether you are affected" or "determine the status of X" section counts as a vendor-stated precondition** when it plainly ties exposure to X being enabled or configured. A change that makes that check show the not-affected state is validated. Cite the section in `evidence.why`.
- **Combined multi-path plan:** validated only if every part is validated.
- **Another advisory's workaround:** counts only when it names the same component or daemon and the same attacker position. Name the borrowing in `open_questions`.
- **Filters (ACL, iACL, CoPP) offered to "reduce attack surface" after "no workarounds":** Low, even if the vendor calls them "may be suitable". Turning off the feature the vendor names as the precondition is still validated.
- **Shut down but still configured:** not validated, unless the vendor says the shut-down feature no longer processes X. Product exceptions are in knowledge (NetScaler `disable vserver`: validated, DISRUPTIVE).
- **Disabling the protection a flaw bypasses** (lockout, rate limit, authentication): never High.
- **Deletion whose rollback can't restore references:** at most medium.
- **Irreversible change** (keys zeroized, image uninstalled): at most high. Say so in `impact` and the condition.

## Ranking (per CVE and train, or per platform)
Validated → covers all paths → safest tier (`SAFE` > `SAFE-CONDITIONAL` > `DISRUPTIVE`) → no site values → confidence. The best validated one is High, other validated ones Medium, unvalidated ones Low. There is exactly one High per CVE per train or platform.

## Confidence gates
- `very_high`: validated and covers every CVE it claims, with no site values.
- `high`: complete plan: modes, enter/leave/save steps, precondition, backup and rollback all sourced.
- `medium`: syntax documented for this product and train.
- `low`: commands quoted from the vendor.
- `very_low`: a candidate only.

## Sources
- Vendor domains only, never community or forum hosts. PDFs count.
- Advisory quotes come from the collected record (`research_tool show`).
- **Syntax for a train:**
  - that train's page;
  - a sibling sub-train page (name the gap);
  - a command the advisory itself prints (every affected train it lists, unless a reference narrows it);
  - Cisco IOS: the generic `no` form rule (knowledge B01).
- A train with no source stays out of `applies_to` and is named in `open_questions`.
- Title and summary beat a vendor's coarse Component panel.
- Knowledge entries under 180 days old, and saved entries under 180 days old for the same train, are reusable without re-fetching.

## Plans (evidence-collection)
- **Steps:** enter each mode, change, leave, save. The tool enforces the first and last step for each vendor or target. An EXEC-only plan needs no save.
- **Regexes:** built from quoted output; matching is multiline; for "no output" use `\A\s*\Z`.
- **Backup:**
  - Variables are one-group regexes. `${VAR}` goes in rollback only.
  - A setup step (output format) may have no variables.
  - A variable used only in a condition is fine.
- **Site values:**
  - Use `<UPPER_SNAKE>` for per-site data.
  - Never hard-code table IDs.
  - Rollback reuses only site values that its mitigate uses.
- **Per-object plans:** repeat the plan per object. The precondition checks one object; `vulnerable_check` checks the device.
- **Changing an existing line:** remove it first unless the docs say re-entering replaces it. Restore a hidden default with `unset` or the vendor's equivalent.
- **Evidence limits:**
  - `exposure`: 3 entries (4 for NOT_MITIGATABLE).
  - `why`: 2 entries.
  - `how`: 6 entries.
  - Each entry holds up to 4 quotes of 400 characters or fewer, and every quote must be on every URL of its entry.

## Standard gaps (write them the same way every time)
When a plan doesn't cover one of the following, add a condition line and an `open_questions` item. Use the exact tag so reports can count them:
- `SCOPE:single-context`: multi-VDOM, admin partition, vsys or VRF not covered.
- `SCOPE:ipv4-only`: IPv6 not covered.
- `SCOPE:default-ports`: non-default service ports not covered.
- `CHECK:over-matches`: the check flags more devices than are exposed, e.g. a build number that isn't in the config, or an off-device condition.
- `CHECK:format-inferred`: the output layout is inferred from syntax, not a vendor sample.
- `PLATFORM:no-cli-source`: an affected platform or train has no vendor CLI page. It stays out of `applies_to`.

## Triage (workaround-triage)
- **Classes:** COMMAND_PROVIDED (typeable, including a full one-line prose command with its mode) · UI_PATH_PROVIDED · EVIDENCE_REQUIRED · NON_ACTIONABLE · NO_WORKAROUND · ABSENT · UNKNOWN.
- A recovery-only command, or an attack-surface filter placed after "no workarounds", gives NO_WORKAROUND plus a hint.
- **Starting confidence follows the class** (the tool enforces this): NO_WORKAROUND, ABSENT and NON_ACTIONABLE start `very_low` even when the hint is strong. The hint shows up in the final confidence, not the starting one.
- Off-device workarounds are NON_ACTIONABLE.
- Scan `summary`, `details`, `required_configuration` and `solution` for hints.

## Before you save
1. Run `python3 -m scripts.research_tool check <target> <id> <draft>`, then `merge`, then `verify-quotes <target> <id>`, until you get 0 problems.
2. Run `python3 -m scripts.research_tool consistency <target>` and look at your family. If the same command family is ranked differently elsewhere, match it or explain why in `open_questions`.
3. For data problems in the collected record, run `python3 -m scripts.research_tool collector-issue <target> <id> "<what is wrong>"`. Examples: wrong or too-broad versions, text differing from the live page, missing URL, bad severity.
