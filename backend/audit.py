"""Central, append-only activity log.

Coverage is structural: a middleware records every successful POST/PUT/DELETE
under /api (and permission refusals), so a route added later is logged without
anyone remembering to. Routes enrich their entry with `note(...)` when they know
the before/after values or a human label. There is deliberately no route that
updates or deletes an entry, and `reset_all_data` does not clear this collection.
"""
import csv
import io
import re
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from core import (db, datetime, timezone, check_role, get_current_user, logger,
                  serialize_doc)

router = APIRouter(prefix="/api")

_SENSITIVE = ("password", "token", "hash", "secret")
_VERBS = {"POST": "create", "PUT": "update", "PATCH": "update", "DELETE": "delete"}
# Paths that are not business actions: auth has its own explicit events, the
# public enquiry form is stored in its own collection.
_SKIP_PREFIXES = ("/api/auth/", "/api/public/")


def scrub(value, depth=0):
    """Drop secrets and cap size so a log row can never leak or balloon."""
    if depth > 4:
        return "…"
    if isinstance(value, dict):
        return {k: scrub(v, depth + 1) for k, v in value.items()
                if not any(s in str(k).lower() for s in _SENSITIVE)}
    if isinstance(value, (list, tuple)):
        return [scrub(v, depth + 1) for v in list(value)[:50]]
    if isinstance(value, str):
        return value if len(value) <= 500 else value[:500] + "…"
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    return str(value)[:200]


def note(request: Request, *, entity_type=None, entity_id=None, label=None,
         summary=None, before=None, after=None, approval_id=None):
    """Attach detail to the entry the middleware will write for this request."""
    extra = getattr(request.state, "audit", {}) or {}
    for key, val in (("entity_type", entity_type), ("entity_id", entity_id), ("entity_label", label),
                     ("summary", summary), ("before", before), ("after", after),
                     ("approval_id", approval_id)):
        if val is not None:
            extra[key] = val
    request.state.audit = extra


async def log_event(request: Optional[Request], action: str, *, user=None, entity_type="",
                    entity_id="", label="", summary="", before=None, after=None,
                    approval_id=None, outcome="ok"):
    """Write one audit row. Never raises: the action has already happened, and a
    logging failure must not turn a successful payroll write into a 500."""
    try:
        ip = request.client.host if request is not None and request.client else ""
        doc = {
            "at": datetime.now(timezone.utc).isoformat(),
            "user_id": (user or {}).get("id", ""), "user_name": (user or {}).get("name", ""),
            "role": (user or {}).get("role", ""), "ip": ip, "action": action, "outcome": outcome,
            "entity_type": entity_type or "", "entity_id": str(entity_id or ""),
            "entity_label": label or "", "summary": summary or "",
            "before": scrub(before) if before is not None else None,
            "after": scrub(after) if after is not None else None,
            "approval_id": approval_id,
        }
        await db.audit_logs.insert_one(doc)
    except Exception:  # pragma: no cover
        logger.exception("audit log write failed for %s", action)


def _action_from_route(request: Request):
    route = request.scope.get("route")
    template = getattr(route, "path", None) or request.url.path
    parts = [p for p in template.split("/") if p][1:]            # drop "api"
    static = [p for p in parts if not p.startswith("{")]
    if not static:
        return None, "", ""
    resource = static[0]
    sub = ".".join(static[1:]) or _VERBS.get(request.method, request.method.lower())
    param_values = request.scope.get("path_params", {}) or {}
    entity_id = next(iter(param_values.values()), "") if param_values else ""
    return f"{resource}.{sub}", resource, str(entity_id)


async def audit_middleware(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if (request.method in _VERBS and path.startswith("/api/")
            and not path.startswith(_SKIP_PREFIXES)):
        user = getattr(request.state, "user", None)
        status = response.status_code
        if user and (status < 400 or status == 403):
            action, resource, entity_id = _action_from_route(request)
            if action:
                extra = getattr(request.state, "audit", {}) or {}
                outcome = "ok" if status < 400 else "denied"
                await log_event(
                    request, action, user=user, outcome=outcome,
                    entity_type=extra.get("entity_type", resource),
                    entity_id=extra.get("entity_id", entity_id),
                    label=extra.get("entity_label", ""),
                    summary=extra.get("summary") or f"{request.method} {path} -> {status}",
                    before=extra.get("before"), after=extra.get("after"),
                    approval_id=extra.get("approval_id"))
    return response


def _query(user=None, action=None, entity_type=None, entity_id=None,
           date_from=None, date_to=None, q=None, outcome=None):
    query = {}
    if user:
        query["$or"] = [{"user_id": user}, {"user_name": {"$regex": re.escape(user), "$options": "i"}}]
    if action:
        query["action"] = {"$regex": "^" + re.escape(action)}
    if entity_type:
        query["entity_type"] = entity_type
    if entity_id:
        query["entity_id"] = entity_id
    if outcome:
        query["outcome"] = outcome
    if date_from or date_to:
        rng = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to + "T23:59:59.999999+00:00"
        query["at"] = rng
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$and"] = [{"$or": [{"summary": rx}, {"entity_label": rx}, {"user_name": rx}, {"action": rx}]}]
    return query


@router.get("/audit-logs")
async def list_audit_logs(request: Request, user: Optional[str] = None, action: Optional[str] = None,
                          entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                          date_from: Optional[str] = None, date_to: Optional[str] = None,
                          q: Optional[str] = None, outcome: Optional[str] = None,
                          page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    me = await get_current_user(request)
    check_role(me, ["admin"])
    query = _query(user, action, entity_type, entity_id, date_from, date_to, q, outcome)
    total = await db.audit_logs.count_documents(query)
    rows = await (db.audit_logs.find(query).sort("at", -1)
                  .skip((page - 1) * page_size).limit(page_size).to_list(page_size))
    return {"items": [serialize_doc(r) for r in rows], "total": total, "page": page,
            "pages": max(1, -(-total // page_size))}


@router.get("/audit-logs/export")
async def export_audit_logs(request: Request, user: Optional[str] = None, action: Optional[str] = None,
                            entity_type: Optional[str] = None, entity_id: Optional[str] = None,
                            date_from: Optional[str] = None, date_to: Optional[str] = None,
                            q: Optional[str] = None, outcome: Optional[str] = None):
    me = await get_current_user(request)
    check_role(me, ["admin"])
    query = _query(user, action, entity_type, entity_id, date_from, date_to, q, outcome)
    rows = await db.audit_logs.find(query).sort("at", -1).to_list(20000)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["When (UTC)", "User", "Role", "Action", "Outcome", "Entity", "Entity id",
                     "Label", "Summary", "IP"])
    for r in rows:
        # a leading = + - @ would make Excel run the cell as a formula
        cells = [r.get("at", ""), r.get("user_name", ""), r.get("role", ""), r.get("action", ""),
                 r.get("outcome", ""), r.get("entity_type", ""), r.get("entity_id", ""),
                 r.get("entity_label", ""), r.get("summary", ""), r.get("ip", "")]
        writer.writerow([("'" + c) if isinstance(c, str) and c[:1] in "=+-@" else c for c in cells])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=activity_log.csv"})
