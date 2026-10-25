"""
Phase 5 checks: lot costing, the closing report, financial-year rollover, email reports.

Needs the API running on :8000 (with CRON_TOKEN set in backend/.env) and MongoDB reachable.
Email is tested against a local SMTP sink (aiosmtpd, dev-only), so nothing leaves the machine.

    backend\\.venv\\Scripts\\python.exe backend\\test_phase5.py
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from email import message_from_bytes
from pathlib import Path

import requests
from bson import ObjectId
from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))
load_dotenv(ROOT / ".env")
BASE = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com").strip('"')
PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123").strip('"')
CRON = os.environ.get("CRON_TOKEN", "").strip('"')
mongo = MongoClient(os.environ["MONGO_URL"].strip('"'))[os.environ["DB_NAME"].strip('"')]

passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name if cond else (name, detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}   {'' if cond else str(detail)[:300]}")


def call(s, method, path, **kw):
    return s.request(method, f"{BASE}/api{path}", timeout=60, **kw)


tag = uuid.uuid4().hex[:6]
admin = requests.Session()
if call(admin, "post", "/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code != 200:
    print("cannot log in; is the API running?")
    sys.exit(1)
today = datetime.now()
D = today.strftime("%Y-%m-%d")
MONTH = today.strftime("%Y-%m")
made = {"lots": [], "items": [], "suppliers": [], "cats": [], "users": []}

op = call(admin, "post", "/operations", json={"name": f"P5Op {tag}"}).json()
worker = call(admin, "post", "/operators", json={"name": f"P5 Worker {tag}"}).json()
chart = call(admin, "post", "/size-charts", json={"name": f"P5Chart {tag}", "sizes": ["S"]}).json()
color = call(admin, "post", "/colors", json={"name": f"P5Color {tag}"}).json()
week = call(admin, "post", "/weeks", json={"week_number": 500 + int(tag[:2], 16) % 90, "year": 2026,
                                           "start_date": (today - timedelta(days=3)).strftime("%Y-%m-%d"),
                                           "end_date": (today + timedelta(days=3)).strftime("%Y-%m-%d")}).json()
cn = color["name"]
types = {t["name"]: t for t in call(admin, "get", "/rate-types").json()}


def mk_lot(qty="100", style=None, order_rate=None, extra=None):
    r = call(admin, "post", "/lots", json={"style_name": style or f"P5 Style {uuid.uuid4().hex[:4]}", "start_date": D,
                                           "target_end_date": (today + timedelta(days=20)).strftime("%Y-%m-%d"), "size_chart_id": chart["id"],
                                           "color_names": [cn], "color_size_quantities": {cn: {"S": qty}}, "order_rate": order_rate,
                                           "operations": [{"operation_id": op["id"], "rate": 2.0, "operator_ids": [worker["id"]], "extra_rates": extra or []}]})
    if r.status_code == 200:
        made["lots"].append(r.json()["id"])
    return r


def batch(lot_id, sizes, rt=None, date=None):
    b = {"week_id": week["id"], "lot_id": lot_id, "operation_id": op["id"], "color": cn, "date": date or D,
         "entries": [{"operator_id": worker["id"], "sizes": sizes}]}
    if rt:
        b["rate_type_id"] = rt
    return call(admin, "post", "/production/batch", json=b)


# ============================================================ costing
print("--- lot costing ---")
sup = call(admin, "post", "/suppliers", json={"name": f"P5 Supplier {tag}"}).json()
made["suppliers"].append(sup["id"])
item = call(admin, "post", "/stock/items", json={"name": f"P5 Thread {tag}", "category": "thread", "uom": "pcs"}).json()
made["items"].append(item["id"])
call(admin, "post", "/stock/movements", json={"type": "receipt", "item_id": item["id"], "qty": 10, "rate": 10, "supplier_id": sup["id"],
                                              "supplier_bill_no": "T-1", "date": D})
cat = call(admin, "post", "/expense-categories", json={"name": f"P5 Cat {tag}"}).json()
made["cats"].append(cat["id"])

lot = mk_lot(order_rate=5.0, extra=[{"rate_type_id": types["Sample"]["id"], "rate": 4.0}]).json()
e1 = batch(lot["id"], {"S": 60}).json()["entries"][0]
batch(lot["id"], {"S": 5}, types["Sample"]["id"])
call(admin, "post", "/stock/movements", json={"type": "issue", "item_id": item["id"], "qty": 4, "lot_id": lot["id"], "date": D})
call(admin, "post", "/expenses", json={"date": D, "category_id": cat["id"], "vendor": f"P5 Vendor {tag}", "amount": 500, "lot_id": lot["id"], "bill_no": "L-1"})
call(admin, "post", "/expenses", json={"date": D, "category_id": cat["id"], "vendor": f"P5 General {tag}", "amount": 1000, "bill_no": "G-1"})

c = call(admin, "get", f"/reports/lot-costing/{lot['id']}")
check("the costing report loads", c.status_code == 200, c.text)
c = c.json()
check("labour = 60 regular x 2.00 + 5 sample x 4.00 = 140", c["labour"]["total"] == 140.0, c["labour"])
check("sample pay is shown on its own line", c["labour"]["non_plan_qty"] == 5 and c["labour"]["non_plan_cost"] == 20.0)
check("materials = 4 issued at the 10.00 average = 40", c["materials"]["total"] == 40.0, c["materials"])
check("bills charged to the lot = 500", c["direct_expenses"]["total"] == 500.0)
every = sum(g["q"] for g in mongo.production_entries.aggregate([{"$match": {"date": {"$regex": f"^{MONTH}"}}}, {"$group": {"_id": None, "q": {"$sum": "$total_quantity"}}}]))
mine = sum(e["total_quantity"] for e in mongo.production_entries.find({"lot_id": lot["id"], "date": {"$regex": f"^{MONTH}"}}))
pool = sum(e["total"] for e in mongo.expenses.find({"lot_id": {"$in": ["", None]}, "status": "approved", "date": {"$regex": f"^{MONTH}"}}))
expect_share = round(pool * mine / every, 2)
check(f"overhead = this lot's share of the month's general bills by pieces handled ({expect_share})", c["overhead"]["total"] == expect_share, c["overhead"])
check("total cost is the sum of the four parts", c["total_cost"] == round(140 + 40 + 500 + expect_share, 2), c["total_cost"])
check("cost per produced piece = total / 60", c["cost_per_piece"]["produced"] == round(c["total_cost"] / 60, 2))
check("margin appears when the lot has an order rate", c["margin"]["revenue"] == 300.0 and c["margin"]["profit"] == round(300 - c["total_cost"], 2), c.get("margin"))
v = c["labour_variance"][0]
check("planned vs actual labour: planned 100 x 2.00 = 200, actual regular 120", v["planned_cost"] == 200.0 and v["actual_cost"] == 120.0 and v["variance"] == -80.0, v)
check("quantities in the report", c["quantities"] == {"order": 100, "planned": 100, "produced": 60})
pdf = call(admin, "get", f"/reports/lot-costing/{lot['id']}/pdf")
xl = call(admin, "get", f"/reports/lot-costing/{lot['id']}/excel")
check("PDF and Excel exports", pdf.content[:4] == b"%PDF" and xl.content[:2] == b"PK")
check("an unknown export format is refused", call(admin, "get", f"/reports/lot-costing/{lot['id']}/doc").status_code == 404)
clerk_email = f"p5-{tag}@example.com"
call(admin, "post", "/users", json={"email": clerk_email, "password": "P5Pass!" + tag, "name": f"P5 Clerk {tag}", "role": "data_entry"})
made["users"].append(clerk_email)
clerk = requests.Session()
call(clerk, "post", "/auth/login", json={"email": clerk_email, "password": "P5Pass!" + tag})
check("data entry cannot see costing", call(clerk, "get", f"/reports/lot-costing/{lot['id']}").status_code == 403)

# ============================================================ closing
print("\n--- closing report ---")
chk = call(admin, "get", f"/lots/{lot['id']}/close-check").json()
check("the checklist blocks while material is still on the lot", any("still on this lot" in b for b in chk["blocks"]), chk)
check("...and warns about the shortfall and unpaid bill", any("Short of plan" in w for w in chk["warnings"]) and any("unpaid" in w for w in chk["warnings"]), chk["warnings"])
r = call(admin, "post", f"/lots/{lot['id']}/close", json={"reason": "x"})
check("closing is refused while stock is unreconciled", r.status_code == 400 and r.json()["detail"]["code"] == "close_blocked", r.text)
call(admin, "post", "/stock/movements", json={"type": "return", "item_id": item["id"], "qty": 1, "lot_id": lot["id"], "date": D})
call(admin, "post", "/stock/movements", json={"type": "wastage", "item_id": item["id"], "qty": 3, "lot_id": lot["id"], "reason": "used up in sewing", "date": D})
check("after returning and writing off the rest, nothing blocks", call(admin, "get", f"/lots/{lot['id']}/close-check").json()["blocks"] == [])
r = call(admin, "post", f"/lots/{lot['id']}/close", json={})
check("open items need a reason (409)", r.status_code == 409 and r.json()["detail"]["code"] == "needs_reason", r.text)
call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": e1["id"], "reason": "recount", "payload": {"size_quantities": {"S": 59}}})
r = call(admin, "post", f"/lots/{lot['id']}/close", json={"reason": "customer cancelled the rest"})
check("a pending request about the lot blocks closing", r.status_code == 400 and "waiting for approval" in r.text, r.text)
pend = [a for a in call(admin, "get", "/approvals?status=pending").json()["items"] if a["entity_id"] == e1["id"]][0]
call(admin, "post", f"/approvals/{pend['id']}/reject", json={"note": "no"})
r = call(admin, "post", f"/lots/{lot['id']}/close", json={"reason": "customer cancelled the rest"})
check("closing with a reason succeeds", r.status_code == 200 and r.json()["version"] == 1, r.text)
cl = call(admin, "get", f"/lots/{lot['id']}/closure").json()
check("the closing report snapshots quantities, shortage and the reason",
      cl["quantities"]["produced"] == 60 and cl["shortages"][0]["short"] == 40 and cl["reason"] == "customer cancelled the rest", cl["shortages"])
check("...the warnings that were acknowledged", len(cl["acknowledged_warnings"]) >= 1)
snap_total = cl["costing"]["total_cost"]
call(admin, "put", f"/operations/{op['id']}", json={"name": f"P5Op renamed {tag}"})
cl2 = call(admin, "get", f"/lots/{lot['id']}/closure").json()
check("renaming an operation afterwards does not change the closed report", cl2["costing"]["total_cost"] == snap_total and cl2["costing"]["labour_variance"][0]["operation"] == f"P5Op {tag}")
call(admin, "put", f"/operations/{op['id']}", json={"name": f"P5Op {tag}"})
check("closing report PDF/Excel", call(admin, "get", f"/lots/{lot['id']}/closure/pdf").content[:4] == b"%PDF" and call(admin, "get", f"/lots/{lot['id']}/closure/excel").content[:2] == b"PK")
call(admin, "post", f"/lots/{lot['id']}/reopen", json={"reason": "more pieces arrived"})
r = call(admin, "post", f"/lots/{lot['id']}/close", json={"reason": "done again"})
check("reopening and closing again writes version 2", r.json()["version"] == 2)
check("version 1 is still there", call(admin, "get", f"/lots/{lot['id']}/closure", params={"version": 1}).json()["version"] == 1
      and call(admin, "get", f"/lots/{lot['id']}/closure").json()["versions"] == [1, 2])
clean_lot = mk_lot(qty="10", style=f"P5 Clean {tag}").json()
batch(clean_lot["id"], {"S": 10})
check("a lot that is fully produced closes without a reason", call(admin, "post", f"/lots/{clean_lot['id']}/close", json={}).status_code == 200)

# ============================================================ year end
print("\n--- financial-year rollover ---")
check("non-admin cannot see year end", call(clerk, "get", "/year-end").status_code == 403)
oldA = mk_lot(qty="100", style=f"P5 OldA {tag}").json()
oldB = mk_lot(qty="50", style=f"P5 OldB {tag}").json()
oldC = mk_lot(qty="20", style=f"P5 OldC {tag}").json()
for l in (oldA, oldB, oldC):
    mongo.lots.update_one({"_id": ObjectId(l["id"])}, {"$set": {"fy": "25-26", "start_date": "2025-06-01"}})
batch(oldA["id"], {"S": 70})
call(admin, "post", "/stock/movements", json={"type": "receipt", "item_id": item["id"], "qty": 20, "rate": 10, "supplier_id": sup["id"], "supplier_bill_no": "T-2", "date": D})
call(admin, "post", "/stock/movements", json={"type": "issue", "item_id": item["id"], "qty": 6, "lot_id": oldA["id"], "date": D})
batch(oldC["id"], {"S": 20})
ov = call(admin, "get", "/year-end").json()
ids = {l["id"]: l for l in ov["lots"]}
check("last year's open lots are listed", oldA["id"] in ids and oldB["id"] in ids and ov["current_fy"] not in (ids[oldA["id"]]["fy"],), ov["current_fy"])
check("with their balance", ids[oldA["id"]]["balance"] == 30 and ids[oldA["id"]]["progress"] == 70.0)
res = call(admin, "post", "/year-end", json={"actions": [{"lot_id": oldA["id"], "action": "carry"}, {"lot_id": oldB["id"], "action": "carry"},
                                                          {"lot_id": oldC["id"], "action": "close", "reason": "year end"}]}).json()["results"]
by = {r["lot_id"]: r for r in res}
check("a lot with pieces left is carried forward", by[oldA["id"]]["status"] == "carried" and by[oldA["id"]]["pieces"] == 30, by[oldA["id"]])
new_lot = call(admin, "get", f"/lots/{by[oldA['id']]['new_lot_id']}").json()
made["lots"].append(new_lot["id"])
check("...as a new lot in the current year holding exactly the balance",
      new_lot["total_planned_qty"] == 30 and new_lot["carried_from_lot_number"] == oldA["lot_number"] and new_lot["status"] == "active")
check("...numbered in the current financial year", new_lot["lot_number"].endswith("/" + ov["current_fy"]), new_lot["lot_number"])
check("...with the same operations, rates and operators",
      new_lot["operations"][0]["rate"] == 2.0 and new_lot["operations"][0]["operators"][0]["operator_id"] == worker["id"])
old_now = call(admin, "get", f"/lots/{oldA['id']}").json()
check("the old lot is closed and points at the new one", old_now["status"] == "completed" and old_now["carried_to_lot_number"] == new_lot["lot_number"])
mat = {m["item_id"]: m for m in call(admin, "get", f"/stock/lot/{new_lot['id']}").json()["items"]}
check("material on the old lot moved with the work", mat[item["id"]]["on_lot"] == 6 and mat[item["id"]]["moved_in"] == 6, mat.get(item["id"]))
check("an untouched lot carries all its pieces", by[oldB["id"]]["status"] == "carried" and by[oldB["id"]]["pieces"] == 50)
made["lots"].append(by[oldB["id"]]["new_lot_id"])
check("a lot that was finished is simply closed", by[oldC["id"]]["status"] == "closed")
again = call(admin, "post", "/year-end", json={"actions": [{"lot_id": oldA["id"], "action": "carry"}]}).json()["results"][0]
check("running it again creates nothing new (idempotent)", again["status"] == "already_carried" and again["new_lot"] == new_lot["lot_number"])
check("exactly one carry-forward lot exists", mongo.lots.count_documents({"carried_from_lot_id": oldA["id"]}) == 1)
check("the list no longer shows them", not any(l["id"] in (oldA["id"], oldB["id"], oldC["id"]) for l in call(admin, "get", "/year-end").json()["lots"]))
r = call(admin, "post", "/year-end", json={"actions": [{"lot_id": oldC["id"], "action": "carry"}]}).json()["results"][0]
check("a lot with nothing left cannot be carried forward", r["status"] in ("error", "already_carried"), r)

# ============================================================ email
print("\n--- email reports ---")
st = call(admin, "get", "/email/settings").json()
check("email shows as not configured when SMTP_HOST is unset", st["configured"] is False and st["cron_token_set"] is True)
check("every report is off until switched on", not any(r["enabled"] for r in st["reports"].values()))
check("a bad address is refused", call(admin, "put", "/email/settings", json={"reports": {"pending_lots": {"enabled": True, "recipients": ["not-an-email"], "schedule": "weekly", "format": "both"}}}).status_code == 400)
check("an unknown report is refused", call(admin, "put", "/email/settings", json={"reports": {"made_up": {"enabled": True, "recipients": [], "schedule": "weekly", "format": "both"}}}).status_code == 400)
SETTINGS = {"reports": {"pending_lots": {"enabled": True, "recipients": ["owner@example.com"], "schedule": "weekly", "format": "both"},
                        "low_stock": {"enabled": False, "recipients": [], "schedule": "daily", "format": "html"}}}
r = call(admin, "put", "/email/settings", json=SETTINGS)
check("settings save", r.status_code == 200 and r.json()["reports"]["pending_lots"]["recipients"] == ["owner@example.com"], r.text)
t = call(admin, "post", "/email/test", json={"to": "owner@example.com"})
check("a test email says email is not configured instead of failing silently", t.status_code == 400 and "not configured" in t.text, t.text)
sn = call(admin, "post", "/email/send/pending_lots").json()
check("'send now' is recorded as skipped when email is off", sn["status"] == "skipped")
log = call(admin, "get", "/email/log").json()
check("every attempt leaves a log row", log and log[0]["report"] == "pending_lots" and log[0]["status"] == "skipped")
pv = call(admin, "post", "/email/preview/pending_lots").json()
check("the pending-lots report lists open lots", not pv["empty"] and any(oldB["lot_number"] in str(r) or lot["lot_number"] for r in pv["rows"]) and len(pv["rows"]) >= 1)
check("an unknown report preview is 404", call(admin, "post", "/email/preview/nope").status_code == 404)

print("\n--- scheduled jobs endpoint ---")
check("no token -> refused", requests.post(f"{BASE}/api/jobs/run", timeout=30).status_code in (403, 422))
check("a wrong token is refused", requests.post(f"{BASE}/api/jobs/run", params={"token": "nope"}, timeout=30).status_code == 403)
r = requests.post(f"{BASE}/api/jobs/run", params={"token": CRON}, timeout=60)
check("the right token runs due jobs", r.status_code == 200 and "ran" in r.json(), r.text)
check("it needs no login session", not r.cookies)

# ---- in-process: render + send through a local SMTP sink, dedupe, concurrency
print("\n--- sending through a local SMTP sink ---")
try:
    from aiosmtpd.controller import Controller
except ImportError:
    Controller = None
    check("aiosmtpd is installed for this test", False, "pip install -r backend/requirements-dev.txt")

if Controller:
    received = []

    class Sink:
        async def handle_DATA(self, server, session, envelope):
            received.append((envelope.rcpt_tos, message_from_bytes(envelope.content)))
            return "250 OK"

    ctl = Controller(Sink(), hostname="127.0.0.1", port=8026)
    ctl.start()
    os.environ.update(SMTP_HOST="127.0.0.1", SMTP_PORT="8026", SMTP_STARTTLS="false", SMTP_FROM="Victoria <noreply@example.com>")
    evil = mk_lot(qty="30", style=f"<b>P5 Evil</b> <script>alert(1)</script> {tag}").json()
    import mailer
    import server          # the report builders need the same lot enrichment the running API uses
    import lifecycle
    lifecycle.configure(server.enrich_lot)

    async def run():
        out = {}
        out["send"] = await mailer.send_report("pending_lots", "manual")
        # weekly report: due on Monday at/after 08:00 IST, once per week
        monday = datetime(2026, 11, 2, 9, 0, tzinfo=mailer.IST)      # a Monday
        out["early"] = mailer.period_key("weekly", datetime(2026, 11, 2, 7, 0, tzinfo=mailer.IST))
        out["tuesday"] = mailer.period_key("weekly", datetime(2026, 11, 3, 9, 0, tzinfo=mailer.IST))
        out["monday"] = mailer.period_key("weekly", monday)
        out["monthly_1st"] = mailer.period_key("monthly", datetime(2026, 12, 1, 9, 0, tzinfo=mailer.IST))
        out["april"] = mailer.period_key("april", datetime(2027, 4, 8, 9, 0, tzinfo=mailer.IST))
        out["april_other"] = mailer.period_key("april", datetime(2027, 4, 9, 9, 0, tzinfo=mailer.IST))
        mongo.scheduler_state.delete_many({})
        before = len(received)
        runs = await asyncio.gather(mailer.run_due_jobs(monday.astimezone(timezone.utc)), mailer.run_due_jobs(monday.astimezone(timezone.utc)),
                                    mailer.run_due_jobs(monday.astimezone(timezone.utc)))
        out["concurrent_sent"] = sum(len(r) for r in runs)
        out["mail_delta"] = len(received) - before
        out["rerun"] = await mailer.run_due_jobs(monday.astimezone(timezone.utc))
        return out

    res = asyncio.run(run())
    ctl.stop()
    check("the report was sent", res["send"][0] == "ok", res["send"])
    msg = received[0][1]
    check("it goes to the configured recipient", received[0][0] == ["owner@example.com"] and "Open and overdue lots" in msg["Subject"], (received[0][0], msg["Subject"]))
    parts = [p for p in msg.walk()]
    html_part = next(p for p in parts if p.get_content_type() == "text/html").get_payload(decode=True).decode()
    check("HTML is escaped: a lot named with a <script> tag cannot inject markup",
          "<script>alert(1)</script>" not in html_part and "&lt;script&gt;" in html_part)
    names = [p.get_filename() for p in parts if p.get_filename()]
    check("PDF and Excel are attached", any(n.endswith(".pdf") for n in names) and any(n.endswith(".xlsx") for n in names), names)
    check("a plain-text alternative is included", any(p.get_content_type() == "text/plain" for p in parts))
    check("weekly: not before 08:00, not on a Tuesday", res["early"] is None and res["tuesday"] is None)
    check("weekly: due Monday after 08:00 with a stable week key", res["monday"] == "2026-W45", res["monday"])
    check("monthly: due on the 1st; april: only on 1, 8 and 15", res["monthly_1st"] == "2026-12" and res["april"] == "2027-04-08" and res["april_other"] is None)
    check("three overlapping job runs send the report exactly once", res["concurrent_sent"] == 1 and res["mail_delta"] == 1, res)
    check("running again in the same period sends nothing", res["rerun"] == [])
    mongo.scheduler_state.delete_many({})

# reset settings so the dev database is left switched off
call(admin, "put", "/email/settings", json={"reports": {k: {"enabled": False, "recipients": [], "schedule": v["schedule"], "format": v["format"]}
                                                       for k, v in call(admin, "get", "/email/settings").json()["reports"].items()}})

print("\n--- cleanup ---")
for lid in set(made["lots"]):
    for e in mongo.production_entries.find({"lot_id": lid}):
        mongo.production_entries.delete_one({"_id": e["_id"]})
mongo.lot_closures.delete_many({"lot_id": {"$in": made["lots"]}})
mongo.lots.delete_many({"_id": {"$in": [ObjectId(i) for i in made["lots"]]}})
mongo.lots.delete_many({"style_name": {"$regex": f"{tag}$"}})
mongo.expenses.delete_many({"category_id": {"$in": made["cats"]}})
mongo.expense_categories.delete_many({"_id": {"$in": [ObjectId(i) for i in made["cats"]]}})
mongo.stock_movements.delete_many({"item_id": {"$in": made["items"]}})
mongo.stock_items.delete_many({"_id": {"$in": [ObjectId(i) for i in made["items"]]}})
mongo.suppliers.delete_many({"_id": {"$in": [ObjectId(i) for i in made["suppliers"]]}})
mongo.purchase_orders.delete_many({"supplier_id": {"$in": made["suppliers"]}})
mongo.approvals.delete_many({"entity_label": {"$regex": tag}})
for path, obj in (("/weeks", week), ("/colors", color), ("/size-charts", chart), ("/operators", worker), ("/operations", op)):
    call(admin, "delete", f"{path}/{obj['id']}")
for u in call(admin, "get", "/users").json():
    if u["email"] in made["users"]:
        call(admin, "delete", f"/users/{u['id']}")
mongo.email_log.delete_many({"report": {"$in": ["test", "pending_lots"]}})
print("  removed fixtures")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
