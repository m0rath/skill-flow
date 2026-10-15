"""Synthetic vendor 'acme': JSON listing (paged), HTML detail pages, CSAF twins (one 404, one 500 then ok)."""
import json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

ADV = {
 "ACME-SA-2026-0001": dict(pub="2026-01-10", upd="2026-01-10", cves=["CVE-2026-1001"], title="AcmeOS CLI privilege escalation",
     summary="A vulnerability in the CLI of AcmeOS could allow an authenticated, local attacker to elevate privileges to root.",
     workaround="Disable the debug shell:\n  config system debug\n    set shell disable\n  end", products=["AcmeOS", "AcmeCloud"],
     affected=[("AcmeOS", "7.2.0"), ("AcmeOS", "7.2.1"), ("AcmeCloud", "2.0")], sec="Fixed in AcmeOS 7.2.2. Exploitation: not known.",
     cwe="CWE-269", csaf=True),
 "ACME-SA-2026-0002": dict(pub="2026-02-14", upd="2026-02-20", cves=["CVE-2026-1002", "CVE-2026-1003"], title="AcmeOS SSL VPN heap overflow",
     summary="Multiple heap-based buffer overflows in the SSL VPN daemon allow an unauthenticated remote attacker to execute code.",
     workaround="There are no workarounds that address this vulnerability.", products=["AcmeOS"],
     affected=[("AcmeOS", "range:7.0.0-7.0.9"), ("AcmeOS", "range:6.4.0-6.4.14")], sec="Upgrade to 7.0.10 or 6.4.15. Disabling SSL VPN mitigates exposure.",
     cwe=["CWE-122", "CAPEC-100"], csaf=True),
 "ACME-SA-2026-0003": dict(pub="2026-03-03", upd="2026-03-03", cves=["CVE-2026-1004"], title="AcmeCloud console XSS",
     summary="A stored XSS in the AcmeCloud console.", workaround=None, products=["AcmeCloud"],
     affected=[("AcmeCloud", "2.1")], sec="Fixed in AcmeCloud 2.2.", cwe="CWE-79", csaf=False),
 "ACME-SA-2026-0004": dict(pub="2026-04-01", upd="2026-04-01", cves=[], title="AcmeOS hardening notice",
     summary="Informational: AcmeOS all versions ship with a default community string that should be changed.",
     workaround="Change the SNMP community string.", products=["AcmeOS"], affected=[("AcmeOS", "all")], sec=None, cwe=None, csaf=None),
 "ACME-SA-2025-0009": dict(pub="2025-11-20", upd="2025-11-20", cves=["CVE-2025-9009"], title="AcmeOS DoS in BGP",
     summary="A crafted BGP UPDATE causes AcmeOS to restart the routing daemon.", workaround="Apply a prefix filter on untrusted peers.",
     products=["AcmeOS"], affected=[("AcmeOS", "branch:6.2")], sec="Fixed in 6.2.9.", cwe="CWE-20", csaf=True),
}
ORDER = sorted(ADV, key=lambda k: ADV[k]["pub"], reverse=True)
csaf_flaky = {"ACME-SA-2025-0009": 1}
CTL = {"fail_detail": set(), "hide": set(), "mismatch": set(), "redesign": False}   # first CSAF request answers 500, then OK

def detail_html(aid, a):
    rows = "".join(f"<tr><td>{p}</td><td>{v.replace('range:','').replace('branch:','') if not v.startswith('range:') else v[6:].replace('-',' through ')}</td><td>Affected</td></tr>" for p, v in a["affected"])
    cves = ", ".join(a["cves"]) or "None"
    wa = f"<div id='workaround'><h2>Workaround</h2><p>{a['workaround'].replace(chr(10),'<br>')}</p></div>" if a["workaround"] else ""
    sec = f"<div id='fixed'><h2>Fixed Software</h2><p>{a['sec']}</p></div>" if a["sec"] else ""
    cwe = a["cwe"] if isinstance(a["cwe"], str) else (", ".join(a["cwe"]) if a["cwe"] else "")
    return f"""<html><head><title>{a['title']}</title></head><body>
<h1 id='title'>{a['title']}</h1>
<dl class='meta'><dt>Advisory ID</dt><dd id='advisory-id'>{aid}</dd><dt>First Published</dt><dd id='published'>{a['pub']}</dd>
<dt>CVE</dt><dd id='cves'>{cves}</dd><dt>CWE</dt><dd id='cwe'>{cwe}</dd></dl>
<div id='summary'><h2>Summary</h2><p>{a['summary']}</p></div>
<div id='affected'><h2>Affected Products</h2><p>Affected: {', '.join(a['products'])}.</p>
<table id='versions'><tr><th>Product</th><th>Version</th><th>Status</th></tr>{rows}</table></div>
{wa}{sec}
<div id='history'><h2>Revision History</h2><table><tr><td>1.0</td><td>Initial</td><td>{a['pub']}</td></tr></table></div>
</body></html>"""

def csaf_json(aid, a):
    leaves, affected = [], []
    for i, (p, v) in enumerate(a["affected"]):
        pid = f"P{i}"
        if v.startswith("range:"):
            lo, hi = v[6:].split("-"); name = f"{p} vers:acme/>={lo}|<={hi}"
        elif v.startswith("branch:"):
            name = f"{p} {v[7:]}.x"
        else:
            name = f"{p} {v}"
        leaves.append({"product": {"product_id": pid, "name": name}})
        if p == "AcmeOS":
            affected.append(pid)
    return {"document": {"title": a["title"]}, "product_tree": {"branches": [{"name": "Acme", "branches": leaves}]},
            "vulnerabilities": [{"cve": c, "product_status": {"known_affected": affected}} for c in a["cves"]]}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body, ctype):
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(body.encode())
    def do_GET(self):
        u = urlparse(self.path); q = parse_qs(u.query)
        if u.path == "/__ctl":
            for k, vals in q.items():
                if k == "redesign": CTL["redesign"] = vals[0] == "1"
                elif k == "reset": CTL.update(fail_detail=set(), hide=set(), mismatch=set(), redesign=False)
                elif k in CTL: CTL[k] ^= set(vals)
            return self._send(200, json.dumps({k: sorted(v) if isinstance(v, set) else v for k, v in CTL.items()}), "application/json")
        if u.path == "/advisories":
            page = int(q.get("page", ["0"])[0]); size = 3
            items = [{"id": k, "published": ADV[k]["pub"], "updated": ADV[k]["upd"], "products": ADV[k]["products"]}
                     for k in [o for o in ORDER if o not in CTL["hide"]][page*size:(page+1)*size]]
            return self._send(200, json.dumps({"total": len(ORDER), "page": page, "items": items}), "text/html")  # lying content type on purpose
        if u.path.startswith("/advisory/"):
            aid = u.path.rsplit("/", 1)[1]
            if aid in CTL["fail_detail"]: return self._send(503, "down", "text/plain")
            if aid in ADV:
                a = dict(ADV[aid])
                if aid in CTL["mismatch"]: a = {**a, "products": ["AcmeCloud"], "affected": [("AcmeCloud", "2.0")], "csaf": None}
                html = detail_html(aid, a)
                if CTL["redesign"]: html = html.replace("id='summary'", "id='abstract'").replace("id='workaround'", "id='mitigations'").replace("<dl class='meta'>", "<dl class='meta2'>")
                return self._send(200, html, "text/html; charset=utf-8")
            return self._send(404, "nope", "text/plain")
        if u.path.startswith("/csaf/"):
            aid = u.path.rsplit("/", 1)[1].replace(".json", "")
            a = ADV.get(aid)
            if aid in CTL["mismatch"]: a = None
            if not a or a["csaf"] is None: return self._send(404, "{}", "application/json")
            if a["csaf"] is False: return self._send(200, "<html>oops</html>", "text/html")  # wrong URL answers HTML 200
            if csaf_flaky.get(aid):
                csaf_flaky[aid] -= 1; return self._send(500, "err", "text/plain")
            return self._send(200, json.dumps(csaf_json(aid, a)), "application/json")
        return self._send(404, "nope", "text/plain")

if __name__ == "__main__":
    HTTPServer(("127.0.0.1", int(sys.argv[1]) if len(sys.argv) > 1 else 8765), H).serve_forever()
