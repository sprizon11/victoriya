# Codex build plan — Victoria Unit Flow

> **Status (end of Phase 6):** Phases 1 to 6 are built, tested and committed locally. Advance types (the
> owner's separate "Salary" option) and the Cloudflare move are the only items left from this plan. See
> `docs/QA-REPORT.md` for results and for what was *not* checked.

Start with `/AGENTS.md` (rules, commands, definition of done). Then do the phases
**in order**; each file is self-contained. Do not start a phase until the previous
one is merged and `test_api.py` is green.

| # | File | Delivers | Why this position |
|---|---|---|---|
| 1 | `01-landing-page.md` | Public marketing site + generated imagery | Owner asked for it first; touches only routing + static assets |
| 2 | `02-foundation-audit-approvals-groups.md` | Audit log, approval workflow, operator/operation groups, advance types, lot-form focus bug | Later phases write audit entries and request approvals |
| 3 | `03-lots-rates-quantities.md` | % allowance + half-up rounding, 3 rate types, per-size rates, quantity controller | Changes how earnings are computed — highest risk, do before stock/costing build on it |
| 4 | `04-stock-po-expenses.md` | Stock (dual-unit), requirements -> auto PO, expense bills | Feeds costing |
| 5 | `05-lot-lifecycle-reports-email.md` | Lot closing report, lot costing report, FY rollover, email reports | Needs stock + expenses for real cost figures |
| 6 | `06-dashboard-dna-qa.md` | Dashboard redesign, "Lot DNA" traceability, full behaviour QA | Needs all data sources to exist |

## How the owner's request list maps to files

Owner's notes were written in shorthand. Column 3 is how each line was read; the
**Confidence** column says whether Codex should proceed or ask.

| Owner's note (paraphrased) | Phase | Confidence |
|---|---|---|
| Landing page for Victoria Garments + make its images | 1 | High |
| "110 pieces… 5 percent… round off; 6.49 -> 6, 6.5+ -> 7; add an overall total" = % allowance on ordered qty, half-up rounding per size cell, grand total | 3 | **High** (110 x 1.05 = 115.5 -> 116 fits exactly) |
| "In lists, add a sample piece with 3 types of rates" = three selectable rate types per operation | 3 | **Medium** — names of the 3 types unknown, so they are an admin-editable master |
| "Specific size per piece" rate in the "6th option panel" = per-size piece rate | 3 | **Medium** — which screen is the "6th option panel" is unknown; built into the lot form's rate panel |
| "Quantity controller in the same panel" = per-size caps + over-tolerance with approval | 3 | Medium |
| Grouping in operators; group in operations | 2 | High |
| Admin approval and logs | 2 | High |
| "DNA — need to think an idea" = traceability per lot ("Lot DNA") | 6 | **Low** — it is a proposal; owner must approve the idea |
| Stock management | 4 | High |
| Buy by quantity **and** weight (cones: count + kg) = dual-unit stock, two entries per movement | 4 | High |
| Elastic taken in metres; if there is a problem move it to the next… = metre UoM, issue/return/transfer to next lot with reason | 4 | Medium ("next labels" read as "next lot") |
| Label / sticker / fusing = accessory stock categories | 4 | Medium |
| On lot creation enter requirement + % pre and post -> auto-generate PO | 3 (fields) + 4 (PO) | **Low on the % meaning** — see below |
| Check cursor behaviour in lot creation and "every behaviour" | 2 (known bug) + 6 (full pass) | High |
| Lot closing report + lot costing report | 5 | High |
| New lot each financial year; previous lots must be closed | 5 | High |
| Not-closed/pending lots reported by email; more types of email | 5 | High |
| Advances in types | 2 | Medium (types and recovery rules are placeholders) |
| Service / maintenance / accessories expense bills on a new page | 4 | High |
| Redesign dashboard | 6 | High |

## Open questions for the owner (do not block phases 1-2)

Codex: build to the stated default, isolate the rule in one function/constant,
and list it in your PR so the owner can change it in one line.

1. ~~**"% pre and post"**~~ **ANSWERED:** *pre %* = extra pieces added to the
   order when planning production (110 -> 116 at 5%); *post %* = material wastage
   buffer added when computing PO quantities.
2. ~~**The three rate types**~~ **ANSWERED:** `Sample`, `Regular`, `Rework`.
   Sample and Rework are paid but do not count toward the lot plan; Regular is
   the default.
3. ~~**"6th option panel"**~~ **ANSWERED:** the rate panel (Operations tab) of the
   lot form.
4. **Advance types (Phase 2) — DEFERRED to a separate task.** The owner wants a
   separate option in the salary side panel (sidebar) for this and will supply a
   reference image. **Do not build advance types in Phase 2.** Skip Section 4 of
   `02-…` and the "Finalise week" item until the image and rules arrive; leave
   the existing Advances page and payroll deduction behaviour untouched.
5. ~~**Which approvals are mandatory**~~ **ANSWERED:** (a) production entry
   edit/delete by non-admins, (b) editing a lot after production started,
   (c) reopening a closed lot, (d) stock adjustments, PO release and large
   expenses. `advance_over_limit` and `fy_carry_forward` were **not** selected:
   ship them **off by default** (settings toggles), not removed.
6. **Email provider (Phase 5) — NOT DECIDED.** Build SMTP support so it works as
   soon as `SMTP_*` env vars are set; app must run fine without them.
7. ~~**Hosting**~~ **ANSWERED: stay on Render for now.** The owner asked about
   moving to Cloudflare; Cloudflare Workers cannot run this FastAPI + MongoDB
   backend directly (options: Pages for the frontend + Cloudflare Containers for
   the Docker backend, or Pages only). That migration is **out of scope** and is
   a separate future task — do not change `Dockerfile`/`render.yaml` hosting.
   Render's free tier still sleeps, so Phase 5 uses the protected cron endpoint;
   the timer can be any free external cron (later possibly a Cloudflare Cron
   Trigger).
8. ~~**Landing page facts**~~ **ANSWERED: use general wording.** Write safe,
   generic copy ("quality garments from Tiruppur") with **no specific claims**:
   no founding year, capacity, certifications, client names, or product lists
   beyond men's wear / women's wear. Keep the address as one `TODO(owner)` field
   (Google: `#4/316-1A…`; app: `317/4b,4c…`); hide sections that need real facts.
9. ~~**Lot DNA**~~ **ANSWERED: yes**, build the traceability page + printable
   sheet and carton tag with QR as described in Phase 6.
10. ~~**Costing method**~~ **ANSWERED:** weighted-average material cost.

**Status: all questions answered except #4 (advance types — separate task, waits
for the owner's reference image) and #6 (email provider — build SMTP-ready, owner
supplies credentials later).**

## Known defects found while reading the code (fix in the phase indicated)

- `LotFormPage.js` — `key={op.operation_id || ...}` on the operation rows changes
  the moment an operation is picked, remounting the row (focus/cursor loss), and
  `toggleOperator` mutates state in place. (Phase 2)
- `PUT /api/lots/{id}` rebuilds `colors` from the form: it can silently drop a
  colour that already has production, or lower a planned qty below what is
  already produced, and it regenerates every `color_id`. (Phase 2/3)
- `get_weekly_payroll_data` groups an operator's lines by operation name and keeps
  the *first* rate seen — wrong as soon as an operation has more than one rate.
  (Phase 3)
- Payroll shows the advance deduction every week but only *records* it when an
  admin clicks Adjust. (Phase 2, "Finalise week")
- Admins have **no screen to review edit requests** — non-admin correction
  requests are submitted and never seen. (Phase 2)
- "Today" is computed with `toISOString()` (UTC) on the Production and Advances
  pages: entries made 00:00–05:30 IST land on yesterday. (Phase 6, trivial to do
  earlier)
- `@app.on_event("startup")` is deprecated; `requirements.txt` is dead weight;
  `public/index.html` title/description still say "Unit Flow". (Phase 1/6)
- Two week-numbering schemes exist (`/weeks/generate` counts from 1 at the chosen
  start date; `get_current_week` falls back to ISO week). Do not change the week
  model as a side effect of any phase.
