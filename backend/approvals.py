"""Maker-checker approvals.

A request records *what will change*; approving it re-runs the normal validation
and applies the change server-side. A client payload is never `$set` straight
into a payroll record (that was the bug in the old edit-request flow).

Feature code registers a `prepare` (validate the request, compute a label and a
snapshot of the thing being changed) and an `apply` (do it) per approval type, so
this module needs nothing from server.py and later phases just call `register`.
"""
import json
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core import (db, ObjectId, datetime, timezone, get_current_user, check_role,
                  serialize_doc, logger)
from audit import note

router = APIRouter(prefix="/api")

# default = approval required. The owner confirmed the first seven; the last two
# are available but ship off.
POLICY_DEFAULTS = {
    "production_edit": True, "production_delete": True, "lot_edit_after_production": True,
    "lot_reopen": True, "stock_adjustment": True, "po_release": True, "expense_over_limit": True,
    "quantity_override": True, "rate_change": True,
    "advance_over_limit": False, "fy_carry_forward": False,
}
POLICY_LABELS = {
    "production_edit": "Correct a production entry", "production_delete": "Delete a production entry",
    "lot_edit_after_production": "Edit a lot after production started", "lot_reopen": "Reopen a closed lot",
    "stock_adjustment": "Manual stock adjustment", "po_release": "Release a purchase order",
    "expense_over_limit": "Expense above the limit", "quantity_override": "Produce beyond the plan",
    "rate_change": "Change a rate on a lot with production", "advance_over_limit": "Advance above the limit",
    "fy_carry_forward": "Carry a lot into the new financial year",
}
HANDLERS = {}


class ApprovalExpired(Exception):
    """The thing being changed is no longer what was requested."""


def register(type_, *, prepare=None, apply=None):
    """prepare(user, entity_id, payload) -> (label, clean_payload, snapshot)
    apply(approval, reviewer, request) -> dict describing what was applied"""
    HANDLERS[type_] = {"prepare": prepare, "apply": apply}


async def policies():
    doc = await db.system_settings.find_one({"key": "approval_policies"})
    try:
        stored = json.loads(doc["value"]) if doc else {}
    except (ValueError, TypeError, KeyError):
        stored = {}
    return {k: bool(stored.get(k, d)) for k, d in POLICY_DEFAULTS.items()}


async def second_approver_required():
    doc = await db.system_settings.find_one({"key": "require_second_approver"})
    return bool(doc) and str(doc.get("value", "")).lower() in ("1", "true", "yes")


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _notify(audience, message, approval_id):
    await db.notifications.insert_one({"type": "approval", "approval_id": str(approval_id), "audience": audience,
                                       "message": message, "read": False, "created_at": _now()})


async def record_auto(request, user, type_, entity_type, entity_id, label, summary, before=None, after=None,
                      reason=""):
    """An admin acting directly on something that has a policy: no second person
    exists to ask, so the approval is recorded as auto-approved. This keeps one
    consistent history of every sensitive action. Returns the approval id (or
    None when that policy is switched off)."""
    if not (await policies()).get(type_):
        return None
    doc = {"type": type_, "entity_type": entity_type, "entity_id": str(entity_id), "entity_label": label,
           "summary": summary, "payload": {"before": before, "after": after}, "reason": reason,
           "status": "approved", "auto": True, "requested_by": user["id"], "requested_by_name": user.get("name", ""),
           "requested_at": _now(), "reviewed_by": user["id"], "reviewed_by_name": user.get("name", ""),
           "reviewed_at": _now(), "applied_at": _now(), "review_note": "Auto-approved: performed by an administrator"}
    res = await db.approvals.insert_one(doc)
    return str(res.inserted_id)


class ApprovalCreate(BaseModel):
    type: str
    entity_id: str
    reason: str = Field(default="", max_length=500)
    payload: dict = Field(default_factory=dict)


class Decision(BaseModel):
    note: str = Field(default="", max_length=500)


class PolicyUpdate(BaseModel):
    policies: dict
    require_second_approver: Optional[bool] = None


async def create_request(request: Request, user: dict, type_: str, entity_id: str, reason: str, payload: dict):
    handler = HANDLERS.get(type_)
    if not handler or not handler["prepare"]:
        raise HTTPException(400, "This kind of request cannot be raised by users")
    if not (await policies()).get(type_):
        raise HTTPException(400, f"Approval for '{POLICY_LABELS.get(type_, type_)}' is switched off. "
                                 "Ask an administrator to make the change directly.")
    dup = await db.approvals.find_one({"type": type_, "entity_id": entity_id, "status": "pending",
                                       "requested_by": user["id"]})
    if dup:
        raise HTTPException(400, "You already have a pending request for this item")
    label, clean, snapshot = await handler["prepare"](user, entity_id, payload)
    doc = {"type": type_, "entity_type": type_.split("_")[0], "entity_id": entity_id, "entity_label": label,
           "payload": clean, "snapshot": snapshot, "reason": reason, "status": "pending", "auto": False,
           "requested_by": user["id"], "requested_by_name": user.get("name", ""), "requested_at": _now(),
           "reviewed_by": None, "reviewed_by_name": None, "reviewed_at": None, "review_note": "",
           "applied_at": None, "apply_error": ""}
    res = await db.approvals.insert_one(doc)
    aid = str(res.inserted_id)
    await _notify("admin", f"{user.get('name', 'Someone')} asks: {POLICY_LABELS.get(type_, type_)} — {label}", aid)
    note(request, entity_type="approval", entity_id=aid, label=label, approval_id=aid,
         summary=f"Requested approval: {POLICY_LABELS.get(type_, type_)} ({label})")
    doc["id"] = aid
    doc.pop("_id", None)
    return doc


@router.get("/approvals/policies")
async def get_policies(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    return {"policies": await policies(), "labels": POLICY_LABELS,
            "require_second_approver": await second_approver_required()}


@router.put("/approvals/policies")
async def put_policies(data: PolicyUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    unknown = [k for k in data.policies if k not in POLICY_DEFAULTS]
    if unknown:
        raise HTTPException(400, f"Unknown approval type: {', '.join(unknown)}")
    before = await policies()
    merged = {**before, **{k: bool(v) for k, v in data.policies.items()}}
    await db.system_settings.update_one({"key": "approval_policies"}, {"$set": {"value": json.dumps(merged)}}, upsert=True)
    if data.require_second_approver is not None:
        await db.system_settings.update_one({"key": "require_second_approver"},
                                            {"$set": {"value": "true" if data.require_second_approver else "false"}}, upsert=True)
    note(request, entity_type="setting", entity_id="approval_policies", label="Approval policies",
         summary="Changed approval policies", before=before, after=merged)
    return {"policies": merged, "require_second_approver": await second_approver_required()}


@router.get("/approvals/pending-count")
async def pending_count(request: Request):
    user = await get_current_user(request)
    q = {"status": "pending"}
    if user["role"] != "admin":
        q["requested_by"] = user["id"]
    return {"count": await db.approvals.count_documents(q)}


@router.get("/approvals")
async def list_approvals(request: Request, status: Optional[str] = None, type: Optional[str] = None,
                         mine: bool = False, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100)):
    user = await get_current_user(request)
    await migrate_legacy_edit_requests()      # one-release overlap with the old endpoints
    q = {}
    if status:
        q["status"] = status
    if type:
        q["type"] = type
    if mine or user["role"] != "admin":
        q["requested_by"] = user["id"]
    total = await db.approvals.count_documents(q)
    rows = await db.approvals.find(q).sort("requested_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [serialize_doc(r) for r in rows], "total": total, "page": page,
            "pages": max(1, -(-total // page_size)), "labels": POLICY_LABELS}


@router.post("/approvals")
async def post_approval(data: ApprovalCreate, request: Request):
    user = await get_current_user(request)
    return await create_request(request, user, data.type, data.entity_id, data.reason, data.payload)


@router.post("/approvals/{approval_id}/cancel")
async def cancel_approval(approval_id: str, request: Request):
    user = await get_current_user(request)
    if not ObjectId.is_valid(approval_id):
        raise HTTPException(404, "Approval not found")
    doc = await db.approvals.find_one({"_id": ObjectId(approval_id)})
    if not doc:
        raise HTTPException(404, "Approval not found")
    if doc["requested_by"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Only the requester can cancel this")
    res = await db.approvals.update_one({"_id": ObjectId(approval_id), "status": "pending"},
                                        {"$set": {"status": "cancelled", "reviewed_at": _now(),
                                                  "reviewed_by": user["id"], "reviewed_by_name": user.get("name", "")}})
    if not res.modified_count:
        raise HTTPException(400, f"This request is already {doc['status']}")
    note(request, entity_type="approval", entity_id=approval_id, label=doc.get("entity_label", ""),
         approval_id=approval_id, summary="Cancelled approval request")
    return {"status": "cancelled"}


async def _decide(approval_id: str, action: str, data: Decision, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if not ObjectId.is_valid(approval_id):
        raise HTTPException(404, "Approval not found")
    oid = ObjectId(approval_id)
    doc = await db.approvals.find_one({"_id": oid})
    if not doc:
        raise HTTPException(404, "Approval not found")
    wanted = "approved" if action == "approve" else "rejected"
    if doc["status"] == wanted:
        return {"status": wanted, "message": "Already decided"}          # idempotent
    if doc["status"] != "pending":
        raise HTTPException(400, f"This request is already {doc['status']}")
    if action == "reject" and not data.note.strip():
        raise HTTPException(400, "A note is required to reject a request")
    if action == "approve" and doc["requested_by"] == user["id"] and await second_approver_required():
        raise HTTPException(403, "A different administrator must approve this request")

    # atomic claim: two admins clicking at once must not apply the change twice
    claimed = await db.approvals.find_one_and_update({"_id": oid, "status": "pending"},
                                                     {"$set": {"status": "applying"}})
    if not claimed:
        raise HTTPException(409, "Someone else just decided this request")

    label = POLICY_LABELS.get(doc["type"], doc["type"])
    update = {"reviewed_by": user["id"], "reviewed_by_name": user.get("name", ""), "reviewed_at": _now(),
              "review_note": data.note.strip()}
    result = None
    if action == "approve":
        handler = HANDLERS.get(doc["type"])
        try:
            if not handler or not handler["apply"]:
                raise HTTPException(400, "This kind of request cannot be applied automatically")
            result = await handler["apply"](doc, user, request)
            update.update(status="approved", applied_at=_now(), apply_error="")
        except ApprovalExpired as exc:
            update.update(status="expired", apply_error=str(exc))
        except HTTPException as exc:
            # leave it pending so it can be fixed or rejected; say why
            await db.approvals.update_one({"_id": oid}, {"$set": {"status": "pending", "apply_error": str(exc.detail)}})
            raise
        except Exception:
            await db.approvals.update_one({"_id": oid}, {"$set": {"status": "pending", "apply_error": "Unexpected error"}})
            logger.exception("approval apply failed")
            raise HTTPException(500, "Could not apply this change")
    else:
        update["status"] = "rejected"
    await db.approvals.update_one({"_id": oid}, {"$set": update})

    verb = {"approved": "Approved", "rejected": "Rejected", "expired": "Expired"}[update["status"]]
    res = result or {}
    note(request, entity_type="approval", entity_id=approval_id, label=doc.get("entity_label", ""), approval_id=approval_id,
         summary=f"{verb} request: {label} ({doc.get('entity_label', '')})",
         before=res.get("before"), after=res.get("after") or (res or None))
    await _notify(f"user:{doc['requested_by']}", f"{verb}: {label} — {doc.get('entity_label', '')}"
                  + (f" ({data.note.strip()})" if data.note.strip() else ""), approval_id)
    if update["status"] == "expired":
        raise HTTPException(409, update["apply_error"])
    return {"status": update["status"], "applied": result}


@router.post("/approvals/{approval_id}/approve")
async def approve(approval_id: str, request: Request, data: Decision = Decision()):
    return await _decide(approval_id, "approve", data, request)


@router.post("/approvals/{approval_id}/reject")
async def reject(approval_id: str, request: Request, data: Decision = Decision()):
    return await _decide(approval_id, "reject", data, request)


async def migrate_legacy_edit_requests():
    """Copy old edit_requests into approvals once (idempotent via legacy_id).
    The originals stay untouched. Requests that never carried proposed quantities
    could not be applied, so they are filed as expired instead of pending."""
    async for er in db.edit_requests.find({}):
        lid = str(er["_id"])
        if await db.approvals.find_one({"legacy_id": lid}):
            continue
        proposed = (er.get("proposed_changes") or {}).get("size_quantities")
        status = er.get("status", "pending")
        apply_error = ""
        if status == "pending" and not proposed:
            status, apply_error = "expired", "Submitted before requests carried the corrected quantities"
        await db.approvals.insert_one({
            "type": "production_edit", "entity_type": "production", "entity_id": er.get("entry_id", ""),
            "entity_label": "Production entry (legacy request)", "payload": {"size_quantities": proposed or {}},
            "snapshot": None, "reason": er.get("reason", ""), "status": status, "auto": False,
            "requested_by": er.get("requested_by", ""), "requested_by_name": er.get("requested_by_name", ""),
            "requested_at": er.get("created_at", _now()), "reviewed_by": er.get("reviewed_by"),
            "reviewed_by_name": er.get("reviewed_by_name"), "reviewed_at": er.get("reviewed_at"),
            "review_note": "", "applied_at": None, "apply_error": apply_error, "legacy_id": lid})
