"""
Checks for operator groups and operation groups (Phase 2).

Needs the API running on :8000. Creates throwaway records and removes them.

    backend\\.venv\\Scripts\\python.exe backend\\test_groups.py
"""
import os
import sys
import uuid
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

print("--- group master data ---")
g1 = call(admin, "post", "/operation-groups", json={"name": f"Stitching {tag}", "sort_order": 2}).json()
check("operation group created", "id" in g1 and g1["member_count"] == 0, str(g1))
dup = call(admin, "post", "/operation-groups", json={"name": f"STITCHING {tag}"})
check("duplicate name is refused case-insensitively", dup.status_code == 400)
check("blank name is refused", call(admin, "post", "/operation-groups", json={"name": ""}).status_code == 422)
tg = call(admin, "post", "/operator-groups", json={"name": f"Line A {tag}"}).json()
check("operator group created", "id" in tg)
listed = call(admin, "get", "/operation-groups").json()
check("list shows it", any(g["id"] == g1["id"] for g in listed))

print("\n--- assigning members ---")
op = call(admin, "post", "/operations", json={"name": f"GOp {tag}", "group_id": g1["id"]}).json()
check("operation can be created inside a group", op["group_id"] == g1["id"] and op["group_name"] == f"Stitching {tag}", str(op))
plain = call(admin, "post", "/operations", json={"name": f"GPlain {tag}"}).json()
check("an operation without a group still works", plain.get("group_id") == "")
w1 = call(admin, "post", "/operators", json={"name": f"GW1 {tag}", "group_id": tg["id"]}).json()
w2 = call(admin, "post", "/operators", json={"name": f"GW2 {tag}"}).json()
check("operator created in a group", w1["group_name"] == f"Line A {tag}")
r = call(admin, "post", "/operators/assign-group", json={"ids": [w2["id"]], "group_id": tg["id"]})
check("bulk assign moves operators", r.status_code == 200 and r.json()["updated"] == 1, r.text[:150])
check("bad group id is refused",
      call(admin, "post", "/operators/assign-group", json={"ids": [w2["id"]], "group_id": "000000000000000000000000"}).status_code == 400)
ops = {o["id"]: o for o in call(admin, "get", "/operators").json()}
check("operator list carries group names", ops[w2["id"]]["group_name"] == f"Line A {tag}")
r = call(admin, "put", f"/operations/{plain['id']}", json={"group_id": g1["id"]})
check("operation group can be set later", r.status_code == 200 and r.json()["group_name"] == f"Stitching {tag}")
r = call(admin, "put", f"/operations/{plain['id']}", json={"group_id": ""})
check("...and cleared with an empty id", r.json()["group_id"] == "" and r.json()["group_name"] == "")
check("member counts are reported",
      next(g for g in call(admin, "get", "/operator-groups").json() if g["id"] == tg["id"])["member_count"] == 2)

print("\n--- groups in use cannot disappear ---")
r = call(admin, "delete", f"/operator-groups/{tg['id']}")
check("delete is refused while operators belong to it", r.status_code == 400 and "still belong" in r.text, r.text[:160])

print("\n--- history is a snapshot ---")
chart = call(admin, "post", "/size-charts", json={"name": f"GChart {tag}", "sizes": ["S"]}).json()
color = call(admin, "post", "/colors", json={"name": f"GColor {tag}"}).json()
today = datetime.now()
week = call(admin, "post", "/weeks", json={"week_number": 700 + int(tag[:2], 16) % 90, "year": 2026,
                                           "start_date": (today - timedelta(days=3)).strftime("%Y-%m-%d"),
                                           "end_date": (today + timedelta(days=3)).strftime("%Y-%m-%d")}).json()
lot = call(admin, "post", "/lots", json={
    "style_name": f"GStyle {tag}", "start_date": today.strftime("%Y-%m-%d"),
    "target_end_date": (today + timedelta(days=9)).strftime("%Y-%m-%d"), "size_chart_id": chart["id"],
    "color_names": [color["name"]], "color_size_quantities": {color["name"]: {"S": "50"}},
    "operations": [{"operation_id": op["id"], "rate": 2.0, "operator_ids": [w1["id"]]}]}).json()
check("the lot's operation remembers its group", lot["operations"][0]["group_name"] == f"Stitching {tag}")
r = call(admin, "post", "/production/batch", json={
    "week_id": week["id"], "lot_id": lot["id"], "operation_id": op["id"], "color": color["name"],
    "date": today.strftime("%Y-%m-%d"), "entries": [{"operator_id": w1["id"], "sizes": {"S": 10}}]}).json()
e = r["entries"][0]
check("entry copies both group names", e["operation_group"] == f"Stitching {tag}" and e["operator_group"] == f"Line A {tag}", str(e)[:250])
call(admin, "put", f"/operation-groups/{g1['id']}", json={"name": f"Sewing {tag}"})
check("renaming updates the master record",
      next(o for o in call(admin, "get", "/operations").json() if o["id"] == op["id"])["group_name"] == f"Sewing {tag}")
kept = next(x for x in call(admin, "get", f"/production?lot_id={lot['id']}").json() if x["id"] == e["id"])
check("renaming does not rewrite recorded production", kept["operation_group"] == f"Stitching {tag}")
rep = call(admin, "get", "/reports/weekly-production", params={"week": week["week_number"], "year": 2026}).json()
check("weekly report has group subtotals", any(g["name"] == f"Stitching {tag}" and g["qty"] == 10 for g in rep["by_group"]), str(rep.get("by_group")))
dash = call(admin, "get", "/dashboard/summary").json()
check("dashboard exposes group breakdowns", "operation_group_stats" in dash and "operator_group_stats" in dash)

print("\n--- access ---")
call(admin, "post", "/users", json={"email": f"g-{tag}@example.com", "password": "GPass!" + tag, "name": "G Clerk", "role": "data_entry"})
clerk = requests.Session()
call(clerk, "post", "/auth/login", json={"email": f"g-{tag}@example.com", "password": "GPass!" + tag})
check("non-admin can read groups", call(clerk, "get", "/operator-groups").status_code == 200)
check("non-admin cannot create a group", call(clerk, "post", "/operator-groups", json={"name": "x"}).status_code == 403)
check("non-admin cannot assign groups",
      call(clerk, "post", "/operators/assign-group", json={"ids": [w1["id"]], "group_id": ""}).status_code == 403)
check("group changes are in the audit log",
      call(admin, "get", "/audit-logs", params={"entity_type": "operation_group", "entity_id": g1["id"]}).json()["total"] >= 1)

print("\n--- cleanup ---")
call(admin, "delete", f"/production/{e['id']}")
call(admin, "delete", f"/lots/{lot['id']}")
for path, obj in (("/weeks", week), ("/colors", color), ("/size-charts", chart), ("/operators", w1), ("/operators", w2),
                  ("/operations", op), ("/operations", plain)):
    call(admin, "delete", f"{path}/{obj['id']}")
check("groups can be deleted once empty",
      call(admin, "delete", f"/operator-groups/{tg['id']}").status_code == 200
      and call(admin, "delete", f"/operation-groups/{g1['id']}").status_code == 200)
for u in call(admin, "get", "/users").json():
    if u["email"] == f"g-{tag}@example.com":
        call(admin, "delete", f"/users/{u['id']}")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
