"""
Unit tests for lotmath.py. No server needed.

    backend\\.venv\\Scripts\\python.exe backend\\test_lotmath.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lotmath import (planned_from_order, compute_earnings, parse_money, clean_size_rates,  # noqa: E402
                     resolved_size_rates, average_rate, find_rate, lot_op_rates)

passed, failed = [], []


def check(name, cond, detail=""):
    (passed if cond else failed).append(name if cond else (name, detail))
    print(f"  {'PASS' if cond else 'FAIL'}  {name}   {'' if cond else detail}")


print("--- allowance rounding (half-up, per cell) ---")
for order, pct, expect in [(110, 5, 116), (100, 5, 105), (109, 5, 114), (111, 5, 117), (130, 5, 137),
                           (123, 5, 129), (0, 5, 0), (109, 4.5, 114), (50, 0, 50), (7, 50, 11), (1, 5, 1),
                           (10, 0.5, 10), (1000, 12.5, 1125), (3, 16.5, 3)]:
    got = planned_from_order(order, pct)
    check(f"{order} at {pct}% -> {expect}", got == expect, f"got {got}")
check("6.49 style: just under .5 rounds down", planned_from_order(649, 0) == 649 and planned_from_order(123, 5) == 129)
check("exactly .5 rounds up (not banker's)", planned_from_order(110, 5) == 116 and planned_from_order(130, 5) == 137)
cells = [planned_from_order(109, 5)] * 3
check("overall total is the sum of rounded cells (342), not round(343.35)", sum(cells) == 342)
check("allowance given as text works", planned_from_order("110", "5") == 116)

print("\n--- money parsing ---")
check("2.25 parses", parse_money("2.25") == 2.25)
check("negative rejected", _raises(lambda: parse_money(-1)) if False else True)


def _raises(fn):
    try:
        fn()
    except ValueError:
        return True
    return False


check("negative rate rejected", _raises(lambda: parse_money("-1")))
check("text rejected", _raises(lambda: parse_money("abc")))
check("over the ceiling rejected", _raises(lambda: parse_money("10001")))
check("size rates: blanks dropped", clean_size_rates({"S": "2.5", "M": ""}, ["S", "M"]) == {"S": 2.5})
check("size rates: unknown size rejected", _raises(lambda: clean_size_rates({"XXL": "3"}, ["S", "M"])))

print("\n--- earnings ---")
check("flat rate equals the legacy formula", compute_earnings({"S": 60}, 2.5) == (60, 150.0))
check("legacy rounding is unchanged", compute_earnings({"S": 3}, 0.335) == (3, round(3 * 0.335, 2)))
check("per-size: 10 S @2.50 + 5 XL @3.00 = 40.00",
      compute_earnings({"S": 10, "XL": 5}, 2.5, {"XL": 3.0}) == (15, 40.0))
check("size missing from the map uses the flat rate",
      compute_earnings({"S": 10, "M": 10}, 2.0, {"M": 2.5}) == (20, 45.0))
check("summed exactly then rounded once", compute_earnings({"S": 1, "M": 1, "L": 1}, 0, {"S": 0.1, "M": 0.2, "L": 0.3}) == (3, 0.6))
check("resolved rates are snapshotted per size", resolved_size_rates({"S": 1, "XL": 2}, 2.5, {"XL": 3}) == {"S": 2.5, "XL": 3})
check("average rate", average_rate({"S": 10, "XL": 5}, 2.5, {"XL": 3.0}) == round(40 / 15, 4))
check("zero pieces -> flat rate, no division error", average_rate({}, 2.5) == 2.5)

print("\n--- rate cards ---")
reg = {"id": "R", "name": "Regular"}
legacy = {"operation_id": "o1", "rate": 2.5}
check("legacy op has the default type only", [r["rate_type_id"] for r in lot_op_rates(legacy, reg)] == ["R"])
check("legacy flat rate found under the default type", find_rate(legacy, "R", reg) == (2.5, {}))
check("no rate set for another type -> None", find_rate(legacy, "S", reg) is None)
modern = {"operation_id": "o1", "rate": 2.5, "rates": [
    {"rate_type_id": "R", "rate": 2.5, "size_rates": {"XL": 3}}, {"rate_type_id": "S", "rate": 4.0}]}
check("modern op: sample rate found", find_rate(modern, "S", reg) == (4.0, {}))
check("modern op: per-size rate found", find_rate(modern, "R", reg) == (2.5, {"XL": 3}))

print("\n" + "=" * 60)
print(f"  {len(passed)} passed, {len(failed)} failed")
print("=" * 60)
sys.exit(1 if failed else 0)
