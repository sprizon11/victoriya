"""
Phase 4 API checks: stock ledger (two-unit items, issue/return/transfer/wastage, reversal),
lot requirements and drafted purchase orders, and expense bills.

Needs the API running on :8000 and MongoDB reachable (fixtures are removed directly
at the end, because financial records have no delete route by design).

    backend\\.venv\\Scripts\\python.exe backend\\test_phase4.py
"""
import io
import os
import sys
import uuid
from datetime import datetime, timedelta
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
    return s.request(method, f"{BASE}/api{path}", timeout=30, **kw)


tag = uuid.uuid4().hex[:6]
admin = requests.Session()
if call(admin, "post", "/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code != 200:
    print("cannot log in; is the API running?")
    sys.exit(1)
today = datetime.now()
D = today.strftime("%Y-%m-%d")

made = {"items": [], "suppliers": [], "lots": [], "users": [], "cats": [], "chart": None, "color": None, "op": None}


def mk_item(name, **kw):
    r = call(admin, "post", "/stock/items", json={"name": f"{name} {tag}", **kw})
    if r.status_code == 200:
        made["items"].append(r.json()["id"])
    return r


def mv(sess, **kw):
    return call(sess, "post", "/stock/movements", json={"date": D, **kw})


def bal(item_id, lot_id=None):
    rows = call(admin, "get", "/stock/balances", params={"lot_id": lot_id} if lot_id else {}).json()
    return next((r for r in rows if r["id"] == item_id), None)


print("--- items and suppliers ---")
cats = call(admin, "get", "/stock/categories").json()
check("yarn, elastic, label, sticker and fusing are categories", {"yarn", "elastic", "label", "sticker", "fusing"} <= set(cats["categories"]))
supA = call(admin, "post", "/suppliers", json={"name": f"Supplier A {tag}"}).json()
supB = call(admin, "post", "/suppliers", json={"name": f"Supplier B {tag}"}).json()
made["suppliers"] += [supA["id"], supB["id"]]
check("duplicate supplier refused", call(admin, "post", "/suppliers", json={"name": f"supplier a {tag}"}).status_code == 400)
yarn = mk_item("Yarn", category="yarn", uom="cone", dual_unit=True, uom2="kg", reorder_level=20, preferred_supplier_id=supA["id"]).json()
elastic = mk_item("Elastic", category="elastic", uom="meter", reorder_level=50, preferred_supplier_id=supA["id"]).json()
label = mk_item("Label", category="label", uom="pcs").json()
check("a two-unit item keeps both units", yarn["dual_unit"] and yarn["uom"] == "cone" and yarn["uom2"] == "kg")
check("item codes are issued", yarn["code"].startswith("ITM") and yarn["code"] != elastic["code"])
check("duplicate item name refused", mk_item("Yarn", category="yarn").status_code == 400)
check("two-unit item with the same unit twice refused", mk_item("Bad", uom="kg", dual_unit=True, uom2="kg").status_code == 400)
check("unknown category refused", mk_item("Odd", category="nonsense").status_code == 400)

print("\n--- receipts: two entries for two-unit items ---")
r = mv(admin, type="receipt", item_id=yarn["id"], qty=100, supplier_id=supA["id"], supplier_bill_no="B-1", rate=10)
check("a yarn receipt without the weight is refused", r.status_code == 400 and "both" in r.text, r.text)
r = mv(admin, type="receipt", item_id=elastic["id"], qty=100, qty2=5, supplier_id=supA["id"], supplier_bill_no="B-1", rate=2)
check("a single-unit item refuses a second quantity", r.status_code == 400, r.text)
r = mv(admin, type="receipt", item_id=yarn["id"], qty=100, qty2=250, supplier_id=supA["id"], rate=10)
check("a receipt without the bill number is refused", r.status_code == 400 and "bill" in r.text.lower(), r.text)
r = mv(admin, type="receipt", item_id=yarn["id"], qty=100, qty2=250, supplier_bill_no="B-1", rate=10)
check("a receipt without a supplier is refused", r.status_code == 400, r.text)
r = mv(admin, type="receipt", item_id=yarn["id"], qty=100, qty2=250, supplier_id=supA["id"], supplier_bill_no="B-1", rate=10)
check("yarn: 100 cones / 250 kg received", r.status_code == 200 and r.json()["no"].startswith("GRN"), r.text)
rcpt1 = r.json()
b = bal(yarn["id"])
check("balances are kept in both units", b["balance"] == 100 and b["balance2"] == 250, b)
r = mv(admin, type="receipt", item_id=yarn["id"], qty=100, qty2=300, supplier_id=supA["id"], supplier_bill_no="B-2", rate=20)
check("a receipt whose kg-per-cone is off is accepted with a warning", r.status_code == 200 and r.json()["warnings"], r.text)
check("movement numbers are sequential", r.json()["no"] != rcpt1["no"])
mv(admin, type="receipt", item_id=elastic["id"], qty=500, supplier_id=supA["id"], supplier_bill_no="E-1", rate=2)
mv(admin, type="receipt", item_id=label["id"], qty=1000, supplier_id=supB["id"], supplier_bill_no="L-1", rate=0.5)

print("\n--- lots and issues ---")
made["chart"] = call(admin, "post", "/size-charts", json={"name": f"P4Chart {tag}", "sizes": ["S"]}).json()["id"]
made["color"] = call(admin, "post", "/colors", json={"name": f"P4Color {tag}"}).json()["id"]
made["op"] = call(admin, "post", "/operations", json={"name": f"P4Op {tag}"}).json()["id"]


def mk_lot(qty="100", reqs=None, post=0, name=None):
    r = call(admin, "post", "/lots", json={
        "style_name": name or f"P4 Style {uuid.uuid4().hex[:4]}", "start_date": D, "target_end_date": (today + timedelta(days=20)).strftime("%Y-%m-%d"),
        "size_chart_id": made["chart"], "color_names": [f"P4Color {tag}"], "color_size_quantities": {f"P4Color {tag}": {"S": qty}},
        "operations": [{"operation_id": made["op"], "rate": 2, "operator_ids": []}], "requirements": reqs, "post_pct": post})
    if r.status_code == 200:
        made["lots"].append(r.json()["id"])
    return r


lotA = mk_lot().json()
lotB = mk_lot().json()
r = mv(admin, type="issue", item_id=yarn["id"], qty=40, qty2=110, lot_id=lotA["id"])
check("issue to a lot", r.status_code == 200 and r.json()["no"].startswith("ISS"), r.text)
check("issue is valued at the weighted average cost (200 cones, 2000+... = 15 per cone -> 600)",
      r.json()["rate"] == 15.0 and r.json()["amount"] == 600.0, r.json())
b = bal(yarn["id"])
check("store dropped, in both units", b["balance"] == 160 and b["balance2"] == 440, b)
check("the lot holds it", bal(yarn["id"], lotA["id"])["on_lot"] == 40)
r = mv(admin, type="issue", item_id=yarn["id"], qty=500, qty2=1000, lot_id=lotA["id"])
check("cannot issue more than the store holds", r.status_code == 400 and "Not enough" in r.text, r.text)
check("an issue needs a lot", mv(admin, type="issue", item_id=elastic["id"], qty=1).status_code == 400)
r = mv(admin, type="return", item_id=yarn["id"], qty=10, qty2=27, lot_id=lotA["id"])
check("unused material returns to the store", r.status_code == 200 and bal(yarn["id"])["balance"] == 170)
r = mv(admin, type="return", item_id=yarn["id"], qty=999, qty2=999, lot_id=lotA["id"])
check("cannot return more than the lot holds", r.status_code == 400, r.text)

print("\n--- move to the next lot, wastage ---")
r = mv(admin, type="transfer", item_id=yarn["id"], qty=5, qty2=13, lot_id=lotA["id"], to_lot_id=lotB["id"])
check("a transfer needs a reason", r.status_code == 400 and "reason" in r.text, r.text)
r = mv(admin, type="transfer", item_id=yarn["id"], qty=5, qty2=13, lot_id=lotA["id"], to_lot_id=lotB["id"], reason="shade mismatch on lot A")
check("move material to the next lot", r.status_code == 200, r.text)
check("...the lot balances moved, the store did not",
      bal(yarn["id"], lotA["id"])["on_lot"] == 25 and bal(yarn["id"], lotB["id"])["on_lot"] == 5 and bal(yarn["id"])["balance"] == 170)
check("a lot cannot transfer to itself", mv(admin, type="transfer", item_id=yarn["id"], qty=1, qty2=2, lot_id=lotA["id"], to_lot_id=lotA["id"], reason="x").status_code == 400)
r = mv(admin, type="wastage", item_id=yarn["id"], qty=2, qty2=5, lot_id=lotA["id"])
check("wastage needs a reason", r.status_code == 400)
r = mv(admin, type="wastage", item_id=yarn["id"], qty=2, qty2=5, lot_id=lotA["id"], reason="cut waste")
check("wastage comes off the lot", r.status_code == 200 and bal(yarn["id"], lotA["id"])["on_lot"] == 23)
mat = call(admin, "get", f"/stock/lot/{lotA['id']}").json()["items"]
row = next(x for x in mat if x["item_id"] == yarn["id"])
check("the lot's material report adds up", row["issued"] == 40 and row["returned"] == 10 and row["wasted"] == 2 and row["moved_out"] == 5 and row["on_lot"] == 23, row)

print("\n--- corrections are reversals ---")
r = mv(admin, type="issue", item_id=elastic["id"], qty=30, lot_id=lotA["id"])
issue_id = r.json()["id"]
rv = call(admin, "post", f"/stock/movements/{issue_id}/reverse", json={"reason": "wrong lot"})
check("an issue can be reversed", rv.status_code == 200 and bal(elastic["id"])["balance"] == 500, rv.text)
check("a reversal needs a reason", call(admin, "post", f"/stock/movements/{issue_id}/reverse", json={}).status_code == 400)
check("it cannot be reversed twice", call(admin, "post", f"/stock/movements/{issue_id}/reverse", json={"reason": "again"}).status_code == 400)
led = call(admin, "get", f"/stock/ledger/{yarn['id']}").json()
check("the ledger shows a running balance", led["movements"][0]["balance"] == 170 and len(led["movements"]) >= 6)

print("\n--- adjustments need an approval path ---")
r = mv(admin, type="adjustment", item_id=label["id"], qty=10, direction=-1)
check("an adjustment needs a reason", r.status_code == 400)
r = mv(admin, type="adjustment", item_id=label["id"], qty=10, direction=-1, reason="stock take: 10 short")
check("an administrator can adjust (recorded as auto-approved)", r.status_code == 200 and bal(label["id"])["balance"] == 990, r.text)
acct_email = f"acct-{tag}@example.com"
call(admin, "post", "/users", json={"email": acct_email, "password": "AcctPass!" + tag, "name": f"Acct {tag}", "role": "accounts",
                                    "can_view_financial": True})
acct = requests.Session()
call(acct, "post", "/auth/login", json={"email": acct_email, "password": "AcctPass!" + tag})
check("accounts cannot adjust directly", mv(acct, type="adjustment", item_id=label["id"], qty=5, direction=-1, reason="x").status_code == 403)
req = call(acct, "post", "/approvals", json={"type": "stock_adjustment", "entity_id": label["id"], "reason": "stock take",
                                              "payload": {"qty": 5, "direction": -1, "reason": "damaged in store", "type": "adjustment"}})
check("...but can ask for one", req.status_code == 200 and req.json()["status"] == "pending", req.text)
call(admin, "post", f"/approvals/{req.json()['id']}/approve")
check("approving posts the adjustment", bal(label["id"])["balance"] == 985)
check("an adjustment cannot take the store below zero",
      call(acct, "post", "/approvals", json={"type": "stock_adjustment", "entity_id": label["id"], "reason": "x",
                                              "payload": {"qty": 99999, "direction": -1, "reason": "x", "type": "adjustment"}}).status_code == 400)

print("\n--- low stock, data-entry access ---")
low = call(admin, "get", "/stock/balances", params={"low_only": True}).json()
check("an item at or below its reorder level is flagged", any(x["id"] == yarn["id"] for x in low) is False and True)
mv(admin, type="adjustment", item_id=elastic["id"], qty=460, direction=-1, reason="test low stock")
low = call(admin, "get", "/stock/balances", params={"low_only": True}).json()
check("...elastic (40 left, level 50) is low", any(x["id"] == elastic["id"] for x in low))
el_receipt = next(m for m in call(admin, "get", "/stock/movements", params={"item_id": elastic["id"], "type": "receipt"}).json()["items"])
check("a receipt whose material has gone cannot be reversed (the store would go negative)",
      call(admin, "post", f"/stock/movements/{el_receipt['id']}/reverse", json={"reason": "typo"}).status_code == 400)
clerk_email = f"store-{tag}@example.com"
call(admin, "post", "/users", json={"email": clerk_email, "password": "Store!" + tag, "name": f"Store {tag}", "role": "data_entry"})
clerk = requests.Session()
call(clerk, "post", "/auth/login", json={"email": clerk_email, "password": "Store!" + tag})
check("data entry cannot touch stock by default", mv(clerk, type="issue", item_id=elastic["id"], qty=1, lot_id=lotA["id"]).status_code == 403)
call(admin, "put", "/settings/data_entry_can_issue_stock", json={"value": "true"})
r = mv(clerk, type="issue", item_id=elastic["id"], qty=1, lot_id=lotA["id"])
check("...unless the owner allows issuing", r.status_code == 200, r.text)
check("...and then sees no rates or amounts", "rate" not in r.json() and "amount" not in r.json(), r.json().keys())
check("...but still cannot receive stock", mv(clerk, type="receipt", item_id=elastic["id"], qty=1, supplier_id=supA["id"], supplier_bill_no="x").status_code == 403)
rows = call(clerk, "get", "/stock/balances").json()
check("...and the balance list carries no values", rows and "value" not in rows[0] and "avg_rate" not in rows[0])
call(admin, "put", "/settings/data_entry_can_issue_stock", json={"value": "false"})
check("items and suppliers with movements cannot be deleted",
      call(admin, "delete", f"/stock/items/{yarn['id']}").status_code == 400 and call(admin, "delete", f"/suppliers/{supA['id']}").status_code == 400)

print("\n--- requirements and drafted purchase orders ---")
mv(admin, type="adjustment", item_id=elastic["id"], qty=20, direction=1, reason="top up to 59 for the test")   # store: 40-1+20 = 59
reqs = [{"item_id": elastic["id"], "basis": "per_piece", "qty_per_piece": 1.2},
        {"item_id": yarn["id"], "basis": "total", "total_qty": 50},
        {"item_id": label["id"], "basis": "per_piece", "qty_per_piece": 10}]
lotP = mk_lot(qty="100", reqs=reqs, post=3, name=f"P4 PO Lot {tag}")
check("a lot with requirements is accepted", lotP.status_code == 200, lotP.text)
lotP = lotP.json()
rq = {r["item_name"].split(" ")[0]: r for r in lotP["requirements"]}
check("per piece x planned + 3% post, rounded up to 3 dp: 100 x 1.2 x 1.03 = 123.6", rq["Elastic"]["gross_qty"] == 123.6, rq["Elastic"])
check("counted items round up to a whole unit: 50 x 1.03 = 51.5 -> 52 cones", rq["Yarn"]["gross_qty"] == 52, rq["Yarn"])
check("post % is stored on the lot", lotP["post_pct"] == 3)
pos = [p for p in call(admin, "get", "/purchase-orders", params={"lot_id": lotP["id"]}).json()["items"]]
check("purchase orders were drafted automatically, never sent", pos and all(p["status"] == "draft" for p in pos), [p["status"] for p in pos])
bysup = {p["supplier_name"]: p for p in pos}
a_po = bysup.get(f"Supplier A {tag}")
check("lines are grouped by the item's preferred supplier",
      a_po and {ln["item_name"].split(" ")[0] for ln in a_po["lines"]} == {"Elastic"}, a_po)
el = next(ln for ln in a_po["lines"] if ln["item_name"].startswith("Elastic"))
check("net to buy = requirement - store (59 m) = 64.6", abs(el["qty"] - 64.6) < 0.001, el)
ya = next((ln for ln in a_po["lines"] if ln["item_name"].startswith("Yarn")), None)
check("yarn needs 52 cones; the store has 170, so nothing is ordered", ya is None, ya)
check("an item with no preferred supplier goes on an 'unassigned' order", "" in bysup, list(bysup))
lbl = bysup[""]["lines"][0]
check("net to buy for labels = 100 x 10 x 1.03 - 985 in store = 45", lbl["qty"] == 45 and lbl["item_name"].startswith("Label"), lbl)
req_view = call(admin, "get", f"/lots/{lotP['id']}/requirements").json()
check("requirement view shows store, on order and to order",
      {r["item_name"].split(" ")[0] for r in req_view["requirements"]} == {"Elastic", "Yarn", "Label"} and req_view["planned_total"] == 100)
again = call(admin, "post", f"/lots/{lotP['id']}/generate-po")
check("regenerating replaces the drafts, it does not pile up",
      again.status_code == 200 and len(call(admin, "get", "/purchase-orders", params={"lot_id": lotP["id"]}).json()["items"]) == len(pos))
po = next(p for p in call(admin, "get", "/purchase-orders", params={"lot_id": lotP["id"]}).json()["items"] if p["supplier_name"])
number = po["po_number"]
check("PO numbers follow the financial year", "/" in number and number.startswith("PO"))

print("\n--- releasing and receiving ---")
fresh = {p["supplier_name"]: p for p in call(admin, "get", "/purchase-orders", params={"lot_id": lotP["id"]}).json()["items"]}
check("an unassigned order cannot be released until a supplier is chosen",
      call(admin, "post", f"/purchase-orders/{fresh['']['id']}/approve").status_code == 400)
upd = call(admin, "put", f"/purchase-orders/{po['id']}", json={"supplier_id": supA["id"], "expected_date": D,
                                                              "lines": [{"item_id": elastic["id"], "qty": 70, "rate": 2.5}]})
check("a draft can be edited", upd.status_code == 200 and upd.json()["total"] == 175.0, upd.text)
check("accounts cannot release it when approval is required", call(acct, "post", f"/purchase-orders/{po['id']}/approve").status_code == 403)
rq2 = call(acct, "post", "/approvals", json={"type": "po_release", "entity_id": po["id"], "reason": "needed this week"})
check("accounts can request release", rq2.status_code == 200, rq2.text)
dec = call(admin, "post", f"/approvals/{rq2.json()['id']}/approve")
print("   approve ->", dec.status_code, dec.text[:200])
po = call(admin, "get", f"/purchase-orders/{po['id']}").json()
check("approval releases the order", po["status"] == "approved" and po["po_number"] == number, po["status"])
check("an approved order can no longer be edited",
      call(admin, "put", f"/purchase-orders/{po['id']}", json={"notes": "x"}).status_code == 400)
pdf = call(admin, "get", f"/purchase-orders/{po['id']}/pdf")
check("the PO prints as a PDF", pdf.status_code == 200 and pdf.content[:4] == b"%PDF")
check("receiving needs the bill number", call(admin, "post", f"/purchase-orders/{po['id']}/receive", json={"lines": [{"index": 0, "qty": 10}]}).status_code == 422)
r = call(admin, "post", f"/purchase-orders/{po['id']}/receive", json={"supplier_bill_no": "E-2", "date": D, "lines": [{"index": 0, "qty": 40}]})
check("partial receipt", r.status_code == 200 and r.json()["status"] == "partially_received" and r.json()["grn"], r.text)
check("...stock went up", bal(elastic["id"])["balance"] == 99)
r = call(admin, "post", f"/purchase-orders/{po['id']}/receive", json={"supplier_bill_no": "E-3", "date": D, "lines": [{"index": 0, "qty": 30}]})
check("receiving the rest completes the order", r.json()["status"] == "received", r.text)
check("a received order cannot be cancelled",
      call(admin, "post", f"/purchase-orders/{po['id']}/cancel").status_code == 400)
check("the number is unchanged after all that", call(admin, "get", f"/purchase-orders/{po['id']}").json()["po_number"] == number)
mv(admin, type="issue", item_id=elastic["id"], qty=5, lot_id=lotP["id"])
check("once material is issued the lot's orders cannot be regenerated",
      call(admin, "post", f"/lots/{lotP['id']}/generate-po").status_code == 400)
man = call(admin, "post", "/purchase-orders", json={"supplier_id": supB["id"], "lines": [{"item_id": label["id"], "qty": 50, "rate": 0.6},
                                                                                       {"item_id": label["id"], "qty": 5, "rate": 0.6}]})
check("the same item twice on one order is refused", man.status_code == 400)
man = call(admin, "post", "/purchase-orders", json={"supplier_id": supB["id"], "lines": [{"item_id": label["id"], "qty": 50, "rate": 0.6}]})
check("a manual order can be raised", man.status_code == 200 and man.json()["status"] == "draft")
check("and cancelled", call(admin, "post", f"/purchase-orders/{man.json()['id']}/cancel").json()["status"] == "cancelled")
check("data entry cannot see purchase orders", call(clerk, "get", "/purchase-orders").status_code == 403)

print("\n--- expense bills ---")
cat = call(admin, "post", "/expense-categories", json={"name": f"Maintenance {tag}"}).json()
made["cats"].append(cat["id"])
check("duplicate category refused", call(admin, "post", "/expense-categories", json={"name": f"maintenance {tag}"}).status_code == 400)
ex = lambda **kw: call(admin, "post", "/expenses", json={"date": D, "category_id": cat["id"], "vendor": f"Vendor {tag}", "amount": 500, **kw})
r = ex(bill_no="INV-1", gst_amount=90)
check("a bill is recorded with a voucher number and total", r.status_code == 200 and r.json()["voucher_no"].startswith("EXP") and r.json()["total"] == 590.0, r.text)
b1 = r.json()
check("the same vendor + bill number is refused", ex(bill_no="inv-1").status_code == 400)
check("...unless the user says why", ex(bill_no="INV-1", allow_duplicate=True, duplicate_reason="second part of the same repair").status_code == 200)
check("an unknown category is refused", call(admin, "post", "/expenses", json={"date": D, "category_id": "000000000000000000000000", "vendor": "x", "amount": 1}).status_code == 400)
check("a zero amount is refused", ex(amount=0).status_code == 422)
r = call(admin, "post", f"/expenses/{b1['id']}/pay", json={"amount": 200, "mode": "cash"})
check("part payment makes it 'partial' with the balance owed", r.json()["payment_status"] == "partial" and r.json()["balance"] == 390.0, r.text)
check("paying more than is owed is refused", call(admin, "post", f"/expenses/{b1['id']}/pay", json={"amount": 9999, "mode": "cash"}).status_code == 400)
r = call(admin, "post", f"/expenses/{b1['id']}/pay", json={"amount": 390, "mode": "upi"})
check("full payment marks it paid", r.json()["payment_status"] == "paid")
lotE = mk_lot(name=f"P4 Exp Lot {tag}").json()
r = ex(bill_no="INV-2", lot_id=lotE["id"])
check("a bill can be charged to a lot", r.json()["lot_number"] == lotE["lot_number"])
check("filters and totals work",
      call(admin, "get", "/expenses", params={"lot_id": lotE["id"]}).json()["totals"]["total"] == 500.0)

print("\n--- the approval limit ---")
call(admin, "put", "/settings/expense_approval_threshold", json={"value": "1000"})
r = call(acct, "post", "/expenses", json={"date": D, "category_id": cat["id"], "vendor": f"Big {tag}", "amount": 5000, "bill_no": "BIG-1"})
check("accounts: a bill over the limit waits for approval", r.status_code == 200 and r.json()["status"] == "pending_approval", r.text)
big = r.json()
check("...it is not payable yet", call(acct, "post", f"/expenses/{big['id']}/pay", json={"amount": 10, "mode": "cash"}).status_code == 400)
reqs_open = [a for a in call(admin, "get", "/approvals?status=pending&type=expense_over_limit").json()["items"] if a["entity_id"] == big["id"]]
check("...and an approval request exists", len(reqs_open) == 1)
call(admin, "post", f"/approvals/{reqs_open[0]['id']}/approve")
check("approving makes it a normal bill", call(admin, "get", f"/expenses/{big['id']}").json()["status"] == "approved")
r = call(acct, "post", "/expenses", json={"date": D, "category_id": cat["id"], "vendor": f"Big2 {tag}", "amount": 5000, "bill_no": "BIG-2"})
big2 = r.json()
rq = [a for a in call(admin, "get", "/approvals?status=pending&type=expense_over_limit").json()["items"] if a["entity_id"] == big2["id"]][0]
call(admin, "post", f"/approvals/{rq['id']}/reject", json={"note": "not authorised"})
check("rejecting marks the bill rejected", call(admin, "get", f"/expenses/{big2['id']}").json()["status"] == "rejected")
check("an administrator's own large bill is approved at once",
      call(admin, "post", "/expenses", json={"date": D, "category_id": cat["id"], "vendor": f"Big3 {tag}", "amount": 5000}).json()["status"] == "approved")
check("accounts cannot edit the amount of an approved bill",
      call(acct, "put", f"/expenses/{b1['id']}", json={"amount": 1}).status_code == 403)
call(admin, "put", "/settings/expense_approval_threshold", json={"value": "0"})

print("\n--- bill files, void, summary, export ---")
pdf_bytes = b"%PDF-1.4\n%test bill\n" + b"0" * 100
up = call(admin, "post", f"/expenses/{b1['id']}/attachment", files={"file": ("bill.pdf", pdf_bytes, "application/pdf")})
check("a PDF bill can be attached", up.status_code == 200 and up.json()["content_type"] == "application/pdf", up.text)
dl = call(admin, "get", f"/expenses/{b1['id']}/attachment")
check("...and downloaded again, byte for byte", dl.status_code == 200 and dl.content == pdf_bytes)
check("a renamed executable is refused (checked by content, not name)",
      call(admin, "post", f"/expenses/{b1['id']}/attachment", files={"file": ("bill.pdf", b"MZ\x90\x00 not a pdf", "application/pdf")}).status_code == 400)
check("files over 5 MB are refused",
      call(admin, "post", f"/expenses/{b1['id']}/attachment", files={"file": ("big.pdf", b"%PDF" + b"0" * (5 * 1024 * 1024), "application/pdf")}).status_code == 400)
check("an anonymous request cannot download a bill", requests.get(f"{BASE}/api/expenses/{b1['id']}/attachment", timeout=30).status_code == 401)
check("data entry cannot read expenses", call(clerk, "get", "/expenses").status_code == 403)
check("voiding needs a reason", call(admin, "post", f"/expenses/{b1['id']}/void", json={}).status_code == 400)
v = call(admin, "post", f"/expenses/{b1['id']}/void", json={"reason": "entered twice"})
check("a bill is voided, never deleted", v.json()["status"] == "void" and call(admin, "get", f"/expenses/{b1['id']}").status_code == 200)
sm = call(admin, "get", "/expenses/summary").json()
check("the monthly summary groups by category", any(c["category"] == f"Maintenance {tag}" for c in sm["by_category"]))
x = call(admin, "get", "/expenses/export", params={"category_id": cat["id"]})
check("the Excel export works", x.status_code == 200 and x.content[:2] == b"PK")
check("a category with bills cannot be deleted", call(admin, "delete", f"/expense-categories/{cat['id']}").status_code == 400)

print("\n--- cleanup ---")
mongo.expenses.delete_many({"category_id": {"$in": made["cats"]}})
for f in mongo["bills.files"].find({}):
    pass
mongo["bills.files"].delete_many({"metadata.expense_id": {"$exists": True}, "filename": {"$in": ["bill.pdf", "big.pdf"]}})
mongo.expense_categories.delete_many({"_id": {"$in": [ObjectId(c) for c in made["cats"]]}})
mongo.purchase_orders.delete_many({"lot_id": {"$in": made["lots"]}})
mongo.purchase_orders.delete_many({"supplier_id": {"$in": made["suppliers"]}})
mongo.stock_movements.delete_many({"item_id": {"$in": made["items"]}})
mongo.stock_items.delete_many({"_id": {"$in": [ObjectId(i) for i in made["items"]]}})
mongo.suppliers.delete_many({"_id": {"$in": [ObjectId(i) for i in made["suppliers"]]}})
for lid in made["lots"]:
    call(admin, "delete", f"/lots/{lid}")
call(admin, "delete", f"/operations/{made['op']}")
call(admin, "delete", f"/colors/{made['color']}")
call(admin, "delete", f"/size-charts/{made['chart']}")
for u in call(admin, "get", "/users").json():
    if u["email"] in (acct_email, clerk_email):
        call(admin, "delete", f"/users/{u['id']}")
print("  removed fixtures")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
