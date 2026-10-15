"""Shared fetch core - ONE engine for every vendor-product fetch script.

Built by the advisory-script-builder skill. Vendor-agnostic: registry loading, the
browser-fingerprint HTTP session (rate limit, retries, Retry-After), listing
pagination and product narrowing through the product script's hooks, CSAF-first
detail fetching, delta / resume / failed-ID retry / incomplete re-check, record
validation, atomic storage, run logging, the dry-run stats contract and the
RUN_SUMMARY line. Everything vendor- or product-specific lives in the product's
run/fetch_advisories.py, which passes itself to main().

Hook interface (the product module passed as `parser`):
    listing_request(listing_url, product, page) -> (url, params) | None     page = 0, 1, 2 ...
    parse_listing(doc, product) -> [{"advisory_id", "date_published", "date_updated"}]
    detail_url(advisory_url_template, advisory_id) -> str
    parse_advisory_id(doc), parse_cve_ids(doc), parse_summary(doc),
    parse_version_affected(doc, product), parse_workaround(doc),
    parse_additional_details(doc, fields)      fields = the study's other_details + date_published locations
    affects_product(doc, product) -> bool | None | (bool | None, detail), is_withdrawn(doc) -> bool
        (the detail of a False result goes into the rejection)
    constants: VENDOR, PRODUCT (exact registry values), STUDY_VERSION, STUDIED_AT (from source_study.json)
    optional: csaf_url(csaf_url_template, advisory_id) -> str
`doc` is a Doc (below): doc.page (parsed detail: dict/list for JSON, BeautifulSoup for
HTML), doc.csaf (parsed CSAF dict or None), doc.row (listing row or None), doc.get(url)
for best-effort extra requests (e.g. bug descriptions) through the same polite session.
`product` is a Product (below) with product_name, vm_product_version, vendor_name, and
`product.study` - the vendor's source_study.json (the only source of field locations).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import signal
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import jsonschema
import requests
from bs4 import BeautifulSoup, NavigableString, Tag

CORE_VERSION = "1.0"

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REGISTRY = REPO_ROOT / "registry.json"
RECORD_SCHEMA_PATH = REPO_ROOT / "schemas" / "advisory_record.schema.json"
HEADERS_TEMPLATE = REPO_ROOT / "templates" / "headers.json"
VENDORS_DIR = REPO_ROOT / "vendors"

EXIT_SUCCESS, EXIT_PARTIAL, EXIT_FAILED, EXIT_CONFIG = 0, 1, 2, 3

REQUIRED_HOOKS = ("listing_request", "parse_listing", "detail_url", "parse_advisory_id", "parse_cve_ids",
                  "parse_summary", "parse_version_affected", "parse_workaround", "parse_additional_details",
                  "affects_product", "is_withdrawn")
REQUIRED_CONSTANTS = ("VENDOR", "PRODUCT", "STUDY_VERSION", "STUDIED_AT")
CORE_KEYS = ("advisory_id", "cve_ids", "summary", "version_affected", "workaround", "additional_details")
IMPORTANT_DETAILS = ("security_details",)      # with workaround, cve_ids, version_affected: what a mitigation author needs
STUDY_VERSIONS_UNDERSTOOD = ("1.0",)
# study fields -> record fields (for study_field_coverage and the fingerprint's fields_found)
STUDY_FIELD_MAP = {"advisory_id": "advisory_id", "cve_ids": "cve_ids", "summary": "summary", "title": "summary",
                   "affected_products": "version_affected", "workaround": "workaround",
                   "date_published": "additional_details.date_published"}
OTHER_DETAILS = ("cwe_capec_mitre", "security_details", "bug_details", "impact", "discovered", "attack_type", "reference")
CVE_RE = re.compile(r"^CVE-\d{4}-\d{4,}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MIN_INTERVAL_S = 0.5            # default pace: at most 2 requests per second per host (study rate_limit overrides)
MAX_TRIES = 4                   # 1 try + 3 retries on 429 / 5xx / connection errors, backoff 2 s .. 64 s
MAX_PAGES = 500                 # pagination safety cap: hit it -> exit 2, cursor unmoved
TIMEOUT_S = 45
RECHECK_NO_DATE_DAYS = 7
FULL_LISTING_EVERY = timedelta(hours=24)
DRY_RUN_DEFAULT = 5
MISMATCH_RECHECK = timedelta(days=30)   # a product-mismatch rejection is re-fetched after 30 days

log = logging.getLogger("advisory-core")


class ConfigError(Exception):
    pass


class ListingError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


# ----------------------------------------------------------------- small generic helpers
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(s):
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9._-]", "_", name.lower())
    return re.sub(r"_+", "_", s).strip("_")


def collapse_ws(text):
    """Strip and collapse all whitespace (single-line fields)."""
    if text is None:
        return None
    t = re.sub(r"\s+", " ", str(text).replace(" ", " ")).strip()
    return t or None


def keep_lines(text):
    """Normalise whitespace but keep line breaks (workaround, solution, details, ...)."""
    if text is None:
        return None
    t = str(text).replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", ln).rstrip() for ln in t.split("\n")]
    out = "\n".join(lines)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out or None


def iso_date(value, formats=()):
    """Return YYYY-MM-DD from an ISO-8601 datetime/date or one of `formats`, else None."""
    if not value:
        return None
    s = str(value).strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[T ]|$)", s)
    if m:
        dt = parse_iso(s)
        if dt is not None:
            return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
        return m.group(1)
    for fmt in formats:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


_BLOCK_TAGS = {"p", "div", "br", "li", "ul", "ol", "tr", "table", "tbody", "thead", "h1", "h2", "h3", "h4", "h5",
               "h6", "pre", "blockquote", "section", "article", "dd", "dt", "dl", "hr"}
_INLINE_TAGS = {"a", "span", "strong", "b", "em", "i", "u", "code", "font", "sup", "sub", "small", "big", "abbr",
                "td", "th", "img", "tt", "cite", "q", "s", "strike", "label", "nobr", "wbr"}
_KNOWN_TAGS = _BLOCK_TAGS | _INLINE_TAGS | {"html", "body", "head", "script", "style", "noscript", "button", "input",
                                            "form", "select", "option", "textarea", "iframe", "svg", "path", "caption",
                                            "colgroup", "col", "tfoot", "center", "nav", "header", "footer", "main",
                                            "figure", "figcaption", "meta", "link", "title", "area", "map", "object"}


def render_text(el) -> str | None:
    """Block-aware text of an HTML element: newlines at block elements only, <pre> kept verbatim,
    unknown elements (unescaped CLI placeholders such as <removed>) emitted back as literal text."""
    if el is None:
        return None
    parts: list[str] = []

    def walk(node, in_pre=False):
        for child in node.children:
            if isinstance(child, NavigableString):
                if type(child).__name__ in ("Comment", "Doctype", "Declaration", "ProcessingInstruction"):
                    continue
                s = str(child)
                parts.append(s if in_pre else re.sub(r"[ \t\r\f\v]+", " ", s))
                continue
            if not isinstance(child, Tag):
                continue
            name = child.name.lower()
            if name in ("script", "style", "noscript"):
                continue
            if name not in _KNOWN_TAGS:
                parts.append(f"<{child.name}>")
                walk(child, in_pre)
                continue
            if name == "br":
                parts.append("\n")
                continue
            block = name in _BLOCK_TAGS
            if block:
                parts.append("\n")
            if name in ("td", "th"):
                parts.append(" ")
            walk(child, in_pre or name == "pre")
            if block:
                parts.append("\n")

    walk(el)
    text = "".join(parts)
    lines = [ln.strip(" ") if not ln.startswith("  ") else ln.rstrip() for ln in text.split("\n")]
    out = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    return out or None


def outermost(soup, element_id):
    """The outermost element with this id (older templates nest a duplicate id inside it)."""
    if soup is None:
        return None
    for el in soup.find_all(id=element_id):
        if el.find_parent(id=element_id) is None:
            return el
    return None


def product_matches(name, product) -> bool:
    if not name:
        return False
    n = re.sub(r"\s+", " ", str(name)).strip().lower()
    cands = {product.product_name.lower(), f"{product.vendor_name} {product.product_name}".lower()}
    if product.vm_product_version:
        cands.add(product.vm_product_version.lower())
    return n in cands


# ----------------------------------------------------------------- registry
class Product:
    def __init__(self, vendor: dict, entry: dict):
        self.vendor = vendor
        self.entry = entry
        self.vendor_name = vendor["vendor_name"]
        self.product_name = entry["product_name"]
        self.vm_product_version = entry.get("vm_product_version")
        self.key = f"{slug(self.vendor_name)}/{slug(self.product_name)}"
        self.listing_url = entry.get("advisories") or vendor["advisories"]
        self.advisory_url = vendor["advisory_url"]
        self.csaf_url = vendor.get("csaf_url")
        self.id_pattern = re.compile(vendor["advisory_id_pattern"])
        self.dir = VENDORS_DIR / slug(self.vendor_name) / slug(self.product_name)
        self.study_path = VENDORS_DIR / slug(self.vendor_name) / "source_study.json"
        self.study = {}
        self.rate_interval = MIN_INTERVAL_S

    def load_study(self):
        """vendors/<vendor>/source_study.json - the only source of field locations and quirks."""
        try:
            with open(self.study_path, encoding="utf-8") as fh:
                self.study = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            raise ConfigError(f"source study {self.study_path} cannot be read: {exc}") from exc
        for key in ("listing", "product_match", "fields"):
            if not isinstance(self.study.get(key), dict):
                raise ConfigError(f"source study lacks the '{key}' block")
        if self.study.get("vendor") != self.vendor_name:
            raise ConfigError(f"source study is for vendor {self.study.get('vendor')!r}, not {self.vendor_name!r}")
        if str(self.study.get("study_version")) not in STUDY_VERSIONS_UNDERSTOOD:
            raise ConfigError(f"study_version {self.study.get('study_version')!r} is not one this core understands "
                              f"({', '.join(STUDY_VERSIONS_UNDERSTOOD)})")
        if (self.study.get("auth") or {}).get("required"):
            raise ConfigError("the study says this source requires credentials; generated scripts never carry any")
        self.rate_interval = rate_interval(self.study.get("rate_limit"))
        return self.study


def load_registry(path: Path, vendor_name: str, product_name: str):
    try:
        with open(path, encoding="utf-8") as fh:
            reg = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"registry {path} cannot be read: {exc}") from exc
    for v in reg.get("vendors") or []:
        if v.get("vendor_name") == vendor_name:
            for p in v.get("products") or []:
                if p.get("product_name") == product_name:
                    for key in ("advisories", "advisory_url", "advisory_id_pattern"):
                        if not v.get(key):
                            raise ConfigError(f"vendor {vendor_name} lacks '{key}'")
                    try:
                        re.compile(v["advisory_id_pattern"])
                    except re.error as exc:
                        raise ConfigError(f"advisory_id_pattern invalid: {exc}") from exc
                    return reg, v, p
    raise ConfigError(f"{vendor_name}/{product_name} is not in the registry")


def resolve_fields(study: dict) -> dict:
    """The locations handed to parse_additional_details(): the study's fields.other_details.* plus
    date_published, each as {"location", "notes"} (location None when the study found no fixed place)."""
    fields = (study or {}).get("fields") or {}
    out = {}
    for name in OTHER_DETAILS:
        spec = (fields.get("other_details") or {}).get(name) or {}
        out[name] = {"location": spec.get("location"), "notes": spec.get("notes")}
    dp = fields.get("date_published") or {}
    out["date_published"] = {"location": dp.get("location"), "notes": dp.get("notes")}
    return out


def rate_interval(rate_limit) -> float:
    """Seconds between requests from the study's rate_limit ('1 req/s', '0.5 requests per second', 2 -> 2/s,
    '1 per 3 s'); unknown or absent -> the default pace, never faster than it."""
    if rate_limit in (None, "", False):
        return MIN_INTERVAL_S
    if isinstance(rate_limit, (int, float)) and rate_limit > 0:
        return max(MIN_INTERVAL_S, 1.0 / float(rate_limit))
    text = str(rate_limit).lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:req(?:uest)?s?)?\s*(?:/|per)\s*(\d+(?:\.\d+)?)?\s*(s|sec|second|min|minute)", text)
    if not m:
        return MIN_INTERVAL_S
    n, per, unit = float(m.group(1)), float(m.group(2) or 1), m.group(3)
    seconds = per * (60.0 if unit.startswith("min") else 1.0)
    return max(MIN_INTERVAL_S, seconds / n) if n else MIN_INTERVAL_S


def write_registry_time(path: Path, vendor_name: str, product_name: str, when: str) -> None:
    """Atomic write-back of the script-maintained updated_time only."""
    with open(path, encoding="utf-8") as fh:
        raw = fh.read()
    reg = json.loads(raw)
    for v in reg["vendors"]:
        if v.get("vendor_name") == vendor_name:
            for p in v["products"]:
                if p.get("product_name") == product_name:
                    p["updated_time"] = when
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(reg, fh, indent=2, ensure_ascii=False, sort_keys=True)  # the registry's own style
        fh.write("\n")
    os.replace(tmp, path)


# ----------------------------------------------------------------- HTTP
def browser_headers() -> dict:
    tpl = json.loads(HEADERS_TEMPLATE.read_text(encoding="utf-8"))
    cmds = tpl.get("version_commands") or {}
    cmd = cmds.get("darwin" if sys.platform == "darwin" else "linux")
    major = None
    if cmd:
        try:
            out = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=15).stdout
            m = re.search(r"(\d+)\.\d+", out)
            major = m.group(1) if m else None
        except (OSError, subprocess.SubprocessError):
            major = None
    if not major:
        raise ConfigError("cannot read the installed browser's major version with the templates/headers.json "
                          "command; the full real-browser header set cannot be built")
    headers = {k: v.replace("{chrome_major}", major) for k, v in tpl["headers"].items()}
    if sys.platform != "darwin":
        headers["sec-ch-ua-platform"] = '"Linux"'
        headers["User-Agent"] = headers["User-Agent"].replace("Macintosh; Intel Mac OS X 10_15_7", "X11; Linux x86_64")
    try:  # advertise br only if a brotli decoder is importable
        import brotli  # noqa: F401
        headers["Accept-Encoding"] = headers["Accept-Encoding"] + ", br"
    except ImportError:
        pass
    return headers


class Http:
    def __init__(self, interval: float = MIN_INTERVAL_S):
        self.session = requests.Session()
        self.session.headers.update(browser_headers())
        self.interval = max(interval, MIN_INTERVAL_S)
        self.last = {}
        self.stats = {"requests": 0, "retries": 0, "429": 0, "5xx": 0}

    def _pace(self, host):
        wait = self.interval - (time.monotonic() - self.last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        self.last[host] = time.monotonic()

    def get(self, url, params=None, headers=None):
        """GET with pacing, redirects and retries. Returns the final Response, or raises requests exceptions
        after the last try (a 4xx other than 429 is returned immediately)."""
        host = urlparse(url).netloc
        delay = 2
        for attempt in range(1, MAX_TRIES + 1):
            self._pace(host)
            self.stats["requests"] += 1
            try:
                r = self.session.get(url, params=params, headers=headers, timeout=TIMEOUT_S, allow_redirects=True)
            except (requests.ConnectionError, requests.Timeout) as exc:
                if attempt == MAX_TRIES:
                    raise
                log.warning("GET %s: %s - retry %d in %ds", url, exc.__class__.__name__, attempt, delay)
            else:
                if r.status_code == 429 or r.status_code >= 500:
                    self.stats["429" if r.status_code == 429 else "5xx"] += 1
                    if attempt == MAX_TRIES:
                        return r
                    ra = r.headers.get("Retry-After")
                    wait = int(ra) if ra and ra.isdigit() else delay
                    log.warning("GET %s: HTTP %d - retry %d in %ds", r.url, r.status_code, attempt, wait)
                    self.stats["retries"] += 1
                    time.sleep(min(wait, 120))
                    delay = min(delay * 2, 64)
                    continue
                return r
            self.stats["retries"] += 1
            time.sleep(delay)
            delay = min(delay * 2, 64)
        raise requests.ConnectionError(f"no response from {url}")


def detect_type(resp) -> str:
    """Body first, header second: some sources send JSON as text/html (playbook)."""
    body = resp.text.lstrip()[:1]
    ctype = (resp.headers.get("Content-Type") or "").lower()
    if body in ("{", "["):
        return "json"
    if "json" in ctype and body:
        return "json"
    if "xml" in ctype or resp.text.lstrip().startswith("<?xml"):
        return "xml"
    if "html" in ctype or body == "<":
        return "html"
    return "text"


def parse_body(resp, kind):
    if kind == "json":
        try:
            return json.loads(resp.text)
        except json.JSONDecodeError:
            return None
    if kind == "html":
        return BeautifulSoup(resp.content, "lxml")
    if kind == "xml":
        return BeautifulSoup(resp.content, "xml")
    return resp.text


def structure_hash(obj, kind) -> str:
    paths = set()
    if kind == "json":
        def walk(o, p):
            if isinstance(o, dict):
                for k, v in o.items():
                    walk(v, f"{p}.{k}")
            elif isinstance(o, list):
                for v in o:
                    walk(v, p + "[]")
            else:
                paths.add(p)
        for o in (obj if isinstance(obj, tuple) else (obj,)):
            walk(o, "")
    elif kind in ("html", "xml") and obj is not None:
        for soup in (obj if isinstance(obj, tuple) else (obj,)):
            for el in soup.find_all(True):
                ident = el.name
                if kind == "html":
                    ident += "#" + (el.get("id") or "") + "." + ".".join(el.get("class") or [])
                paths.add(ident)
    return hashlib.sha256("\n".join(sorted(paths)).encode("utf-8")).hexdigest()


# ----------------------------------------------------------------- documents and records
class Doc:
    def __init__(self, advisory_id, row, page, page_type, csaf, http):
        self.advisory_id = advisory_id
        self.row = row
        self.page = page
        self.page_type = page_type
        self.csaf = csaf
        self._http = http
        self.log = log

    def get(self, url, headers=None):
        """Best-effort extra request (e.g. a bug description). Returns the Response or None."""
        try:
            r = self._http.get(url, headers=headers)
        except requests.RequestException as exc:
            log.warning("%s: extra request %s failed: %s", self.advisory_id, url, exc)
            return None
        if r.status_code != 200:
            log.warning("%s: extra request %s answered HTTP %d", self.advisory_id, url, r.status_code)
            return None
        return r


_schema_validator = None


def record_validator():
    global _schema_validator
    if _schema_validator is None:
        _schema_validator = jsonschema.Draft202012Validator(json.loads(RECORD_SCHEMA_PATH.read_text(encoding="utf-8")))
    return _schema_validator


def _clean_details(d) -> dict:
    out = {}
    for k, v in (d or {}).items():
        if v is None or v == "" or v == [] or v == {}:
            continue
        out[k] = v
    return out


def missing_fields(rec: dict, csaf_missing: bool = False) -> list:
    miss = []
    if csaf_missing:
        miss.append("csaf")
    if not rec.get("workaround"):
        miss.append("workaround")
    if not rec.get("cve_ids"):
        miss.append("cve_ids")
    if not rec.get("version_affected"):
        miss.append("version_affected")
    ad = rec.get("additional_details") or {}
    miss += [k for k in IMPORTANT_DETAILS if not ad.get(k)]
    return miss


def _important(rec):
    ad = rec.get("additional_details") or {}
    return {"workaround": rec.get("workaround"), "cve_ids": rec.get("cve_ids") or [],
            "version_affected": rec.get("version_affected") or [],
            **{k: ad.get(k) for k in IMPORTANT_DETAILS}}


def _populated(value) -> bool:
    return value not in (None, "", [], {})


def record_fields_found(rec: dict) -> dict:
    """{study field name: populated?} for one record - every study-located field maps to a record field."""
    ad = rec.get("additional_details") or {}
    out = {}
    for sf, rf in STUDY_FIELD_MAP.items():
        out[sf] = _populated(ad.get(rf.split(".", 1)[1]) if rf.startswith("additional_details.") else rec.get(rf))
    for name in OTHER_DETAILS:
        out[f"other_details.{name}"] = _populated(ad.get(name))
    return out


def study_located_fields(study: dict) -> list:
    """Study field names whose location is not null and that are not listed in unresolved_hints."""
    fields = (study or {}).get("fields") or {}
    hints = json.dumps((study or {}).get("unresolved_hints") or [])
    out = []
    for name in STUDY_FIELD_MAP:
        if name == "advisory_url":
            continue
        spec = fields.get(name) or {}
        if spec.get("location") and name not in hints:
            out.append(name)
    for name in OTHER_DETAILS:
        spec = (fields.get("other_details") or {}).get(name) or {}
        if spec.get("location") and name not in hints:
            out.append(f"other_details.{name}")
    return out


class Runner:
    def __init__(self, parser, product: Product, args, http: Http):
        self.p = parser
        self.product = product
        self.args = args
        self.http = http
        self.fields = resolve_fields(product.study)
        self.fields_found = {}
        self.detail_types = set()
        self.detail_structs = []
        self.version_sources = []

    # --- listing -------------------------------------------------------------
    def iter_listing(self, since, full):
        """Yield listing pages -> rows (dicts), newest first. Stops on None / empty page / all rows older than since."""
        page = 0
        self.listing_fp = {}
        self.listing_pages = 0
        seen_ids = set()
        while True:
            if page >= MAX_PAGES:
                raise ListingError(f"pagination safety cap: {MAX_PAGES} pages reached at {self.product.listing_url}; "
                                   f"last page {page - 1} - run failed, cursor unmoved")
            req = self.p.listing_request(self.product.listing_url, self.product, page)
            if req is None:
                return
            url, params = req
            try:
                r = self.http.get(url, params=params)
            except requests.RequestException as exc:
                raise ListingError(f"listing unreachable: {exc}") from exc
            if r.status_code != 200:
                raise ListingError(f"listing answered HTTP {r.status_code}", r.status_code)
            kind = detect_type(r)
            doc = parse_body(r, kind)
            self.listing_pages += 1
            if page == 0:
                req_u, fin_u = urlparse(url), urlparse(r.url)
                self.listing_fp = {"content_type": r.headers.get("Content-Type"), "status": r.status_code,
                                   "structure_hash": structure_hash(doc, kind), "body_type": kind}
                if (req_u.netloc, req_u.path) != (fin_u.netloc, fin_u.path):
                    self.listing_fp["redirected_to"] = r.url
            rows = self.p.parse_listing(doc, self.product) or []
            log.info("listing page %d: %d rows (%s)", page, len(rows), r.url)
            if not rows:
                return
            new_ids = {row.get("advisory_id") for row in rows} - seen_ids
            if not new_ids:
                raise ListingError(f"pagination safety cap: page {page} of {r.url} repeats IDs already seen - "
                                   f"run failed, cursor unmoved")
            seen_ids |= new_ids
            yield rows
            if since and not full and all((row.get("date_published") or "9999") < since for row in rows):
                log.info("listing rows are older than --since %s; stop paginating", since)
                return
            page += 1

    def collect_rows(self, since, full):
        seen, rows = set(), []
        for page_rows in self.iter_listing(since, full):
            for row in page_rows:
                aid = row.get("advisory_id")
                if not aid or not self.product.id_pattern.search(aid):
                    log.warning("listing id %r does not match advisory_id_pattern; skipped", aid)
                    continue
                if aid in seen:
                    continue
                seen.add(aid)
                rows.append(row)
        self.listing_fp["item_count"] = len(rows)
        return rows

    # --- detail --------------------------------------------------------------
    def load_doc(self, aid, row):
        """Fetch the detail page (and CSAF) -> (Doc | None, csaf_missing, failure info | None)."""
        url = self.p.detail_url(self.product.advisory_url, aid)
        try:
            r = self.http.get(url)
        except requests.RequestException as exc:
            log.warning("%s: detail fetch failed: %s", aid, exc)
            return None, False, {"status": 0}
        if r.status_code != 200:
            log.warning("%s: detail answered HTTP %d", aid, r.status_code)
            return None, False, {"status": r.status_code}
        kind = detect_type(r)
        page = parse_body(r, kind)
        self.detail_types.add(r.headers.get("Content-Type"))
        csaf, csaf_missing = None, False
        if self.product.csaf_url:
            curl = (self.p.csaf_url(self.product.csaf_url, aid) if hasattr(self.p, "csaf_url")
                    else self.product.csaf_url.replace("{advisory_id}", aid))
            try:
                c = self.http.get(curl)
                body = c.text.lstrip()[:1]
                if c.status_code == 200 and body == "{":
                    csaf = json.loads(c.text)
                elif c.status_code == 404:
                    log.info("%s: no CSAF (404) - page only", aid)
                else:
                    log.info("%s: CSAF unavailable (HTTP %d, %s) - page only, re-check later", aid, c.status_code,
                             "JSON" if body == "{" else "not JSON")
                    csaf_missing = True
            except (requests.RequestException, json.JSONDecodeError) as exc:
                log.info("%s: CSAF unavailable (%s) - page only, re-check later", aid, exc)
                csaf_missing = True
        doc = Doc(aid, row, page, kind, csaf, self.http)
        self.detail_structs.append(structure_hash(page, kind) if kind != "json" else page)
        return doc, csaf_missing, None

    def affects(self, doc):
        """affects_product() -> (True/False/None, detail | None); the hook may return a bool, None or (value, detail). None = unreadable."""
        res = self.p.affects_product(doc, self.product)
        if isinstance(res, tuple):
            raw, detail = (res[0] if res else None), (res[1] if len(res) > 1 else None)
        else:
            raw, detail = res, None
        # None = the advisory's data could not be read (neither source checked): not a mismatch (1.8)
        ok = None if raw is None else bool(raw)
        return ok, (str(detail) if detail not in (None, "") else None)

    def fetch(self, aid, row):
        """Return (record | None, status, info) where status is 'ok', 'failed', 'mismatch' or 'invalid'."""
        doc, csaf_missing, failure = self.load_doc(aid, row)
        if doc is None:
            return None, "failed", failure
        ok, detail = self.affects(doc)
        if ok is None:
            log.warning("%s: affects_product() could not read the advisory - recorded as failed%s", aid,
                        f": {detail}" if detail else "")
            status = (failure or {}).get("status") or 0
            return None, "failed", {"status": status, **({"detail": detail} if detail else {})}
        if not ok:
            log.info("%s: does not affect %s - rejected (product mismatch)%s", aid, self.product.product_name,
                     f": {detail}" if detail else "")
            return None, "mismatch", ({"detail": detail} if detail else {})
        rec = self.build_record(aid, doc)
        errors = list(record_validator().iter_errors(rec))
        if errors:
            log.warning("%s: record fails the schema: %s", aid, errors[0].message)
            return rec, "invalid", {"reason": f"schema: {errors[0].message}"}
        return rec, "ok", {"csaf_missing": csaf_missing, "withdrawn": bool(self.p.is_withdrawn(doc))}

    def build_record(self, aid, doc):
        def safe(name, *a):
            try:
                return getattr(self.p, name)(*a)
            except Exception as exc:  # noqa: BLE001 - parsers must not break a run
                log.warning("%s: parser %s raised %r - treated as not found", aid, name, exc)
                return None
        page_id = safe("parse_advisory_id", doc)
        if page_id and page_id != aid:
            log.warning("%s: detail page names id %s", aid, page_id)
        cves = []
        for c in safe("parse_cve_ids", doc) or []:
            if isinstance(c, str) and CVE_RE.match(c) and c not in cves:
                cves.append(c)
        versions = safe("parse_version_affected", doc, self.product) or []
        good = []
        for v in versions:
            if isinstance(v, dict) and product_matches(v.get("product"), self.product):
                good.append(v)
            else:
                log.warning("%s: version entry for another product dropped: %r", aid, v)
        rec = {
            "advisory_id": aid,
            "cve_ids": cves,
            "summary": safe("parse_summary", doc),
            "version_affected": good,
            "workaround": safe("parse_workaround", doc),
            "additional_details": _clean_details(safe("parse_additional_details", doc, self.fields)),
        }
        for study_field, rec_field in record_fields_found(rec).items():
            self.fields_found[study_field] = self.fields_found.get(study_field, False) or rec_field
        for field in ("summary", "workaround"):
            if rec[field] is None and field != "workaround":
                log.warning("%s: field %s not found", aid, field)
        if not cves:
            log.warning("%s: field cve_ids not found", aid)
        if not good:
            log.warning("%s: field version_affected not found", aid)
        if not rec["additional_details"].get("date_published"):
            log.warning("%s: field date_published not found", aid)
        srcs = {v.get("source") for v in good}
        self.version_sources.append("csaf" if "csaf" in srcs else ("page" if good else "none"))
        return rec

    def fingerprint(self):
        fp = {"listing": self.listing_fp}
        if self.detail_types:
            jsons = tuple(d for d in self.detail_structs if not isinstance(d, str))
            if jsons:
                shash = structure_hash(jsons, "json")
            else:
                shash = hashlib.sha256("\n".join(sorted(set(self.detail_structs))).encode()).hexdigest()
            fp["detail"] = {"content_type": sorted(t for t in self.detail_types if t)[0] if any(self.detail_types) else None,
                            "structure_hash": shash, "fields_found": dict(sorted(self.fields_found.items()))}
        return fp


# ----------------------------------------------------------------- storage
class Store:
    def __init__(self, path: Path):
        self.path = path
        self.data = {}

    def load(self):
        try:
            with open(self.path, encoding="utf-8") as fh:
                self.data = json.load(fh)
        except FileNotFoundError:
            self.data = {}
        return self.data

    def add(self, rec):
        self.data[rec["advisory_id"]] = rec
        self.save_atomic()

    def save_atomic(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(self.path.name + ".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(self.data, fh, indent=2, ensure_ascii=False, sort_keys=True)
            fh.write("\n")
        os.replace(tmp, self.path)


# ----------------------------------------------------------------- logging
def setup_logging(product: Product, started: datetime, dry_run: bool):
    log.setLevel(logging.INFO)
    log.handlers.clear()
    log.propagate = False
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%dT%H:%M:%SZ")
    fmt.converter = time.gmtime
    # dry run: stdout carries exactly one JSON object, so its log lines go to stderr and no file is written
    stream = logging.StreamHandler(sys.stderr if dry_run else sys.stdout)
    stream.setFormatter(fmt)
    log.addHandler(stream)
    if dry_run:
        return None
    logs = product.dir / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    name = started.strftime("%Y-%m-%dT%H-%M-%SZ") + ".log"
    fh = logging.FileHandler(logs / name, encoding="utf-8")
    fh.setFormatter(fmt)
    log.addHandler(fh)
    return f"logs/{name}"


def check_hooks(module):
    missing = [h for h in REQUIRED_HOOKS if not callable(getattr(module, h, None))]
    if missing:
        raise ConfigError(f"product script lacks hooks: {', '.join(missing)}")
    missing = [c for c in REQUIRED_CONSTANTS if not isinstance(getattr(module, c, None), str) or not getattr(module, c)]
    if missing:
        raise ConfigError(f"product script lacks constants: {', '.join(missing)}")


def check_study_stamp(module, product: Product):
    """The script carries the study it was built from; a newer study on disk is logged, not fatal -
    the collector classifies the target stale-by-study and the agent rebuilds it."""
    sv, sa = product.study.get("study_version"), product.study.get("studied_at")
    if (module.STUDY_VERSION, module.STUDIED_AT) != (sv, sa):
        log.warning("script was built from study %s@%s but source_study.json is %s@%s - rebuild due (study_changed)",
                    module.STUDY_VERSION, module.STUDIED_AT, sv, sa)


# ----------------------------------------------------------------- the run
_stop = False


def _on_term(signum, frame):  # noqa: ARG001
    global _stop
    _stop = True
    log.warning("termination requested - stopping after the current advisory")


def _rate(n, d):
    return round(n / d, 3) if d else 0.0


def dry_run(runner: Runner, product: Product, limit: int) -> int:
    try:
        rows = runner.collect_rows(None, True)
    except ListingError as exc:
        log.error("%s", exc)
        return EXIT_FAILED
    rows.sort(key=lambda r: (r.get("date_published") or "", r["advisory_id"]), reverse=True)
    records, fetched, matched, failed, rejected = {}, 0, 0, [], []
    for row in rows[:limit]:
        rec, status, info = runner.fetch(row["advisory_id"], row)
        fetched += 1
        if status == "failed":
            failed.append({"id": row["advisory_id"], "status": info.get("status")})
            continue
        if status == "mismatch":
            rejected.append({"id": row["advisory_id"], "reason": "product mismatch",
                             **({"detail": info["detail"]} if info.get("detail") else {})})
            continue
        matched += 1
        records[row["advisory_id"]] = rec
    recs = list(records.values())
    n = len(recs)
    valid = sum(1 for r in recs if not list(record_validator().iter_errors(r)))
    entries = [v for r in recs for v in r.get("version_affected") or []]
    kinds = {}
    for v in entries:
        kinds[v.get("kind")] = kinds.get(v.get("kind"), 0) + 1
    srcs = runner.version_sources
    sentinel = collapse_ws(product.study.get("workaround_sentinel"))
    stats = {
        "records": n,
        "schema_valid_rate": _rate(valid, n),
        "cve_ids_populated": _rate(sum(1 for r in recs if r.get("cve_ids")), n),
        "summary_populated": _rate(sum(1 for r in recs if r.get("summary")), n),
        "workaround_populated": _rate(sum(1 for r in recs if r.get("workaround")), n),
        "version_affected_populated": _rate(sum(1 for r in recs if r.get("version_affected")), n),
        "version_kind_mix": {k: _rate(c, len(entries)) for k, c in sorted(kinds.items())},
        "version_product_match_rate": _rate(sum(1 for v in entries if product_matches(v.get("product"), product)),
                                            len(entries)),
        "date_published_parse_rate": _rate(sum(1 for r in recs if DATE_RE.match(
            (r.get("additional_details") or {}).get("date_published") or "")), n),
        "product_match_rate": _rate(matched, fetched - len(failed)),
        "workaround_sentinel_hits": sum(1 for r in recs if sentinel and collapse_ws(r.get("workaround")) == sentinel),
        "study_field_coverage": {f: _rate(sum(1 for r in recs if record_fields_found(r).get(f)), n)
                                 for f in study_located_fields(product.study)},
    }
    if product.csaf_url:
        stats["version_source_mix"] = {"csaf": _rate(srcs.count("csaf"), len(srcs)),
                                       "page": _rate(srcs.count("page"), len(srcs))}
        if srcs.count("none"):
            stats["version_source_mix"]["none"] = _rate(srcs.count("none"), len(srcs))
    out = {"target": product.key, "dry_run": True,
           "study": {"study_version": product.study.get("study_version"), "studied_at": product.study.get("studied_at")},
           "ids_discovered": len(rows), "records": records,
           "stats": stats, "failed": failed, "rejected": rejected,
           "fingerprint": runner.fingerprint(), "http": runner.http.stats}
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False, sort_keys=False)
    sys.stdout.write("\n")
    return EXIT_SUCCESS


def _mismatch_resting(entry, row) -> bool:
    """True while a remembered product-mismatch rejection is not due again: it is re-fetched only when its
    listing row shows an update newer than last_checked, or 30 days after last_checked."""
    if not entry or entry.get("reason") != "product mismatch":
        return False
    if ((entry.get("audit") or {}).get("verdict")) == "wrong":
        return False  # audited as wrongly rejected: fetched on the next run like a new ID
    checked = parse_iso(entry.get("last_checked"))
    if checked is None:
        return False
    upd = parse_iso((row or {}).get("date_updated")) if (row or {}).get("date_updated") else None
    if upd and upd > checked:
        return False
    return now_utc() - checked < MISMATCH_RECHECK


def check_ids(runner: Runner, product: Product, ids) -> int:
    """--check-ids: fetch each ID by its detail URL, run every parser and affects_product(), print one JSON
    object per ID. Writes nothing and ignores all state."""
    for aid in ids:
        out = {"id": aid, "affects_product": None, "detail": None, "date_published": None, "cve_ids": [],
               "version_affected": [], "validation_errors": []}
        if not product.id_pattern.search(aid):
            out["validation_errors"].append("advisory_id does not match advisory_id_pattern")
        doc, _csaf_missing, failure = runner.load_doc(aid, None)
        if doc is None:
            out["validation_errors"].append(f"detail fetch failed (HTTP {failure.get('status')})")
        else:
            try:
                out["affects_product"], out["detail"] = runner.affects(doc)
            except Exception as exc:  # noqa: BLE001 - report, never crash the audit
                out["validation_errors"].append(f"affects_product raised {exc!r}")
            rec = runner.build_record(aid, doc)
            out["date_published"] = (rec.get("additional_details") or {}).get("date_published")
            out["cve_ids"] = rec.get("cve_ids") or []
            out["version_affected"] = rec.get("version_affected") or []
            out["validation_errors"] += [f"schema: {e.message}" for e in record_validator().iter_errors(rec)]
            if not DATE_RE.match(out["date_published"] or ""):
                out["validation_errors"].append("date_published missing or not YYYY-MM-DD")
        print(json.dumps(out, ensure_ascii=False, sort_keys=False), flush=True)
    return EXIT_SUCCESS


def real_run(runner: Runner, product: Product, args, started, log_rel, registry_path) -> int:
    store = Store(product.dir / "advisories.json")
    store.load()
    cj = {}
    try:
        with open(product.dir / "collector.json", encoding="utf-8") as fh:
            cj = json.load(fh)  # read-only
    except (FileNotFoundError, json.JSONDecodeError):
        cj = {}
    state = cj.get("state") or {}
    failed_state = state.get("failed") or {}            # {id: {status, reason, attempts, ..., gave_up}}
    gave_up = {aid for aid, f in failed_state.items() if (f or {}).get("gave_up")}
    retry_ids = sorted(aid for aid in failed_state if aid not in gave_up)
    inc_state = state.get("incomplete") or {}
    rejected_state = state.get("rejected") or {}
    since = args.since or None
    last_full = parse_iso(state.get("last_full_listing"))
    full = since is None or last_full is None or now_utc() - last_full >= FULL_LISTING_EVERY

    summary = {"target": product.key, "started": iso(started), "new": [], "updated": [], "recovered": [], "failed": [],
               "incomplete": {}, "complete": [], "recheck_failed": [], "rejected": [], "withdrawn": [],
               "full_listing": False, "listing_ids": [], "listing_pages": 0, "ids_discovered": 0,
               "ids_fetched": 0, "http": runner.http.stats, "log": log_rel, "next_cursor": since}

    def finish(code):
        summary["finished"] = iso()
        summary["fingerprint"] = runner.fingerprint() if hasattr(runner, "listing_fp") else {}
        log.info("run finished: exit %d new=%d updated=%d recovered=%d failed=%d rejected=%d incomplete=%d",
                 code, len(summary["new"]), len(summary["updated"]), len(summary["recovered"]),
                 len(summary["failed"]), len(summary["rejected"]), len(summary["incomplete"]))
        print("RUN_SUMMARY " + json.dumps(summary, ensure_ascii=False, sort_keys=True), flush=True)
        return code

    try:
        rows = runner.collect_rows(since, full)
    except ListingError as exc:
        log.error("%s - run aborted, cursor unchanged", exc)
        summary["fingerprint"] = {"listing": {**getattr(runner, "listing_fp", {}), "status": exc.status}}
        summary["listing_pages"] = getattr(runner, "listing_pages", 0)
        return finish(EXIT_FAILED)
    summary["full_listing"] = full
    summary["listing_pages"] = runner.listing_pages
    summary["listing_ids"] = [r["advisory_id"] for r in rows]
    summary["ids_discovered"] = len(rows)
    rows_by_id = {r["advisory_id"]: r for r in rows}
    if since and not full:
        rows = [r for r in rows if (r.get("date_published") or "9999") >= since]
    rows_have_updated = any(r.get("date_updated") for r in rows)

    # what is due: new ids, failed-id retries (by URL), incomplete re-checks
    due = []
    retry_set = set(retry_ids)
    for aid in retry_ids:
        due.append(("retry", aid, rows_by_id.get(aid)))
    for r in rows:
        aid = r["advisory_id"]
        if aid in gave_up or aid in retry_set:
            continue
        if aid not in store.data:
            if _mismatch_resting(rejected_state.get(aid), r):
                continue
            due.append(("new", aid, r))
            continue
        stored = store.data[aid]
        st = inc_state.get(aid)
        miss = missing_fields(stored, bool(st and "csaf" in (st.get("missing") or [])))
        if not miss:
            continue
        if st is None:
            due.append(("recheck", aid, r))
            continue
        lf = parse_iso(st.get("last_fetched"))
        upd = parse_iso(r.get("date_updated")) if r.get("date_updated") else None
        if rows_have_updated:
            if upd and lf and upd > lf:
                due.append(("recheck", aid, r))
        elif lf is None or now_utc() - lf > timedelta(days=RECHECK_NO_DATE_DAYS):
            due.append(("recheck", aid, r))
    due.sort(key=lambda d: ((d[2] or {}).get("date_published") or "", d[1]))
    limited = args.limit is not None and len(due) > args.limit
    todo = due[: args.limit] if args.limit is not None else due
    log.info("due: %d new, %d retries, %d re-checks%s", sum(1 for d in due if d[0] == "new"),
             sum(1 for d in due if d[0] == "retry"), sum(1 for d in due if d[0] == "recheck"),
             f" (limited to {args.limit})" if args.limit is not None else "")

    processed = 0
    for kind, aid, row in todo:
        if _stop:
            break
        rec, status, info = runner.fetch(aid, row)
        processed += 1
        summary["ids_fetched"] += 1
        ts = iso()
        if status == "failed":
            if kind == "recheck":
                summary["recheck_failed"].append(aid)
            else:
                summary["failed"].append({"id": aid, "status": info.get("status") or 0})
            continue
        if status in ("mismatch", "invalid"):
            summary["rejected"].append({"id": aid, "reason": "product mismatch" if status == "mismatch" else info["reason"],
                                        **({"detail": info["detail"]} if info.get("detail") else {})})
            continue
        if info.get("withdrawn"):
            summary["withdrawn"].append(aid)
        miss = missing_fields(rec, info.get("csaf_missing"))
        if kind == "recheck":
            old = store.data[aid]
            oi, ni = _important(old), _important(rec)
            lost = [k for k in oi if oi[k] and not ni[k]]
            if lost:
                log.warning("%s: fresh copy lacks %s that the stored record has - stored record kept", aid, lost)
                miss = missing_fields(old, info.get("csaf_missing"))
            elif oi != ni:
                store.add(rec)
                summary["updated"].append(aid)
            if miss:
                summary["incomplete"][aid] = {"last_fetched": ts, "missing": miss}
            else:
                summary["complete"].append(aid)
            continue
        store.add(rec)
        (summary["recovered"] if kind == "retry" else summary["new"]).append(aid)
        if miss:
            summary["incomplete"][aid] = {"last_fetched": ts, "missing": miss}
        log.info("%s: stored (%s)%s", aid, kind, f", incomplete: {miss}" if miss else "")

    interrupted = _stop and processed < len(todo)
    new_due = [d for d in due if d[0] == "new"]
    done_new = {d[1] for d in todo[:processed] if d[0] == "new"}
    remaining_new = [d for d in new_due if d[1] not in done_new]
    if remaining_new:
        summary["next_cursor"] = (remaining_new[0][2] or {}).get("date_published") or since
    else:
        dates = [r.get("date_published") for r in rows if r.get("date_published")]
        summary["next_cursor"] = max([d for d in dates] + ([since] if since else [])) if dates else since
    if interrupted:
        return finish(EXIT_FAILED)
    code = EXIT_PARTIAL if summary["failed"] else EXIT_SUCCESS
    if code == EXIT_SUCCESS and not limited and args.limit is None:
        try:
            write_registry_time(registry_path, product.vendor_name, product.product_name, iso(started))
        except (OSError, json.JSONDecodeError) as exc:
            log.warning("could not write updated_time back to the registry: %s", exc)
    return finish(code)


def main(vendor: str, product: str, argv, parser) -> int:
    ap = argparse.ArgumentParser(description=f"Fetch {vendor}/{product} advisories")
    ap.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--since")
    ap.add_argument("--check-ids", help="comma-separated IDs: fetch, parse and check each; write nothing")
    try:
        args = ap.parse_args(argv)
    except SystemExit:
        return EXIT_CONFIG
    started = now_utc()
    try:
        check_hooks(parser)
        if (parser.VENDOR, parser.PRODUCT) != (vendor, product):
            raise ConfigError(f"script constants VENDOR/PRODUCT {parser.VENDOR}/{parser.PRODUCT} differ from "
                              f"main(vendor={vendor!r}, product={product!r})")
        _, v, p = load_registry(Path(args.registry), vendor, product)
        prod = Product(v, p)
        prod.load_study()
    except ConfigError as exc:
        logging.basicConfig(stream=sys.stderr)
        log.error("config error: %s", exc)
        return EXIT_CONFIG
    if args.since and not DATE_RE.match(args.since):
        args.since = iso_date(args.since)
        if not args.since:
            log.error("config error: --since must be a date")
            return EXIT_CONFIG
    ids = [i.strip() for i in (args.check_ids or "").split(",") if i.strip()]
    if args.check_ids is not None and not ids:
        log.error("config error: --check-ids needs at least one ID")
        return EXIT_CONFIG
    # --check-ids writes nothing: like a dry run it logs to stderr only
    log_rel = setup_logging(prod, started, args.dry_run or bool(ids))
    signal.signal(signal.SIGTERM, _on_term)
    check_study_stamp(parser, prod)
    try:
        http = Http(prod.rate_interval)
    except ConfigError as exc:
        log.error("config error: %s", exc)
        return EXIT_CONFIG
    runner = Runner(parser, prod, args, http)
    log.info("%s run for %s (core %s)%s", "dry" if args.dry_run else "real", prod.key, CORE_VERSION,
             f" since {args.since}" if args.since else "")
    if ids:
        return check_ids(runner, prod, ids)
    if args.dry_run:
        return dry_run(runner, prod, args.limit or DRY_RUN_DEFAULT)
    return real_run(runner, prod, args, started, log_rel, Path(args.registry))
