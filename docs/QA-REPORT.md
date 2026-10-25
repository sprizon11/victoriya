# QA report — Phases 1 to 6

Written at the end of Phase 6, against the code in this repository. It lists what was
checked, how, what was fixed along the way, and what was **not** checked.

## Automated checks (all green at the time of writing)

Run with the API on `:8000`: `backend\.venv\Scripts\python.exe backend\<file>.py`

| Suite | Checks | What it protects |
|---|---|---|
| `test_lotmath.py` | 38 | Half-up allowance rounding, per-size earnings, rate-card lookup (no server needed) |
| `test_api.py` | 95 | The original payroll controls and every older endpoint |
| `test_enquiries.py` | 48 | Public enquiry form: rate limit, honeypot, length limits, no HTML |
| `test_audit.py` | 17 | Every mutation is logged, secrets never are, the log cannot be edited |
| `test_approvals.py` | 42 | Approvals re-validate, are atomic and idempotent; lot-edit safeguards |
| `test_groups.py` | 26 | Operator and operation groups, history snapshots |
| `test_phase3.py` | 58 | Allowance, rate types, per-size rates, quantity controller, legacy data |
| `test_phase4.py` | 109 | Stock ledger (two units), POs, receiving, expenses, bill files |
| `test_phase5.py` | 67 | Costing, closing report, year-end rollover, email through a local SMTP sink |
| `test_phase6.py` | 43 | Dashboard per role, speed on 40,000 entries, Lot DNA |
| `test_salary.py` | 62 | Weekly salary: day/night shifts, rates kept per saved week, advance cap, no ESI/PF/piece rate, Excel and payslip PDF |
| Frontend (`craco test`) | 22 | `plannedFromOrder` agrees with the server; local-date helper; Saturday-to-Friday pay weeks |
| **Total** | **627** | |

`npm run build` compiles with no warnings.

## Money rules re-verified (the ones that must never regress)

- Over-production guard applies to create, edit, approval-apply **and** the new over-tolerance path.
- Duplicate key is operator + date + lot + operation + colour + **rate type**; legacy entries count as Regular.
- Earnings come from one function. Entries snapshot their rate card, so changing a lot's rates later never
  reprices old entries; entries recorded before per-size rates existed total to the paisa (tested with a
  hand-built legacy document).
- Net pay is unchanged: every consumer still goes through `get_weekly_payroll_full`.
- Sample and rework pieces are paid but never counted as produced; capped and alerted.
- Data-entry users see no rate, rate card, wage, cost or earnings in any payload (checked in `/production`,
  `/lots`, `/lots/{id}`, `/dashboard/overview`).

## Found and fixed during this work

| Finding | Fix |
|---|---|
| Lot form re-created an operation row when an operation was picked, throwing the cursor out of the field | Stable client ids per row |
| `PUT /lots` could drop a colour/operation that had production, lower a plan below what was produced, and regenerated colour ids | Refused with the exact reason; ids preserved |
| A cleared quantity cell on the lot form returned HTTP 500 | Quantities parsed defensively |
| Admins had no screen to review correction requests (requests piled up unseen) | `/approvals` page |
| Data-entry users could not list lots at all (so could not choose one to enter output) | `/lots` allows them, with every money field removed |
| "Today" computed in UTC filed entries made 00:00–05:30 IST under yesterday | `localDate()` used on Production and Advances |
| Payroll kept the **first** rate it saw per operation | Grouped by (operation, rate type), weighted-average rate |
| Reports/payroll silently stopped reading at 10,000 rows | One `MAX_ROWS = 200,000` constant |
| Mouse wheel over a focused number field changed the value | Global guard drops focus first |
| Icon-only buttons and two date fields had no accessible name (13 controls on 7 screens) | `aria-label`s added |
| `serialize_doc` edits a document in place; calling it twice crashed PO approval | Presenters copy first |
| Dev server's `--reload` hangs on Windows while a browser tab holds a connection | Documented; restart by hand |

## Performance

Measured with 40,000 production entries on file (local MongoDB, single process):
dashboard overview **0.53 s**, lots list **0.03 s**. Both are single aggregation-based payloads.

## Layout and behaviour

- All 24 screens were loaded at 390 px: **no horizontal page overflow** on any of them (tables scroll inside
  their container).
- The four Salary screens were checked in the browser at desktop and 375 px (no page overflow; the 7-day shift grid fits a phone without scrolling). Typing a second department name before the first request returned used to join the two; fixed.
- Quantity grids: Enter / arrows / paste from Excel / select-on-focus, caret never reformatted while typing.
- Unsaved-changes warning on the lot form; double-submit prevented by the button's loading state.

## Not checked, or only partly — please read

- **Accessibility:** an automated axe-core scan could not be run (the tool had to download code from a CDN and
  was blocked). Instead a script checked every screen for unnamed buttons, unlabelled inputs, images without
  alt text, duplicate ids and heading counts; everything it found was fixed. **Colour contrast, focus order
  and screen-reader behaviour have not been tested.** Run axe or Lighthouse once on the deployed site.
- **Lighthouse scores for the landing page** were not measured.
- **Real email:** delivery was tested against a local SMTP sink only. No message has gone through Gmail/Zoho.
- **Cron:** the protected `/api/jobs/run` endpoint is tested, but no outside timer has been pointed at the
  deployed app yet.
- **Concurrency:** two simultaneous approvals and overlapping cron calls are tested; two browsers editing the
  same lot form at once are not (last save wins, as before).
- **Docker build and Render deploy** were not run in this session; only `npm run build` and the dev servers.
- **Excel exports of older reports** write names as plain text. New exports neutralise a leading `= + - @`;
  the original salary and lot exports do not.
- **Mobile Safari / real phones** were not used; mobile checks were a 390 px emulated viewport.
- **Multi-user load** beyond the 40,000-entry timing above.

## Deliberately deferred

- Advance types and "Finalise week" (the owner will supply a reference image).
- Moving hosting from Render to Cloudflare (separate task; see `docs/codex/README.md` question 7).
