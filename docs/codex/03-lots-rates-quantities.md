# Phase 3 — Lot allowance & rounding, rate types, per-size rates, quantity controller

This phase changes **how money and plan quantities are computed**. It is the
riskiest one. Work test-first, and re-read `DATA-ACCURACY-BUGS.md` before starting.

## 1. Order quantity, allowance %, half-up rounding

Owner's rule: a 110-piece requirement carrying a 5% allowance is 115.5 -> **116**.
Per size: `6.49 -> 6`, `6.50 and above -> 7`. Show an **overall total**.

### Data

On each lot: `allowance_pct` (0–50, up to 2 decimals; the owner's "pre %"),
and per colour/size `{ size, order_qty, planned_qty }`.

- `order_qty` = what the buyer asked for (what the user types in the grid).
- `planned_qty` = `round_half_up(order_qty x (1 + allowance_pct/100))`. **This is
  the value every existing control already uses** (`assert_within_plan`,
  `enrich_lot`, tracking, reports) — so none of them change.
- Old lots have no `order_qty`: treat as `order_qty = planned_qty`,
  `allowance_pct = 0`.
- Lot summary fields: `total_order_qty`, `total_planned_qty` (= **sum of the
  rounded cells**, never `round(sum)`), `allowance_qty` = planned − order.

### Algorithm — exact integer arithmetic, identical in Python and JS

Python's `round()` is banker's rounding (`round(6.5) == 6`) and float maths gives
`115.49999…` surprises. Use integers (basis points):

```python
def planned_from_order(order_qty: int, allowance_pct) -> int:
    bp = int((Decimal(str(allowance_pct)) * 100).to_integral_value(ROUND_HALF_UP))  # 5 -> 500
    return (order_qty * (10000 + bp) + 5000) // 10000       # half-up
```
```js
export const plannedFromOrder = (order, pct) => {
  const bp = Math.round((Number(pct) || 0) * 100);
  return Math.floor((order * (10000 + bp) + 5000) / 10000);
};
```
Put each in one named function with a docstring that states the half-up rule and
why. The **server is authoritative**; the UI only previews.

Required test vectors (backend unit test + a frontend test if you add Jest):

| order | pct | exact | planned |
|---|---|---|---|
| 110 | 5 | 115.50 | **116** |
| 100 | 5 | 105.00 | 105 |
| 109 | 5 | 114.45 | 114 |
| 111 | 5 | 116.55 | 117 |
| 130 | 5 | 136.50 | **137** |
| 123 | 5 | 129.15 | 129 (below .5 rounds down — the owner's "6.49 -> 6") |
| 0 | 5 | 0 | 0 |
| 109 | 4.5 | 113.905 | 114 (decimal % works, no float drift) |

Overall-total case: three cells of 109 at 5% are each 114.45 -> **114**, so the
overall total is `114 x 3 = 342`. Rounding the summed exact value instead
(`round(343.35) = 343`) would be wrong — the total is the sum of the rounded cells.

### UI (lot form, "Color & Size" tab)

- Allowance % input above the grid (default 0, step 0.5).
- Grid cells take **order** quantities. Under each cell, a small muted planned
  value when pct > 0 (e.g. `110 -> 116`). Row total, column total and a prominent
  **Overall total** (Order · Allowance · Planned) pinned above the grid.
- Edit mode on a lot with production: see Phase 2 §5.6 (cannot plan below produced).
- Lots list gets Order and Planned columns; PDF/Excel lot exports show both.

## 2. Rate types ("3 types of rates")

New master `rate_types`: `{ name, code, counts_toward_plan, cap_pct_of_plan|null,
cap_pieces|null, is_default, sort_order, active }`. Seed once, if empty:

| name | counts_toward_plan | default |
|---|---|---|
| Regular | true | yes |
| Sample | false | |
| Rework / Special | false | |

(Names and flags are assumptions — admin can rename/add; page under *Master data*.)

- Lot operation: `rates: [{ rate_type_id, rate_type_name, rate, size_rates? }]`.
  Keep legacy `rate` on the operation = the Regular flat rate, so old readers
  keep working. Old lots: synthesise `rates = [Regular @ rate]` on read.
- Production entry stores a **snapshot**: `rate_type_id`, `rate_type_name`,
  `rate` (flat or weighted-average, for display) and `size_rates` (the resolved
  rate used for every size in that entry).
- Duplicate key gains `rate_type_id` (a Regular and a Sample entry by the same
  operator on the same day are legitimately different).
- `counts_toward_plan = false` entries are **excluded** from `assert_within_plan`,
  `enrich_lot` progress, tracking and "produced", but **included** in payroll.
  This is a payroll-inflation path, so:
  - enforce `cap_pct_of_plan` / `cap_pieces` per lot per operation when set;
  - always report non-plan pieces and their cost in the Lot closing/costing
    reports and on the dashboard;
  - setting `non_plan_alert_pct` (default 5): notify admins when exceeded.
  Leave the caps **unset by default and ask the owner** to set them (money rule).
- Production entry UI: a rate-type selector (default = the default type) above the
  grid; the choice is shown in the entry log.
- Payroll: `get_weekly_payroll_data` currently keeps the **first** rate it sees
  per operation name. Group by (operation, rate type) and show quantity,
  weighted-average rate (`earnings / qty`, rounded 4 dp for display) and earnings.
  Excel, PDF and voucher read the same structure, line label
  `Overlock` or `Overlock (Sample)`.
- `export_excel` operation-cost report also keeps the first rate — fix likewise.

## 3. Per-size piece rate

Some operations pay more for larger sizes. Per lot-operation (and per rate type):
optional `size_rates: { "S": 2.50, "M": 2.50, "L": 2.75, "XL": 3.00 }`; any size
missing from the map uses the flat rate.

Central helper — **the only place earnings are computed**:

```python
def compute_earnings(size_quantities: dict, flat_rate: float, size_rates: dict | None) -> tuple[int, float]:
    qty = sum(size_quantities.values())
    money = sum(q * (size_rates or {}).get(sz, flat_rate) for sz, q in size_quantities.items())
    return qty, round(money, 2)          # round once, at the end
```

Call it from: `create_production_batch`, `edit_production`, `review_edit_request`
(approval apply), and replace every `qty * rate` / `total_quantity * rate` you find
(`grep -n "rate" backend/server.py`): the lot Excel export, operation-cost
export, voucher. Entries created before this phase have no `size_rates`: fall
back to `rate` — totals for old data must not change by a single paisa (add a test
that loads a legacy-shaped entry).

UI (lot form, rate panel — the "6th option panel" in the owner's note, see README
Q3): per operation row a "Different rate per size" toggle reveals one input per
size of the chosen size chart, prefilled with the flat rate; per rate type tabs
or columns. Validate `0 <= rate <= 10000`, 2 decimals, show the planned labour
cost per piece range (min–max across sizes). The production grid shows the
resolved rate under each size header and a live earnings preview (hidden from
`data_entry`, who must never see rates — existing behaviour).

## 4. Quantity controller

Per lot (stored on the lot, edited in the same panel):

```
quantity_control: {
  over_tolerance_pct: 0,          # extra beyond planned that needs approval; 0 = strict (today's behaviour)
  warn_at_pct: 90,                # UI turns amber/red as a size approaches its plan
  locked: { "<color>|<size>": true }   # admin stops further entry on that cell
}
```

- `assert_within_plan` keeps its strict behaviour. When `over_tolerance_pct > 0`
  and the excess is within `planned x (1 + tol)`, the batch endpoint returns
  **409** `{code: "needs_approval", excess: {...}}` instead of 400; the UI offers
  "Request approval for N extra pieces", creating a `quantity_override` approval
  (Phase 2) whose payload is the full batch. Approval re-runs the batch with an
  `override_approval_id` that relaxes only that check. Beyond the tolerance it is
  a hard 400.
- Locked cells: 400 with a clear message; the grid disables them.
- The "Remaining" figures on the entry screen already exist
  (`/production/tracking`); extend with the lock flag and tolerance headroom.
- The controller never lowers a plan below what is already produced.

## 5. Tests and acceptance

- [ ] Rounding table above, including the `3 x 109` overall-total case.
- [ ] A legacy lot + legacy entries: every report, payroll and voucher total is
      byte-for-byte unchanged versus before the phase.
- [ ] Per-size rate: 10 S + 5 XL at 2.50/3.00 -> 40.00; edit and approval-apply
      recompute identically.
- [ ] Rework/Sample entries: excluded from progress, included in pay, capped
      when caps set, appear in the non-plan report.
- [ ] Over-tolerance: 409 -> approval -> approved -> saved; rejected -> nothing saved.
- [ ] `data_entry` still cannot see any rate or earnings anywhere (network tab too).
- [ ] `test_api.py` green; new assertions added.
