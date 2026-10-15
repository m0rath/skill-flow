#!/usr/bin/env python3
"""Research tool: the mechanical side of the research agent (.claude/agents/research.md).

    python3 -m scripts.research_tool worklist <vendor/product>                 ordered work list
    python3 -m scripts.research_tool show <vendor/product> <advisory_id>       advisory record + fp
    python3 -m scripts.research_tool check <vendor/product> <advisory_id> <entry.json>   checks only
    python3 -m scripts.research_tool merge <vendor/product> <advisory_id> <entry.json> [--review-round]
    python3 -m scripts.research_tool regen <vendor/product>                    rebuild not_mitigatable
    python3 -m scripts.research_tool hosts <vendor>                            allowed hosts
    python3 -m scripts.research_tool families <vendor/product>                 recurring mitigations
    python3 -m scripts.research_tool progress                                  progress bars per product
    python3 -m scripts.research_tool control [on|pause|off] ["note"]           research switch (show or set)
    python3 -m scripts.research_tool consistency <vendor/product>              same fix ranked differently
    python3 -m scripts.research_tool collector-issue <vendor/product> <id> "<note>"   report a record data problem
    python3 -m scripts.research_tool scope-out <vendor/product> <id> "<reason>"   user-decided out of scope
    python3 -m scripts.research_tool smoke <vendor/product>                    pre-research fetch/rule test
    python3 -m scripts.research_tool knowledge-log <added|updated> <file#id> "<note>"   log a knowledge change
    python3 -m scripts.research_tool knowledge-report                         use counts per knowledge entry
    python3 -m scripts.research_tool verify-quotes <vendor/product> [ids…]      is every quote on its cited page?

`merge` runs every check the schema cannot, validates the whole file against
schemas/research.schema.json, and saves atomically under a per-target lock, so
several researchers can save entries of the same target at once. It is the only
writer of research.json besides the reviewer agent.
"""
import datetime
import fcntl
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from collections import defaultdict
from urllib.parse import urlparse

import jsonschema

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHEMA_PATH = os.path.join(ROOT, "schemas", "research.schema.json")
KNOWLEDGE_DIR = os.path.join(ROOT, "knowledge", "mitigations")
USAGE_LOG = os.path.join(ROOT, "knowledge", "usage.log")

# Vendor documentation domains used when a product's registry `cli_reference` is null
# (research agent, Sources). Remove an entry once the registry names the domain itself.
DOC_DOMAIN_FALLBACK = {"fortinet": ["fortinet.com"]}
UGC_FIRST_LABELS = {"community", "forum", "forums", "learningnetwork", "answers", "ideas",
                    "supportforums", "live"}
TRIAGE_CLASSES = {"COMMAND_PROVIDED", "UI_PATH_PROVIDED", "EVIDENCE_REQUIRED", "NON_ACTIONABLE",
                  "NO_WORKAROUND", "ABSENT", "UNKNOWN"}


def slug(s):
    s = re.sub(r"[^a-z0-9.\-_]", "_", s.lower())
    return re.sub(r"_+", "_", s)


def reg_domain(host):
    return ".".join(host.lower().split(".")[-2:])


def load_registry():
    with open(os.path.join(ROOT, "registry.json")) as f:
        return json.load(f)


def allowed_domains(vendor):
    doms = set()
    for v in load_registry()["vendors"]:
        if slug(v["vendor_name"]) != vendor:
            continue
        for k in ("advisories", "advisory_url", "csaf_url"):
            if v.get(k):
                doms.add(reg_domain(urlparse(v[k]).hostname))
        missing_cli = False
        for p in v["products"]:
            if p.get("cli_reference"):
                doms.add(reg_domain(urlparse(p["cli_reference"]).hostname))
            else:
                missing_cli = True
        if missing_cli:
            doms.update(DOC_DOMAIN_FALLBACK.get(vendor, []))
    return sorted(doms)


def url_ok(u, doms):
    h = (urlparse(u).hostname or "").lower()
    if not h or h.split(".")[0] in UGC_FIRST_LABELS:
        return False
    return any(h == d or h.endswith("." + d) for d in doms)


def fp(rec):
    raw = json.dumps(rec, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def paths(t):
    base = os.path.join(ROOT, "vendors", *t.split("/"))
    return os.path.join(base, "advisories.json"), os.path.join(base, "research.json")


def load_advisories(t):
    with open(paths(t)[0]) as f:
        return json.load(f)


def load_research(t):
    rp = paths(t)[1]
    if os.path.exists(rp):
        with open(rp) as f:
            return json.load(f)
    return {"target": t, "updated_at": "", "advisories": {}, "not_mitigatable": {}}


def lock(t):
    """Exclusive per-target lock, held until the process exits (outside vendors/)."""
    lf = open(os.path.join(tempfile.gettempdir(), f"truedge-research-{t.replace('/', '_')}.lock"), "w")
    fcntl.flock(lf, fcntl.LOCK_EX)
    return lf


# ---------------------------------------------------------------- work list
SEV_RANK = {"critical": 0, "high": 1, "medium": 2, "moderate": 2, "important": 1, "low": 3,
            "none": 4, "informational": 4}


def sev_of(rec):
    s = str((rec.get("additional_details") or {}).get("severity") or "").strip().lower()
    ranks = [SEV_RANK[w] for w in re.findall(r"[a-z]+", s) if w in SEV_RANK]
    return (min(ranks) if ranks else 5), s


EXPLOITED = re.compile(
    r"exploited in the wild|actively exploited|known exploited|has observed (active |limited )?exploit"
    r"|observed .{0,40}exploitation|exploits? .{0,80}(have|has) been observed"
    r"|aware of (an instance|instances|reports?) where .{0,60}exploited")
NEGATED = re.compile(r"\bnot\b|\bno\b|unaware|not been")


def exploited(rec):
    ad = rec.get("additional_details") or {}
    txt = " ".join(str(x or "") for x in (ad.get("exploitation_status"), ad.get("details"),
                                           rec.get("summary"))).lower()
    if txt.strip() in ("yes",) or re.match(r"^\s*yes\b", str(ad.get("exploitation_status") or "").lower()):
        return True
    for sent in re.split(r"(?<=[.!?])\s+|\n+", txt):
        if EXPLOITED.search(sent) and not NEGATED.search(sent):
            return True
    return False


def worklist(t):
    adv = load_advisories(t)
    res = load_research(t)["advisories"]
    out = []
    oos = scope_out_ids(t)
    for aid, rec in adv.items():
        r = res.get(aid)
        if aid in oos and r is None:
            continue
        if r is None:
            reason = "new"
        elif r["fp"] != fp(rec):
            reason = "changed"
        elif (r.get("review") or {}).get("status") == "open" and r["review"]["round"] <= 3:
            reason = "review"
        elif "triage" not in r:
            reason = "no_triage"
        else:
            continue
        date = (rec.get("additional_details") or {}).get("date_published") or ""
        s, sname = sev_of(rec)
        ex = exploited(rec)
        first = 0 if reason in ("review", "no_triage") else 1
        out.append((first, 0 if ex else 1, s, _neg(date), aid, reason, sname or "-", ex, date or "-"))
    out.sort()
    return [(o[4], o[5], o[6], o[7], o[8]) for o in out]


def _neg(d):
    return "".join(chr(255 - ord(c)) for c in d)


# ---------------------------------------------------------------- checks
ADV_ORDER = ["fp", "saved_at", "cves", "status", "triage", "not_mitigatable_reason", "research_notes",
             "vulnerable_check", "vulnerable_when", "backup", "mitigation", "evidence", "disablement_safety",
             "open_questions", "knowledge_used", "review"]
MIT_ORDER = ["applies_to", "cves", "priority", "vendor_mentioned", "confidence", "precondition",
             "mitigate", "rollback", "site_values", "reasoning", "impact", "impact_confidence",
             "disablement_safety", "evidence"]
CHECK_ORDER = ["applies_to", "mode", "command", "vulnerable_if", "already_mitigated_if"]
BK_ORDER = ["mode", "command", "variables"]
DS_ORDER = ["tier", "reason", "condition"]
EV_ORDER = ["urls", "quotes"]
TRIAGE_ORDER = ["class", "basis", "hidden_mitigation_hint", "initial_confidence"]
TRIAGE_CONFIDENCE = {"COMMAND_PROVIDED": "high", "UI_PATH_PROVIDED": "medium",
                     "EVIDENCE_REQUIRED": "low", "NON_ACTIONABLE": "very_low",
                     "NO_WORKAROUND": "very_low", "ABSENT": "none", "UNKNOWN": "none"}

# Vendor step conventions: (first-step command regex, last-step command regex).
STEP_RULES = {
    "fortinet": (r"^config\s", r"^end$"),
    "paloalto": (r"^configure$", r"^commit(\s.*)?$"),
    "cisco": (r"^enable$", r"^(copy running-config startup-config|write memory)$"),
    # NX-OS logs straight into EXEC mode (no `enable`); plans start at configure terminal.
    "cisco/nx-os": (r"^configure terminal$", r"^copy running-config startup-config$"),
    # FTD CLI starts at ">" with no enable and no save step (cisco_ftd#B01). Forbid the ASA/IOS forms.
    "cisco/ftd": (r"^(?!enable$|configure terminal$).+", r"^(?!write memory$|copy running-config startup-config$).+"),
    "f5": (r"^tmsh$|^(modify|create|delete)\s|^cd\s", r"^save (/)?sys config.*$"),
    "citrix": (r".", r"^save ns ?config$"),
    "juniper": (r"^(cli|configure)$", r"^commit( and-quit)?$"),
}
# Steps allowed after the save step: they only push or activate what was saved.
POST_SAVE = {"paloalto": r"^(exit|commit-all\s.+|request restart system)$"}
# A new table entry must not get a hard-coded ID (mitigation-research 4, "New table entries").
FIXED_ID = {"fortinet": re.compile(r"^edit\s+[1-9]\d*\s*$")}
SITE = re.compile(r"<[A-Z0-9_]+>")
CONTEXT_SITES = {"<VDOM_NAME>", "<VDOM>", "<VSYS>", "<LOGICAL_SYSTEM>", "<PARTITION>"}


def order(d, keys):
    extra = [k for k in d if k not in keys]
    if extra:
        raise ValueError(f"unexpected keys {extra}")
    return {k: d[k] for k in keys if k in d}


def normalize(e):
    e = order(e, ADV_ORDER)
    if "triage" in e:
        e["triage"] = order(e["triage"], TRIAGE_ORDER)
    if "research_notes" in e:
        e["research_notes"] = order(e["research_notes"], ["root_cause", "attack_path", "conclusion"])
    if "vulnerable_check" in e:
        e["vulnerable_check"] = [order(c, CHECK_ORDER) for c in e["vulnerable_check"]]
    if "backup" in e:
        e["backup"] = [order(b, BK_ORDER) for b in e["backup"]]
    if "evidence" in e:
        e["evidence"] = {"exposure": [order(x, EV_ORDER) for x in e["evidence"]["exposure"]]}
    if "disablement_safety" in e:
        e["disablement_safety"] = order(e["disablement_safety"], DS_ORDER)
    if "mitigation" in e:
        ms = []
        for m in e["mitigation"]:
            m = order(m, MIT_ORDER)
            pc = m["precondition"]
            m["precondition"] = [order(c, CHECK_ORDER) for c in pc] if isinstance(pc, list) else order(pc, CHECK_ORDER)
            m["mitigate"] = [order(s, ["mode", "command"]) for s in m["mitigate"]]
            m["rollback"] = [order(s, ["mode", "command"]) for s in m["rollback"]]
            m["disablement_safety"] = order(m["disablement_safety"], DS_ORDER)
            m["evidence"] = order(m["evidence"], ["why", "how"])
            for k in ("why", "how"):
                m["evidence"][k] = [order(x, EV_ORDER) for x in m["evidence"][k]]
            ms.append(m)
        e["mitigation"] = ms
    return e


def checks(t, e, adv):
    errs = []
    vendor = t.split("/")[0]
    doms = allowed_domains(vendor)
    st = e.get("status")
    if e.get("cves") != adv["cve_ids"]:
        errs.append(f"cves {e.get('cves')} != advisory cve_ids {adv['cve_ids']}")

    tr = e.get("triage")
    if not tr:
        errs.append("triage block missing (workaround-triage result)")
    else:
        c = tr.get("class")
        if c not in TRIAGE_CLASSES:
            errs.append(f"triage.class {c!r} unknown")
        elif tr.get("initial_confidence") != TRIAGE_CONFIDENCE[c]:
            errs.append(f"triage.initial_confidence for {c} must be {TRIAGE_CONFIDENCE[c]}")
        if c == "ABSENT" and adv.get("workaround") not in (None, ""):
            errs.append("triage.class ABSENT but the workaround field is not null")

    for ref in e.get("knowledge_used", []):
        f, _, eid = ref.partition("#")
        if f != t.replace("/", "_"):
            errs.append(f"knowledge_used {ref}: must be this product's file ({t.replace('/', '_')})")
        elif eid not in knowledge_ids(f):
            errs.append(f"knowledge_used {ref}: no such entry in knowledge/mitigations/{f}.md")

    rn = e.get("research_notes") or {}
    for k in ("root_cause", "attack_path", "conclusion"):
        if not rn.get(k):
            errs.append(f"research_notes.{k} missing")
    if st != "NOT_MITIGATABLE" and "not_mitigatable_reason" in e:
        errs.append("not_mitigatable_reason only for NOT_MITIGATABLE")
    if st != "NOT_MITIGATABLE" and "disablement_safety" in e:
        errs.append("advisory-level disablement_safety only for NOT_MITIGATABLE")

    if e.get("vulnerable_when") == "all" and len(e.get("vulnerable_check", [])) < 2:
        errs.append("vulnerable_when 'all' needs at least 2 vulnerable_check entries")
    for c in e.get("vulnerable_check", []):
        try:
            re.compile(c["vulnerable_if"])
        except re.error as x:
            errs.append(f"bad vulnerable_if regex {c['vulnerable_if']!r}: {x}")
    defined = set()
    backup_sites = set()
    for b in e.get("backup", []):
        backup_sites |= set(SITE.findall(b["command"]))
        for n, rx in b.get("variables", {}).items():
            defined.add(n)
            try:
                if re.compile(rx).groups != 1:
                    errs.append(f"backup var {n} regex must have exactly 1 group")
            except re.error as x:
                errs.append(f"bad backup regex {n}: {x}")

    quotes, urls = [], []

    def ev(lst, where, cap=2):
        if not lst:
            errs.append(f"{where} empty")
            return
        if len(lst) > cap:
            errs.append(f"{where} >{cap} entries")
        for x in lst:
            if len(x.get("quotes", [])) > 4:
                errs.append(f"{where} >4 quotes")
            quotes.extend(x.get("quotes", []))
            urls.extend(x.get("urls", []))

    if "evidence" in e:
        ev(e["evidence"].get("exposure"), "evidence.exposure", 4 if st == "NOT_MITIGATABLE" else 3)
    elif st == "MITIGATED":
        errs.append("evidence.exposure required")

    fr, lr = STEP_RULES.get(t, STEP_RULES.get(vendor, (r".", r".")))
    fixed_id = FIXED_ID.get(vendor)
    high = {}
    all_site_values = set()
    for i, m in enumerate(e.get("mitigation", [])):
        w = f"mitigation[{i}]"
        ds = m.get("disablement_safety", {})
        if ds.get("tier") == "SAFE-CONDITIONAL" and not ds.get("condition"):
            errs.append(f"{w} SAFE-CONDITIONAL needs condition")
        if ds.get("tier") not in ("SAFE-CONDITIONAL", "DISRUPTIVE") and ds.get("condition"):
            errs.append(f"{w} condition only for SAFE-CONDITIONAL or DISRUPTIVE")
        if ds.get("tier") == "NON-DISABLABLE":
            errs.append(f"{w} NON-DISABLABLE component cannot be a mitigation")
        pcs = m["precondition"] if isinstance(m["precondition"], list) else [m["precondition"]]
        for pc in pcs:
            try:
                re.compile(pc["already_mitigated_if"])
            except (re.error, KeyError) as x:
                errs.append(f"{w} bad already_mitigated_if: {x}")
        for lname in ("mitigate", "rollback"):
            steps = m.get(lname, [])
            if steps:
                # A plan that never enters a configuration mode (an EXEC action such as
                # "guest-os 1 stop" or "rollback running-config checkpoint X") changes nothing
                # to save, and where the login mode is EXEC (NX-OS) it needs no configure entry.
                exec_only = not any("config" in str(x.get("mode", "")).lower() for x in steps)
                # Where the login mode is EXEC (NX-OS: first rule is a configure command), a plan may
                # also begin with EXEC steps (e.g. "virtual-service install …") before configuring.
                exec_start = "configure" in fr and "config" not in str(steps[0].get("mode", "")).lower()
                if not (exec_only or exec_start) and not re.search(fr, steps[0]["command"].strip()):
                    errs.append(f"{w}.{lname} first step {steps[0]['command']!r} is not the login-mode entry for {vendor}")
                # The save step ends the plan, except for vendor-documented steps that only apply or
                # push the saved config (POST_SAVE), e.g. Panorama commit-all and a restart.
                post = POST_SAVE.get(vendor)
                tail = len(steps)
                while post and tail > 1 and re.search(post, steps[tail - 1]["command"].strip()):
                    tail -= 1
                if not exec_only and not re.search(lr, steps[tail - 1]["command"].strip()):
                    errs.append(f"{w}.{lname} last step {steps[tail - 1]['command']!r} is not the save step for {vendor}")
            if fixed_id:
                for s in steps:
                    if fixed_id.search(s["command"].strip()):
                        errs.append(f"{w}.{lname} {s['command']!r} hard-codes a table entry ID: use the vendor's "
                                    "auto-assign form or an <..._ID> site value (mitigation-research 4)")
        roll = " ".join(s["command"] for s in m.get("rollback", []))
        for v in re.findall(r"\$\{([A-Za-z0-9_]+)\}", roll):
            if v not in defined:
                errs.append(f"{w} rollback ${{{v}}} not defined by backup")
        mit = " ".join(s["command"] for s in m.get("mitigate", []))
        sv = set(m.get("site_values", []))
        all_site_values |= sv
        used = set(SITE.findall(mit))
        pre_used = set(SITE.findall(" ".join(pc.get("command", "") for pc in pcs)))
        if used - sv:
            errs.append(f"{w} site values {used - sv} not in site_values")
        if pre_used - sv:
            errs.append(f"{w} precondition site values {pre_used - sv} not in site_values")
        if sv - used - pre_used:
            errs.append(f"{w} site_values {sv - used - pre_used} not used in mitigate or precondition")
        roll_sites = set(SITE.findall(roll))
        if roll_sites - (used & sv):
            errs.append(f"{w} rollback may only reuse site values its mitigate also uses (new: {roll_sites - (used & sv)})")
        if sv and m.get("confidence") == "very_high":
            errs.append(f"{w} site_values caps confidence at high")
        if "cves" in m:
            if set(m["cves"]) == set(e.get("cves", [])):
                errs.append(f"{w} cves only when covering some, not all")
            if set(m["cves"]) - set(e.get("cves", [])):
                errs.append(f"{w} cves not in advisory")
        if m.get("priority") == "High":
            for c in m.get("cves", e.get("cves", [])):
                key = (c, m.get("applies_to"))
                if key in high:
                    errs.append(f"two High mitigations for {key}")
                high[key] = i
        ev(m.get("evidence", {}).get("why"), f"{w}.evidence.why")
        ev(m.get("evidence", {}).get("how"), f"{w}.evidence.how", 6)
    if backup_sites - all_site_values:
        errs.append(f"backup site values {backup_sites - all_site_values} not listed in any mitigation's site_values")
    if st == "MITIGATED":
        trains = {m.get("applies_to") for m in e.get("mitigation", [])}
        for c in e.get("cves", []):
            if not any((c, tr_) in high for tr_ in trains):
                errs.append(f"MITIGATED but {c} has no High mitigation")
        # A High counts for MITIGATED only with a complete, sourced plan (confidence gate `high`).
        if not any(m.get("priority") == "High" and m.get("confidence") in ("high", "very_high")
                   for m in e.get("mitigation", [])):
            errs.append("MITIGATED but no High mitigation reaches confidence high "
                        "(an incomplete plan means RESEARCH_REQUIRED)")
    for q in quotes:
        if len(q) > 400:
            errs.append(f"quote >400 chars: {q[:60]}...")
    for where, lst in evidence_lists(e):
        qs = [q for x in lst for q in x.get("quotes", [])]
        dup = {q for q in qs if qs.count(q) > 1}
        if dup:
            errs.append(f"{where}: duplicate quotes {[d[:60] for d in dup]}")
    for u in urls:
        if not url_ok(u, doms):
            errs.append(f"URL not on allowed host {doms}: {u}")
    return errs


def evidence_lists(e):
    """Every evidence list of an entry. A quote may repeat across lists (e.g. a shared save step), never within one."""
    if "evidence" in e:
        yield "evidence.exposure", e["evidence"].get("exposure") or []
    for i, m in enumerate(e.get("mitigation", [])):
        for k in ("why", "how"):
            yield f"mitigation[{i}].evidence.{k}", (m.get("evidence") or {}).get(k) or []


def regen(res):
    res["not_mitigatable"] = {k: v["not_mitigatable_reason"] for k, v in sorted(res["advisories"].items())
                              if v.get("status") == "NOT_MITIGATABLE"}


def save(t, res):
    rp = paths(t)[1]
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    out = {"target": t,
           "updated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "advisories": res["advisories"], "not_mitigatable": res.get("not_mitigatable", {})}
    jsonschema.validate(out, schema)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(rp), prefix=".research.", suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, rp)


def do_merge(t, aid, entry_path, write=True, review_round=False):
    adv = load_advisories(t)
    if aid not in adv:
        sys.exit(f"ERROR: {aid} not in {paths(t)[0]}")
    rec = adv[aid]
    with open(entry_path) as f:
        e = json.load(f)
    if isinstance(e, dict) and aid in e and len(e) == 1:
        e = e[aid]
    lf = lock(t)
    res = load_research(t)
    prev = res["advisories"].get(aid)
    e["fp"] = fp(rec)
    e["saved_at"] = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if prev and prev.get("review") and "review" not in e:
        e["review"] = prev["review"]
    if review_round and e.get("review") and e["review"].get("status") != "open":
        e["review"]["round"] = min(3, e["review"]["round"] + 1)
    try:
        e = normalize(e)
    except ValueError as x:
        sys.exit(f"CHECK FAILED: {x}")
    errs = checks(t, e, rec)
    with open(SCHEMA_PATH) as f:
        schema = json.load(f)
    try:
        jsonschema.validate({"target": t, "updated_at": "x", "advisories": {aid: e}}, schema)
    except jsonschema.ValidationError as x:
        errs.append(f"schema: {x.message} at {list(x.absolute_path)}")
    if errs:
        print("CHECK FAILED:")
        for x in errs:
            print(" -", x)
        sys.exit(1)
    if not write:
        print("CHECK OK")
        return
    res["advisories"][aid] = e
    res["advisories"] = dict(sorted(res["advisories"].items()))
    regen(res)
    save(t, res)
    lf.close()
    already = set((prev or {}).get("knowledge_used", [])) if prev and prev.get("fp") == e["fp"] else set()
    for ref in e.get("knowledge_used", []):
        if ref not in already:  # a re-save of the same research does not count as a new use
            log_knowledge("used", ref, target=t, advisory=aid)
    for ref in sorted(already - set(e.get("knowledge_used", []))):
        log_knowledge("retracted", ref, target=t, advisory=aid)  # a re-save dropped this entry
    print(f"SAVED {t} {aid} status={e['status']} fp={e['fp'][:12]}"
          + (f" knowledge_used={','.join(e['knowledge_used'])}" if e.get("knowledge_used") else ""))


# ---------------------------------------------------------------- knowledge
def knowledge_ids(f):
    path = os.path.join(KNOWLEDGE_DIR, f + ".md")
    if not os.path.exists(path):
        return set()
    with open(path) as fh:
        return set(re.findall(r"^### ([BP]\d{2})\b", fh.read(), re.M))


def log_knowledge(event, ref, **kw):
    """Append one JSON line to knowledge/usage.log (under a lock, so parallel saves don't interleave)."""
    line = {"at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "event": event, "entry": ref, **kw}
    lf = open(os.path.join(tempfile.gettempdir(), "truedge-knowledge-log.lock"), "w")
    fcntl.flock(lf, fcntl.LOCK_EX)
    with open(USAGE_LOG, "a") as fh:
        fh.write(json.dumps(line, ensure_ascii=False) + "\n")
    lf.close()


def knowledge_report():
    uses = defaultdict(list)
    changes = defaultdict(list)
    if os.path.exists(USAGE_LOG):
        with open(USAGE_LOG) as fh:
            for raw in fh:
                if raw.strip():
                    x = json.loads(raw)
                    if x["event"] == "used":
                        uses[x["entry"]].append(x)
                    elif x["event"] == "retracted":
                        u = uses[x["entry"]]
                        for i in range(len(u) - 1, -1, -1):  # cancel the latest use by that advisory
                            if u[i].get("advisory") == x.get("advisory"):
                                del u[i]
                                break
                    else:
                        changes[x["entry"]].append(x)
    rows = []
    for name in sorted(os.listdir(KNOWLEDGE_DIR)):
        if name.endswith(".md") and name != "README.md":
            f = name[:-3]
            for eid in sorted(knowledge_ids(f)):
                ref = f"{f}#{eid}"
                u = uses.get(ref, [])
                last = max((x["at"] for x in u), default="-")
                rows.append((ref, len(u), len({x.get("advisory") for x in u}), last,
                             (changes.get(ref) or [{}])[-1].get("at", "-")))
    return rows


# ---------------------------------------------------------------- quote verification
PAGE_CACHE = os.path.join(tempfile.gettempdir(), "truedge-page-cache")


def _norm(s):
    s = s.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u00a0", " ").replace("\u200b", "")
    return re.sub(r"\s+", " ", s).strip().lower()


_HTML_TAGS = "|".join(sorted("""a abbr address area article aside audio b base bdi bdo blockquote body br button canvas
caption cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure
footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main map mark
menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp script
search section select slot small source span strong style sub summary sup svg path g use symbol defs table tbody td
template textarea tfoot th thead time title tr track u ul var video wbr font center nobr tt""".split(), key=len, reverse=True))


def page_text(url):
    """Visible text of a vendor page (cached per run folder), or None when it can't be fetched."""
    import html as _html
    import requests
    os.makedirs(PAGE_CACHE, exist_ok=True)
    key = os.path.join(PAGE_CACHE, hashlib.sha256(url.encode()).hexdigest() + ".txt")
    if os.path.exists(key):
        with open(key, encoding="utf-8") as fh:
            return fh.read()
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                             "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
               "Accept": "text/html,application/xhtml+xml"}
    try:
        r = requests.get(url, headers=headers, timeout=30)
        if r.status_code in (403, 406, 429) or r.status_code >= 500:
            # Some vendor CDNs (cisco.com) block a browser User-Agent that lacks a browser's TLS
            # fingerprint but serve the library's own agent; others (fortiguard.com) need the browser one.
            r2 = requests.get(url, timeout=30)
            if r2.status_code == 200:
                r = r2
    except requests.RequestException:
        return None
    if r.status_code != 200:
        return None
    ctype = r.headers.get("Content-Type", "").lower()
    if "pdf" in ctype or r.content[:5] == b"%PDF-":
        # Some vendor guides (old Cisco trains, PAN-OS 8.1) survive only as PDFs.
        try:
            import io
            from pypdf import PdfReader
            text = _norm(" ".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(r.content)).pages))
        except Exception:
            return None
        with open(key, "w", encoding="utf-8") as fh:
            fh.write(text)
        return text
    if "charset=" not in ctype:
        # requests falls back to ISO-8859-1 for text/* without a charset, which turns
        # UTF-8 punctuation (em dashes, quotes) into mojibake; vendor pages are UTF-8.
        r.encoding = "utf-8"
    if "json" in ctype or r.text.lstrip()[:1] in ("{", "["):
        try:
            strings = []

            def walk(o):
                if isinstance(o, dict):
                    for v in o.values():
                        walk(v)
                elif isinstance(o, list):
                    for v in o:
                        walk(v)
                elif isinstance(o, str):
                    strings.append(o)
            walk(r.json())
            text = _norm(" ".join(strings))
            with open(key, "w", encoding="utf-8") as fh:
                fh.write(text)
            return text
        except ValueError:
            pass  # not JSON after all: fall through to HTML handling
    body = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", r.text)
    body = re.sub(r"(?s)<br\s*/?>|</(p|div|li|tr|h\d|pre)>", "\n", body)
    # Strip only real HTML tags. Some vendor references (NetScaler) print syntax placeholders
    # such as <name> literally in the HTML; a generic <...> strip would delete them from quotes.
    text = _norm(_html.unescape(re.sub(r"</?(?:%s)\b[^>]*>|<!--.*?-->|<![^>]*>" % _HTML_TAGS, " ", body, flags=re.I | re.S)))
    with open(key, "w", encoding="utf-8") as fh:
        fh.write(text)
    return text


def quote_on(quote, text):
    """A quote is on a page when every '...'-separated part of it is, after whitespace normalisation."""
    parts = [x for x in re.split(r"\s*(?:\.\.\.|\u2026)\s*", _norm(quote)) if len(x) > 3]
    return bool(parts) and all(x in text for x in parts)


def verify_quotes(t, only=None):
    """Every (quote, URL) pair of every entry: is the quote on that page? The advisory's own URL is
    also satisfied by the collected record (the vendor's text stored verbatim)."""
    res = load_research(t)["advisories"]
    adv = load_advisories(t)
    problems = []
    for aid, e in sorted(res.items()):
        if only and aid not in only:
            continue
        strings = []

        def _walk(o):
            if isinstance(o, dict):
                for v in o.values():
                    _walk(v)
            elif isinstance(o, list):
                for v in o:
                    _walk(v)
            elif isinstance(o, str):
                strings.append(o)
        _walk(adv.get(aid, {}))
        # Plain strings, not json.dumps: escaping would turn " into \" and fail quotes with quotes.
        record_text = _norm(" ".join(strings))
        for where, lst in evidence_lists(e):
            for x in lst:
                for u in x.get("urls", []):
                    text = page_text(u)
                    for q in x.get("quotes", []):
                        if quote_on(q, record_text) and aid.lower() in u.lower():
                            continue
                        if text is None:
                            problems.append((aid, where, u, "page not fetchable", q[:80]))
                        elif not quote_on(q, text):
                            problems.append((aid, where, u, "quote not on page", q[:80]))
    return problems


# ---------------------------------------------------------------- recurring mitigations
IGNORED_STEPS = re.compile(r"^(end|next|exit|abort|commit( and-quit)?|configure( terminal)?|enable|"
                           r"copy running-config startup-config|write memory|save .*)$")


def family_key(steps):
    """The mitigate commands without mode entry and save steps, with quoting, placeholders and
    the last token of `allowaccess` lines normalised, so variants group together."""
    out = []
    for s in steps:
        c = s["command"].strip()
        if IGNORED_STEPS.match(c):
            continue
        c = c.replace('"', "")
        c = SITE.sub("<X>", c)
        c = re.sub(r"^edit\s+\S+$", "edit <X>", c)
        c = re.sub(r"^((un)?select|set) allowaccess .*$", r"\1 allowaccess <PROTO>", c)
        if not out or out[-1] != c:
            out.append(c)
    return " / ".join(out[:4])


def families(t):
    res = load_research(t)["advisories"]
    g = defaultdict(list)
    for aid, r in res.items():
        seen = set()
        for m in r.get("mitigation") or []:
            k = family_key(m.get("mitigate", []))
            if k in seen:
                continue
            seen.add(k)
            g[k].append((aid, m.get("priority"), m.get("confidence")))
    return sorted(((k, v) for k, v in g.items() if len({a for a, _, _ in v}) >= 2), key=lambda x: -len(x[1]))


def consistency(t):
    """Mitigation families used by 2+ advisories whose priority or tier differ: review these."""
    res = load_research(t)["advisories"]
    g = defaultdict(list)
    for aid, r in res.items():
        for m in r.get("mitigation") or []:
            g[family_key(m.get("mitigate", []))].append(
                (aid, m.get("priority"), (m.get("disablement_safety") or {}).get("tier"), m.get("confidence")))
    out = []
    for k, v in g.items():
        if len({a for a, *_ in v}) < 2:
            continue
        if len({p for _, p, _, _ in v}) > 1 or len({tr for _, _, tr, _ in v}) > 1:
            out.append((k, v))
    return sorted(out, key=lambda x: -len(x[1]))


def issues_path(t):
    return os.path.join(ROOT, "vendors", t, "logs", "collector_issues.jsonl")


def collector_issue(t, aid, note):
    """Researchers report data problems in a collected record; the collector agent reads this file."""
    p = issues_path(t)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    row = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "target": t, "advisory_id": aid, "note": note}
    with open(p, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")
    print("logged collector issue", t, aid)


def smoke(t):
    """Before researching a product: can we fetch its advisory and doc pages, and which step rules apply?"""
    vendor = t.split("/")[0]
    print("step rules:", STEP_RULES.get(t, STEP_RULES.get(vendor)), "| post-save:", POST_SAVE.get(vendor))
    urls = []
    kf = os.path.join(ROOT, "knowledge", "mitigations", t.replace("/", "_") + ".md")
    if os.path.exists(kf):
        urls += re.findall(r"`(https?://[^`<|]+)`", open(kf, encoding="utf-8").read())[:6]
    adv = load_advisories(t)
    tpl = next((v.get("advisory_url") for v in load_registry()["vendors"] if slug(v["vendor_name"]) == vendor), None)
    for aid in list(adv)[:3]:
        if tpl:
            urls.append(tpl.replace("{advisory_id}", aid))
    for u in dict.fromkeys(urls):
        tx = page_text(u)
        print(("OK  " if tx and len(tx) > 500 else "BAD ") + str(len(tx) if tx else None).rjust(8), u[:140])


CONTROL = os.path.join(ROOT, "state", "research_control.json")
TARGETS_ORDER = ["fortinet/fortios", "citrix/netscaler", "cisco/nx-os", "cisco/ftd", "cisco/asa", "cisco/ios",
                 "juniper/junos_os", "f5/big-ip", "paloalto/pan-os"]


def control(state=None, note=""):
    """Research switch: on (launch researchers), pause (finish running ones, start none), off (stop all)."""
    cur = {"state": "on", "since": None, "note": ""}
    if os.path.exists(CONTROL):
        cur = json.load(open(CONTROL, encoding="utf-8"))
    if state:
        if state not in ("on", "pause", "off"):
            sys.exit("state must be on, pause or off")
        cur = {"state": state, "since": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "note": note}
        os.makedirs(os.path.dirname(CONTROL), exist_ok=True)
        with open(CONTROL, "w", encoding="utf-8") as fh:
            json.dump(cur, fh, indent=1)
    return cur


def _scope_file(t):
    return os.path.join(ROOT, "state", "scope_out", t.replace("/", "_") + ".json")


def scope_out_ids(t):
    """Advisories the user put out of scope for this target (e.g. NX-OS ACI mode): not researched."""
    f = _scope_file(t)
    return json.load(open(f, encoding="utf-8")) if os.path.exists(f) else {}


def scope_out(t, aid, reason):
    if aid not in load_advisories(t):
        sys.exit(f"ERROR: {aid} is not a collected advisory of {t}")
    if aid in load_research(t)["advisories"]:
        sys.exit(f"ERROR: {aid} already has a research entry; scope-out applies to unresearched advisories only")
    cur = scope_out_ids(t)
    cur[aid] = {"reason": reason, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    os.makedirs(os.path.dirname(_scope_file(t)), exist_ok=True)
    with open(_scope_file(t), "w", encoding="utf-8") as fh:
        json.dump(cur, fh, indent=1, sort_keys=True)
    print("scoped out", t, aid)


def progress():
    """One bar per product: researched share, split by status."""
    c = control()
    print(f"research switch: {c['state'].upper()}" + (f" since {c['since']}" if c.get("since") else "")
          + (f" ({c['note']})" if c.get("note") else ""))
    tot_a = tot_r = 0
    for t in TARGETS_ORDER:
        try:
            n = len(load_advisories(t))
        except Exception:
            continue
        try:
            res = load_research(t)["advisories"]
        except Exception:
            res = {}
        st = defaultdict(int)
        for e in res.values():
            st[e.get("status")] += 1
        oos = len(set(scope_out_ids(t)) - set(res))
        n -= oos
        r = len(res)
        tot_a += n
        tot_r += r
        w = 30
        m = round(w * st["MITIGATED"] / n) if n else 0
        nm = round(w * st["NOT_MITIGATABLE"] / n) if n else 0
        rr = round(w * st["RESEARCH_REQUIRED"] / n) if n else 0
        bar = "#" * m + "x" * nm + "?" * rr
        bar = (bar + "." * w)[:w]
        pct = 100 * r / n if n else 0
        print(f"{t:18} [{bar}] {r:4}/{n:<5} {pct:5.1f}%  M={st['MITIGATED']} NM={st['NOT_MITIGATABLE']} RR={st['RESEARCH_REQUIRED']}"
              + (f" (+{oos} out of scope)" if oos else ""))
    print(f"{'TOTAL':18}  {tot_r}/{tot_a} ({100*tot_r/tot_a:.1f}%)   legend: # mitigated  x not mitigatable  ? research required  . to do")


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "worklist":
        for row in worklist(a[1]):
            print(*row)
    elif cmd == "show":
        rec = load_advisories(a[1])[a[2]]
        print(json.dumps(rec, indent=1, ensure_ascii=False))
        print("fp", fp(rec))
    elif cmd == "merge":
        do_merge(a[1], a[2], a[3], True, "--review-round" in a)
    elif cmd == "check":
        do_merge(a[1], a[2], a[3], False)
    elif cmd == "regen":
        lf = lock(a[1])
        res = load_research(a[1])
        regen(res)
        save(a[1], res)
        print("regenerated", len(res["not_mitigatable"]))
    elif cmd == "hosts":
        print(allowed_domains(a[1]))
    elif cmd == "knowledge-log":
        if len(a) < 4 or a[1] not in ("added", "updated"):
            sys.exit("usage: knowledge-log <added|updated> <file#id> \"<note>\"")
        f, _, eid = a[2].partition("#")
        if eid not in knowledge_ids(f):
            sys.exit(f"ERROR: {a[2]} is not an entry of knowledge/mitigations/{f}.md")
        log_knowledge(a[1], a[2], note=a[3])
        print("logged", a[1], a[2])
    elif cmd == "knowledge-report":
        print("entry | uses | advisories | last used | last changed")
        for r in knowledge_report():
            print(*r, sep=" | ")
    elif cmd == "verify-quotes":
        probs = verify_quotes(a[1], set(a[2:]) or None)
        for pr in probs:
            print(*pr, sep=" | ")
        print(f"{len(probs)} problem(s)")
    elif cmd == "control":
        print(json.dumps(control(a[1] if len(a) > 1 else None, " ".join(a[2:])), indent=1))
    elif cmd == "progress":
        progress()
    elif cmd == "consistency":
        for k, v in consistency(a[1]):
            print(k)
            for row in v:
                print("   ", *row)
    elif cmd == "collector-issue":
        collector_issue(a[1], a[2], a[3])
    elif cmd == "scope-out":
        if len(a) < 4:
            sys.exit("usage: scope-out <vendor/product> <advisory_id> \"<reason>\"")
        scope_out(a[1], a[2], a[3])
    elif cmd == "smoke":
        smoke(a[1])
    elif cmd == "families":
        for k, v in families(a[1]):
            print(len({x[0] for x in v}), "|", k, "|", ", ".join(f"{x[0]}:{x[1]}/{x[2]}" for x in v))
    else:
        sys.exit(__doc__)
