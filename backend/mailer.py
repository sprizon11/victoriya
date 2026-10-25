"""Email reports.

Nothing here is required to run the app: with no SMTP_HOST set every send is
recorded as 'skipped' and the Settings page says email is not configured.

SMTP credentials come from environment variables only (never the database):
  SMTP_HOST, SMTP_PORT (587), SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_STARTTLS (true)
Scheduled sends are driven by POST /api/jobs/run?token=CRON_TOKEN, called by an
external timer, because the free hosting plan sleeps and would silently miss an
in-process scheduler.
"""
import asyncio
import html
import io
import json
import os
import re
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core import db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc, logger, COMPANY, get_fy_suffix
from audit import note
import lifecycle

router = APIRouter(prefix="/api")
IST = timezone(timedelta(hours=5, minutes=30))        # India has no daylight saving; no tz database needed
SEND_HOUR = 8

REPORTS = {
    "pending_lots": {"label": "Open and overdue lots", "schedule": "weekly", "only_if_any": False, "attach": True},
    "payroll_summary": {"label": "Weekly payroll summary", "schedule": "weekly", "only_if_any": True, "attach": True},
    "advance_outstanding": {"label": "Advances outstanding", "schedule": "weekly", "only_if_any": True, "attach": False},
    "low_stock": {"label": "Low stock", "schedule": "daily", "only_if_any": True, "attach": True},
    "pending_approvals": {"label": "Approvals waiting more than a day", "schedule": "daily", "only_if_any": True, "attach": False},
    "expense_summary": {"label": "Expense summary", "schedule": "monthly", "only_if_any": False, "attach": True},
    "fy_rollover": {"label": "Financial-year rollover reminder", "schedule": "april", "only_if_any": True, "attach": False},
    "enquiries": {"label": "New website enquiries", "schedule": "daily", "only_if_any": True, "attach": False},
}
SCHEDULES = ["off", "daily", "weekly", "monthly", "april"]
FORMATS = ["html", "pdf", "excel", "both"]
EMAIL_RE = re.compile(r"^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$")


def _now():
    return datetime.now(timezone.utc).isoformat()


# ------------------------------------------------------------------ SMTP
def smtp_config():
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        return None
    return {"host": host, "port": int(os.environ.get("SMTP_PORT", "587") or 587),
            "user": os.environ.get("SMTP_USER", ""), "password": os.environ.get("SMTP_PASSWORD", ""),
            "from": os.environ.get("SMTP_FROM", "") or os.environ.get("SMTP_USER", "") or "noreply@localhost",
            "starttls": os.environ.get("SMTP_STARTTLS", "true").lower() in ("1", "true", "yes")}


def _send_sync(cfg, msg):
    with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as s:
        if cfg["starttls"]:
            s.starttls()
        if cfg["user"]:
            s.login(cfg["user"], cfg["password"])
        s.send_message(msg)


async def send_mail(to, subject, html_body, text_body, attachments=(), report="", trigger="manual"):
    """Send and ALWAYS write a log row. Never raises: a mail failure must not break a request or a job."""
    to = [t for t in to if EMAIL_RE.match(t or "")]
    cfg = smtp_config()
    status, error = "ok", ""
    if not to:
        status, error = "skipped", "No recipients are set for this report"
    elif not cfg:
        status, error = "skipped", "Email is not configured (SMTP_HOST is not set)"
    else:
        msg = EmailMessage()
        msg["Subject"], msg["From"], msg["To"] = subject, cfg["from"], ", ".join(to)
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")
        for name, data, mime in attachments:
            main, sub = mime.split("/")
            msg.add_attachment(data, maintype=main, subtype=sub, filename=name)
        try:
            await asyncio.to_thread(_send_sync, cfg, msg)
        except Exception as exc:                      # noqa: BLE001  (network, auth, TLS ...)
            status, error = "failed", f"{type(exc).__name__}: {exc}"[:300]
            logger.warning("email send failed: %s", error)
    await db.email_log.insert_one({"at": _now(), "report": report, "to": to, "subject": subject, "status": status,
                                   "error": error, "trigger": trigger, "attachments": [a[0] for a in attachments]})
    return status, error


# ------------------------------------------------------------------ settings
async def load_settings():
    doc = await db.system_settings.find_one({"key": "email_reports"})
    try:
        stored = json.loads(doc["value"]) if doc else {}
    except (ValueError, TypeError, KeyError):
        stored = {}
    reports = {}
    for key, meta in REPORTS.items():
        s = (stored.get("reports") or {}).get(key, {})
        reports[key] = {"enabled": bool(s.get("enabled", False)), "recipients": [r for r in s.get("recipients", []) if EMAIL_RE.match(r)],
                        "schedule": s.get("schedule") if s.get("schedule") in SCHEDULES else meta["schedule"],
                        "format": s.get("format") if s.get("format") in FORMATS else ("both" if meta["attach"] else "html")}
    return {"reports": reports, "include_names": bool(stored.get("include_names", False))}


class ReportSetting(BaseModel):
    enabled: bool = False
    recipients: list[str] = Field(default_factory=list, max_length=20)
    schedule: str = "weekly"
    format: str = "both"


class EmailSettings(BaseModel):
    reports: dict[str, ReportSetting]
    include_names: bool = False


@router.get("/email/settings")
async def get_email_settings(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    cfg = smtp_config()
    return {"configured": bool(cfg), "from": cfg["from"] if cfg else "", "cron_token_set": bool(os.environ.get("CRON_TOKEN")),
            "meta": {k: {"label": v["label"]} for k, v in REPORTS.items()}, "schedules": SCHEDULES, "formats": FORMATS,
            **await load_settings()}


@router.put("/email/settings")
async def put_email_settings(data: EmailSettings, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    out = {}
    for key, s in data.reports.items():
        if key not in REPORTS:
            raise HTTPException(400, f"Unknown report '{key}'")
        if s.schedule not in SCHEDULES or s.format not in FORMATS:
            raise HTTPException(400, "Unknown schedule or format")
        bad = [r for r in s.recipients if not EMAIL_RE.match(r.strip())]
        if bad:
            raise HTTPException(400, f"Not an email address: {', '.join(bad)}")
        out[key] = {"enabled": s.enabled, "recipients": [r.strip().lower() for r in s.recipients], "schedule": s.schedule, "format": s.format}
    before = await load_settings()
    await db.system_settings.update_one({"key": "email_reports"}, {"$set": {"value": json.dumps({"reports": out, "include_names": data.include_names})}}, upsert=True)
    note(request, entity_type="setting", entity_id="email_reports", label="Email reports", summary="Changed email report settings",
         before={k: {"enabled": v["enabled"], "schedule": v["schedule"]} for k, v in before["reports"].items()},
         after={k: {"enabled": v["enabled"], "schedule": v["schedule"], "recipients": len(v["recipients"])} for k, v in out.items()})
    return await load_settings()


@router.get("/email/log")
async def email_log(request: Request, limit: int = Query(50, ge=1, le=200)):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    return [serialize_doc(r) for r in await db.email_log.find().sort("at", -1).limit(limit).to_list(limit)]


class TestMail(BaseModel):
    to: str


@router.post("/email/test")
async def email_test(data: TestMail, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if not EMAIL_RE.match(data.to.strip()):
        raise HTTPException(400, "That is not an email address")
    status, error = await send_mail([data.to.strip()], "Test email from Victoria Unit Flow",
                                    "<p>This is a test. Email reports are set up correctly.</p>", "This is a test. Email reports are set up correctly.",
                                    report="test", trigger="test")
    note(request, entity_type="setting", entity_id="email_test", label=data.to, summary=f"Sent a test email to {data.to}: {status}")
    if status == "ok":
        return {"status": "ok"}
    raise HTTPException(400 if status == "skipped" else 502, error)


# ------------------------------------------------------------------ report content
def table_html(headers, rows):
    th = "".join(f'<th style="text-align:left;padding:6px 10px;background:#294f96;color:#fff;font-size:12px">{html.escape(str(h))}</th>' for h in headers)
    body = "".join("<tr>" + "".join(f'<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;font-size:13px">{html.escape("" if c is None else str(c))}</td>' for c in r) + "</tr>"
                   for r in rows)
    return f'<table style="border-collapse:collapse;width:100%;max-width:760px"><tr>{th}</tr>{body}</table>'


def wrap(title, intro, inner):
    return (f'<div style="font-family:Segoe UI,Arial,sans-serif;color:#0f1d3a"><h2 style="color:#294f96;margin:0 0 4px">{html.escape(title)}</h2>'
            f'<p style="color:#475569;margin:0 0 14px">{html.escape(intro)}</p>{inner}'
            f'<p style="color:#94a3b8;font-size:12px;margin-top:20px">{html.escape(COMPANY["name"])} · sent by Victoria Unit Flow</p></div>')


def text_table(headers, rows):
    return "\n".join([" | ".join(headers)] + [" | ".join("" if c is None else str(c) for c in r) for r in rows])


async def build_report(key: str, settings: dict):
    """-> dict(subject, html, text, headers, rows, title) or None when there is nothing to say."""
    today = datetime.now(IST).date()
    if key == "pending_lots":
        rows = []
        async for lot in db.lots.find({"status": "active"}).sort("lot_number", 1):
            s = await lifecycle._enrich(serialize_doc(dict(lot)))
            end = lot.get("target_end_date", "")
            overdue = 0
            try:
                overdue = (today - datetime.strptime(end, "%Y-%m-%d").date()).days
            except ValueError:
                pass
            old_year = lifecycle.lot_fy(lot) != get_fy_suffix()
            if overdue > 0 or old_year or s["progress"] < 100:
                slowest = min(s["operation_progress"], key=lambda o: o["produced_qty"], default=None)
                rows.append([s["lot_number"], s["style_name"], s["total_planned_qty"], s["total_produced_qty"], s["balance_qty"], f"{s['progress']}%",
                             end, f"{overdue} days" if overdue > 0 else "", ("last year" if old_year else ""), slowest["operation_name"] if slowest else ""])
        rows.sort(key=lambda r: (r[7] == "", r[0]))
        headers = ["Lot", "Style", "Planned", "Produced", "Balance", "Done", "Due", "Overdue", "Carried", "Slowest operation"]
        n_over = sum(1 for r in rows if r[7])
        title, intro = "Open and overdue lots", f"{len(rows)} lots are still open; {n_over} past their target date."
        if not rows:
            title, intro = "Open and overdue lots", "Every lot is closed. Nothing is pending."
    elif key == "payroll_summary":
        from_week = await db.production_entries.find_one({"date": {"$lt": today.strftime("%Y-%m-%d")}}, sort=[("date", -1)])
        if not from_week:
            return None
        wk, yr = from_week["week_number"], from_week["year"]
        agg = await db.production_entries.aggregate([{"$match": {"week_number": wk, "year": yr}},
                                                      {"$group": {"_id": "$operator_id", "q": {"$sum": "$total_quantity"}, "e": {"$sum": "$total_earnings"}}}]).to_list(2000)
        gross = round(sum(a["e"] for a in agg), 2)
        pieces = sum(a["q"] for a in agg)
        out = 0.0
        async for a in db.advances.find({"status": {"$in": ["pending", "partially_adjusted"]}, "operator_id": {"$in": [x["_id"] for x in agg]}}):
            out += a.get("balance", 0)
        headers = ["Week", "Operators", "Pieces", "Gross wages", "Advances outstanding for them"]
        rows = [[f"W{wk} {yr}", len(agg), pieces, f"{gross:,.2f}", f"{round(out, 2):,.2f}"]]
        title, intro = "Weekly payroll summary", f"Totals for week {wk}, {yr}. Individual pay is not included in this email."
    elif key == "advance_outstanding":
        rows, total = [], 0.0
        async for a in db.advances.find({"status": {"$in": ["pending", "partially_adjusted"]}}):
            total += a.get("balance", 0)
            rows.append([a.get("operator_name", "") if settings["include_names"] else "—", a.get("voucher_number", ""), a.get("date", ""), f"{a.get('balance', 0):,.2f}"])
        if not rows:
            return None
        headers = ["Operator", "Voucher", "Date", "Balance"]
        title, intro = "Advances outstanding", f"{len(rows)} advances, {total:,.2f} still to recover."
    elif key == "low_stock":
        from stock import all_balances
        items = await db.stock_items.find({"active": True, "reorder_level": {"$gt": 0}}).to_list(2000)
        bal = await all_balances([str(i["_id"]) for i in items])
        rows = [[i["name"], f"{bal.get(str(i['_id']), {'store': [0]})['store'][0]:g} {i['uom']}", f"{i['reorder_level']:g}"]
                for i in items if bal.get(str(i["_id"]), {"store": [0]})["store"][0] <= i["reorder_level"] + 0.0005]
        if not rows:
            return None
        headers = ["Item", "In store", "Reorder at"]
        title, intro = "Low stock", f"{len(rows)} items are at or below their reorder level."
    elif key == "pending_approvals":
        cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        rows = [[a["type"].replace("_", " "), a.get("entity_label", ""), a.get("requested_by_name", ""), a["requested_at"][:10]]
                async for a in db.approvals.find({"status": "pending", "requested_at": {"$lt": cutoff}}).sort("requested_at", 1)]
        if not rows:
            return None
        headers = ["Request", "About", "Asked by", "Date"]
        title, intro = "Approvals waiting", f"{len(rows)} requests have been waiting for more than a day."
    elif key == "expense_summary":
        month = today.strftime("%Y-%m")
        rows, total, unpaid = [], 0.0, 0.0
        async for g in db.expenses.aggregate([{"$match": {"status": "approved", "date": {"$regex": f"^{month}"}}},
                                              {"$group": {"_id": "$category_name", "t": {"$sum": "$total"}, "n": {"$sum": 1}}}, {"$sort": {"t": -1}}]):
            rows.append([g["_id"], g["n"], f"{g['t']:,.2f}"]); total += g["t"]
        async for e in db.expenses.find({"status": "approved", "payment_status": {"$ne": "paid"}}):
            unpaid += max(0, e["total"] - e.get("paid_amount", 0))
        headers = ["Category", "Bills", "Total"]
        title, intro = "Expense summary", f"{month}: {total:,.2f} spent so far. {unpaid:,.2f} of bills are still unpaid."
    elif key == "fy_rollover":
        ov = await lifecycle.open_previous_year_lots()
        if not ov["lots"]:
            return None
        rows = [[l["lot_number"], l["style_name"], l["fy"], l["balance"], f"{l['progress']}%"] for l in ov["lots"]]
        headers = ["Lot", "Style", "Year", "Balance", "Done"]
        title, intro = "Financial-year rollover", f"{len(rows)} lots from earlier years are still open. Close them or carry them forward in the app (Lots, then Year end)."
    elif key == "enquiries":
        rows = [[e.get("name", ""), e.get("company", ""), e.get("email", ""), e.get("created_at", "")[:10], (e.get("message", "")[:80])]
                async for e in db.enquiries.find({"status": "new"}).sort("created_at", -1).limit(50)]
        if not rows:
            return None
        headers = ["Name", "Company", "Email", "Date", "Message"]
        title, intro = "New website enquiries", f"{len(rows)} enquiries have not been handled yet."
    else:
        return None
    return {"title": title, "headers": headers, "rows": rows, "subject": f"{COMPANY['name']}: {title}",
            "html": wrap(title, intro, table_html(headers, rows) if rows else ""), "text": f"{title}\n{intro}\n\n" + (text_table(headers, rows) if rows else "")}


def attachments_for(rep, fmt):
    out = []
    if fmt in ("pdf", "both"):
        out.append((f"{rep['title'].replace(' ', '_')}.pdf", lifecycle._pdf(rep["title"], datetime.now(IST).strftime("%d %b %Y"),
                                                                              [("table", rep["headers"], rep["rows"])]).read(), "application/pdf"))
    if fmt in ("excel", "both"):
        out.append((f"{rep['title'].replace(' ', '_')}.xlsx", lifecycle._xlsx([(rep["title"][:30], rep["headers"], rep["rows"])]).read(),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
    return out


async def send_report(key: str, trigger: str, force_to: Optional[list] = None):
    settings = await load_settings()
    cfg = settings["reports"][key]
    rep = await build_report(key, settings)
    if rep is None:
        await db.email_log.insert_one({"at": _now(), "report": key, "to": cfg["recipients"], "subject": REPORTS[key]["label"], "status": "skipped",
                                       "error": "Nothing to report", "trigger": trigger, "attachments": []})
        return "skipped", "Nothing to report"
    atts = attachments_for(rep, cfg["format"]) if rep["rows"] else []
    return await send_mail(force_to or cfg["recipients"], rep["subject"], rep["html"], rep["text"], atts, report=key, trigger=trigger)


@router.post("/email/send/{key}")
async def send_now(key: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if key not in REPORTS:
        raise HTTPException(404, "Unknown report")
    status, error = await send_report(key, "manual")
    note(request, entity_type="setting", entity_id=key, label=REPORTS[key]["label"], summary=f"Sent '{REPORTS[key]['label']}' now: {status}")
    return {"status": status, "message": error}


@router.post("/email/preview/{key}")
async def preview(key: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    if key not in REPORTS:
        raise HTTPException(404, "Unknown report")
    rep = await build_report(key, await load_settings())
    return {"empty": rep is None, **({k: rep[k] for k in ("title", "headers", "rows", "html")} if rep else {})}


async def notify_enquiry(doc):
    """Immediate mail for a new website enquiry; best effort, never raises."""
    try:
        s = (await load_settings())["reports"]["enquiries"]
        if not s["enabled"]:
            return
        body = f"New enquiry from {doc['name']} ({doc['email']})\n\n{doc['message']}"
        await send_mail(s["recipients"], f"{COMPANY['name']}: new website enquiry from {doc['name']}",
                        wrap("New website enquiry", f"From {doc['name']} · {doc['email']} · {doc.get('phone', '')}",
                             f"<p style='white-space:pre-wrap'>{html.escape(doc['message'])}</p>"), body, report="enquiries", trigger="immediate")
    except Exception:
        logger.exception("enquiry notification failed")


# ------------------------------------------------------------------ scheduling (called by an outside timer)
def period_key(schedule: str, now_ist: datetime):
    """The 'already sent for this period' key, or None if this schedule is not due right now."""
    if now_ist.hour < SEND_HOUR:
        return None
    d = now_ist.date()
    if schedule == "daily":
        return d.isoformat()
    if schedule == "weekly" and d.weekday() == 0:
        iso = d.isocalendar()
        return f"{iso[0]}-W{iso[1]:02d}"
    if schedule == "monthly" and d.day == 1:
        return d.strftime("%Y-%m")
    if schedule == "april" and d.month == 4 and d.day in (1, 8, 15):
        return d.isoformat()
    return None


async def claim(report: str, key: str) -> bool:
    """Atomically take the right to send this report for this period. Two overlapping
    cron calls (or two server instances) must not both send."""
    try:
        res = await db.scheduler_state.update_one({"report": report, "last_key": {"$ne": key}},
                                                  {"$set": {"last_key": key, "claimed_at": _now()}}, upsert=True)
        return bool(res.modified_count or res.upserted_id)
    except DuplicateKeyError:
        return False


async def run_due_jobs(now: Optional[datetime] = None):
    now_ist = (now or datetime.now(timezone.utc)).astimezone(IST)
    settings = await load_settings()
    ran = []
    for key, cfg in settings["reports"].items():
        if not cfg["enabled"] or cfg["schedule"] == "off":
            continue
        pk = period_key(cfg["schedule"], now_ist)
        if not pk or not await claim(key, pk):
            continue
        status, msg = await send_report(key, "cron")
        ran.append({"report": key, "status": status, "message": msg})
    return ran


@router.post("/jobs/run")
async def jobs_run(token: str = Query("", max_length=200)):
    expected = os.environ.get("CRON_TOKEN", "")
    if not expected:
        raise HTTPException(503, "Scheduled jobs are not configured (CRON_TOKEN is not set)")
    if not secrets.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(403, "Forbidden")
    return {"ran": await run_due_jobs(), "at": _now()}
