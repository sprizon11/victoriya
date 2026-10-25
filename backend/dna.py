"""Lot DNA: one lot's whole life on a page, plus a printable sheet and carton tag with a QR code.

The DNA code is derived from the lot id with the server's secret (HMAC), so it cannot be
guessed or forged from outside, and the QR on a carton only opens the lot for a logged-in user.
"""
import base64
import hashlib
import hmac
import json
import io
import re
from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from core import db, ObjectId, datetime, timezone, get_current_user, check_role, serialize_doc, JWT_SECRET, COMPANY
import lifecycle

router = APIRouter(prefix="/api")


def dna_code(lot_id: str) -> str:
    raw = hmac.new(JWT_SECRET.encode(), f"lot-dna:{lot_id}".encode(), hashlib.sha256).digest()
    s = base64.b32encode(raw).decode().rstrip("=")[:12]
    return f"VG-{s[:4]}-{s[4:8]}-{s[8:12]}"


def integrity(closure: Optional[dict]) -> Optional[str]:
    """Short fingerprint of the frozen closing report: if the numbers in it were ever
    altered, the fingerprint would no longer match what was printed on the sheet."""
    if not closure:
        return None
    body = {k: closure[k] for k in ("lot_number", "version", "closed_at", "quantities", "costing") if k in closure}
    return hashlib.sha256(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:16].upper()


async def build_dna(lot_id: str, user: dict):
    lot = await lifecycle._lot(lot_id)
    s = await lifecycle._enrich(serialize_doc(dict(lot)))
    money = user["role"] in ("admin", "accounts") and (user["role"] == "admin" or user.get("can_view_financial"))
    label = re.escape(lot["lot_number"])
    events = []

    def ev(at, kind, title, detail="", by=""):
        events.append({"at": at, "kind": kind, "title": title, "detail": detail, "by": by})

    ev(lot.get("created_at", ""), "lot", f"Lot {lot['lot_number']} created", f"{s['style_name']} · {s['total_order_qty']} ordered, {s['total_planned_qty']} planned"
       + (f" (+{s['allowance_pct']}% allowance)" if s.get("allowance_pct") else ""))
    if lot.get("carried_from_lot_number"):
        ev(lot.get("created_at", ""), "lineage", f"Carried forward from {lot['carried_from_lot_number']}", "Continues the unfinished pieces of last year's lot")

    async for a in db.audit_logs.find({"entity_type": "lot", "entity_id": lot_id}).sort("at", 1):
        if a["action"] == "lots.create":
            continue
        ev(a["at"], "change", a.get("summary") or a["action"], "", a.get("user_name", ""))
    async for a in db.approvals.find({"$or": [{"entity_id": lot_id}, {"entity_label": {"$regex": f"^{label}( |$)"}}]}).sort("requested_at", 1):
        who = "auto-approved" if a.get("auto") else a["status"]
        ev(a.get("reviewed_at") or a["requested_at"], "approval", f"{a['type'].replace('_', ' ').capitalize()}: {who}",
           a.get("summary") or a.get("reason", ""), a.get("reviewed_by_name") or a.get("requested_by_name", ""))

    # production by day, operation and rate type (one line each, not one per entry)
    by_day = {}
    async for e in db.production_entries.find({"lot_id": lot_id}):
        k = (e["date"], e["operation_name"], e.get("rate_type_name") or "Regular")
        r = by_day.setdefault(k, {"qty": 0, "earn": 0.0, "people": set(), "by": set()})
        r["qty"] += e["total_quantity"]
        r["earn"] += e.get("total_earnings", 0)
        r["people"].add(e["operator_name"])
        r["by"].add(e.get("entered_by_name", ""))
    for (d, op, rt), r in sorted(by_day.items()):
        ev(f"{d}T12:00:00", "production", f"{op}{'' if rt == 'Regular' else f' ({rt})'}: {r['qty']} pcs",
           f"{len(r['people'])} operator{'s' if len(r['people']) != 1 else ''}" + (f" · {r['earn']:,.2f}" if money else ""), ", ".join(sorted(x for x in r["by"] if x)))

    async for m in db.stock_movements.find({"$or": [{"lot_id": lot_id}, {"to_lot_id": lot_id}]}).sort("created_at", 1):
        verb = {"issue": "Issued", "return": "Returned", "transfer": "Moved", "wastage": "Written off"}.get(m["type"], m["type"].capitalize())
        into = f" to {m['to_lot_number']}" if m["type"] == "transfer" and m.get("lot_id") == lot_id else (f" from {m['lot_number']}" if m["type"] == "transfer" else "")
        ev(m["created_at"], "material", f"{verb}{' (reversal)' if m.get('sign') == -1 else ''} {m['qty']:g} {m['uom']} {m['item_name']}{into}", m.get("reason", ""), m.get("created_by_name", ""))
    if money:
        async for e in db.expenses.find({"lot_id": lot_id, "status": {"$ne": "void"}}).sort("date", 1):
            ev(f"{e['date']}T12:00:00", "expense", f"Bill {e['voucher_no']}: {e['category_name']} {e['total']:,.2f}", e["vendor"], e.get("created_by_name", ""))
    async for p in db.purchase_orders.find({"lot_id": lot_id}).sort("created_at", 1):
        ev(p["created_at"], "purchase", f"Purchase order {p['po_number']} ({p['status'].replace('_', ' ')})", p.get("supplier_name") or "no supplier yet", p.get("created_by_name", ""))
    closures = [c async for c in db.lot_closures.find({"lot_id": lot_id}).sort("version", 1)]
    for c in closures:
        ev(c["closed_at"], "closure", f"Closed (report v{c['version']})", c["reason"], c["closed_by_name"])
    events.sort(key=lambda e: e["at"])

    # materials
    mats = []
    async for m in db.stock_movements.aggregate([{"$match": {"$or": [{"lot_id": lot_id}, {"to_lot_id": lot_id}]}},
                                                 {"$group": {"_id": {"i": "$item_name", "u": "$uom", "t": "$type"}, "q": {"$sum": {"$multiply": ["$qty", {"$ifNull": ["$sign", 1]}]}}}}]):
        mats.append(m)
    mat_rows = {}
    for m in mats:
        r = mat_rows.setdefault(m["_id"]["i"], {"item": m["_id"]["i"], "uom": m["_id"]["u"], "issued": 0, "returned": 0, "wasted": 0, "moved": 0})
        key = {"issue": "issued", "return": "returned", "wastage": "wasted", "transfer": "moved"}.get(m["_id"]["t"])
        if key:
            r[key] = round(r[key] + m["q"], 3)

    # people
    people = []
    async for g in db.production_entries.aggregate([{"$match": {"lot_id": lot_id}}, {"$group": {"_id": {"o": "$operator_name", "g": "$operator_group"}, "q": {"$sum": "$total_quantity"},
                                                                                              "e": {"$sum": "$total_earnings"}, "days": {"$addToSet": "$date"}}}, {"$sort": {"q": -1}}]):
        row = {"operator": g["_id"]["o"], "group": g["_id"]["g"] or "", "pieces": g["q"], "days": len(g["days"])}
        if money:
            row["earned"] = round(g["e"], 2)
        people.append(row)

    # lineage chain, both directions
    lineage, seen = [], {lot_id}
    cur = lot
    while cur.get("carried_from_lot_id") and cur["carried_from_lot_id"] not in seen:
        prev = await db.lots.find_one({"_id": ObjectId(cur["carried_from_lot_id"])})
        if not prev:
            break
        seen.add(str(prev["_id"]))
        lineage.insert(0, {"id": str(prev["_id"]), "lot_number": prev["lot_number"], "fy": lifecycle.lot_fy(prev), "relation": "earlier"})
        cur = prev
    cur = lot
    while cur.get("carried_to_lot_id") and cur["carried_to_lot_id"] not in seen:
        nxt = await db.lots.find_one({"_id": ObjectId(cur["carried_to_lot_id"])})
        if not nxt:
            break
        seen.add(str(nxt["_id"]))
        lineage.append({"id": str(nxt["_id"]), "lot_number": nxt["lot_number"], "fy": lifecycle.lot_fy(nxt), "relation": "later"})
        cur = nxt

    header = {"id": lot_id, "lot_number": lot["lot_number"], "style_name": lot["style_name"], "status": lot["status"], "fy": lifecycle.lot_fy(lot),
              "progress": s["progress"], "ordered": s["total_order_qty"], "planned": s["total_planned_qty"], "produced": s["total_produced_qty"],
              "start_date": lot.get("start_date"), "target_end_date": lot.get("target_end_date"), "dna_code": dna_code(lot_id),
              "integrity": integrity(closures[-1] if closures else None), "closure_version": closures[-1]["version"] if closures else None}
    if money:
        try:
            header["cost_per_piece"] = (await lifecycle.compute_costing(lot_id))["cost_per_piece"]["produced"]
        except Exception:
            header["cost_per_piece"] = None
    return {"header": header, "timeline": events, "materials": sorted(mat_rows.values(), key=lambda r: r["item"]), "people": people, "lineage": lineage,
            "lineage_current": {"id": lot_id, "lot_number": lot["lot_number"], "fy": lifecycle.lot_fy(lot), "relation": "this"}}


@router.get("/lots/{lot_id}/dna")
async def get_dna(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    return await build_dna(lot_id, user)


def _link(request: Request, lot_id: str):
    base = (__import__("os").environ.get("FRONTEND_URL") or str(request.base_url)).rstrip("/")
    return f"{base}/lots/{lot_id}/dna"


def _qr(url: str, size: float):
    from reportlab.graphics.barcode.qr import QrCodeWidget
    from reportlab.graphics.shapes import Drawing
    w = QrCodeWidget(url, barLevel="M")
    x0, y0, x1, y1 = w.getBounds()
    d = Drawing(size, size, transform=[size / (x1 - x0), 0, 0, size / (y1 - y0), 0, 0])
    d.add(w)
    return d


@router.get("/lots/{lot_id}/dna/sheet")
async def dna_sheet(lot_id: str, request: Request):
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    d = await build_dna(lot_id, user)
    h = d["header"]
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib import colors as rl
    from reportlab.lib.styles import getSampleStyleSheet
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=A4, title=f"Lot DNA {h['lot_number']}")
    st = getSampleStyleSheet()
    head = Table([[[Paragraph(f"<b>{COMPANY['name']}</b>", st["Title"]), Paragraph("LOT DNA SHEET", st["Heading3"]),
                    Paragraph(f"<b>{h['lot_number']}</b> · {h['style_name']}", st["Heading2"]),
                    Paragraph(f"DNA code <b>{h['dna_code']}</b>" + (f" · closing report v{h['closure_version']} fingerprint <b>{h['integrity']}</b>" if h["integrity"] else ""), st["Normal"])],
                   _qr(_link(request, lot_id), 90)]], colWidths=[400, 110])
    el = [head, Spacer(1, 8),
          Paragraph(f"Status: {h['status']} · Financial year {h['fy']} · Ordered {h['ordered']} · Planned {h['planned']} · Finished {h['produced']} ({h['progress']}%)", st["Normal"]),
          Paragraph(f"Dates: {h.get('start_date', '')} to {h.get('target_end_date', '')}"
                    + (f" · Cost per finished piece {h['cost_per_piece']:,.2f}" if h.get("cost_per_piece") else ""), st["Normal"])]
    if d["lineage"]:
        el.append(Paragraph("Lineage: " + " → ".join(x["lot_number"] for x in d["lineage"] if x["relation"] == "earlier") + (" → " if any(x["relation"] == "earlier" for x in d["lineage"]) else "")
                            + f"<b>{h['lot_number']}</b>" + "".join(f" → {x['lot_number']}" for x in d["lineage"] if x["relation"] == "later"), st["Normal"]))
    el += [Spacer(1, 10), Paragraph("<b>Timeline</b>", st["Heading3"])]
    rows = [["When", "What", "Who"]] + [[e["at"][:10], Paragraph((e["title"] + (f" - {e['detail']}" if e["detail"] else "")).replace("&", "&amp;").replace("<", "&lt;"), st["BodyText"]), e["by"]]
                                       for e in d["timeline"][-40:]]
    t = Table(rows, colWidths=[62, 360, 90], repeatRows=1)
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), rl.HexColor("#294f96")), ("TEXTCOLOR", (0, 0), (-1, 0), rl.white), ("GRID", (0, 0), (-1, -1), 0.3, rl.grey),
                           ("FONTSIZE", (0, 0), (-1, -1), 8), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el.append(t)
    if d["materials"]:
        el += [Spacer(1, 10), Paragraph("<b>Materials</b>", st["Heading3"]),
               Table([["Item", "Unit", "Issued", "Returned", "Written off"]] + [[m["item"], m["uom"], m["issued"], m["returned"], m["wasted"]] for m in d["materials"]], repeatRows=1,
                     style=TableStyle([("BACKGROUND", (0, 0), (-1, 0), rl.HexColor("#294f96")), ("TEXTCOLOR", (0, 0), (-1, 0), rl.white), ("GRID", (0, 0), (-1, -1), 0.3, rl.grey), ("FONTSIZE", (0, 0), (-1, -1), 8)]))]
    doc.build(el)
    out.seek(0)
    return StreamingResponse(out, media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=DNA_{h['lot_number'].replace('/', '-')}.pdf"})


@router.get("/lots/{lot_id}/dna/tag")
async def dna_tag(lot_id: str, request: Request):
    """100 x 50 mm carton label."""
    user = await get_current_user(request)
    check_role(user, ["admin", "accounts"])
    lot = await lifecycle._lot(lot_id)
    from reportlab.pdfgen import canvas
    from reportlab.lib.units import mm
    from reportlab.graphics import renderPDF
    out = io.BytesIO()
    c = canvas.Canvas(out, pagesize=(100 * mm, 50 * mm))
    c.setTitle(f"Carton tag {lot['lot_number']}")
    c.setFont("Helvetica-Bold", 15)
    c.drawString(5 * mm, 40 * mm, lot["lot_number"])
    c.setFont("Helvetica", 9)
    style = lot["style_name"][:34]
    c.drawString(5 * mm, 34 * mm, style)
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(5 * mm, 28 * mm, dna_code(lot_id))
    c.setFont("Helvetica", 7)
    c.drawString(5 * mm, 22 * mm, COMPANY["name"] + " · Tiruppur")
    c.drawString(5 * mm, 17 * mm, f"FY {lifecycle.lot_fy(lot)}")
    c.rect(5 * mm, 4 * mm, 50 * mm, 8 * mm)
    c.setFont("Helvetica", 6.5)
    c.drawString(6.5 * mm, 9 * mm, "Carton no: ____ of ____    Qty: ______")
    renderPDF.draw(_qr(_link(request, lot_id), 36 * mm), c, 60 * mm, 7 * mm)
    c.showPage()
    c.save()
    out.seek(0)
    return StreamingResponse(out, media_type="application/pdf", headers={"Content-Disposition": f"inline; filename=tag_{lot['lot_number'].replace('/', '-')}.pdf"})
