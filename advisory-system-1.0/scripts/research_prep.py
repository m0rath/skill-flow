"""Research preparation: group advisories into families and pre-fill a draft skeleton.

Cheap, deterministic work done before any researcher runs, so a researcher studies one family
once and later researchers only apply what it found (see .claude/agents/research.md, "Families").

    python3 -m scripts.research_prep families <vendor/product> [--json]   group advisories by feature
    python3 -m scripts.research_prep prefill <vendor/product> <advisory_id> [out.json]   draft skeleton
    python3 -m scripts.research_prep draft-from <vendor/product> <advisory_id> <master_id> [out.json]   applier draft

`families` writes state/families/<vendor>_<product>.json. `prefill` prints (or writes) a skeleton
that is never saved to research.json by itself: a researcher completes it and saves it with
research_tool merge.
"""
import json
import os
import re
import sys
from collections import defaultdict

from scripts import research_tool as rt

ROOT = rt.ROOT

# Feature lexicon: family name -> regex over the advisory's summary, details and configuration text.
# Order matters: the first match wins, most specific first. Keep names stable (they key knowledge).
FAMILIES = [
    ("cli-local-command", r"\b(cli|command[- ]line( interface| interpreter)?|cli parser|shell|bash|vsh|python|tcl|scripting|license installation|network-operator)\b.{0,160}\b(command injection|arbitrary (shell )?command|privilege|elevated|root|escape|read and write|create or overwrite|create files|bypass)\b|\b(command injection|arbitrary command)\b.{0,80}\b(cli|command[- ]line|local)\b|\bauthenticated, local attacker\b"),
    ("image-boot-signature", r"\b(signature verification|patch installation|secure boot|boot ?loader|image (signature|verification)|software image|rommon|firmware verification)\b"),
    ("snmp", r"\bsnmp\b"),
    ("nx-api-rest", r"\bnx-?api\b|\brest api\b|\brestconf\b|\bnetconf\b"),
    ("web-http-ui", r"\b(web[- ]based (management|ui|interface)|web ui|http server|https? (server|service)|web server|gui|webvpn|clientless)\b"),
    ("ssh", r"\bssh\b|\bscp\b|\bsftp\b"),
    ("telnet", r"\btelnet\b"),
    ("ike-ipsec-vpn", r"\b(ike(v1|v2)?|isakmp|ipsec|ssl ?vpn|anyconnect|remote access vpn|dtls)\b"),
    ("aaa-tacacs-radius-ldap-saml", r"\b(tacacs\+?|radius|ldap|saml|aaa|authentication bypass)\b"),
    ("bgp", r"\bbgp\b"),
    ("ospf", r"\bospf(v3)?\b"),
    ("isis", r"\b(is-is|isis)\b"),
    ("eigrp-rip-pim-multicast", r"\b(eigrp|rip|pim|igmp|msdp|multicast)\b"),
    ("vxlan-evpn-overlay", r"\b(vxlan|evpn|otv|lisp|mpls|ldp|segment routing)\b"),
    ("fabric-aci-apic", r"\b(aci|apic|fabric (mode|switch)|application centric)\b"),
    ("lldp-cdp-discovery", r"\b(lldp|cdp|discovery protocol)\b"),
    ("dhcp-dhcpv6", r"\bdhcp(v6)?\b"),
    ("ntp-ptp-time", r"\b(ntp|ptp|precision time)\b"),
    ("dns", r"\bdns\b"),
    ("ipv6-nd", r"\b(ipv6|neighbor discovery|icmpv6)\b"),
    ("arp-l2-stp", r"\b(arp|spanning tree|stp|vlan|mac address|l2|layer 2)\b"),
    ("ha-cluster-vpc", r"\b(vpc|high availability|failover|cluster|hsrp|vrrp)\b"),
    ("smart-licensing-callhome", r"\b(smart licens|call home|telemetry)\b"),
    ("sip-voice", r"\b(sip|h\.323|mgcp|voice|cme)\b"),
    ("netflow-sflow", r"\b(netflow|sflow|ipfix)\b"),
    ("dos-packet-processing", r"\b(denial of service|dos)\b.{0,120}\b(packet|traffic|crafted|malformed)\b"),
    ("crypto-tls-openssl", r"\b(openssl|tls|ssl|certificate|x\.509|cipher)\b"),
    ("file-read-write-traversal", r"\b(path traversal|directory traversal|arbitrary file|file (read|write|overwrite))\b"),
]
_COMPILED = [(n, re.compile(rx, re.I | re.S)) for n, rx in FAMILIES]
SENT = re.compile(r"(?<=[.!?])\s+")

PLATFORM_HINTS = [
    ("nexus-9000", r"nexus 9\d{3}|n9k|nexus 9000"), ("nexus-7000", r"nexus 7\d{3}|n7k|nexus 7000"),
    ("nexus-5000-6000", r"nexus [56]\d{3}"), ("nexus-3000", r"nexus 3\d{3}|n3k"),
    ("nexus-1000v", r"nexus 1000v|nexus 1000 series|vsm\b"), ("mds-9000", r"\bmds 9\d{3}|\bmds\b"),
    ("ucs-fi", r"\bucs\b|fabric interconnect"), ("aci-mode", r"\baci mode\b|application centric"),
]
_PLATFORMS = [(n, re.compile(rx, re.I)) for n, rx in PLATFORM_HINTS]


def _text(rec):
    d = rec.get("additional_details") or {}
    parts = [rec.get("summary") or "", str(d.get("required_configuration") or ""), rec.get("advisory_id", "")]
    return " ".join(parts)


EXTRA = [  # families seen in the pilot data that the base lexicon missed
    ("nexus1000v-vsm-vem", r"\b(nexus 1000v|virtual supervisor module|virtual ethernet module|vsm|vem)\b"),
    ("onep-programmability", r"\b(onep|open network environment)\b"),
    ("cfs-fabric-services", r"\b(cfs|cisco fabric services)\b"),
    ("poap-bootstrap", r"\bpoap\b|power on auto provisioning"),
    ("bfd", r"\bbfd\b|bidirectional forwarding"),
    ("icmp-ip-stack", r"\b(icmp|ip stack|tcp stack|netstack|ip-in-ip|ipip|gre)\b"),
    ("acl-bypass", r"\b(access control list|acl)\b.{0,80}\b(bypass|not (be )?(enforced|applied))\b"),
    ("data-management-engine", r"\b(dme|data management engine)\b"),
    ("guest-shell-containers", r"\b(guest shell|bash shell|container|app hosting)\b"),
]
_COMPILED += [(n, re.compile(rx, re.I | re.S)) for n, rx in EXTRA]
FIREWALL = [  # ASA/FTD terms, checked first so they win ties against the generic lexicon
    ("snort-detection-engine", r"\b(snort|detection engine|preprocessor|file policy|intrusion (prevention|policy)|ips rule|rate filter(ing)?|application detection|geolocation|dce/?rpc|mime|smb2?|tcp fast open)\b"),
    ("inspection-alg", r"\b(inspection engine|\w+ inspection|application level gateway|alg|enip)\b"),
    ("vpn-web-services", r"\b(web services|anyconnect|remote access vpn|ra vpn|ssl vpn|webvpn|clientless|vpn web server)\b"),
    ("lua-interpreter", r"\blua\b"),
    ("syslog-logging", r"\b(syslog|logging)\b"),
]
_COMPILED[:0] = [(n, re.compile(rx, re.I | re.S)) for n, rx in FIREWALL]
# On-box managers and the FMC tunnel. FMC itself is only named as the configuring tool in most FTD
# advisories, so it is not a family term.
_COMPILED.append(("fdm-fcm-sftunnel", re.compile(r"\b(firepower device manager|fdm|chassis manager|fcm|sftunnel)\b", re.I)))


def family_of(rec):
    """Score every family: a match in the advisory ID counts 3, in the summary's first sentence 2,
    anywhere else 1. The highest score wins; ties go to the earlier (more specific) family."""
    aid = rec.get("advisory_id", "").replace("-", " ")
    summ = rec.get("summary") or ""
    first = SENT.split(summ, 1)[0] if summ else ""
    rest = _text(rec)
    best, best_score = "other", 0
    for i, (name, rx) in enumerate(_COMPILED):
        sc = 3 * bool(rx.search(aid)) + 2 * bool(rx.search(first)) + bool(rx.search(rest))
        if sc > best_score:
            best, best_score = name, sc
    if best == "cli-local-command":
        t = (aid + " " + first + " " + rest).lower()
        if re.search(r"\b(bash|guest ?shell|python|tcl|nx-?api|sandbox|scp|sftp|poap|telnet|ssh)\b", t):
            return "cli-local-disableable-feature"
        if re.search(r"\b(signature|image|patch installation|boot|rommon|bios|firmware|install)\b", t):
            return "cli-local-image-install"
        return "cli-local-command"
    return best


def platforms_of(rec):
    t = _text(rec) + " " + json.dumps(rec.get("version_affected") or [])
    return [n for n, rx in _PLATFORMS if rx.search(t)] or ["unspecified"]


def families(t, write=True):
    adv = rt.load_advisories(t)
    try:
        done = rt.load_research(t)["advisories"]
    except Exception:
        done = {}
    groups = defaultdict(list)
    for aid, rec in adv.items():
        d = rec.get("additional_details") or {}
        groups[family_of(rec)].append({
            "id": aid, "year": (d.get("date_published") or "")[:4], "severity": str(d.get("severity") or "")[:20],
            "platforms": platforms_of(rec), "researched": done.get(aid, {}).get("status")})
    out = {k: sorted(v, key=lambda x: x["year"], reverse=True) for k, v in
           sorted(groups.items(), key=lambda kv: -len(kv[1]))}
    if write:
        p = os.path.join(ROOT, "state", "families", t.replace("/", "_") + ".json")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1)
    return out


HINT = re.compile(r"(?i)\b(not affected|not vulnerable|only (if|when)|is affected if|are affected if|vulnerable if|"
                  r"must be (enabled|configured)|is enabled by default|disabled by default|to determine whether|"
                  r"there are no workarounds|workaround|mitigat)")
BOILER = re.compile(r"(?i)customers should (not deploy|be aware|determine)|temporary solutions until|test environment|"
                    r"any workaround or mitigation that is implemented|intrinsic customer deployment")
CMD = re.compile(r"(?m)^\s*(?:[\w.-]+[#>]\s*)?((?:show|no|feature|configure terminal|interface|ip|ipv6|snmp-server|"
                 r"crypto|router|ntp|logging|line|aaa|username|copy)\b[^\n]{0,160})$")


def prefill(t, aid):
    """A draft skeleton: every fact the advisory already states, so the researcher only fills gaps."""
    rec = rt.load_advisories(t)[aid]
    d = rec.get("additional_details") or {}
    blob = "\n".join(str(x) for x in [rec.get("summary"), rec.get("workaround"), d.get("required_configuration"),
                                      d.get("solution")] if x)
    hints = [x.strip()[:500] for x in SENT.split(blob.replace("\n", " "))
             if HINT.search(x) and not BOILER.search(x)][:10]
    cmds = list(dict.fromkeys(m.group(1).strip() for m in CMD.finditer(blob)))[:15]
    lines = defaultdict(list)
    for v in rec.get("version_affected") or []:
        raw = (v.get("raw") or v.get("from") or "").strip()
        m = re.match(r"^(.*?)\s*(\d[\w.()-]*)$", raw)
        (lines[m.group(1)] if m else lines[raw]).append(m.group(2) if m else "")
    trains = {k or "(unnamed)": {"count": len(v), "first": v[0], "last": v[-1]} for k, v in lines.items()}
    fam = family_of(rec)
    return {
        "_prefill": {
            "family": fam, "platforms": platforms_of(rec),
            "knowledge_file": f"knowledge/mitigations/{t.replace('/', '_')}.md",
            "vendor_hint_sentences": hints, "commands_printed_by_advisory": cmds,
            "affected_release_lines": trains, "exploitation_status": d.get("exploitation_status"),
            "note": "Skeleton from research_prep. Every field below must be verified and completed; delete _prefill before merge.",
        },
        "cves": rec.get("cve_ids") or [],
        "status": "RESEARCH_REQUIRED",
        "open_questions": [],
    }


def draft_from(t, aid, master):
    """Start an applier's draft from a saved master entry: keep the plan, checks, backup, rollback and
    how-evidence; blank what is advisory-specific; attach the prefill hints. The applier fills every
    TODO, deletes `_todo` and `_prefill`, then saves with research_tool merge."""
    res = rt.load_research(t)["advisories"]
    m = json.loads(json.dumps(res[master]))
    for k in ("fp", "saved_at", "review"):
        m.pop(k, None)
    murl = master.lower()
    def keep(lst):
        return [x for x in (lst or []) if not any(murl in u.lower() for u in x.get("urls", []))]
    ev = m.get("evidence") or {}
    if "exposure" in ev:
        ev["exposure"] = keep(ev["exposure"])
    for mit in m.get("mitigation") or []:
        e2 = mit.get("evidence") or {}
        if "why" in e2:
            e2["why"] = keep(e2["why"])
        mit.pop("cves", None)
    pre = prefill(t, aid)
    rec = rt.load_advisories(t)[aid]
    m["cves"] = rec.get("cve_ids") or []
    m["status"] = "RESEARCH_REQUIRED"
    m["research_notes"] = {"root_cause": "TODO", "attack_path": "TODO", "conclusion": "TODO"}
    # Triage belongs to the master's advisory: blank it so it is never carried over by mistake.
    m["triage"] = {"class": "TODO", "basis": "TODO: quote THIS advisory's workaround text",
                   "hidden_mitigation_hint": "TODO or null", "initial_confidence": "TODO"}
    m["open_questions"] = [q for q in m.get("open_questions", []) if q.startswith(("SCOPE:", "CHECK:"))]
    m["_todo"] = [
        f"triage: classify THIS advisory ({aid}); do not reuse the master's triage",
        "evidence.exposure and every mitigation evidence.why: add this advisory's own quotes (collected record), citing its advisory URL; the master's advisory quotes were removed",
        "applies_to: limit to this advisory's affected platforms/trains that the plan's sources cover; put the rest in open_questions",
        "vendor_mentioned: true only if THIS advisory proposes the change",
        "research_notes and open_questions: rewrite for this advisory; set status (MITIGATED only if every CVE has a High >= high)",
        f"plan/checks/backup/rollback/how-quotes come from master {master}: keep them unless this advisory differs",
    ]
    # Pre-fill this advisory's own condition sentences as evidence, when they are verbatim in the record.
    strings = []

    def _w(o):
        if isinstance(o, dict):
            for v in o.values():
                _w(v)
        elif isinstance(o, list):
            for v in o:
                _w(v)
        elif isinstance(o, str):
            strings.append(o)
    _w(rec)
    rtext = rt._norm(" ".join(strings))
    cond = [h for h in pre["_prefill"]["vendor_hint_sentences"]
            if re.search(r"(?i)\b(affect|vulnerable|only|enabled|configured|not affected)\b", h)
            and len(h) <= 400 and rt.quote_on(h, rtext)][:3]
    tpl = next((v.get("advisory_url") for v in rt.load_registry()["vendors"]
                if rt.slug(v["vendor_name"]) == t.split("/")[0]), "")
    if cond and tpl:
        entry = {"urls": [tpl.replace("{advisory_id}", aid)], "quotes": cond}
        ev.setdefault("exposure", []).insert(0, json.loads(json.dumps(entry)))
        for mit in m.get("mitigation") or []:
            mit.setdefault("evidence", {}).setdefault("why", []).insert(0, json.loads(json.dumps(entry)))
        m["_todo"].insert(0, "PRE-FILLED: this advisory's condition sentences were added to exposure and each why (verbatim from the record); confirm they state the condition the plan removes, trim if not")
    m["_prefill"] = pre["_prefill"]
    order = ["_todo", "_prefill"] + [k for k in m if k not in ("_todo", "_prefill")]
    return {k: m[k] for k in order}


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    if a[0] == "families":
        fam = families(a[1])
        if "--json" in a:
            print(json.dumps(fam, indent=1))
        else:
            for k, v in fam.items():
                done = sum(1 for x in v if x["researched"])
                print(f"{k:30} {len(v):4}  researched={done:3}  e.g. {', '.join(x['id'] for x in v[:3])}")
    elif a[0] == "prefill":
        sk = prefill(a[1], a[2])
        if len(a) > 3:
            with open(a[3], "w", encoding="utf-8") as fh:
                json.dump(sk, fh, indent=1)
            print("wrote", a[3])
        else:
            print(json.dumps(sk, indent=1))
    elif a[0] == "draft-from":
        d = draft_from(a[1], a[2], a[3])
        out = a[4] if len(a) > 4 else None
        if out:
            with open(out, "w", encoding="utf-8") as fh:
                json.dump(d, fh, indent=1)
            print("wrote", out)
        else:
            print(json.dumps(d, indent=1))
    else:
        sys.exit(__doc__)
