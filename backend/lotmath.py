"""Pure arithmetic for lots: allowance rounding and piece-rate earnings.

No database, no web framework, so every rule here has a plain unit test
(test_lotmath.py). Server code must call these instead of re-deriving numbers.
"""
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation


def planned_from_order(order_qty, allowance_pct) -> int:
    """Pieces to plan for an ordered quantity plus an allowance percentage.

    Half-up, per cell: 115.49 -> 115, 115.50 -> 116. Python's round() is banker's
    rounding (round(6.5) == 6) and float maths drifts, so this is exact integer
    arithmetic in basis points. The JS twin is plannedFromOrder() in the lot form;
    the server value is the one that counts.
    """
    bp = int((Decimal(str(allowance_pct or 0)) * 100).to_integral_value(ROUND_HALF_UP))
    return (int(order_qty) * (10000 + bp) + 5000) // 10000


def parse_money(value, label="rate", lo=0, hi=10000):
    """A rate typed by a person -> float with at most 4 decimals, bounds checked."""
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, ValueError, AttributeError):
        raise ValueError(f"'{value}' is not a valid {label}")
    if d < lo or d > hi:
        raise ValueError(f"{label.capitalize()} must be between {lo} and {hi}")
    return float(d.quantize(Decimal("0.0001"), rounding=ROUND_HALF_UP))


def clean_size_rates(raw, allowed_sizes=None) -> dict:
    """{size: rate} with blanks dropped. Unknown sizes are an error when the
    chart's sizes are known, so a typo cannot silently fall back to the flat rate."""
    out = {}
    for size, val in (raw or {}).items():
        if val is None or str(val).strip() == "":
            continue
        if allowed_sizes is not None and size not in allowed_sizes:
            raise ValueError(f"Size '{size}' is not on this lot's size chart")
        out[size] = parse_money(val, f"rate for size {size}")
    return out


def rate_for_size(size, flat_rate, size_rates=None) -> float:
    return (size_rates or {}).get(size, flat_rate)


def compute_earnings(size_quantities: dict, flat_rate: float, size_rates=None):
    """(pieces, money) for {size: qty}. The only place pay is computed.

    With no per-size rates this is exactly the legacy `round(qty * rate, 2)`, so
    every entry recorded before per-size rates still totals to the paisa. With
    per-size rates the products are summed exactly (Decimal) and rounded once.
    """
    qty = sum(int(q) for q in size_quantities.values())
    if not size_rates:
        return qty, round(qty * flat_rate, 2)
    total = sum(Decimal(int(q)) * Decimal(str(rate_for_size(sz, flat_rate, size_rates)))
                for sz, q in size_quantities.items())
    return qty, float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def resolved_size_rates(size_quantities, flat_rate, size_rates=None) -> dict:
    """The rate actually applied to each size in an entry, kept on the entry as a
    snapshot so later edits to the lot's rate card never change what was paid."""
    return {sz: rate_for_size(sz, flat_rate, size_rates) for sz in size_quantities}


def average_rate(size_quantities, flat_rate, size_rates=None) -> float:
    qty, money = compute_earnings(size_quantities, flat_rate, size_rates)
    return round(money / qty, 4) if qty else flat_rate


def lot_op_rates(lot_op: dict, default_type: dict):
    """All rate-card rows for a lot operation, always including the default type.
    Old lots only have `rate`; that is the default type's flat rate."""
    rows = [r for r in (lot_op.get("rates") or [])]
    if not any(r.get("rate_type_id") == default_type["id"] for r in rows):
        rows.insert(0, {"rate_type_id": default_type["id"], "rate_type_name": default_type["name"],
                        "rate": lot_op.get("rate", 0), "size_rates": lot_op.get("size_rates") or {}})
    return rows


def find_rate(lot_op: dict, rate_type_id: str, default_type: dict):
    """(flat, size_rates) for this operation under a rate type, or None if the
    lot has no rate set for that type."""
    for row in lot_op_rates(lot_op, default_type):
        if row.get("rate_type_id") == rate_type_id:
            return row.get("rate", 0), (row.get("size_rates") or {})
    return None
