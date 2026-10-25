"""Lot material requirements and purchase orders.

A lot lists what it needs (per piece or in total). The gross requirement adds the
lot's *post %* wastage buffer to the planned pieces; whatever the store and open
orders do not already cover is drafted into purchase orders. "Automatic" means
drafted, never sent: releasing a PO is an approval.
"""
import io
import math
from decimal import Decimal, ROUND_CEILING
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import (db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc, get_fy_suffix, COMPANY)
from audit import note
import approvals
from approvals import record_auto
from stock import (post_movement, MovementIn, all_balances, weighted_average_rate, _item, _supplier, EPS, r3)

router = APIRouter(prefix="/api")

COUNTED = ("pcs", "cone", "box", "roll")                # whole units: always round up
OPEN_STATUSES = ["approved", "sent", "partially_received"]


def _now():
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ requirements
class RequirementIn(BaseModel):
    item_id: str
    basis: str = "per_piece"                     # per_piece | total
    qty_per_piece: Optional[float] = Field(default=None, gt=0, le=100000)
    total_qty: Optional[float] = Field(default=None, gt=0, le=100000000)


def gross_requirement(planned_total: int, req: dict, post_pct: float, uom: str) -> float:
    """Planned pieces (which already carry the pre-% allowance) x quantity per piece,
    plus the post-% wastage buffer, rounded UP so the order never falls short:
    whole units for counted items, 3 decimals for metres and kilos.
    The post-% meaning lives here so it can change in one place."""
    base = (Decimal(str(req.get("qty_per_piece") or 0)) * Decimal(planned_total)
            if req.get("basis") == "per_piece" else Decimal(str(req.get("total_qty") or 0)))
    gross = base * (Decimal(100) + Decimal(str(post_pct or 0))) / Decimal(100)
    step = Decimal(1) if uom in COUNTED else Decimal("0.001")
    return float((gross / step).to_integral_value(rounding=ROUND_CEILING) * step)


async def build_requirements(raw: List[RequirementIn], planned_total: int, post_pct: float):
    out, seen = [], set()
    for r in raw:
        if r.item_id in seen:
            raise HTTPException(400, "Each item can only appear once in a lot's requirements")
        seen.add(r.item_id)
        item = await _item(r.item_id)
        if r.basis not in ("per_piece", "total"):
            raise HTTPException(400, "Basis must be per_piece or total")
        if r.basis == "per_piece" and not r.qty_per_piece:
            raise HTTPException(400, f"Enter the quantity per piece for {item['name']}")
        if r.basis == "total" and not r.total_qty:
            raise HTTPException(400, f"Enter the total quantity for {item['name']}")
        d = {"item_id": r.item_id, "item_name": item["name"], "uom": item["uom"], "uom2": item.get("uom2", ""),
             "basis": r.basis, "qty_per_piece": r.qty_per_piece if r.basis == "per_piece" else None,
             "total_qty": r.total_qty if r.basis == "total" else None}
        d["gross_qty"] = gross_requirement(planned_total, d, post_pct, item["uom"])
        out.append(d)
    return out


def lot_planned_total(lot) -> int:
    return sum(s["planned_qty"] for c in lot.get("colors", []) for s in c.get("sizes", []))


def clean_post_pct(value) -> float:
    try:
        pct = float(value or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Post % must be a number")
    if not 0 <= pct <= 50:
        raise HTTPException(400, "Post % must be between 0 and 50")
    return round(pct, 2)


# ------------------------------------------------------------------ PO helpers
async def next_po_number() -> str:
    fy = get_fy_suffix()
    res = await db.counters.find_one_and_update({"name": f"po_{fy}"}, {"$inc": {"value": 1}}, upsert=True, return_document=True)
    return f"PO{res['value']}/{fy}"


def po_totals(lines):
    for ln in lines:
        ln["amount"] = round((ln.get("qty") or 0) * (ln.get("rate") or 0), 2)
    subtotal = round(sum(ln["amount"] for ln in lines), 2)
    return subtotal


class POLine(BaseModel):
    item_id: str
    qty: float = Field(gt=0, le=100000000)
    qty2: Optional[float] = Field(default=None, ge=0, le=100000000)
    rate: float = Field(default=0, ge=0, le=1000000)


class POIn(BaseModel):
    supplier_id: Optional[str] = None
    lot_id: Optional[str] = None
    expected_date: str = ""
    terms: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=500)
    lines: List[POLine] = Field(min_length=1, max_length=100)


class POUpdate(BaseModel):
    supplier_id: Optional[str] = None
    expected_date: Optional[str] = None
    terms: Optional[str] = Field(default=None, max_length=500)
    notes: Optional[str] = Field(default=None, max_length=500)
    lines: Optional[List[POLine]] = Field(default=None, min_length=1, max_length=100)


async def make_lines(lines: List[POLine]):
    out = []
    seen = set()
    for ln in lines:
        item = await _item(ln.item_id)
        if ln.item_id in seen:
            raise HTTPException(400, f"{item['name']} appears twice on this order")
        seen.add(ln.item_id)
        if item.get("dual_unit") and not ln.qty2:
            raise HTTPException(400, f"{item['name']} is counted two ways: enter the expected {item['uom2']} as well")
        out.append({"item_id": ln.item_id, "item_name": item["name"], "item_code": item.get("code", ""), "uom": item["uom"],
                    "uom2": item.get("uom2", ""), "qty": r3(ln.qty), "qty2": r3(ln.qty2 or 0), "rate": ln.rate, "amount": 0,
                    "received_qty": 0, "received_qty2": 0})
    po_totals(out)
    return out


async def _po(po_id):
    if not ObjectId.is_valid(po_id):
        raise HTTPException(404, "Purchase order not found")
    po = await db.purchase_orders.find_one({"_id": ObjectId(po_id)})
    if not po:
        raise HTTPException(404, "Purchase order not found")
    return po


def present(po):
    d = serialize_doc(dict(po))     # serialize_doc edits in place; never consume the caller's document
    d["subtotal"] = round(sum(ln.get("amount", 0) for ln in d.get("lines", [])), 2)
    d["total"] = d["subtotal"]
    return d


async def generate_pos_for_lot(lot: dict, user: dict, replace=True):
    """Draft POs for what a lot still needs. Returns the created POs."""
    lot_id = str(lot["_id"]) if "_id" in lot else lot["id"]
    reqs = lot.get("requirements") or []
    if not reqs:
        return []
    if replace:
        await db.purchase_orders.delete_many({"lot_id": lot_id, "status": "draft", "auto": True})
    bal = await all_balances([r["item_id"] for r in reqs])
    on_order = {}
    async for po in db.purchase_orders.find({"status": {"$in": OPEN_STATUSES}}):
        for ln in po.get("lines", []):
            open_q = max(0, ln["qty"] - ln.get("received_qty", 0))
            on_order[ln["item_id"]] = on_order.get(ln["item_id"], 0) + open_q
    groups = {}
    for r in reqs:
        item = await db.stock_items.find_one({"_id": ObjectId(r["item_id"])})
        if not item or not item.get("active", True):
            continue
        store = bal.get(r["item_id"], {"store": [0, 0]})["store"][0]
        net = max(0.0, r["gross_qty"] - max(store, 0) - on_order.get(r["item_id"], 0))
        if net <= EPS:
            continue
        step = 1 if item["uom"] in COUNTED else 0.001
        net = math.ceil(net / step - 1e-9) * step
        rate = await weighted_average_rate(r["item_id"])
        qty2 = 0.0
        if item.get("dual_unit"):
            hq = hq2 = 0.0
            async for m in db.stock_movements.find({"item_id": r["item_id"], "type": "receipt"}):
                hq += m["qty"] * m.get("sign", 1); hq2 += m["qty2"] * m.get("sign", 1)
            qty2 = round(net * hq2 / hq, 3) if hq > EPS else 0.0
        groups.setdefault(item.get("preferred_supplier_id") or "", []).append(
            {"item_id": r["item_id"], "item_name": item["name"], "item_code": item.get("code", ""), "uom": item["uom"],
             "uom2": item.get("uom2", ""), "qty": r3(net), "qty2": qty2, "rate": rate, "amount": 0,
             "received_qty": 0, "received_qty2": 0})
    created = []
    for supplier_id, lines in groups.items():
        sup = await db.suppliers.find_one({"_id": ObjectId(supplier_id)}) if supplier_id else None
        po_totals(lines)
        doc = {"po_number": await next_po_number(), "supplier_id": supplier_id, "supplier_name": sup["name"] if sup else "",
               "status": "draft", "lot_id": lot_id, "lot_number": lot.get("lot_number", ""), "auto": True,
               "expected_date": "", "terms": "", "notes": "Drafted automatically from the lot's requirements"
               + ("" if sup else ". No preferred supplier: choose one before releasing."),
               "lines": lines, "created_by": user["id"], "created_by_name": user.get("name", ""), "created_at": _now(),
               "history": [{"at": _now(), "by": user.get("name", ""), "event": "Drafted from lot requirements"}]}
        res = await db.purchase_orders.insert_one(doc)
        doc["_id"] = res.inserted_id
        created.append(present(doc))
    return created


# ------------------------------------------------------------------ routes
@router.get("/purchase-orders")
async def list_pos(request: Request, status: Optional[str] = None, lot_id: Optional[str] = None,
                   supplier_id: Optional[str] = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    q = {k: v for k, v in (("status", status), ("lot_id", lot_id), ("supplier_id", supplier_id)) if v}
    total = await db.purchase_orders.count_documents(q)
    rows = await db.purchase_orders.find(q).sort("created_at", -1).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [present(r) for r in rows], "total": total, "page": page, "pages": max(1, -(-total // page_size))}


@router.get("/purchase-orders/{po_id}")
async def get_po(po_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    return present(await _po(po_id))


@router.post("/purchase-orders")
async def create_po(data: POIn, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    sup = await _supplier(data.supplier_id) if data.supplier_id else None
    lot = None
    if data.lot_id:
        lot = await db.lots.find_one({"_id": ObjectId(data.lot_id)}) if ObjectId.is_valid(data.lot_id) else None
        if not lot:
            raise HTTPException(400, "Lot not found")
    doc = {"po_number": await next_po_number(), "supplier_id": data.supplier_id or "", "supplier_name": sup["name"] if sup else "",
           "status": "draft", "lot_id": data.lot_id or "", "lot_number": lot["lot_number"] if lot else "", "auto": False,
           "expected_date": data.expected_date, "terms": data.terms, "notes": data.notes, "lines": await make_lines(data.lines),
           "created_by": user["id"], "created_by_name": user.get("name", ""), "created_at": _now(),
           "history": [{"at": _now(), "by": user.get("name", ""), "event": "Created"}]}
    res = await db.purchase_orders.insert_one(doc)
    note(request, entity_type="purchase_order", entity_id=str(res.inserted_id), label=doc["po_number"], summary=f"Created {doc['po_number']}")
    doc["_id"] = res.inserted_id
    return present(doc)


@router.put("/purchase-orders/{po_id}")
async def update_po(po_id: str, data: POUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = await _po(po_id)
    if po["status"] != "draft":
        raise HTTPException(400, "Only a draft order can be edited. Cancel it and raise a new one.")
    update = {}
    if data.supplier_id is not None:
        sup = await _supplier(data.supplier_id) if data.supplier_id else None
        update.update(supplier_id=data.supplier_id, supplier_name=sup["name"] if sup else "")
    for f in ("expected_date", "terms", "notes"):
        if getattr(data, f) is not None:
            update[f] = getattr(data, f)
    if data.lines is not None:
        update["lines"] = await make_lines(data.lines)
    if not update:
        raise HTTPException(400, "No fields to update")
    await db.purchase_orders.update_one({"_id": po["_id"]}, {"$set": update, "$push": {"history": {"at": _now(), "by": user.get("name", ""), "event": "Edited"}}})
    note(request, entity_type="purchase_order", entity_id=po_id, label=po["po_number"], summary=f"Edited {po['po_number']}")
    return present(await _po(po_id))


def _check_ready(po):
    if not po.get("supplier_id"):
        raise HTTPException(400, "Choose a supplier before releasing this order")
    if any((ln.get("rate") or 0) <= 0 for ln in po["lines"]):
        raise HTTPException(400, "Every line needs a rate before the order can be released")


async def _approve(po, user, auto_note=""):
    _check_ready(po)
    await db.purchase_orders.update_one({"_id": po["_id"], "status": "draft"}, {"$set": {
        "status": "approved", "approved_by": user["id"], "approved_by_name": user.get("name", ""), "approved_at": _now()},
        "$push": {"history": {"at": _now(), "by": user.get("name", ""), "event": f"Approved{auto_note}"}}})


@router.post("/purchase-orders/{po_id}/approve")
async def approve_po(po_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = await _po(po_id)
    if po["status"] != "draft":
        raise HTTPException(400, f"This order is already {po['status']}")
    must_ask = (await approvals.policies()).get("po_release")
    if must_ask and user["role"] != "admin":
        raise HTTPException(403, "Releasing a purchase order needs an administrator. Request approval from the Approvals page.")
    _check_ready(po)
    approval_id = await record_auto(request, user, "po_release", "purchase_order", po_id, po["po_number"],
                                    f"Released {po['po_number']} to {po.get('supplier_name', '')}")
    await _approve(po, user, " (administrator)")
    note(request, entity_type="purchase_order", entity_id=po_id, label=po["po_number"], approval_id=approval_id,
         summary=f"Approved {po['po_number']}")
    return present(await _po(po_id))


@router.post("/purchase-orders/{po_id}/send")
async def send_po(po_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = await _po(po_id)
    if po["status"] != "approved":
        raise HTTPException(400, "Only an approved order can be marked as sent")
    await db.purchase_orders.update_one({"_id": po["_id"]}, {"$set": {"status": "sent", "sent_at": _now()},
                                        "$push": {"history": {"at": _now(), "by": user.get("name", ""), "event": "Marked as sent"}}})
    note(request, entity_type="purchase_order", entity_id=po_id, label=po["po_number"], summary=f"Marked {po['po_number']} as sent")
    return present(await _po(po_id))


@router.post("/purchase-orders/{po_id}/cancel")
async def cancel_po(po_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = await _po(po_id)
    if po["status"] in ("cancelled", "closed", "received"):
        raise HTTPException(400, f"This order is already {po['status']}")
    if any(ln.get("received_qty", 0) > 0 for ln in po["lines"]):
        raise HTTPException(400, "Material has been received against this order. Close it instead.")
    await db.purchase_orders.update_one({"_id": po["_id"]}, {"$set": {"status": "cancelled"},
                                        "$push": {"history": {"at": _now(), "by": user.get("name", ""), "event": "Cancelled"}}})
    note(request, entity_type="purchase_order", entity_id=po_id, label=po["po_number"], summary=f"Cancelled {po['po_number']}")
    return present(await _po(po_id))


@router.post("/purchase-orders/{po_id}/close")
async def close_po(po_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = await _po(po_id)
    if po["status"] not in ("partially_received", "received", "sent", "approved"):
        raise HTTPException(400, f"A {po['status']} order cannot be closed")
    await db.purchase_orders.update_one({"_id": po["_id"]}, {"$set": {"status": "closed"},
                                        "$push": {"history": {"at": _now(), "by": user.get("name", ""), "event": "Closed"}}})
    note(request, entity_type="purchase_order", entity_id=po_id, label=po["po_number"], summary=f"Closed {po['po_number']}")
    return present(await _po(po_id))


class ReceiveLine(BaseModel):
    index: int = Field(ge=0)
    qty: float = Field(gt=0, le=100000000)
    qty2: Optional[float] = Field(default=None, ge=0, le=100000000)
    rate: Optional[float] = Field(default=None, ge=0, le=1000000)


class ReceiveIn(BaseModel):
    supplier_bill_no: str = Field(min_length=1, max_length=60)
    date: Optional[str] = None
    lines: List[ReceiveLine] = Field(min_length=1, max_length=100)


@router.post("/purchase-orders/{po_id}/receive")
async def receive_po(po_id: str, data: ReceiveIn, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = await _po(po_id)
    if po["status"] not in ("approved", "sent", "partially_received"):
        raise HTTPException(400, f"Material cannot be received against a {po['status']} order")
    warnings, made = [], []
    for rl in data.lines:
        if rl.index >= len(po["lines"]):
            raise HTTPException(400, "That line is not on this order")
        ln = po["lines"][rl.index]
        mv = MovementIn(type="receipt", item_id=ln["item_id"], qty=rl.qty, qty2=rl.qty2 or None, date=data.date,
                        rate=rl.rate if rl.rate is not None else ln.get("rate"), supplier_id=po["supplier_id"],
                        supplier_bill_no=data.supplier_bill_no, po_id=po_id, reason=f"Against {po['po_number']}")
        doc, w = await post_movement(mv, user)
        made.append(doc["no"])
        warnings += w
        ln["received_qty"] = r3(ln.get("received_qty", 0) + rl.qty)
        ln["received_qty2"] = r3(ln.get("received_qty2", 0) + (rl.qty2 or 0))
        if ln["received_qty"] > ln["qty"] * 1.05 + EPS:
            warnings.append(f"{ln['item_name']}: received {ln['received_qty']:g} against {ln['qty']:g} ordered")
    done = all(ln["received_qty"] >= ln["qty"] - EPS for ln in po["lines"])
    status = "received" if done else "partially_received"
    await db.purchase_orders.update_one({"_id": po["_id"]}, {"$set": {"lines": po["lines"], "status": status},
                                        "$push": {"history": {"at": _now(), "by": user.get("name", ""),
                                                              "event": f"Received ({', '.join(made)}) bill {data.supplier_bill_no}"}}})
    note(request, entity_type="purchase_order", entity_id=po_id, label=po["po_number"],
         summary=f"Received material against {po['po_number']} ({', '.join(made)})", after={"status": status})
    out = present(await _po(po_id))
    out["warnings"] = warnings
    out["grn"] = made
    return out


@router.post("/lots/{lot_id}/generate-po")
async def generate_po(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if not ObjectId.is_valid(lot_id):
        raise HTTPException(404, "Lot not found")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    if not lot.get("requirements"):
        raise HTTPException(400, "This lot has no material requirements. Add them on the lot first.")
    if await db.stock_movements.count_documents({"lot_id": lot_id, "type": "issue"}):
        raise HTTPException(400, "Material has already been issued to this lot, so its orders can no longer be regenerated.")
    created = await generate_pos_for_lot(lot, user, replace=True)
    note(request, entity_type="lot", entity_id=lot_id, label=lot["lot_number"],
         summary=f"Drafted {len(created)} purchase order(s) for {lot['lot_number']}")
    return {"created": created, "message": f"{len(created)} draft order(s)" if created else "Nothing to order: stock and open orders already cover this lot"}


@router.get("/lots/{lot_id}/requirements")
async def lot_requirements(lot_id: str, request: Request):
    """The requirement against what is in the store and already on order."""
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if not ObjectId.is_valid(lot_id):
        raise HTTPException(404, "Lot not found")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    reqs = lot.get("requirements") or []
    bal = await all_balances([r["item_id"] for r in reqs])
    on_order = {}
    async for po in db.purchase_orders.find({"status": {"$in": OPEN_STATUSES}}):
        for ln in po.get("lines", []):
            on_order[ln["item_id"]] = on_order.get(ln["item_id"], 0) + max(0, ln["qty"] - ln.get("received_qty", 0))
    rows = []
    for r in reqs:
        store = bal.get(r["item_id"], {"store": [0, 0]})["store"][0]
        oo = on_order.get(r["item_id"], 0)
        rows.append({**r, "in_store": store, "on_order": r3(oo), "to_order": r3(max(0, r["gross_qty"] - max(store, 0) - oo))})
    return {"lot_id": lot_id, "lot_number": lot["lot_number"], "post_pct": lot.get("post_pct", 0),
            "planned_total": lot_planned_total(lot), "requirements": rows}


@router.get("/purchase-orders/{po_id}/pdf")
async def po_pdf(po_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    po = present(await _po(po_id))
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib import colors as rl
    from reportlab.lib.styles import getSampleStyleSheet
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, title=po["po_number"])
    st = getSampleStyleSheet()
    el = [Paragraph(f"<b>{COMPANY['name']}</b>", st["Title"]), Paragraph(COMPANY["address"], st["Normal"]),
          Paragraph(f"Phone: {COMPANY['phone']} | Email: {COMPANY['email']}", st["Normal"]), Spacer(1, 12),
          Paragraph(f"PURCHASE ORDER - {po['po_number']}", st["Heading2"])]
    meta = [f"Supplier: {po.get('supplier_name') or '-'}", f"Date: {po['created_at'][:10]}",
            f"Status: {po['status']}"]
    if po.get("lot_number"):
        meta.append(f"For lot: {po['lot_number']}")
    if po.get("expected_date"):
        meta.append(f"Expected by: {po['expected_date']}")
    el += [Paragraph(m, st["Normal"]) for m in meta] + [Spacer(1, 10)]
    rows = [["#", "Item", "Qty", "Unit", "Rate", "Amount"]]
    for i, ln in enumerate(po["lines"], 1):
        qty = f"{ln['qty']:g}" + (f" ({ln['qty2']:g} {ln['uom2']})" if ln.get("qty2") else "")
        rows.append([str(i), ln["item_name"], qty, ln["uom"], f"{ln['rate']:.2f}", f"{ln['amount']:.2f}"])
    rows.append(["", "TOTAL", "", "", "", f"{po['total']:.2f}"])
    t = Table(rows, colWidths=[24, 190, 100, 40, 55, 70])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), rl.HexColor("#294f96")), ("TEXTCOLOR", (0, 0), (-1, 0), rl.white),
                           ("GRID", (0, 0), (-1, -1), 0.5, rl.grey), ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                           ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"), ("BACKGROUND", (0, -1), (-1, -1), rl.HexColor("#eef2f8"))]))
    el.append(t)
    if po.get("terms"):
        el += [Spacer(1, 10), Paragraph(f"<b>Terms:</b> {po['terms']}", st["Normal"])]
    el += [Spacer(1, 40), Paragraph("Authorised signature: ___________________", st["Normal"])]
    doc.build(el)
    out.seek(0)
    return StreamingResponse(out, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={po['po_number'].replace('/', '-')}.pdf"})


# ------------------------------------------------------------------ approval handler: po_release
async def prepare_po_release(user, po_id, payload):
    po = await _po(po_id)
    if po["status"] != "draft":
        raise HTTPException(400, f"This order is already {po['status']}")
    _check_ready(po)
    return po["po_number"], {}, {"total": present(po)["total"], "lines": len(po["lines"])}


async def apply_po_release(approval, reviewer, request):
    try:
        po = await _po(approval["entity_id"])
    except HTTPException:
        raise approvals.ApprovalExpired("The purchase order no longer exists")
    if po["status"] != "draft":
        raise approvals.ApprovalExpired(f"The order is already {po['status']}")
    if present(po)["total"] != (approval.get("snapshot") or {}).get("total", present(po)["total"]):
        raise approvals.ApprovalExpired("The order was changed after approval was requested. Ask again.")
    await _approve(po, reviewer, " (via approval)")
    return {"after": {"po": po["po_number"], "status": "approved"}}


approvals.register("po_release", prepare=prepare_po_release, apply=apply_po_release)
