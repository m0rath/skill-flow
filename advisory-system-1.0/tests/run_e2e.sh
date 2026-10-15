#!/usr/bin/env bash
# End-to-end offline test of the 1.0 system against a synthetic vendor (no internet needed).
# Exercises: validators, --dry-run, backfill, delta, failed-ID retry + alert + recovery, product-mismatch
# rejection + audit override, withdrawal streak, source-change -> broken, --check-ids, --normalize, schedule.
# Needs: python3 with requirements.txt installed, and `chromium` or `google-chrome` on PATH (header fingerprint).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
T=tests/synthetic_vendor; PORT=${PORT:-8765}
fail() { echo "FAIL: $*"; exit 1; }
chk() { python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(0 if d['ok'] else 1)" || fail "$1"; }
state() { python3 -c "import json;cj=json.load(open('vendors/acme/acmeos/collector.json'));print($1)"; }
run() { (cd /tmp && PYTHONPATH="$ROOT" python3 -m scripts.collector --run-once acme/acmeos >/dev/null 2>&1 || true); }
ctl() { curl -s "http://127.0.0.1:$PORT/__ctl?$1" >/dev/null; }

cp registry.json /tmp/registry.e2e.bak
trap 'cp /tmp/registry.e2e.bak registry.json; pkill -f "server.py $PORT" || true' EXIT
python3 - "$T/registry_entry.json" <<'PY'
import json,sys; reg=json.load(open('registry.json')); reg['vendors']=[v for v in reg['vendors'] if v['vendor_name']!='acme']+[json.load(open(sys.argv[1]))]
json.dump(reg,open('registry.json','w'),indent=2,ensure_ascii=False,sort_keys=True)
PY
rm -rf vendors/acme; mkdir -p vendors/acme/acmeos/run
cp $T/source_study.json vendors/acme/; cp $T/fetch_advisories.py vendors/acme/acmeos/run/; cp $T/schedule.json vendors/acme/
(python3 $T/server.py $PORT >/tmp/synthetic_vendor.log 2>&1 &); sleep 1; ctl reset=1

echo "1. validators"
python3 -m scripts.validate runtime | chk runtime
python3 -m scripts.validate source-study acme | chk source-study
python3 -m scripts.validate builder-inputs acme AcmeOS --reason new_target | chk builder-inputs
python3 -m scripts.validate builder-output acme/acmeos | chk builder-output
python3 -m scripts.validate schedule acme | chk schedule
[ "$(python3 -m scripts.validate builder-inputs acme AcmeOS 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("blocked_reason"))')" = invalid_invocation ] || fail "no-reason block"

echo "2. dry run from another directory"
(cd /tmp && python3 "$ROOT/vendors/acme/acmeos/run/fetch_advisories.py" --dry-run --limit 5 2>/dev/null >/tmp/dry.json) || fail "dry run exit"
python3 - <<'PY' || fail "dry-run stats"
import json; d=json.load(open('/tmp/dry.json')); s=d['stats']
assert d['ids_discovered']==4 and s['records']==4 and s['schema_valid_rate']==1.0 and s['product_match_rate']==1.0
assert s['workaround_sentinel_hits']==1 and s['version_source_mix']['csaf']==0.75 and set(s['version_kind_mix'])=={'all','branch','exact','range'}
assert d['study']=={'study_version':'1.0','studied_at':'2026-10-06T12:00:00Z'}
PY

echo "3. collector.json as the agent writes it"
python3 - <<'PY'
import json,sys; sys.path.insert(0,'.')
from scripts.collector import registry_hash, load_registry, registry_targets
v,p=registry_targets(load_registry())['acme/acmeos']; st=json.load(open('vendors/acme/source_study.json')); dry=json.load(open('/tmp/dry.json'))
json.dump({"target":"acme/acmeos","status":"active","builder_version":"1.0","study":{"study_version":st["study_version"],"studied_at":st["studied_at"]},
 "registry_hash":registry_hash(v,p),"validated_at":"2026-10-06T13:45:00Z","last_dry_run_stats":dry["stats"],"source_fingerprint":dry["fingerprint"],
 "state":{"cursor":None},"health":{"consecutive_failures":0,"source_available":True,"records_last_24h":0},"recent_runs":[],"alerts":{}},
 open('vendors/acme/acmeos/collector.json','w'),indent=2)
PY
python3 -m scripts.validate collector acme/acmeos | chk collector

echo "4. backfill + delta"
run; [ "$(state "len(json.load(open('vendors/acme/acmeos/advisories.json')))")" = 4 ] || fail backfill
[ "$(state "cj['state']['cursor']")" = 2026-04-01 ] || fail cursor
[ "$(state "list(cj['state']['incomplete'])")" = "['ACME-SA-2026-0004']" ] || fail incomplete
run; [ "$(state "cj['recent_runs'][0]['new']")" = 0 ] || fail delta
python3 -m scripts.validate collector acme/acmeos | chk "collector after run"

echo "5. failed-ID retry, exhaustion alert, recovery"
ctl fail_detail=ACME-SA-2026-0001
python3 - <<'PY'
import json; p='vendors/acme/acmeos/advisories.json'; d=json.load(open(p)); d.pop('ACME-SA-2026-0001'); json.dump(d,open(p,'w'))
p='vendors/acme/acmeos/collector.json'; cj=json.load(open(p)); cj['state']['cursor']='2026-01-01'; json.dump(cj,open(p,'w'))
PY
run; run; run
[ "$(state "cj['state']['failed']['ACME-SA-2026-0001']['attempts']")" = 3 ] || fail attempts
[ "$(state "cj['state']['failed']['ACME-SA-2026-0001']['reason']")" = http_5xx ] || fail reason
[ "$(state "'retry_exhausted' in cj['alerts']")" = True ] || fail "retry alert"
ctl fail_detail=ACME-SA-2026-0001; run
[ "$(state "cj['state']['failed']")" = "{}" ] || fail recovered
[ "$(state "(cj['recent_runs'][0]['recovered'], cj['recent_runs'][0]['new'])")" = "(1, 0)" ] || fail "recovered count"
[ "$(state "'retry_exhausted' in cj['alerts']")" = False ] || fail "alert cleared"

echo "6. product-mismatch rejection, rest, audit override"
ctl mismatch=ACME-SA-2026-0002
python3 - <<'PY'
import json; p='vendors/acme/acmeos/advisories.json'; d=json.load(open(p)); d.pop('ACME-SA-2026-0002'); json.dump(d,open(p,'w'))
p='vendors/acme/acmeos/collector.json'; cj=json.load(open(p)); cj['state']['cursor']='2026-01-01'; json.dump(cj,open(p,'w'))
PY
run; [ "$(state "cj['state']['rejected']['ACME-SA-2026-0002']['reason']")" = "product mismatch" ] || fail rejected
run; [ "$(state "cj['state']['rejected']['ACME-SA-2026-0002']['count']")" = 1 ] || fail "rejection rests"
python3 - <<'PY'
import json; p='vendors/acme/acmeos/collector.json'; cj=json.load(open(p))
cj['state']['rejected']['ACME-SA-2026-0002']['audit']={"verdict":"wrong","at":"2026-10-06T14:00:00Z","note":"e2e"}; cj['state']['cursor']='2026-01-01'; json.dump(cj,open(p,'w'))
PY
ctl mismatch=ACME-SA-2026-0002; run
[ "$(state "cj['state']['rejected']")" = "{}" ] || fail "audit wrong -> refetched"

echo "7. withdrawal streak"
ctl hide=ACME-SA-2025-0009
for i in 1 2 3; do python3 -c "
import json; p='vendors/acme/acmeos/collector.json'; cj=json.load(open(p)); cj['state']['last_full_listing']='2026-01-01T00:00:00Z'; json.dump(cj,open(p,'w'))"; run; done
[ "$(state "cj['state']['withdrawn']['ACME-SA-2025-0009']['missing_runs']")" = 3 ] || fail withdrawn
python3 -m scripts.collector --normalize acme/acmeos 2>/dev/null | python3 -c "import json,sys;d={r['advisory_id']:r['status'] for r in json.load(sys.stdin)};assert d['ACME-SA-2025-0009']=='withdrawn'" || fail normalize
ctl hide=ACME-SA-2025-0009

echo "8. source change -> broken"
ctl redesign=1
python3 - <<'PY'
import json; p='vendors/acme/acmeos/advisories.json'; d=json.load(open(p)); d.pop('ACME-SA-2026-0001'); json.dump(d,open(p,'w'))
p='vendors/acme/acmeos/collector.json'; cj=json.load(open(p)); cj['state']['cursor']='2026-01-01'; json.dump(cj,open(p,'w'))
PY
run; [ "$(state "cj['status']")" = broken ] || fail "broken on redesign"
[ "$(state "'source_change' in cj['alerts']")" = True ] || fail "source_change alert"
python3 -m scripts.collector --list 2>/dev/null | grep -E "acme/acmeos +broken" >/dev/null || fail "--list broken"
(cd /tmp && python3 "$ROOT/vendors/acme/acmeos/run/fetch_advisories.py" --check-ids ACME-SA-2026-0003 2>/dev/null) | python3 -c "import json,sys;assert json.loads(sys.stdin.readline())['affects_product'] is False" || fail check-ids
ctl reset=1
echo "ALL PASSED"
