"""Collector runtime - the pure-Python daemon that runs every target's fetch script.

Built by the collector-runtime-builder skill. It schedules and runs each target's
run/fetch_advisories.py, validates the records the runner stored, tracks state and
health, detects source changes / anomalies (detection only - never repair) and
raises alerts. No AI runs here.

Usage (repo root on sys.path, e.g. from the repo root or with PYTHONPATH set):
    python3 -m scripts.collector                     # the daemon
    python3 -m scripts.collector --list              # classification of every target
    python3 -m scripts.collector --run-once <vendor>/<product> [--limit N]
    python3 -m scripts.collector --normalize <vendor>/<product>
It can also be started as a plain file: python3 <repo>/scripts/collector.py --list
(--limit on --run-once is a manual test aid passed through to the runner; the
daemon never passes it.)
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import random
import re
import signal
import statistics
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jsonschema

RUNTIME_VERSION = "1.0"

REPO_ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = REPO_ROOT / "registry.json"
VENDORS_DIR = REPO_ROOT / "vendors"
COLLECTOR_SCHEMA_PATH = REPO_ROOT / "schemas" / "collector.schema.json"
RECORD_SCHEMA_PATH = REPO_ROOT / "schemas" / "advisory_record.schema.json"
BUILDER_SKILL = REPO_ROOT / ".claude" / "skills" / "advisory-script-builder" / "SKILL.md"
RUNTIME_SKILL = REPO_ROOT / ".claude" / "skills" / "collector-runtime-builder" / "SKILL.md"
SCHEDULE_SKILL = REPO_ROOT / ".claude" / "skills" / "schedule-analysis" / "SKILL.md"
CORE_PATH = REPO_ROOT / "scripts" / "core.py"

DEFAULT_CRON = "0 */12 * * *"
RUN_TIMEOUT_S = 30 * 60
TIMEOUT_FOLLOWUP_S = 5 * 60  # next run after a timeout while the first backfill (cursor null) is going
RECENT_RUNS_CAP = 30
LOG_KEEP = 30
SCHEDULE_STALE_DAYS = 90
RESCAN_INTERVAL_S = 3600
MIN_BASELINE_RUNS = 5

EXIT_STATUS = {0: "success", 1: "partial", 2: "failed", 3: "config_error"}
FAIL_REASON = {0: "no_response"}   # other statuses: http_4xx / http_5xx, derived in _fail_reason()

CVE_RE = re.compile(r"^CVE-\d{4}-\d{4,}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HTML_RESIDUE_RE = re.compile(r"<[A-Za-z/!][^>]*>|&(?:[a-z]+|#\d+);")
BOILERPLATE_SUMMARIES = {"summary", "n/a", "none", "tbd", "security advisory"}
IMPORTANT_POPULATION = ("summary", "version_affected", "date_published")


# ----------------------------------------------------------------- helpers
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None = None) -> str:
    return (dt or now_utc()).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9._-]", "_", name.lower())
    s = re.sub(r"_+", "_", s)
    return s.strip("_")


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def atomic_write_json(path: Path, obj, sort_keys: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False, sort_keys=sort_keys)
        fh.write("\n")
    os.replace(tmp, path)


def load_json(path: Path, default=None):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return default


def version_tuple(v: str | None) -> tuple:
    if not v:
        return ()
    return tuple(int(x) for x in re.findall(r"\d+", str(v)))


def frontmatter_value(path: Path, key: str) -> str | None:
    """Plain `key: "value"` line parse of a SKILL.md frontmatter (no YAML library)."""
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    if not m:
        return None
    for line in m.group(1).splitlines():
        mm = re.match(rf"^{re.escape(key)}:\s*\"?([^\"]*)\"?\s*$", line)
        if mm:
            return mm.group(1).strip()
    return None


def core_version() -> str | None:
    try:
        text = CORE_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    m = re.search(r'^CORE_VERSION\s*=\s*["\']([^"\']+)["\']', text, re.M)
    return m.group(1) if m else None


def alert(level: str, message: str, target: str | None = None, cj: dict | None = None,
          code: str | None = None) -> bool:
    """Print an alert to stdout. With a target's collector.json and a code, the alert is *open* state:
    collector.json.alerts[code] = {message, since}; raising an already-open code is a no-op (no re-print),
    and clear_alert() deletes the key when the condition clears."""
    if cj is not None and code:
        alerts = cj.setdefault("alerts", {})
        if code in alerts:
            return False
        alerts[code] = {"message": message, "since": iso()}
    prefix = f"[{target}] " if target else ""
    print(f"{iso()} ALERT {level.upper()} {prefix}{message}", flush=True)
    return True


def clear_alert(cj: dict, code: str) -> None:
    (cj.get("alerts") or {}).pop(code, None)


def _fail_reason(status: int) -> str:
    if status in FAIL_REASON:
        return FAIL_REASON[status]
    if status == 429 or status >= 500:
        return "http_5xx"
    return "http_4xx"


# ----------------------------------------------------------------- registry
class RegistryError(Exception):
    pass


def load_registry() -> dict:
    try:
        with open(REGISTRY_PATH, encoding="utf-8") as fh:
            reg = json.load(fh)
    except FileNotFoundError as exc:
        raise RegistryError(f"registry.json not found at {REGISTRY_PATH}") from exc
    except json.JSONDecodeError as exc:
        raise RegistryError(f"registry.json is not valid JSON: {exc}") from exc
    if not isinstance(reg, dict) or not isinstance(reg.get("vendors"), list):
        raise RegistryError("registry.json has no 'vendors' list")
    for i, v in enumerate(reg["vendors"]):
        for key in ("vendor_name", "advisories", "advisory_url", "advisory_id_pattern"):
            if not v.get(key):
                raise RegistryError(f"vendors[{i}] is missing required key '{key}'")
        try:
            re.compile(v["advisory_id_pattern"])
        except re.error as exc:
            raise RegistryError(f"vendors[{i}].advisory_id_pattern is not a valid regex: {exc}") from exc
        if not isinstance(v.get("products"), list):
            raise RegistryError(f"vendors[{i}] has no 'products' list")
        for j, p in enumerate(v["products"]):
            if not p.get("product_name"):
                raise RegistryError(f"vendors[{i}].products[{j}] is missing 'product_name'")
    return reg


def _is_datetime_string(value) -> bool:
    return isinstance(value, str) and bool(re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", value))


def registry_hash(vendor: dict, product: dict) -> str:
    prod = {k: v for k, v in product.items()
            if k != "updated_time" and not (_is_datetime_string(v) and k.endswith(("_time", "_at")))}
    payload = {
        "advisories": product.get("advisories") or vendor.get("advisories"),
        "advisory_url": vendor.get("advisory_url"),
        "advisory_id_pattern": vendor.get("advisory_id_pattern"),
        "csaf_url": vendor.get("csaf_url"),
        "product": prod,
    }
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def registry_targets(reg: dict) -> dict:
    """target key -> (vendor entry, product entry)."""
    out = {}
    for v in reg["vendors"]:
        for p in v["products"]:
            out[f"{slug(v['vendor_name'])}/{slug(p['product_name'])}"] = (v, p)
    return out


def target_dir(key: str) -> Path:
    vendor, product = key.split("/", 1)
    return VENDORS_DIR / vendor / product


def disk_targets() -> set:
    out = set()
    if VENDORS_DIR.is_dir():
        for cj in VENDORS_DIR.glob("*/*/collector.json"):
            out.add(f"{cj.parent.parent.name}/{cj.parent.name}")
    return out


# ----------------------------------------------------------------- collector.json
_collector_schema = None
_record_schema = None


def collector_validator():
    global _collector_schema
    if _collector_schema is None:
        _collector_schema = jsonschema.Draft202012Validator(load_json(COLLECTOR_SCHEMA_PATH))
    return _collector_schema


def record_validator():
    global _record_schema
    if _record_schema is None:
        _record_schema = jsonschema.Draft202012Validator(load_json(RECORD_SCHEMA_PATH))
    return _record_schema


def save_collector(key: str, cj: dict) -> None:
    errors = sorted(collector_validator().iter_errors(cj), key=lambda e: list(e.path))
    if errors:
        msgs = "; ".join(f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}" for e in errors[:5])
        raise ValueError(f"collector.json for {key} fails its schema: {msgs}")
    atomic_write_json(target_dir(key) / "collector.json", cj)


# ----------------------------------------------------------------- classification
def classify(key: str, reg_targets: dict, builder_version: str | None, core_spec: str | None,
             core_ver: str | None) -> tuple[str, list]:
    tdir = target_dir(key)
    cj = load_json(tdir / "collector.json")
    if key not in reg_targets:
        return ("disabled", []) if cj is not None else ("missing", [])
    if cj is None or not (tdir / "run" / "fetch_advisories.py").is_file():
        return "missing", []
    if cj.get("status") == "broken":
        return "broken", []
    if cj.get("status") == "repairing":
        return "repairing", []
    reasons = []
    vendor, product = reg_targets[key]
    if cj.get("registry_hash") != registry_hash(vendor, product):
        reasons.append("registry")
    study = load_json(VENDORS_DIR / key.split("/")[0] / "source_study.json") or {}
    stamp = cj.get("study") or {}
    if (stamp.get("study_version"), stamp.get("studied_at")) != (study.get("study_version"), study.get("studied_at")):
        reasons.append("study")
    if builder_version and version_tuple(cj.get("builder_version")) < version_tuple(builder_version):
        reasons.append(f"builder {cj.get('builder_version')}→{builder_version}")
    if core_spec and version_tuple(core_ver) < version_tuple(core_spec):
        reasons.append("core")
    if reasons:
        return "stale", reasons
    if cj.get("status") == "disabled":
        return "disabled", []
    return "active", []


def cmd_list() -> int:
    builder_v = frontmatter_value(BUILDER_SKILL, "version")
    core_spec = frontmatter_value(BUILDER_SKILL, "core_version")
    runtime_skill_v = frontmatter_value(RUNTIME_SKILL, "version")
    schedule_v = frontmatter_value(SCHEDULE_SKILL, "version")
    core_v = core_version()
    print(f"runtime {RUNTIME_VERSION}/{runtime_skill_v}  core {core_v or 'none'}/{core_spec}  builder {builder_v}  "
          f"schedule {schedule_v}")
    try:
        reg = load_registry()
    except RegistryError as exc:
        alert("critical", f"registry invalid: {exc}")
        return 3
    reg_t = registry_targets(reg)
    keys = sorted(set(reg_t) | disk_targets())
    for key in keys:
        cls, reasons = classify(key, reg_t, builder_v, core_spec, core_v)
        cj = load_json(target_dir(key) / "collector.json") or {}
        st = cj.get("state") or {}
        failed = {a: f for a, f in (st.get("failed") or {}).items() if not (f or {}).get("gave_up")}
        failed3 = [a for a, f in failed.items() if int(f.get("attempts", 1)) >= 3]
        incomplete = st.get("incomplete") or {}
        unaudited = [a for a, e in (st.get("rejected") or {}).items() if not (e or {}).get("audit")]
        why = f" ({', '.join(reasons)})" if reasons else ""
        print(f"{key:32s} {cls}{why}  failed={len(failed)} (3+ attempts: {len(failed3)})  "
              f"incomplete={len(incomplete)}  unaudited_rejections={len(unaudited)}")
    for vendor_slug in sorted({k.split("/")[0] for k in keys}):
        print(f"schedule {vendor_slug:24s} {schedule_status(vendor_slug, schedule_v)}")
    return 0


def schedule_status(vendor_slug: str, skill_version: str | None) -> str:
    sched = load_json(VENDORS_DIR / vendor_slug / "schedule.json")
    if sched is None:
        return "missing (DEFAULT_CRON)"
    if load_schedule(vendor_slug) is None:
        return "invalid (DEFAULT_CRON)"
    notes = []
    la = parse_iso(sched.get("last_analysed"))
    if la is None or now_utc() - la > timedelta(days=SCHEDULE_STALE_DAYS):
        notes.append("stale (>90 days)")
    if skill_version and version_tuple(sched.get("analysis_version")) < version_tuple(skill_version):
        notes.append(f"analysis_version {sched.get('analysis_version')}→{skill_version}")
    return "ok " + sched.get("cron", "") + (f" [{'; '.join(notes)}]" if notes else "")


# ----------------------------------------------------------------- validation
def product_matches(name: str | None, vendor_name: str, product_name: str, vm: str | None) -> bool:
    if not name:
        return False
    n = re.sub(r"\s+", " ", name).strip().lower()
    cands = {product_name.lower(), f"{vendor_name} {product_name}".lower()}
    if vm:
        cands.add(vm.lower())
    return n in cands


def _entry_ok(entry: dict, vendor: dict, product: dict) -> str | None:
    if not isinstance(entry, dict):
        return "not an object"
    if not product_matches(entry.get("product"), vendor["vendor_name"], product["product_name"],
                           product.get("vm_product_version")):
        return f"product {entry.get('product')!r} is not the target product"
    kind = entry.get("kind")
    if kind not in ("exact", "range", "branch", "all"):
        return f"bad kind {kind!r}"
    if kind in ("exact", "branch") and not entry.get("version"):
        return "missing version"
    if kind == "range":
        if entry.get("from") is None and entry.get("to") is None:
            return "range without bounds"
        for b in ("from", "to"):
            if entry.get(b) is not None and f"{b}_inclusive" not in entry:
                return f"missing {b}_inclusive"
    if not entry.get("raw"):
        return "missing raw"
    for k, v in entry.items():
        if k != "raw" and isinstance(v, str) and HTML_RESIDUE_RE.search(v):
            return f"HTML residue in {k}"
    return None


def validate_record(key_id: str, rec: dict, vendor: dict, product: dict, warn) -> tuple[dict | None, str | None]:
    """Section 5.1. Returns (possibly cleaned record, reject reason)."""
    errs = list(record_validator().iter_errors(rec))
    if errs:
        return None, f"schema: {errs[0].message}"
    rec = copy.deepcopy(rec)
    aid = rec.get("advisory_id")
    if not aid or aid != key_id:
        return None, "advisory_id does not match its key"
    if not re.search(vendor["advisory_id_pattern"], aid):
        return None, "advisory_id does not match advisory_id_pattern"
    cves, seen = [], set()
    for c in rec.get("cve_ids") or []:
        if isinstance(c, str) and CVE_RE.match(c) and c not in seen:
            seen.add(c)
            cves.append(c)
    rec["cve_ids"] = cves
    if not cves:
        warn(f"{aid}: cve_ids is empty")
    good = []
    for e in rec.get("version_affected") or []:
        why = _entry_ok(e, vendor, product)
        if why:
            warn(f"{aid}: dropped version_affected entry ({why}): {e!r}"[:400])
        else:
            good.append(e)
    rec["version_affected"] = good
    if not good:
        warn(f"{aid}: version_affected is empty")
    ad = rec.get("additional_details") or {}
    dp = ad.get("date_published")
    if not isinstance(dp, str) or not DATE_RE.match(dp):
        return None, "date_published missing or not YYYY-MM-DD"
    try:
        d = datetime.strptime(dp, "%Y-%m-%d").date()
    except ValueError:
        return None, "date_published is not a real date"
    if d > (now_utc() + timedelta(days=1)).date():
        return None, "date_published is in the future"
    summ = rec.get("summary")
    if not summ or len(summ) < 20 or summ.strip().lower() in BOILERPLATE_SUMMARIES:
        warn(f"{aid}: summary is short or boilerplate")
    return rec, None


# ----------------------------------------------------------------- normalization
def is_withdrawn_entry(entry: dict | None) -> bool:
    return bool(entry) and (bool(entry.get("confirmed_at")) or int(entry.get("missing_runs") or 0) >= 3)


def normalize_record(rec: dict, vendor: dict, product: dict, withdrawn: dict) -> dict:
    """Section 8.2 common schema: only fields the raw record carries; nothing invented."""
    ad = rec.get("additional_details") or {}
    aid = rec.get("advisory_id")
    return {
        "advisory_id": aid,
        "vendor": vendor["vendor_name"],
        "product": product.get("vm_product_version"),
        "title": rec.get("summary"),
        "summary": rec.get("summary"),
        "cve_ids": rec.get("cve_ids") or [],
        "version_affected": rec.get("version_affected") or [],
        "workaround": rec.get("workaround"),
        "date_published": ad.get("date_published"),
        "status": "withdrawn" if is_withdrawn_entry(withdrawn.get(aid)) else "active",
        "source_url": vendor["advisory_url"].replace("{advisory_id}", aid),
        "additional_details": ad,
    }


def cmd_normalize(key: str) -> int:
    try:
        reg = load_registry()
    except RegistryError as exc:
        alert("critical", f"registry invalid: {exc}")
        return 3
    reg_t = registry_targets(reg)
    if key not in reg_t:
        print(f"unknown target {key}", file=sys.stderr)
        return 3
    vendor, product = reg_t[key]
    store = load_json(target_dir(key) / "advisories.json", {}) or {}
    cj = load_json(target_dir(key) / "collector.json", {}) or {}
    withdrawn = (cj.get("state") or {}).get("withdrawn") or {}
    out = [normalize_record(store[k], vendor, product, withdrawn) for k in sorted(store)]
    json.dump(out, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


# ----------------------------------------------------------------- schedules
_DOW_NAMES = {"0": "sun", "1": "mon", "2": "tue", "3": "wed", "4": "thu", "5": "fri", "6": "sat", "7": "sun"}


def crontab_trigger(expr: str, tz):
    """Standard 5-field crontab -> apscheduler CronTrigger. apscheduler's from_crontab() numbers weekdays
    0 = Monday, standard crontab 0 = Sunday: the weekday field is translated to names first so a
    schedule.json written in crontab terms fires on the day it says."""
    from apscheduler.triggers.cron import CronTrigger
    fields = str(expr).split()
    if len(fields) != 5:
        raise ValueError(f"not a 5-field crontab: {expr!r}")
    minute, hour, dom, month, dow = fields
    dow = re.sub(r"(?<![\d*/])\d(?![\d])", lambda m: _DOW_NAMES[m.group(0)], dow)
    return CronTrigger(minute=minute, hour=hour, day=dom, month=month, day_of_week=dow, timezone=tz)


def load_schedule(vendor_slug: str) -> dict | None:
    """Return a valid schedule.json or None (-> DEFAULT_CRON)."""
    sched = load_json(VENDORS_DIR / vendor_slug / "schedule.json")
    if not isinstance(sched, dict):
        return None
    try:
        tz = sched.get("timezone") or "UTC"
        crontab_trigger(sched["cron"], tz)
        for b in sched.get("burst_windows") or []:
            crontab_trigger(b["cron"], tz)
            float(b["duration_h"])
        if int((sched.get("evidence") or {}).get("data_points") or 0) < 10:
            return None
        if "jitter_s" in sched:
            assert 0 <= float(sched["jitter_s"]) <= 3600
    except Exception:  # noqa: BLE001 - any invalid file falls back to DEFAULT_CRON
        return None
    return sched


def make_trigger(vendor_slug: str):
    """Base cron with schedule.json's jitter_s (none on DEFAULT_CRON), replaced by the burst cron inside
    burst windows (burst jitter: 10 % of the burst interval)."""
    from apscheduler.triggers.base import BaseTrigger

    sched = load_schedule(vendor_slug)
    tz = (sched or {}).get("timezone") or "UTC"
    base = crontab_trigger((sched or {}).get("cron") or DEFAULT_CRON, tz)
    bursts = [(crontab_trigger(b["cron"], tz), float(b["duration_h"]))
              for b in (sched or {}).get("burst_windows") or []]

    def interval_s(trig) -> float:
        t0 = trig.get_next_fire_time(None, now_utc())
        t1 = trig.get_next_fire_time(t0, t0 + timedelta(seconds=1)) if t0 else None
        return (t1 - t0).total_seconds() if t0 and t1 else 3600.0

    base_jitter = float((sched or {}).get("jitter_s") or 0) if sched else 0.0

    class ScheduleTrigger(BaseTrigger):
        """A burst window starts at 00:00 vendor-local on a day the burst cron fires and lasts duration_h."""

        def _in_window(self, t: datetime) -> tuple | None:
            for trig, dur in bursts:
                local = t.astimezone(base.timezone)
                day0 = local.replace(hour=0, minute=0, second=0, microsecond=0)
                for back in range(0, int(dur // 24) + 1):
                    start = day0 - timedelta(days=back)
                    first = trig.get_next_fire_time(None, start)
                    if first and first.date() == start.date() and start <= local < start + timedelta(hours=dur):
                        return trig, dur
            return None

        def get_next_fire_time(self, previous_fire_time, now):
            cand = now
            for _ in range(2000):
                nb = base.get_next_fire_time(None, cand)
                nbu = [trig.get_next_fire_time(None, cand) for trig, _ in bursts]
                options = []
                if nb and not self._in_window(nb):
                    options.append((nb, base_jitter))
                for t, (trig, _) in zip(nbu, bursts):
                    if t and self._in_window(t):
                        options.append((t, interval_s(trig) * 0.1))
                if options:
                    t, jit = min(options, key=lambda o: o[0])
                    # positive-only jitter (apscheduler's own convention): a delayed fire can never make the
                    # next computation land on the same cron slot again
                    return t + timedelta(seconds=random.uniform(0, jit)) if jit else t
                cand = min(x for x in [nb, *nbu] if x) + timedelta(seconds=1)
            return None

        def __str__(self):
            return f"schedule[{vendor_slug}]"

    return ScheduleTrigger()


def next_fire(vendor_slug: str) -> str | None:
    try:
        t = make_trigger(vendor_slug).get_next_fire_time(None, now_utc())
        return iso(t.astimezone(timezone.utc)) if t else None
    except Exception:  # noqa: BLE001
        return None


# ----------------------------------------------------------------- a collection run
def _population(records: list) -> dict:
    if not records:
        return {}
    n = len(records)
    return {
        "summary": round(sum(1 for r in records if r.get("summary")) / n, 3),
        "version_affected": round(sum(1 for r in records if r.get("version_affected")) / n, 3),
        "date_published": round(sum(1 for r in records if (r.get("additional_details") or {}).get("date_published")) / n, 3),
    }


def _manifest(store: dict) -> dict:
    dates = sorted(d for d in ((r.get("additional_details") or {}).get("date_published") for r in store.values()) if d)
    return {"records": len(store), "latest_advisory": dates[-1] if dates else None}


def _prune_logs(tdir: Path) -> None:
    logs = sorted((tdir / "logs").glob("*.log"))
    for old in logs[:-LOG_KEEP]:
        try:
            old.unlink()
        except OSError:
            pass


def _run_runner(script: Path, args: list) -> tuple[int | None, dict | None, bool]:
    """Run the product script; stream its stdout; return (exit code, RUN_SUMMARY, timed_out)."""
    cmd = [sys.executable, str(script), *args]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                            cwd=str(REPO_ROOT), bufsize=1)
    summary = None
    timed_out = False

    def killer():
        nonlocal timed_out
        timed_out = True
        proc.send_signal(signal.SIGTERM)  # stop cleanly; progress is already written per advisory
        try:
            proc.wait(60)
        except subprocess.TimeoutExpired:
            proc.kill()

    timer = threading.Timer(RUN_TIMEOUT_S, killer)
    timer.start()
    try:
        for line in proc.stdout:
            if line.startswith("RUN_SUMMARY "):
                try:
                    summary = json.loads(line[len("RUN_SUMMARY "):])
                except json.JSONDecodeError:
                    print(f"{iso()} WARNING unparseable RUN_SUMMARY line", flush=True)
                print(line[:300].rstrip() + (" ..." if len(line) > 300 else ""), flush=True)
            else:
                sys.stdout.write(line)
        proc.wait()
    finally:
        timer.cancel()
    return proc.returncode, summary, timed_out


def _detect_source_change(old_fp: dict, new_fp: dict) -> list:
    reasons = []
    if not old_fp or not new_fp:
        return reasons
    for part in ("listing", "detail"):
        o, n = old_fp.get(part) or {}, new_fp.get(part) or {}
        if o.get("content_type") and n.get("content_type") and \
                o["content_type"].split(";")[0] != n["content_type"].split(";")[0]:
            reasons.append(f"{part} content_type {o['content_type']} -> {n['content_type']}")
    ol, nl = old_fp.get("listing") or {}, new_fp.get("listing") or {}
    if nl.get("status") in (404, 410):
        reasons.append(f"listing answered {nl['status']}")
    if nl.get("redirected_to"):
        reasons.append(f"listing redirected to {nl['redirected_to']}")
    od, nd = old_fp.get("detail") or {}, new_fp.get("detail") or {}
    hash_changed = (ol.get("structure_hash") and nl.get("structure_hash") and ol["structure_hash"] != nl["structure_hash"]) or \
                   (od.get("structure_hash") and nd.get("structure_hash") and od["structure_hash"] != nd["structure_hash"])
    if hash_changed:
        lost = [f for f, v in (od.get("fields_found") or {}).items()
                if v is True and (nd.get("fields_found") or {}).get(f) is False]
        if lost:
            reasons.append(f"structure hash changed and fields now return None: {', '.join(lost)}")
    return reasons


def _detect_anomalies(history: list, run: dict) -> list:
    base = [r for r in history if r.get("status") in ("success", "partial") and not r.get("backfill")]
    reasons = []
    if len(base) < MIN_BASELINE_RUNS or run.get("backfill"):
        return reasons
    counts = [r.get("new", 0) + r.get("updated", 0) for r in base]
    med = statistics.median(counts)
    cur = run.get("new", 0) + run.get("updated", 0)
    if med > 0 and cur == 0:
        reasons.append(f"0 records while the baseline median is {med}")
    if med > 0 and cur > 5 * med:
        reasons.append(f"{cur} records is more than 5x the baseline median {med}")
    pop = run.get("population") or {}
    for f in IMPORTANT_POPULATION:
        vals = [(r.get("population") or {}).get(f) for r in base if (r.get("population") or {}).get(f) is not None]
        if pop.get(f) is not None and vals:
            avg = sum(vals) / len(vals)
            if avg > 0 and pop[f] < 0.5 * avg:
                reasons.append(f"{f} population {pop[f]} is below 50% of its baseline {avg:.2f}")
    fetched = run.get("new", 0) + run.get("updated", 0) + run.get("failed", 0) + len(run.get("rejected") or [])
    invalid = [r for r in run.get("rejected", []) if r.get("reason") != "product mismatch"]
    if fetched and len(invalid) / fetched > 0.2:
        reasons.append(f"{len(invalid)}/{fetched} detail fetches failed validation")
    return reasons


def merge_rejected(state: dict, rejected: list, ts: str, stored: set) -> None:
    """Merge one run's rejections into state.rejected (section 7.2). The agent-owned `audit`
    is preserved as-is, except that a new rejection with a different reason clears it. An ID that
    is now stored is removed."""
    rmap = state.setdefault("rejected", {})
    for r in rejected or []:
        aid = r.get("id")
        if not aid or aid in stored:
            continue
        reason = str(r.get("reason") or "unknown")
        detail = r.get("detail")
        e = rmap.get(aid)
        if e is None:
            e = rmap[aid] = {"reason": reason, "first_rejected": ts, "last_checked": ts, "count": 1}
        else:
            if e.get("reason") != reason:
                e.pop("audit", None)
            e["reason"] = reason
            e["count"] = int(e.get("count", 0)) + 1
            e["last_checked"] = ts
        if detail is not None:
            e["detail"] = str(detail)
    for aid in list(rmap):
        if aid in stored:
            del rmap[aid]


def run_target(key: str, limit: int | None = None) -> int:
    """One collection run for one target. Returns the runner's exit code (or 2/3)."""
    try:
        reg = load_registry()
    except RegistryError as exc:
        alert("critical", f"registry invalid: {exc}")
        return 3
    reg_t = registry_targets(reg)
    tdir = target_dir(key)
    cj = load_json(tdir / "collector.json")
    script = tdir / "run" / "fetch_advisories.py"
    if key not in reg_t or cj is None or not script.is_file():
        print(f"{iso()} target {key} is not runnable (missing or not in the registry)", flush=True)
        return 3
    if cj.get("status") != "active":
        print(f"{iso()} target {key} is {cj.get('status')}; skipped", flush=True)
        return 0
    vendor, product = reg_t[key]
    state = cj.setdefault("state", {})
    for k, dflt in (("cursor", None), ("failed", {}), ("withdrawn", {}), ("incomplete", {}),
                    ("last_full_listing", None), ("rejected", {})):
        state.setdefault(k, copy.deepcopy(dflt))
    backfill = state.get("cursor") is None
    before = load_json(tdir / "advisories.json", {}) or {}
    started = now_utc()
    args = []
    if state.get("cursor"):
        args += ["--since", state["cursor"]]
    if limit is not None:
        args += ["--limit", str(limit)]
    print(f"{iso()} run {key} {' '.join(args)}", flush=True)
    code, summary, timed_out = _run_runner(script, args)
    finished = now_utc()
    status = EXIT_STATUS.get(code, "failed")
    if timed_out:
        # stopped at the 30-minute limit: not a failure, whatever the runner's exit code
        status = "timeout"
    summary = summary or {}
    warnings = []
    warn = lambda m: (warnings.append(m), print(f"{iso()} WARNING [{key}] {m}", flush=True))  # noqa: E731

    # --- validate what the runner stored; protect stored records -------------
    after = load_json(tdir / "advisories.json", {}) or {}
    recovered = set(summary.get("recovered") or [])
    new_ids = [i for i in summary.get("new", []) if i in after and i not in before and i not in recovered]
    upd_ids = [i for i in summary.get("updated", []) if i in after and i in before]
    rejected = list(summary.get("rejected") or [])
    for aid in list(after):
        if aid in before and aid not in upd_ids and after[aid] != before[aid]:
            warn(f"{aid}: runner changed a stored record without reporting it as updated; restored")
            after[aid] = before[aid]
        elif aid not in before and aid not in new_ids and aid not in recovered:
            new_ids.append(aid)
    for aid in list(new_ids) + list(upd_ids) + [i for i in recovered if i in after and i not in before]:
        cleaned, reason = validate_record(aid, after[aid], vendor, product, warn)
        if reason:
            rejected.append({"id": aid, "reason": reason})
            if aid in before:
                after[aid] = before[aid]
                upd_ids.remove(aid)
            else:
                del after[aid]
                if aid in new_ids:
                    new_ids.remove(aid)
                recovered.discard(aid)
                state["incomplete"].pop(aid, None)
        else:
            after[aid] = cleaned
    for aid in before:  # never lose a stored record
        after.setdefault(aid, before[aid])
    if after != (load_json(tdir / "advisories.json", {}) or {}):
        atomic_write_json(tdir / "advisories.json", after)

    # --- state ---------------------------------------------------------------
    ts = iso(started)
    fmap = state["failed"]
    for aid in recovered:
        fmap.pop(aid, None)
    for f in summary.get("failed") or []:
        aid, st_code = f.get("id"), int(f.get("status") or 0)
        if not aid:
            continue
        e = fmap.get(aid)
        if e and e.get("gave_up"):
            continue  # the agent gave up on it: never modified, never retried
        if e:
            e["attempts"] = int(e.get("attempts", 1)) + 1
            e["last_failed"] = ts
            e["status"] = st_code
            e["reason"] = str(f.get("reason") or _fail_reason(st_code))
        else:
            fmap[aid] = {"status": st_code, "reason": str(f.get("reason") or _fail_reason(st_code)), "attempts": 1,
                         "first_failed": ts, "last_failed": ts}
    for aid in new_ids:
        fmap.pop(aid, None)
    for aid, inc in (summary.get("incomplete") or {}).items():
        if aid in after:
            state["incomplete"][aid] = {"last_fetched": inc.get("last_fetched") or ts, "missing": list(inc.get("missing") or [])}
    for aid in summary.get("complete") or []:
        state["incomplete"].pop(aid, None)
    wmap = state["withdrawn"]
    for aid in summary.get("withdrawn") or []:  # the page itself says withdrawn / retracted
        if aid in after:
            e = wmap.setdefault(aid, {"missing_runs": 1})
            e["confirmed_at"] = e.get("confirmed_at") or ts
    if summary.get("full_listing") and status in ("success", "partial"):
        state["last_full_listing"] = ts
        seen = set(summary.get("listing_ids") or [])
        for aid in after:
            e = wmap.get(aid)
            if aid in seen:
                if e and not e.get("confirmed_at"):
                    del wmap[aid]
            elif e:
                e["missing_runs"] = int(e.get("missing_runs") or 0) + 1
            else:
                wmap[aid] = {"missing_runs": 1}
    merge_rejected(state, rejected, ts, set(after))
    if status in ("success", "partial") and summary.get("next_cursor"):
        state["cursor"] = summary["next_cursor"]

    # --- run record ------------------------------------------------------------
    fetched_recs = [after[i] for i in new_ids + upd_ids if i in after]
    log_rel = summary.get("log")
    run = {
        "started": iso(started), "finished": iso(finished),
        "exit_code": code if code in EXIT_STATUS else 2, "status": status,
        "duration_s": round((finished - started).total_seconds()),
        "full_listing": bool(summary.get("full_listing")), "ids_discovered": int(summary.get("ids_discovered") or 0),
        "new": len(new_ids), "updated": len(upd_ids), "recovered": len(recovered),
        "failed": len(summary.get("failed") or []),
        "population": _population(fetched_recs), "rejected": rejected,
        "http": {k: int(v) for k, v in (summary.get("http") or {}).items() if isinstance(v, (int, float))},
        "source_change_detected": False, "backfill": backfill,
        "log": f"vendors/{key}/{log_rel}" if log_rel else f"vendors/{key}/logs/(none)",
    }
    history = cj.get("recent_runs") or []   # newest first

    # --- health ----------------------------------------------------------------
    health = cj.setdefault("health", {})
    health["last_run"] = iso(started)
    if status in ("success", "partial"):
        health["last_success"] = iso(finished)
        health["consecutive_failures"] = 0
        health["source_available"] = True
    elif status == "failed":
        health["consecutive_failures"] = int(health.get("consecutive_failures", 0)) + 1
        health["source_available"] = False
    if status == "success":
        clear_alert(cj, "run_failures")
        clear_alert(cj, "listing_unreachable")
    if code != 3:
        clear_alert(cj, "config_error")
    since24 = now_utc() - timedelta(hours=24)
    health["records_last_24h"] = sum(r.get("new", 0) + r.get("updated", 0) for r in [run] + history
                                     if (parse_iso(r.get("started")) or since24) >= since24)
    health["schedule_next"] = next_fire(key.split("/")[0])

    # --- detection (never repair) ------------------------------------------------
    if code == 3:
        alert("error", "runner reported a config error (exit 3)", key, cj, "config_error")
    changes = _detect_source_change(cj.get("source_fingerprint") or {}, summary.get("fingerprint") or {})
    if status == "failed" and (summary.get("fingerprint") or {}).get("listing", {}).get("status") in (404, 410):
        changes = changes or ["listing answered 404/410"]
    anomalies = _detect_anomalies(history, run) if status in ("success", "partial") else []
    if changes:
        run["source_change_detected"] = True
        cj["status"] = "broken"
        alert("warning", f"source change detected: {'; '.join(changes)} - marked broken", key, cj, "source_change")
    if anomalies:
        cj["status"] = "broken"
        alert("warning", f"anomaly: {'; '.join(anomalies)} - marked broken", key, cj, "anomaly")
    if status == "success" and not changes and summary.get("fingerprint"):
        fp = copy.deepcopy(cj.get("source_fingerprint") or {})
        for part, val in summary["fingerprint"].items():
            fp[part] = val
        cj["source_fingerprint"] = fp
    if status == "success" and not changes and not anomalies:
        clear_alert(cj, "source_change")
        clear_alert(cj, "anomaly")
    if health.get("consecutive_failures", 0) >= 3:
        alert("error", f"{health['consecutive_failures']} consecutive failed runs", key, cj, "run_failures")
    last_ok = parse_iso(health.get("last_success")) or parse_iso(cj.get("validated_at"))
    if status == "failed" and last_ok and now_utc() - last_ok > timedelta(hours=24):
        alert("error", "listing unreachable for more than 24 h", key, cj, "listing_unreachable")
    stuck = {a: f for a, f in state["failed"].items() if int(f.get("attempts", 1)) >= 3 and not f.get("gave_up")}
    if stuck:
        alert("warning", "advisory IDs failed 3+ attempts: " +
              ", ".join(f"{a} (HTTP {f['status']}, {f.get('reason')})" for a, f in sorted(stuck.items())),
              key, cj, "retry_exhausted")
    else:
        clear_alert(cj, "retry_exhausted")
    lost = [r for r in rejected if r.get("reason") != "product mismatch"]
    if lost:
        alert("warning", "records rejected for a reason other than product mismatch (in-scope advisories "
              "may be lost to validation): " + ", ".join(f"{r.get('id')} ({r.get('reason')})" for r in lost),
              key, cj, "rejections")
    elif status in ("success", "partial"):
        clear_alert(cj, "rejections")
    unaudited = sorted(a for a, e in (state.get("rejected") or {}).items() if not (e or {}).get("audit"))
    if unaudited and state.get("cursor"):
        alert("info", f"rejection audit due: {len(unaudited)} rejected IDs without an audit "
              f"({', '.join(unaudited[:10])}{' ...' if len(unaudited) > 10 else ''})", key, cj, "audit_due")
    elif not unaudited:
        clear_alert(cj, "audit_due")

    cj["recent_runs"] = ([run] + history)[:RECENT_RUNS_CAP]
    cj["manifest"] = _manifest(after)
    save_collector(key, cj)
    _prune_logs(tdir)
    print(f"{iso()} run {key} finished: {status} (exit {code}), new={len(new_ids)} updated={len(upd_ids)} "
          f"failed={run['failed']} rejected={len(rejected)}", flush=True)
    return code if code is not None else 2


# ----------------------------------------------------------------- daemon
class Daemon:
    def __init__(self):
        from apscheduler.schedulers.blocking import BlockingScheduler
        self.sched = BlockingScheduler(timezone="UTC", job_defaults={"coalesce": True, "max_instances": 1,
                                                                     "misfire_grace_time": None})
        self.jobs = {}
        self.lock = threading.Lock()
        self.running = set()

    def _job(self, key: str):
        cj = load_json(target_dir(key) / "collector.json") or {}
        if cj.get("status") != "active":
            print(f"{iso()} {key} is {cj.get('status')}; not run", flush=True)
            return
        with self.lock:
            if key in self.running:  # a cron, missed or follow-up job for the same target is already running
                print(f"{iso()} {key} is already running; skipped", flush=True)
                return
            self.running.add(key)
        try:
            run_target(key)
        except Exception as exc:  # noqa: BLE001 - isolate targets
            print(f"{iso()} ERROR run {key} crashed: {exc!r}", flush=True)
        finally:
            with self.lock:
                self.running.discard(key)
        self._reschedule(key)
        self._timeout_followup(key)

    def _timeout_followup(self, key: str):
        """After a `timeout` run while the first backfill is going (cursor null), run again in 5 minutes."""
        cj = load_json(target_dir(key) / "collector.json") or {}
        runs = cj.get("recent_runs") or []
        if cj.get("status") != "active" or not runs or runs[0].get("status") != "timeout":
            return
        if (cj.get("state") or {}).get("cursor") is not None:
            return
        when = now_utc() + timedelta(seconds=TIMEOUT_FOLLOWUP_S)
        self.sched.add_job(self._job, "date", run_date=when, args=[key], id=f"{key}#timeout",
                           name=f"{key} (timeout follow-up)", replace_existing=True)
        print(f"{iso()} {key} timed out during its first backfill; follow-up run at {iso(when)}", flush=True)

    def _reschedule(self, key: str):
        job = self.jobs.get(key)
        if job is not None:
            try:
                job.reschedule(trigger=make_trigger(key.split("/")[0]))  # re-reads schedule.json
            except Exception:  # noqa: BLE001
                pass

    def rescan(self, startup: bool = False):
        with self.lock:
            try:
                reg = load_registry()
            except RegistryError as exc:
                alert("critical", f"registry invalid: {exc}")
                return
            reg_t = registry_targets(reg)
            builder_v = frontmatter_value(BUILDER_SKILL, "version")
            core_spec = frontmatter_value(BUILDER_SKILL, "core_version")
            core_v = core_version()
            for key in sorted(disk_targets() - set(reg_t)):
                cj = load_json(target_dir(key) / "collector.json") or {}
                if cj and cj.get("status") != "disabled":
                    cj["status"] = "disabled"
                    save_collector(key, cj)
                    print(f"{iso()} {key} is no longer in the registry; status set to disabled", flush=True)
            wanted = set()
            for key in reg_t:
                cls, _ = classify(key, reg_t, builder_v, core_spec, core_v)
                if cls == "active":
                    wanted.add(key)
            for key in list(self.jobs):
                if key not in wanted:
                    self.jobs.pop(key).remove()
                    print(f"{iso()} unscheduled {key}", flush=True)
            for key in sorted(wanted - set(self.jobs)):
                trig = make_trigger(key.split("/")[0])
                self.jobs[key] = self.sched.add_job(self._job, trig, args=[key], id=key, name=key)
                cj = load_json(target_dir(key) / "collector.json") or {}
                missed = parse_iso((cj.get("health") or {}).get("schedule_next"))
                if startup and missed and missed < now_utc():
                    # a run missed while the host was down executes once at start-up
                    self.sched.add_job(self._job, args=[key], id=f"{key}#missed", name=f"{key} (missed)")
                print(f"{iso()} scheduled {key}", flush=True)

    def start(self) -> int:
        try:
            load_registry()
        except RegistryError as exc:
            alert("critical", f"registry invalid at start-up, refusing to start: {exc}")
            return 3
        self.rescan(startup=True)
        self.sched.add_job(self.rescan, "interval", seconds=RESCAN_INTERVAL_S, id="__rescan__")
        print(f"{iso()} collector daemon started (runtime {RUNTIME_VERSION}); {len(self.jobs)} active targets", flush=True)
        try:
            self.sched.start()
        except (KeyboardInterrupt, SystemExit):
            pass
        return 0


# ----------------------------------------------------------------- CLI
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m scripts.collector", description=__doc__.splitlines()[0])
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--list", action="store_true", help="print every target with its classification")
    g.add_argument("--run-once", metavar="VENDOR/PRODUCT", help="run one target now")
    g.add_argument("--normalize", metavar="VENDOR/PRODUCT", help="print the common schema to stdout")
    ap.add_argument("--limit", type=int, help="with --run-once only: manual test aid passed to the runner")
    a = ap.parse_args(argv)
    if a.limit is not None and not a.run_once:
        ap.error("--limit is only valid with --run-once")
    if a.list:
        return cmd_list()
    if a.run_once:
        return run_target(a.run_once, a.limit)
    if a.normalize:
        return cmd_normalize(a.normalize)
    return Daemon().start()


if __name__ == "__main__":
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    sys.exit(main())
