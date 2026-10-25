"""Lot lifecycle: costing, the closing report, and the financial-year rollover.

Costing answers "what did each finished piece actually cost?" from data that
already exists: labour from production entries, materials from the stock ledger
(valued when they moved), bills charged to the lot, and a share of general
overhead. Closing freezes those numbers into an immutable snapshot so later
master-data edits can never change what a closed lot cost.
"""
import io
import re
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from core import (db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc, get_fy_suffix,
                  get_financial_year, get_next_lot_number, COMPANY)
from audit import note
import approvals
from lotmath import lot_op_rates
from ratetypes import default_rate_type
from stock import all_balances, post_movement, MovementIn, r3, EPS
from purchasing import lot_planned_total

router = APIRouter(prefix="/api")
_enrich = None


def configure(enrich_lot):
    """server.py hands over enrich_lot so this module never imports the app."""
    global _enrich
    _enrich = enrich_lot


def _now():
    return datetime.now(timezone.utc).isoformat()


def fy_of(date_str: str) -> str:
    """'26-27' for any date in April 2026 - March 2027."""
    try:
        d = datetime.strptime(date_str[:10], "%Y-%m-%d")
    except (TypeError, ValueError):
        return get_fy_suffix()
    start = d.year if d.month >= 4 else d.year - 1
    return f"{start % 100}-{(start + 1) % 100}"


def lot_fy(lot) -> str:
    return lot.get("fy") or fy_of(lot.get("start_date", ""))


async def _lot(lot_id):
    if not ObjectId.is_valid(lot_id):
        raise HTTPException(404, "Lot not found")
    lot = await db.lots.find_one({"_id": ObjectId(lot_id)})
    if not lot:
        raise HTTPException(404, "Lot not found")
    return lot


# ------------------------------------------------------------------ produced pieces
async def produced_matrix(lot_id: str):
    """({(colour,size): pieces a piece has been through EVERY operation}, {op_id: total})
    A piece is finished when the slowest operation has covered it, per colour and size."""
    per = {}
    totals = {}
    async for e in db.production_entries.find({"lot_id": lot_id, "counts_toward_plan": {"$ne": False}},
                                              {"color": 1, "operation_id": 1, "size_quantities": 1, "total_quantity": 1}):
        totals[e["operation_id"]] = totals.get(e["operation_id"], 0) + e.get("total_quantity", 0)
        for sz, q in (e.get("size_quantities") or {}).items():
            k = (e.get("color", ""), sz)
            per.setdefault(k, {})[e["operation_id"]] = per.setdefault(k, {}).get(e["operation_id"], 0) + q
    return per, totals


def finished_for(per, lot, color, size):
    ops = [o["operation_id"] for o in lot.get("operations", [])]
    if not ops:
        return 0
    row = per.get((color, size), {})
    return min(row.get(o, 0) for o in ops)


# ------------------------------------------------------------------ overhead allocation
async def allocate_overhead(lot_id: str):
    """Share of un-attributed bills this lot should carry.

    Rule (confirm with the owner): each month's general overhead is split across
    lots in proportion to the pieces each handled that month. Kept in one function
    so the rule can change without touching the report."""
    months = {}
    async for e in db.expenses.find({"lot_id": {"$in": ["", None]}, "status": "approved"}, {"date": 1, "total": 1}):
        months[e["date"][:7]] = months.get(e["date"][:7], 0.0) + e["total"]
    if not months:
        return 0.0, []
    share_total, detail = 0.0, []
    for month, pool in months.items():
        mine = everyone = 0
        async for g in db.production_entries.aggregate([
                {"$match": {"date": {"$regex": f"^{re.escape(month)}"}}},
                {"$group": {"_id": "$lot_id", "q": {"$sum": "$total_quantity"}}}]):
            everyone += g["q"]
            if g["_id"] == lot_id:
                mine = g["q"]
        if everyone > 0 and mine > 0:
            part = round(pool * mine / everyone, 2)
            share_total += part
            detail.append({"month": month, "pool": round(pool, 2), "lot_pieces": mine, "all_pieces": everyone, "share": part})
    return round(share_total, 2), detail


# ------------------------------------------------------------------ costing
async def compute_costing(lot_id: str):
    lot = await _lot(lot_id)
    lot_s = serialize_doc(dict(lot))
    lot_s = await _enrich(lot_s)
    default = await default_rate_type()
    planned_total = lot_planned_total(lot)
    order_total = lot_s.get("total_order_qty", planned_total)
    produced = lot_s["total_produced_qty"]

    # ---- labour: by operation group -> operation -> rate type
    labour_rows, labour_total, non_plan_cost, non_plan_qty = {}, 0.0, 0.0, 0
    async for e in db.production_entries.find({"lot_id": lot_id}):
        key = (e.get("operation_group") or "", e.get("operation_name", ""), e.get("rate_type_name") or "Regular")
        r = labour_rows.setdefault(key, {"group": key[0], "operation": key[1], "rate_type": key[2], "qty": 0, "cost": 0.0})
        r["qty"] += e.get("total_quantity", 0)
        r["cost"] += e.get("total_earnings", 0)
        labour_total += e.get("total_earnings", 0)
        if e.get("counts_toward_plan") is False:
            non_plan_cost += e.get("total_earnings", 0)
            non_plan_qty += e.get("total_quantity", 0)
    for r in labour_rows.values():
        r["cost"] = round(r["cost"], 2)
    labour = sorted(labour_rows.values(), key=lambda r: (r["group"], r["operation"], r["rate_type"]))

    # ---- planned labour per operation: every planned piece through the operation at the lot's rate card
    plan_by_size = {}
    for c in lot.get("colors", []):
        for s in c.get("sizes", []):
            plan_by_size[s["size"]] = plan_by_size.get(s["size"], 0) + s["planned_qty"]
    variance = []
    for op in lot.get("operations", []):
        flat, srates = None, {}
        for row in lot_op_rates(op, default):
            if row.get("rate_type_id") == default["id"]:
                flat, srates = row.get("rate", 0), row.get("size_rates") or {}
        planned_cost = round(sum(q * srates.get(sz, flat or 0) for sz, q in plan_by_size.items()), 2)
        actual = round(sum(r["cost"] for r in labour if r["operation"] == op["operation_name"] and r["rate_type"] == "Regular"), 2)
        variance.append({"operation": op["operation_name"], "planned_cost": planned_cost, "actual_cost": actual,
                         "variance": round(actual - planned_cost, 2),
                         "variance_pct": round((actual - planned_cost) / planned_cost * 100, 1) if planned_cost else None})

    # ---- materials: issued - returned - moved out + moved in, valued when they moved
    mats = {}
    async for m in db.stock_movements.find({"$or": [{"lot_id": lot_id}, {"to_lot_id": lot_id}]}):
        s = m.get("sign", 1)
        row = mats.setdefault(m["item_id"], {"item": m["item_name"], "uom": m["uom"], "issued": 0.0, "returned": 0.0, "wasted": 0.0,
                                             "moved_in": 0.0, "moved_out": 0.0, "value": 0.0, "wasted_value": 0.0})
        q, amt = s * m["qty"], s * (m.get("amount") or 0)
        if m["type"] == "issue" and m.get("lot_id") == lot_id:
            row["issued"] += q; row["value"] += amt
        elif m["type"] == "return" and m.get("lot_id") == lot_id:
            row["returned"] += q; row["value"] -= amt
        elif m["type"] == "wastage" and m.get("lot_id") == lot_id:
            row["wasted"] += q; row["wasted_value"] += amt
        elif m["type"] == "transfer":
            if m.get("lot_id") == lot_id:
                row["moved_out"] += q; row["value"] -= amt
            if m.get("to_lot_id") == lot_id:
                row["moved_in"] += q; row["value"] += amt
    materials = []
    for r in mats.values():
        r = {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()}
        r["value"] = round(r["value"], 2)
        r["wasted_value"] = round(r["wasted_value"], 2)
        r["on_lot"] = round(r["issued"] - r["returned"] - r["wasted"] + r["moved_in"] - r["moved_out"], 3)
        materials.append(r)
    materials.sort(key=lambda r: r["item"])
    material_total = round(sum(r["value"] for r in materials), 2)

    # ---- bills charged directly to the lot
    direct = {}
    async for e in db.expenses.find({"lot_id": lot_id, "status": "approved"}):
        direct[e["category_name"]] = direct.get(e["category_name"], 0.0) + e["total"]
    direct_rows = [{"category": k, "total": round(v, 2)} for k, v in sorted(direct.items())]
    direct_total = round(sum(direct.values()), 2)

    overhead_total, overhead_detail = await allocate_overhead(lot_id)
    labour_total = round(labour_total, 2)
    total = round(labour_total + material_total + direct_total + overhead_total, 2)

    def per(n):
        return round(total / n, 2) if n else None
    result = {
        "lot_id": lot_id, "lot_number": lot["lot_number"], "style_name": lot["style_name"], "status": lot["status"],
        "quantities": {"order": order_total, "planned": planned_total, "produced": produced},
        "labour": {"rows": labour, "total": labour_total, "non_plan_qty": non_plan_qty, "non_plan_cost": round(non_plan_cost, 2)},
        "labour_variance": variance,
        "materials": {"rows": materials, "total": material_total, "wasted_value": round(sum(r["wasted_value"] for r in materials), 2)},
        "direct_expenses": {"rows": direct_rows, "total": direct_total},
        "overhead": {"total": overhead_total, "detail": overhead_detail, "rule": "Shared by pieces handled in the month the bill was raised"},
        "total_cost": total,
        "cost_per_piece": {"produced": per(produced), "planned": per(planned_total), "ordered": per(order_total)},
        "breakdown": sorted([{"component": "Labour", "amount": labour_total}, {"component": "Materials", "amount": material_total},
                             {"component": "Direct bills", "amount": direct_total}, {"component": "Overhead share", "amount": overhead_total}],
                            key=lambda r: -r["amount"]),
        "generated_at": _now(),
    }
    if lot.get("order_rate"):
        revenue = round(lot["order_rate"] * produced, 2)
        result["margin"] = {"order_rate": lot["order_rate"], "revenue": revenue, "profit": round(revenue - total, 2),
                            "profit_pct": round((revenue - total) / revenue * 100, 1) if revenue else None}
    return result


@router.get("/reports/lot-costing/{lot_id}")
async def costing_report(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if user["role"] != "admin" and not user.get("can_view_financial"):
        raise HTTPException(403, "Your account does not have permission to view financial data")
    return await compute_costing(lot_id)


# ------------------------------------------------------------------ closing report
async def close_check(lot_id: str, ignore_stock=False):
    lot = await _lot(lot_id)
    blocks, warnings = [], []
    label = re.escape(lot["lot_number"])
    async for a in db.approvals.find({"status": "pending", "$or": [{"entity_id": lot_id}, {"entity_label": {"$regex": f"^{label}( |$)"}}]}):
        blocks.append(f"A request is still waiting for approval: {a.get('entity_label', '')} ({a['type'].replace('_', ' ')})")
    if not ignore_stock:
        bal = await all_balances()
        for iid, tot in bal.items():
            q = tot["lots"].get(lot_id)
            if q and (abs(q[0]) > EPS or abs(q[1]) > EPS):
                item = await db.stock_items.find_one({"_id": ObjectId(iid)})
                blocks.append(f"{item['name'] if item else iid}: {q[0]:g} {item['uom'] if item else ''} is still on this lot. "
                              "Return it to the store, move it to another lot, or write it off as wastage.")
    per, _ = await produced_matrix(lot_id)
    short = []
    for c in lot.get("colors", []):
        for s in c.get("sizes", []):
            done = finished_for(per, lot, c["name"], s["size"])
            if done < s["planned_qty"]:
                short.append((c["name"], s["size"], s["planned_qty"] - done))
    if short:
        warnings.append(f"Short of plan by {sum(x[2] for x in short)} pieces ("
                        + ", ".join(f"{c} {sz}: {n}" for c, sz, n in short[:6]) + (", …" if len(short) > 6 else "") + ")")
    unpaid = 0.0
    async for e in db.expenses.find({"lot_id": lot_id, "status": "approved", "payment_status": {"$ne": "paid"}}):
        unpaid += max(0, e["total"] - e.get("paid_amount", 0))
    if unpaid > 0:
        warnings.append(f"Bills charged to this lot are still unpaid ({unpaid:,.2f})")
    open_pos = [p["po_number"] async for p in db.purchase_orders.find(
        {"lot_id": lot_id, "status": {"$in": ["draft", "approved", "sent", "partially_received"]}})]
    if open_pos:
        warnings.append(f"Purchase orders are still open: {', '.join(open_pos)}")
    return {"lot_number": lot["lot_number"], "blocks": blocks, "warnings": warnings}


@router.get("/lots/{lot_id}/close-check")
async def close_check_route(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    return await close_check(lot_id)


async def build_closure(lot_id: str, user: dict, reason: str, warnings: list):
    lot = await _lot(lot_id)
    lot_s = await _enrich(serialize_doc(dict(lot)))
    per, op_totals = await produced_matrix(lot_id)
    by_cell, shortages, excess = [], [], []
    for c in lot.get("colors", []):
        for s in c.get("sizes", []):
            done = finished_for(per, lot, c["name"], s["size"])
            by_cell.append({"color": c["name"], "size": s["size"], "order": s.get("order_qty", s["planned_qty"]),
                            "planned": s["planned_qty"], "produced": done, "balance": s["planned_qty"] - done})
            if done < s["planned_qty"]:
                shortages.append({"color": c["name"], "size": s["size"], "short": s["planned_qty"] - done})
            elif done > s["planned_qty"]:
                excess.append({"color": c["name"], "size": s["size"], "excess": done - s["planned_qty"]})
    costing = await compute_costing(lot_id)
    version = await db.lot_closures.count_documents({"lot_id": lot_id}) + 1
    pending = [serialize_doc(a) async for a in db.approvals.find({"status": "pending", "entity_id": lot_id})]
    return {
        "lot_id": lot_id, "lot_number": lot["lot_number"], "style_name": lot["style_name"], "fy": lot_fy(lot), "version": version,
        "closed_at": _now(), "closed_by": user["id"], "closed_by_name": user.get("name", ""), "reason": reason,
        "acknowledged_warnings": warnings,
        "quantities": {"order": lot_s.get("total_order_qty"), "allowance_pct": lot.get("allowance_pct", 0),
                       "planned": lot_s["total_planned_qty"], "produced": lot_s["total_produced_qty"],
                       "balance": lot_s["balance_qty"], "progress": lot_s["progress"],
                       "by_color_size": by_cell, "by_operation": lot_s["operation_progress"]},
        "shortages": shortages, "excess": excess,
        "non_plan": {"pieces": costing["labour"]["non_plan_qty"], "cost": costing["labour"]["non_plan_cost"]},
        "materials": costing["materials"]["rows"], "costing": costing,
        "open_items": {"pending_approvals": [p.get("entity_label", "") for p in pending]},
    }


async def close_lot_with_report(request: Request, user: dict, lot_id: str, reason: str, ignore_stock=False):
    lot = await _lot(lot_id)
    if lot.get("status") == "completed":
        raise HTTPException(400, "This lot is already closed")
    chk = await close_check(lot_id, ignore_stock=ignore_stock)
    if chk["blocks"]:
        raise HTTPException(400, detail={"code": "close_blocked", "blocks": chk["blocks"], "warnings": chk["warnings"],
                                         "message": "This lot cannot be closed yet: " + " ".join(chk["blocks"])})
    reason = (reason or "").strip()
    if chk["warnings"] and not reason:
        raise HTTPException(409, detail={"code": "needs_reason", "warnings": chk["warnings"],
                                         "message": "Closing with open items needs a reason: " + "; ".join(chk["warnings"])})
    closure = await build_closure(lot_id, user, reason or "Completed", chk["warnings"])
    res = await db.lot_closures.insert_one(closure)
    await db.lots.update_one({"_id": lot["_id"]}, {"$set": {
        "status": "completed", "closed_by": user["id"], "closed_by_name": user.get("name", ""),
        "closed_at": closure["closed_at"], "close_reason": reason or "Completed", "closure_id": str(res.inserted_id)}})
    await db.notifications.insert_one({"type": "lot_closed", "message": f"Lot {lot['lot_number']} closed by {user.get('name', '')}",
                                       "lot_id": lot_id, "created_at": _now(), "read": False})
    closure["id"] = str(res.inserted_id)
    closure.pop("_id", None)
    return closure


@router.get("/lots/{lot_id}/closure")
async def get_closure(lot_id: str, request: Request, version: Optional[int] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    q = {"lot_id": lot_id}
    if version:
        q["version"] = version
    doc = await db.lot_closures.find_one(q, sort=[("version", -1)])
    if not doc:
        raise HTTPException(404, "This lot has not been closed")
    d = serialize_doc(doc)
    d["versions"] = [x["version"] async for x in db.lot_closures.find({"lot_id": lot_id}, {"version": 1}).sort("version", 1)]
    return d


# ------------------------------------------------------------------ exports (PDF / Excel)
def _xlsx(sheets):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    first = True
    for title, headers, rows in sheets:
        ws = wb.active if first else wb.create_sheet()
        first = False
        ws.title = re.sub(r"[:\\/?*\[\]]", "-", title)[:31]
        if headers:
            ws.append(headers)
            for i in range(1, len(headers) + 1):
                ws.cell(row=1, column=i).font = Font(bold=True, color="FFFFFF")
                ws.cell(row=1, column=i).fill = PatternFill(start_color="294F96", end_color="294F96", fill_type="solid")
        for r in rows:
            ws.append(["'" + c if isinstance(c, str) and c[:1] in "=+-@" else c for c in r])
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def costing_sheets(c):
    q = c["quantities"]
    summary = [["Lot", c["lot_number"]], ["Style", c["style_name"]], ["Ordered", q["order"]], ["Planned", q["planned"]], ["Produced", q["produced"]],
               [], ["Labour", c["labour"]["total"]], ["Materials", c["materials"]["total"]], ["Direct bills", c["direct_expenses"]["total"]],
               ["Overhead share", c["overhead"]["total"]], ["TOTAL COST", c["total_cost"]],
               ["Cost per produced piece", c["cost_per_piece"]["produced"]], ["Cost per planned piece", c["cost_per_piece"]["planned"]]]
    if c.get("margin"):
        summary += [[], ["Revenue", c["margin"]["revenue"]], ["Profit", c["margin"]["profit"]], ["Profit %", c["margin"]["profit_pct"]]]
    return [("Summary", ["Item", "Value"], summary),
            ("Labour", ["Group", "Operation", "Rate type", "Pieces", "Cost"], [[r["group"], r["operation"], r["rate_type"], r["qty"], r["cost"]] for r in c["labour"]["rows"]]),
            ("Planned vs actual", ["Operation", "Planned", "Actual (regular)", "Variance", "Variance %"],
             [[v["operation"], v["planned_cost"], v["actual_cost"], v["variance"], v["variance_pct"]] for v in c["labour_variance"]]),
            ("Materials", ["Item", "Unit", "Issued", "Returned", "Wasted", "Moved in", "Moved out", "Value"],
             [[m["item"], m["uom"], m["issued"], m["returned"], m["wasted"], m["moved_in"], m["moved_out"], m["value"]] for m in c["materials"]["rows"]]),
            ("Bills", ["Category", "Total"], [[r["category"], r["total"]] for r in c["direct_expenses"]["rows"]])]


def _pdf(title, subtitle, blocks):
    """blocks: [("heading", text) | ("table", headers, rows) | ("text", text)]"""
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib import colors as rl
    from reportlab.lib.styles import getSampleStyleSheet
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, title=title)
    st = getSampleStyleSheet()
    el = [Paragraph(f"<b>{COMPANY['name']}</b>", st["Title"]), Paragraph(COMPANY["address"], st["Normal"]), Spacer(1, 10),
          Paragraph(title, st["Heading2"]), Paragraph(subtitle, st["Normal"]), Spacer(1, 8)]
    for b in blocks:
        if b[0] == "heading":
            el += [Spacer(1, 8), Paragraph(f"<b>{b[1]}</b>", st["Heading3"])]
        elif b[0] == "text":
            el.append(Paragraph(b[1].replace("&", "&amp;").replace("<", "&lt;"), st["Normal"]))
        elif b[0] == "table" and b[2]:
            data = [b[1]] + [[("" if v is None else (f"{v:,.2f}" if isinstance(v, float) else str(v))) for v in r] for r in b[2]]
            t = Table(data, repeatRows=1)
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), rl.HexColor("#294f96")), ("TEXTCOLOR", (0, 0), (-1, 0), rl.white),
                                   ("GRID", (0, 0), (-1, -1), 0.4, rl.grey), ("FONTSIZE", (0, 0), (-1, -1), 8),
                                   ("ALIGN", (1, 1), (-1, -1), "RIGHT")]))
            el.append(t)
    el += [Spacer(1, 36), Paragraph("Production Manager: ____________    Accounts: ____________    Owner: ____________", st["Normal"])]
    doc.build(el)
    out.seek(0)
    return out


def costing_blocks(c):
    q = c["quantities"]
    return [("text", f"Ordered {q['order']} · Planned {q['planned']} · Produced {q['produced']}"),
            ("heading", "Cost summary"),
            ("table", ["Component", "Amount"], [[b["component"], b["amount"]] for b in c["breakdown"]] + [["TOTAL", c["total_cost"]],
                                                                                                        ["Per produced piece", c["cost_per_piece"]["produced"]]]),
            ("heading", "Labour"), ("table", ["Group", "Operation", "Rate type", "Pieces", "Cost"], [[r["group"], r["operation"], r["rate_type"], r["qty"], r["cost"]] for r in c["labour"]["rows"]]),
            ("heading", "Planned vs actual labour"), ("table", ["Operation", "Planned", "Actual", "Variance"], [[v["operation"], v["planned_cost"], v["actual_cost"], v["variance"]] for v in c["labour_variance"]]),
            ("heading", "Materials"), ("table", ["Item", "Unit", "Issued", "Returned", "Wasted", "Value"], [[m["item"], m["uom"], m["issued"], m["returned"], m["wasted"], m["value"]] for m in c["materials"]["rows"]]),
            ("heading", "Bills charged to the lot"), ("table", ["Category", "Total"], [[r["category"], r["total"]] for r in c["direct_expenses"]["rows"]])]


@router.get("/reports/lot-costing/{lot_id}/{fmt}")
async def costing_export(lot_id: str, fmt: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if fmt not in ("pdf", "excel"):
        raise HTTPException(404, "Format must be pdf or excel")
    c = await compute_costing(lot_id)
    name = f"costing_{c['lot_number'].replace('/', '-')}"
    if fmt == "pdf":
        return StreamingResponse(_pdf(f"Lot costing report: {c['lot_number']} · {c['style_name']}", f"Generated {c['generated_at'][:10]}", costing_blocks(c)),
                                 media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={name}.pdf"})
    return StreamingResponse(_xlsx(costing_sheets(c)), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={name}.xlsx"})


@router.get("/lots/{lot_id}/closure/{fmt}")
async def closure_export(lot_id: str, fmt: str, request: Request, version: Optional[int] = None):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    if fmt not in ("pdf", "excel"):
        raise HTTPException(404, "Format must be pdf or excel")
    q = {"lot_id": lot_id}
    if version:
        q["version"] = version
    cl = await db.lot_closures.find_one(q, sort=[("version", -1)])
    if not cl:
        raise HTTPException(404, "This lot has not been closed")
    qn = cl["quantities"]
    name = f"closing_{cl['lot_number'].replace('/', '-')}_v{cl['version']}"
    cells = [[x["color"], x["size"], x["order"], x["planned"], x["produced"], x["balance"]] for x in qn["by_color_size"]]
    if fmt == "pdf":
        blocks = [("text", f"Closed {cl['closed_at'][:10]} by {cl['closed_by_name']} · version {cl['version']} · reason: {cl['reason']}"),
                  ("text", f"Ordered {qn['order']} · Allowance {qn['allowance_pct']}% · Planned {qn['planned']} · Produced {qn['produced']} · Balance {qn['balance']}"),
                  ("heading", "Quantities by colour and size"), ("table", ["Colour", "Size", "Ordered", "Planned", "Produced", "Balance"], cells)]
        if cl["acknowledged_warnings"]:
            blocks += [("heading", "Open items acknowledged at closing")] + [("text", f"• {w}") for w in cl["acknowledged_warnings"]]
        blocks += [("heading", "Cost at closing")] + costing_blocks(cl["costing"])[2:]
        return StreamingResponse(_pdf(f"Lot closing report: {cl['lot_number']} · {cl['style_name']}", f"Financial year {cl['fy']}", blocks),
                                 media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename={name}.pdf"})
    sheets = [("Quantities", ["Colour", "Size", "Ordered", "Planned", "Produced", "Balance"], cells),
              ("By operation", ["Operation", "Produced", "Balance", "Cost"], [[o["operation_name"], o["produced_qty"], o["balance_qty"], o.get("cost")] for o in qn["by_operation"]]),
              ("Open items", ["Item"], [[w] for w in cl["acknowledged_warnings"]])] + costing_sheets(cl["costing"])
    return StreamingResponse(_xlsx(sheets), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                             headers={"Content-Disposition": f"attachment; filename={name}.xlsx"})


# ------------------------------------------------------------------ financial-year rollover
class YearEndAction(BaseModel):
    lot_id: str
    action: str                                  # close | carry | skip
    reason: str = Field(default="", max_length=300)


class YearEndIn(BaseModel):
    actions: list[YearEndAction] = Field(min_length=1, max_length=200)


async def open_previous_year_lots():
    current = get_fy_suffix()
    rows = []
    async for lot in db.lots.find({"status": "active"}).sort("lot_number", 1):
        if lot_fy(lot) == current:
            continue
        s = await _enrich(serialize_doc(dict(lot)))
        carried = await db.lots.find_one({"carried_from_lot_id": str(lot["_id"])})
        days = None
        try:
            days = (datetime.now(timezone.utc).date() - datetime.strptime(lot["start_date"], "%Y-%m-%d").date()).days
        except (KeyError, ValueError):
            pass
        rows.append({"id": s["id"], "lot_number": s["lot_number"], "style_name": s["style_name"], "fy": lot_fy(lot),
                     "planned": s["total_planned_qty"], "produced": s["total_produced_qty"], "balance": s["balance_qty"],
                     "progress": s["progress"], "age_days": days, "already_carried_to": carried["lot_number"] if carried else None})
    return {"current_fy": current, "lots": rows}


@router.get("/year-end")
async def year_end_overview(request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    return await open_previous_year_lots()


async def carry_forward(request: Request, user: dict, lot_id: str):
    """Close this lot and open a new one in the current FY holding what is left."""
    old = await _lot(lot_id)
    existing = await db.lots.find_one({"carried_from_lot_id": lot_id})
    if existing:                                  # idempotent: never create a second carry-forward
        return {"status": "already_carried", "new_lot": existing["lot_number"], "new_lot_id": str(existing["_id"])}
    # refuse BEFORE creating anything if the close would be blocked by something stock cannot fix
    chk = await close_check(lot_id, ignore_stock=True)
    if chk["blocks"]:
        raise HTTPException(400, "Cannot carry forward: " + " ".join(chk["blocks"]))
    per, _ = await produced_matrix(lot_id)
    colors, planned_left = [], 0
    for c in old.get("colors", []):
        sizes = []
        for s in c["sizes"]:
            left = max(0, s["planned_qty"] - finished_for(per, old, c["name"], s["size"]))
            planned_left += left
            sizes.append({"size": s["size"], "order_qty": left, "planned_qty": left})
        colors.append({"color_id": c.get("color_id"), "name": c["name"], "sizes": sizes})
    if planned_left == 0:
        raise HTTPException(400, "Nothing is left to carry forward: close this lot instead.")
    ratio = planned_left / max(1, lot_planned_total(old))
    new_reqs = []
    for r in old.get("requirements", []):
        r2 = dict(r)
        if r2.get("basis") == "total":
            r2["total_qty"] = round(r2["total_qty"] * ratio, 3)
        new_reqs.append(r2)
    number = await get_next_lot_number()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    qc = dict(old.get("quantity_control") or {})
    qc["locked"] = {}
    doc = {"lot_number": number, "style_name": old["style_name"], "start_date": today,
           "target_end_date": max(old.get("target_end_date", today), (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")),
           "status": "active", "size_chart_id": old.get("size_chart_id"), "size_chart_name": old.get("size_chart_name"),
           "sizes": old.get("sizes", []), "allowance_pct": 0, "quantity_control": qc, "post_pct": old.get("post_pct", 0),
           "colors": colors, "operations": old.get("operations", []), "requirements": new_reqs,
           "order_rate": old.get("order_rate"), "fy": get_fy_suffix(),
           "carried_from_lot_id": lot_id, "carried_from_lot_number": old["lot_number"], "created_at": _now()}
    new_id = str((await db.lots.insert_one(doc)).inserted_id)
    moved = []
    bal = await all_balances()
    for iid, tot in bal.items():                  # material on the old lot goes with the work
        q = tot["lots"].get(lot_id)
        if q and (q[0] > EPS or q[1] > EPS):
            mv = MovementIn(type="transfer", item_id=iid, qty=q[0], qty2=q[1] or None, lot_id=lot_id, to_lot_id=new_id,
                            reason=f"Financial-year carry-forward to {number}", date=today)
            try:
                d, _ = await post_movement(mv, user)
                moved.append(d["item_name"])
            except HTTPException:
                pass
    await close_lot_with_report(request, user, lot_id, f"Carried forward to {number}")
    await db.lots.update_one({"_id": ObjectId(lot_id)}, {"$set": {"carried_to_lot_id": new_id, "carried_to_lot_number": number}})
    pol = await approvals.policies()
    if pol.get("fy_carry_forward"):
        await approvals.record_auto(request, user, "fy_carry_forward", "lot", lot_id, old["lot_number"],
                                    f"{old['lot_number']} carried forward to {number} ({planned_left} pieces)")
    return {"status": "carried", "new_lot": number, "new_lot_id": new_id, "pieces": planned_left, "materials_moved": moved}


@router.post("/year-end")
async def year_end_apply(data: YearEndIn, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin"])
    results = []
    for a in data.actions:
        try:
            lot = await _lot(a.lot_id)
            if a.action == "skip":
                results.append({"lot_id": a.lot_id, "lot_number": lot["lot_number"], "status": "skipped"})
            elif a.action == "close":
                if lot.get("status") == "completed":
                    results.append({"lot_id": a.lot_id, "lot_number": lot["lot_number"], "status": "already_closed"})
                else:
                    await close_lot_with_report(request, user, a.lot_id, a.reason or "Financial year end")
                    results.append({"lot_id": a.lot_id, "lot_number": lot["lot_number"], "status": "closed"})
            elif a.action == "carry":
                r = await carry_forward(request, user, a.lot_id)
                results.append({"lot_id": a.lot_id, "lot_number": lot["lot_number"], **r})
            else:
                results.append({"lot_id": a.lot_id, "lot_number": lot["lot_number"], "status": "error", "error": "Unknown action"})
        except HTTPException as exc:
            d = exc.detail
            results.append({"lot_id": a.lot_id, "status": "error", "error": d.get("message") if isinstance(d, dict) else d})
    done = [r for r in results if r["status"] in ("closed", "carried")]
    note(request, entity_type="lot", entity_id="year-end", label="Financial year end",
         summary=f"Year-end: {len(done)} of {len(results)} lots processed", after={"results": [{k: v for k, v in r.items() if k != 'lot_id'} for r in results]})
    return {"results": results, "processed": len(done)}
