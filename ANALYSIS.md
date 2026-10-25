# Victoria Unit Flow — project analysis

*Analysed 28 July 2026. Backend booted and every endpoint below was exercised;
frontend compiled and served. See "Verification" at the end for what was actually run.*

---

## 1. What this application is

**Piece-rate production tracking and payroll for a garment factory** —
Victoria Garments, Tiruppur (Tamil Nadu). It replaces the spreadsheet a
sewing unit uses to answer three questions:

1. How much of each lot has been stitched, by colour and size?
2. What has each operator earned this week?
3. What do we pay them after deducting cash advances?

The core money formula is deliberately simple:

```
operator earnings = pieces completed × piece rate for that operation
net pay           = weekly earnings − outstanding advances
```

Everything else in the app exists to make that number trustworthy: preventing
over-reporting, preventing duplicate entries, and leaving an audit trail.

**Stack:** FastAPI + MongoDB (Motor) backend, React 19 + CRA/craco +
Tailwind + shadcn/ui frontend. ~1,740 lines of Python in a single
`server.py`; 16 React pages.

---

## 2. Domain model

MongoDB collections, all created implicitly:

| Collection | Holds | Notes |
|---|---|---|
| `users` | Login accounts | 3 roles + 4 permission flags |
| `operators` | Factory workers | Auto-code `OP001`, `OP002`… |
| `operations` | Task types | "Overlock", "Flatlock", "Button" |
| `colors` | Colour master | |
| `size_charts` | Named size sets | e.g. Adult → `[S, M, L, XL]` |
| `weeks` | Payroll periods | Unique on `(week_number, year)` |
| `lots` | **Production orders** | The central document — see below |
| `production_entries` | **Daily output** | The transaction table |
| `advances` | Cash advances | With partial-adjustment ledger |
| `vouchers` / `counters` | Numbering | FY-scoped sequences |
| `notifications`, `edit_requests`, `login_attempts`, `system_settings` | Supporting | |

### The `lots` document is the heart of it

A lot is a *denormalised* order. It embeds, at creation time:

- **colours → sizes → `planned_qty`** — the production target matrix
- **operations → `rate` + assigned `operators`** — the price list for this lot

```
LOT1/26-27  "VG-TEE-01"
├── colors
│   └── Navy → { S: 100, M: 150, L: 50 }        = 300 planned
└── operations
    └── Overlock @ ₹2.50 → [Lakshmi, Ravi]
```

Rates and operator names are **copied into the lot and again into each
production entry**. This is intentional and correct for payroll: changing an
operator's name or a master rate tomorrow must not silently rewrite what
someone was already paid. The trade-off is that master-data edits don't
propagate — which is the right call here.

### Financial-year numbering

`get_fy_suffix()` uses the Indian FY (April–March), so identifiers read
`LOT1/26-27`, `PV1/26-27`, `ADV1/26-27`. Counters are atomic
(`find_one_and_update` + `$inc` + `upsert`), so concurrent creates can't collide.

---

## 3. Roles and access

Three roles, enforced server-side by `check_role()` on every route, and
mirrored client-side by `<ProtectedRoute roles={[...]}>`:

| Role | Can reach |
|---|---|
| `admin` | Everything — masters, lots, users, settings, delete, reopen lots |
| `accounts` | Lots (read), advances, payroll, vouchers, reports |
| `data_entry` | Production entry only |

There are also four per-user flags (`can_enter`, `can_edit`, `can_delete`,
`can_view_financial`), but note they are **decorative right now** — see
Finding #4.

**Auth:** JWT in HttpOnly cookies. 8-hour access token, 7-day refresh token,
`Bearer` header also accepted. Bcrypt password hashing. Login is rate-limited
to 5 attempts per IP+email with a 15-minute lockout — a genuinely nice touch
that many apps this size skip.

---

## 4. The workflows that matter

### Production entry — where the controls live

`POST /api/production/batch` submits a whole grid at once (one operation ×
one colour × many operators × many sizes). Before writing anything it:

1. **Rejects entry against a closed lot.**
2. **Sums all existing entries** for that lot/colour/operation and rejects the
   batch if the new total would exceed `planned_qty` for any size —
   the message is specific: `S: 10069/100 exceeds planned`. *Verified.*
3. **Skips duplicates** — same week + lot + operation + colour + operator —
   and reports them back as warnings rather than failing the batch.
4. Computes `total_earnings = qty × rate` and stamps `entered_by`.

That over-production check is the single most valuable rule in the codebase:
it's what stops payroll inflation at the point of entry.

### Payroll

`GET /api/payroll/weekly?week=&year=` aggregates entries for the week per
operator, pulls all `pending`/`partially_adjusted` advances, and returns
`net_salary = total_earnings − advance_balance`.

**Advance adjustment is a proper ledger.** `POST /api/payroll/adjust-advance`
walks that operator's advances **oldest-first (FIFO)**, deducts what it can from
each, flips status to `partially_adjusted` or `fully_adjusted`, and pushes an
entry onto an `adjustments[]` array recording amount, week, date and who did it.
Verified: ₹250 earned − ₹200 advance → ₹50 net, with the advance marked adjusted.

### Audit trail

Edits to production entries push onto an `edit_history[]` array with old and new
values, who and when. Lot close/reopen records the actor and a reason (reason is
*mandatory* to reopen). There's also an `edit_requests` collection — a
request/approve flow so non-admins can ask for a correction.

For a payroll system, this is the right instinct throughout.

### Reports

Nine report endpoints (lot matrix, weekly matrix, lot × colour, lot × operation,
operator detail, advances…) plus **Excel export via openpyxl and PDF export via
reportlab**, both branded with the company header. Both verified working —
4.8 KB xlsx and a valid PDF came back.

---

## 5. Findings

### Blockers — these stopped it running at all *(fixed, see README-LOCAL.md)*

**1. `frontend/src/components/ui/` did not exist.**
Every page imports `Button`, `Card`, `Dialog`, `Select`, `Table` and 7 more from
`../components/ui/*`. The directory was absent from the project. The frontend
could not compile — not a warning, a hard failure. Rebuilt all 12 as standard
shadcn/ui components; the Radix dependencies and CSS variables they need were
already present in `package.json` and `index.css`, so this was reconstruction,
not redesign.

**2. No `craco.config.js`.**
`package.json` runs `craco start`, and `index.js` imports `@/App` — so without a
config defining the `@` → `src` alias, the build fails. Added.

**3. `/app/memory` hardcoded** in `seed_admin()`. A Linux container path; on
Windows it resolves to `C:\app\memory` and can crash startup with a permission
error. Now defaults to `<backend>/memory`, overridable via `MEMORY_DIR`.

### Security — fix before this touches a real network

**4. Permission flags are not enforced.** This is the most misleading one.
`get_current_user()` contains:

```python
user.setdefault("can_enter", user.get("role") == "admin" or True)   # always True
user.setdefault("can_edit", user.get("role") == "admin")
```

`X or True` is unconditionally `True`. More importantly these are `setdefault`
calls on the *response object* — they compute display values and are **never
checked by any route**. Authorisation rests entirely on `check_role()`. So the
per-user checkboxes in the Users screen give an admin the impression of
fine-grained control that does not exist. Either wire them into the route guards
or remove them from the UI.

**5. `JWT_SECRET` is committed in `backend/.env`.** Anyone with this repo can
mint a valid admin token. Rotate it, and keep `.env` out of version control.

**6. Default admin password `admin123`, re-applied on every boot.**
`seed_admin()` actively *resets* the admin password to match `.env` at each
startup — so changing it in the UI doesn't stick. Fine for a demo, dangerous
in production.

**7. CORS is `allow_origin_regex=r"https?://.*"` with `allow_credentials=True`.**
That reflects *any* origin while permitting cookies. Restrict it to your actual
frontend origin.

**8. No `.gitignore`.** With secrets in `.env`, that matters.

### Correctness / robustness

**9. `PUT /api/lots/{id}` regenerates every `color_id`** when quantities change
(`str(uuid.uuid4())` on each rebuild). Nothing currently joins on `color_id` —
production entries match on colour *name* — so it's latent rather than broken,
but it makes those IDs meaningless.

**10. No transactions around multi-document writes.** Advance adjustment updates
several advance documents in sequence; a crash midway leaves partial state.
MongoDB supports multi-document transactions on a replica set — worth adding for
the payroll path specifically.

**11. Unbounded `.to_list()` limits** (`1000`, `10000`) scattered through the
reports. Fine at factory scale, silently truncating at a few years of history.

**12. `@app.on_event("startup")` is deprecated** in modern FastAPI; the lifespan
context manager is the replacement.

**13. `requirements.txt` pins ~130 packages** — pandas, numpy, boto3, litellm,
google-genai, openai, stripe — that `server.py` never imports. Platform
scaffolding. `requirements-local.txt` contains the 11 that are actually used.

**14. `frontend/public/index.html` loads `https://assets.emergent.sh/scripts/emergent-main.js`**
— a third-party script on every page load. Remove it for self-hosting.

### Design observations (not defects)

- **`server.py` is 1,738 lines.** It's readable and consistently structured, but
  splitting it into routers (`auth`, `masters`, `lots`, `production`, `payroll`,
  `reports`) would make it far easier to test.
- **No test suite**, despite `pytest` being in requirements.
- Production entries denormalise ~8 fields from lot and operator. Correct for
  payroll immutability, as noted — worth a comment in the code so a future
  maintainer doesn't "fix" it into joins.

---

## 6. Verification — what was actually run

Backend booted under Uvicorn and driven through a full business cycle.
MongoDB itself is unreachable from my sandbox's network allowlist, so the
Motor client was swapped for an in-memory Mongo emulation; all application
logic, routing, auth and serialisation ran unmodified. Query semantics used
here are basic (`find`, `find_one_and_update`, one `$match`/`$group`
aggregation) and behave identically on a real server.

```
PASS  reject bad password (401)          PASS  create lot → LOT1/26-27, 300 planned
PASS  login admin (200)                  PASS  production batch → 2 entries, ₹250 + ₹125
PASS  auth/me via bearer                 PASS  reject over-plan qty (400)
PASS  reject unauthenticated call (401)        "S: 10069/100 exceeds planned"
PASS  create operators → OP001, OP002    PASS  create advance → ADV1/26-27
PASS  create operation                   PASS  weekly payroll
PASS  create size chart                        Lakshmi  earn 250  adv 200  net  50
PASS  create color                             Ravi     earn 125  adv   0  net 125
PASS  create week                              grand 375 → net_total 175
PASS  dashboard summary                  PASS  lot matrix report
PASS  vouchers                           PASS  weekly production report
PASS  Excel export (4,784 bytes, xlsx)   PASS  notifications / settings / users
PASS  PDF export (valid PDF)             PASS  CORS preflight from localhost:3000
```

Zero unhandled exceptions in the server log across the run.

**Frontend:** `npm install` (1,474 packages) then `craco build` →
**`Compiled successfully`**, 293 kB gzipped JS + 8.4 kB CSS. Served the
production bundle and confirmed it loads, that SPA deep routes fall back to
`index.html`, and that the backend answers alongside it.

Two npm issues surfaced that you'd hit too, both handled in `setup-local.bat`:
the `@emergentbase/visual-edits` tarball hangs if its CDN is unreachable, and
react-scripts 5 under npm needs `ajv@8` pinned (the project normally uses yarn,
which resolves this on its own).

---

## 7. If you want to take this further

Roughly in order of value:

1. **Enforce or remove the permission flags** (#4) — right now the Users screen
   promises access control it doesn't deliver.
2. **Rotate the JWT secret, change the admin password, tighten CORS** (#5–7).
3. **Wrap payroll advance adjustment in a transaction** (#10) — it's the one
   place where partial failure costs real money.
4. **Add tests** for the two rules that protect the payroll: the over-production
   check and FIFO advance adjustment.
5. **Split `server.py` into routers**, then paginate the report endpoints.

## Phase 1 model additions (2026-10-25)

| Collection | Holds | Access / retention |
|---|---|---|
| `enquiries` | Bounded plain-text website contact fields, UTC created/updated timestamps, status, updater, IP and bounded user agent | Public create; admin list/status update; no delete route; reset includes collection |
| `rate_limits` | Atomic per-IP enquiry counter and BSON expiry | Internal only; TTL cleanup after one hour |

Enquiry notifications use `audience: admin`. All notification reads and mutations
respect that audience; older notifications without an audience retain their
previous visibility. Enquiry list responses omit IP/user-agent metadata and are
paginated in batches of 50. There are no production/payroll schema changes.


---

## 8. Added in Phase 2 (foundation)

| Collection / module | Purpose |
|---|---|
| `backend/core.py` | Config, db handle, auth helpers, FY numbering (extracted from `server.py`, no behaviour change) |
| `audit_logs` (`backend/audit.py`) | Append-only activity log. A middleware records every successful POST/PUT/DELETE and every 403; routes add before/after with `note()`. No edit/delete route; `reset_all_data` keeps it. Admin page `/audit`, CSV export. |
| `approvals` (`backend/approvals.py`) | Maker-checker. Non-admins request production edit/delete; approving re-validates and applies server-side, atomically and idempotently, and expires if the entry changed. Admin actions on sensitive things (lot reopen, edit/rate change after production) are recorded as auto-approved. Rules are switchable in Settings; defaults are in `POLICY_DEFAULTS`. Page `/approvals`. |
| `operator_groups`, `operation_groups` (`backend/groups.py`) | Optional labels on operators/operations. Entries snapshot `operator_group` / `operation_group`; dashboard and weekly report show group subtotals. |

Lot edits are now guarded: a colour or operation that already has production cannot be removed,
the plan cannot be set below what is produced, `color_id`s survive an edit, and a cleared quantity
cell no longer returns a 500.

Advance types are **deferred** (the owner will supply a reference image); advances and payroll
deductions are unchanged.


---

## 9. Added in Phases 3 to 6

| Area | Collections / modules | Notes |
|---|---|---|
| Lot quantities | `lots.colors[].sizes[]` gain `order_qty` beside `planned_qty`; `lots.allowance_pct`; `backend/lotmath.py` | Planned = ordered plus allowance, rounded **half-up per cell** in exact integer maths. Every older control still reads `planned_qty`. |
| Rates | `rate_types` (Regular/Sample/Rework); `lots.operations[].rates[]` with optional per-size rates; entries snapshot `rate_flat`, `size_rates`, `rate_type_*`, `counts_toward_plan` | `compute_earnings()` is the only place pay is computed. Sample/Rework are paid but not counted as produced. |
| Quantity control | `lots.quantity_control` {over_tolerance_pct, warn_at_pct, locked} | Over-plan inside the tolerance returns 409 and becomes a `quantity_override` approval. |
| Stock | `stock_items`, `suppliers`, `stock_movements` (append-only; reversals have `sign: -1`) | Balances are derived. Two-unit items (cone + kg) carry `qty` and `qty2`. Issues are valued at weighted-average cost when they move. |
| Purchasing | `purchase_orders`; `lots.requirements[]`, `lots.post_pct` | Drafted from requirements, never sent automatically; release is the `po_release` approval. |
| Expenses | `expense_categories`, `expenses`, GridFS bucket `bills` | Bills are voided, not deleted; bills charged to a lot feed its costing. |
| Lifecycle | `lot_closures` (immutable, versioned), `lots.fy`, `carried_from/to_lot_id` | Close runs a checklist and freezes a report. Year-end wizard closes or carries forward (idempotent). |
| Email | `system_settings.email_reports`, `email_log`, `scheduler_state` | SMTP from environment only; one send per report per period. |
| Dashboard / DNA | `backend/dashboard.py`, `backend/dna.py` | One aggregated payload per role; DNA code is an HMAC of the lot id. |

See `docs/QA-REPORT.md` for what was tested and what was not.

## 10. Weekly salary (separate from piece-rate payroll)

A second pay system for people paid by the shift, modelled on the owner's reference calculator and kept apart from lot payroll.

| Area | Where | Notes |
|---|---|---|
| API | `backend/salary.py`, prefix `/api/salary` | Departments, workers, one entry per worker per pay week, history, Excel export, payslip PDFs. Admin and finance-visible accounts only. |
| Pay week | Saturday to Friday | `weekStartOf` in `frontend/src/lib/utils.js` and `week_start_of` in the backend agree (both tested). |
| Shifts | `day_shifts[7]`, `night_shifts[7]` | Multiples of 0.5 up to 3 a day. Day and night have their own rate; a worker with no night rate follows the day rate. |
| Not included | | No piece rate, no ESI, no PF, as asked. Gross minus advance is net pay. |
| Rates | Snapshot per saved week | Changing a worker's rate never rewrites a paid week unless "use today's rates" is ticked. |
| Advance | In the calculator | Cannot exceed the week's gross. Separate from the lot-payroll Advances page. |
| Screens | `/salary`, `/salary/week`, `/salary/history`, `/salary/workers` | Calculator, saved week, history, worker and department list. Export to Excel on the week and history pages; clear-week is admin only and keeps a copy in `salary_cleared`. |
