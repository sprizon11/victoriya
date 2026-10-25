# Phase 4 — Stock management, requirements -> auto PO, expense bills

New feature area. Put the backend in `backend/stock.py`, `backend/purchasing.py`,
`backend/expenses.py` (each an `APIRouter` included from `server.py`, using
`backend/core.py` from Phase 2). Every mutating route writes an audit entry; the
listed actions need approvals (Phase 2).

Roles: **admin** everything; **accounts** purchasing, expenses, stock receipts
and reports; **data_entry** can only *issue/return stock to a lot* if the owner
enables it (setting `data_entry_can_issue_stock`, default off). Stock values
(rates, amounts) hidden from `data_entry`.

## 1. Stock — a ledger, never an editable balance

Balances are **derived** from movements. No route may `$set` a balance. This is
the same philosophy as the advances ledger.

### Masters

- `stock_items`: `{ code (auto ITM001), name, category, uom, dual_unit, uom2,
  avg_weight_per_unit?, reorder_level, active, notes }`
  - `category`: `yarn | fabric | elastic | thread | label | sticker | fusing |
    button_zip | packing | other` (admin-extensible list in `system_settings`).
  - `uom`: `pcs | meter | kg | cone | roll | box`.
  - **Dual unit (the "two entries" requirement):** items such as yarn cones are
    bought **by count and by weight**. For `dual_unit` items every movement carries
    **both** `qty` (e.g. cones) and `qty2` (e.g. kg) — both mandatory, both > 0.
    Balances are kept in both units. Show the implied `kg per cone`; warn (don't
    block) when a receipt's ratio differs from the item's running average by more
    than a setting (`dual_unit_tolerance_pct`, default 5).
  - Elastic is a normal single-unit item in **meter**; labels/stickers/fusing are
    `pcs` (fusing may be `meter`) — same mechanism, different category.
- `suppliers`: `{ name, contact, phone, email, gstin?, address, active }`.
- `stock_locations` — **skip** for now (single store). Do not build it.

### Movements — `stock_movements`

```
{ no (STK-IN/…  numbered per FY), type, date, item_id, item_name (snapshot), uom,
  qty, qty2?, rate?, amount?, supplier_id?, supplier_bill_no?, po_id?, grn_no?,
  lot_id?, lot_number? (snapshot), from_lot_id?, to_lot_id?,
  reason, note, created_by, created_at, approval_id? }
```

| type | Effect | Notes |
|---|---|---|
| `receipt` | + store | Against a PO line (partial allowed) or direct; needs supplier + bill no |
| `issue` | − store, + lot | Issue to a lot; cannot exceed store balance unless approved |
| `return` | + store, − lot | Unused material back from a lot |
| `transfer` | lot A -> lot B | "If there is a problem, move to the next lot": reason required |
| `wastage` | − lot/store | Reason required (damaged, shrinkage, cut-loss); counted in costing |
| `adjustment` | ± store | Stock-take correction — **always** a `stock_adjustment` approval |

- Validation: store balance may not go negative; a lot's issued balance
  (`issued − returned − transferred_out − wastage`) may not go negative.
- Movement numbers per FY via the counter pattern, e.g. `GRN12/26-27`.
- `GET /stock/balances?category=&q=&lot_id=` — aggregation, **not** loading all
  movements; indexes on `(item_id, date)` and `(lot_id, item_id)`.
- `GET /stock/ledger/{item_id}` running balance (both units), paginated.
- `GET /stock/lot/{lot_id}` — materials issued/returned/wasted vs requirement.
- Low-stock: balance ≤ `reorder_level` -> appears on dashboard + email report.
- Corrections to a posted movement are **reversal + new entry**, never edits.

### UI

- `/stock` page with tabs: *Balances* · *Movements* · *Items* · *Suppliers*.
- Quick-entry dialog per movement type; for dual-unit items it shows both fields
  side by side with the live ratio and tolerance warning.
- Item detail drawer: ledger, per-lot usage, supplier history.
- Mobile-friendly issue screen (storekeeper on a phone): pick lot -> pick item ->
  qty (and weight) -> save.

## 2. Lot requirements and automatic PO

Add to the lot (lot form gets a **Requirements** tab):

```
requirements: [ { item_id, item_name, uom, basis: "per_piece" | "total",
                  qty_per_piece | total_qty, size_factors?: {size: factor} } ]
post_pct: 3                 # owner's "post %" — see README Q1 (assumed material wastage buffer)
```
(`allowance_pct` from Phase 3 is the owner's "pre %".)

**Gross requirement** per item = `base_qty x (1 + post_pct/100)`, where `base_qty`
is computed from the lot's **planned** pieces (so the pre-% is already inside) —
`per_piece` x planned total, or `total_qty`. Round **up** to the item's purchase
unit for pieces/cones (`ceil`), keep 3 decimals for metres/kg. Keep the formula
in one function `gross_requirement(lot, req)` so the % semantics can change in one
place.

**Auto PO:** on lot creation (and on a "Regenerate" button while the lot has no
issued material) compute `net_to_buy = gross − store_balance_available +
already_on_order_open_PO_lines`; for each item with `net_to_buy > 0` create a
**draft** PO line, grouped by the item's preferred supplier
(`stock_items.preferred_supplier_id`; items without one go into an "Unassigned
supplier" draft). **Auto means auto-drafted, never auto-sent.** Releasing a PO is
a `po_release` approval.

`purchase_orders`:
`{ po_number (PO12/26-27), supplier_id, supplier_name, status: draft|approved|sent|
  partially_received|received|cancelled|closed, lot_id?, lines:[{item_id, item_name,
  uom, qty, qty2?, rate, amount, received_qty, received_qty2}], subtotal, tax?,
  total, expected_date, terms, created_by, approved_by, ... }`

- Endpoints: list/get/update (draft only)/approve/send(mark)/cancel/close,
  `POST /purchase-orders/{id}/receive` -> creates `receipt` movements and updates
  line received qty (partial receipts, over-receipt warning).
- **PO PDF** with the company header (same reportlab style as vouchers; reuse
  `COMPANY`), numbered once, re-printable with the same number
  (`get_voucher_number_for` pattern).
- PO UI: `/purchase-orders` list + editor, "from lot" banner showing which lot
  and requirement produced it.

## 3. Expense bills — service, maintenance, accessories

New page `/expenses` (roles admin, accounts).

`expense_categories`: `{ name, code, active }` — suggest *Service*, *Maintenance*,
*Accessories*, *Other* as empty-state hints only (admin creates them; the owner may
add Electricity, Transport, etc.).

`expenses`:
```
{ voucher_no (EXP12/26-27), date, category_id, category_name (snapshot),
  vendor, bill_no, bill_date, description, amount, gst_amount?, total,
  payment_status: unpaid|paid|partial, paid_amount, payment_mode?, paid_on?,
  lot_id?  (directly attributable -> flows into lot costing),
  machine_ref?  (free text, e.g. "Overlock #3"),
  attachment?, created_by, approval_id? }
```
- Duplicate guard: same `vendor + bill_no` (case-insensitive) -> 400 unless
  `allow_duplicate` with a reason.
- Over threshold (`expense_approval_threshold`, setting) -> `expense_over_limit` approval.
- Attachments (bill photo/PDF ≤ 5 MB, type-checked by content, not extension):
  Render's disk is ephemeral, so store in **MongoDB GridFS**
  (`motor.motor_asyncio.AsyncIOMotorGridFSBucket`, already in motor) — no new
  dependency. Serve through an authenticated endpoint; never a public URL.
- Filters: date range, category, vendor, paid/unpaid, lot; totals row;
  **export to Excel** (same header style as existing exports).
- Reports: monthly spend by category, unpaid bills aging, by lot.
- Costing link: `lot_id` present -> included in the lot's cost; absent ->
  treated as overhead (allocation rule in Phase 5).

## 4. Tests and acceptance

- [ ] Ledger: receipt → issue → return → transfer → wastage leaves exact store and
      lot balances in both units; negative balances rejected; reversal works.
- [ ] Dual-unit: missing second quantity rejected; ratio warning fires.
- [ ] PO: auto-draft math incl. post %, existing stock and open-PO netting;
      partial receipts; PO number stable across reprints.
- [ ] Expense: duplicate guard, GridFS upload/download authz, totals match export.
- [ ] `data_entry` cannot see rates/amounts.
- [ ] Indexes created in `startup`; stock balance endpoint stays fast with 50k movements
      (seed and time it).
- [ ] `reset_all_data` extended to the new collections (but not `audit_logs`).
