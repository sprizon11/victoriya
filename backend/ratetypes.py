"""Rate types: the kinds of piece rate a lot operation can carry.

Seeded as Regular (default, counts toward the lot plan), Sample and Rework (paid,
but they are not new finished pieces, so they stay out of the plan). The owner
can rename them, add more or change what counts.
"""
import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core import db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc
from audit import note

router = APIRouter(prefix="/api")

SEED = [
    {"name": "Regular", "code": "REG", "counts_toward_plan": True, "is_default": True, "sort_order": 1},
    {"name": "Sample", "code": "SMP", "counts_toward_plan": False, "is_default": False, "sort_order": 2},
    {"name": "Rework", "code": "RWK", "counts_toward_plan": False, "is_default": False, "sort_order": 3},
]


async def seed_rate_types():
    if await db.rate_types.count_documents({}) == 0:
        now = datetime.now(timezone.utc).isoformat()
        await db.rate_types.insert_many([{**s, "active": True, "cap_pct_of_plan": None, "cap_pieces": None,
                                          "created_at": now} for s in SEED])


def public(doc):
    d = serialize_doc(doc)
    return d


async def default_rate_type():
    doc = await db.rate_types.find_one({"is_default": True}) or await db.rate_types.find_one({})
    if not doc:
        await seed_rate_types()
        doc = await db.rate_types.find_one({"is_default": True})
    return public(doc)


async def get_rate_type(rate_type_id):
    if not rate_type_id or not ObjectId.is_valid(rate_type_id):
        raise HTTPException(400, "Rate type not found")
    doc = await db.rate_types.find_one({"_id": ObjectId(rate_type_id)})
    if not doc or not doc.get("active", True):
        raise HTTPException(400, "Rate type not found or switched off")
    return public(doc)


class RateTypeIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    code: str = Field(default="", max_length=10)
    counts_toward_plan: bool = True
    cap_pct_of_plan: Optional[float] = Field(default=None, ge=0, le=100)
    cap_pieces: Optional[int] = Field(default=None, ge=0)
    sort_order: int = 0


class RateTypeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    code: Optional[str] = Field(default=None, max_length=10)
    counts_toward_plan: Optional[bool] = None
    cap_pct_of_plan: Optional[float] = Field(default=None, ge=0, le=100)
    cap_pieces: Optional[int] = Field(default=None, ge=0)
    sort_order: Optional[int] = None
    active: Optional[bool] = None
    is_default: Optional[bool] = None
    clear_caps: bool = False


@router.get("/rate-types")
async def list_rate_types(request: Request):
    await get_current_user(request)
    await seed_rate_types()
    rows = await db.rate_types.find().sort([("sort_order", 1), ("name", 1)]).to_list(100)
    return [public(r) for r in rows]


@router.post("/rate-types")
async def create_rate_type(data: RateTypeIn, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    name = data.name.strip()
    if await db.rate_types.find_one({"name": {"$regex": f"^{re.escape(name)}$", "$options": "i"}}):
        raise HTTPException(400, f"A rate type called '{name}' already exists")
    doc = {"name": name, "code": data.code.strip().upper(), "counts_toward_plan": data.counts_toward_plan,
           "cap_pct_of_plan": data.cap_pct_of_plan, "cap_pieces": data.cap_pieces, "sort_order": data.sort_order,
           "is_default": False, "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    res = await db.rate_types.insert_one(doc)
    note(request, entity_type="rate_type", entity_id=str(res.inserted_id), label=name, summary=f"Created rate type {name}")
    return {"id": str(res.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}


@router.put("/rate-types/{rate_type_id}")
async def update_rate_type(rate_type_id: str, data: RateTypeUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if not ObjectId.is_valid(rate_type_id):
        raise HTTPException(404, "Rate type not found")
    prior = await db.rate_types.find_one({"_id": ObjectId(rate_type_id)})
    if not prior:
        raise HTTPException(404, "Rate type not found")
    fields = data.model_dump()
    clear = fields.pop("clear_caps")
    update = {k: v for k, v in fields.items() if v is not None}
    if clear:
        update["cap_pct_of_plan"] = None
        update["cap_pieces"] = None
    if "name" in update:
        update["name"] = update["name"].strip()
        clash = await db.rate_types.find_one({"name": {"$regex": f"^{re.escape(update['name'])}$", "$options": "i"},
                                              "_id": {"$ne": ObjectId(rate_type_id)}})
        if clash:
            raise HTTPException(400, f"A rate type called '{update['name']}' already exists")
    if prior.get("is_default") and (update.get("active") is False or update.get("is_default") is False):
        raise HTTPException(400, "The default rate type cannot be switched off. Make another one the default first.")
    if "counts_toward_plan" in update and update["counts_toward_plan"] != prior.get("counts_toward_plan", True):
        used = await db.production_entries.count_documents({"rate_type_id": rate_type_id})
        if used:
            raise HTTPException(400, f"{used} entries already use this rate type, so whether it counts toward the plan "
                                     "cannot change. Create a new rate type instead.")
    if not update:
        raise HTTPException(400, "No fields to update")
    if update.get("is_default"):
        await db.rate_types.update_many({}, {"$set": {"is_default": False}})
        update["active"] = True
    await db.rate_types.update_one({"_id": ObjectId(rate_type_id)}, {"$set": update})
    note(request, entity_type="rate_type", entity_id=rate_type_id, label=update.get("name", prior["name"]),
         summary=f"Updated rate type {prior['name']}", before={k: prior.get(k) for k in update}, after=update)
    return public(await db.rate_types.find_one({"_id": ObjectId(rate_type_id)}))


@router.delete("/rate-types/{rate_type_id}")
async def delete_rate_type(rate_type_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if not ObjectId.is_valid(rate_type_id):
        raise HTTPException(404, "Rate type not found")
    rt = await db.rate_types.find_one({"_id": ObjectId(rate_type_id)})
    if not rt:
        raise HTTPException(404, "Rate type not found")
    if rt.get("is_default"):
        raise HTTPException(400, "The default rate type cannot be deleted")
    in_entries = await db.production_entries.count_documents({"rate_type_id": rate_type_id})
    in_lots = await db.lots.count_documents({"operations.rates.rate_type_id": rate_type_id})
    if in_entries or in_lots:
        raise HTTPException(400, "This rate type is used by existing lots or entries. Switch it off instead of deleting it.")
    note(request, entity_type="rate_type", entity_id=rate_type_id, label=rt["name"], summary=f"Deleted rate type {rt['name']}")
    await db.rate_types.delete_one({"_id": ObjectId(rate_type_id)})
    return {"message": "Deleted"}
