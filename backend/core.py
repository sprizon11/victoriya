"""Shared plumbing: config, database handle, auth helpers, numbering.

Extracted from server.py so feature modules (audit, approvals, groups, ...) can
import it without importing the app itself. Nothing here changed behaviour.
"""
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
from fastapi import HTTPException, Request, Response
from motor.motor_asyncio import AsyncIOMotorClient
from bson import ObjectId
import bcrypt
import jwt

logger = logging.getLogger(__name__)
# ===== ENVIRONMENT / DEPLOYMENT CONFIG =====
# PUBLIC_MODE=true is set on the hosted deployment. It refuses to boot on unsafe
# defaults, so a misconfigured instance fails loudly instead of going online with
# a known secret.
PUBLIC_MODE = os.environ.get("PUBLIC_MODE", "").lower() in ("1", "true", "yes")

_UNSAFE_SECRETS = {
    "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "changeme", "secret", "",
}

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"

if not JWT_SECRET:
    raise RuntimeError("JWT_SECRET is not set. Generate one with: python -c \"import secrets;print(secrets.token_hex(32))\"")

if PUBLIC_MODE:
    if JWT_SECRET in _UNSAFE_SECRETS:
        raise RuntimeError(
            "JWT_SECRET is still the shared development value. Generate a fresh one "
            "(python -c \"import secrets;print(secrets.token_hex(32))\") and set it in the host's "
            "environment before deploying."
        )
    if os.environ.get("ADMIN_PASSWORD", "") in ("admin123", "", "password", "admin"):
        raise RuntimeError("ADMIN_PASSWORD is unsafe. Set a strong ADMIN_PASSWORD before deploying publicly.")

# Comma-separated list of allowed browser origins. Empty = same-origin only,
# which is the case in production because this process also serves the frontend.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]

# Cookies must be Secure over HTTPS. Locally (plain http) that would break login,
# so it follows PUBLIC_MODE unless explicitly overridden.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true" if PUBLIC_MODE else "false").lower() in ("1", "true", "yes")
# Same-origin deployment means Lax works and is materially safer than None.
COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "lax" if PUBLIC_MODE else "lax")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

def set_auth_cookie(response: Response, name: str, value: str, max_age: int):
    """Single place that knows how auth cookies must be written."""
    response.set_cookie(
        name, value, httponly=True, secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE, max_age=max_age, path="/",
    )

# ===== HELPERS =====

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())

def create_access_token(user_id: str, email: str, role: str) -> str:
    return jwt.encode(
        {"sub": user_id, "email": email, "role": role,
         "exp": datetime.now(timezone.utc) + timedelta(hours=8), "type": "access"},
        JWT_SECRET, algorithm=JWT_ALGORITHM
    )

def create_refresh_token(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"},
        JWT_SECRET, algorithm=JWT_ALGORITHM
    )

def serialize_doc(doc):
    if not doc:
        return None
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    return doc

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Not authenticated")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(401, "Invalid token type")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(401, "User not found")
        user["id"] = str(user["_id"])
        del user["_id"]
        user.pop("password_hash", None)
        if not user.get("active", True):
            raise HTTPException(403, "This account has been deactivated")
        # Defaults for users created before these flags existed. Admins always
        # hold every permission; everyone else falls back to their role's baseline.
        # (Previously `can_enter` was `role == "admin" or True`, i.e. always True.)
        is_admin = user.get("role") == "admin"
        user.setdefault("can_enter", True)
        user.setdefault("can_edit", is_admin)
        user.setdefault("can_delete", is_admin)
        user.setdefault("can_view_financial", user.get("role") in ["admin", "accounts"])
        if is_admin:
            user.update(can_enter=True, can_edit=True, can_delete=True, can_view_financial=True)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

def check_role(user: dict, roles: list):
    if user["role"] not in roles:
        raise HTTPException(403, "Access denied")

# Human-readable names for the per-user permission checkboxes on the Users screen.
_PERMISSION_LABELS = {
    "can_enter": "record production",
    "can_edit": "edit records",
    "can_delete": "delete records",
    "can_view_financial": "view financial data",
}

def check_permission(user: dict, flag: str):
    """Enforce a per-user permission flag on top of the role check.

    These flags are shown as checkboxes in the Users screen but were previously
    never read by any route, so unticking one had no effect. Admins always pass.
    """
    if user.get("role") == "admin":
        return
    if not user.get(flag, False):
        raise HTTPException(403, f"Your account does not have permission to {_PERMISSION_LABELS.get(flag, flag)}")

async def get_next_lot_number():
    fy = get_fy_suffix()
    result = await db.counters.find_one_and_update(
        {"name": f"lot_{fy}"}, {"$inc": {"value": 1}},
        upsert=True, return_document=True
    )
    return f"LOT{result['value']}/{fy}"

async def get_next_operator_code():
    result = await db.counters.find_one_and_update(
        {"name": "operator_code"}, {"$inc": {"value": 1}},
        upsert=True, return_document=True
    )
    return f"OP{result['value']:03d}"

async def get_current_week():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    week = await db.weeks.find_one({"start_date": {"$lte": today}, "end_date": {"$gte": today}})
    if week:
        return serialize_doc(week)
    d = datetime.now(timezone.utc)
    return {"week_number": d.isocalendar()[1], "year": d.isocalendar()[0], "id": None}

async def get_next_voucher_number():
    fy = get_fy_suffix()
    result = await db.counters.find_one_and_update(
        {"name": f"voucher_{fy}"}, {"$inc": {"value": 1}},
        upsert=True, return_document=True
    )
    return f"PV{result['value']}/{fy}"

async def get_voucher_number_for(operator_id: str, week: int, year: int) -> str:
    """Return this operator/week's voucher number, allocating one only if needed.

    Generating the PDF used to call get_next_voucher_number() every time, so
    previewing a voucher twice burned two numbers and a reprint of a lost
    voucher came out with a different number than the one already issued.
    A numbered financial document has to be stable, so it is stored on first
    issue and re-read afterwards.
    """
    key = {"operator_id": operator_id, "week_number": week, "year": year}
    existing = await db.vouchers.find_one(key)
    if existing:
        return existing["voucher_number"]
    number = await get_next_voucher_number()
    doc = dict(key)
    doc.update(voucher_number=number, issued_at=datetime.now(timezone.utc).isoformat())
    try:
        await db.vouchers.insert_one(doc)
    except Exception:
        # lost a race with a concurrent print - use whichever number won
        existing = await db.vouchers.find_one(key)
        if existing:
            return existing["voucher_number"]
        raise
    return number

async def get_next_advance_voucher_number():
    fy = get_fy_suffix()
    result = await db.counters.find_one_and_update(
        {"name": f"adv_voucher_{fy}"}, {"$inc": {"value": 1}},
        upsert=True, return_document=True
    )
    return f"ADV{result['value']}/{fy}"

def get_financial_year():
    today = datetime.now(timezone.utc)
    if today.month >= 4:
        return today.year, today.year + 1
    return today.year - 1, today.year

def get_fy_suffix():
    s, e = get_financial_year()
    return f"{s % 100}-{e % 100}"

COMPANY = {
    "name": "Victoria Garments",
    "address": "317/4b,4c,Sri Nagar, Kumarasamy Nagar (East), Pitchampalayam Pudur (PO), Tiruppur - 641603",
    "phone": "0421-2479137",
    "email": "info@victoriagarments.in",
    "logo_url": "/victoria-logo-white.jpg"
}
