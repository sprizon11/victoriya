# Phase 6 — Dashboard redesign, Lot DNA, full behaviour QA

## 1. Dashboard redesign

Today (`DashboardPage.js`): four KPI cards, active-lot progress list, bar charts of
output by operation and top earners. After Phases 2–5 there is much more worth
seeing. Keep the brand tokens, `primitives.jsx` components and motion rules; this
is a **layout and information redesign**, not a new design system.

### Information architecture (admin / accounts)

1. **Header strip** — greeting, current week pill, **Financial-year selector**
   (default current FY; drives every widget except "live now").
2. **Needs attention** (new, top, only when non-empty): pending approvals,
   overdue lots, lots from a previous FY not closed (links to the wizard), low
   stock items, unpaid expense bills past due, unreviewed enquiries. Each row is
   a deep link with a count. This is the most valuable block — design it first.
3. **KPI row (6):** Active lots · Week production · Week wages (gross) · Advances
   outstanding · Month expenses · Stock alerts. Each with a delta vs previous
   period and a sparkline (recharts, no axes).
4. **Lot pipeline** — table/cards: lot, style, due date with overdue/at-risk
   chips (at-risk = projected finish after due date from the last 7 days' pace),
   progress meter, slowest operation, labour cost to date vs planned.
5. **Production trend** — daily pieces for the last 14/30 days (toggle), stacked
   by operation group.
6. **By group** — output and wages by operation group; top operators within an
   operator group (group filter).
7. **Money** — wages vs advances vs expenses this month (small multiples, not a
   pie); expense by category.
8. **Stock** — lowest-cover items, issues this week.
9. **Recent activity** — last 10 audit entries (admin only).

**Data entry** role: no financial widgets (existing rule). Show their week's
entries, today's quick-entry shortcut and lots needing output.
**Accounts**: money-centric subset.

### Backend

- Extend `/dashboard/summary` or add `/dashboard/overview?fy=`; return a **single
  payload** per role. Use Mongo aggregation (`$group` by date/operation group) —
  do not fetch 10,000 documents and loop in Python as today. Add the indexes you
  need. Target < 400 ms with 100k production entries (seed and measure; report).
- Money rounded once at the end (see AGENTS rule 2). Respect
  `can_view_financial`.
- Empty states for a brand-new database (the current owner state) must look
  intentional: a short "Set up in this order" checklist (operators -> operations
  -> colours -> size charts -> weeks -> lot), ticking itself off.

### UI quality bar

Skeletons while loading, never layout shift, 1440 / 1024 / 390 px layouts,
keyboard focus order sensible, charts have text alternatives, numbers use
`tabular-nums` and `en-IN` formatting, colour never the only signal (icons/text
on overdue chips).

## 2. "DNA" — Lot DNA (needs owner sign-off; see README Q9)

The owner asked for an idea. Proposal: give every lot a **DNA** — a complete,
tamper-evident life story that answers "what happened to this lot, who touched it,
what did it cost" on one screen and one printed sheet.

**What it is**

- `GET /lots/{id}/dna` merges, in time order: lot creation/edits (audit log),
  approvals, materials in/out (stock), production by day/operation/operator group,
  rate changes, expenses, POs, closure and carry-forward lineage
  (`carried_from_lot_id` chain).
- Page `/lots/:id/dna`: header (lot, style, FY, status, % complete, cost/piece),
  a vertical timeline with filters, three tabs *Timeline · Materials · People*,
  and a **lineage** strip for carried-forward lots.
- **DNA sheet** (PDF, A4) with a QR code that deep-links to the lot's DNA page
  (login required), a 12-character **DNA code** derived from the lot id
  (`base32(sha256(lot_id + secret_salt))[:12]`, shown as `VG-XXXX-XXXX-XXXX`),
  and a short integrity hash of the closure snapshot.
- Printable **bundle/lot tag** at label size (e.g. 100 × 50 mm) with the QR for
  sticking on cartons — this is the practical use on the floor.

**What it is not (yet)**: per-piece or per-bundle scanning, mobile scan-to-enter,
buyer-facing traceability. Mention these as possible Phase 7 and do not build.

QR: generate server-side as an SVG/PNG inside the PDF (reportlab has
`reportlab.graphics.barcode.qr` — **no new dependency**), and in the browser with
a tiny pinned client library only if you cannot avoid it.

If the owner meant something else by "DNA", only this section changes.

## 3. Behaviour QA pass (the owner's "check every behaviour")

Do this last, with the full feature set present. Deliver a written
`docs/QA-REPORT.md`: what was tested, how, what was fixed, what remains.

### Forms and cursor/focus (every screen with an input)

- Focus stays put while typing; no remount on keystroke or on selection of an
  option (the lot-form `key` bug class); no caret jump in controlled inputs
  (numbers, decimals, `5.`, `.5`, empty, negative, paste).
- Tab order logical; Enter submits single-purpose dialogs, never multi-field
  grids by accident; Escape closes dialogs and returns focus to the trigger;
  autofocus where the existing code already does.
- Number inputs: no mouse-wheel change, no accidental spinner, mobile numeric
  keypad (`inputMode`), 16 px font on phones (CSS already forces it).
- Spreadsheet grids (lot quantities, production entry, per-size rates):
  arrow/Tab/Enter navigation, paste from Excel, select-all on focus, live totals,
  sticky headers/first column.
- Dirty-form guard on all long forms; double-submit prevented (button `loading`);
  server error text shown, form state kept.
- Dates: `YYYY-MM-DD` only, timezone-safe. `new Date().toISOString()` is **UTC**,
  and `ProductionEntryPage.js` (lines 34, 61) and `AdvancesPage.js` (28, 43) use it
  for "today": between 00:00 and 05:30 IST that is *yesterday*, so a late-night
  entry lands on the wrong day and the wrong week. Add one local-date helper in
  `lib/utils.js`, use it everywhere, and add a test with a mocked clock.

### Data behaviour

- Re-run the matrix: for each role (admin, accounts, data_entry) x each route:
  can reach / cannot reach, API returns 403 not just hidden menu.
- Concurrency: two browsers saving the same entry, duplicate submit via double
  click, expired token mid-form (refresh interceptor path).
- Large data: seed 100k entries, 200 operators, 50 lots; time every list/report,
  ensure paginated endpoints, no `to_list(10000)` truncation on anything that can
  grow (list them; fix or document).
- Print/PDF/Excel: vouchers, salary sheet, PO, closing and costing reports render
  with Indian number formatting, long names wrap, no clipped columns, same
  numbers as screen.
- Accessibility: axe-core pass on landing, login, dashboard, lot form, production
  entry; fix serious/critical.
- Mobile: 390 px for every page; no horizontal page scroll (tables scroll inside
  their container).
- Security: re-check CORS list, cookie flags in `PUBLIC_MODE`, public endpoint
  abuse, that no new route lacks `get_current_user`, no secret in logs.
- Deployment: `docker build` succeeds with the new requirements; `/api/health`
  green; env vars documented in `render.yaml`; cron endpoint documented.

### Exit criteria

All checklists in phases 1–6 ticked, `test_api.py` + new test files green,
`npm run build` clean, `docs/QA-REPORT.md` committed, `ANALYSIS.md` updated to the
new data model, and a short "What changed for the owner" note at the top of
`README-LOCAL.md`.
