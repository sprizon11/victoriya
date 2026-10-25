from dotenv import load_dotenv
from pathlib import Path
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import logging
import uuid
import io
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Query
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, field_validator
from bson import ObjectId
from pymongo.errors import DuplicateKeyError
import bcrypt
import jwt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# Config, db handle, auth helpers and numbering live in core.py (shared with feature modules).
from core import *  # noqa: F401,F403
from audit import router as audit_router, audit_middleware, note, log_event
import approvals
from groups import router as groups_router, group_name_for
import ratetypes
from ratetypes import default_rate_type, get_rate_type
from lotmath import (planned_from_order, compute_earnings, parse_money, clean_size_rates,
                     lot_op_rates, find_rate, average_rate)
from approvals import ApprovalExpired, record_auto


async def label_for(request, collection, oid, field="name", entity_type=None):
    """Record what a delete/update is about *before* the document disappears."""
    try:
        doc = await collection.find_one({"_id": ObjectId(oid)})
    except Exception:
        doc = None
    if doc:
        note(request, entity_type=entity_type, entity_id=oid, label=str(doc.get(field, "")),
             summary=f"{request.method} {entity_type or ''} {doc.get(field, '')}".strip())
    return doc

app = FastAPI(
    title="Victoria Unit Flow",
    docs_url=None if PUBLIC_MODE else "/docs",   # don't advertise the API surface publicly
    redoc_url=None,
    openapi_url=None if PUBLIC_MODE else "/openapi.json",
)
api_router = APIRouter(prefix="/api")


@api_router.get("/company")
async def get_company_info():
    return COMPANY

# ===== MODELS =====

class LoginRequest(BaseModel):
    email: str
    password: str

class UserCreate(BaseModel):
    email: str
    password: str
    name: str
    role: str
    can_enter: bool = True
    can_edit: bool = False
    can_delete: bool = False
    can_view_financial: bool = False

class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    can_enter: Optional[bool] = None
    can_edit: Optional[bool] = None
    can_delete: Optional[bool] = None
    can_view_financial: Optional[bool] = None

class OperatorCreate(BaseModel):
    name: str
    group_id: Optional[str] = None

class OperatorUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None
    group_id: Optional[str] = None          # "" removes the group

class OperationCreate(BaseModel):
    name: str
    group_id: Optional[str] = None

class OperationUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None
    group_id: Optional[str] = None          # "" removes the group

class ColorMasterCreate(BaseModel):
    name: str

class ColorMasterUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None

class SizeChartCreate(BaseModel):
    name: str
    sizes: List[str]

class SizeChartUpdate(BaseModel):
    name: Optional[str] = None
    sizes: Optional[List[str]] = None
    active: Optional[bool] = None

class WeekCreate(BaseModel):
    week_number: int
    year: int
    start_date: str
    end_date: str

class SizeEntry(BaseModel):
    size: str
    planned_qty: int

class LotColorEntry(BaseModel):
    name: str
    sizes: List[SizeEntry]

class ExtraRate(BaseModel):
    rate_type_id: str
    rate: float
    size_rates: Optional[dict] = None


class LotOperationEntry(BaseModel):
    operation_id: str
    rate: float                                  # the default (Regular) flat rate
    operator_ids: List[str]
    size_rates: Optional[dict] = None            # default type: {size: rate} overrides
    extra_rates: List[ExtraRate] = []            # other rate types (Sample, Rework, ...)

class LotCreate(BaseModel):
    style_name: str
    start_date: str
    target_end_date: str
    size_chart_id: str
    color_names: List[str]
    color_size_quantities: dict                  # ORDERED quantities; planned = order + allowance
    operations: List[LotOperationEntry]
    allowance_pct: float = 0
    quantity_control: Optional[dict] = None

class LotUpdate(BaseModel):
    style_name: Optional[str] = None
    start_date: Optional[str] = None
    target_end_date: Optional[str] = None
    status: Optional[str] = None
    color_size_quantities: Optional[dict] = None
    operations: Optional[List[LotOperationEntry]] = None
    allowance_pct: Optional[float] = None
    quantity_control: Optional[dict] = None

class ProductionBatchEntry(BaseModel):
    operator_id: str
    sizes: dict

class ProductionBatchCreate(BaseModel):
    week_id: str
    lot_id: str
    operation_id: str
    color: str
    date: str
    entries: List[ProductionBatchEntry]
    rate_type_id: Optional[str] = None

class SettingUpdate(BaseModel):
    value: str

class AdvanceCreate(BaseModel):
    operator_id: str
    date: str
    amount: float
    remarks: str = ""

class AdvanceAdjust(BaseModel):
    amount: float

# ===== AUTH ROUTES =====

@api_router.post("/auth/login")
async def login(req: LoginRequest, response: Response, request: Request):
    email = req.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    identifier = f"{ip}:{email}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        lockout = attempt.get("last_attempt", datetime.now(timezone.utc))
        if isinstance(lockout, str):
            lockout = datetime.fromisoformat(lockout)
        if datetime.now(timezone.utc) - lockout < timedelta(minutes=15):
            await log_event(request, "auth.login_locked", entity_type="user", label=email,
                            summary=f"Login blocked: too many attempts for {email}", outcome="denied")
            raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
        else:
            await db.login_attempts.delete_one({"identifier": identifier})

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        await log_event(request, "auth.login_failed", entity_type="user", label=email,
                        summary=f"Failed login for {email}", outcome="denied")
        raise HTTPException(401, "Invalid email or password")

    await db.login_attempts.delete_one({"identifier": identifier})
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email, user["role"])
    refresh_token = create_refresh_token(user_id)
    set_auth_cookie(response, "access_token", access_token, 28800)
    set_auth_cookie(response, "refresh_token", refresh_token, 604800)
    await log_event(request, "auth.login", user={"id": user_id, "name": user.get("name", ""), "role": user["role"]},
                    entity_type="user", entity_id=user_id, label=email, summary=f"{email} signed in")
    return {"id": user_id, "email": user["email"], "name": user["name"], "role": user["role"],
            "can_enter": user.get("can_enter", True), "can_edit": user.get("can_edit", False),
            "can_delete": user.get("can_delete", False), "can_view_financial": user.get("can_view_financial", False)}

@api_router.post("/auth/logout")
async def logout(response: Response, request: Request):
    try:
        who = await get_current_user(request)
        await log_event(request, "auth.logout", user=who, entity_type="user", entity_id=who["id"],
                        label=who.get("email", ""), summary=f"{who.get('email', '')} signed out")
    except HTTPException:
        pass        # already signed out; logging out must still succeed
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Logged out"}

@api_router.get("/auth/me")
async def get_me(request: Request):
    user = await get_current_user(request)
    return user

@api_router.post("/auth/refresh")
async def refresh_token(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(401, "No refresh token")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(401, "Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(401, "User not found")
        user_id = str(user["_id"])
        access_token = create_access_token(user_id, user["email"], user["role"])
        set_auth_cookie(response, "access_token", access_token, 28800)
        return {"message": "Token refreshed"}
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid refresh token")

# ===== OPERATOR ROUTES =====

@api_router.get("/operators")
async def get_operators(request: Request):
    await get_current_user(request)
    operators = await db.operators.find().sort("name", 1).to_list(1000)
    return [serialize_doc(o) for o in operators]

@api_router.post("/operators")
async def create_operator(data: OperatorCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    gid, gname = await group_name_for(db.operator_groups, data.group_id)
    code = await get_next_operator_code()
    doc = {"name": data.name, "operator_code": code, "display_name": f"{data.name} ({code})",
           "group_id": gid, "group_name": gname,
           "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.operators.insert_one(doc)
    note(request, entity_type="operator", entity_id=str(result.inserted_id), label=doc.get("display_name", ""), summary=f"Created operator " + str(doc.get("display_name", "")))
    return {"id": str(result.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}

@api_router.put("/operators/{operator_id}")
async def update_operator(operator_id: str, data: OperatorUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    if "group_id" in update:
        gid, gname = await group_name_for(db.operator_groups, update["group_id"])
        update.update(group_id=gid, group_name=gname)
    if "name" in update:
        op = await db.operators.find_one({"_id": ObjectId(operator_id)})
        if op:
            update["display_name"] = f"{update['name']} ({op.get('operator_code', '')})"
    before = await label_for(request, db.operators, operator_id, "display_name", "operator")
    note(request, before={k: before.get(k) for k in update} if before else None, after=update)
    await db.operators.update_one({"_id": ObjectId(operator_id)}, {"$set": update})
    op = await db.operators.find_one({"_id": ObjectId(operator_id)})
    return serialize_doc(op)

@api_router.delete("/operators/{operator_id}")
async def delete_operator(operator_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    await label_for(request, db.operators, operator_id, "display_name", "operator")
    await db.operators.delete_one({"_id": ObjectId(operator_id)})
    return {"message": "Deleted"}

# ===== OPERATION ROUTES =====

@api_router.get("/operations")
async def get_operations(request: Request):
    await get_current_user(request)
    ops = await db.operations.find().sort("name", 1).to_list(1000)
    return [serialize_doc(o) for o in ops]

@api_router.post("/operations")
async def create_operation(data: OperationCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    existing = await db.operations.find_one({"name": {"$regex": f"^{data.name}$", "$options": "i"}})
    if existing:
        raise HTTPException(400, f"Operation '{data.name}' already exists")
    gid, gname = await group_name_for(db.operation_groups, data.group_id)
    doc = {"name": data.name, "group_id": gid, "group_name": gname,
           "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.operations.insert_one(doc)
    note(request, entity_type="operation", entity_id=str(result.inserted_id), label=doc.get("name", ""), summary=f"Created operation " + str(doc.get("name", "")))
    return {"id": str(result.inserted_id), "name": data.name, "active": True, "created_at": doc["created_at"],
            "group_id": gid, "group_name": gname}

@api_router.put("/operations/{operation_id}")
async def update_operation(operation_id: str, data: OperationUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    if "group_id" in update:
        gid, gname = await group_name_for(db.operation_groups, update["group_id"])
        update.update(group_id=gid, group_name=gname)
    before = await label_for(request, db.operations, operation_id, "name", "operation")
    note(request, before={k: before.get(k) for k in update} if before else None, after=update)
    await db.operations.update_one({"_id": ObjectId(operation_id)}, {"$set": update})
    op = await db.operations.find_one({"_id": ObjectId(operation_id)})
    return serialize_doc(op)

@api_router.delete("/operations/{operation_id}")
async def delete_operation(operation_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    await label_for(request, db.operations, operation_id, "name", "operation")
    await db.operations.delete_one({"_id": ObjectId(operation_id)})
    return {"message": "Deleted"}

# ===== COLORS MASTER ROUTES =====

@api_router.get("/colors")
async def get_colors(request: Request):
    await get_current_user(request)
    colors = await db.colors_master.find().sort("name", 1).to_list(1000)
    return [serialize_doc(c) for c in colors]

@api_router.post("/colors")
async def create_color(data: ColorMasterCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    existing = await db.colors_master.find_one({"name": {"$regex": f"^{data.name}$", "$options": "i"}})
    if existing:
        raise HTTPException(400, f"Color '{data.name}' already exists")
    doc = {"name": data.name, "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.colors_master.insert_one(doc)
    note(request, entity_type="color", entity_id=str(result.inserted_id), label=doc.get("name", ""), summary=f"Created color " + str(doc.get("name", "")))
    return {"id": str(result.inserted_id), "name": data.name, "active": True}

@api_router.put("/colors/{color_id}")
async def update_color(color_id: str, data: ColorMasterUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields")
    await db.colors_master.update_one({"_id": ObjectId(color_id)}, {"$set": update})
    c = await db.colors_master.find_one({"_id": ObjectId(color_id)})
    return serialize_doc(c)

@api_router.delete("/colors/{color_id}")
async def delete_color(color_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    await label_for(request, db.colors_master, color_id, "name", "color")
    await db.colors_master.delete_one({"_id": ObjectId(color_id)})
    return {"message": "Deleted"}

# ===== SIZE CHART ROUTES =====

@api_router.get("/size-charts")
async def get_size_charts(request: Request):
    await get_current_user(request)
    charts = await db.size_charts.find().sort("name", 1).to_list(1000)
    return [serialize_doc(c) for c in charts]

@api_router.post("/size-charts")
async def create_size_chart(data: SizeChartCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    existing = await db.size_charts.find_one({"name": {"$regex": f"^{data.name}$", "$options": "i"}})
    if existing:
        raise HTTPException(400, f"Size chart '{data.name}' already exists")
    doc = {"name": data.name, "sizes": data.sizes, "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.size_charts.insert_one(doc)
    note(request, entity_type="size_chart", entity_id=str(result.inserted_id), label=doc.get("name", ""), summary=f"Created size_chart " + str(doc.get("name", "")))
    return {"id": str(result.inserted_id), "name": data.name, "sizes": data.sizes, "active": True}

@api_router.put("/size-charts/{chart_id}")
async def update_size_chart(chart_id: str, data: SizeChartUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields")
    await db.size_charts.update_one({"_id": ObjectId(chart_id)}, {"$set": update})
    c = await db.size_charts.find_one({"_id": ObjectId(chart_id)})
    return serialize_doc(c)

@api_router.delete("/size-charts/{chart_id}")
async def delete_size_chart(chart_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    await label_for(request, db.size_charts, chart_id, "name", "size_chart")
    await db.size_charts.delete_one({"_id": ObjectId(chart_id)})
    return {"message": "Deleted"}

# ===== WEEKS ROUTES =====

@api_router.get("/weeks")
async def get_weeks(request: Request, year: Optional[int] = None):
    await get_current_user(request)
    query = {"year": year} if year else {}
    weeks = await db.weeks.find(query).sort([("year", -1), ("week_number", 1)]).to_list(1000)
    return [serialize_doc(w) for w in weeks]

@api_router.post("/weeks")
async def create_week(data: WeekCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    existing = await db.weeks.find_one({"week_number": data.week_number, "year": data.year})
    if existing:
        raise HTTPException(400, f"Week {data.week_number} for year {data.year} already exists")
    doc = {"week_number": data.week_number, "year": data.year, "start_date": data.start_date,
           "end_date": data.end_date, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.weeks.insert_one(doc)
    note(request, entity_type="week", entity_id=str(result.inserted_id), label=f"Week {doc.get('week_number')}/{doc.get('year')}", summary=f"Created week " + str(f"Week {doc.get('week_number')}/{doc.get('year')}"))
    return {"id": str(result.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}

@api_router.post("/weeks/generate")
async def generate_weeks(request: Request, year: int = Query(...), start_date: str = Query(...), week_start_day: str = Query(default="monday")):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    start = datetime.strptime(start_date, "%Y-%m-%d")
    weeks_created = []
    week_num = 1
    current = start
    year_end = datetime(year, 12, 31)
    while current <= year_end:
        end = current + timedelta(days=6)
        doc = {"week_number": week_num, "year": year, "start_date": current.strftime("%Y-%m-%d"),
               "end_date": end.strftime("%Y-%m-%d"), "created_at": datetime.now(timezone.utc).isoformat()}
        existing = await db.weeks.find_one({"week_number": week_num, "year": year})
        if not existing:
            await db.weeks.insert_one(doc)
            weeks_created.append(week_num)
        current = end + timedelta(days=1)
        week_num += 1
    return {"message": f"Generated {len(weeks_created)} weeks", "weeks_created": weeks_created}

@api_router.delete("/weeks/{week_id}")
async def delete_week(week_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    has_entries = await db.production_entries.count_documents({"week_id": week_id})
    if has_entries > 0:
        raise HTTPException(400, "Cannot delete week with production entries")
    await label_for(request, db.weeks, week_id, "week_number", "week")
    await db.weeks.delete_one({"_id": ObjectId(week_id)})
    return {"message": "Deleted"}

# ===== LOT ROUTES =====

def clean_allowance(value) -> float:
    try:
        pct = float(value or 0)
    except (TypeError, ValueError):
        raise HTTPException(400, "Allowance must be a number")
    if pct < 0 or pct > 50:
        raise HTTPException(400, "Allowance must be between 0% and 50%")
    return round(pct, 2)


def clean_quantity_control(raw, previous=None):
    """over_tolerance_pct: extra beyond plan that needs approval (0 = strict).
    warn_at_pct: when the entry grid starts warning. locked: {"Colour|Size": True}."""
    base = {"over_tolerance_pct": 0.0, "warn_at_pct": 90.0, "locked": {}}
    qc = {**base, **(previous or {})}
    if raw is None:
        return qc
    try:
        if "over_tolerance_pct" in raw:
            qc["over_tolerance_pct"] = round(float(raw["over_tolerance_pct"] or 0), 2)
        if "warn_at_pct" in raw:
            qc["warn_at_pct"] = round(float(raw["warn_at_pct"] or 90), 2)
    except (TypeError, ValueError):
        raise HTTPException(400, "Quantity control values must be numbers")
    if not 0 <= qc["over_tolerance_pct"] <= 50:
        raise HTTPException(400, "Over-production tolerance must be between 0% and 50%")
    if not 1 <= qc["warn_at_pct"] <= 100:
        raise HTTPException(400, "Warning level must be between 1% and 100%")
    if "locked" in raw:
        qc["locked"] = {str(k): True for k, v in (raw.get("locked") or {}).items() if v}
    return qc


def build_lot_colors(color_names, quantities, sizes, allowance_pct, old_colors=None):
    """Each cell keeps what was ORDERED and what is PLANNED (order + allowance,
    rounded half-up per cell). `planned_qty` is the number every production
    control already uses, so none of them had to change."""
    old = {c["name"]: c for c in (old_colors or [])}
    colors = []
    for cname in color_names:
        cell = (quantities or {}).get(cname, {}) or {}
        entries = []
        for sz in sizes:
            order = plan_qty(cell.get(sz, 0))
            entries.append({"size": sz, "order_qty": order, "planned_qty": planned_from_order(order, allowance_pct)})
        # keep the id of a colour that already exists; it used to be regenerated on every save
        colors.append({"color_id": (old.get(cname) or {}).get("color_id") or str(uuid.uuid4()),
                       "name": cname, "sizes": entries})
    return colors


async def build_lot_operations(op_entries, sizes, strict_operators=True):
    """Operations with their operators and rate card. The default rate type's flat
    rate stays on `rate` (what every older reader expects); the full card, including
    per-size overrides and other rate types, lives in `rates`."""
    default = await default_rate_type()
    operations = []
    for op_entry in op_entries:
        if not ObjectId.is_valid(op_entry.operation_id):
            raise HTTPException(400, "Operation not found")
        operation = await db.operations.find_one({"_id": ObjectId(op_entry.operation_id)})
        if not operation:
            raise HTTPException(400, f"Operation {op_entry.operation_id} not found")
        operators = []
        for op_id in op_entry.operator_ids:
            operator = await db.operators.find_one({"_id": ObjectId(op_id)}) if ObjectId.is_valid(op_id) else None
            if not operator:
                if strict_operators:
                    raise HTTPException(400, f"Operator {op_id} not found")
                continue
            operators.append({"operator_id": op_id, "operator_name": operator["name"],
                              "operator_code": operator.get("operator_code", "")})
        try:
            flat = parse_money(op_entry.rate)
            srates = clean_size_rates(op_entry.size_rates, sizes)
            rows = [{"rate_type_id": default["id"], "rate_type_name": default["name"], "rate": flat, "size_rates": srates}]
            seen = {default["id"]}
            for extra in op_entry.extra_rates:
                if extra.rate_type_id in seen:
                    raise ValueError("Each rate type can only be set once per operation")
                rt = await get_rate_type(extra.rate_type_id)
                seen.add(rt["id"])
                rows.append({"rate_type_id": rt["id"], "rate_type_name": rt["name"],
                             "rate": parse_money(extra.rate), "size_rates": clean_size_rates(extra.size_rates, sizes)})
        except ValueError as exc:
            raise HTTPException(400, f"{operation['name']}: {exc}")
        operations.append({"operation_id": op_entry.operation_id, "operation_name": operation["name"],
                           "group_name": operation.get("group_name", ""),
                           "rate": flat, "size_rates": srates, "rates": rows, "operators": operators})
    return operations


async def enrich_lot(lot):
    """Attach planned/produced/progress figures to a lot.

    Every operation in a lot is applied to *every* piece, so a 300-piece lot with
    3 operations generates 900 pieces of production entries. Summing them all and
    calling that "produced" is what made lots report 300% progress.

    A piece only counts as produced once it has been through every operation on
    the lot, so lot-level output is the *minimum* across operations. The
    per-operation figures are returned alongside so the UI can show where the
    bottleneck is.
    """
    total_planned = total_order = 0
    for color in lot.get("colors", []):
        color_total = sum(s.get("planned_qty", 0) for s in color.get("sizes", []))
        color_order = sum(s.get("order_qty", s.get("planned_qty", 0)) for s in color.get("sizes", []))
        color["total"] = color_total
        color["total_order"] = color_order
        total_planned += color_total
        total_order += color_order
    lot["total_planned_qty"] = total_planned
    lot["total_order_qty"] = total_order                 # old lots: order == planned
    lot["allowance_pct"] = lot.get("allowance_pct", 0)
    lot["allowance_qty"] = total_planned - total_order
    lot["quantity_control"] = clean_quantity_control(None, lot.get("quantity_control"))

    lot_id = lot.get("id", "")
    # pieces only count as produced when the rate type counts toward the plan;
    # sample/rework are paid but are not new finished pieces
    pipeline = [
        {"$match": {"lot_id": lot_id}},
        {"$group": {"_id": {"op": "$operation_id", "plan": {"$ne": ["$counts_toward_plan", False]}},
                    "total": {"$sum": "$total_quantity"}, "earnings": {"$sum": "$total_earnings"}}},
    ]
    agg = await db.production_entries.aggregate(pipeline).to_list(500)
    by_operation, non_plan_qty, non_plan_cost = {}, 0, 0.0
    for a in agg:
        op_id = a["_id"]["op"]
        slot = by_operation.setdefault(op_id, {"total": 0, "earnings": 0.0})
        slot["earnings"] += a["earnings"]
        if a["_id"]["plan"]:
            slot["total"] += a["total"]
        else:
            non_plan_qty += a["total"]
            non_plan_cost += a["earnings"]

    lot_operations = lot.get("operations", [])
    op_progress = []
    for op in lot_operations:
        done = by_operation.get(op["operation_id"], {})
        qty = done.get("total", 0)
        op_progress.append({
            "operation_id": op["operation_id"],
            "operation_name": op.get("operation_name", ""),
            "rate": op.get("rate", 0),
            "produced_qty": qty,
            "balance_qty": total_planned - qty,
            "cost": round(done.get("earnings", 0), 2),
            "progress": round((qty / total_planned * 100) if total_planned > 0 else 0, 1),
        })
    lot["operation_progress"] = op_progress

    # a piece is finished only when the slowest operation has covered it
    if op_progress:
        total_produced = min(o["produced_qty"] for o in op_progress)
    else:
        total_produced = 0

    lot["total_produced_qty"] = total_produced
    lot["balance_qty"] = total_planned - total_produced
    lot["progress"] = round((total_produced / total_planned * 100) if total_planned > 0 else 0, 1)
    # total pieces handled across every operation - useful, but not "produced"
    lot["total_operation_qty"] = sum(o["produced_qty"] for o in op_progress)
    lot["total_labour_cost"] = round(sum(o["cost"] for o in op_progress), 2)
    lot["non_plan_qty"] = non_plan_qty
    lot["non_plan_cost"] = round(non_plan_cost, 2)
    return lot

def hide_money_from_lot(lot):
    """Data-entry staff pick a lot, operation and colour to record output, but they must
    never see what anything pays. Names, sizes, quantities and progress stay; every rate,
    rate card and labour cost is removed."""
    for op in lot.get("operations", []):
        op.pop("rate", None)
        op.pop("size_rates", None)
        op["rates"] = [{"rate_type_id": r.get("rate_type_id"), "rate_type_name": r.get("rate_type_name")}
                       for r in op.get("rates", [])]
    for prog in lot.get("operation_progress", []):
        prog.pop("rate", None)
        prog.pop("cost", None)
    lot.pop("total_labour_cost", None)
    lot.pop("non_plan_cost", None)
    return lot


@api_router.get("/lots")
async def get_lots(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts", "data_entry"])
    clerk = user["role"] == "data_entry"
    if not clerk:
        check_permission(user, "can_view_financial")
    # a data-entry user only ever needs the lots that are open for entry
    query = {"status": "active"} if clerk else ({"status": status} if status else {})
    lots = await db.lots.find(query).sort("lot_number", -1).to_list(1000)
    result = []
    for lot in lots:
        lot = serialize_doc(lot)
        lot = await enrich_lot(lot)
        result.append(hide_money_from_lot(lot) if clerk else lot)
    return result

@api_router.post("/lots")
async def create_lot(data: LotCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    lot_number = await get_next_lot_number()
    size_chart = await db.size_charts.find_one({"_id": ObjectId(data.size_chart_id)})
    if not size_chart:
        raise HTTPException(400, "Size chart not found")
    sizes = size_chart["sizes"]
    allowance = clean_allowance(data.allowance_pct)
    colors = build_lot_colors(data.color_names, data.color_size_quantities, sizes, allowance)
    operations = await build_lot_operations(data.operations, sizes)
    doc = {
        "lot_number": lot_number, "style_name": data.style_name,
        "start_date": data.start_date, "target_end_date": data.target_end_date,
        "status": "active", "size_chart_id": data.size_chart_id,
        "size_chart_name": size_chart["name"], "sizes": sizes,
        "allowance_pct": allowance, "quantity_control": clean_quantity_control(data.quantity_control),
        "colors": colors, "operations": operations,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.lots.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    note(request, entity_type="lot", entity_id=doc["id"], label=lot_number,
         summary=f"Created lot {lot_number} ({data.style_name})")
    return await enrich_lot(doc)

@api_router.get("/lots/{lot_id}")
async def get_lot(lot_id: str, request: Request):
    user = await get_current_user(request)
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    lot = serialize_doc(lot)
    lot = await enrich_lot(lot)
    return hide_money_from_lot(lot) if user["role"] == "data_entry" else lot

def plan_qty(value) -> int:
    """A grid cell as a whole, non-negative number of pieces. The lot form sends
    strings, and a cleared cell arrives as "" -- int("") used to raise a 500."""
    try:
        n = int(float(str(value).strip() or 0))
    except (TypeError, ValueError):
        raise HTTPException(400, f"'{value}' is not a valid quantity")
    if n < 0:
        raise HTTPException(400, "Quantities cannot be negative")
    return n


async def produced_by_cell(lot_id: str):
    """{(colour, size): most pieces any single operation has produced}.
    Every operation covers every piece, so the plan can never drop below the
    busiest operation. Also returns the set of operations that have entries."""
    per_op, ops_used = {}, set()
    async for e in db.production_entries.find({"lot_id": lot_id}, {"color": 1, "operation_id": 1, "size_quantities": 1}):
        ops_used.add(e.get("operation_id"))
        for sz, qty in (e.get("size_quantities") or {}).items():
            key = (e.get("color", ""), sz, e.get("operation_id"))
            per_op[key] = per_op.get(key, 0) + qty
    cell = {}
    for (color, sz, _op), qty in per_op.items():
        cell[(color, sz)] = max(cell.get((color, sz), 0), qty)
    return cell, ops_used


@api_router.put("/lots/{lot_id}")
async def update_lot(lot_id: str, data: LotUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if not ObjectId.is_valid(lot_id):
        raise HTTPException(404, "Lot not found")
    prior = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not prior:
        raise HTTPException(404, "Lot not found")
    update = {}
    for field in ["style_name", "start_date", "target_end_date", "status"]:
        val = getattr(data, field)
        if val is not None:
            update[field] = val

    produced_cell, ops_used = await produced_by_cell(lot_id)
    has_production = bool(ops_used)
    sizes = prior.get("sizes", [])

    allowance = clean_allowance(data.allowance_pct) if data.allowance_pct is not None else prior.get("allowance_pct", 0)
    if data.allowance_pct is not None:
        update["allowance_pct"] = allowance
    if data.quantity_control is not None:
        update["quantity_control"] = clean_quantity_control(data.quantity_control, prior.get("quantity_control"))

    # the allowance may change on its own: rebuild the plan from the stored ORDER quantities
    quantities = data.color_size_quantities
    if quantities is None and data.allowance_pct is not None:
        quantities = {c["name"]: {s["size"]: s.get("order_qty", s["planned_qty"]) for s in c.get("sizes", [])}
                      for c in prior.get("colors", [])}
    if quantities is not None:
        colors = build_lot_colors(list(quantities.keys()), quantities, sizes, allowance, prior.get("colors"))
        problems = []
        for c in colors:
            for sz in c["sizes"]:
                done = produced_cell.get((c["name"], sz["size"]), 0)
                if sz["planned_qty"] < done:
                    problems.append(f"{c['name']} {sz['size']}: plan {sz['planned_qty']} is below the {done} already produced")
        kept = {c["name"] for c in colors}
        for (cname, _sz), done in produced_cell.items():
            if cname not in kept and done > 0:
                problems.append(f"Colour {cname} cannot be removed: pieces are already recorded against it")
        if problems:
            raise HTTPException(400, "; ".join(sorted(set(problems))))
        update["colors"] = colors

    if data.operations is not None:
        operations = await build_lot_operations(data.operations, sizes, strict_operators=False)
        dropped = ops_used - {o["operation_id"] for o in operations}
        if dropped:
            names = [o.get("operation_name") for o in prior.get("operations", []) if o["operation_id"] in dropped]
            raise HTTPException(400, f"Operation {', '.join(map(str, names)) or ''} cannot be removed: "
                                     "production is already recorded against it")
        update["operations"] = operations
    if not update:
        raise HTTPException(400, "No fields to update")

    # what actually changed, so the approval record and the log say something useful
    def plan_view(cols):
        return {c["name"]: {s["size"]: s["planned_qty"] for s in c.get("sizes", [])} for c in cols or []}
    default = await default_rate_type()

    def rate_view(ops):
        return {o.get("operation_name", ""): [(r.get("rate_type_id"), r.get("rate"), r.get("size_rates") or {})
                                              for r in lot_op_rates(o, default)] for o in ops or []}
    plan_changed = "colors" in update and plan_view(update["colors"]) != plan_view(prior.get("colors"))
    rates_changed = "operations" in update and rate_view(update["operations"]) != rate_view(prior.get("operations"))
    operators_changed = "operations" in update and (
        {o["operation_id"]: sorted(x["operator_id"] for x in o.get("operators", [])) for o in update["operations"]}
        != {o["operation_id"]: sorted(x["operator_id"] for x in o.get("operators", [])) for o in prior.get("operations", [])})

    await db.lots.update_one({"_id": ObjectId(lot_id)}, {"$set": update})
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    label = lot.get("lot_number", "")

    approval_id = None
    if has_production:
        if rates_changed:
            approval_id = await record_auto(
                request, user, "rate_change", "lot", lot_id, label,
                f"Rates changed on {label} after production started (affects entries from now on)",
                before=rate_view(prior.get("operations")), after=rate_view(update["operations"]))
        if plan_changed or operators_changed:
            approval_id = await record_auto(
                request, user, "lot_edit_after_production", "lot", lot_id, label,
                f"{label} edited after production started",
                before={"plan": plan_view(prior.get("colors"))} if plan_changed else None,
                after={"plan": plan_view(update["colors"])} if plan_changed else None) or approval_id

    simple = ("style_name", "start_date", "target_end_date", "status", "allowance_pct", "quantity_control")
    note(request, entity_type="lot", entity_id=lot_id, label=label, approval_id=approval_id,
         summary=f"Updated lot {label}: " + ", ".join(update.keys()),
         before={k: prior.get(k) for k in update if k in simple} or None,
         after={k: v for k, v in update.items() if k in simple} or None)
    lot = serialize_doc(lot)
    return await enrich_lot(lot)

@api_router.delete("/lots/{lot_id}")
async def delete_lot(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    check_permission(user, "can_delete")
    # Deleting a lot also wiped its production entries, which silently rewrote
    # payroll history: advances stayed adjusted against earnings that no longer
    # existed, so re-running a past week no longer matched what was paid.
    # `delete_week` already refuses in this situation; lots now behave the same.
    await label_for(request, db.lots, lot_id, "lot_number", "lot")
    entry_count = await db.production_entries.count_documents({"lot_id": lot_id})
    if entry_count > 0:
        raise HTTPException(400,
            f"This lot has {entry_count} production entries and operators have been paid "
            f"against them. Close the lot instead of deleting it.")
    await db.lots.delete_one({"_id": ObjectId(lot_id)})
    return {"message": "Deleted"}

@api_router.post("/lots/{lot_id}/close")
async def close_lot(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    reason = body.get("reason", "")
    closing = await label_for(request, db.lots, lot_id, "lot_number", "lot")
    note(request, summary=f"Closed lot {closing.get('lot_number','') if closing else ''}. {reason}".strip(),
         after={"status": "completed", "reason": reason})
    await db.lots.update_one({"_id": ObjectId(lot_id)}, {"$set": {
        "status": "completed", "closed_by": user["id"], "closed_by_name": user.get("name", ""),
        "closed_at": datetime.now(timezone.utc).isoformat(), "close_reason": reason
    }})
    await db.notifications.insert_one({"type": "lot_closed", "message": f"Lot closed by {user.get('name','')}",
        "lot_id": lot_id, "created_at": datetime.now(timezone.utc).isoformat(), "read": False})
    return {"message": "Lot closed"}

@api_router.post("/lots/{lot_id}/reopen")
async def reopen_lot(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    reason = body.get("reason", "")
    if not reason:
        raise HTTPException(400, "Reason is required to reopen a lot")
    reopening = await label_for(request, db.lots, lot_id, "lot_number", "lot")
    reopen_id = await record_auto(request, user, "lot_reopen", "lot", lot_id,
                                  reopening.get("lot_number", "") if reopening else "",
                                  f"Reopened {reopening.get('lot_number', '') if reopening else ''}: {reason}",
                                  before={"status": "completed"}, after={"status": "active"}, reason=reason)
    note(request, summary=f"Reopened lot {reopening.get('lot_number','') if reopening else ''}: {reason}",
         after={"status": "active", "reason": reason}, approval_id=reopen_id)
    await db.lots.update_one({"_id": ObjectId(lot_id)}, {"$set": {
        "status": "active", "reopened_by": user["id"], "reopened_by_name": user.get("name", ""),
        "reopened_at": datetime.now(timezone.utc).isoformat(), "reopen_reason": reason
    }})
    return {"message": "Lot reopened"}

# ===== PRODUCTION ROUTES =====

@api_router.get("/production")
async def get_production(request: Request, lot_id: Optional[str] = None, week_id: Optional[str] = None,
                         week: Optional[int] = None, year: Optional[int] = None,
                         operator_id: Optional[str] = None, operation_id: Optional[str] = None,
                         date: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if lot_id: query["lot_id"] = lot_id
    if week_id: query["week_id"] = week_id
    if week: query["week_number"] = week
    if year: query["year"] = year
    if operator_id: query["operator_id"] = operator_id
    if operation_id: query["operation_id"] = operation_id
    if date: query["date"] = date
    if date_from and date_to: query["date"] = {"$gte": date_from, "$lte": date_to}
    elif date_from: query["date"] = {"$gte": date_from}
    elif date_to: query["date"] = {"$lte": date_to}
    entries = await db.production_entries.find(query).sort("created_at", -1).to_list(10000)
    result = [serialize_doc(e) for e in entries]
    if user.get("role") == "data_entry":
        for e in result:
            for money_field in ("rate", "rate_flat", "size_rates", "total_earnings"):
                e.pop(money_field, None)
    return result

@api_router.get("/production/tracking/{lot_id}")
async def get_lot_tracking(lot_id: str, request: Request, operation_id: Optional[str] = None):
    await get_current_user(request)
    if not ObjectId.is_valid(lot_id):
        raise HTTPException(404, "Lot not found")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    query = {"lot_id": lot_id, "counts_toward_plan": {"$ne": False}}
    if operation_id:
        query["operation_id"] = operation_id
    entries = await db.production_entries.find(query).to_list(10000)
    produced = {}
    for e in entries:
        color = e.get("color", "")
        if color not in produced:
            produced[color] = {}
        for size, qty in e.get("size_quantities", {}).items():
            produced[color][size] = produced[color].get(size, 0) + qty
    qc = clean_quantity_control(None, lot.get("quantity_control"))
    tolerance = qc["over_tolerance_pct"]
    tracking = []
    for color in lot.get("colors", []):
        ct = {"name": color["name"], "sizes": [], "total_planned": 0, "total_produced": 0}
        for size in color.get("sizes", []):
            planned = size["planned_qty"]
            prod = produced.get(color["name"], {}).get(size["size"], 0)
            ct["sizes"].append({"size": size["size"], "planned": planned, "produced": prod, "balance": planned - prod,
                                "locked": bool(qc["locked"].get(f"{color['name']}|{size['size']}")),
                                "max_with_tolerance": planned_from_order(planned, tolerance),
                                "warn": planned > 0 and prod * 100 >= planned * qc["warn_at_pct"]})
            ct["total_planned"] += planned
            ct["total_produced"] += prod
        ct["balance"] = ct["total_planned"] - ct["total_produced"]
        tracking.append(ct)
    return tracking

async def assert_within_plan(lot, color, operation_id, add_qty, exclude_entry_id=None, allow_override=False):
    """Reject quantities that would take a lot/colour/operation past its plan.

    This is the control that stops payroll inflation at source. It is called from
    the batch-entry route, the edit route and approval apply -- editing an entry
    used to skip it entirely, which made the whole guard bypassable.

    `add_qty` is {size: qty} being proposed. `exclude_entry_id` omits the entry
    being edited from the existing totals, so an edit is measured against its
    replacement rather than counted twice. Only pieces whose rate type counts
    toward the plan are measured (sample/rework are paid but not new pieces).

    A lot may allow a small over-production tolerance, but only with approval:
    inside the tolerance this raises 409 {code: needs_approval}; with
    `allow_override` (an approved request) it passes; beyond it, always 400.
    """
    color_info = next((c for c in lot.get("colors", []) if c["name"] == color), None)
    if not color_info:
        raise HTTPException(400, "Color not found in this lot")
    planned_qty = {s["size"]: s["planned_qty"] for s in color_info.get("sizes", [])}
    qc = clean_quantity_control(None, lot.get("quantity_control"))

    locked = [sz for sz, qty in add_qty.items() if qty > 0 and qc["locked"].get(f"{color}|{sz}")]
    if locked:
        raise HTTPException(400, f"{color} {', '.join(locked)} is locked by the administrator. No more entries can be recorded.")

    query = {"lot_id": str(lot["_id"]) if "_id" in lot else lot.get("id", ""),
             "color": color, "operation_id": operation_id, "counts_toward_plan": {"$ne": False}}
    if exclude_entry_id:
        query["_id"] = {"$ne": ObjectId(exclude_entry_id)}
    existing = await db.production_entries.find(query).to_list(10000)

    existing_qty = {}
    for e in existing:
        for sz, qty in e.get("size_quantities", {}).items():
            existing_qty[sz] = existing_qty.get(sz, 0) + qty

    errors, needs_approval, excess = [], [], {}
    for sz, qty in add_qty.items():
        if qty <= 0:
            continue
        total = existing_qty.get(sz, 0) + qty
        planned = planned_qty.get(sz, 0)
        if total > planned:
            ceiling = planned_from_order(planned, qc["over_tolerance_pct"])
            msg = f"{sz}: {total}/{planned} exceeds planned"
            if qc["over_tolerance_pct"] > 0 and total <= ceiling:
                needs_approval.append(msg)
                excess[sz] = total - planned
            else:
                errors.append(msg)
    if errors:
        raise HTTPException(400, f"Quantity exceeds planned limit: {'; '.join(errors)}")
    if needs_approval and not allow_override:
        raise HTTPException(409, detail={
            "code": "needs_approval", "excess": excess,
            "message": f"Over the plan but within the {qc['over_tolerance_pct']}% tolerance: "
                       f"{'; '.join(needs_approval)}. An administrator must approve the extra pieces."})


def entry_rate_card(entry):
    """(flat, {size: rate}) recorded on an entry. Entries written before per-size
    rates only have `rate`."""
    return entry.get("rate_flat", entry.get("rate", 0)), entry.get("size_rates") or {}


def entry_money(entry, size_quantities):
    """(pieces, money) for a changed set of quantities, from the entry's own rate
    snapshot so editing a lot's rate card later never reprices old entries."""
    flat, size_rates = entry_rate_card(entry)
    return compute_earnings(size_quantities, flat, size_rates)


async def run_batch(data: ProductionBatchCreate, user: dict, allow_override=False, dry_run=False):
    lot = await db.lots.find_one({"_id": ObjectId(data.lot_id)}) if ObjectId.is_valid(data.lot_id) else None
    if not lot:
        raise HTTPException(400, "Lot not found")
    if lot.get("status") == "completed":
        raise HTTPException(400, "This lot is closed. No further production entry allowed.")
    week = await db.weeks.find_one({"_id": ObjectId(data.week_id)}) if ObjectId.is_valid(data.week_id) else None
    if not week:
        raise HTTPException(400, "Week not found")
    op_info = next((op for op in lot.get("operations", []) if op["operation_id"] == data.operation_id), None)
    if not op_info:
        raise HTTPException(400, "Operation not found in this lot")
    color_info = next((c for c in lot.get("colors", []) if c["name"] == data.color), None)
    if not color_info:
        raise HTTPException(400, "Color not found in this lot")

    default_type = await default_rate_type()
    rate_type = await get_rate_type(data.rate_type_id) if data.rate_type_id else default_type
    card = find_rate(op_info, rate_type["id"], default_type)
    if card is None:
        raise HTTPException(400, f"No {rate_type['name']} rate has been set for {op_info['operation_name']} on this lot")
    flat_rate, size_rates = card
    counts = rate_type.get("counts_toward_plan", True)
    is_default = rate_type["id"] == default_type["id"]

    live_op = await db.operations.find_one({"_id": ObjectId(data.operation_id)})
    new_qty = {}
    for entry in data.entries:
        for sz, qty in entry.sizes.items():
            q = int(qty) if qty else 0
            if q < 0:
                raise HTTPException(400, "Quantities cannot be negative")
            if q > 0:
                new_qty[sz] = new_qty.get(sz, 0) + q
    if counts:
        await assert_within_plan(lot, data.color, data.operation_id, new_qty, allow_override=allow_override)
    else:
        # paid but not planned: capped per lot and operation when the owner has set a cap
        planned_total = sum(s["planned_qty"] for c in lot.get("colors", []) for s in c.get("sizes", []))
        cap = None
        if rate_type.get("cap_pieces") is not None:
            cap = rate_type["cap_pieces"]
        if rate_type.get("cap_pct_of_plan") is not None:
            pct_cap = planned_from_order(planned_total, 0) * rate_type["cap_pct_of_plan"] / 100
            cap = pct_cap if cap is None else min(cap, pct_cap)
        if cap is not None:
            already = 0
            async for e in db.production_entries.find({"lot_id": data.lot_id, "operation_id": data.operation_id,
                                                       "rate_type_id": rate_type["id"]}, {"total_quantity": 1}):
                already += e.get("total_quantity", 0)
            if already + sum(new_qty.values()) > cap:
                raise HTTPException(400, f"{rate_type['name']} pieces for this operation are capped at {int(cap)} "
                                         f"({already} already recorded).")

    dup_warnings, saved = [], []
    for entry in data.entries:
        operator = await db.operators.find_one({"_id": ObjectId(entry.operator_id)}) if ObjectId.is_valid(entry.operator_id) else None
        if not operator:
            continue
        size_quantities = {k: int(v) for k, v in entry.sizes.items() if int(v or 0) > 0}
        total_qty = sum(size_quantities.values())
        if total_qty == 0:
            continue
        # Duplicate = the SAME operator, on the SAME day, for the same
        # lot/operation/colour/rate type. `date` used to be missing from this key,
        # which meant only the first day of each week could ever be saved.
        # Entries from before rate types existed have no rate_type_id: they are Regular.
        dup_query = {"week_id": data.week_id, "lot_id": data.lot_id, "operation_id": data.operation_id,
                     "color": data.color, "operator_id": entry.operator_id, "date": data.date,
                     "rate_type_id": {"$in": [rate_type["id"], None]} if is_default else rate_type["id"]}
        if await db.production_entries.find_one(dup_query):
            dup_warnings.append(
                f"{operator['name']} ({operator.get('operator_code','')}) already has an entry for {data.date}")
            continue
        qty_done, money = compute_earnings(size_quantities, flat_rate, size_rates)
        doc = {
            "week_id": data.week_id, "week_number": week.get("week_number"),
            "year": week.get("year"), "lot_id": data.lot_id,
            "lot_number": lot["lot_number"], "style_name": lot["style_name"],
            "operation_id": data.operation_id, "operation_name": op_info["operation_name"],
            "color": data.color,
            "rate": flat_rate if not size_rates else average_rate(size_quantities, flat_rate, size_rates),
            "rate_flat": flat_rate, "size_rates": size_rates,
            "rate_type_id": rate_type["id"], "rate_type_name": rate_type["name"], "counts_toward_plan": counts,
            "operation_group": live_op.get("group_name", "") if live_op else op_info.get("group_name", ""),
            "operator_group": operator.get("group_name", ""),
            "operator_id": entry.operator_id, "operator_name": operator["name"],
            "operator_code": operator.get("operator_code", ""),
            "size_quantities": size_quantities, "total_quantity": qty_done,
            "total_earnings": money,
            "date": data.date, "entered_by": user["id"],
            "entered_by_name": user.get("name", ""),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        if dry_run:
            saved.append(doc)
            continue
        result = await db.production_entries.insert_one(doc)
        doc["id"] = str(result.inserted_id)
        doc.pop("_id", None)
        saved.append(doc)

    if saved and not counts and not dry_run:
        await _maybe_alert_non_plan(lot, data.lot_id)
    return lot, op_info, saved, dup_warnings, rate_type


async def _maybe_alert_non_plan(lot, lot_id):
    """Sample/rework pay is a payroll-inflation path, so tell admins when it gets large."""
    setting = await db.system_settings.find_one({"key": "non_plan_alert_pct"})
    try:
        limit = float(setting["value"]) if setting else 5.0
    except (TypeError, ValueError, KeyError):
        limit = 5.0
    planned_total = sum(s["planned_qty"] for c in lot.get("colors", []) for s in c.get("sizes", []))
    if planned_total <= 0:
        return
    total = 0
    async for e in db.production_entries.find({"lot_id": lot_id, "counts_toward_plan": False}, {"total_quantity": 1}):
        total += e.get("total_quantity", 0)
    if total * 100 > planned_total * limit:
        if not await db.notifications.find_one({"type": "non_plan_alert", "lot_id": lot_id, "read": False}):
            await db.notifications.insert_one({
                "type": "non_plan_alert", "lot_id": lot_id, "audience": "admin", "read": False,
                "message": f"{lot['lot_number']}: sample/rework pieces ({total}) are over {limit:g}% of the plan",
                "created_at": datetime.now(timezone.utc).isoformat()})


@api_router.post("/production/batch")
async def create_production_batch(data: ProductionBatchCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "data_entry"])
    check_permission(user, "can_enter")
    lot, op_info, saved, dup_warnings, rate_type = await run_batch(data, user)
    note(request, entity_type="production", entity_id=data.lot_id, label=f"{lot['lot_number']} {op_info['operation_name']} {data.color}",
         summary=f"Saved {len(saved)} production entries ({sum(e['total_quantity'] for e in saved)} pcs, {rate_type['name']}) for {data.date}",
         after={"entries": [{"operator": e["operator_name"], "qty": e["total_quantity"], "earnings": e["total_earnings"]} for e in saved],
                "duplicates_skipped": dup_warnings})
    return {"saved": len(saved), "entries": saved, "duplicates_skipped": dup_warnings}

@api_router.delete("/production/{entry_id}")
async def delete_production(entry_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    gone = await db.production_entries.find_one({"_id": ObjectId(entry_id)})
    if gone:
        note(request, entity_type="production", entity_id=entry_id,
             label=f"{gone.get('lot_number','')} {gone.get('operation_name','')} {gone.get('operator_name','')} {gone.get('date','')}",
             summary=f"Deleted {gone.get('total_quantity', 0)} pcs entry by {gone.get('operator_name','')}",
             before={"size_quantities": gone.get("size_quantities"), "total_quantity": gone.get("total_quantity"),
                     "total_earnings": gone.get("total_earnings"), "date": gone.get("date")})
    await db.production_entries.delete_one({"_id": ObjectId(entry_id)})
    return {"message": "Deleted"}

@api_router.put("/production/{entry_id}")
async def edit_production(entry_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    entry = await db.production_entries.find_one({"_id": ObjectId(entry_id)})
    if not entry:
        raise HTTPException(404, "Entry not found")
    old_values = {"size_quantities": entry.get("size_quantities", {}), "total_quantity": entry.get("total_quantity", 0)}

    raw = body.get("size_quantities", {})
    try:
        new_sq = {k: int(v or 0) for k, v in raw.items()}
    except (TypeError, ValueError):
        raise HTTPException(400, "Quantities must be whole numbers")
    if any(v < 0 for v in new_sq.values()):
        raise HTTPException(400, "Quantities cannot be negative")
    # keep only non-zero sizes on the document, but validate the full set
    new_sq = {k: v for k, v in new_sq.items() if v > 0}

    lot = await db.lots.find_one({"_id": ObjectId(entry["lot_id"])})
    if not lot:
        raise HTTPException(400, "Lot for this entry no longer exists")
    if lot.get("status") == "completed":
        raise HTTPException(400, "This lot is closed. Reopen it before editing entries.")
    # the edit route previously skipped this entirely, so the over-production
    # guard could be walked straight past by editing instead of adding
    if entry.get("counts_toward_plan", True):
        await assert_within_plan(lot, entry.get("color", ""), entry.get("operation_id", ""),
                                 new_sq, exclude_entry_id=entry_id)

    new_total, new_earnings = entry_money(entry, new_sq)
    audit = {"edited_by": user["id"], "edited_by_name": user.get("name", ""),
             "edited_at": datetime.now(timezone.utc).isoformat(),
             "reason": body.get("reason", ""),
             "old_values": old_values, "new_values": {"size_quantities": new_sq, "total_quantity": new_total}}
    await db.production_entries.update_one({"_id": ObjectId(entry_id)}, {
        "$set": {"size_quantities": new_sq, "total_quantity": new_total,
                 "total_earnings": new_earnings, "modified_by": user["id"],
                 "modified_by_name": user.get("name", ""), "modified_at": datetime.now(timezone.utc).isoformat()},
        "$push": {"edit_history": audit}
    })
    note(request, entity_type="production", entity_id=entry_id,
         label=f"{entry.get('lot_number','')} {entry.get('operation_name','')} {entry.get('operator_name','')} {entry.get('date','')}",
         summary=f"Edited entry: {old_values['total_quantity']} -> {new_total} pcs. {body.get('reason','')}".strip(),
         before=old_values, after={"size_quantities": new_sq, "total_quantity": new_total})
    return {"message": "Entry updated", "audit": audit}

# ===== PUBLIC ENQUIRIES =====

class EnquiryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    company: str = Field(default="", max_length=150)
    email: str = Field(max_length=254, pattern=r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")
    phone: str = Field(default="", max_length=40)
    message: str = Field(min_length=1, max_length=1500)
    website: str = Field(default="", max_length=200)

    @field_validator("name", "company", "email", "phone", "message")
    @classmethod
    def plain_text(cls, value):
        value = value.strip()
        # Reject markup instead of storing it for a future email renderer to interpret.
        if "<" in value or ">" in value:
            raise ValueError("Use plain text without HTML")
        return value

    @field_validator("name", "message")
    @classmethod
    def not_blank(cls, value):
        if not value:
            raise ValueError("This field is required")
        return value


class EnquiryStatus(BaseModel):
    status: str = Field(pattern="^(new|handled)$")


@api_router.post("/public/enquiry")
async def submit_enquiry(data: EnquiryCreate, request: Request):
    reply = {"message": "Thank you. Your enquiry has been received."}
    if data.website:
        return reply
    now = datetime.now(timezone.utc)
    ip = request.client.host if request.client else "unknown"
    key = f"enquiry:{ip}"
    # A single atomic update makes simultaneous submissions share the same quota.
    limit = await db.rate_limits.find_one_and_update(
        {"_id": key}, [{"$set": {
            "count": {"$cond": [{"$gt": ["$expires_at", now]}, {"$add": ["$count", 1]}, 1]},
            "expires_at": {"$cond": [{"$gt": ["$expires_at", now]}, "$expires_at", now + timedelta(hours=1)]},
        }}], upsert=True, return_document=True)
    if limit["count"] > 5:
        raise HTTPException(429, "Too many enquiries. Please try again later.", headers={"Retry-After": "3600"})
    doc = data.model_dump(exclude={"website"})
    doc.update(created_at=now.isoformat(), ip=ip,
               user_agent=request.headers.get("user-agent", "")[:300], status="new")
    result = await db.enquiries.insert_one(doc)
    await db.notifications.insert_one({"type": "enquiry", "enquiry_id": str(result.inserted_id),
        "audience": "admin", "message": "New website enquiry — open Enquiries to review.",
        "read": False, "created_at": now.isoformat()})
    return reply


@api_router.get("/enquiries")
async def get_enquiries(request: Request, skip: int = Query(0, ge=0)):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    docs = await db.enquiries.find({}, {"ip": 0, "user_agent": 0}).sort("created_at", -1).skip(skip).to_list(50)
    return {"items": [serialize_doc(d) for d in docs], "total": await db.enquiries.count_documents({})}


@api_router.put("/enquiries/{enquiry_id}")
async def update_enquiry(enquiry_id: str, data: EnquiryStatus, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if not ObjectId.is_valid(enquiry_id):
        raise HTTPException(404, "Enquiry not found")
    result = await db.enquiries.update_one({"_id": ObjectId(enquiry_id)}, {"$set": {
        "status": data.status, "updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()}})
    if not result.matched_count:
        raise HTTPException(404, "Enquiry not found")
    await db.notifications.update_many({"enquiry_id": enquiry_id}, {"$set": {"read": data.status == "handled"}})
    return {"status": data.status}


def notification_scope(user):
    """Who sees which notification. `audience` is absent (everyone), "admin", or
    "user:<id>" for a note addressed to one person, e.g. a decision on their request."""
    mine = {"audience": f"user:{user['id']}"}
    if user["role"] == "admin":
        return {"$or": [{"audience": {"$exists": False}}, {"audience": {"$in": ["admin", "all"]}}, mine]}
    return {"$or": [{"audience": {"$exists": False}}, {"audience": "all"}, mine]}


# ===== APPROVAL HANDLERS =====
# What each approvable action means. approvals.py stays generic; these know about
# production entries. Both re-run the normal rules instead of trusting the payload.

def _clean_quantities(raw):
    try:
        sq = {k: int(v or 0) for k, v in (raw or {}).items()}
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(400, "Quantities must be whole numbers")
    if any(v < 0 for v in sq.values()):
        raise HTTPException(400, "Quantities cannot be negative")
    return {k: v for k, v in sq.items() if v > 0}


def _entry_label(e):
    return f"{e.get('lot_number','')} · {e.get('operation_name','')} · {e.get('operator_name','')} · {e.get('date','')}"


def _entry_snapshot(e):
    return {"size_quantities": e.get("size_quantities", {}), "total_quantity": e.get("total_quantity", 0),
            "total_earnings": e.get("total_earnings", 0)}


async def _load_entry(entry_id):
    if not ObjectId.is_valid(entry_id):
        raise HTTPException(404, "Entry not found")
    entry = await db.production_entries.find_one({"_id": ObjectId(entry_id)})
    if not entry:
        raise HTTPException(404, "Entry not found")
    return entry


async def prepare_production_edit(user, entry_id, payload):
    entry = await _load_entry(entry_id)
    new_sq = _clean_quantities((payload or {}).get("size_quantities"))
    if not new_sq:
        raise HTTPException(400, "Enter the corrected quantities you are requesting")
    lot = await db.lots.find_one({"_id": ObjectId(entry["lot_id"])})
    if not lot:
        raise HTTPException(400, "The lot for this entry no longer exists")
    if lot.get("status") == "completed":
        raise HTTPException(400, "This lot is closed. An administrator must reopen it before entries can change.")
    if entry.get("counts_toward_plan", True):
        await assert_within_plan(lot, entry.get("color", ""), entry.get("operation_id", ""), new_sq, exclude_entry_id=entry_id)
    return _entry_label(entry), {"size_quantities": new_sq}, _entry_snapshot(entry)


async def apply_production_edit(approval, reviewer, request):
    try:
        entry = await _load_entry(approval["entity_id"])
    except HTTPException:
        raise ApprovalExpired("The entry no longer exists")
    snap = approval.get("snapshot")
    if snap and (snap.get("size_quantities") != entry.get("size_quantities", {})
                 or snap.get("total_quantity") != entry.get("total_quantity", 0)):
        raise ApprovalExpired("The entry was changed after this request was made. Ask for a fresh request.")
    new_sq = _clean_quantities((approval.get("payload") or {}).get("size_quantities"))
    if not new_sq:
        raise HTTPException(400, "This request carries no quantities to apply. Reject it.")
    lot = await db.lots.find_one({"_id": ObjectId(entry["lot_id"])})
    if not lot:
        raise HTTPException(400, "The lot for this entry no longer exists")
    if lot.get("status") == "completed":
        raise HTTPException(400, "This lot is closed. Reopen it before approving.")
    if entry.get("counts_toward_plan", True):
        await assert_within_plan(lot, entry.get("color", ""), entry.get("operation_id", ""), new_sq,
                                 exclude_entry_id=approval["entity_id"])
    new_total, new_earnings = entry_money(entry, new_sq)           # money always recomputed here, from the entry's own rate card
    now = datetime.now(timezone.utc).isoformat()
    before = {"size_quantities": entry.get("size_quantities", {}), "total_quantity": entry.get("total_quantity", 0)}
    after = {"size_quantities": new_sq, "total_quantity": new_total}
    await db.production_entries.update_one({"_id": entry["_id"]}, {
        "$set": {"size_quantities": new_sq, "total_quantity": new_total, "total_earnings": new_earnings,
                 "modified_by": reviewer["id"], "modified_by_name": reviewer.get("name", ""), "modified_at": now},
        "$push": {"edit_history": {
            "edited_by": reviewer["id"], "edited_by_name": reviewer.get("name", ""), "edited_at": now,
            "reason": approval.get("reason", ""), "source": "approval", "approval_id": str(approval["_id"]),
            "requested_by_name": approval.get("requested_by_name", ""), "old_values": before, "new_values": after}}})
    return {"before": before, "after": after, "total_earnings": new_earnings}


async def prepare_production_delete(user, entry_id, payload):
    entry = await _load_entry(entry_id)
    return _entry_label(entry), {}, _entry_snapshot(entry)


async def apply_production_delete(approval, reviewer, request):
    try:
        entry = await _load_entry(approval["entity_id"])
    except HTTPException:
        raise ApprovalExpired("The entry was already deleted")
    snap = approval.get("snapshot")
    if snap and snap.get("total_quantity") != entry.get("total_quantity", 0):
        raise ApprovalExpired("The entry was changed after this request was made. Ask for a fresh request.")
    await db.production_entries.delete_one({"_id": entry["_id"]})
    return {"before": _entry_snapshot(entry), "after": None, "deleted": True}


approvals.register("production_edit", prepare=prepare_production_edit, apply=apply_production_edit)
approvals.register("production_delete", prepare=prepare_production_delete, apply=apply_production_delete)


async def prepare_quantity_override(user, lot_id, payload):
    """The request carries the whole batch. Validate it now exactly as saving would,
    pretending the tolerance has been granted, so a request that could never be
    applied is refused up front."""
    try:
        batch = ProductionBatchCreate(**{**(payload or {}), "lot_id": lot_id})
    except Exception:
        raise HTTPException(400, "The request does not contain a valid production batch")
    lot, op_info, saved, dups, rt = await run_batch(batch, user, allow_override=True, dry_run=True)
    if not saved:
        raise HTTPException(400, "Nothing to save in this batch")
    label = f"{lot['lot_number']} · {op_info['operation_name']} · {batch.color} · {batch.date}"
    snapshot = {"pieces": sum(e["total_quantity"] for e in saved), "operators": [e["operator_name"] for e in saved]}
    return label, batch.model_dump(), snapshot


async def apply_quantity_override(approval, reviewer, request):
    batch = ProductionBatchCreate(**approval["payload"])
    # attributed to whoever asked for it, not to the approver
    requester = {"id": approval["requested_by"], "name": approval.get("requested_by_name", "")}
    lot, op_info, saved, dups, rt = await run_batch(batch, requester, allow_override=True)
    if not saved:
        raise ApprovalExpired("Nothing could be saved: those entries already exist")
    return {"after": {"saved": len(saved), "pieces": sum(e["total_quantity"] for e in saved), "duplicates_skipped": dups}}


approvals.register("quantity_override", prepare=prepare_quantity_override, apply=apply_quantity_override)

# ===== NOTIFICATION ROUTES =====

@api_router.get("/notifications")
async def get_notifications(request: Request):
    user = await get_current_user(request)
    notifications = await db.notifications.find(notification_scope(user)).sort("created_at", -1).to_list(50)
    return [serialize_doc(n) for n in notifications]

@api_router.put("/notifications/read-all")
async def mark_all_read(request: Request):
    user = await get_current_user(request)
    await db.notifications.update_many({**notification_scope(user), "read": False}, {"$set": {"read": True}})
    return {"message": "All marked read"}

@api_router.delete("/notifications/clear-all")
async def clear_all_notifications(request: Request):
    user = await get_current_user(request)
    await db.notifications.delete_many(notification_scope(user))
    return {"message": "All cleared"}

@api_router.put("/notifications/{notif_id}/toggle")
async def toggle_notification(notif_id: str, request: Request):
    user = await get_current_user(request)
    notif = await db.notifications.find_one({**notification_scope(user), "_id": ObjectId(notif_id)})
    if not notif:
        raise HTTPException(404)
    await db.notifications.update_one({"_id": ObjectId(notif_id)}, {"$set": {"read": not notif.get("read", False)}})
    return {"read": not notif.get("read", False)}

@api_router.get("/notifications/unread-count")
async def unread_count(request: Request):
    user = await get_current_user(request)
    count = await db.notifications.count_documents({**notification_scope(user), "read": False})
    return {"count": count}

# ===== ADVANCE ROUTES =====

@api_router.get("/advances")
async def get_advances(request: Request, operator_id: Optional[str] = None, status: Optional[str] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    query = {}
    if operator_id: query["operator_id"] = operator_id
    if status: query["status"] = status
    advances = await db.advances.find(query).sort("date", -1).to_list(1000)
    return [serialize_doc(a) for a in advances]

@api_router.post("/advances")
async def create_advance(data: AdvanceCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    operator = await db.operators.find_one({"_id": ObjectId(data.operator_id)})
    if not operator:
        raise HTTPException(400, "Operator not found")
    if data.amount <= 0:
        raise HTTPException(400, "Advance amount must be greater than zero")
    voucher_num = await get_next_advance_voucher_number()
    doc = {
        "operator_id": data.operator_id, "operator_name": operator["name"],
        "operator_code": operator.get("operator_code", ""),
        "date": data.date, "amount": data.amount, "balance": data.amount,
        "remarks": data.remarks, "status": "pending", "voucher_number": voucher_num,
        "adjustments": [],
        "created_by": user["id"], "created_by_name": user.get("name", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.advances.insert_one(doc)
    note(request, entity_type="advance", entity_id=str(result.inserted_id), label=doc.get("voucher_number", ""), summary=f"Created advance " + str(doc.get("voucher_number", "")))
    await db.notifications.insert_one({"type": "advance_created", "read": False,
        "message": f"Advance {voucher_num} - {operator['name']} ({operator.get('operator_code','')}) - Rs.{data.amount}",
        "created_at": datetime.now(timezone.utc).isoformat()})
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc

@api_router.post("/advances/{advance_id}/adjust")
async def adjust_advance(advance_id: str, data: AdvanceAdjust, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    advance = await db.advances.find_one({"_id": ObjectId(advance_id)})
    if not advance:
        raise HTTPException(404, "Advance not found")
    if data.amount <= 0:
        # a negative amount used to *increase* the outstanding balance and push
        # a bogus entry onto the adjustment ledger
        raise HTTPException(400, "Adjustment amount must be greater than zero")
    if data.amount > advance.get("balance", 0):
        raise HTTPException(400, "Adjustment exceeds remaining balance")
    new_balance = round(advance["balance"] - data.amount, 2)
    new_status = "fully_adjusted" if new_balance <= 0 else "partially_adjusted"
    adjustment = {"amount": data.amount, "date": datetime.now(timezone.utc).isoformat(),
                  "adjusted_by": user.get("name", "")}
    await db.advances.update_one({"_id": ObjectId(advance_id)}, {
        "$set": {"balance": new_balance, "status": new_status},
        "$push": {"adjustments": adjustment}
    })
    return {"balance": new_balance, "status": new_status}

@api_router.delete("/advances/{advance_id}")
async def delete_advance(advance_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    adv = await label_for(request, db.advances, advance_id, "voucher_number", "advance")
    if adv:
        note(request, before={"operator": adv.get("operator_name"), "amount": adv.get("amount"),
                              "balance": adv.get("balance"), "status": adv.get("status")})
    await db.advances.delete_one({"_id": ObjectId(advance_id)})
    return {"message": "Deleted"}

# ===== EDIT REQUEST ROUTES =====

@api_router.get("/edit-requests")
async def get_edit_requests(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    query = {}
    if status: query["status"] = status
    if user["role"] != "admin":
        query["requested_by"] = user["id"]
    requests_list = await db.edit_requests.find(query).sort("created_at", -1).to_list(100)
    return [serialize_doc(r) for r in requests_list]

@api_router.post("/edit-requests")
async def create_edit_request(request: Request):
    user = await get_current_user(request)
    body = await request.json()
    doc = {
        "entry_type": body.get("entry_type", "production"),
        "entry_id": body.get("entry_id", ""),
        "reason": body.get("reason", ""),
        "proposed_changes": body.get("proposed_changes", {}),
        "status": "pending",
        "requested_by": user["id"], "requested_by_name": user.get("name", ""),
        "reviewed_by": None, "reviewed_by_name": None, "reviewed_at": None,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.edit_requests.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return doc

@api_router.put("/edit-requests/{req_id}")
async def review_edit_request(req_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    action = body.get("action")
    if action not in ["approve", "reject"]:
        raise HTTPException(400, "Action must be approve or reject")
    update = {
        "status": "approved" if action == "approve" else "rejected",
        "reviewed_by": user["id"], "reviewed_by_name": user.get("name", ""),
        "reviewed_at": datetime.now(timezone.utc).isoformat()
    }
    er = await db.edit_requests.find_one({"_id": ObjectId(req_id)})
    if not er:
        raise HTTPException(404, "Edit request not found")
    if er.get("status") in ("approved", "rejected"):
        raise HTTPException(400, "This request has already been reviewed")

    applied = None
    if action == "approve":
        proposed = (er.get("proposed_changes") or {}).get("size_quantities")
        if not er.get("entry_id") or not proposed:
            raise HTTPException(400, "This request carries no proposed quantities, so there is "
                                     "nothing to apply. Reject it and edit the entry directly.")
        entry = await db.production_entries.find_one({"_id": ObjectId(er["entry_id"])})
        if not entry:
            raise HTTPException(404, "The entry this request refers to no longer exists")

        try:
            new_sq = {k: int(v or 0) for k, v in proposed.items()}
        except (TypeError, ValueError):
            raise HTTPException(400, "Proposed quantities must be whole numbers")
        if any(v < 0 for v in new_sq.values()):
            raise HTTPException(400, "Proposed quantities cannot be negative")
        new_sq = {k: v for k, v in new_sq.items() if v > 0}

        lot = await db.lots.find_one({"_id": ObjectId(entry["lot_id"])})
        if not lot:
            raise HTTPException(400, "Lot for this entry no longer exists")
        # approving used to $set the raw client payload, so any field at all
        # (rate, total_earnings, operator_id) could be written straight into a
        # payroll record. Only quantities are accepted, and money is recomputed.
        if entry.get("counts_toward_plan", True):
            await assert_within_plan(lot, entry.get("color", ""), entry.get("operation_id", ""),
                                     new_sq, exclude_entry_id=er["entry_id"])

        new_total, new_earnings = entry_money(entry, new_sq)
        await db.production_entries.update_one({"_id": ObjectId(er["entry_id"])}, {
            "$set": {"size_quantities": new_sq, "total_quantity": new_total,
                     "total_earnings": new_earnings, "modified_by": user["id"],
                     "modified_by_name": user.get("name", ""),
                     "modified_at": datetime.now(timezone.utc).isoformat()},
            "$push": {"edit_history": {
                "edited_by": user["id"], "edited_by_name": user.get("name", ""),
                "edited_at": datetime.now(timezone.utc).isoformat(),
                "reason": er.get("reason", ""), "source": "edit_request", "request_id": req_id,
                "requested_by_name": er.get("requested_by_name", ""),
                "old_values": {"size_quantities": entry.get("size_quantities", {}),
                               "total_quantity": entry.get("total_quantity", 0)},
                "new_values": {"size_quantities": new_sq, "total_quantity": new_total},
            }}
        })
        applied = {"total_quantity": new_total, "total_earnings": new_earnings}

    await db.edit_requests.update_one({"_id": ObjectId(req_id)}, {"$set": update})
    await db.approvals.update_many({"legacy_id": req_id, "status": "pending"}, {"$set": {
        "status": update["status"], "reviewed_by": update["reviewed_by"],
        "reviewed_by_name": update["reviewed_by_name"], "reviewed_at": update["reviewed_at"]}})
    return {"status": update["status"], "applied": applied}

# ===== PAYROLL ROUTES =====

async def get_weekly_payroll_data(week_num, year):
    entries = await db.production_entries.find({"week_number": week_num, "year": year}).to_list(10000)
    operator_map = {}
    for entry in entries:
        op_id = entry.get("operator_id", "")
        if not op_id:
            continue
        if op_id not in operator_map:
            operator_map[op_id] = {"operator_id": op_id, "operator_name": entry.get("operator_name", ""),
                                   "operator_code": entry.get("operator_code", ""),
                                   "operations": {}, "total_quantity": 0, "total_earnings": 0.0}
        # one line per (operation, rate type): the old code kept the FIRST rate it saw per
        # operation name, which is wrong as soon as an operation is paid at two rates
        op_name = entry.get("operation_name", "")
        rt_name = entry.get("rate_type_name", "")
        if rt_name and rt_name != "Regular":
            op_name = f"{op_name} ({rt_name})"
        if op_name not in operator_map[op_id]["operations"]:
            operator_map[op_id]["operations"][op_name] = {"operation_name": op_name, "quantity": 0,
                                                          "rate": entry.get("rate", 0), "earnings": 0.0}
        operator_map[op_id]["operations"][op_name]["quantity"] += entry.get("total_quantity", 0)
        operator_map[op_id]["operations"][op_name]["earnings"] += entry.get("total_earnings", 0)
        operator_map[op_id]["total_quantity"] += entry.get("total_quantity", 0)
        operator_map[op_id]["total_earnings"] += entry.get("total_earnings", 0)
    operators = list(operator_map.values())
    for o in operators:
        o["operations"] = list(o["operations"].values())
        for line in o["operations"]:
            # weighted average when a line mixes rates (per-size rates, or a rate edited mid-week)
            line["earnings"] = round(line["earnings"], 2)
            line["rate"] = round(line["earnings"] / line["quantity"], 4) if line["quantity"] else line["rate"]
        o["total_earnings"] = round(o["total_earnings"], 2)
    operators.sort(key=lambda x: x["total_earnings"], reverse=True)
    return {"week_number": week_num, "year": year, "operators": operators,
            "grand_total": round(sum(op["total_earnings"] for op in operators), 2)}

async def get_weekly_payroll_full(week_num, year):
    """Weekly payroll WITH advances applied. The single source of truth.

    The screen used to join advances here while the Excel sheet, the PDF salary
    report and the printed voucher all used the raw earnings helper -- so the
    voucher handed to a worker showed gross pay with no mention of their advance.
    Every consumer now goes through this function.

    The deduction is capped at what the operator actually earned this week, so a
    large outstanding advance can no longer produce a negative wage. Anything not
    recovered this week stays outstanding and is shown as `advance_carried`.
    """
    payroll = await get_weekly_payroll_data(week_num, year)
    operator_ids = [op["operator_id"] for op in payroll["operators"]]
    all_advances = await db.advances.find(
        {"operator_id": {"$in": operator_ids}, "status": {"$in": ["pending", "partially_adjusted"]}}
    ).sort("date", 1).to_list(1000)

    advances_by_op = {}
    for a in all_advances:
        advances_by_op.setdefault(a["operator_id"], []).append(a)

    for op in payroll["operators"]:
        pending = advances_by_op.get(op["operator_id"], [])
        outstanding = round(sum(a.get("balance", 0) for a in pending), 2)
        deduction = round(min(outstanding, op["total_earnings"]), 2)
        op["advance_outstanding"] = outstanding
        op["advance_deducted"] = deduction
        op["advance_carried"] = round(outstanding - deduction, 2)
        op["net_salary"] = round(op["total_earnings"] - deduction, 2)
        op["advances"] = [{"id": str(a["_id"]), "amount": a.get("amount", 0),
                           "balance": a.get("balance", 0),
                           "voucher_number": a.get("voucher_number", ""),
                           "date": a.get("date", "")} for a in pending]

    payroll["total_outstanding"] = round(sum(o["advance_outstanding"] for o in payroll["operators"]), 2)
    payroll["total_advances"] = round(sum(o["advance_deducted"] for o in payroll["operators"]), 2)
    payroll["net_total"] = round(sum(o["net_salary"] for o in payroll["operators"]), 2)
    return payroll


@api_router.get("/payroll/weekly")
async def get_weekly_payroll(week: int, year: int, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    return await get_weekly_payroll_full(week, year)

@api_router.post("/payroll/adjust-advance")
async def payroll_adjust_advance(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    advance_id = body.get("advance_id")
    operator_id = body.get("operator_id")
    amount = float(body.get("amount", 0))
    week_number = body.get("week_number")
    week_year = body.get("year")
    if amount <= 0:
        raise HTTPException(400, "Adjustment amount must be greater than zero")

    advance = None
    if advance_id:
        advance = await db.advances.find_one({"_id": ObjectId(advance_id)})
    if not advance and operator_id:
        advance = await db.advances.find_one(
            {"operator_id": operator_id, "status": {"$in": ["pending", "partially_adjusted"]}},
            sort=[("date", 1)]
        )
    if not advance:
        raise HTTPException(404, "No pending advance found for this operator")

    open_advances = await db.advances.find(
        {"operator_id": advance["operator_id"], "status": {"$in": ["pending", "partially_adjusted"]}},
    ).sort("date", 1).to_list(100)

    total_open = round(sum(a.get("balance", 0) for a in open_advances), 2)
    if amount > total_open:
        raise HTTPException(400, f"Adjustment of {amount} exceeds the outstanding balance of {total_open}")

    # If accounts picked a specific voucher, adjust that one FIRST. Previously the
    # selected advance_id was looked up and then thrown away, so choosing ADV7 in
    # the UI would silently adjust ADV3 instead. Any remainder then falls through
    # to the others oldest-first, which is the correct accounting order.
    advances_to_adjust = open_advances
    if advance_id:
        chosen = [a for a in open_advances if str(a["_id"]) == str(advance_id)]
        rest = [a for a in open_advances if str(a["_id"]) != str(advance_id)]
        advances_to_adjust = chosen + rest

    remaining = amount
    adjusted_list = []
    for adv in advances_to_adjust:
        if remaining <= 0:
            break
        bal = adv.get("balance", 0)
        deduct = min(remaining, bal)
        new_balance = round(bal - deduct, 2)
        new_status = "fully_adjusted" if new_balance <= 0 else "partially_adjusted"
        await db.advances.update_one({"_id": adv["_id"]}, {
            "$set": {"balance": new_balance, "status": new_status},
            "$push": {"adjustments": {"amount": deduct, "week_number": week_number, "year": week_year,
                                       "date": datetime.now(timezone.utc).isoformat(),
                                       "adjusted_by": user.get("name", ""), "source": "payroll"}}
        })
        adjusted_list.append({"voucher": adv.get("voucher_number", ""), "deducted": deduct, "balance": new_balance})
        remaining = round(remaining - deduct, 2)
    return {"adjusted": adjusted_list, "total_deducted": round(amount - remaining, 2)}

# ===== DASHBOARD ROUTES =====

@api_router.get("/dashboard/summary")
async def get_dashboard(request: Request):
    await get_current_user(request)
    active_lots = await db.lots.count_documents({"status": "active"})
    total_operators = await db.operators.count_documents({"active": True})
    cw = await get_current_week()
    wk = cw.get("week_number", 0)
    yr = cw.get("year", datetime.now(timezone.utc).year)
    week_entries = await db.production_entries.find({"week_number": wk, "year": yr}).to_list(10000)
    week_production = sum(e.get("total_quantity", 0) for e in week_entries)
    week_earnings = round(sum(e.get("total_earnings", 0) for e in week_entries), 2)
    lots = await db.lots.find({"status": "active"}).sort("lot_number", -1).to_list(100)
    lot_data = []
    for lot in lots:
        lot = serialize_doc(lot)
        lot = await enrich_lot(lot)
        lot_data.append({
            "id": lot["id"], "lot_number": lot["lot_number"], "style_name": lot["style_name"],
            "total_planned_qty": lot["total_planned_qty"], "total_produced_qty": lot["total_produced_qty"],
            "balance_qty": lot["balance_qty"], "progress": lot["progress"],
            "start_date": lot.get("start_date"), "target_end_date": lot.get("target_end_date")
        })
    op_map = {}
    for entry in week_entries:
        oid = entry.get("operator_id", "")
        if not oid:
            continue
        if oid not in op_map:
            op_map[oid] = {"operator_id": oid, "operator_name": entry.get("operator_name", ""),
                           "operator_code": entry.get("operator_code", ""),
                           "total_qty": 0, "total_earnings": 0.0}
        op_map[oid]["total_qty"] += entry.get("total_quantity", 0)
        op_map[oid]["total_earnings"] += entry.get("total_earnings", 0)
    # round once at the end -- rounding each entry then accumulating left
    # artifacts like 1234.5600000000002 rendering on the dashboard
    for o in op_map.values():
        o["total_earnings"] = round(o["total_earnings"], 2)
    top_operators = sorted(op_map.values(), key=lambda x: x["total_earnings"], reverse=True)[:10]
    operation_map = {}
    for entry in week_entries:
        name = entry.get("operation_name", "Unknown")
        if name not in operation_map:
            operation_map[name] = {"name": name, "total_qty": 0, "total_earnings": 0.0}
        operation_map[name]["total_qty"] += entry.get("total_quantity", 0)
        operation_map[name]["total_earnings"] += entry.get("total_earnings", 0)
    for o in operation_map.values():
        o["total_earnings"] = round(o["total_earnings"], 2)

    def by_group(field):
        grouped = {}
        for entry in week_entries:
            name = entry.get(field) or "Ungrouped"
            g = grouped.setdefault(name, {"name": name, "total_qty": 0, "total_earnings": 0.0})
            g["total_qty"] += entry.get("total_quantity", 0)
            g["total_earnings"] += entry.get("total_earnings", 0)
        for g in grouped.values():
            g["total_earnings"] = round(g["total_earnings"], 2)
        return sorted(grouped.values(), key=lambda x: x["total_qty"], reverse=True)

    return {
        "active_lots": active_lots, "total_operators": total_operators,
        "week_production": week_production, "week_earnings": week_earnings,
        "week_number": wk, "year": yr, "lots": lot_data,
        "top_operators": top_operators, "operation_stats": list(operation_map.values()),
        "operation_group_stats": by_group("operation_group"), "operator_group_stats": by_group("operator_group")
    }

# ===== REPORT & EXPORT ROUTES =====

@api_router.get("/reports/lot-matrix/{lot_id}")
async def report_lot_matrix(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot: raise HTTPException(404)
    lot = serialize_doc(lot)
    lot = await enrich_lot(lot)
    sizes = lot.get("sizes", [])
    entries = await db.production_entries.find({"lot_id": lot_id, "counts_toward_plan": {"$ne": False}}).to_list(10000)
    produced = {}
    for e in entries:
        op = e.get("operation_name", "")
        color = e.get("color", "")
        if op not in produced: produced[op] = {}
        if color not in produced[op]: produced[op][color] = {}
        for sz, qty in e.get("size_quantities", {}).items():
            produced[op][color][sz] = produced[op][color].get(sz, 0) + qty
    planned = {}
    for c in lot.get("colors", []):
        for s in c.get("sizes", []):
            planned.setdefault(c["name"], {})[s["size"]] = s["planned_qty"]
    operations = []
    for op in lot.get("operations", []):
        op_name = op["operation_name"]
        colors_data = []
        for c in lot.get("colors", []):
            cname = c["name"]
            size_data = {}
            for sz in sizes:
                p = planned.get(cname, {}).get(sz, 0)
                pr = produced.get(op_name, {}).get(cname, {}).get(sz, 0)
                size_data[sz] = {"planned": p, "produced": pr, "balance": p - pr}
            tp = sum(v["planned"] for v in size_data.values())
            tpr = sum(v["produced"] for v in size_data.values())
            colors_data.append({"name": cname, "sizes": size_data, "total_planned": tp, "total_produced": tpr, "balance": tp - tpr})
        operations.append({"operation_name": op_name, "rate": op.get("rate", 0), "colors": colors_data})
    return {"lot": lot, "sizes": sizes, "operations": operations}

@api_router.get("/reports/weekly-matrix")
async def report_weekly_matrix(week: int, year: int, request: Request, color: Optional[str] = None, operation: Optional[str] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    query = {"week_number": week, "year": year}
    if color: query["color"] = color
    if operation: query["operation_name"] = operation
    entries = await db.production_entries.find(query).to_list(10000)
    lot_ids = list(set(e.get("lot_id", "") for e in entries))
    lots_map = {}
    for lid in lot_ids:
        lot = await db.lots.find_one({"_id": ObjectId(lid)})
        if lot:
            lots_map[lid] = serialize_doc(lot)
    result = []
    for lid, lot in lots_map.items():
        sizes = lot.get("sizes", [])
        lot_entries = [e for e in entries if e.get("lot_id") == lid]
        op_map = {}
        for e in lot_entries:
            on = e.get("operation_name", "")
            c = e.get("color", "")
            if on not in op_map: op_map[on] = {"operation": on, "rate": e.get("rate", 0), "colors": {}}
            if c not in op_map[on]["colors"]: op_map[on]["colors"][c] = {}
            for sz, qty in e.get("size_quantities", {}).items():
                op_map[on]["colors"][c][sz] = op_map[on]["colors"][c].get(sz, 0) + qty
        ops = []
        for on, od in op_map.items():
            colors = [{"name": cn, "sizes": sd} for cn, sd in od["colors"].items()]
            ops.append({"operation": on, "rate": od["rate"], "colors": colors})
        result.append({"lot_number": lot.get("lot_number", ""), "style_name": lot.get("style_name", ""), "sizes": sizes, "operations": ops})
    return {"week": week, "year": year, "lots": result}

@api_router.get("/reports/weekly-production")
async def report_weekly_production(week: int, year: int, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    entries = await db.production_entries.find({"week_number": week, "year": year}).to_list(10000)
    lot_map = {}
    for e in entries:
        lid = e.get("lot_id", "")
        if lid not in lot_map:
            lot_map[lid] = {"lot_id": lid, "lot_number": e.get("lot_number", ""), "style_name": e.get("style_name", ""),
                           "total_qty": 0, "total_earnings": 0, "operations": {}}
        lot_map[lid]["total_qty"] += e.get("total_quantity", 0)
        lot_map[lid]["total_earnings"] += e.get("total_earnings", 0)
        opn = e.get("operation_name", "")
        if opn not in lot_map[lid]["operations"]:
            lot_map[lid]["operations"][opn] = {"name": opn, "qty": 0, "earnings": 0}
        lot_map[lid]["operations"][opn]["qty"] += e.get("total_quantity", 0)
        lot_map[lid]["operations"][opn]["earnings"] += e.get("total_earnings", 0)
    result_lots = list(lot_map.values())
    for rl in result_lots:
        rl["total_earnings"] = round(rl["total_earnings"], 2)
        for o in rl["operations"].values():
            o["earnings"] = round(o["earnings"], 2)
        rl["operations"] = list(rl["operations"].values())
    groups_map = {}
    for e in entries:
        g = groups_map.setdefault(e.get("operation_group") or "Ungrouped",
                                  {"name": e.get("operation_group") or "Ungrouped", "qty": 0, "earnings": 0.0})
        g["qty"] += e.get("total_quantity", 0)
        g["earnings"] += e.get("total_earnings", 0)
    for g in groups_map.values():
        g["earnings"] = round(g["earnings"], 2)
    return {"week": week, "year": year, "lots": result_lots, "by_group": list(groups_map.values()),
            "total_qty": sum(x["total_qty"] for x in result_lots),
            "total_earnings": round(sum(x["total_earnings"] for x in result_lots), 2)}

@api_router.get("/reports/lot-color/{lot_id}")
async def report_lot_color(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot: raise HTTPException(404)
    lot = serialize_doc(lot)
    lot = await enrich_lot(lot)
    sizes = lot.get("sizes", [])
    entries = await db.production_entries.find({"lot_id": lot_id, "counts_toward_plan": {"$ne": False}}).to_list(10000)
    produced = {}
    for e in entries:
        c = e.get("color", "")
        if c not in produced: produced[c] = {}
        for sz, qty in e.get("size_quantities", {}).items():
            produced[c][sz] = produced[c].get(sz, 0) + qty
    colors = []
    for c in lot.get("colors", []):
        cname = c["name"]
        size_data = {}
        for s in c.get("sizes", []):
            p = s["planned_qty"]
            pr = produced.get(cname, {}).get(s["size"], 0)
            size_data[s["size"]] = {"planned": p, "produced": pr, "balance": p - pr}
        tp = sum(v["planned"] for v in size_data.values())
        tpr = sum(v["produced"] for v in size_data.values())
        colors.append({"name": cname, "sizes": size_data, "total_planned": tp, "total_produced": tpr, "balance": tp - tpr})
    return {"lot": lot, "sizes": sizes, "colors": colors}

@api_router.get("/reports/lot-operation/{lot_id}")
async def report_lot_operation(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot: raise HTTPException(404)
    lot = serialize_doc(lot)
    lot = await enrich_lot(lot)
    total_planned_qty = lot.get("total_planned_qty", 0)
    entries = await db.production_entries.find({"lot_id": lot_id}).to_list(10000)
    op_map = {}
    for e in entries:
        n = e.get("operation_name", "")
        if n not in op_map:
            op_map[n] = {"operation": n, "rate": e.get("rate", 0), "operators": {}, "produced_qty": 0, "produced_cost": 0}
        op_map[n]["produced_qty"] += e.get("total_quantity", 0)
        op_map[n]["produced_cost"] += e.get("total_earnings", 0)
        oid = e.get("operator_id", "")
        if oid not in op_map[n]["operators"]:
            op_map[n]["operators"][oid] = {"name": e.get("operator_name", ""), "code": e.get("operator_code", ""), "qty": 0}
        op_map[n]["operators"][oid]["qty"] += e.get("total_quantity", 0)
    for lot_op in lot.get("operations", []):
        n = lot_op["operation_name"]
        if n not in op_map:
            op_map[n] = {"operation": n, "rate": lot_op.get("rate", 0), "operators": {}, "produced_qty": 0, "produced_cost": 0}
        op_map[n]["planned_qty"] = total_planned_qty
        op_map[n]["planned_cost"] = round(total_planned_qty * lot_op.get("rate", 0), 2)
        op_map[n]["rate"] = lot_op.get("rate", 0)
    ops = list(op_map.values())
    for o in ops:
        o["operators"] = list(o["operators"].values())
        if "planned_qty" not in o:
            o["planned_qty"] = total_planned_qty
            o["planned_cost"] = round(total_planned_qty * o.get("rate", 0), 2)
    return {"lot": lot, "operations": ops}

@api_router.get("/reports/operator-detail/{operator_id}")
async def report_operator_detail(operator_id: str, request: Request, week: Optional[int] = None, year: Optional[int] = None, lot_id: Optional[str] = None, color: Optional[str] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    operator = await db.operators.find_one({"_id": ObjectId(operator_id)})
    if not operator: raise HTTPException(404)
    query = {"operator_id": operator_id}
    if week: query["week_number"] = week
    if year: query["year"] = year
    if lot_id: query["lot_id"] = lot_id
    if color: query["color"] = color
    entries = await db.production_entries.find(query).sort("date", 1).to_list(10000)
    result = [serialize_doc(e) for e in entries]
    all_sizes = set()
    op_matrix = {}
    for e in result:
        opn = e.get("operation_name", "")
        if opn not in op_matrix:
            op_matrix[opn] = {"operation": opn, "rate": e.get("rate", 0), "sizes": {}, "total_qty": 0, "total_earnings": 0}
        for sz, qty in e.get("size_quantities", {}).items():
            all_sizes.add(sz)
            op_matrix[opn]["sizes"][sz] = op_matrix[opn]["sizes"].get(sz, 0) + qty
        op_matrix[opn]["total_qty"] += e.get("total_quantity", 0)
        op_matrix[opn]["total_earnings"] += e.get("total_earnings", 0)
    for o in op_matrix.values():
        o["total_earnings"] = round(o["total_earnings"], 2)
    total_qty = sum(e.get("total_quantity", 0) for e in result)
    total_earnings = round(sum(e.get("total_earnings", 0) for e in result), 2)
    advances = await db.advances.find({"operator_id": operator_id, "status": {"$in": ["pending", "partially_adjusted"]}}).to_list(100)
    advance_balance = round(sum(a.get("balance", 0) for a in advances), 2)
    return {"operator": serialize_doc(operator) if "_id" in operator else operator,
            "operations": list(op_matrix.values()), "sizes": sorted(all_sizes),
            "entries": result, "total_qty": total_qty, "total_earnings": total_earnings,
            "advance_balance": advance_balance, "net_salary": round(total_earnings - advance_balance, 2)}

@api_router.get("/reports/lot/{lot_id}")
async def get_lot_report(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    lot = serialize_doc(lot)
    lot = await enrich_lot(lot)
    entries = await db.production_entries.find({"lot_id": lot_id, "counts_toward_plan": {"$ne": False}}).to_list(10000)
    cs_map = {}
    for e in entries:
        color = e.get("color", "")
        for sz, qty in e.get("size_quantities", {}).items():
            key = f"{color}|{sz}"
            if key not in cs_map:
                cs_map[key] = {"color": color, "size": sz, "produced": 0}
            cs_map[key]["produced"] += qty
    return {"lot": lot, "production_by_color_size": list(cs_map.values())}

@api_router.get("/reports/advance-report")
async def advance_report(request: Request, week: Optional[int] = None, year: Optional[int] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    query = {}
    advances = await db.advances.find(query).sort("date", -1).to_list(1000)
    result = []
    for a in advances:
        adv = serialize_doc(a)
        adjs = adv.get("adjustments", [])
        week_adjs = [aj for aj in adjs if (not week or aj.get("week_number") == week) and (not year or aj.get("year") == year)]
        result.append({
            "operator_name": adv.get("operator_name", ""), "operator_code": adv.get("operator_code", ""),
            "voucher_number": adv.get("voucher_number", ""), "date": adv.get("date", ""),
            "amount": adv.get("amount", 0), "balance": adv.get("balance", 0),
            "status": adv.get("status", ""), "adjustments": week_adjs,
            "total_adjusted": round(sum(aj.get("amount", 0) for aj in adjs), 2)
        })
    return {"advances": result}

@api_router.get("/reports/export/excel")
async def export_excel(request: Request, report_type: str, lot_id: Optional[str] = None,
                       week: Optional[int] = None, year: Optional[int] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    def sheet_title(name: str) -> str:
        """Excel rejects : \\ / ? * [ ] in sheet names, and caps them at 31 chars.

        Every lot number contains a slash (LOT1/26-27), so setting the title
        directly from it raised ValueError and made this export a 500.
        """
        for ch in ':\\/?*[]':
            name = name.replace(ch, '-')
        return name[:31] or "Report"

    wb = Workbook()
    ws = wb.active
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")

    if report_type == "lot" and lot_id:
        lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
        if not lot:
            raise HTTPException(404)
        lot = serialize_doc(lot)
        lot = await enrich_lot(lot)
        ws.title = sheet_title(f"Lot {lot['lot_number']}")
        ws.append(["Lot Production Report"])
        ws.append(["Style", lot["style_name"]])
        ws.append(["Lot #", lot["lot_number"]])
        ws.append(["Status", lot["status"]])
        ws.append(["Ordered", lot.get("total_order_qty", lot["total_planned_qty"])])
        ws.append(["Allowance %", lot.get("allowance_pct", 0)])
        ws.append(["Planned", lot["total_planned_qty"]])
        ws.append(["Produced", lot["total_produced_qty"]])
        ws.append(["Balance", lot["balance_qty"]])
        ws.append([])
        headers = ["Color", "Size", "Planned Qty"]
        ws.append(headers)
        for i, h in enumerate(headers, 1):
            ws.cell(row=9, column=i).font = header_font
            ws.cell(row=9, column=i).fill = header_fill
        for color in lot.get("colors", []):
            for size in color.get("sizes", []):
                ws.append([color["name"], size["size"], size["planned_qty"]])
        ws.append([])
        entries = await db.production_entries.find({"lot_id": lot_id}).to_list(10000)
        r = ws.max_row + 1
        prod_headers = ["Date", "Color", "Size", "Operation", "Qty", "Earnings (INR)"]
        ws.append(prod_headers)
        for i, h in enumerate(prod_headers, 1):
            ws.cell(row=r, column=i).font = header_font
            ws.cell(row=r, column=i).fill = header_fill
        # entries store `size_quantities` (a dict), never a `size` key -- reading
        # e["size"] raised KeyError and made this export a hard 500 for any lot
        # that actually had production against it
        for e in entries:
            for sz, qty in sorted(e.get("size_quantities", {}).items()):
                rate_here = (e.get("size_rates") or {}).get(sz, e.get("rate_flat", e.get("rate", 0)))
                ws.append([e.get("date", ""), e.get("color", ""), sz, e.get("operation_name", ""),
                           qty, round(qty * rate_here, 2)])

    elif report_type == "salary" and week and year:
        ws.title = "Salary Report"
        payroll = await get_weekly_payroll_full(week, year)
        ws.append([f"Salary Report - Week {week}, {year}"])
        ws.append([COMPANY["name"]])
        ws.append([])
        headers = ["Operator", "Code", "Operation", "Qty", "Rate (INR)", "Earnings (INR)"]
        ws.append(headers)
        for i, h in enumerate(headers, 1):
            ws.cell(row=4, column=i).font = header_font
            ws.cell(row=4, column=i).fill = header_fill
        for op in payroll["operators"]:
            for operation in op["operations"]:
                ws.append([op["operator_name"], op["operator_code"], operation["operation_name"],
                           operation["quantity"], operation["rate"], operation["earnings"]])
            ws.append([op["operator_name"], op["operator_code"], "GROSS",
                       op["total_quantity"], "", op["total_earnings"]])
            ws.append(["", "", "Less: advance deducted", "", "", -op["advance_deducted"]])
            ws.append(["", "", "NET PAYABLE", "", "", op["net_salary"]])
            if op["advance_carried"]:
                ws.append(["", "", "Advance still outstanding", "", "", op["advance_carried"]])
            ws.append([])
        ws.append(["Gross Total", "", "", "", "", payroll["grand_total"]])
        ws.append(["Advances Deducted", "", "", "", "", payroll["total_advances"]])
        ws.append(["NET PAYABLE", "", "", "", "", payroll["net_total"]])
        for col in range(1, 7):
            ws.cell(row=ws.max_row, column=col).font = Font(bold=True)

    elif report_type == "operation_cost" and lot_id:
        lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
        if not lot:
            raise HTTPException(404)
        ws.title = "Operation Cost"
        ws.append(["Operation Cost Report - " + lot.get("style_name", "")])
        ws.append([])
        headers = ["Operation", "Rate (INR)", "Total Qty", "Total Cost (INR)"]
        ws.append(headers)
        for i, h in enumerate(headers, 1):
            ws.cell(row=3, column=i).font = header_font
            ws.cell(row=3, column=i).fill = header_fill
        entries = await db.production_entries.find({"lot_id": lot_id}).to_list(10000)
        op_cost = {}
        for e in entries:
            n = e["operation_name"]
            if n not in op_cost:
                op_cost[n] = {"rate": e["rate"], "qty": 0, "cost": 0}
            op_cost[n]["qty"] += e["total_quantity"]
            op_cost[n]["cost"] += e["total_earnings"]
        for n, d in op_cost.items():
            # one operation can be paid at several rates; show what it actually averaged
            ws.append([n, round(d["cost"] / d["qty"], 4) if d["qty"] else d["rate"], d["qty"], d["cost"]])

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    filename = f"report_{report_type}.xlsx"
    return StreamingResponse(output, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={filename}"})

@api_router.get("/reports/export/pdf")
async def export_pdf(request: Request, report_type: str, lot_id: Optional[str] = None,
                     week: Optional[int] = None, year: Optional[int] = None,
                     operator_id: Optional[str] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib import colors as rl_colors
    from reportlab.lib.styles import getSampleStyleSheet

    output = io.BytesIO()
    doc_pdf = SimpleDocTemplate(output, pagesize=A4)
    styles = getSampleStyleSheet()
    elements = []

    def add_company_header(elements):
        elements.append(Paragraph(f"<b>{COMPANY['name']}</b>", styles["Title"]))
        elements.append(Paragraph(COMPANY["address"], styles["Normal"]))
        elements.append(Paragraph(f"Phone: {COMPANY['phone']} | Email: {COMPANY['email']}", styles["Normal"]))
        elements.append(Spacer(1, 12))

    if report_type == "voucher" and operator_id and week and year:
        operator = await db.operators.find_one({"_id": ObjectId(operator_id)})
        if not operator:
            raise HTTPException(404, "Operator not found")
        # allocated once and stored -- reprinting must not burn a new number
        v_num = await get_voucher_number_for(operator_id, week, year)
        payroll = await get_weekly_payroll_full(week, year)
        op_data = next((o for o in payroll["operators"] if o["operator_id"] == operator_id), None)
        add_company_header(elements)
        elements.append(Paragraph(f"PAYMENT VOUCHER - {v_num}", styles["Heading2"]))
        elements.append(Spacer(1, 8))
        elements.append(Paragraph(f"Operator: {operator['name']} ({operator.get('operator_code', '')})", styles["Normal"]))
        elements.append(Paragraph(f"Week: {week}, Year: {year}", styles["Normal"]))
        elements.append(Spacer(1, 12))
        if op_data:
            tdata = [["Operation", "Qty", "Rate", "Earnings"]]
            for o in op_data["operations"]:
                tdata.append([o["operation_name"], str(o["quantity"]), f"{o['rate']:.2f}", f"{o['earnings']:.2f}"])
            tdata.append(["GROSS EARNINGS", str(op_data["total_quantity"]), "", f"{op_data['total_earnings']:.2f}"])
            tdata.append(["Less: advance deducted", "", "", f"-{op_data['advance_deducted']:.2f}"])
            tdata.append(["NET PAYABLE", "", "", f"{op_data['net_salary']:.2f}"])
            t = Table(tdata, colWidths=[200, 80, 80, 100])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#294f96")),
                ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
                ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.grey),
                ("FONTNAME", (0, -3), (-1, -3), "Helvetica-Bold"),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("BACKGROUND", (0, -1), (-1, -1), rl_colors.HexColor("#e8f0ea")),
            ]))
            elements.append(t)
            if op_data["advance_carried"]:
                elements.append(Spacer(1, 8))
                elements.append(Paragraph(
                    f"Advance still outstanding after this week: INR {op_data['advance_carried']:.2f}",
                    styles["Normal"]))
        elements.append(Spacer(1, 40))
        elements.append(Paragraph("Signature: ___________________", styles["Normal"]))

    elif report_type == "salary" and week and year:
        payroll = await get_weekly_payroll_full(week, year)
        add_company_header(elements)
        elements.append(Paragraph(f"Weekly Salary Report - Week {week}, {year}", styles["Heading2"]))
        elements.append(Spacer(1, 12))
        tdata = [["Operator", "Qty", "Gross (INR)", "Advance (INR)", "Net (INR)"]]
        for op in payroll["operators"]:
            tdata.append([f"{op['operator_name']} ({op['operator_code']})", str(op["total_quantity"]),
                          f"{op['total_earnings']:.2f}", f"{op['advance_deducted']:.2f}",
                          f"{op['net_salary']:.2f}"])
        tdata.append(["GRAND TOTAL", "", f"{payroll['grand_total']:.2f}",
                      f"{payroll['total_advances']:.2f}", f"{payroll['net_total']:.2f}"])
        t = Table(tdata, colWidths=[170, 60, 90, 90, 90])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), rl_colors.HexColor("#294f96")),
            ("TEXTCOLOR", (0, 0), (-1, 0), rl_colors.white),
            ("GRID", (0, 0), (-1, -1), 0.5, rl_colors.grey),
            ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
            ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
            ("BACKGROUND", (0, -1), (-1, -1), rl_colors.HexColor("#eef2f8")),
        ]))
        elements.append(t)

    doc_pdf.build(elements)
    output.seek(0)
    return StreamingResponse(output, media_type="application/pdf",
                             headers={"Content-Disposition": f"attachment; filename={report_type}_report.pdf"})

# ===== VOUCHER ROUTES =====

@api_router.get("/vouchers")
async def get_vouchers(week: int, year: int, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    return await get_weekly_payroll_full(week, year)

# ===== SETTINGS ROUTES =====

@api_router.get("/settings")
async def get_settings(request: Request):
    await get_current_user(request)
    settings = await db.system_settings.find({}, {"_id": 0}).to_list(100)
    return {s["key"]: s["value"] for s in settings}

@api_router.put("/settings/{key}")
async def update_setting(key: str, data: SettingUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    prior = await db.system_settings.find_one({"key": key})
    note(request, entity_type="setting", entity_id=key, label=key, summary=f"Changed setting {key}",
         before={"value": prior.get("value") if prior else None}, after={"value": data.value})
    await db.system_settings.update_one({"key": key}, {"$set": {"value": data.value}}, upsert=True)
    return {"key": key, "value": data.value}

@api_router.post("/settings/reset-all-data")
async def reset_all_data(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    if body.get("confirm") != "RESET ALL DATA":
        raise HTTPException(400, "Type 'RESET ALL DATA' to confirm")
    collections_to_clear = ["operators", "operations", "colors_master", "size_charts",
                            "weeks", "lots", "production_entries", "advances",
                            "notifications", "edit_requests", "counters", "system_settings", "login_attempts",
                            "enquiries", "rate_limits", "approvals", "operator_groups", "operation_groups", "rate_types"]
    note(request, entity_type="system", summary="ALL DATA RESET by admin (audit log is kept)")
    cleared = []
    for col in collections_to_clear:
        await db[col].drop()
        cleared.append(col)
    await db.users.delete_many({"role": {"$ne": "admin"}})
    await seed_settings()
    await ratetypes.seed_rate_types()
    logger.info("ALL DATA RESET by admin")
    return {"message": "All data cleared. Admin user kept.", "cleared": cleared}

# ===== USER ROUTES =====

@api_router.get("/users")
async def get_users(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    users = await db.users.find({}, {"password_hash": 0}).to_list(100)
    return [serialize_doc(u) for u in users]

@api_router.post("/users")
async def create_user(data: UserCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if data.role not in ["admin", "accounts", "data_entry"]:
        raise HTTPException(400, "Invalid role. Must be admin, accounts, or data_entry")
    existing = await db.users.find_one({"email": data.email.lower().strip()})
    if existing:
        raise HTTPException(400, "Email already exists")
    doc = {
        "email": data.email.lower().strip(), "password_hash": hash_password(data.password),
        "name": data.name, "role": data.role, "active": True,
        "can_enter": data.can_enter, "can_edit": data.can_edit,
        "can_delete": data.can_delete, "can_view_financial": data.can_view_financial,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.users.insert_one(doc)
    note(request, entity_type="user", entity_id=str(result.inserted_id), label=doc.get("email", ""), summary=f"Created user " + str(doc.get("email", "")))
    return {"id": str(result.inserted_id), "email": doc["email"], "name": doc["name"],
            "role": doc["role"], "active": True, "can_enter": doc["can_enter"],
            "can_edit": doc["can_edit"], "can_delete": doc["can_delete"],
            "can_view_financial": doc["can_view_financial"]}

@api_router.put("/users/{user_id}")
async def update_user(user_id: str, data: UserUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    prior = await label_for(request, db.users, user_id, "email", "user")
    note(request, before={k: prior.get(k) for k in update} if prior else None, after=update)
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update})
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"password_hash": 0})
    return serialize_doc(u)

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if user_id == user["id"]:
        raise HTTPException(400, "Cannot delete yourself")
    await label_for(request, db.users, user_id, "email", "user")
    await db.users.delete_one({"_id": ObjectId(user_id)})
    return {"message": "Deleted"}

@api_router.post("/users/{user_id}/change-password")
async def change_user_password(user_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    body = await request.json()
    new_password = body.get("new_password", "")
    if len(new_password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")
    await label_for(request, db.users, user_id, "email", "user")
    note(request, summary="Password changed")   # the value itself is never logged
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"password_hash": hash_password(new_password)}})
    return {"message": "Password changed"}

# ===== STARTUP =====

async def seed_admin():
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@example.com").lower().strip()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin123")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        # check-then-insert is a race when the server runs more than one worker:
        # both see "no admin", both insert, and the unique index on email kills
        # the loser with DuplicateKeyError, taking that whole worker down. The
        # duplicate simply means another worker got there first, which is fine.
        try:
            await db.users.insert_one({
                "email": admin_email, "password_hash": hash_password(admin_password),
                "name": "Admin", "role": "admin", "active": True,
                "created_at": datetime.now(timezone.utc).isoformat()
            })
            logger.info(f"Admin seeded: {admin_email}")
        except DuplicateKeyError:
            logger.info(f"Admin {admin_email} already created by another worker.")
            existing = await db.users.find_one({"email": admin_email})
    if existing and not verify_password(admin_password, existing["password_hash"]):
        # Previously this silently reset the admin password to match .env on EVERY
        # boot, so a password changed in the UI would revert on the next restart.
        # Now it is opt-in via ADMIN_PASSWORD_RESET=true (use it if you get locked out).
        if os.environ.get("ADMIN_PASSWORD_RESET", "").lower() in ("1", "true", "yes"):
            await db.users.update_one({"email": admin_email},
                                      {"$set": {"password_hash": hash_password(admin_password)}})
            logger.warning("Admin password reset from ADMIN_PASSWORD (ADMIN_PASSWORD_RESET is on)")
        else:
            logger.info("Admin exists with a different password; leaving it unchanged.")

    # Credentials file is a local development aid only - never write plaintext
    # passwords to disk on the public deployment.
    if not PUBLIC_MODE:
        # MEMORY_DIR defaults to <backend>/memory so this works on Windows/macOS too.
        # (Was hardcoded to /app/memory, which only exists inside the Emergent container.)
        memory_dir = Path(os.environ.get("MEMORY_DIR", ROOT_DIR / "memory"))
        memory_dir.mkdir(parents=True, exist_ok=True)
        with open(memory_dir / "test_credentials.md", "w") as f:
            f.write(f"# Test Credentials\n\n## Admin\n- Email: {admin_email}\n- Password: {admin_password}\n- Role: admin\n\n")
            f.write("## Auth Endpoints\n- POST /api/auth/login\n- POST /api/auth/logout\n- GET /api/auth/me\n- POST /api/auth/refresh\n")

async def seed_settings():
    # upsert rather than check-then-insert: with several workers booting at once
    # the check-then-insert version would write duplicate settings rows, since
    # system_settings has no unique index to stop it.
    await db.system_settings.update_one(
        {"key": "week_definition"},
        {"$setOnInsert": {"value": "monday_sunday"}},
        upsert=True,
    )

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.audit_logs.create_index([("at", -1)])
    await db.audit_logs.create_index([("entity_type", 1), ("entity_id", 1)])
    await db.audit_logs.create_index("user_id")
    await db.audit_logs.create_index("action")
    await db.approvals.create_index([("status", 1), ("requested_at", -1)])
    await db.approvals.create_index("requested_by")
    await db.operators.create_index("group_id")
    await db.operations.create_index("group_id")
    await db.approvals.create_index("legacy_id", unique=True, sparse=True)
    await db.rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await db.enquiries.create_index("created_at")
    await db.production_entries.create_index([("week_number", 1), ("year", 1)])
    await db.production_entries.create_index("lot_id")
    await db.production_entries.create_index("operator_id")
    await db.lots.create_index("lot_number")
    await db.weeks.create_index([("week_number", 1), ("year", 1)], unique=True)
    await db.operators.create_index("operator_code", unique=True, sparse=True)
    await db.advances.create_index("operator_id")
    await db.advances.create_index("status")
    # one voucher number per operator per week, so reprints are stable
    await db.vouchers.create_index([("operator_id", 1), ("week_number", 1), ("year", 1)], unique=True)
    # a given operator can only have one entry per day per lot/operation/colour
    await db.production_entries.create_index(
        [("week_id", 1), ("lot_id", 1), ("operation_id", 1), ("color", 1),
         ("operator_id", 1), ("date", 1)], name="entry_dedupe")
    await seed_admin()
    await seed_settings()
    await ratetypes.seed_rate_types()
    logger.info("Victoria Unit Flow API started")

@api_router.get("/health")
async def health():
    """Liveness probe. Also used by the keep-awake ping on Render's free tier."""
    try:
        await client.admin.command("ping")
        return {"status": "ok", "database": "connected"}
    except Exception as exc:
        raise HTTPException(503, f"Database unreachable: {exc}")

app.include_router(api_router)
app.include_router(audit_router)
app.include_router(approvals.router)
app.include_router(groups_router)
app.include_router(ratetypes.router)
app.middleware("http")(audit_middleware)

# ===== CORS =====
# Was allow_origin_regex=r"https?://.*" with credentials, i.e. any site on the
# internet could make authenticated requests on a logged-in user's behalf.
# In production the frontend is served by this same process, so no cross-origin
# access is needed at all and this list is empty.
if ALLOWED_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "Authorization"],
    )
    logger.info(f"CORS enabled for: {', '.join(ALLOWED_ORIGINS)}")
else:
    logger.info("CORS disabled (same-origin only)")

# ===== SECURITY HEADERS =====
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if PUBLIC_MODE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# ===== FRONTEND (single-service deployment) =====
# When a built React bundle is present, this process serves it too, so the whole
# app is one origin on one host. Set FRONTEND_BUILD_DIR to override the location.
FRONTEND_BUILD_DIR = Path(
    os.environ.get("FRONTEND_BUILD_DIR", ROOT_DIR.parent / "frontend" / "build")
)

if (FRONTEND_BUILD_DIR / "index.html").exists():
    app.mount(
        "/static",
        StaticFiles(directory=FRONTEND_BUILD_DIR / "static"),
        name="static",
    )

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        """Serve real files when they exist, otherwise hand back index.html so
        client-side routes like /payroll survive a refresh or a direct link."""
        if full_path.startswith("api/"):
            raise HTTPException(404, "Not found")
        candidate = (FRONTEND_BUILD_DIR / full_path).resolve()
        # Guard against ../ traversal escaping the build directory.
        if candidate.is_file() and FRONTEND_BUILD_DIR.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(FRONTEND_BUILD_DIR / "index.html")

    logger.info(f"Serving frontend from {FRONTEND_BUILD_DIR}")
else:
    logger.info("No frontend build found - running as API only")

@app.on_event("shutdown")
async def shutdown():
    client.close()
