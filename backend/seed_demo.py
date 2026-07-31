"""
Seed Victoria Unit Flow with realistic demo data.

Writes straight to MongoDB rather than going through /api/production/batch,
because the batch endpoint currently drops every entry after the first one per
operator per week (see DATA-ACCURACY-BUGS.md #1). Seeding directly gives the
data a real factory would have -- daily entries across a full week -- which is
what makes the reporting bugs visible on screen.

Usage:
    LOCAL database (from backend/.env):
        backend\\.venv\\Scripts\\python.exe backend\\seed_demo.py
        backend\\.venv\\Scripts\\python.exe backend\\seed_demo.py --wipe

    REMOTE database (Render / Atlas) - prompts for the connection string so the
    password is never typed on the command line or saved anywhere:
        backend\\.venv\\Scripts\\python.exe backend\\seed_demo.py --remote --wipe

Leaves the users collection alone, so the admin login still works.
"""

import os
import sys
import uuid
import random
from datetime import datetime, timezone, timedelta
from pathlib import Path
from getpass import getpass

from dotenv import load_dotenv
from pymongo import MongoClient

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

def _read_url_file(path: Path) -> str:
    if not path.exists():
        print(f"\nFile not found: {path}")
        print("Create it, paste your connection string as the only line, save, and re-run.")
        sys.exit(1)
    text = path.read_text(encoding="utf-8-sig").strip().strip('"').strip("'")
    return text


if "--remote" in sys.argv:
    print("\nSeeding a REMOTE database (e.g. Render / Atlas).")

    # Preferred: read from a file. Pasting into Notepad is reliable, unlike
    # pasting into a hidden getpass prompt, and the string never touches the
    # terminal history or the chat. Default file: backend/mongo_url.txt
    if "--url-file" in sys.argv:
        idx = sys.argv.index("--url-file")
        url_path = Path(sys.argv[idx + 1])
    else:
        url_path = ROOT / "mongo_url.txt"

    if url_path.exists():
        mongo_url = _read_url_file(url_path)
        print(f"Read connection string from {url_path.name}")
    else:
        print("Paste the connection string and press Enter - nothing is echoed.\n")
        mongo_url = getpass("MONGO_URL > ").strip().strip('"').strip("'")

    if not mongo_url.startswith(("mongodb://", "mongodb+srv://")):
        print("\nThat does not look like a connection string (it should start with")
        print("mongodb+srv://). Nothing was changed. Aborting.")
        sys.exit(1)

    db_name = "victoria_unit_flow"
    print("Connecting...")
    client = MongoClient(mongo_url, serverSelectionTimeoutMS=10000)
    client.admin.command("ping")   # fail fast if it cannot connect
    print(f"Connected to remote database '{db_name}'.\n")
else:
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = MongoClient(mongo_url)

db = client[db_name]

random.seed(20260728)  # deterministic: re-running gives the same numbers

TODAY = datetime(2026, 7, 28)
FY = "26-27"  # Indian financial year suffix for Jul 2026


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def d(dt):
    return dt.strftime("%Y-%m-%d")


# --------------------------------------------------------------------------
# masters
# --------------------------------------------------------------------------

OPERATORS = [
    "Lakshmi R", "Ravi Kumar", "Meena S", "Anand P", "Priya M",
    "Suresh B", "Kavitha N", "Manoj T", "Divya K", "Ganesh V",
    "Selvi A", "Rajesh M",
]

OPERATIONS = [
    ("Overlock", 2.50),
    ("Flatlock", 2.00),
    ("Neck Binding", 1.75),
    ("Button Attach", 1.25),
    ("Checking", 1.00),
    ("Ironing", 0.75),
]

COLORS = ["Navy", "White", "Black", "Maroon", "Olive"]
SIZES = ["S", "M", "L", "XL", "XXL"]


def wipe():
    for c in ["operators", "operations", "colors_master", "size_charts", "weeks",
              "lots", "production_entries", "advances", "notifications",
              "edit_requests", "counters"]:
        db[c].drop()
    print("cleared existing data (users kept)")


def seed_masters():
    operators = []
    for i, name in enumerate(OPERATORS, start=1):
        code = f"OP{i:03d}"
        doc = {"name": name, "operator_code": code, "display_name": f"{name} ({code})",
               "active": True, "created_at": now_iso()}
        doc["_id"] = db.operators.insert_one(doc).inserted_id
        operators.append(doc)
    db.counters.update_one({"name": "operator_code"},
                           {"$set": {"value": len(OPERATORS)}}, upsert=True)

    operations = []
    for name, rate in OPERATIONS:
        doc = {"name": name, "active": True, "created_at": now_iso()}
        doc["_id"] = db.operations.insert_one(doc).inserted_id
        doc["default_rate"] = rate
        operations.append(doc)

    for c in COLORS:
        db.colors_master.insert_one({"name": c, "active": True, "created_at": now_iso()})

    chart = {"name": "Adult", "sizes": SIZES, "active": True, "created_at": now_iso()}
    chart["_id"] = db.size_charts.insert_one(chart).inserted_id
    db.size_charts.insert_one({"name": "Kids", "sizes": ["2-3Y", "4-5Y", "6-7Y", "8-9Y"],
                               "active": True, "created_at": now_iso()})

    print(f"masters: {len(operators)} operators, {len(operations)} operations, "
          f"{len(COLORS)} colours, 2 size charts")
    return operators, operations, chart


def seed_weeks():
    """Sequential weeks from the first Monday of 2026, Monday-Sunday."""
    start = datetime(2026, 1, 5)  # first Monday of 2026
    weeks = []
    n = 1
    cur = start
    while cur <= datetime(2026, 12, 28):
        end = cur + timedelta(days=6)
        doc = {"week_number": n, "year": 2026, "start_date": d(cur),
               "end_date": d(end), "created_at": now_iso()}
        doc["_id"] = db.weeks.insert_one(doc).inserted_id
        weeks.append(doc)
        cur = end + timedelta(days=1)
        n += 1
    print(f"weeks: {len(weeks)} generated (W1 {d(start)} .. W{len(weeks)})")
    return weeks


def make_lot(num, style, chart, operators, operations, colors, per_size, status,
             start, target, op_names):
    """Build a lot document. per_size = planned qty for every colour/size cell."""
    lot_colors = []
    for cname in colors:
        lot_colors.append({
            "color_id": str(uuid.uuid4()),
            "name": cname,
            "sizes": [{"size": s, "planned_qty": per_size[s]} for s in SIZES],
        })

    lot_ops = []
    op_lookup = {o["name"]: o for o in operations}
    for i, on in enumerate(op_names):
        o = op_lookup[on]
        # rotate which operators are assigned to which operation
        assigned = [operators[(i * 2 + k) % len(operators)] for k in range(3)]
        lot_ops.append({
            "operation_id": str(o["_id"]),
            "operation_name": o["name"],
            "rate": o["default_rate"],
            "operators": [{"operator_id": str(a["_id"]), "operator_name": a["name"],
                           "operator_code": a["operator_code"]} for a in assigned],
        })

    doc = {
        "lot_number": f"LOT{num}/{FY}", "style_name": style,
        "start_date": d(start), "target_end_date": d(target),
        "status": status, "size_chart_id": str(chart["_id"]),
        "size_chart_name": chart["name"], "sizes": SIZES,
        "colors": lot_colors, "operations": lot_ops,
        "created_at": now_iso(),
    }
    if status == "completed":
        doc.update(closed_by_name="Admin", closed_at=now_iso(),
                   close_reason="Lot completed and dispatched")
    doc["_id"] = db.lots.insert_one(doc).inserted_id
    return doc


def split(total, parts):
    """Split `total` into `parts` positive-ish integers summing exactly to total."""
    if parts <= 1:
        return [total]
    cuts = sorted(random.sample(range(1, max(total, parts)), min(parts - 1, max(total - 1, 1))))
    out, prev = [], 0
    for c in cuts:
        out.append(c - prev)
        prev = c
    out.append(total - prev)
    while len(out) < parts:
        out.append(0)
    return out[:parts]


def seed_entries(lot, weeks, completion):
    """
    Generate daily production entries for a lot.

    completion = fraction of planned quantity actually produced (per operation).
    Every operation is applied to every piece, so a fully-produced lot has
    (planned x number_of_operations) entries' worth of pieces -- which is exactly
    what makes the lot progress bar read several hundred percent.
    """
    # which weeks this lot ran in
    lot_start = datetime.strptime(lot["start_date"], "%Y-%m-%d")
    active_weeks = [w for w in weeks
                    if datetime.strptime(w["start_date"], "%Y-%m-%d") >= lot_start - timedelta(days=7)
                    and datetime.strptime(w["start_date"], "%Y-%m-%d") <= TODAY][:4]
    if not active_weeks:
        return 0

    entries = []
    for op in lot["operations"]:
        for color in lot["colors"]:
            for sz_entry in color["sizes"]:
                sz = sz_entry["size"]
                target_qty = int(sz_entry["planned_qty"] * completion)
                if target_qty <= 0:
                    continue

                # spread this size's output over weeks -> days -> operators
                per_week = split(target_qty, len(active_weeks))
                for w, wq in zip(active_weeks, per_week):
                    if wq <= 0:
                        continue
                    wk_start = datetime.strptime(w["start_date"], "%Y-%m-%d")
                    # Mon-Sat working days that are not in the future
                    days = [wk_start + timedelta(days=k) for k in range(6)]
                    days = [x for x in days if x <= TODAY]
                    if not days:
                        continue
                    per_day = split(wq, len(days))
                    for day, dq in zip(days, per_day):
                        if dq <= 0:
                            continue
                        ops_list = op["operators"]
                        per_op = split(dq, len(ops_list))
                        for operator, oq in zip(ops_list, per_op):
                            if oq <= 0:
                                continue
                            entries.append((w, day, op, color["name"], operator, sz, oq))

    # merge rows that share week/day/operation/colour/operator into one entry
    # with a size_quantities dict, the way the real batch endpoint writes them
    merged = {}
    for w, day, op, cname, operator, sz, qty in entries:
        key = (str(w["_id"]), d(day), op["operation_id"], cname, operator["operator_id"])
        if key not in merged:
            merged[key] = {"w": w, "day": day, "op": op, "color": cname,
                           "operator": operator, "sizes": {}}
        merged[key]["sizes"][sz] = merged[key]["sizes"].get(sz, 0) + qty

    docs = []
    for m in merged.values():
        total_qty = sum(m["sizes"].values())
        if total_qty == 0:
            continue
        rate = m["op"]["rate"]
        docs.append({
            "week_id": str(m["w"]["_id"]), "week_number": m["w"]["week_number"],
            "year": m["w"]["year"], "lot_id": str(lot["_id"]),
            "lot_number": lot["lot_number"], "style_name": lot["style_name"],
            "operation_id": m["op"]["operation_id"],
            "operation_name": m["op"]["operation_name"],
            "color": m["color"], "rate": rate,
            "operator_id": m["operator"]["operator_id"],
            "operator_name": m["operator"]["operator_name"],
            "operator_code": m["operator"]["operator_code"],
            "size_quantities": m["sizes"], "total_quantity": total_qty,
            "total_earnings": round(total_qty * rate, 2),
            "date": d(m["day"]), "entered_by": "seed",
            "entered_by_name": "Data Entry", "created_at": now_iso(),
        })

    if docs:
        db.production_entries.insert_many(docs)
    return len(docs)


def seed_advances(operators, weeks):
    """A mix of pending, partially adjusted and fully cleared advances."""
    plan = [
        (0, 2000, "Festival advance", "pending", 2000),
        (1, 1500, "Medical", "pending", 1500),
        (3, 3000, "Family function", "partially_adjusted", 1200),
        (4, 800,  "Travel", "pending", 800),
        (6, 2500, "House rent", "partially_adjusted", 500),
        (7, 1000, "Emergency", "fully_adjusted", 0),
        (9, 1800, "School fees", "pending", 1800),
    ]
    n = 0
    for idx, (oi, amount, remark, status, balance) in enumerate(plan, start=1):
        op = operators[oi]
        adv_date = TODAY - timedelta(days=random.randint(10, 45))
        adjustments = []
        if status != "pending":
            adjustments.append({
                "amount": amount - balance,
                "week_number": weeks[20]["week_number"], "year": 2026,
                "date": now_iso(), "adjusted_by": "Admin", "source": "payroll",
            })
        db.advances.insert_one({
            "operator_id": str(op["_id"]), "operator_name": op["name"],
            "operator_code": op["operator_code"], "date": d(adv_date),
            "amount": float(amount), "balance": float(balance), "remarks": remark,
            "status": status, "voucher_number": f"ADV{idx}/{FY}",
            "adjustments": adjustments, "created_by": "seed",
            "created_by_name": "Admin", "created_at": now_iso(),
        })
        n += 1
    db.counters.update_one({"name": f"adv_voucher_{FY}"},
                           {"$set": {"value": n}}, upsert=True)
    return n


def seed_notifications(operators):
    msgs = [
        ("advance_created", "Advance ADV7/26-27 - School fees - Rs.1800"),
        ("lot_closed", "LOT1/26-27 (VG-TEE-101) closed by Admin"),
        ("production", "Week 30 production entry completed for LOT3/26-27"),
    ]
    for t, m in msgs:
        db.notifications.insert_one({"type": t, "message": m, "read": False,
                                     "created_at": now_iso()})


def main():
    if "--wipe" in sys.argv:
        wipe()

    if db.lots.count_documents({}) > 0:
        print("Data already present. Re-run with --wipe to replace it.")
        return

    operators, operations, chart = seed_masters()
    weeks = seed_weeks()

    op_names = [n for n, _ in OPERATIONS]

    lots_spec = [
        # num, style,        colours,                 per-size qty, status,      completion
        (1, "VG-TEE-101",    ["Navy", "White"],       120, "completed", 1.00,
         op_names[:4], TODAY - timedelta(days=45), TODAY - timedelta(days=10)),
        (2, "VG-POLO-204",   ["Black", "Maroon"],     100, "active",    0.72,
         op_names[:5], TODAY - timedelta(days=28), TODAY + timedelta(days=6)),
        (3, "VG-KIDS-310",   ["Navy", "Olive", "White"], 80, "active",  0.45,
         op_names[:3], TODAY - timedelta(days=14), TODAY + timedelta(days=14)),
        (4, "VG-VEST-090",   ["White"],               150, "active",    0.18,
         op_names[:4], TODAY - timedelta(days=7),  TODAY + timedelta(days=21)),
    ]

    total_entries = 0
    for num, style, colors, qty, status, completion, ops, start, target in lots_spec:
        per_size = {s: qty for s in SIZES}
        # taper the extreme sizes, the way a real size ratio looks
        per_size["S"] = int(qty * 0.6)
        per_size["XXL"] = int(qty * 0.5)
        lot = make_lot(num, style, chart, operators, operations, colors,
                       per_size, status, start, target, ops)
        n = seed_entries(lot, weeks, completion)
        total_entries += n
        planned = sum(per_size[s] for s in SIZES) * len(colors)
        print(f"  {lot['lot_number']:14s} {style:14s} {status:9s} "
              f"planned {planned:5d}  ops {len(ops)}  entries {n}")

    db.counters.update_one({"name": f"lot_{FY}"},
                           {"$set": {"value": len(lots_spec)}}, upsert=True)

    n_adv = seed_advances(operators, weeks)
    seed_notifications(operators)

    print(f"\nproduction entries: {total_entries}")
    print(f"advances: {n_adv}")
    where = "your deployed app (e.g. https://victoriya.onrender.com)" if "--remote" in sys.argv \
        else "http://localhost:3000"
    print(f"\nDone. Refresh {where}")


if __name__ == "__main__":
    main()
