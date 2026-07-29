# Victoria Unit Flow — why the numbers are wrong

> **STATUS: all findings below are FIXED as of 28 July 2026.**
> Every fix is covered by `backend/test_api.py` — 95 assertions, all passing.
> Run it against a live backend with:
> `backend\.venv\Scripts\python.exe backend\test_api.py`
>
> This document is kept as the record of what was wrong and why, so the reasoning
> behind each change is not lost. Two extra bugs were found while fixing these:
> the lot Excel export also crashed because Excel rejects the `/` in a lot number
> used as a sheet title, and `animate-fade-in` was referenced in the UI but never
> defined, so the page transition did nothing.

*Audit dated 28 July 2026, focused specifically on the client's complaint: "it does
not give accurate data". This is a separate pass from `ANALYSIS.md`, which covered
structure, security and getting the app to boot.*

Everything below was found by reading the code paths that produce numbers. Line
references are to `backend/server.py` unless stated otherwise.

**Short version:** the arithmetic is fine. `pieces × rate` is correct everywhere it
appears. The numbers come out wrong because of *what gets counted* — production that
is silently thrown away, production counted several times over, and advances that are
deducted on screen but not on the printout the worker actually receives.

---

## Tier 1 — silently wrong money

### 1. Only one production entry per operator per week can ever be saved

`create_production_batch`, lines 881–887. Before saving, it looks for an existing
entry matching:

```
week_id + lot_id + operation_id + color + operator_id
```

**`date` is not in that key.** So the first day of the week saves. Every later day
for the same operator on the same lot/operation/colour is treated as a duplicate,
skipped, and reported back only as `duplicates_skipped` — which the UI shows as a
dismissible orange toast (`ProductionEntryPage.js:186–188`), not an error.

The app clearly intends daily entry: there is a Date picker
(`ProductionEntryPage.js:248–251`), the entry stores `date`, and there is a
"This Week's Entries" list built to show several days.

**Effect:** an operator who works Monday to Saturday gets paid for Monday.
Under-reporting of up to ~6× on both output and wages. This is almost certainly the
complaint your client is describing.

**Fix:** add `"date": data.date` to the duplicate query. Same-day re-submission is
still blocked, which is the check that was actually wanted.

---

### 2. Lot progress and balance are multiplied by the number of operations

`enrich_lot`, lines 625–630:

```python
pipeline = [{"$match": {"lot_id": lot_id}}, {"$group": {"_id": None, "total": {"$sum": "$total_quantity"}}}]
```

No operation filter. It sums every entry on the lot, across all operations, and
compares that to the planned piece count.

The code elsewhere confirms each operation is applied to *every* piece —
`report_lot_operation:1394` sets each operation's `planned_qty` to the lot's full
`total_planned_qty`.

So a 300-piece lot with 3 operations, fully complete, reports:

| Field | Shown | Correct |
|---|---|---|
| `total_produced_qty` | 900 | 300 |
| `balance_qty` | −600 | 0 |
| `progress` | 300 % | 100 % |

Displayed on the Dashboard (`DashboardPage.js:70–79`), the Lots list
(`LotsPage.js:90–93`), the Reports header (`ReportsPage.js:226–228`) and the Excel
lot export (lines 1507–1509).

**Fix:** produced quantity for a lot is `min` over operations, or the count for a
single nominated "final" operation — not the sum. The per-operation view in
`report_lot_matrix` (1238–1276) already gets this right and can be the model.

---

### 3. The salary sheet and the payment voucher print gross, not net

Three export paths all call `get_weekly_payroll_data()` (1093–1118), which contains
no advance logic at all:

- Salary **Excel** — lines 1530–1546
- Salary **PDF** — lines 1630–1638
- **Payment voucher PDF** — lines 1601–1628

Only the on-screen payroll endpoint `/payroll/weekly` (1120–1142) adds
`advance_balance` and `net_salary`.

**Effect:** the screen shows an operator is owed ₹50 after a ₹200 advance. The
voucher you print and hand them says ₹250, with a signature line under it. The
voucher does not mention the advance anywhere.

**Fix:** move the advance-joining block (1126–1141) into a shared helper and use it
for all four consumers. The voucher needs Gross / Less advance / Net rows.

---

### 4. Advances are re-deducted every week until someone clicks Adjust

`/payroll/weekly`, lines 1127–1139. For each operator it pulls *all* advances still
`pending` or `partially_adjusted` and subtracts the entire outstanding balance from
this week's earnings. Nothing records that a deduction belongs to a particular week.

Two consequences:

- Load week 10 → −₹1,000. Load week 11 → −₹1,000 again. Same debt, shown twice.
  It only stops when an admin manually opens the dialog and adjusts.
- Earnings ₹250 against a ₹1,000 advance gives `net_salary = −750`. There is no cap
  at the week's earnings, so the sheet shows a negative wage.

**Fix:** deduct `min(outstanding, this_week_earnings)`, and record the adjustment
against the week at the moment payroll is finalised rather than as a separate manual
step.

---

## Tier 2 — controls that don't actually hold

### 5. Editing an entry bypasses the over-production check

`edit_production`, lines 915–936, recomputes `total_quantity` and `total_earnings`
from whatever is posted, with **no validation against `planned_qty`**. The
over-production guard in `create_production_batch` (863–870) is the single most
important control in the app, and the edit route walks straight past it. An admin can
edit a 100-piece entry to 10,000.

### 6. The edit-request approval flow does nothing

`ProductionEntryPage.js:90` posts only `{entry_type, entry_id, reason}` — no
`proposed_changes`. `review_edit_request:1086` requires `proposed_changes` to be
truthy before applying anything. So a non-admin submits a correction, sees
*"Edit request submitted"*, an admin approves it, and **the number never changes**.
Both parties believe the correction was made.

Separately, if `proposed_changes` ever *were* populated, line 1088 `$set`s them raw
into the production entry — arbitrary client-controlled fields including
`total_earnings`, `rate` and `operator_id`, with no recompute and no bounds check.

### 7. A size entered as 0 can never be corrected

Saving strips zero-quantity sizes (line 877), and the admin edit dialog only renders
sizes already present in `size_quantities`
(`ProductionEntryPage.js:538, 544`). If size L was mistyped as 0 on entry, L is not
in the document, so it does not appear in the edit grid and cannot be put back. The
entry must be deleted and re-created.

### 8. Advance adjustment ignores the voucher you selected

`payroll_adjust_advance`, lines 1155–1167. It looks up the `advance_id` you sent,
then discards it and re-queries *all* of that operator's open advances, oldest-first.

Oldest-first (FIFO) is correct accounting. The problem is the UI sends a specific
`advance_id` (`PayrollPage.js:44`), so accounts staff select voucher ADV7 and watch
ADV3 get adjusted instead. Either honour the selection or stop offering it.

Also missing here: any check that `amount > 0`, and any cap against the week's
earnings. (`adjust_advance` at 1012–1030 has the same missing `> 0` check — a
negative amount *increases* the outstanding balance and writes a fake adjustment
record.)

### 9. Voucher numbers are consumed on every print

`export_pdf:1605` calls `get_next_voucher_number()`, which `$inc`s the counter, every
time a voucher PDF is generated. Preview it twice and you have burned PV1 and PV2.
Reprint a lost voucher and it comes out with a different number. For a numbered
financial document that breaks the sequence permanently — the number should be
allocated once, stored, and re-read on reprint.

---

## Tier 3 — crashes and the week model

### 10. Excel export of a lot report returns HTTP 500

Line 1528:

```python
ws.append([e["date"], e["color"], e["size"], ...])
```

Production entries have no `size` field — they store `size_quantities`, a dict.
`KeyError` on the first entry, so **any lot that has production data fails to
export**. An empty lot exports fine, which is likely why it was never caught.
(The salary export is unaffected.)

### 11. The dashboard can silently report a zero week

`get_current_week` (185–191) looks for a week document covering today; if none is
found it falls back to `datetime.isocalendar()[1]` — the ISO week number.

But the app's own weeks come from `/weeks/generate` (584–603), which numbers them
sequentially from **1** starting at whatever date you chose. Those two numbering
schemes do not agree.

The moment the generated weeks run out — `generate` stops at 31 December of the
requested `year` — or there is any gap, the dashboard queries a week number that no
entry carries and shows 0 pieces and ₹0 earnings for a week that had plenty of both.

Related, in the same function: every generated week is stamped with the requested
`year` even when it ends in January of the following year, and `week_number` restarts
at 1 each year. Since payroll keys on `(week_number, year)`, the week straddling the
year boundary is ambiguous.

### 12. Deleting a lot rewrites payroll history

`delete_lot` (739–745) deletes the lot *and* every production entry on it. Advances
already adjusted against those earnings stay adjusted. Re-run a past week's payroll
after a lot deletion and it will not match what was actually paid, with no record of
why. A lot with entries should be blocked from deletion, or archived — the way
`delete_week` (605–613) already correctly refuses when entries exist.

---

## Tier 4 — cosmetic, but it costs you trust

### 13. Floating-point artifacts on screen

`get_dashboard` lines 1220 and 1228 round each entry before adding it, then never
round the accumulated total, so figures render as `1234.5600000000002`.
`report_weekly_production:1325` accumulates unrounded per-lot earnings the same way.
When a client is already suspicious of the numbers, this reads as another bug.

Money should be accumulated in paise as integers, or rounded once at the end.

---

## What is actually sound

Worth knowing before deciding whether to rebuild or repair:

- `pieces × rate` is computed correctly and consistently everywhere.
- Rates and operator names are copied onto each production entry, so editing a master
  record later cannot retroactively change what someone was paid. That is the right
  design for payroll.
- The over-production check on batch entry (863–870) is a genuinely good control —
  it just needs to be applied on the edit path too.
- FIFO advance adjustment with an `adjustments[]` ledger is the correct approach.
- Counters use atomic `find_one_and_update` + `$inc`, so concurrent creates cannot
  collide.
- Audit trails (`edit_history`, close/reopen reasons) are recorded throughout.

The data model is sound. Findings 1, 2, 3 and 4 are the ones producing wrong numbers
today, and all four are contained fixes — none requires reshaping the schema.

---

## Suggested order of work

| # | Finding | Why first |
|---|---|---|
| 1 | Add `date` to the duplicate key | Restores up to 5 days/week of lost production |
| 3 | Share the advance-joined payroll across exports | Stops overpaying against printed vouchers |
| 2 | Per-operation lot progress | Makes every progress figure in the app meaningful |
| 4 | Cap and record weekly advance deduction | Stops the same debt being shown repeatedly |
| 10 | Fix `e["size"]` in Excel export | One-line fix for a hard 500 |
| 5 | Apply the over-plan check on edit | Closes the hole in the main control |
| 6 | Make edit requests carry changes, or remove the flow | It currently misleads both parties |
| 9 | Allocate voucher numbers once | Audit integrity |
| 11 | Reconcile the two week-numbering schemes | Prevents a whole week reading as zero |

Findings 1, 3, 5 and 10 are small and self-contained — a few hours in total.
2, 4 and 11 need a decision from the client about intended behaviour first.
