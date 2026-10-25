# AGENTS.md — Victoria Unit Flow (Victoria Garments, Tiruppur)

Read this file first, every session. Then read `docs/codex/README.md` for the
build order and open questions, and work through **one phase file at a time**.

## What this product is

Piece-rate production tracking and payroll for a garment unit. Operators are paid
`pieces x rate` per operation; the app stops over-reporting, stops duplicate
entry, and keeps an audit trail so the weekly pay number can be trusted.
It is also being extended with stock, purchase orders, expenses, costing and a
public marketing site. Background reading, in this order:

1. `ANALYSIS.md` — domain model, roles, workflows.
2. `DATA-ACCURACY-BUGS.md` — why numbers were wrong. All fixed; the *reasoning*
   is the contract. Do not undo any of it.
3. `README-LOCAL.md` / `DEPLOY.md` — running and deploying.

## Stack and layout

| Part | Tech | Where |
|---|---|---|
| API | FastAPI, Motor (async MongoDB), PyJWT cookies, bcrypt, openpyxl, reportlab | `backend/server.py` (single ~2,180-line file) |
| UI | React 19, CRA + craco, Tailwind, shadcn-style components, recharts, sonner toasts | `frontend/src` |
| Deploy | One Docker image: FastAPI serves the React build. Render + MongoDB Atlas | `Dockerfile`, `render.yaml` |

Money/data conventions you must keep:

- IDs are Mongo `ObjectId` serialised as `id`. Use `serialize_doc()`.
- Auth: HttpOnly cookies. Every route starts with `get_current_user`, then
  `check_role([...])`, then `check_permission(user, flag)` where relevant.
- Numbering is financial-year scoped (April–March): `get_fy_suffix()`
  -> `LOT1/26-27`, `PV1/26-27`. Counters are atomic `find_one_and_update` + `$inc`.
  New document numbers (PO, GRN, expense voucher) must use the same pattern.
- **Snapshot rule:** rates, operator names, operation names are *copied* onto
  production entries. Editing a master record must never change what was already
  paid. Keep copying; never replace with joins.
- Dates are `YYYY-MM-DD` strings; timestamps are ISO-8601 UTC strings.

## Commands (Windows, PowerShell)

```powershell
# one-time (already done on this machine)
.\setup-local.bat

# API  -> http://localhost:8000   (docs at /docs)
.\start-backend.bat
# UI   -> http://localhost:3000   login: admin@example.com / admin123
.\start-frontend.bat

# regression suite — needs the API running on :8000. Baseline: 90 passed, 0 failed.
backend\.venv\Scripts\python.exe backend\test_api.py

# production build check (must say "Compiled successfully")
cd frontend; npm run build
```

MongoDB runs as the Windows service `MongoDB` on `localhost:27017`.
`requests` is needed by `test_api.py` but is not in `requirements-local.txt` —
add it to a `requirements-dev.txt`, do not add it to the runtime file.

## Non-negotiable rules

1. **Do not change payroll arithmetic semantics** except where a phase file says
   so. The controls to protect: over-production guard (`assert_within_plan`, used
   by create **and** edit **and** edit-request approval), duplicate key
   (week + lot + operation + colour + operator + **date**), FIFO advance ledger,
   stable voucher numbers (`get_voucher_number_for`), net pay =
   `get_weekly_payroll_full` for **every** consumer (screen, Excel, PDF, voucher).
2. **Money in, rounded once.** Accumulate raw values, `round(x, 2)` at the end.
   Piece quantities are integers. Rounding of *quantities* uses half-up
   (see `docs/codex/03-lots-rates-quantities.md`) — **never Python's `round()`
   for quantities** (banker's rounding: `round(6.5) == 6`).
3. **Never hard-delete financial or production history.** Block or archive.
   `reset_all_data` is the only wipe path and must be extended to include new
   collections *except* `audit_logs`.
4. **Secrets only in environment variables** (`SMTP_*`, `CRON_TOKEN`, etc.),
   never in Mongo, never in git, never echoed in logs or API responses.
   `backend/.env` is gitignored — keep it that way. Add every new variable to
   `backend/.env.example` and `render.yaml` (`sync: false` for secrets).
5. **Every new runtime dependency** goes in `backend/requirements-local.txt`
   (that is what the Dockerfile installs) and, for the UI, `frontend/package.json`
   with an exact version. Prefer the standard library; justify each addition in
   the PR description. The Docker build must still pass.
6. **Unauthenticated endpoints** (landing-page enquiry only) need rate limiting,
   a honeypot, strict length limits and no HTML stored or rendered. Everything
   else stays behind `get_current_user`.
7. **No fabricated business facts.** Do not invent years, client names, machine
   counts, certifications, awards, export countries, testimonials, or product
   lines for Victoria Garments. Unknowns go in the content config as
   `TODO(owner)` placeholders — see `docs/codex/01-landing-page.md`.
8. **Back-compat.** The production database already has lots/entries in the old
   shape once the owner starts using it. Every schema change must read old
   documents (use `.get()` with defaults) — no migration may be required to boot.
   If a one-off migration is unavoidable, write it as an idempotent script in
   `backend/migrations/` and document it in the phase file.

## Code style — match what is there

- Backend: add routes in `server.py` under the existing `# ===== SECTION =====`
  banners. It is acceptable to start a new module (`backend/<feature>.py` with an
  `APIRouter`) for a large feature (stock, expenses, email) and `include_router`
  it — `server.py` is already too big. Share `db`, `get_current_user`,
  `check_role`, `serialize_doc` via a small `backend/core.py` extracted *first*,
  in its own commit, with the suite still green.
- Frontend: pages in `src/pages/*Page.js`, shared UI from `components/ui/*` and
  `components/ui/primitives.jsx` (`PageHeader`, `Panel`, `StatCard`, `Pill`,
  `EmptyState`, `Meter`, `SkeletonRows`). Reuse them. Tailwind tokens
  (`brand`, `leaf`, `--radius`) are defined in `index.css` / `tailwind.config.js`.
  Every interactive element gets a `data-testid`.
- Comments explain **why** (as the existing code does), not what.
- Don't reformat files you are not changing. Keep diffs reviewable.

## Definition of done (every phase)

- [ ] `test_api.py` passes, **plus new assertions** for every new rule/endpoint
      (add to that file or a sibling `test_<feature>.py` in the same style).
- [ ] `npm run build` -> "Compiled successfully", no new ESLint warnings.
- [ ] Manually exercised in the browser at 1440px **and** 390px width
      (floor supervisors use phones), keyboard-only for forms.
- [ ] Old data still loads (open a lot created before your change).
- [ ] Role check: `data_entry` and `accounts` see/can do only what they should.
- [ ] Every mutating route writes an audit-log entry (once Phase 2 lands).
- [ ] Docs updated (`README-LOCAL.md` env vars, `ANALYSIS.md` model table).
- [ ] One commit per logical step; message says what and why. Never commit
      `frontend/package-lock.json` churn that is not from a deliberate dependency
      change (a local `npm install` currently rewrites it).

## When you are unsure

Do not guess business rules. Each phase file lists its **Assumptions**; build to
them, keep the rule in one named function/constant so it is a one-line change,
and list what you assumed in your PR description. If an assumption affects money
(rates, deductions, rounding, costing) stop and ask instead.
