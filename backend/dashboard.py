"""Dashboard data: one payload per role, built with aggregations (never by loading
thousands of documents and looping in Python).

admin    everything, including a "needs attention" list and recent activity
accounts money-centred subset
data_entry output only, never a rate, wage or cost
"""
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Query, Request

from core import db, datetime, timezone, get_current_user, get_fy_suffix, serialize_doc
import lifecycle
from stock import all_balances, EPS

router = APIRouter(prefix="/api")


def _today():
    return datetime.now(timezone(timedelta(hours=5, minutes=30))).date()


def fy_range(fy: str):
    """('2026-04-01', '2027-03-31') for '26-27'."""
    start = 2000 + int(fy.split("-")[0])
    return f"{start}-04-01", f"{start + 1}-03-31"


async def daily_series(start: str, end: str, field="total_quantity", group_by="operation_group", match=None):
    q = {"date": {"$gte": start, "$lte": end}, **(match or {})}
    rows = {}
    async for g in db.production_entries.aggregate([
            {"$match": q},
            {"$group": {"_id": {"d": "$date", "g": f"${group_by}"}, "v": {"$sum": f"${field}"}}}]):
        day = rows.setdefault(g["_id"]["d"], {})
        day[g["_id"]["g"] or "Ungrouped"] = day.get(g["_id"]["g"] or "Ungrouped", 0) + g["v"]
    return rows


@router.get("/dashboard/overview")
async def overview(request: Request, fy: Optional[str] = Query(None, pattern=r"^\d{2}-\d{2}$")):
    user = await get_current_user(request)
    role = user["role"]
    today = _today()
    t = today.isoformat()
    current_fy = get_fy_suffix()
    fy = fy or current_fy
    fy_start, fy_end = fy_range(fy)
    week_start = (today - timedelta(days=6)).isoformat()
    prev_start = (today - timedelta(days=13)).isoformat()
    prev_end = (today - timedelta(days=7)).isoformat()
    since30 = (today - timedelta(days=29)).isoformat()
    money_ok = role in ("admin", "accounts") and (role == "admin" or user.get("can_view_financial"))

    out = {"role": role, "fy": fy, "current_fy": current_fy, "today": t, "generated_at": datetime.now(timezone.utc).isoformat()}

    # ---------------- lots (admin / accounts see all, data entry only what is open for entry)
    lots_q = {"status": "active"}
    pipeline = []
    lots = await db.lots.find(lots_q).sort("lot_number", -1).to_list(200)
    # pace: pieces the slowest operation handled in the last 7 days, per lot, in one aggregation
    pace = {}
    async for g in db.production_entries.aggregate([
            {"$match": {"date": {"$gte": week_start, "$lte": t}, "counts_toward_plan": {"$ne": False}}},
            {"$group": {"_id": {"l": "$lot_id", "o": "$operation_id"}, "q": {"$sum": "$total_quantity"}}}]):
        pace.setdefault(g["_id"]["l"], {})[g["_id"]["o"]] = g["q"]
    overdue_lots = at_risk = 0
    for lot in lots:
        s = await lifecycle._enrich(serialize_doc(dict(lot)))
        ops = [o["operation_id"] for o in lot.get("operations", [])]
        week_pace = min((pace.get(s["id"], {}).get(o, 0) for o in ops), default=0) / 7.0
        due = lot.get("target_end_date", "")
        overdue = bool(due) and due < t and s["balance_qty"] > 0
        proj = None
        risk = False
        if s["balance_qty"] > 0 and week_pace > 0:
            days_left = s["balance_qty"] / week_pace
            proj = (today + timedelta(days=int(days_left) + 1)).isoformat()
            risk = bool(due) and proj > due and not overdue
        elif s["balance_qty"] > 0 and not overdue and due:
            try:
                risk = (datetime.strptime(due, "%Y-%m-%d").date() - today).days <= 7 and s["progress"] < 50
            except ValueError:
                pass
        overdue_lots += overdue
        at_risk += risk
        slowest = min(s["operation_progress"], key=lambda o: o["produced_qty"], default=None)
        row = {"id": s["id"], "lot_number": s["lot_number"], "style_name": s["style_name"], "planned": s["total_planned_qty"],
               "produced": s["total_produced_qty"], "balance": s["balance_qty"], "progress": s["progress"], "due": due,
               "overdue": overdue, "at_risk": risk, "projected_finish": proj, "slowest": slowest["operation_name"] if slowest else "",
               "fy": lifecycle.lot_fy(lot)}
        if money_ok:
            row["labour_cost"] = s["total_labour_cost"]
        pipeline.append(row)
    out["lots"] = pipeline[:30]
    out["active_lots"] = len(lots)

    # ---------------- this week vs last week
    async def window(a, b, match=None):
        agg = await db.production_entries.aggregate([
            {"$match": {"date": {"$gte": a, "$lte": b}, **(match or {})}},
            {"$group": {"_id": None, "q": {"$sum": "$total_quantity"}, "e": {"$sum": "$total_earnings"}}}]).to_list(1)
        return (agg[0]["q"], agg[0]["e"]) if agg else (0, 0.0)

    mine = {"entered_by": user["id"]} if role == "data_entry" else None
    wq, we = await window(week_start, t, mine)
    pq, pe = await window(prev_start, prev_end, mine)
    out["week"] = {"pieces": wq, "pieces_prev": pq}
    series = await daily_series(since30, t, match=mine)
    days = [(today - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    groups = sorted({g for d in series.values() for g in d})
    out["trend"] = {"days": days, "groups": groups, "rows": [{"date": d, **{g: series.get(d, {}).get(g, 0) for g in groups}} for d in days]}
    out["spark_pieces"] = [{"d": d, "v": sum(series.get(d, {}).values())} for d in days[-14:]]

    # ---------------- today, against a usual day. There is no target setting, so the benchmark is the average of the
    # last 7 days that had any output (never a made-up figure).
    if role != "data_entry":
        busy = [sum(series.get(d, {}).values()) for d in days[-8:-1]]
        busy = [v for v in busy if v > 0]
        out["today_summary"] = {"pieces": sum(series.get(t, {}).values()), "usual_day": round(sum(busy) / len(busy)) if busy else 0,
                                "entries": await db.production_entries.count_documents({"date": t}),
                                "lots": len(await db.production_entries.distinct("lot_id", {"date": t}))}

    # ---------------- by group (never for a data-entry user's money, but output counts are fine)
    async def by_group(field):
        rows = []
        async for g in db.production_entries.aggregate([{"$match": {"date": {"$gte": week_start, "$lte": t}}},
                                                        {"$group": {"_id": f"${field}", "q": {"$sum": "$total_quantity"}, "e": {"$sum": "$total_earnings"}}},
                                                        {"$sort": {"q": -1}}]):
            r = {"name": g["_id"] or "Ungrouped", "pieces": g["q"]}
            if money_ok:
                r["wages"] = round(g["e"], 2)
            rows.append(r)
        return rows
    if role != "data_entry":
        out["operation_groups"] = await by_group("operation_group")
        out["operator_groups"] = await by_group("operator_group")

    if role == "data_entry":
        out["my_week_entries"] = await db.production_entries.count_documents({"entered_by": user["id"], "date": {"$gte": week_start, "$lte": t}})
        out["needs_output"] = [{"id": p["id"], "lot_number": p["lot_number"], "style_name": p["style_name"], "balance": p["balance"], "due": p["due"]}
                               for p in pipeline if p["balance"] > 0][:8]
        out["setup"] = None
        return out

    # ---------------- money
    if money_ok:
        out["week"].update({"wages": round(we, 2), "wages_prev": round(pe, 2)})
        advances = 0.0
        async for a in db.advances.find({"status": {"$in": ["pending", "partially_adjusted"]}}, {"balance": 1}):
            advances += a.get("balance", 0)
        out["advances_outstanding"] = round(advances, 2)
        month = t[:7]
        spent = {}
        unpaid_old = 0
        cutoff = (today - timedelta(days=30)).isoformat()
        async for e in db.expenses.find({"status": "approved"}, {"date": 1, "bill_date": 1, "category_name": 1, "total": 1, "paid_amount": 1}):
            if e["date"][:7] == month:
                spent[e["category_name"]] = spent.get(e["category_name"], 0) + e["total"]
            if e["total"] - e.get("paid_amount", 0) > 0.005 and (e.get("bill_date") or e["date"]) < cutoff:
                unpaid_old += 1
        out["expenses"] = {"month": month, "total": round(sum(spent.values()), 2),
                           "by_category": [{"category": k, "total": round(v, 2)} for k, v in sorted(spent.items(), key=lambda kv: -kv[1])]}
        # wages vs advances taken vs bills, month to date
        month_wages = 0.0
        async for g in db.production_entries.aggregate([{"$match": {"date": {"$regex": f"^{month}"}}}, {"$group": {"_id": None, "e": {"$sum": "$total_earnings"}}}]):
            month_wages = g["e"]
        out["money_month"] = {"wages": round(month_wages, 2), "expenses": out["expenses"]["total"], "advances_outstanding": out["advances_outstanding"]}
        wage_rows = await daily_series(days[-14], t, field="total_earnings", match=mine)
        out["spark_wages"] = [{"d": d, "v": round(sum(wage_rows.get(d, {}).values()), 2)} for d in days[-14:]]
    else:
        unpaid_old = 0

    # ---------------- stock
    items = await db.stock_items.find({"active": True}).to_list(2000)
    stock = {"low": [], "count": len(items)}
    if items:
        bal = await all_balances([str(i["_id"]) for i in items])
        for i in items:
            b = bal.get(str(i["_id"]), {"store": [0, 0]})["store"][0]
            if i.get("reorder_level", 0) > 0:
                cover = b / i["reorder_level"]
                if cover <= 1 + EPS:
                    stock["low"].append({"name": i["name"], "balance": b, "uom": i["uom"], "reorder_level": i["reorder_level"], "cover": round(cover, 2)})
        stock["low"].sort(key=lambda r: r["cover"])
        stock["low"] = stock["low"][:8]
    out["stock"] = stock

    out["purchase_orders"] = {"drafts": await db.purchase_orders.count_documents({"status": "draft"}),
                              "open": await db.purchase_orders.count_documents({"status": {"$in": ["approved", "sent", "partially_received"]}})}

    if role == "admin":
        pending = await db.approvals.count_documents({"status": "pending"})
        carried = await lifecycle.open_previous_year_lots()
        old_open = len([l for l in carried["lots"] if not l["already_carried_to"]])
        new_enq = await db.enquiries.count_documents({"status": "new"})
        attention = []
        if pending:
            attention.append({"key": "approvals", "label": "Approvals waiting", "count": pending, "to": "/approvals", "tone": "amber"})
        if overdue_lots:
            attention.append({"key": "overdue", "label": "Lots past their target date", "count": overdue_lots, "to": "/lots", "tone": "rose"})
        if at_risk:
            attention.append({"key": "at_risk", "label": "Lots likely to finish late", "count": at_risk, "to": "/lots", "tone": "amber"})
        if old_open:
            attention.append({"key": "year_end", "label": "Lots still open from an earlier year", "count": old_open, "to": "/year-end", "tone": "rose"})
        if stock["low"]:
            attention.append({"key": "stock", "label": "Items at or below reorder level", "count": len(stock["low"]), "to": "/stock", "tone": "amber"})
        if unpaid_old:
            attention.append({"key": "bills", "label": "Bills unpaid for over 30 days", "count": unpaid_old, "to": "/expenses", "tone": "amber"})
        if out["purchase_orders"]["drafts"]:
            attention.append({"key": "po", "label": "Purchase orders waiting to be released", "count": out["purchase_orders"]["drafts"], "to": "/purchase-orders", "tone": "slate"})
        if new_enq:
            attention.append({"key": "enquiries", "label": "New website enquiries", "count": new_enq, "to": "/enquiries", "tone": "slate"})
        out["attention"] = attention
        out["recent_activity"] = [{"at": a["at"], "user": a.get("user_name", ""), "action": a["action"], "summary": a.get("summary", ""), "outcome": a.get("outcome", "ok")}
                                  async for a in db.audit_logs.find({}).sort("at", -1).limit(10)]
        # first-run checklist
        counts = {"operators": await db.operators.count_documents({}), "operations": await db.operations.count_documents({}),
                  "colors": await db.colors_master.count_documents({}), "size_charts": await db.size_charts.count_documents({}),
                  "weeks": await db.weeks.count_documents({}), "lots": await db.lots.count_documents({})}
        out["setup"] = {"counts": counts, "done": all(counts.values())}
        out["operators_active"] = await db.operators.count_documents({"active": True})
    # selected financial year: lots that started in it, and what they produced
    fy_lots = await db.lots.count_documents({"start_date": {"$gte": fy_start, "$lte": fy_end}})
    fy_agg = await db.production_entries.aggregate([{"$match": {"date": {"$gte": fy_start, "$lte": fy_end}, "counts_toward_plan": {"$ne": False}}},
                                                    {"$group": {"_id": None, "q": {"$sum": "$total_quantity"}}}]).to_list(1)
    out["fy_summary"] = {"fy": fy, "lots_started": fy_lots, "pieces_handled": fy_agg[0]["q"] if fy_agg else 0, "from": fy_start, "to": fy_end}
    return out
