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

class OperatorUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None

class OperationCreate(BaseModel):
    name: str

class OperationUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None

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

class LotOperationEntry(BaseModel):
    operation_id: str
    rate: float
    operator_ids: List[str]

class LotCreate(BaseModel):
    style_name: str
    start_date: str
    target_end_date: str
    size_chart_id: str
    color_names: List[str]
    color_size_quantities: dict
    operations: List[LotOperationEntry]

class LotUpdate(BaseModel):
    style_name: Optional[str] = None
    start_date: Optional[str] = None
    target_end_date: Optional[str] = None
    status: Optional[str] = None
    color_size_quantities: Optional[dict] = None
    operations: Optional[List[LotOperationEntry]] = None

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
        raise HTTPException(401, "Invalid email or password")

    await db.login_attempts.delete_one({"identifier": identifier})
    user_id = str(user["_id"])
    access_token = create_access_token(user_id, email, user["role"])
    refresh_token = create_refresh_token(user_id)
    set_auth_cookie(response, "access_token", access_token, 28800)
    set_auth_cookie(response, "refresh_token", refresh_token, 604800)
    return {"id": user_id, "email": user["email"], "name": user["name"], "role": user["role"],
            "can_enter": user.get("can_enter", True), "can_edit": user.get("can_edit", False),
            "can_delete": user.get("can_delete", False), "can_view_financial": user.get("can_view_financial", False)}

@api_router.post("/auth/logout")
async def logout(response: Response):
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
    code = await get_next_operator_code()
    doc = {"name": data.name, "operator_code": code, "display_name": f"{data.name} ({code})",
           "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.operators.insert_one(doc)
    return {"id": str(result.inserted_id), **{k: v for k, v in doc.items() if k != "_id"}}

@api_router.put("/operators/{operator_id}")
async def update_operator(operator_id: str, data: OperatorUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    if "name" in update:
        op = await db.operators.find_one({"_id": ObjectId(operator_id)})
        if op:
            update["display_name"] = f"{update['name']} ({op.get('operator_code', '')})"
    await db.operators.update_one({"_id": ObjectId(operator_id)}, {"$set": update})
    op = await db.operators.find_one({"_id": ObjectId(operator_id)})
    return serialize_doc(op)

@api_router.delete("/operators/{operator_id}")
async def delete_operator(operator_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
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
    doc = {"name": data.name, "active": True, "created_at": datetime.now(timezone.utc).isoformat()}
    result = await db.operations.insert_one(doc)
    return {"id": str(result.inserted_id), "name": data.name, "active": True, "created_at": doc["created_at"]}

@api_router.put("/operations/{operation_id}")
async def update_operation(operation_id: str, data: OperationUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {k: v for k, v in data.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(400, "No fields to update")
    await db.operations.update_one({"_id": ObjectId(operation_id)}, {"$set": update})
    op = await db.operations.find_one({"_id": ObjectId(operation_id)})
    return serialize_doc(op)

@api_router.delete("/operations/{operation_id}")
async def delete_operation(operation_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
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
    await db.weeks.delete_one({"_id": ObjectId(week_id)})
    return {"message": "Deleted"}

# ===== LOT ROUTES =====

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
    total_planned = 0
    for color in lot.get("colors", []):
        color_total = sum(s.get("planned_qty", 0) for s in color.get("sizes", []))
        color["total"] = color_total
        total_planned += color_total
    lot["total_planned_qty"] = total_planned

    lot_id = lot.get("id", "")
    pipeline = [
        {"$match": {"lot_id": lot_id}},
        {"$group": {"_id": "$operation_id", "total": {"$sum": "$total_quantity"},
                    "earnings": {"$sum": "$total_earnings"}}},
    ]
    agg = await db.production_entries.aggregate(pipeline).to_list(200)
    by_operation = {a["_id"]: a for a in agg}

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
    return lot

@api_router.get("/lots")
async def get_lots(request: Request, status: Optional[str] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    check_permission(user, "can_view_financial")
    query = {"status": status} if status else {}
    lots = await db.lots.find(query).sort("lot_number", -1).to_list(1000)
    result = []
    for lot in lots:
        lot = serialize_doc(lot)
        lot = await enrich_lot(lot)
        result.append(lot)
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
    colors = []
    for cname in data.color_names:
        color_data = data.color_size_quantities.get(cname, {})
        size_entries = []
        for sz in sizes:
            qty = int(color_data.get(sz, 0))
            size_entries.append({"size": sz, "planned_qty": qty})
        colors.append({"color_id": str(uuid.uuid4()), "name": cname, "sizes": size_entries})
    operations = []
    for op_entry in data.operations:
        operation = await db.operations.find_one({"_id": ObjectId(op_entry.operation_id)})
        if not operation:
            raise HTTPException(400, f"Operation {op_entry.operation_id} not found")
        operators = []
        for op_id in op_entry.operator_ids:
            operator = await db.operators.find_one({"_id": ObjectId(op_id)})
            if not operator:
                raise HTTPException(400, f"Operator {op_id} not found")
            operators.append({"operator_id": op_id, "operator_name": operator["name"],
                              "operator_code": operator.get("operator_code", "")})
        operations.append({"operation_id": op_entry.operation_id, "operation_name": operation["name"],
                           "rate": op_entry.rate, "operators": operators})
    doc = {
        "lot_number": lot_number, "style_name": data.style_name,
        "start_date": data.start_date, "target_end_date": data.target_end_date,
        "status": "active", "size_chart_id": data.size_chart_id,
        "size_chart_name": size_chart["name"], "sizes": sizes,
        "colors": colors, "operations": operations,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    result = await db.lots.insert_one(doc)
    doc["id"] = str(result.inserted_id)
    doc.pop("_id", None)
    return await enrich_lot(doc)

@api_router.get("/lots/{lot_id}")
async def get_lot(lot_id: str, request: Request):
    await get_current_user(request)
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    lot = serialize_doc(lot)
    return await enrich_lot(lot)

@api_router.put("/lots/{lot_id}")
async def update_lot(lot_id: str, data: LotUpdate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    update = {}
    for field in ["style_name", "start_date", "target_end_date", "status"]:
        val = getattr(data, field)
        if val is not None:
            update[field] = val
    if data.color_size_quantities is not None:
        lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
        sizes = lot.get("sizes", [])
        colors = []
        for cname, size_data in data.color_size_quantities.items():
            size_entries = [{"size": sz, "planned_qty": int(size_data.get(sz, 0))} for sz in sizes]
            colors.append({"color_id": str(uuid.uuid4()), "name": cname, "sizes": size_entries})
        update["colors"] = colors
    if data.operations is not None:
        operations = []
        for op_entry in data.operations:
            operation = await db.operations.find_one({"_id": ObjectId(op_entry.operation_id)})
            if not operation:
                raise HTTPException(400, "Operation not found")
            operators = []
            for op_id in op_entry.operator_ids:
                operator = await db.operators.find_one({"_id": ObjectId(op_id)})
                if operator:
                    operators.append({"operator_id": op_id, "operator_name": operator["name"],
                                      "operator_code": operator.get("operator_code", "")})
            operations.append({"operation_id": op_entry.operation_id, "operation_name": operation["name"],
                               "rate": op_entry.rate, "operators": operators})
        update["operations"] = operations
    if not update:
        raise HTTPException(400, "No fields to update")
    await db.lots.update_one({"_id": ObjectId(lot_id)}, {"$set": update})
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
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
            e.pop("rate", None)
            e.pop("total_earnings", None)
    return result

@api_router.get("/production/tracking/{lot_id}")
async def get_lot_tracking(lot_id: str, request: Request, operation_id: Optional[str] = None):
    await get_current_user(request)
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    query = {"lot_id": lot_id}
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
    tracking = []
    for color in lot.get("colors", []):
        ct = {"name": color["name"], "sizes": [], "total_planned": 0, "total_produced": 0}
        for size in color.get("sizes", []):
            planned = size["planned_qty"]
            prod = produced.get(color["name"], {}).get(size["size"], 0)
            ct["sizes"].append({"size": size["size"], "planned": planned, "produced": prod, "balance": planned - prod})
            ct["total_planned"] += planned
            ct["total_produced"] += prod
        ct["balance"] = ct["total_planned"] - ct["total_produced"]
        tracking.append(ct)
    return tracking

async def assert_within_plan(lot, color, operation_id, add_qty, exclude_entry_id=None):
    """Reject quantities that would take a lot/colour/operation past its plan.

    This is the control that stops payroll inflation at source. It is called from
    both the batch-entry route and the edit route -- editing an entry used to
    skip it entirely, which made the whole guard bypassable.

    `add_qty` is {size: qty} being proposed. `exclude_entry_id` omits the entry
    being edited from the existing totals, so an edit is measured against its
    replacement rather than counted twice.
    """
    color_info = next((c for c in lot.get("colors", []) if c["name"] == color), None)
    if not color_info:
        raise HTTPException(400, "Color not found in this lot")
    planned_qty = {s["size"]: s["planned_qty"] for s in color_info.get("sizes", [])}

    query = {"lot_id": str(lot["_id"]) if "_id" in lot else lot.get("id", ""),
             "color": color, "operation_id": operation_id}
    if exclude_entry_id:
        query["_id"] = {"$ne": ObjectId(exclude_entry_id)}
    existing = await db.production_entries.find(query).to_list(10000)

    existing_qty = {}
    for e in existing:
        for sz, qty in e.get("size_quantities", {}).items():
            existing_qty[sz] = existing_qty.get(sz, 0) + qty

    errors = []
    for sz, qty in add_qty.items():
        if qty <= 0:
            continue
        total = existing_qty.get(sz, 0) + qty
        planned = planned_qty.get(sz, 0)
        if total > planned:
            errors.append(f"{sz}: {total}/{planned} exceeds planned")
    if errors:
        raise HTTPException(400, f"Quantity exceeds planned limit: {'; '.join(errors)}")


@api_router.post("/production/batch")
async def create_production_batch(data: ProductionBatchCreate, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "data_entry"])
    check_permission(user, "can_enter")
    lot = await db.lots.find_one({"_id": ObjectId(data.lot_id)})
    if not lot:
        raise HTTPException(400, "Lot not found")
    if lot.get("status") == "completed":
        raise HTTPException(400, "This lot is closed. No further production entry allowed.")
    week = await db.weeks.find_one({"_id": ObjectId(data.week_id)})
    if not week:
        raise HTTPException(400, "Week not found")
    op_info = next((op for op in lot.get("operations", []) if op["operation_id"] == data.operation_id), None)
    if not op_info:
        raise HTTPException(400, "Operation not found in this lot")
    color_info = next((c for c in lot.get("colors", []) if c["name"] == data.color), None)
    if not color_info:
        raise HTTPException(400, "Color not found in this lot")
    new_qty = {}
    for entry in data.entries:
        for sz, qty in entry.sizes.items():
            q = int(qty) if qty else 0
            if q > 0:
                new_qty[sz] = new_qty.get(sz, 0) + q
    await assert_within_plan(lot, data.color, data.operation_id, new_qty)
    dup_warnings = []
    saved = []
    for entry in data.entries:
        operator = await db.operators.find_one({"_id": ObjectId(entry.operator_id)})
        if not operator:
            continue
        size_quantities = {k: int(v) for k, v in entry.sizes.items() if int(v or 0) > 0}
        total_qty = sum(size_quantities.values())
        if total_qty == 0:
            continue
        # Duplicate = the SAME operator, on the SAME day, for the same
        # lot/operation/colour. `date` used to be missing from this key, which
        # meant only the first day of each week could ever be saved - every
        # later day was silently discarded and the operator was underpaid.
        existing_dup = await db.production_entries.find_one({
            "week_id": data.week_id, "lot_id": data.lot_id, "operation_id": data.operation_id,
            "color": data.color, "operator_id": entry.operator_id, "date": data.date
        })
        if existing_dup:
            dup_warnings.append(
                f"{operator['name']} ({operator.get('operator_code','')}) already has an entry for {data.date}")
            continue
        doc = {
            "week_id": data.week_id, "week_number": week.get("week_number"),
            "year": week.get("year"), "lot_id": data.lot_id,
            "lot_number": lot["lot_number"], "style_name": lot["style_name"],
            "operation_id": data.operation_id, "operation_name": op_info["operation_name"],
            "color": data.color, "rate": op_info["rate"],
            "operator_id": entry.operator_id, "operator_name": operator["name"],
            "operator_code": operator.get("operator_code", ""),
            "size_quantities": size_quantities, "total_quantity": total_qty,
            "total_earnings": round(total_qty * op_info["rate"], 2),
            "date": data.date, "entered_by": user["id"],
            "entered_by_name": user.get("name", ""),
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        result = await db.production_entries.insert_one(doc)
        doc["id"] = str(result.inserted_id)
        doc.pop("_id", None)
        saved.append(doc)
    return {"saved": len(saved), "entries": saved, "duplicates_skipped": dup_warnings}

@api_router.delete("/production/{entry_id}")
async def delete_production(entry_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
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
    await assert_within_plan(lot, entry.get("color", ""), entry.get("operation_id", ""),
                             new_sq, exclude_entry_id=entry_id)

    new_total = sum(new_sq.values())
    new_earnings = round(new_total * entry.get("rate", 0), 2)
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
    return {} if user["role"] == "admin" else {"audience": {"$ne": "admin"}}

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
        await assert_within_plan(lot, entry.get("color", ""), entry.get("operation_id", ""),
                                 new_sq, exclude_entry_id=er["entry_id"])

        new_total = sum(new_sq.values())
        new_earnings = round(new_total * entry.get("rate", 0), 2)
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
        op_name = entry.get("operation_name", "")
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
    return {
        "active_lots": active_lots, "total_operators": total_operators,
        "week_production": week_production, "week_earnings": week_earnings,
        "week_number": wk, "year": yr, "lots": lot_data,
        "top_operators": top_operators, "operation_stats": list(operation_map.values())
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
    entries = await db.production_entries.find({"lot_id": lot_id}).to_list(10000)
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
    return {"week": week, "year": year, "lots": result_lots,
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
    entries = await db.production_entries.find({"lot_id": lot_id}).to_list(10000)
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
    entries = await db.production_entries.find({"lot_id": lot_id}).to_list(10000)
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
                ws.append([e.get("date", ""), e.get("color", ""), sz, e.get("operation_name", ""),
                           qty, round(qty * e.get("rate", 0), 2)])

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
            ws.append([n, d["rate"], d["qty"], d["cost"]])

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
                            "enquiries", "rate_limits"]
    cleared = []
    for col in collections_to_clear:
        await db[col].drop()
        cleared.append(col)
    await db.users.delete_many({"role": {"$ne": "admin"}})
    await seed_settings()
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
    await db.users.update_one({"_id": ObjectId(user_id)}, {"$set": update})
    u = await db.users.find_one({"_id": ObjectId(user_id)}, {"password_hash": 0})
    return serialize_doc(u)

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if user_id == user["id"]:
        raise HTTPException(400, "Cannot delete yourself")
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
