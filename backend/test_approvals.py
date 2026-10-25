"""
Checks for approvals and the lot-edit safeguards (Phase 2).

Needs the API running on :8000. Builds a throwaway lot and removes it afterwards.

    backend\\.venv\\Scripts\\python.exe backend\\test_approvals.py
"""
import os
import sys
import uuid
import threading
from datetime import datetime, timedelta
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")
BASE = os.environ.get("TEST_BASE_URL", "http://127.0.0.1:8000")
EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com").strip('"')
PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123").strip('"')

passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name if cond else (name, detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}   {'' if cond else detail}")


def call(s, method, path, **kw):
    return s.request(method, f"{BASE}/api{path}", timeout=30, **kw)


tag = uuid.uuid4().hex[:6]
admin = requests.Session()
if call(admin, "post", "/auth/login", json={"email": EMAIL, "password": PASSWORD}).status_code != 200:
    print("cannot log in; is the API running?")
    sys.exit(1)

# ----------------------------------------------------------------- fixtures
made = {"entries": []}
op = call(admin, "post", "/operations", json={"name": f"ApprOp {tag}"}).json()
op2 = call(admin, "post", "/operations", json={"name": f"ApprOp2 {tag}"}).json()
worker = call(admin, "post", "/operators", json={"name": f"Appr Worker {tag}"}).json()
chart = call(admin, "post", "/size-charts", json={"name": f"ApprChart {tag}", "sizes": ["S", "M"]}).json()
color = call(admin, "post", "/colors", json={"name": f"ApprColor {tag}"}).json()
today = datetime.now()
week = call(admin, "post", "/weeks", json={"week_number": 800 + int(tag[:2], 16) % 90, "year": 2026,
                                           "start_date": (today - timedelta(days=3)).strftime("%Y-%m-%d"),
                                           "end_date": (today + timedelta(days=3)).strftime("%Y-%m-%d")}).json()
lot_payload = {
    "style_name": f"Appr Style {tag}", "start_date": today.strftime("%Y-%m-%d"),
    "target_end_date": (today + timedelta(days=30)).strftime("%Y-%m-%d"), "size_chart_id": chart["id"],
    "color_names": [color["name"]],
    "color_size_quantities": {color["name"]: {"S": "100", "M": ""}},        # "" = a cleared cell
    "operations": [{"operation_id": op["id"], "rate": 2.5, "operator_ids": [worker["id"]]}],
}
r = call(admin, "post", "/lots", json=lot_payload)
check("lot with a blank quantity cell is accepted (was a 500)", r.status_code == 200, r.text[:150])
lot = r.json()
lot_id = lot["id"]
r = call(admin, "post", "/production/batch", json={
    "week_id": week["id"], "lot_id": lot_id, "operation_id": op["id"], "color": color["name"],
    "date": today.strftime("%Y-%m-%d"), "entries": [{"operator_id": worker["id"], "sizes": {"S": 40}}]})
entry = r.json()["entries"][0]
made["entries"].append(entry["id"])

clerk_email = f"clerk-{tag}@example.com"
call(admin, "post", "/users", json={"email": clerk_email, "password": "ClerkPass!" + tag, "name": f"Clerk {tag}", "role": "data_entry"})
clerk = requests.Session()
call(clerk, "post", "/auth/login", json={"email": clerk_email, "password": "ClerkPass!" + tag})
clerk_id = call(clerk, "get", "/auth/me").json()["id"]


def get_entry(eid):
    rows = call(admin, "get", f"/production?lot_id={lot_id}").json()
    return next((x for x in rows if x["id"] == eid), None)


print("\n--- requesting a correction ---")
r = call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "miscount",
                                            "payload": {"size_quantities": {"S": 60}}})
check("a data-entry user can raise a request", r.status_code == 200 and r.json()["status"] == "pending", r.text[:200])
req_id = r.json()["id"]
check("duplicate pending request is refused",
      call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "again",
                                              "payload": {"size_quantities": {"S": 61}}}).status_code == 400)
check("a request that would exceed the plan is refused up front",
      call(clerk, "post", "/approvals", json={"type": "production_delete", "entity_id": "000000000000000000000000",
                                              "reason": "x"}).status_code == 404)
over = call(admin, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "too many",
                                               "payload": {"size_quantities": {"S": 150}}})
check("over-plan quantities are rejected at request time", over.status_code == 400 and "exceeds" in over.text, over.text[:200])
check("unknown approval type is refused",
      call(clerk, "post", "/approvals", json={"type": "nonsense", "entity_id": entry["id"]}).status_code == 400)

print("\n--- visibility and roles ---")
mine = call(clerk, "get", "/approvals").json()["items"]
check("clerk sees only their own requests", mine and all(x["requested_by"] == clerk_id for x in mine))
check("admin sees the pending request",
      any(x["id"] == req_id for x in call(admin, "get", "/approvals?status=pending").json()["items"]))
check("pending count for admin includes it", call(admin, "get", "/approvals/pending-count").json()["count"] >= 1)
check("clerk cannot approve", call(clerk, "post", f"/approvals/{req_id}/approve").status_code == 403)
check("clerk cannot read policies", call(clerk, "get", "/approvals/policies").status_code == 403)
check("admin was notified",
      any("asks" in n["message"] for n in call(admin, "get", "/notifications").json()))

print("\n--- approving applies the change server-side ---")
r = call(admin, "post", f"/approvals/{req_id}/approve", json={"note": "ok"})
check("approve succeeds", r.status_code == 200 and r.json()["status"] == "approved", r.text[:200])
e = get_entry(entry["id"])
check("quantity was applied", e and e["total_quantity"] == 60, str(e)[:200])
check("earnings were recomputed from the stored rate (60 x 2.50)", e and e["total_earnings"] == 150.0, str(e)[:200])
check("edit history records the approval",
      e and e.get("edit_history") and e["edit_history"][-1].get("source") == "approval")
again = call(admin, "post", f"/approvals/{req_id}/approve")
check("approving twice is a no-op", again.status_code == 200 and get_entry(entry["id"])["total_quantity"] == 60)
check("requester is told the outcome",
      any("Approved" in n["message"] for n in call(clerk, "get", "/notifications").json()))
audit = call(admin, "get", "/audit-logs", params={"action": "approvals.approve", "entity_id": req_id}).json()["items"]
applied_row = next((a for a in audit if a.get("before")), None)       # the repeat approve was a no-op
check("approval decision is in the audit log with before/after",
      applied_row and applied_row["after"] and applied_row["approval_id"] == req_id, str(audit)[:300])

print("\n--- stale and rejected requests ---")
r = call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "again",
                                            "payload": {"size_quantities": {"S": 55}}})
stale_id = r.json()["id"]
call(admin, "put", f"/production/{entry['id']}", json={"size_quantities": {"S": 50}, "reason": "admin fixed it"})
r = call(admin, "post", f"/approvals/{stale_id}/approve")
check("request is expired if the entry changed meanwhile", r.status_code == 409, r.text[:200])
check("expired request did not touch the entry", get_entry(entry["id"])["total_quantity"] == 50)
check("status is expired", next(x for x in call(admin, "get", "/approvals?status=expired").json()["items"] if x["id"] == stale_id))

r = call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "r",
                                            "payload": {"size_quantities": {"S": 45}}})
rej_id = r.json()["id"]
check("rejecting needs a note", call(admin, "post", f"/approvals/{rej_id}/reject", json={"note": ""}).status_code == 400)
check("reject with a note works", call(admin, "post", f"/approvals/{rej_id}/reject", json={"note": "not needed"}).json()["status"] == "rejected")
check("rejected request changed nothing", get_entry(entry["id"])["total_quantity"] == 50)
r = call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "r",
                                            "payload": {"size_quantities": {"S": 45}}})
check("requester can cancel their own", call(clerk, "post", f"/approvals/{r.json()['id']}/cancel").json()["status"] == "cancelled")

print("\n--- two admins clicking at once ---")
r = call(clerk, "post", "/approvals", json={"type": "production_edit", "entity_id": entry["id"], "reason": "race",
                                            "payload": {"size_quantities": {"S": 70}}})
race_id = r.json()["id"]
codes = []
def fire():
    codes.append(call(admin, "post", f"/approvals/{race_id}/approve").status_code)
ts = [threading.Thread(target=fire) for _ in range(4)]
[t.start() for t in ts]; [t.join() for t in ts]
hist = get_entry(entry["id"]).get("edit_history", [])
check("concurrent approves apply the change exactly once",
      sum(1 for h in hist if h.get("approval_id") == race_id) == 1, f"codes={codes} history={len(hist)}")

print("\n--- delete request ---")
r = call(clerk, "post", "/approvals", json={"type": "production_delete", "entity_id": entry["id"], "reason": "duplicate"})
del_id = r.json()["id"]
call(admin, "post", f"/approvals/{del_id}/approve")
check("approved delete removes the entry", get_entry(entry["id"]) is None)
made["entries"].remove(entry["id"])

print("\n--- policies ---")
pol = call(admin, "get", "/approvals/policies").json()
check("owner-confirmed policies are on by default",
      all(pol["policies"][k] for k in ("production_edit", "production_delete", "lot_edit_after_production",
                                         "lot_reopen", "stock_adjustment", "po_release", "expense_over_limit")))
check("advance and carry-forward policies ship off",
      not pol["policies"]["advance_over_limit"] and not pol["policies"]["fy_carry_forward"])
call(admin, "put", "/approvals/policies", json={"policies": {"production_edit": False}})
r = call(admin, "post", "/approvals", json={"type": "production_edit", "entity_id": "x", "payload": {}})
check("a switched-off policy refuses new requests", r.status_code == 400 and "switched off" in r.text, r.text[:160])
call(admin, "put", "/approvals/policies", json={"policies": {"production_edit": True}})
check("unknown policy name is refused",
      call(admin, "put", "/approvals/policies", json={"policies": {"made_up": True}}).status_code == 400)

print("\n--- legacy requests are carried over ---")
r = call(clerk, "post", "/edit-requests", json={"entry_type": "production", "entry_id": "000000000000000000000001",
                                                "reason": "old style", "proposed_changes": {}})
legacy = r.json()["id"]
items = call(admin, "get", "/approvals?page_size=100").json()["items"]
check("an old-style request shows up in approvals as expired (it carried no quantities)",
      any(x.get("legacy_id") == legacy and x["status"] == "expired" for x in items))

print("\n--- lot edits after production ---")
r = call(admin, "post", "/production/batch", json={
    "week_id": week["id"], "lot_id": lot_id, "operation_id": op["id"], "color": color["name"],
    "date": today.strftime("%Y-%m-%d"), "entries": [{"operator_id": worker["id"], "sizes": {"S": 40}}]})
made["entries"].append(r.json()["entries"][0]["id"])
cn = color["name"]
base ={"color_size_quantities": {cn: {"S": "100", "M": "0"}}}
before_ids = [c["color_id"] for c in call(admin, "get", f"/lots/{lot_id}").json()["colors"]]
r = call(admin, "put", f"/lots/{lot_id}", json={"color_size_quantities": {cn: {"S": "30", "M": "0"}}})
check("cannot plan below what is already produced", r.status_code == 400 and "already produced" in r.text, r.text[:200])
r = call(admin, "put", f"/lots/{lot_id}", json={"color_size_quantities": {"Other": {"S": "10"}}})
check("cannot drop a colour that has production", r.status_code == 400 and "cannot be removed" in r.text, r.text[:200])
r = call(admin, "put", f"/lots/{lot_id}", json={"operations": [{"operation_id": op2["id"], "rate": 1, "operator_ids": []}]})
check("cannot drop an operation that has production", r.status_code == 400 and "cannot be removed" in r.text, r.text[:200])
r = call(admin, "put", f"/lots/{lot_id}", json={**base, "style_name": "Renamed"})
check("a harmless edit still works", r.status_code == 200)
after_ids = [c["color_id"] for c in call(admin, "get", f"/lots/{lot_id}").json()["colors"]]
check("colour ids survive an edit", before_ids == after_ids, f"{before_ids} vs {after_ids}")
r = call(admin, "put", f"/lots/{lot_id}", json={"operations": [{"operation_id": op["id"], "rate": 3.0, "operator_ids": [worker["id"]]}]})
check("a rate change after production is allowed", r.status_code == 200)
recs = call(admin, "get", "/approvals?type=rate_change").json()["items"]
check("...and recorded as an auto-approved rate_change", any(x["entity_id"] == lot_id and x["auto"] for x in recs))
recs = call(admin, "get", "/approvals?type=lot_edit_after_production").json()["items"]
check("...a plan change is recorded too",
      call(admin, "put", f"/lots/{lot_id}", json={"color_size_quantities": {cn: {"S": "120", "M": "0"}}}).status_code == 200
      and any(x["entity_id"] == lot_id for x in call(admin, "get", "/approvals?type=lot_edit_after_production").json()["items"]))
call(admin, "post", f"/lots/{lot_id}/close", json={"reason": "t"})
call(admin, "post", f"/lots/{lot_id}/reopen", json={"reason": "test reopen"})
check("reopening a lot is recorded as an auto-approved lot_reopen",
      any(x["entity_id"] == lot_id for x in call(admin, "get", "/approvals?type=lot_reopen").json()["items"]))

print("\n--- cleanup ---")
for eid in made["entries"]:
    call(admin, "delete", f"/production/{eid}")
call(admin, "delete", f"/lots/{lot_id}")
for path, obj in (("/weeks", week), ("/colors", color), ("/size-charts", chart), ("/operators", worker),
                  ("/operations", op), ("/operations", op2)):
    call(admin, "delete", f"{path}/{obj['id']}")
for u in call(admin, "get", "/users").json():
    if u["email"] == clerk_email:
        call(admin, "delete", f"/users/{u['id']}")
print("  removed fixtures (approvals and audit rows are kept by design)")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
