#!/usr/bin/env python3
"""Validate: the mechanical input and output checks every skill shares.

Skills call this instead of checking files, JSON and schemas by eye. Run from any
directory; every path is resolved from the repo root.

  Generic checks
    python3 -m scripts.validate exists <path>...                         each path exists
    python3 -m scripts.validate json <path> [--schema <schema.json>] [--require <a.b.c>]...
                                                                         parses; optional schema; required keys

  Per-skill checks
    python3 -m scripts.validate builder-inputs <vendor_name> <product_name> [--reason <r>]... [--failure-report <file>]
                                                                         advisory-script-builder stages A, B, C (trigger stated), D, E
    python3 -m scripts.validate builder-output <vendor/product>          advisory-script-builder definition of done (static part)
    python3 -m scripts.validate runtime                                  collector-runtime-builder definition of done (static part)
    python3 -m scripts.validate source-study <vendor>                    source-study definition of done (mechanical part)
    python3 -m scripts.validate schedule <vendor>                        schedule-analysis definition of done
    python3 -m scripts.validate collector <vendor/product>              collector.json against schemas/collector.schema.json
    python3 -m scripts.validate research-inputs <vendor/product> <advisory_id>
                                                                         inputs of workaround-triage, mitigation-research, evidence-collection
    python3 -m scripts.validate triage <triage.json>                     a workaround-triage result

Every command prints one JSON object to stdout:
  {"ok": bool, "command": ..., "checks": [{"check", "ok", "detail"}], "warnings": [...]}
builder-inputs also carries "stage", "blocked_reason" and "blocked_detail" on failure.
Exit code: 0 all checks pass, 1 a check failed, 2 bad arguments.

Research entries are checked by `python3 -m scripts.research_tool check`, not here.
"""
import argparse
import ast
import json
import os
import py_compile
import re
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import jsonschema

from scripts.research_tool import TRIAGE_CONFIDENCE, slug

SKILLS = os.path.join(ROOT, ".claude", "skills")

# source-study 1.0 output (its section 2): the core fields and the other_details sub-fields
STUDY_FIELDS = ["title", "advisory_id", "cve_ids", "advisory_url", "date_published", "workaround", "summary",
                "affected_products"]
STUDY_OTHER_DETAILS = ["cwe_capec_mitre", "security_details", "bug_details", "impact", "discovered", "attack_type",
                       "reference"]
STUDY_LISTING_KEYS = ["content_type", "pagination", "pagination_example", "product_filter", "rows_have_dates",
                      "coverage"]
STUDY_VERSIONS_UNDERSTOOD = {"1.0"}      # advisory-script-builder stage E: study_stale otherwise
REASONS = {"new_target", "registry_changed", "study_changed", "repair", "spec_changed"}
TEMPLATE_HOOKS = ["listing_request", "parse_listing", "detail_url", "parse_advisory_id", "parse_cve_ids",
                  "parse_summary", "parse_version_affected", "parse_workaround", "parse_additional_details",
                  "affects_product", "is_withdrawn"]
ALLOWED_IMPORTS = {"requests", "bs4", "lxml", "jsonschema", "scripts"}
PINNED_PACKAGES = ["requests", "beautifulsoup4", "lxml", "jsonschema", "apscheduler"]


def rel(path):
    return path if os.path.isabs(path) else os.path.join(ROOT, path)


class Report:
    def __init__(self, command):
        self.out = {"ok": True, "command": command, "checks": [], "warnings": []}

    def add(self, check, ok, detail=""):
        self.out["checks"].append({"check": check, "ok": bool(ok), "detail": detail})
        if not ok:
            self.out["ok"] = False
        return bool(ok)

    def warn(self, msg):
        self.out["warnings"].append(msg)

    def block(self, stage, reason, detail):
        """First failing stage wins (advisory-script-builder, invocation order)."""
        if "blocked_reason" not in self.out:
            self.out.update(stage=stage, blocked_reason=reason, blocked_detail=detail)

    def done(self):
        json.dump(self.out, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0 if self.out["ok"] else 1


# ----------------------------------------------------------------- primitives
def check_exists(r, path, name=None):
    ok = os.path.exists(rel(path))
    r.add(name or f"exists {path}", ok, "" if ok else "missing")
    return ok


def load_json(r, path, name=None):
    """Parse a JSON file; returns (data, error). Records one check."""
    name = name or f"json {path}"
    p = rel(path)
    if not os.path.exists(p):
        r.add(name, False, "missing")
        return None, "missing"
    try:
        with open(p, encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        r.add(name, False, f"malformed: {e}")
        return None, f"malformed: {e}"
    r.add(name, True)
    return data, None


def get_path(obj, dotted):
    for part in dotted.split("."):
        if not isinstance(obj, dict) or part not in obj:
            return False, None
        obj = obj[part]
    return True, obj


def check_required(r, obj, keys, where, non_empty=False):
    ok_all = True
    for k in keys:
        found, val = get_path(obj, k)
        ok = found and (not non_empty or val not in (None, "", [], {}))
        ok_all &= r.add(f"{where}: {k}", ok, "" if ok else ("empty" if found else "missing"))
    return ok_all


def schema_errors(data, schema):
    v = jsonschema.Draft202012Validator(schema)
    return [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
            for e in sorted(v.iter_errors(data), key=lambda e: list(map(str, e.absolute_path)))]


def check_schema(r, data, schema, name):
    errs = schema_errors(data, schema)
    r.add(name, not errs, "; ".join(errs[:5]) + (f" (+{len(errs) - 5} more)" if len(errs) > 5 else ""))
    return not errs


def frontmatter(skill, key):
    p = os.path.join(SKILLS, skill, "SKILL.md")
    with open(p, encoding="utf-8") as f:
        for line in f:
            m = re.match(rf'^{key}:\s*"?([^"\n]+)"?\s*$', line)
            if m:
                return m.group(1)
    return None


def version_tuple(v):
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def module_constant(path, name):
    try:
        tree = ast.parse(open(path, encoding="utf-8").read())
    except (OSError, SyntaxError):
        return None
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            if isinstance(node.value, ast.Constant):
                return node.value.value
    return None


def check_compiles(r, path):
    try:
        py_compile.compile(rel(path), doraise=True)
        return r.add(f"compiles {path}", True)
    except py_compile.PyCompileError as e:
        return r.add(f"compiles {path}", False, str(e.msg).strip())


def iso_ok(s):
    try:
        datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def find_target(reg, target):
    """Resolve a vendor/product slug key to its registry entries."""
    for v in reg.get("vendors", []):
        for p in v.get("products", []):
            if f"{slug(v['vendor_name'])}/{slug(p['product_name'])}" == target:
                return v, p
    return None, None


# ----------------------------------------------------------------- commands
def cmd_exists(a):
    r = Report("exists")
    for p in a.paths:
        check_exists(r, p)
    return r.done()


def cmd_json(a):
    r = Report("json")
    data, err = load_json(r, a.path)
    if err is None:
        if a.schema:
            schema, serr = load_json(r, a.schema)
            if serr is None:
                check_schema(r, data, schema, f"schema {a.schema}")
        check_required(r, data, a.require or [], a.path)
    return r.done()


def cmd_builder_inputs(a):
    """advisory-script-builder invocation order, stages A-E. Stops at the first failing stage."""
    r = Report("builder-inputs")

    # A. Repo resources
    bad = []
    if not check_exists(r, "templates/fetch_advisories.py"):
        bad.append("templates/fetch_advisories.py: missing")
    for p in ("templates/headers.json", "schemas/advisory_record.schema.json"):
        _, err = load_json(r, p)
        if err:
            bad.append(f"{p}: {err}")
    if bad:
        r.block("A", "resources_missing", "; ".join(bad))
        return r.done()

    # B. Registry and inputs
    reg, err = load_json(r, "registry.json")
    if err:
        r.block("B", "invalid_registry", f"registry.json: {err}")
        return r.done()
    vendor = next((v for v in reg.get("vendors", []) if v.get("vendor_name") == a.vendor_name), None)
    if not r.add("vendor_name exact match", vendor is not None, "" if vendor else repr(a.vendor_name)):
        r.block("B", "invalid_registry", f"vendor_name {a.vendor_name!r} has no exact match in registry.json")
        return r.done()
    product = next((p for p in vendor.get("products", []) if p.get("product_name") == a.product_name), None)
    if not r.add("product_name exact match", product is not None, "" if product else repr(a.product_name)):
        r.block("B", "invalid_registry",
                f"product_name {a.product_name!r} has no exact match under vendor {a.vendor_name!r}")
        return r.done()
    missing = [k for k in ("advisory_id_pattern", "advisory_url") if not vendor.get(k)]
    if not (vendor.get("advisories") or product.get("advisories")):
        missing.append("advisories (vendor or product)")
    r.add("registry required keys", not missing, ", ".join(missing))
    seen, collisions = {}, []
    for p in vendor.get("products", []):
        s = slug(p.get("product_name", ""))
        if s in seen and seen[s] != p.get("product_name"):
            collisions.append(f"{seen[s]!r} and {p.get('product_name')!r} -> {s}")
        seen.setdefault(s, p.get("product_name"))
    r.add("no product slug collision", not collisions, "; ".join(collisions))
    if missing or collisions:
        r.block("B", "invalid_registry",
                "; ".join(filter(None, [missing and "missing: " + ", ".join(missing), "; ".join(collisions)])))
        return r.done()

    # C. Trigger stated (whether the target is provably current is the builder's judgment)
    reasons = a.reason or []
    unknown = [x for x in reasons if x not in REASONS]
    if not r.add("trigger stated", reasons and not unknown,
                 "no reason given" if not reasons else f"unknown: {', '.join(unknown)}"):
        r.block("C", "invalid_invocation",
                "no reason given" if not reasons else f"unknown reason(s): {', '.join(unknown)}")
        return r.done()

    # D. Failure report
    if a.failure_report or "repair" in reasons:
        problems = []
        if not a.failure_report:
            problems.append("failure_report required for reason repair")
        else:
            rep, ferr = load_json(r, a.failure_report, "failure_report parses")
            if ferr:
                problems.append(ferr)
            elif not isinstance(rep, dict):
                problems.append("not a JSON object")
            else:
                problems += [f"{k} missing or empty" for k in ("target", "attempt", "phase", "reason")
                             if rep.get(k) in (None, "", [])]
                if rep.get("phase") not in (None, "", "validation", "self-heal"):
                    problems.append(f"phase {rep['phase']!r} is not validation or self-heal")
                if rep.get("phase") == "validation" and "failing_fields" not in rep:
                    problems.append("failing_fields missing (required when phase is validation)")
        if not r.add("failure_report shape", not problems, "; ".join(problems)):
            r.block("D", "invalid_failure_report", "; ".join(problems))
            return r.done()

    # E. Source study
    vslug = slug(a.vendor_name)
    study_path = f"vendors/{vslug}/source_study.json"
    if not os.path.exists(rel(study_path)):
        r.add(f"exists {study_path}", False, "missing")
        r.block("E", "study_missing", f"{study_path} missing")
        return r.done()
    study, serr = load_json(r, study_path)
    if serr:
        r.block("E", "study_incomplete", serr)
        return r.done()
    gaps = study_gaps(study, a.vendor_name)
    if not r.add("source study complete for build (builder 2.4)", not gaps, "; ".join(gaps)):
        r.block("E", "study_incomplete", "; ".join(gaps))
        return r.done()
    sv = str(study.get("study_version"))
    if not r.add("study_version understood by this builder", sv in STUDY_VERSIONS_UNDERSTOOD,
                 f"{sv} (understood: {', '.join(sorted(STUDY_VERSIONS_UNDERSTOOD))})"):
        r.block("E", "study_stale", f"study_version {sv} is not one the builder understands")
        return r.done()
    auth = study.get("auth") or {}
    if not r.add("source needs no credentials", not auth.get("required"), str(auth.get("method") or "")):
        r.block("E", "auth_required", f"study says the source requires {auth.get('method') or 'credentials'}")
    return r.done()


def study_gaps(study, vendor_name=None):
    """advisory-script-builder stage E (its section 2.4): every study key the builder consumes."""
    if not isinstance(study, dict):
        return ["not a JSON object"]
    gaps = []
    if vendor_name is not None and study.get("vendor") != vendor_name:
        gaps.append(f"vendor is {study.get('vendor')!r}, not {vendor_name!r}")
    for k in ("study_version", "studied_at"):
        if not study.get(k):
            gaps.append(f"{k} missing")
    for block in ("listing", "product_match", "fields"):
        if not isinstance(study.get(block), dict):
            gaps.append(f"no {block} block")
    if gaps:
        return gaps
    listing = study["listing"]
    gaps += [f"listing.{k} missing" for k in STUDY_LISTING_KEYS if k not in listing]
    pm = study["product_match"]
    gaps += [f"product_match.{k} missing" for k in ("primary", "text_fallback") if not pm.get(k)]
    names = pm.get("names") or {}
    if not names.get("match"):
        gaps.append("product_match.names.match empty")
    if "never_match" not in names:
        gaps.append("product_match.names.never_match missing")
    hints = json.dumps(study.get("unresolved_hints") or [])
    fields = study["fields"]
    for f in STUDY_FIELDS:
        spec = fields.get(f)
        if not (isinstance(spec, dict) and "location" in spec) and f not in hints:
            gaps.append(f"fields.{f} neither located (location key, null allowed) nor in unresolved_hints")
    ap = fields.get("affected_products") or {}
    if not isinstance(ap.get("kinds"), list) or not ap.get("kinds"):
        gaps.append("fields.affected_products.kinds is not a non-empty list")
    od = fields.get("other_details")
    if not isinstance(od, dict):
        gaps.append("fields.other_details missing")
    else:
        for f in STUDY_OTHER_DETAILS:
            spec = od.get(f)
            if not (isinstance(spec, dict) and "location" in spec) and f not in hints:
                gaps.append(f"fields.other_details.{f} neither located nor in unresolved_hints")
    if "workaround_sentinel" not in study:
        gaps.append("workaround_sentinel key missing (null allowed)")
    hf = study.get("headless_fallback")
    if not isinstance(hf, dict) or "needed" not in hf:
        gaps.append("headless_fallback.needed missing")
    elif hf.get("needed") and not hf.get("evidence"):
        gaps.append("headless_fallback.needed is true without evidence")
    return gaps


def cmd_builder_output(a):
    """advisory-script-builder definition of done: the boxes a file inspection can tick."""
    r = Report("builder-output")
    vslug, pslug = a.target.split("/", 1)
    core_want = frontmatter("advisory-script-builder", "core_version")
    if check_exists(r, "scripts/core.py") and check_compiles(r, "scripts/core.py"):
        have = module_constant(rel("scripts/core.py"), "CORE_VERSION")
        r.add("CORE_VERSION equals skill core_version", have == core_want, f"core {have}, skill {core_want}")
        src = open(rel("scripts/core.py"), encoding="utf-8").read()
        r.add("core loads schemas/advisory_record.schema.json", "advisory_record.schema.json" in src)
    script = f"vendors/{vslug}/{pslug}/run/fetch_advisories.py"
    if check_exists(r, script) and check_compiles(r, script):
        tree = ast.parse(open(rel(script), encoding="utf-8").read())
        defs = {n.name for n in tree.body if isinstance(n, ast.FunctionDef)}
        missing = [h for h in TEMPLATE_HOOKS if h not in defs]
        r.add("defines every template hook", not missing, ", ".join(missing))
        reg, err = load_json(r, "registry.json")
        if err is None:
            v, p = find_target(reg, a.target)
            vendor_c, product_c = module_constant(rel(script), "VENDOR"), module_constant(rel(script), "PRODUCT")
            r.add("VENDOR/PRODUCT are exact registry values",
                  v is not None and vendor_c == v["vendor_name"] and product_c == p["product_name"],
                  f"VENDOR={vendor_c!r} PRODUCT={product_c!r}")
        study, _ = load_json(r, f"vendors/{vslug}/source_study.json")
        sv_c, sa_c = module_constant(rel(script), "STUDY_VERSION"), module_constant(rel(script), "STUDIED_AT")
        r.add("STUDY_VERSION/STUDIED_AT equal source_study.json",
              study is not None and sv_c == study.get("study_version") and sa_c == study.get("studied_at"),
              f"script {sv_c}@{sa_c}, study {(study or {}).get('study_version')}@{(study or {}).get('studied_at')}")
        headless = bool(((study or {}).get("headless_fallback") or {}).get("needed"))
        allowed = ALLOWED_IMPORTS | ({"playwright"} if headless else set())
        stdlib = set(sys.stdlib_module_names)
        bad = set()
        for n in ast.walk(tree):
            mods = [x.name for x in n.names] if isinstance(n, ast.Import) else \
                [n.module] if isinstance(n, ast.ImportFrom) and n.module and n.level == 0 else []
            bad |= {m.split(".")[0] for m in mods} - stdlib - allowed
        r.add("only allowed imports", not bad, ", ".join(sorted(bad)))
    vendor_py = [f for f in os.listdir(rel(f"vendors/{vslug}")) if f.endswith(".py")] \
        if os.path.isdir(rel(f"vendors/{vslug}")) else []
    r.add(f"no vendor-level code in vendors/{vslug}/", not vendor_py, ", ".join(vendor_py))
    r.warn("Not checked here: the --dry-run --limit 5 run, affects_product() behaviour, "
           "--check-ids verdicts and the regression guard.")
    return r.done()


def cmd_runtime(a):
    """collector-runtime-builder definition of done: the boxes a file inspection can tick."""
    r = Report("runtime")
    if check_exists(r, "requirements.txt"):
        lines = [l.strip() for l in open(rel("requirements.txt"), encoding="utf-8") if l.strip()]
        names = [re.split(r"[=<>~!]", l)[0].lower() for l in lines]
        unpinned = [l for l in lines if "==" not in l]
        r.add("requirements.txt has exactly the five pinned packages",
              sorted(names) == sorted(PINNED_PACKAGES) and not unpinned,
              f"found {names}" + (f", unpinned {unpinned}" if unpinned else ""))
    for p in ("schemas/collector.schema.json", "schemas/advisory_record.schema.json"):
        load_json(r, p)
    if check_exists(r, "scripts/collector.py") and check_compiles(r, "scripts/collector.py"):
        want = frontmatter("collector-runtime-builder", "version")
        have = module_constant(rel("scripts/collector.py"), "RUNTIME_VERSION")
        r.add("RUNTIME_VERSION equals skill version", have == want, f"runtime {have}, skill {want}")
        src = open(rel("scripts/collector.py"), encoding="utf-8").read()
        r.add("collector loads schemas/collector.schema.json", "collector.schema.json" in src)
        r.add("collector loads schemas/advisory_record.schema.json", "advisory_record.schema.json" in src)
        tree = ast.parse(src)
        stdlib = set(sys.stdlib_module_names)
        bad = set()
        for n in ast.walk(tree):
            mods = [x.name for x in n.names] if isinstance(n, ast.Import) else \
                [n.module] if isinstance(n, ast.ImportFrom) and n.module and n.level == 0 else []
            bad |= {m.split(".")[0] for m in mods} - stdlib - {"jsonschema", "apscheduler", "requests", "bs4", "lxml", "scripts"}
        r.add("only the five pinned dependencies imported", not bad, ", ".join(sorted(bad)))
    r.warn("Not checked here: --list, --run-once, --normalize, timeout handling and the daemon start-up behaviour.")
    return r.done()


def cmd_source_study(a):
    """source-study definition of done: the boxes a file inspection can tick."""
    r = Report("source-study")
    path = f"vendors/{a.vendor}/source_study.json"
    study, err = load_json(r, path)
    if err:
        return r.done()
    check_required(r, study, ["vendor", "studied_at", "study_version", "urls_studied", "listing", "fields",
                              "product_match"], "study", non_empty=True)
    check_required(r, study, ["workaround_sentinel", "unresolved_hints", "headless_fallback.needed"], "study")
    r.add("studied_at is ISO-8601", iso_ok(study.get("studied_at")), str(study.get("studied_at")))
    check_required(r, study, [f"listing.{k}" for k in ("content_type", "pagination", "product_filter",
                                                       "rows_have_dates", "feed", "coverage")], "study")
    cov = (study.get("listing") or {}).get("coverage") or {}
    if isinstance(cov, dict) and cov.get("reaches_full_history") is False:
        r.add("listing.coverage.alternative_discovery set (listing stops short)",
              "alternative_discovery" in cov, "" if "alternative_discovery" in cov else "missing")
    elif not isinstance(cov, dict) or "reaches_full_history" not in cov:
        r.add("listing.coverage.reaches_full_history", False, "missing")
    check_required(r, study, ["product_match.primary", "product_match.text_fallback"], "study", non_empty=True)
    hints = json.dumps(study.get("unresolved_hints") or [])
    fields = study.get("fields") or {}
    od = fields.get("other_details") or {}
    uncovered = [f for f in STUDY_FIELDS if f not in fields and f not in hints] + \
        [f"other_details.{f}" for f in STUDY_OTHER_DETAILS if f not in od and f not in hints]
    r.add("every field mapped or in unresolved_hints", not uncovered, ", ".join(uncovered))
    dp = fields.get("date_published")
    r.add("fields.date_published records more than one location (the fallback chain)",
          isinstance(dp, dict) and any(k != "location" for k in dp), "" if isinstance(dp, dict) else "missing")
    hf = study.get("headless_fallback") or {}
    if hf.get("needed") is True:
        r.add("headless_fallback.evidence set", bool(hf.get("evidence")), "needed is true but no evidence")
    want = frontmatter("source-study", "version")
    if version_tuple(str(study.get("study_version"))) < version_tuple(want):
        r.warn(f"study_version {study.get('study_version')} is older than the source-study skill {want}")
    r.warn("Not checked here: listing IDs against advisory_id_pattern, and whether each "
           "recorded location really resolves on the page.")
    return r.done()


def cmd_schedule(a):
    """schedule-analysis definition of done."""
    r = Report("schedule")
    sched, err = load_json(r, f"vendors/{a.vendor}/schedule.json")
    if err:
        return r.done()
    check_required(r, sched, ["vendor", "analysis_version", "timezone", "pattern", "cron", "jitter_s", "last_analysed",
                              "evidence.data_points", "evidence.window", "evidence.advisories_per_week",
                              "evidence.weekday_histogram"], "schedule")
    want = frontmatter("schedule-analysis", "version")
    r.add("analysis_version equals skill version", str(sched.get("analysis_version")) == str(want),
          f"file {sched.get('analysis_version')}, skill {want}")
    tz = sched.get("timezone") or ""
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(tz)
        r.add("timezone is a valid IANA name", True, tz)
    except Exception as e:  # noqa: BLE001 - any failure means the name is unusable
        r.add("timezone is a valid IANA name", False, f"{tz!r}: {e}")
        tz = "UTC"
    from scripts.collector import crontab_trigger
    crons = [("cron", sched.get("cron"))] + [(f"burst_windows[{i}].cron", b.get("cron"))
                                             for i, b in enumerate(sched.get("burst_windows") or [])]
    for name, expr in crons:
        try:
            ok = isinstance(expr, str) and len(expr.split()) == 5
            if ok:
                crontab_trigger(expr, tz)
            r.add(f"{name} is 5-field crontab", ok, f"{expr!r}")
        except ValueError as e:
            r.add(f"{name} is 5-field crontab", False, f"{expr!r}: {e}")
    for i, b in enumerate(sched.get("burst_windows") or []):
        r.add(f"burst_windows[{i}] has reason, cron, duration_h",
              bool(b.get("reason")) and bool(b.get("cron")) and isinstance(b.get("duration_h"), (int, float)))
    ev = sched.get("evidence") or {}
    points = ev.get("data_points")
    r.add("evidence.data_points >= 10", isinstance(points, (int, float)) and points >= 10, f"{points}")
    apw, pattern = ev.get("advisories_per_week"), sched.get("pattern")
    tiers = {"frequent": ("0 */2 * * *", 720), "moderate": ("0 */6 * * *", 2160), "sparse": ("0 3 * * *", 3600)}
    if isinstance(apw, (int, float)):
        expect = "frequent" if apw > 5 else "moderate" if apw >= 1 else "sparse"
        r.add("pattern matches advisories_per_week (3.4)", pattern == expect,
              f"pattern {pattern!r}, {apw}/week -> {expect!r}")
    else:
        r.add("pattern is known", False, f"pattern {pattern!r}, advisories_per_week {apw!r}")
    if pattern in tiers:
        cron_want, jit_want = tiers[pattern]
        r.add("cron is the 3.4 base cron for the pattern", sched.get("cron") == cron_want,
              f"{sched.get('cron')!r} vs {cron_want!r}")
        r.add("jitter_s is 10% of the base interval (cap 3600)",
              isinstance(sched.get("jitter_s"), (int, float)) and abs(sched["jitter_s"] - jit_want) <= 1,
              f"{sched.get('jitter_s')} vs {jit_want}")
    r.add("last_analysed is ISO-8601", iso_ok(sched.get("last_analysed")), str(sched.get("last_analysed")))
    return r.done()


def cmd_collector(a):
    """collector.json against schemas/collector.schema.json, plus target == its path."""
    r = Report("collector")
    cj, err = load_json(r, f"vendors/{a.target}/collector.json")
    if err:
        return r.done()
    schema, serr = load_json(r, "schemas/collector.schema.json")
    if serr is None:
        check_schema(r, cj, schema, "matches collector.schema.json")
    r.add("target equals its folder path", cj.get("target") == a.target, f"{cj.get('target')!r}")
    if cj.get("status") == "repairing":
        r.add("repairing target carries repair block", isinstance(cj.get("repair"), dict))
    return r.done()


def cmd_research_inputs(a):
    """Inputs of workaround-triage, mitigation-research and evidence-collection for one advisory."""
    r = Report("research-inputs")
    vslug, _ = a.target.split("/", 1)
    reg, err = load_json(r, "registry.json")
    if err is None:
        v, p = find_target(reg, a.target)
        if r.add("target in registry", p is not None, "" if p else a.target):
            r.add("registry vm_product_version", bool(p.get("vm_product_version")))
            if not p.get("cli_reference"):
                r.warn("registry cli_reference is null: research_tool hosts adds the DOC_DOMAIN_FALLBACK domain")
    advs, err = load_json(r, f"vendors/{a.target}/advisories.json")
    if err is None:
        rec = advs.get(a.advisory_id) if isinstance(advs, dict) else None
        if r.add(f"advisory {a.advisory_id} in advisories.json", rec is not None):
            schema, serr = load_json(r, "schemas/advisory_record.schema.json")
            if serr is None:
                check_schema(r, rec, schema, "record matches advisory_record.schema.json")
            if not rec.get("version_affected"):
                r.warn("record has no version_affected: evidence-collection must stop and ask for the trains")
    load_json(r, f"vendors/{vslug}/source_study.json")
    coll, err = load_json(r, f"vendors/{a.target}/collector.json")
    if err is None:
        r.add("collector.json status is active", coll.get("status") == "active", str(coll.get("status")))
    if os.path.exists(rel(f"vendors/{a.target}/research.json")):
        load_json(r, f"vendors/{a.target}/research.json")
    kfile = f"knowledge/mitigations/{a.target.replace('/', '_')}.md"
    if not os.path.exists(rel(kfile)):
        r.warn(f"no knowledge file {kfile}")
    return r.done()


def cmd_triage(a):
    """A workaround-triage result: the research schema's triage block plus the class rules."""
    r = Report("triage")
    t, err = load_json(r, a.path)
    if err:
        return r.done()
    rs, err = load_json(r, "schemas/research.schema.json")
    if err is None:
        check_schema(r, t, {"$ref": "#/$defs/triage", "$defs": rs["$defs"]}, "matches $defs.triage")
    if isinstance(t, dict):
        cls = t.get("class")
        want = TRIAGE_CONFIDENCE.get(cls)
        r.add("initial_confidence follows the class", t.get("initial_confidence") == want,
              f"{cls} -> {want}, got {t.get('initial_confidence')}")
        if cls == "ABSENT":
            r.add("ABSENT basis is 'workaround field is null'", t.get("basis") == "workaround field is null")
        else:
            r.add("basis quotes the vendor text", bool((t.get("basis") or "").strip()))
    return r.done()


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m scripts.validate",
                                 description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("exists"); s.add_argument("paths", nargs="+"); s.set_defaults(fn=cmd_exists)
    s = sub.add_parser("json"); s.add_argument("path"); s.add_argument("--schema")
    s.add_argument("--require", action="append"); s.set_defaults(fn=cmd_json)
    s = sub.add_parser("builder-inputs"); s.add_argument("vendor_name"); s.add_argument("product_name")
    s.add_argument("--reason", action="append"); s.add_argument("--failure-report")
    s.set_defaults(fn=cmd_builder_inputs)
    s = sub.add_parser("builder-output"); s.add_argument("target"); s.set_defaults(fn=cmd_builder_output)
    s = sub.add_parser("runtime"); s.set_defaults(fn=cmd_runtime)
    s = sub.add_parser("source-study"); s.add_argument("vendor"); s.set_defaults(fn=cmd_source_study)
    s = sub.add_parser("schedule"); s.add_argument("vendor"); s.set_defaults(fn=cmd_schedule)
    s = sub.add_parser("collector"); s.add_argument("target"); s.set_defaults(fn=cmd_collector)
    s = sub.add_parser("research-inputs"); s.add_argument("target"); s.add_argument("advisory_id")
    s.set_defaults(fn=cmd_research_inputs)
    s = sub.add_parser("triage"); s.add_argument("path"); s.set_defaults(fn=cmd_triage)
    a = ap.parse_args(argv)
    if getattr(a, "target", None) and "/" not in a.target:
        ap.error("target must be <vendor>/<product>")
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
