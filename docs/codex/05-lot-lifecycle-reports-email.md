# Phase 5 — Lot closing report, lot costing report, financial-year rollover, email

## 1. Lot costing report

Answers: *what did each piece actually cost us, and what did the lot make?*
`GET /reports/lot-costing/{lot_id}` (+ PDF/Excel via the existing export routes,
+ screen under Reports). Roles: admin, accounts, `can_view_financial`.

Cost components (all from data that already exists after Phases 3–4):

| Component | Source | Notes |
|---|---|---|
| Labour | `production_entries.total_earnings` | Split by operation group, operation, rate type; **non-plan (sample/rework) shown as its own line** |
| Materials | `stock_movements` for the lot | `issue − return − transfer_out + transfer_in` valued at **weighted-average cost** at time of issue (store `rate` on the movement at issue time — snapshot rule) |
| Wastage | `wastage` movements | Shown separately, included in materials cost |
| Direct expenses | `expenses.lot_id = lot` | By category |
| Allocated overhead | expenses with no lot | Allocated across lots **by produced pieces in the expense's month** (rule isolated in `allocate_overhead()`; confirm with owner) |
| **Total cost** | sum | |
| Cost / piece | total ÷ **produced** pieces (min across operations) | Also ÷ planned, and ÷ order |
| Revenue / margin | only if the lot has `order_rate` (optional new field) | Hidden if not set |

Output also: planned vs actual labour per operation (planned = planned qty x rate
card), variance and %, top-5 cost drivers, cost per size if size rates differ.
All money rounded once at the end. A snapshot of the numbers is stored when the
lot is closed (Section 2) so later master-data edits can't change history.

## 2. Lot closing report

On **Close lot** (existing `POST /lots/{id}/close`), after validation, create an
immutable `lot_closures` document and return it:

```
{ lot_id, lot_number, style_name, closed_at, closed_by, reason, fy,
  quantities: { order, planned, produced, balance, excess, by_color_size[], by_operation[] },
  shortages: [...], excess: [...],
  labour: {...}, materials: { required, issued, returned, wasted, balance_on_lot }, 
  expenses: {...}, costing: <section 1 snapshot>,
  non_plan_pieces: {...}, approvals: {pending:n, list:[...]}, open_items:[...] }
```

Pre-close checklist (UI dialog; hard blocks vs warnings):

- **Block:** an unresolved `pending` approval for this lot; stock issued to the
  lot not reconciled (balance ≠ 0 -> must be returned, transferred, or written off
  as wastage, with a reason); entries in a week that is not finalised *if* Phase 2
  "Finalise week" is on.
- **Warn (allow with reason):** produced < planned (shortage); unpaid linked
  expenses; unfinished PO lines for the lot.
- Reopening a closed lot keeps the old closure document (versioned, `version: n`)
  and writes a new one on the next close.
- `GET /lots/{id}/closure` and PDF/Excel of the closing report (company header,
  signature lines for Production Manager / Accounts / Owner).
- Lot page shows a "Closing report" button; Lots list shows closed-on date.

## 3. Financial-year rollover ("new lot each FY, previous lots closed")

FY is April–March (`get_financial_year()`); lot numbers already restart per FY
(`lot_26-27` counter). A lot's FY = FY of its `start_date` (add `fy` field on
create; derive for old lots).

**Year-end wizard** `/lots/year-end` (admin) — also surfaced as a banner from 1
April until it is completed:

1. Lists every non-closed lot from earlier FYs with produced/balance/age.
2. For each, the admin chooses **Close** (runs the Section 2 checklist) or
   **Carry forward balance**: closes the old lot (reason "FY carry-forward") and
   creates a **new lot in the current FY** with the remaining quantities per
   colour/size as its order, same operations/rates/operators/requirements,
   `carried_from_lot_id`, new number `LOTn/<new fy>`. Operators' work already
   paid stays on the old lot. Carry-forward goes through the `fy_carry_forward`
   approval.
3. Stock issued to a carried lot is **transferred** to the new lot (Phase 4
   `transfer`), so material isn't stranded.
4. Idempotent: re-running does not create duplicates (key on `carried_from_lot_id`).
5. Summary screen + audit entries + an email (Section 4).

Nothing is closed or created automatically without an admin action; the system
only **reminds** (dashboard banner, notification, email). The owner's wording
("need to create a new lot… previous lot need to close") is satisfied by the
wizard; do not auto-close production lots unattended.

## 4. Email reports

### Configuration (secrets in env, never in the DB)

`SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, SMTP_STARTTLS=true`
(add to `.env.example`, `render.yaml` with `sync: false`, README-LOCAL, DEPLOY).
Use standard-library `smtplib` in `asyncio.to_thread` — **no new dependency**.
If `SMTP_HOST` is unset, the feature shows "Email not configured" and every other
part of the app works.

Settings page -> **Email reports** (admin): recipients list per report (validated
addresses, max 20), enable toggles, schedule, a "Send test email" button, and a
send history table (`email_log`: at, report, to, status, error).

### Report types ("more types")

| Report | Content | Default schedule |
|---|---|---|
| **Open / pending lots** (the owner's key one) | Active lots past `target_end_date`, lots with progress < 100% from earlier FYs, lots with unfinished PO/approvals; per lot: planned, produced, balance, % done, days overdue, slowest operation | Weekly (Mon 8:00 IST) + on 1 April |
| Weekly payroll summary | Gross, advances, net, top earners (no per-person detail unless enabled) | Weekly after week end |
| Advance outstanding | By operator/type | Weekly |
| Low stock | Items ≤ reorder level | Daily if any |
| Pending approvals | Count + list older than 24 h | Daily if any |
| Expense summary | Month-to-date by category, unpaid bills | Monthly |
| FY rollover reminder | Open lots from last FY | 1, 8, 15 April |
| Website enquiries | New enquiries (Phase 1) | Immediately |

Format: HTML body (inline table, brand colours, plain-text alternative) **plus**
optional PDF and/or Excel attachment reusing the existing reportlab/openpyxl
builders. Per-report format choice. Never email passwords, tokens or full bank
details. Escape every interpolated value.

### Scheduling — mind the hosting

Render's free web service **sleeps**, so an in-process scheduler would silently
miss sends. Implement:

- `POST /api/jobs/run?token=<CRON_TOKEN>` (constant-time compare; token from env
  `CRON_TOKEN`; no user session). It evaluates which reports are due, using
  `scheduler_state` in Mongo (`last_run_at` per report, with a lock document so
  two instances can't both send) and sends them. Safe to call every 15 minutes.
- Point an external cron (Render Cron Job, or cron-job.org) at it. Document it in
  `DEPLOY.md`. Also run the due-check once on startup as a catch-up.
- Optional later: APScheduler if the owner moves to an always-on plan — do not add
  it now.
- Timezone is **Asia/Kolkata** for all schedules (`zoneinfo`, stdlib).

## 5. Tests and acceptance

- [ ] Costing: hand-built lot with known labour, two material issues at different
      rates (weighted average), a direct expense and overhead — total and per-piece
      match a calculator to the paisa.
- [ ] Closing: blocked by pending approval/unreconciled stock; snapshot unchanged
      after editing the item master; reopen -> second closure version.
- [ ] FY: wizard on a lot from last year creates exactly one carry-forward lot;
      stock transferred; second run creates nothing.
- [ ] Email: with a local SMTP sink (e.g. `python -m aiosmtpd` dev-only, or a
      mocked `smtplib.SMTP`) the pending-lots mail renders and logs; with SMTP
      unset the app boots and the UI says so; cron endpoint rejects a bad token
      and two concurrent calls send once.
- [ ] `test_api.py` green; no new runtime dependency.
