"""
Phase 3 API checks: allowance + half-up rounding, rate types, per-size rates,
quantity controller, and that legacy-shaped data still prices exactly as before.

Needs the API running on :8000 and MongoDB reachable (one legacy-shaped entry is
written straight to the database). Cleans up after itself.

    backend\\.venv\\Scripts\\python.exe backend\\test_phase3.py
"""
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")
BASE = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com").strip('"')
PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123").strip('"')
mongo = MongoClient(os.environ["MONGO_URL"].strip('"'))[os.environ["DB_NAME"].strip('"')]

passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name if cond else (name, detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}   {'' if cond else str(detail)[:260]}")


def call(s, method, path, **kw):
    return s.request(method, f"{BASE}/api{path}", timeout=30, **kw)


tag = uuid.uuid4().hex[:6]
admin = requests.Session()
if call(admin, "post", "/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code != 200:
    print("cannot log in; is the API running?")
    sys.exit(1)
today = datetime.now()
D = today.strftime("%Y-%m-%d")

print("--- rate types ---")
types = {t["name"]: t for t in call(admin, "get", "/rate-types").json()}
check("Regular, Sample and Rework are seeded", {"Regular", "Sample", "Rework"} <= set(types), list(types))
check("Regular is the default and counts toward the plan", types["Regular"]["is_default"] and types["Regular"]["counts_toward_plan"])
check("Sample and Rework do not count toward the plan",
      not types["Sample"]["counts_toward_plan"] and not types["Rework"]["counts_toward_plan"])
check("the default type cannot be deleted", call(admin, "delete", f"/rate-types/{types['Regular']['id']}").status_code == 400)
check("duplicate rate type name refused", call(admin, "post", "/rate-types", json={"name": "sample"}).status_code == 400)
custom = call(admin, "post", "/rate-types", json={"name": f"Night {tag}", "counts_toward_plan": True}).json()
check("a custom rate type can be added and removed",
      "id" in custom and call(admin, "delete", f"/rate-types/{custom['id']}").status_code == 200)

# fixtures
op = call(admin, "post", "/operations", json={"name": f"P3Op {tag}"}).json()
worker = call(admin, "post", "/operators", json={"name": f"P3 Worker {tag}"}).json()
chart = call(admin, "post", "/size-charts", json={"name": f"P3Chart {tag}", "sizes": ["S", "M"]}).json()
color = call(admin, "post", "/colors", json={"name": f"P3Color {tag}"}).json()
week = call(admin, "post", "/weeks", json={"week_number": 600 + int(tag[:2], 16) % 90, "year": 2026,
                                           "start_date": (today - timedelta(days=3)).strftime("%Y-%m-%d"),
                                           "end_date": (today + timedelta(days=3)).strftime("%Y-%m-%d")}).json()
cn = color["name"]


def make_lot(allowance=0, qty=None, size_rates=None, extra=None, qc=None, rate=2.5):
    payload = {"style_name": f"P3 Style {uuid.uuid4().hex[:4]}", "start_date": D,
               "target_end_date": (today + timedelta(days=20)).strftime("%Y-%m-%d"), "size_chart_id": chart["id"],
               "color_names": [cn], "color_size_quantities": {cn: qty or {"S": "110", "M": "130"}},
               "allowance_pct": allowance,
               "operations": [{"operation_id": op["id"], "rate": rate, "operator_ids": [worker["id"]],
                               "size_rates": size_rates, "extra_rates": extra or []}]}
    if qc:
        payload["quantity_control"] = qc
    return call(admin, "post", "/lots", json=payload)


def batch(lot_id, sizes, rate_type_id=None, date=None, session=None):
    body = {"week_id": week["id"], "lot_id": lot_id, "operation_id": op["id"], "color": cn,
            "date": date or D, "entries": [{"operator_id": worker["id"], "sizes": sizes}]}
    if rate_type_id:
        body["rate_type_id"] = rate_type_id
    return call(session or admin, "post", "/production/batch", json=body)


lots_made, entries_made = [], []

print("\n--- allowance and half-up rounding ---")
r = make_lot(allowance=5)
lot = r.json()
lots_made.append(lot["id"])
cells = {s["size"]: s for s in lot["colors"][0]["sizes"]}
check("110 pieces at 5% plans 116 (115.5 rounds up)", cells["S"]["planned_qty"] == 116 and cells["S"]["order_qty"] == 110, cells)
check("130 pieces at 5% plans 137 (136.5 rounds up)", cells["M"]["planned_qty"] == 137)
check("overall planned is the sum of rounded cells", lot["total_planned_qty"] == 253 and lot["total_order_qty"] == 240)
check("allowance pieces are reported", lot["allowance_qty"] == 13 and lot["allowance_pct"] == 5)
check("0% allowance plans exactly what was ordered",
      {s["size"]: s["planned_qty"] for s in make_lot(0, {"S": "49", "M": "51"}).json()["colors"][0]["sizes"]} == {"S": 49, "M": 51})
check("allowance above 50% refused", make_lot(allowance=60).status_code == 400)
check("negative allowance refused", make_lot(allowance=-1).status_code == 400)
r = call(admin, "put", f"/lots/{lot['id']}", json={"allowance_pct": 10})
upd = {s["size"]: s["planned_qty"] for s in r.json()["colors"][0]["sizes"]}
check("changing only the allowance rebuilds the plan from the stored order", upd == {"S": 121, "M": 143}, upd)
call(admin, "put", f"/lots/{lot['id']}", json={"allowance_pct": 5})

print("\n--- per-size rates ---")
r = make_lot(size_rates={"M": 3.0}, rate=2.5)
sz_lot = r.json()
lots_made.append(sz_lot["id"])
check("per-size rate stored on the lot rate card", sz_lot["operations"][0]["size_rates"] == {"M": 3.0})
check("a size that is not on the chart is refused", make_lot(size_rates={"XXL": 3.0}).status_code == 400)
check("a negative rate is refused", make_lot(size_rates={"S": -1}).status_code == 400)
e = batch(sz_lot["id"], {"S": 10, "M": 5}).json()["entries"][0]
entries_made.append(e["id"])
check("10 S at 2.50 + 5 M at 3.00 = 40.00", e["total_earnings"] == 40.0 and e["total_quantity"] == 15, e)
check("entry snapshots the card", e["rate_flat"] == 2.5 and e["size_rates"] == {"M": 3.0})
# change the lot's rate card afterwards: the old entry must keep its own prices
call(admin, "put", f"/lots/{sz_lot['id']}", json={"operations": [
    {"operation_id": op["id"], "rate": 9.0, "operator_ids": [worker["id"]], "size_rates": {"M": 9.5}}]})
call(admin, "put", f"/production/{e['id']}", json={"size_quantities": {"S": 20, "M": 5}, "reason": "recount"})
rows = call(admin, "get", f"/production?lot_id={sz_lot['id']}").json()
after = next(x for x in rows if x["id"] == e["id"])
check("editing uses the entry's own rate snapshot, not the lot's new rates (20x2.5 + 5x3.0 = 65)",
      after["total_earnings"] == 65.0, after)
pay = call(admin, "get", "/payroll/weekly", params={"week": week["week_number"], "year": 2026}).json()
mine = next((o for o in pay["operators"] if o["operator_id"] == worker["id"]), None)
check("payroll shows the weighted-average rate for the line",
      mine and mine["operations"][0]["earnings"] >= 65.0 and mine["operations"][0]["rate"] > 0, mine)

print("\n--- sample and rework rate types ---")
r = make_lot(extra=[{"rate_type_id": types["Sample"]["id"], "rate": 4.0}, {"rate_type_id": types["Rework"]["id"], "rate": 1.0}],
             qty={"S": "100", "M": "0"})
rt_lot = r.json()
lots_made.append(rt_lot["id"])
check("lot keeps the full rate card", len(rt_lot["operations"][0]["rates"]) == 3, rt_lot["operations"][0].get("rates"))
check("the same rate type twice is refused",
      make_lot(extra=[{"rate_type_id": types["Sample"]["id"], "rate": 1}, {"rate_type_id": types["Sample"]["id"], "rate": 2}]).status_code == 400)
e1 = batch(rt_lot["id"], {"S": 40}).json()["entries"][0]
entries_made.append(e1["id"])
s1 = batch(rt_lot["id"], {"S": 6}, types["Sample"]["id"])
check("a sample entry on the same day is accepted (different rate type)", s1.status_code == 200, s1.text)
se = s1.json()["entries"][0]
entries_made.append(se["id"])
check("sample pieces are paid at the sample rate (6 x 4.00)", se["total_earnings"] == 24.0 and se["counts_toward_plan"] is False, se)
lot_now = call(admin, "get", f"/lots/{rt_lot['id']}").json()
check("sample pieces do not count as produced", lot_now["total_produced_qty"] == 40 and lot_now["non_plan_qty"] == 6, lot_now["total_produced_qty"])
check("...but their cost is in the labour cost", lot_now["total_labour_cost"] == round(40 * 2.5 + 24, 2), lot_now["total_labour_cost"])
trk = call(admin, "get", f"/production/tracking/{rt_lot['id']}").json()
check("tracking ignores non-plan pieces", trk[0]["sizes"][0]["produced"] == 40)
check("sample pieces do not use up the plan (60 regular still allowed)", batch(rt_lot["id"], {"S": 60}, date=(today + timedelta(days=1)).strftime("%Y-%m-%d")).status_code == 200)
entries_made += [x["id"] for x in call(admin, "get", f"/production?lot_id={rt_lot['id']}").json()]
nopay = batch(lot["id"], {"S": 1}, types["Sample"]["id"])
check("a rate type with no rate set on that operation is refused", nopay.status_code == 400 and "No Sample rate" in nopay.text, nopay.text)
pay = call(admin, "get", "/payroll/weekly", params={"week": week["week_number"], "year": 2026}).json()
mine = next(o for o in pay["operators"] if o["operator_id"] == worker["id"])
labels = [x["operation_name"] for x in mine["operations"]]
check("payroll lists the sample line separately", any("(Sample)" in n for n in labels), labels)

print("\n--- caps on non-plan pieces ---")
call(admin, "put", f"/rate-types/{types['Sample']['id']}", json={"cap_pieces": 8})
capped = batch(rt_lot["id"], {"S": 5}, types["Sample"]["id"], date=(today + timedelta(days=2)).strftime("%Y-%m-%d"))
check("sample pieces over the cap are refused", capped.status_code == 400 and "capped" in capped.text, capped.text)
call(admin, "put", f"/rate-types/{types['Sample']['id']}", json={"clear_caps": True})
check("the cap can be cleared", call(admin, "get", "/rate-types").json() and
      next(t for t in call(admin, "get", "/rate-types").json() if t["name"] == "Sample")["cap_pieces"] is None)
used = call(admin, "put", f"/rate-types/{types['Sample']['id']}", json={"counts_toward_plan": True})
check("cannot flip 'counts toward plan' once entries use the type", used.status_code == 400, used.text)

print("\n--- quantity controller ---")
q = make_lot(qty={"S": "100", "M": "0"}, qc={"over_tolerance_pct": 10, "warn_at_pct": 80})
qlot = q.json()
lots_made.append(qlot["id"])
entries_made.append(batch(qlot["id"], {"S": 100}).json()["entries"][0]["id"])
over = batch(qlot["id"], {"S": 5}, date=(today + timedelta(days=1)).strftime("%Y-%m-%d"))
check("over the plan but inside the tolerance needs approval (409)", over.status_code == 409
      and over.json()["detail"]["code"] == "needs_approval", over.text)
way = batch(qlot["id"], {"S": 50}, date=(today + timedelta(days=1)).strftime("%Y-%m-%d"))
check("beyond the tolerance is refused outright (400)", way.status_code == 400, way.text)
clerk_email = f"p3-{tag}@example.com"
call(admin, "post", "/users", json={"email": clerk_email, "password": "P3Pass!" + tag, "name": f"P3 Clerk {tag}", "role": "data_entry"})
clerk = requests.Session()
call(clerk, "post", "/auth/login", json={"email": clerk_email, "password": "P3Pass!" + tag})
body = {"week_id": week["id"], "operation_id": op["id"], "color": cn, "date": (today + timedelta(days=1)).strftime("%Y-%m-%d"),
        "entries": [{"operator_id": worker["id"], "sizes": {"S": 5}}]}
req = call(clerk, "post", "/approvals", json={"type": "quantity_override", "entity_id": qlot["id"], "reason": "rush", "payload": body})
check("the clerk can request approval for the extra pieces", req.status_code == 200 and req.json()["status"] == "pending", req.text)
rid = req.json()["id"]
check("nothing was saved before approval", call(admin, "get", f"/lots/{qlot['id']}").json()["total_produced_qty"] == 100)
ap = call(admin, "post", f"/approvals/{rid}/approve")
check("approving saves the pieces", ap.status_code == 200, ap.text)
rows = call(admin, "get", f"/production?lot_id={qlot['id']}").json()
extra = [x for x in rows if x["total_quantity"] == 5]
check("...attributed to the requester, not the approver", extra and extra[0]["entered_by_name"] == f"P3 Clerk {tag}", extra)
entries_made += [x["id"] for x in rows]
check("an over-plan request beyond the tolerance is refused at request time",
      call(clerk, "post", "/approvals", json={"type": "quantity_override", "entity_id": qlot["id"], "reason": "x",
                                              "payload": {**body, "entries": [{"operator_id": worker["id"], "sizes": {"S": 500}}]}}).status_code == 400)
trk = call(admin, "get", f"/production/tracking/{qlot['id']}").json()[0]["sizes"][0]
check("tracking exposes tolerance headroom and the warning flag", trk["max_with_tolerance"] == 110 and trk["warn"] is True, trk)

call(admin, "put", f"/lots/{qlot['id']}", json={"quantity_control": {"locked": {f"{cn}|S": True}}})
lk = batch(qlot["id"], {"S": 1}, date=(today + timedelta(days=3)).strftime("%Y-%m-%d"))
check("a locked colour/size accepts no more entries", lk.status_code == 400 and "locked" in lk.text, lk.text)
check("tracking shows the lock", call(admin, "get", f"/production/tracking/{qlot['id']}").json()[0]["sizes"][0]["locked"] is True)
check("tolerance above 50% refused", call(admin, "put", f"/lots/{qlot['id']}", json={"quantity_control": {"over_tolerance_pct": 80}}).status_code == 400)

print("\n--- legacy-shaped data prices exactly as before ---")
legacy_lot = make_lot(qty={"S": "50", "M": "0"}, rate=2.25).json()
lots_made.append(legacy_lot["id"])
legacy_id = mongo.production_entries.insert_one({
    "week_id": week["id"], "week_number": week["week_number"], "year": 2026, "lot_id": legacy_lot["id"],
    "lot_number": legacy_lot["lot_number"], "style_name": legacy_lot["style_name"], "operation_id": op["id"],
    "operation_name": op["name"], "color": cn, "rate": 2.25, "operator_id": worker["id"], "operator_name": worker["name"],
    "operator_code": "", "size_quantities": {"S": 10}, "total_quantity": 10, "total_earnings": 22.5, "date": D,
    "entered_by": "x", "entered_by_name": "legacy", "created_at": datetime.now(timezone.utc).isoformat()}).inserted_id
entries_made.append(str(legacy_id))
call(admin, "put", f"/production/{legacy_id}", json={"size_quantities": {"S": 12}, "reason": "legacy edit"})
leg = next(x for x in call(admin, "get", f"/production?lot_id={legacy_lot['id']}").json() if x["id"] == str(legacy_id))
check("a legacy entry (no rate type, no snapshot) edits to 12 x 2.25 = 27.00", leg["total_earnings"] == 27.0, leg)
check("a legacy entry counts toward the plan", call(admin, "get", f"/lots/{legacy_lot['id']}").json()["total_produced_qty"] == 12)
legacy_dup = batch(legacy_lot["id"], {"S": 1})
check("a Regular entry the same day as a legacy one is a duplicate (legacy = Regular)",
      legacy_dup.status_code == 200 and legacy_dup.json()["duplicates_skipped"], legacy_dup.text)
old_style = mongo.lots.find_one({"_id": __import__("bson").ObjectId(legacy_lot["id"])})
mongo.lots.update_one({"_id": old_style["_id"]}, {"$unset": {"allowance_pct": "", "quantity_control": ""}})
for c in old_style["colors"]:
    for s_ in c["sizes"]:
        mongo.lots.update_one({"_id": old_style["_id"]}, {"$unset": {"colors.$[].sizes.$[].order_qty": ""}})
fresh = call(admin, "get", f"/lots/{legacy_lot['id']}").json()
check("a lot with no allowance or order fields reads as order == planned",
      fresh["total_order_qty"] == fresh["total_planned_qty"] == 50 and fresh["allowance_qty"] == 0, fresh["total_order_qty"])

print("\n--- data entry never sees money ---")
rows = call(clerk, "get", f"/production?lot_id={sz_lot['id']}").json()
check("no rate, per-size rate or earnings reach a data-entry user",
      rows and not any(k in rows[0] for k in ("rate", "rate_flat", "size_rates", "total_earnings")), rows[0].keys() if rows else "")
clerk_lots = call(clerk, "get", "/lots")
check("a data-entry user can list open lots (they need them to record output)",
      clerk_lots.status_code == 200 and any(l["id"] == rt_lot["id"] for l in clerk_lots.json()), clerk_lots.text[:150])
blob = str(clerk_lots.json())
check("...and the lot list carries no rate, rate card or labour cost",
      "'rate':" not in blob and "size_rates" not in blob and "total_labour_cost" not in blob and "'cost':" not in blob, blob[:300])
check("...the rate types appear by name only",
      [r["rate_type_name"] for r in next(l for l in clerk_lots.json() if l["id"] == rt_lot["id"])["operations"][0]["rates"]] == ["Regular", "Sample", "Rework"])
one = call(clerk, "get", f"/lots/{rt_lot['id']}").json()
check("a single lot read is scrubbed the same way", "size_rates" not in str(one) and "total_labour_cost" not in one)
check("a data-entry user still cannot open reports", call(clerk, "get", f"/reports/lot/{rt_lot['id']}").status_code == 403)
check("lots list carries order and planned totals",
      any(l["id"] == lot["id"] and l["total_order_qty"] == 240 for l in call(admin, "get", "/lots").json()))
check("Excel lot export still works with new fields",
      call(admin, "get", "/reports/export/excel", params={"report_type": "lot", "lot_id": sz_lot["id"]}).status_code == 200)
check("operation-cost export still works with mixed rates",
      call(admin, "get", "/reports/export/excel", params={"report_type": "operation_cost", "lot_id": rt_lot["id"]}).status_code == 200)

print("\n--- cleanup ---")
for eid in set(entries_made):
    call(admin, "delete", f"/production/{eid}")
for lid in lots_made:
    call(admin, "delete", f"/lots/{lid}")
for path, obj in (("/weeks", week), ("/colors", color), ("/size-charts", chart), ("/operators", worker), ("/operations", op)):
    call(admin, "delete", f"{path}/{obj['id']}")
for u in call(admin, "get", "/users").json():
    if u["email"] == clerk_email:
        call(admin, "delete", f"/users/{u['id']}")
print("  removed fixtures")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
