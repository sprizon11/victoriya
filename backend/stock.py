"""Stock: items, suppliers and an append-only movement ledger.

Balances are DERIVED from movements, never stored or edited. A correction is a
reversal (a movement with sign -1 pointing at the original) plus a new entry, so
the history of what the storekeeper did is never rewritten.

Two quantities: some items are bought and counted two ways (yarn: cones AND kg).
For those every movement carries both `qty` (primary unit) and `qty2` (weight).

Effects of a movement (multiplied by its `sign`, which is -1 for a reversal):
  receipt     store +
  issue       store -, lot +
  return      store +, lot -
  transfer    lot(from) -, lot(to) +        ("move it to the next lot")
  wastage     lot - (when a lot is given) otherwise store -
  adjustment  store +/-  (direction)
"""
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from core import (db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc,
                  get_fy_suffix)
from audit import note
import approvals
from approvals import ApprovalExpired, record_auto

router = APIRouter(prefix="/api")

DEFAULT_CATEGORIES = ["yarn", "fabric", "elastic", "thread", "label", "sticker", "fusing", "button_zip", "packing", "other"]
UOMS = ["pcs", "meter", "kg", "cone", "roll", "box"]
MOVEMENT_TYPES = ["receipt", "issue", "return", "transfer", "wastage", "adjustment"]
PREFIX = {"receipt": "GRN", "issue": "ISS", "return": "RET", "transfer": "TRF", "wastage": "WST", "adjustment": "ADJ"}
EPS = 0.0005


def _now():
    return datetime.now(timezone.utc).isoformat()


def r3(x):
    return round(float(x or 0) + 0.0, 3)


async def categories():
    doc = await db.system_settings.find_one({"key": "stock_categories"})
    extra = []
    if doc and doc.get("value"):
        extra = [c.strip().lower().replace(" ", "_") for c in str(doc["value"]).split(",") if c.strip()]
    return list(dict.fromkeys(DEFAULT_CATEGORIES + extra))


async def next_number(type_: str) -> str:
    fy = get_fy_suffix()
    res = await db.counters.find_one_and_update({"name": f"stock_{type_}_{fy}"}, {"$inc": {"value": 1}},
                                                upsert=True, return_document=True)
    return f"{PREFIX[type_]}{res['value']}/{fy}"


async def next_item_code() -> str:
    res = await db.counters.find_one_and_update({"name": "stock_item"}, {"$inc": {"value": 1}},
                                                upsert=True, return_document=True)
    return f"ITM{res['value']:03d}"


# ---------------------------------------------------------------- the maths
def apply_effect(totals, m, sign=1):
    """Fold one movement (or an aggregated group) into {store:[q,q2], lots:{id:[q,q2]}}."""
    s = sign * m.get("sign", 1)
    q, q2 = m.get("qty", 0) * s, m.get("qty2", 0) * s
    t, lot, to = m["type"], m.get("lot_id") or "", m.get("to_lot_id") or ""

    def bump(target, a, b):
        target[0] = r3(target[0] + a)
        target[1] = r3(target[1] + b)
    lots = totals["lots"]
    if t == "receipt":
        bump(totals["store"], q, q2)
    elif t == "issue":
        bump(totals["store"], -q, -q2)
        bump(lots.setdefault(lot, [0, 0]), q, q2)
    elif t == "return":
        bump(totals["store"], q, q2)
        bump(lots.setdefault(lot, [0, 0]), -q, -q2)
    elif t == "transfer":
        bump(lots.setdefault(lot, [0, 0]), -q, -q2)
        bump(lots.setdefault(to, [0, 0]), q, q2)
    elif t == "wastage":
        if lot:
            bump(lots.setdefault(lot, [0, 0]), -q, -q2)
        else:
            bump(totals["store"], -q, -q2)
    elif t == "adjustment":
        d = m.get("direction", 1)
        bump(totals["store"], q * d, q2 * d)
    return totals


async def item_totals(item_id: str, exclude_id=None):
    totals = {"store": [0, 0], "lots": {}}
    q = {"item_id": item_id}
    async for m in db.stock_movements.find(q).sort("created_at", 1):
        if exclude_id and str(m["_id"]) == exclude_id:
            continue
        apply_effect(totals, m)
    return totals


async def weighted_average_rate(item_id: str) -> float:
    """Average purchase rate per primary unit across all receipts to date
    (reversals subtract). Issues are valued at this when they happen."""
    amount = qty = 0.0
    async for m in db.stock_movements.find({"item_id": item_id, "type": "receipt"}):
        s = m.get("sign", 1)
        amount += (m.get("amount") or 0) * s
        qty += m.get("qty", 0) * s
    return round(amount / qty, 4) if qty > EPS else 0.0


async def all_balances(item_ids=None):
    """{item_id: {"store":[q,q2], "lots":{...}}} for many items in one pass."""
    match = {"item_id": {"$in": item_ids}} if item_ids else {}
    groups = {}
    pipeline = [{"$match": match},
                {"$group": {"_id": {"i": "$item_id", "t": "$type", "l": "$lot_id", "to": "$to_lot_id",
                                    "s": "$sign", "d": "$direction"},
                            "qty": {"$sum": "$qty"}, "qty2": {"$sum": "$qty2"}}}]
    async for g in db.stock_movements.aggregate(pipeline):
        k = g["_id"]
        tot = groups.setdefault(k["i"], {"store": [0, 0], "lots": {}})
        apply_effect(tot, {"type": k["t"], "lot_id": k.get("l"), "to_lot_id": k.get("to"), "sign": k.get("s") or 1,
                           "direction": k.get("d") or 1, "qty": g["qty"], "qty2": g["qty2"]})
    return groups


# ---------------------------------------------------------------- models
class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: str = "other"
    uom: str = "pcs"
    dual_unit: bool = False
    uom2: str = "kg"
    reorder_level: float = Field(default=0, ge=0)
    preferred_supplier_id: Optional[str] = None
    notes: str = Field(default="", max_length=300)


class ItemUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    category: Optional[str] = None
    reorder_level: Optional[float] = Field(default=None, ge=0)
    preferred_supplier_id: Optional[str] = None
    notes: Optional[str] = Field(default=None, max_length=300)
    active: Optional[bool] = None


class SupplierIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    contact: str = Field(default="", max_length=100)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=120)
    gstin: str = Field(default="", max_length=20)
    address: str = Field(default="", max_length=300)


class SupplierUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    contact: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=40)
    email: Optional[str] = Field(default=None, max_length=120)
    gstin: Optional[str] = Field(default=None, max_length=20)
    address: Optional[str] = Field(default=None, max_length=300)
    active: Optional[bool] = None


class MovementIn(BaseModel):
    type: str
    item_id: str
    qty: float = Field(gt=0, le=10_000_000)
    qty2: Optional[float] = Field(default=None, gt=0, le=10_000_000)
    date: Optional[str] = None
    rate: Optional[float] = Field(default=None, ge=0, le=1_000_000)
    supplier_id: Optional[str] = None
    supplier_bill_no: str = Field(default="", max_length=60)
    po_id: Optional[str] = None
    lot_id: Optional[str] = None
    to_lot_id: Optional[str] = None
    direction: int = 1                        # adjustments: +1 add to stock, -1 remove
    reason: str = Field(default="", max_length=300)
    note: str = Field(default="", max_length=300)


# ---------------------------------------------------------------- permissions
async def data_entry_may_issue():
    doc = await db.system_settings.find_one({"key": "data_entry_can_issue_stock"})
    return bool(doc) and str(doc.get("value", "")).lower() in ("1", "true", "yes")


async def stock_user(request: Request, movement_type: Optional[str] = None):
    user = await get_current_user(request)
    if user["role"] in ("admin", "accounts"):
        return user
    if user["role"] == "data_entry" and movement_type in ("issue", "return") and await data_entry_may_issue():
        return user
    raise HTTPException(403, "Access denied")


def hide_money(row):
    for k in ("rate", "amount", "avg_rate", "value"):
        row.pop(k, None)
    return row


# ---------------------------------------------------------------- items / suppliers
@router.get("/stock/categories")
async def get_categories(request: Request):
    await get_current_user(request)
    return {"categories": await categories(), "uoms": UOMS}


@router.get("/stock/items")
async def list_items(request: Request, category: Optional[str] = None, q: Optional[str] = None, active: Optional[bool] = None):
    user = await get_current_user(request)
    query = {}
    if category:
        query["category"] = category
    if active is not None:
        query["active"] = active
    if q:
        query["$or"] = [{"name": {"$regex": re.escape(q), "$options": "i"}}, {"code": {"$regex": re.escape(q), "$options": "i"}}]
    rows = await db.stock_items.find(query).sort("name", 1).to_list(2000)
    return [serialize_doc(r) for r in rows]


@router.post("/stock/items")
async def create_item(data: ItemIn, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if data.category not in await categories():
        raise HTTPException(400, f"Unknown category '{data.category}'")
    if data.uom not in UOMS or data.uom2 not in UOMS:
        raise HTTPException(400, "Unknown unit of measure")
    if data.dual_unit and data.uom2 == data.uom:
        raise HTTPException(400, "A two-unit item needs two different units (for example cone and kg)")
    name = data.name.strip()
    if await db.stock_items.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
        raise HTTPException(400, f"An item called '{name}' already exists")
    if data.preferred_supplier_id:
        await _supplier(data.preferred_supplier_id)
    doc = {"code": await next_item_code(), "name": name, "category": data.category, "uom": data.uom,
           "dual_unit": data.dual_unit, "uom2": data.uom2 if data.dual_unit else "",
           "reorder_level": data.reorder_level, "preferred_supplier_id": data.preferred_supplier_id or "",
           "notes": data.notes, "active": True, "created_at": _now()}
    res = await db.stock_items.insert_one(doc)
    note(request, entity_type="stock_item", entity_id=str(res.inserted_id), label=f"{doc['code']} {name}", summary=f"Created stock item {name}")
    return {"id": str(res.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}


@router.put("/stock/items/{item_id}")
async def update_item(item_id: str, data: ItemUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    item = await _item(item_id)
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if "category" in update and update["category"] not in await categories():
        raise HTTPException(400, f"Unknown category '{update['category']}'")
    if update.get("preferred_supplier_id"):
        await _supplier(update["preferred_supplier_id"])
    if not update:
        raise HTTPException(400, "No fields to update")
    await db.stock_items.update_one({"_id": ObjectId(item_id)}, {"$set": update})
    note(request, entity_type="stock_item", entity_id=item_id, label=item["name"], summary=f"Updated stock item {item['name']}",
         before={k: item.get(k) for k in update}, after=update)
    return serialize_doc(await db.stock_items.find_one({"_id": ObjectId(item_id)}))


@router.delete("/stock/items/{item_id}")
async def delete_item(item_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    item = await _item(item_id)
    if await db.stock_movements.count_documents({"item_id": item_id}):
        raise HTTPException(400, "This item has stock movements. Switch it off instead of deleting it.")
    note(request, entity_type="stock_item", entity_id=item_id, label=item["name"], summary=f"Deleted stock item {item['name']}")
    await db.stock_items.delete_one({"_id": ObjectId(item_id)})
    return {"message": "Deleted"}


async def _item(item_id):
    if not item_id or not ObjectId.is_valid(item_id):
        raise HTTPException(404, "Item not found")
    item = await db.stock_items.find_one({"_id": ObjectId(item_id)})
    if not item:
        raise HTTPException(404, "Item not found")
    return item


async def _supplier(supplier_id):
    if not supplier_id or not ObjectId.is_valid(supplier_id):
        raise HTTPException(400, "Supplier not found")
    sup = await db.suppliers.find_one({"_id": ObjectId(supplier_id)})
    if not sup:
        raise HTTPException(400, "Supplier not found")
    return sup


@router.get("/suppliers")
async def list_suppliers(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    rows = await db.suppliers.find().sort("name", 1).to_list(1000)
    return [serialize_doc(r) for r in rows]


@router.post("/suppliers")
async def create_supplier(data: SupplierIn, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    name = data.name.strip()
    if await db.suppliers.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
        raise HTTPException(400, f"A supplier called '{name}' already exists")
    doc = {**data.model_dump(), "name": name, "active": True, "created_at": _now()}
    res = await db.suppliers.insert_one(doc)
    note(request, entity_type="supplier", entity_id=str(res.inserted_id), label=name, summary=f"Created supplier {name}")
    return {"id": str(res.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}


@router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, data: SupplierUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    sup = await _supplier(supplier_id)
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    await db.suppliers.update_one({"_id": ObjectId(supplier_id)}, {"$set": update})
    if "name" in update:
        await db.stock_items.update_many({"preferred_supplier_id": supplier_id}, {"$set": {"preferred_supplier_name": update["name"]}})
    note(request, entity_type="supplier", entity_id=supplier_id, label=sup["name"], summary=f"Updated supplier {sup['name']}",
         before={k: sup.get(k) for k in update}, after=update)
    return serialize_doc(await db.suppliers.find_one({"_id": ObjectId(supplier_id)}))


@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    sup = await _supplier(supplier_id)
    if await db.stock_movements.count_documents({"supplier_id": supplier_id}) or await db.purchase_orders.count_documents({"supplier_id": supplier_id}):
        raise HTTPException(400, "This supplier has purchases on record. Switch it off instead of deleting it.")
    note(request, entity_type="supplier", entity_id=supplier_id, label=sup["name"], summary=f"Deleted supplier {sup['name']}")
    await db.suppliers.delete_one({"_id": ObjectId(supplier_id)})
    return {"message": "Deleted"}


# ---------------------------------------------------------------- movements
async def post_movement(data: MovementIn, user: dict, *, reverses=None, approval_id=None):
    """Validate and write one movement. Returns (doc, warnings)."""
    if data.type not in MOVEMENT_TYPES:
        raise HTTPException(400, f"Movement type must be one of {', '.join(MOVEMENT_TYPES)}")
    item = await _item(data.item_id)
    if not item.get("active", True):
        raise HTTPException(400, f"{item['name']} is switched off")
    warnings = []
    dual = item.get("dual_unit", False)
    if dual and not data.qty2:
        raise HTTPException(400, f"{item['name']} is counted two ways: enter both the {item['uom']} and the {item['uom2']}")
    if not dual and data.qty2:
        raise HTTPException(400, f"{item['name']} has a single unit; leave the second quantity empty")
    qty, qty2 = r3(data.qty), r3(data.qty2 or 0)

    lot = to_lot = None
    if data.type in ("issue", "return", "transfer") and not data.lot_id:
        raise HTTPException(400, "Choose the lot")
    for lid in (data.lot_id, data.to_lot_id):
        if lid:
            doc = await db.lots.find_one({"_id": ObjectId(lid)}) if ObjectId.is_valid(lid) else None
            if not doc:
                raise HTTPException(400, "Lot not found")
            if lid == data.lot_id:
                lot = doc
            else:
                to_lot = doc
    if data.type == "transfer":
        if not data.to_lot_id:
            raise HTTPException(400, "Choose the lot to move it to")
        if data.to_lot_id == data.lot_id:
            raise HTTPException(400, "The two lots are the same")
        if not data.reason.strip():
            raise HTTPException(400, "A reason is required to move material between lots")
    if data.type in ("wastage", "adjustment") and not data.reason.strip():
        raise HTTPException(400, "A reason is required")
    if data.type == "receipt":
        if not data.supplier_id:
            raise HTTPException(400, "A receipt needs the supplier")
        if not data.supplier_bill_no.strip():
            raise HTTPException(400, "A receipt needs the supplier's bill or delivery challan number")
        await _supplier(data.supplier_id)
    if data.type == "adjustment" and data.direction not in (1, -1):
        raise HTTPException(400, "Adjustment direction must be +1 or -1")

    # no balance may go negative: the store, or the lot the material is leaving
    totals = await item_totals(data.item_id)
    probe = {"store": [totals["store"][0], totals["store"][1]], "lots": {k: list(v) for k, v in totals["lots"].items()}}
    m = {"type": data.type, "qty": qty, "qty2": qty2, "lot_id": data.lot_id, "to_lot_id": data.to_lot_id,
         "direction": data.direction, "sign": -1 if reverses else 1}
    apply_effect(probe, m)
    for label, vals in [("store", probe["store"])] + [(f"lot", v) for v in probe["lots"].values()]:
        if vals[0] < -EPS or vals[1] < -EPS:
            where = "the store" if label == "store" else "that lot"
            have = totals["store"] if label == "store" else totals["lots"].get(data.lot_id or "", [0, 0])
            raise HTTPException(400, f"Not enough {item['name']} in {where}: {have[0]:g} {item['uom']} available, "
                                     f"{qty:g} requested")
    if dual and data.type == "receipt":
        # kg per cone should stay roughly steady; flag a receipt that is off, don't block it
        hist_q = hist_q2 = 0.0
        async for h in db.stock_movements.find({"item_id": data.item_id, "type": "receipt"}):
            hist_q += h["qty"] * h.get("sign", 1)
            hist_q2 += h["qty2"] * h.get("sign", 1)
        tol = 5.0
        s = await db.system_settings.find_one({"key": "dual_unit_tolerance_pct"})
        try:
            tol = float(s["value"]) if s else 5.0
        except (TypeError, ValueError, KeyError):
            pass
        if hist_q > 0:
            usual = hist_q2 / hist_q
            this = qty2 / qty
            if usual > 0 and abs(this - usual) / usual * 100 > tol:
                warnings.append(f"{this:.3f} {item['uom2']} per {item['uom']} is {abs(this - usual) / usual * 100:.1f}% away "
                                f"from the usual {usual:.3f}")

    rate = data.rate
    if data.type == "receipt":
        amount = round((rate or 0) * qty, 2)
    elif data.type in ("issue", "return", "transfer", "wastage"):
        rate = await weighted_average_rate(data.item_id)          # valued at average cost when it moved
        amount = round(rate * qty, 2)
    else:
        rate, amount = None, None
    doc = {"no": await next_number(data.type), "type": data.type, "sign": -1 if reverses else 1, "date": data.date or _now()[:10],
           "item_id": data.item_id, "item_name": item["name"], "item_code": item.get("code", ""), "uom": item["uom"],
           "uom2": item.get("uom2", ""), "qty": qty, "qty2": qty2, "rate": rate, "amount": amount,
           "supplier_id": data.supplier_id or "", "supplier_name": (await _supplier(data.supplier_id))["name"] if data.supplier_id else "",
           "supplier_bill_no": data.supplier_bill_no.strip(), "po_id": data.po_id or "",
           "lot_id": data.lot_id or "", "lot_number": lot["lot_number"] if lot else "",
           "to_lot_id": data.to_lot_id or "", "to_lot_number": to_lot["lot_number"] if to_lot else "",
           "direction": data.direction if data.type == "adjustment" else 1,
           "reason": data.reason.strip(), "note": data.note.strip(), "reverses": reverses or "",
           "created_by": user["id"], "created_by_name": user.get("name", ""), "created_at": _now(),
           "approval_id": approval_id}
    res = await db.stock_movements.insert_one(doc)
    doc["id"] = str(res.inserted_id)
    doc.pop("_id", None)
    return doc, warnings


@router.post("/stock/movements")
async def create_movement(data: MovementIn, request: Request):
    user = await stock_user(request, data.type)
    if data.type == "adjustment":
        check_role(user, ["admin", "accounts"])
        if user["role"] != "admin" and (await approvals.policies()).get("stock_adjustment"):
            raise HTTPException(403, "Stock adjustments need an administrator. Ask for approval from the Approvals page.")
    doc, warnings = await post_movement(data, user)
    approval_id = None
    if data.type == "adjustment":
        approval_id = await record_auto(request, user, "stock_adjustment", "stock", doc["id"], f"{doc['item_name']} {doc['no']}",
                                        f"Stock adjustment {doc['direction'] * doc['qty']:+g} {doc['uom']} of {doc['item_name']}: {doc['reason']}",
                                        reason=doc["reason"])
    note(request, entity_type="stock", entity_id=doc["id"], label=f"{doc['no']} {doc['item_name']}", approval_id=approval_id,
         summary=f"{doc['type'].capitalize()} {doc['qty']:g} {doc['uom']} of {doc['item_name']}"
                 + (f" to {doc['lot_number']}" if doc["lot_number"] and doc["type"] == "issue" else ""),
         after={"qty": doc["qty"], "qty2": doc["qty2"], "lot": doc["lot_number"], "reason": doc["reason"]})
    if user["role"] == "data_entry":
        hide_money(doc)
    return {**doc, "warnings": warnings}


@router.post("/stock/movements/{movement_id}/reverse")
async def reverse_movement(movement_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    reason = str(body.get("reason", "")).strip()
    if not reason:
        raise HTTPException(400, "A reason is required to reverse a movement")
    if not ObjectId.is_valid(movement_id):
        raise HTTPException(404, "Movement not found")
    orig = await db.stock_movements.find_one({"_id": ObjectId(movement_id)})
    if not orig:
        raise HTTPException(404, "Movement not found")
    if orig.get("sign", 1) == -1 or orig.get("reversed_by"):
        raise HTTPException(400, "This movement has already been reversed (or is itself a reversal)")
    data = MovementIn(type=orig["type"], item_id=orig["item_id"], qty=orig["qty"], qty2=orig["qty2"] or None,
                      date=_now()[:10], rate=orig.get("rate"), supplier_id=orig.get("supplier_id") or None,
                      supplier_bill_no=orig.get("supplier_bill_no", ""), lot_id=orig.get("lot_id") or None,
                      to_lot_id=orig.get("to_lot_id") or None, direction=orig.get("direction", 1),
                      reason=f"Reversal: {reason}", note=f"Reverses {orig['no']}")
    doc, _ = await post_movement(data, user, reverses=movement_id)
    await db.stock_movements.update_one({"_id": orig["_id"]}, {"$set": {"reversed_by": doc["id"]}})
    note(request, entity_type="stock", entity_id=movement_id, label=f"{orig['no']} {orig['item_name']}",
         summary=f"Reversed {orig['no']} ({orig['item_name']}): {reason}", before={"qty": orig["qty"]}, after={"reversal": doc["no"]})
    return doc


def _movement_query(item_id=None, lot_id=None, type=None, date_from=None, date_to=None, q=None):
    query = {}
    if item_id:
        query["item_id"] = item_id
    if lot_id:
        query["$or"] = [{"lot_id": lot_id}, {"to_lot_id": lot_id}]
    if type:
        query["type"] = type
    if date_from or date_to:
        query["date"] = {**({"$gte": date_from} if date_from else {}), **({"$lte": date_to} if date_to else {})}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        query["$and"] = [{"$or": [{"item_name": rx}, {"no": rx}, {"supplier_bill_no": rx}, {"lot_number": rx}]}]
    return query


@router.get("/stock/movements")
async def list_movements(request: Request, item_id: Optional[str] = None, lot_id: Optional[str] = None,
                         type: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                         q: Optional[str] = None, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=200)):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    query = _movement_query(item_id, lot_id, type, date_from, date_to, q)
    total = await db.stock_movements.count_documents(query)
    rows = await db.stock_movements.find(query).sort([("date", -1), ("created_at", -1)]).skip((page - 1) * page_size).limit(page_size).to_list(page_size)
    return {"items": [serialize_doc(r) for r in rows], "total": total, "page": page, "pages": max(1, -(-total // page_size))}


@router.get("/stock/ledger/{item_id}")
async def item_ledger(item_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    item = await _item(item_id)
    totals = {"store": [0, 0], "lots": {}}
    rows = []
    async for m in db.stock_movements.find({"item_id": item_id}).sort("created_at", 1):
        apply_effect(totals, m)
        d = serialize_doc(m)
        d["balance"], d["balance2"] = totals["store"][0], totals["store"][1]
        rows.append(d)
    rows.reverse()
    return {"item": serialize_doc(item), "balance": totals["store"], "movements": rows[:500]}


@router.get("/stock/balances")
async def balances(request: Request, category: Optional[str] = None, q: Optional[str] = None, lot_id: Optional[str] = None,
                   low_only: bool = False):
    user = await get_current_user(request)
    clerk = user["role"] == "data_entry" and await data_entry_may_issue()
    if user["role"] not in ("admin", "accounts") and not clerk:
        raise HTTPException(403, "Access denied")
    query = {"active": True}
    if category:
        query["category"] = category
    if q:
        query["name"] = {"$regex": re.escape(q), "$options": "i"}
    items = await db.stock_items.find(query).sort("name", 1).to_list(2000)
    bal = await all_balances([str(i["_id"]) for i in items])
    out = []
    for it in items:
        iid = str(it["_id"])
        tot = bal.get(iid, {"store": [0, 0], "lots": {}})
        row = serialize_doc(it)
        row["balance"], row["balance2"] = tot["store"][0], tot["store"][1]
        row["low"] = it.get("reorder_level", 0) > 0 and tot["store"][0] <= it["reorder_level"] + EPS
        if lot_id:
            lb = tot["lots"].get(lot_id, [0, 0])
            row["on_lot"], row["on_lot2"] = lb[0], lb[1]
            if abs(lb[0]) < EPS and abs(lb[1]) < EPS:
                continue
        if low_only and not row["low"]:
            continue
        if user["role"] != "data_entry":
            avg = await weighted_average_rate(iid)
            row["avg_rate"] = avg
            row["value"] = round(avg * tot["store"][0], 2)
        out.append(row)
    return out


@router.get("/stock/lot/{lot_id}")
async def lot_material(lot_id: str, request: Request):
    """What a lot has received, used and still holds, against what it needs."""
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if not ObjectId.is_valid(lot_id):
        raise HTTPException(404, "Lot not found")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    ids = set()
    async for m in db.stock_movements.find({"$or": [{"lot_id": lot_id}, {"to_lot_id": lot_id}]}, {"item_id": 1}):
        ids.add(m["item_id"])
    ids |= {r["item_id"] for r in lot.get("requirements", [])}
    rows = []
    for iid in ids:
        if not ObjectId.is_valid(iid):
            continue
        item = await db.stock_items.find_one({"_id": ObjectId(iid)})
        if not item:
            continue
        issued = returned = wasted = moved_out = moved_in = 0.0
        value = 0.0
        async for m in db.stock_movements.find({"item_id": iid, "$or": [{"lot_id": lot_id}, {"to_lot_id": lot_id}]}):
            s, q = m.get("sign", 1), m["qty"]
            if m["type"] == "issue" and m.get("lot_id") == lot_id:
                issued += s * q; value += s * (m.get("amount") or 0)
            elif m["type"] == "return" and m.get("lot_id") == lot_id:
                returned += s * q; value -= s * (m.get("amount") or 0)
            elif m["type"] == "wastage" and m.get("lot_id") == lot_id:
                wasted += s * q
            elif m["type"] == "transfer":
                if m.get("lot_id") == lot_id:
                    moved_out += s * q; value -= s * (m.get("amount") or 0)
                if m.get("to_lot_id") == lot_id:
                    moved_in += s * q; value += s * (m.get("amount") or 0)
        req = next((r for r in lot.get("requirements", []) if r["item_id"] == iid), None)
        rows.append({"item_id": iid, "item_name": item["name"], "uom": item["uom"],
                     "required": req.get("gross_qty") if req else None,
                     "issued": r3(issued), "returned": r3(returned), "wasted": r3(wasted),
                     "moved_in": r3(moved_in), "moved_out": r3(moved_out),
                     "on_lot": r3(issued - returned - wasted + moved_in - moved_out),
                     "value": round(value, 2) if user["role"] != "data_entry" else None})
    rows.sort(key=lambda r: r["item_name"])
    return {"lot_id": lot_id, "lot_number": lot["lot_number"], "items": rows}


# ---------------------------------------------------------------- approval handler: stock_adjustment
async def prepare_adjustment(user, entity_id, payload):
    try:
        data = MovementIn(**{**(payload or {}), "type": "adjustment", "item_id": entity_id})
    except Exception:
        raise HTTPException(400, "The request does not describe a valid stock adjustment")
    item = await _item(entity_id)
    totals = await item_totals(entity_id)
    probe = {"store": list(totals["store"]), "lots": {}}
    apply_effect(probe, {"type": "adjustment", "qty": r3(data.qty), "qty2": r3(data.qty2 or 0), "direction": data.direction})
    if probe["store"][0] < -EPS:
        raise HTTPException(400, f"Not enough {item['name']} in the store for that adjustment")
    sign = "+" if data.direction == 1 else "-"
    return f"{item['name']} {sign}{data.qty:g} {item['uom']}", data.model_dump(), {"balance": totals["store"]}


async def apply_adjustment(approval, reviewer, request):
    p = approval["payload"]
    data = MovementIn(**p)
    requester = {"id": approval["requested_by"], "name": approval.get("requested_by_name", "")}
    doc, _ = await post_movement(data, requester, approval_id=str(approval["_id"]))
    return {"after": {"movement": doc["no"], "qty": doc["qty"], "direction": doc["direction"]}}


approvals.register("stock_adjustment", prepare=prepare_adjustment, apply=apply_adjustment)
