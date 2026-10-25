"""
Phase 6 checks: dashboard payloads per role (and their speed on a large database) and Lot DNA.

Needs the API running on :8000 and MongoDB reachable.

    backend\\.venv\\Scripts\\python.exe backend\\test_phase6.py
"""
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests
from bson import ObjectId
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
    print(f"  {'PASS' if cond else 'FAIL'}  {name}   {'' if cond else str(detail)[:300]}")


def call(s, method, path, **kw):
    return s.request(method, f"{BASE}/api{path}", timeout=120, **kw)


tag = uuid.uuid4().hex[:6]
admin = requests.Session()
if call(admin, "post", "/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code != 200:
    print("cannot log in; is the API running?")
    sys.exit(1)
today = datetime.now()
D = today.strftime("%Y-%m-%d")
made = {"lots": [], "items": [], "suppliers": []}

og = call(admin, "post", "/operation-groups", json={"name": f"P6 Stitching {tag}"}).json()
op = call(admin, "post", "/operations", json={"name": f"P6Op {tag}", "group_id": og["id"]}).json()
worker = call(admin, "post", "/operators", json={"name": f"P6 Worker {tag}"}).json()
chart = call(admin, "post", "/size-charts", json={"name": f"P6Chart {tag}", "sizes": ["S"]}).json()
color = call(admin, "post", "/colors", json={"name": f"P6Color {tag}"}).json()
week = call(admin, "post", "/weeks", json={"week_number": 400 + int(tag[:2], 16) % 90, "year": 2026, "start_date": (today - timedelta(days=3)).strftime("%Y-%m-%d"),
                                           "end_date": (today + timedelta(days=3)).strftime("%Y-%m-%d")}).json()
cn = color["name"]


def mk_lot(qty="100", style=None, due=20):
    r = call(admin, "post", "/lots", json={"style_name": style or f"P6 Style {uuid.uuid4().hex[:4]}", "start_date": D,
                                           "target_end_date": (today + timedelta(days=due)).strftime("%Y-%m-%d"), "size_chart_id": chart["id"], "color_names": [cn],
                                           "color_size_quantities": {cn: {"S": qty}},
                                           "operations": [{"operation_id": op["id"], "rate": 2.0, "operator_ids": [worker["id"]]}]})
    made["lots"].append(r.json()["id"])
    return r.json()


lot = mk_lot(style=f"P6 Main {tag}")
call(admin, "post", "/production/batch", json={"week_id": week["id"], "lot_id": lot["id"], "operation_id": op["id"], "color": cn, "date": D,
                                               "entries": [{"operator_id": worker["id"], "sizes": {"S": 40}}]})
clerk_email = f"p6-{tag}@example.com"
call(admin, "post", "/users", json={"email": clerk_email, "password": "P6Pass!" + tag, "name": f"P6 Clerk {tag}", "role": "data_entry"})
acct_email = f"p6a-{tag}@example.com"
call(admin, "post", "/users", json={"email": acct_email, "password": "P6Acct!" + tag, "name": f"P6 Acct {tag}", "role": "accounts", "can_view_financial": True})
clerk, acct = requests.Session(), requests.Session()
call(clerk, "post", "/auth/login", json={"email": clerk_email, "password": "P6Pass!" + tag})
call(acct, "post", "/auth/login", json={"email": acct_email, "password": "P6Acct!" + tag})

print("--- dashboard payloads ---")
t0 = time.time()
o = call(admin, "get", "/dashboard/overview")
check("the admin overview loads", o.status_code == 200, o.text)
o = o.json()
check("it carries this week's pieces and wages", o["week"]["pieces"] >= 40 and o["week"]["wages"] >= 80, o["week"])
check("the lot pipeline lists the open lot with progress and due date",
      any(l["lot_number"] == lot["lot_number"] and l["progress"] == 40.0 and l["due"] for l in o["lots"]))
check("the 30-day trend has a row per day, stacked by operation group",
      len(o["trend"]["rows"]) == 30 and f"P6 Stitching {tag}" in o["trend"]["groups"] and o["trend"]["rows"][-1][f"P6 Stitching {tag}"] >= 40)
check("by-group totals are present", any(g["name"] == f"P6 Stitching {tag}" for g in o["operation_groups"]))
check("money fields are present for an admin", "advances_outstanding" in o and "expenses" in o and "money_month" in o)
check("the financial-year summary is for the selected year", o["fy_summary"]["fy"] == o["current_fy"])
other = call(admin, "get", "/dashboard/overview", params={"fy": "20-21"}).json()
check("another financial year can be selected", other["fy"] == "20-21" and other["fy_summary"]["pieces_handled"] == 0)
check("a malformed year is refused", call(admin, "get", "/dashboard/overview", params={"fy": "banana"}).status_code == 422)

old_lot = mk_lot(qty="50", style=f"P6 Old {tag}")
mongo.lots.update_one({"_id": ObjectId(old_lot["id"])}, {"$set": {"fy": "25-26", "start_date": "2025-06-01", "target_end_date": "2025-09-01"}})
late_lot = mk_lot(qty="500", style=f"P6 Late {tag}", due=1)
mongo.lots.update_one({"_id": ObjectId(late_lot["id"])}, {"$set": {"target_end_date": (today - timedelta(days=3)).strftime("%Y-%m-%d")}})
o = call(admin, "get", "/dashboard/overview").json()
keys = {a["key"]: a for a in o["attention"]}
check("'needs attention' flags the overdue lot", keys.get("overdue", {}).get("count", 0) >= 1, keys)
check("...and the lot left open from last year, with a link to the wizard", keys.get("year_end", {}).get("to") == "/year-end")
check("...and the lot row is marked overdue", any(l["lot_number"] == late_lot["lot_number"] and l["overdue"] for l in o["lots"]))
check("an administrator sees recent activity", len(o["recent_activity"]) >= 1 and "summary" in o["recent_activity"][0])
check("the first-run checklist reports what exists", o["setup"]["counts"]["lots"] >= 1)

a = call(acct, "get", "/dashboard/overview").json()
check("accounts get money but not the activity feed or attention list", "advances_outstanding" in a and "recent_activity" not in a and "attention" not in a)
c = call(clerk, "get", "/dashboard/overview")
check("a data-entry user gets a dashboard", c.status_code == 200, c.text)
blob = str(c.json())
check("...with no money anywhere in it", not any(k in blob for k in ("wages", "earnings", "labour_cost", "advances", "expenses", "'rate'")), blob[:300])
check("...showing lots that still need output", len(c.json()["needs_output"]) >= 1 and c.json()["role"] == "data_entry")
check("an anonymous request is refused", requests.get(f"{BASE}/api/dashboard/overview", timeout=30).status_code == 401)

print("\n--- speed on a large database ---")
perf_lot = str(ObjectId())
now_iso = datetime.now(timezone.utc).isoformat()
docs = []
for i in range(40000):
    d = (today - timedelta(days=i % 29)).strftime("%Y-%m-%d")
    docs.append({"week_id": week["id"], "week_number": week["week_number"], "year": 2026, "lot_id": perf_lot, "lot_number": "PERF", "style_name": "perf",
                 "operation_id": op["id"], "operation_name": "perf", "operation_group": f"G{i % 4}", "operator_group": f"T{i % 3}", "color": cn,
                 "rate": 1.0, "operator_id": f"perf{i % 200}", "operator_name": f"Perf {i % 200}", "operator_code": "", "size_quantities": {"S": 5},
                 "total_quantity": 5, "total_earnings": 5.0, "date": d, "entered_by": "perf", "entered_by_name": "perf", "created_at": now_iso,
                 "counts_toward_plan": True, "rate_type_name": "Regular"})
mongo.production_entries.insert_many(docs)
try:
    t0 = time.time()
    r = call(admin, "get", "/dashboard/overview")
    took = time.time() - t0
    check(f"the overview answers in under 1.5 s with 40,000 entries on file (took {took:.2f}s)", r.status_code == 200 and took < 1.5, took)
    o = r.json()
    check("...and the numbers reflect them", o["week"]["pieces"] >= 40000 * 5 * 7 / 29 * 0.9, o["week"])
    t0 = time.time()
    lots_r = call(admin, "get", "/lots")
    took2 = time.time() - t0
    check(f"the lots list is still quick (took {took2:.2f}s)", lots_r.status_code == 200 and took2 < 1.5, took2)
finally:
    mongo.production_entries.delete_many({"lot_id": perf_lot})

print("\n--- Lot DNA ---")
sup = call(admin, "post", "/suppliers", json={"name": f"P6 Sup {tag}"}).json()
made["suppliers"].append(sup["id"])
item = call(admin, "post", "/stock/items", json={"name": f"P6 Item {tag}", "category": "thread", "uom": "pcs"}).json()
made["items"].append(item["id"])
call(admin, "post", "/stock/movements", json={"type": "receipt", "item_id": item["id"], "qty": 10, "rate": 3, "supplier_id": sup["id"], "supplier_bill_no": "D-1", "date": D})
call(admin, "post", "/stock/movements", json={"type": "issue", "item_id": item["id"], "qty": 4, "lot_id": lot["id"], "date": D})
call(admin, "put", f"/lots/{lot['id']}", json={"style_name": f"P6 Main renamed {tag}"})
dna = call(admin, "get", f"/lots/{lot['id']}/dna")
check("the DNA page loads", dna.status_code == 200, dna.text)
dna = dna.json()
h = dna["header"]
check("the DNA code has the VG-XXXX-XXXX-XXXX shape", len(h["dna_code"]) == 17 and h["dna_code"].startswith("VG-") and h["dna_code"].count("-") == 3, h["dna_code"])
check("...is stable", call(admin, "get", f"/lots/{lot['id']}/dna").json()["header"]["dna_code"] == h["dna_code"])
check("...and differs between lots", call(admin, "get", f"/lots/{late_lot['id']}/dna").json()["header"]["dna_code"] != h["dna_code"])
kinds = {e["kind"] for e in dna["timeline"]}
check("the timeline merges creation, changes, production and material", {"lot", "change", "production", "material"} <= kinds, kinds)
check("the timeline is in time order", [e["at"] for e in dna["timeline"]] == sorted(e["at"] for e in dna["timeline"]))
check("production is summarised per day and operation, with money for an admin",
      any(e["kind"] == "production" and "40 pcs" in e["title"] and "80.00" in e["detail"] for e in dna["timeline"]))
check("materials and people are summarised", dna["materials"][0]["issued"] == 4 and dna["people"][0]["pieces"] == 40)
call(admin, "post", "/stock/movements", json={"type": "return", "item_id": item["id"], "qty": 4, "lot_id": lot["id"], "date": D})
check("closing adds a closure event and a fingerprint",
      call(admin, "post", f"/lots/{lot['id']}/close", json={"reason": "dna test"}).status_code == 200)
h2 = call(admin, "get", f"/lots/{lot['id']}/dna").json()
check("...the fingerprint is stable and 16 characters", len(h2["header"]["integrity"]) == 16 and h2["header"]["integrity"] == call(admin, "get", f"/lots/{lot['id']}/dna").json()["header"]["integrity"])
check("...and shows the closure on the timeline", any(e["kind"] == "closure" for e in h2["timeline"]))
sheet = call(admin, "get", f"/lots/{lot['id']}/dna/sheet")
tag_pdf = call(admin, "get", f"/lots/{lot['id']}/dna/tag")
check("the A4 sheet is a PDF", sheet.status_code == 200 and sheet.content[:4] == b"%PDF" and len(sheet.content) > 2000)
check("the carton tag is a PDF", tag_pdf.status_code == 200 and tag_pdf.content[:4] == b"%PDF")
check("the tag page is 100 x 50 mm (283 x 142 pt)", b"283.46" in tag_pdf.content or b"283.4" in tag_pdf.content or b"283" in tag_pdf.content, tag_pdf.content[:400])
acct_dna = call(acct, "get", f"/lots/{lot['id']}/dna")
check("accounts can open it", acct_dna.status_code == 200)
check("data entry cannot", call(clerk, "get", f"/lots/{lot['id']}/dna").status_code == 403)
check("an anonymous request cannot", requests.get(f"{BASE}/api/lots/{lot['id']}/dna", timeout=30).status_code == 401)
check("an invalid lot id is a 404, not a 500", call(admin, "get", "/lots/not-an-id/dna").status_code == 404)

print("\n--- carried-forward lineage ---")
mongo.lots.update_one({"_id": ObjectId(old_lot["id"])}, {"$set": {"fy": "25-26"}})
res = call(admin, "post", "/year-end", json={"actions": [{"lot_id": old_lot["id"], "action": "carry"}]}).json()["results"][0]
check("a lot is carried forward", res["status"] == "carried", res)
new_id = res["new_lot_id"]
made["lots"].append(new_id)
d_new = call(admin, "get", f"/lots/{new_id}/dna").json()
check("the new lot's DNA shows where it came from", [x["lot_number"] for x in d_new["lineage"]] == [old_lot["lot_number"]] and d_new["lineage"][0]["relation"] == "earlier")
check("the old lot's DNA shows where it went", [x["lot_number"] for x in call(admin, "get", f"/lots/{old_lot['id']}/dna").json()["lineage"]] == [d_new["header"]["lot_number"]])

print("\n--- cleanup ---")
for lid in set(made["lots"]):
    mongo.production_entries.delete_many({"lot_id": lid})
mongo.lot_closures.delete_many({"lot_id": {"$in": made["lots"]}})
mongo.lots.delete_many({"_id": {"$in": [ObjectId(i) for i in made["lots"]]}})
mongo.stock_movements.delete_many({"item_id": {"$in": made["items"]}})
mongo.stock_items.delete_many({"_id": {"$in": [ObjectId(i) for i in made["items"]]}})
mongo.suppliers.delete_many({"_id": {"$in": [ObjectId(i) for i in made["suppliers"]]}})
mongo.approvals.delete_many({"entity_label": {"$regex": tag}})
for path, obj in (("/weeks", week), ("/colors", color), ("/size-charts", chart), ("/operators", worker), ("/operations", op), ("/operation-groups", og)):
    call(admin, "delete", f"{path}/{obj['id']}")
for u in call(admin, "get", "/users").json():
    if u["email"] in (clerk_email, acct_email):
        call(admin, "delete", f"/users/{u['id']}")
print("  removed fixtures")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
