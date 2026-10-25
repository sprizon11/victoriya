# Phase 2 — Foundation: audit log, approvals, groups, advance types, lot-form fixes

Everything in later phases writes audit entries and asks for approvals, so build
the plumbing once, here.

**Order inside this phase** (separate commits, suite green after each):
0. Extract `backend/core.py` (db, auth helpers, `serialize_doc`, counters) — no behaviour change.
1. Lot-form bug fixes (Section 5).
2. Audit log.
3. Approvals.
4. Operator + operation groups.
5. ~~Advance types and "Finalise week"~~ — deferred (Section 4).

## 1. Audit log (central, append-only)

Collection `audit_logs`:

```
{ at, user_id, user_name, role, ip, action,          # e.g. "lot.create", "production.edit"
  entity_type, entity_id, entity_label,              # "lot", "<id>", "LOT3/26-27"
  summary,                                           # one human sentence
  before, after,                                     # changed fields only, never password hashes
  approval_id?, request_id }
```

- Helper `await audit(request, user, action, entity_type, entity_id, *, label="", summary="", before=None, after=None)`.
  Call it explicitly in **every** POST/PUT/DELETE route (grep `@api_router.(post|put|delete)`
  in `server.py` — there are 41) and for login success/failure/lockout and logout.
- Strip secrets before writing: `password`, `password_hash`, tokens, `new_password`.
- **Append-only:** no update/delete routes. `reset_all_data` must exclude
  `audit_logs`, and must itself write an audit entry first.
- Index: `(at desc)`, `(entity_type, entity_id)`, `(user_id)`, `(action)`.
- `GET /api/audit-logs?user=&action=&entity_type=&entity_id=&date_from=&date_to=&q=&page=&page_size=`
  — **paginated server-side** (the codebase's `.to_list(10000)` pattern is not
  acceptable for a table that only grows). Admin only.
- `GET /api/audit-logs/export` -> CSV (admin).
- UI: `/audit` page (admin): filters, diff viewer (before/after side-by-side),
  entity deep-links (lot -> `/lots/:id`), keeps the existing look. Add "Activity
  log" under *System* in `Layout.js`.
- Keep the existing per-document `edit_history[]`; the central log is additive.

## 2. Approvals (maker-checker)

Generalise the existing `edit_requests` (production edit only) into `approvals`.
Migrate by **reading both** collections in `GET /approvals` for one release, not
by rewriting data.

**Known gap:** today the only edit-request UI is the *submit* dialog on the
Production page. `GET /edit-requests` and `PUT /edit-requests/{id}` exist, but **no
screen lets an admin review them** — requests currently pile up unseen. The
`/approvals` page below closes that gap; mention it in the PR.

```
{ type, entity_type, entity_id, entity_label, payload,   # what will be applied
  reason, status: pending|approved|rejected|cancelled|expired,
  requested_by, requested_by_name, requested_at,
  reviewed_by, reviewed_by_name, reviewed_at, review_note,
  applied_at, apply_error }
```

Types and defaults (`approval_policies` stored in `system_settings`, editable on
the Settings page). **Owner-confirmed ON by default:** `production_edit`,
`production_delete`, `lot_edit_after_production`, `lot_reopen`,
`stock_adjustment`, `po_release`, `expense_over_limit`. `quantity_override`
and `rate_change` are on whenever their feature is used. **Ship OFF by default
(toggle in Settings):** `advance_over_limit`, `fy_carry_forward`.

| type | Trigger |
|---|---|
| `production_edit` | non-admin edits an entry (exists today) |
| `production_delete` | non-admin deletes an entry |
| `quantity_override` | entry would exceed plan but is inside the lot's over-tolerance (Phase 3) |
| `lot_reopen` | any reopen (reason already mandatory) — **admin self-approval allowed** |
| `lot_edit_after_production` | changing colours/sizes/rates/operations on a lot that has entries |
| `rate_change` | rate edited on a lot that has entries (affects future entries only; record it) |
| `advance_over_limit` | advance > per-type `max_amount` or > N x operator's weekly average |
| `stock_adjustment` | manual stock correction (Phase 4) |
| `po_release` | PO moves draft -> approved (Phase 4) |
| `expense_over_limit` | expense above a threshold (Phase 4) |
| `fy_carry_forward` | year-end rollover creates carry-forward lots (Phase 5) |

Rules:

- **Who approves:** admin. A request raised by an admin is auto-approved *and
  logged* unless the setting `require_second_approver` is on (default **off**:
  the unit has one admin). An approval can never be self-approved by a non-admin.
- Approving **applies the change server-side** by re-running the normal
  validation (e.g. `assert_within_plan`, recomputing money) — never by `$set`ting
  a client payload. This is the exact bug fixed in `review_edit_request`; keep
  its style. Store `apply_error` if applying fails and leave the request pending.
- Idempotent: approving twice is a no-op; stale requests (entity changed since)
  are flagged `expired` with a message.
- Every state change writes an audit entry and a `notifications` row to the
  requester and to admins.
- `GET /approvals?status=&type=&mine=`, `POST /approvals/{id}/approve|reject|cancel`.
- UI: `/approvals` page with tabs *Pending / Mine / History*, side-by-side
  current vs proposed values, approve/reject with note. Pending count badge in
  the sidebar (poll like notifications every 30 s). The "Request edit" dialog on
  the Production page keeps working (now creates a `production_edit` approval).

## 3. Operator groups and operation groups

Collections: `operator_groups`, `operation_groups`
`{ name, code, description, sort_order, active, created_at }`
(`operator_groups` may add `supervisor_operator_id`).

- `operators.group_id` (+ denormalised `group_name`), `operations.group_id`
  (+ `group_name`), both optional.
- CRUD routes under `/operator-groups`, `/operation-groups` (admin), with
  duplicate-name check (case-insensitive) and "cannot delete a group in use".
- Operators page: group column + filter + bulk "assign to group".
  Operations page: same. Seed suggested operation groups **only as examples in
  the empty-state hint**, not in the DB: Cutting, Stitching, Finishing, Packing.
- Lot form assignment tab: "Add whole group" button per operation, and group
  filter chips. The lot still stores individual operators (snapshot rule).
- Operation groups order the lot-form operation list and production-entry
  dropdown (group headers). Reports and the dashboard get **subtotals by group**
  (add `group_name` onto production entries at write time — snapshot — default
  `""` for old entries).
- Renaming a group does not rewrite history.

## 4. Advance types — **DEFERRED, do not build in this phase**

The owner wants advance types as a **separate option in the salary side panel**
and will provide a reference image; the recovery rules are not decided. Skip this
whole section (including "Finalise week") until that arrives as its own task. The
text below is the earlier draft, kept only as background.

Master `advance_types`:
`{ name, code, recovery_mode: full_next_pay | fixed_per_week | percent_of_earnings | manual,
   default_installment, percent, max_amount, requires_approval_above, active }`.
Defaults to propose (editable): *Salary advance* (full next pay), *Festival*
(fixed per week), *Medical/Emergency* (percent), *Loan* (fixed per week, instalments).

- `advances` gain `type_id`, `type_name`, `recovery_mode`, `installment` (snapshot
  at creation). Old advances = type "Salary advance", `full_next_pay`.
- `get_weekly_payroll_full` computes the planned recovery **per advance** (oldest
  first), capped by `min(outstanding, earnings)`; keep every existing output field
  (`advance_outstanding`, `advance_deducted`, `advance_carried`, `net_salary`) so
  Excel/PDF/voucher keep working, and add `advance_breakdown` per type.
- **Finalise week** (recommended; needs owner's OK — mention in PR): admin action
  `POST /payroll/finalise {week, year}` that records the planned deductions as
  adjustments (`source: "payroll_finalise"`), writes `payroll_runs`
  `{week, year, finalised_by, at, totals}`, is idempotent per (week, year), and
  afterwards blocks edits/deletes to that week's entries unless approved
  (`production_edit` approval). This fixes "deduction shown every week but only
  recorded when someone clicks Adjust". Keep the manual Adjust endpoint.
- Advances page: type select, shows recovery rule, balance/instalment progress,
  per-type filters; `advance_over_limit` approval hook.
- Advance report gets a "by type" subtotal.

## 5. Lot form — cursor/focus and state bugs (known)

File `frontend/src/pages/LotFormPage.js`:

1. Operation rows use `key={op.operation_id || \`op-${oi}\`}` — the key changes the
   instant an operation is selected, remounting the row and dropping focus. Give
   each row a stable client id (`crypto.randomUUID()` assigned in `addOp`, and on
   load) and key on that. Same for the assignment cards.
2. `toggleOperator` mutates `o[oi].operator_ids` in place — return new objects.
3. Quantity grid: Enter/Tab/Arrow navigation between cells like a spreadsheet
   (the page advertises "excel-input"); `Enter` moves down, `Tab` right, arrows
   when the caret is at the edge; select-all on focus; ignore mouse-wheel on
   number inputs; paste a block from Excel into the grid; keep the caret where
   the user typed (controlled inputs must not reformat while typing — store
   strings, parse on save).
4. Show a running row total, column totals and an **overall total** (Phase 3
   defines the rounding); sticky first column and header on small screens.
5. Warn on unsaved changes (`beforeunload` + router blocker) and disable Save
   while saving. Save must not navigate away on a 400; show the server message.
6. Backend `PUT /lots/{id}`: reject removing a colour or lowering a planned qty
   below the quantity already produced for any operation (400 with the exact
   colour/size/produced/new-plan). **Preserve `color_id`** for colours that still
   exist instead of regenerating. Changes after production exist -> goes through
   a `lot_edit_after_production` approval.
7. Add tests for (6).

## 6. Tests and acceptance

- [ ] Audit: every mutating route logs; log cannot be altered; reset keeps it.
- [ ] Approvals: apply path re-validates (try to approve a request that would
      exceed plan -> stays pending with `apply_error`); double-approve is a no-op.
- [ ] Groups: old operators/operations without group still work everywhere.
- [ ] Payroll totals identical for lots/advances created before this phase.
- [ ] Lot form: tab through every field without losing focus; 390px usable.
- [ ] `test_api.py` still 90+ green with new assertions added.
