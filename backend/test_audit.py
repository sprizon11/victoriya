"""
Checks for the central audit log (Phase 2).

Needs the API running on :8000.  Creates throwaway records and removes them.

    backend\\.venv\\Scripts\\python.exe backend\\test_audit.py
"""
import os
import sys
import uuid
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


def sess():
    return requests.Session()


def call(s, method, path, **kw):
    return s.request(method, f"{BASE}/api{path}", timeout=30, **kw)


def logs(s, **params):
    r = call(s, "get", "/audit-logs", params=params)
    return r.json() if r.status_code == 200 else {"items": [], "total": 0}


tag = uuid.uuid4().hex[:6]
admin = sess()
r = call(admin, "post", "/auth/login", json={"email": "no-such-user-" + tag + "@example.com", "password": "x"})
check("failed login rejected", r.status_code == 401)
r = call(admin, "post", "/auth/login", json={"email": EMAIL, "password": PASSWORD})
if r.status_code != 200:
    print("cannot log in; is the API running?")
    sys.exit(1)

print("\n--- auth events ---")
failed_login = logs(admin, action="auth.login_failed", q="no-such-user-" + tag)
check("failed login is logged as denied", failed_login["total"] >= 1
      and failed_login["items"][0]["outcome"] == "denied")
check("successful login is logged", logs(admin, action="auth.login", user=EMAIL)["total"] >= 1
      or logs(admin, action="auth.login")["total"] >= 1)

print("\n--- every mutation is logged ---")
r = call(admin, "post", "/operations", json={"name": f"AuditOp {tag}"})
op_id = r.json()["id"]
rows = logs(admin, action="operations.create", entity_id=op_id)
check("create is logged with user and role",
      rows["total"] == 1 and rows["items"][0]["user_name"] == "Admin" and rows["items"][0]["role"] == "admin",
      str(rows)[:200])
call(admin, "put", f"/operations/{op_id}", json={"name": f"AuditOp {tag} v2"})
upd = logs(admin, action="operations.update", entity_id=op_id)["items"]
check("update is logged with before/after",
      upd and upd[0]["before"] == {"name": f"AuditOp {tag}"} and upd[0]["after"] == {"name": f"AuditOp {tag} v2"},
      str(upd)[:300])
call(admin, "delete", f"/operations/{op_id}")
dele = logs(admin, action="operations.delete", entity_id=op_id)["items"]
check("delete is logged and remembers the name",
      dele and f"AuditOp {tag} v2" in dele[0]["entity_label"], str(dele)[:200])

print("\n--- secrets never reach the log ---")
u = call(admin, "post", "/users", json={"email": f"audit-{tag}@example.com", "password": "Sup3rSecret!" + tag,
                                         "name": "Audit Tester", "role": "data_entry"}).json()
call(admin, "post", f"/users/{u['id']}/change-password", json={"new_password": "An0therSecret!" + tag})
blob = str(logs(admin, entity_type="users", page_size=100)) + str(logs(admin, entity_type="user", page_size=100))
check("no password text appears in any user-related entry",
      "Sup3rSecret" not in blob and "An0therSecret" not in blob and "password_hash" not in blob)
check("password change is logged without its value",
      logs(admin, action="users.change-password", entity_id=u["id"])["total"] == 1)

print("\n--- access and integrity ---")
de = sess()
call(de, "post", "/auth/login", json={"email": f"audit-{tag}@example.com", "password": "An0therSecret!" + tag})
check("non-admin cannot read the log", call(de, "get", "/audit-logs").status_code == 403)
check("non-admin cannot export the log", call(de, "get", "/audit-logs/export").status_code == 403)
denied = call(de, "post", "/operations", json={"name": "nope"})
check("non-admin mutation is refused", denied.status_code == 403)
check("refused attempt is itself logged as denied",
      logs(admin, action="operations.create", outcome="denied")["total"] >= 1)
check("no route can alter or remove an entry",
      call(admin, "put", "/audit-logs/abc", json={}).status_code in (404, 405)
      and call(admin, "delete", "/audit-logs/abc").status_code in (404, 405))

print("\n--- query features ---")
page1 = logs(admin, page=1, page_size=2)
check("pagination returns page_size rows and a page count",
      len(page1["items"]) == 2 and page1["pages"] >= 1 and page1["total"] >= 2)
check("page_size above the cap is rejected", call(admin, "get", "/audit-logs?page_size=1000").status_code == 422)
newest_first = [x["at"] for x in logs(admin, page_size=20)["items"]]
check("newest first", newest_first == sorted(newest_first, reverse=True))
csv = call(admin, "get", "/audit-logs/export", params={"q": tag})
check("CSV export works and contains rows",
      csv.status_code == 200 and csv.headers["content-type"].startswith("text/csv") and tag in csv.text)

print("\n--- cleanup ---")
call(admin, "delete", f"/users/{u['id']}")
print("  removed test user (audit rows are kept by design)")

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
