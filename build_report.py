"""
Generates VICTORIA-PROJECT-REPORT.xlsx - a full account of the engagement:
what arrived, what was broken, what was changed, what was verified, and what
is still outstanding.

    backend\\.venv\\Scripts\\python.exe build_report.py
"""

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

NAVY = "294F96"
NAVY_DK = "1D386B"
LEAF = "00AF92"
GREY = "F1F4F9"
AMBER = "E08700"
ROSE = "D14D72"

H1 = Font(name="Calibri", size=16, bold=True, color=NAVY_DK)
H2 = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
BOLD = Font(name="Calibri", size=10, bold=True)
BODY = Font(name="Calibri", size=10)
SMALL = Font(name="Calibri", size=9, color="666666")
MONO = Font(name="Consolas", size=9)

FILL_HEAD = PatternFill("solid", start_color=NAVY)
FILL_ALT = PatternFill("solid", start_color=GREY)
FILL_CRIT = PatternFill("solid", start_color="FCE4E8")
FILL_HIGH = PatternFill("solid", start_color="FDF0DC")
FILL_OK = PatternFill("solid", start_color="E4F5F0")

TOP = Alignment(vertical="top", wrap_text=True)
TOP_L = Alignment(vertical="top", wrap_text=True, horizontal="left")
CTR = Alignment(vertical="top", horizontal="center", wrap_text=True)

THIN = Side(style="thin", color="D6DDE8")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

wb = Workbook()


def sheet(title, headers, widths, rows, note=None, freeze="A3"):
    ws = wb.create_sheet(title)
    ws.sheet_view.showGridLines = False

    ws.cell(row=1, column=1, value=title).font = H1
    if note:
        ws.cell(row=1, column=max(2, len(headers) - 3), value=note).font = SMALL

    for i, h in enumerate(headers, 1):
        c = ws.cell(row=2, column=i, value=h)
        c.font, c.fill, c.alignment, c.border = H2, FILL_HEAD, CTR, BOX
        ws.column_dimensions[get_column_letter(i)].width = widths[i - 1]

    for r, row in enumerate(rows, 3):
        sev = str(row[2]) if len(row) > 2 else ""
        for i, val in enumerate(row, 1):
            c = ws.cell(row=r, column=i, value=val)
            c.font = BODY
            c.alignment = TOP_L if i > 1 else CTR
            c.border = BOX
            if r % 2 == 0:
                c.fill = FILL_ALT
        if "Critical" in sev:
            ws.cell(row=r, column=3).fill = FILL_CRIT
            ws.cell(row=r, column=3).font = Font(size=10, bold=True, color="A61B3C")
        elif "High" in sev:
            ws.cell(row=r, column=3).fill = FILL_HIGH
            ws.cell(row=r, column=3).font = Font(size=10, bold=True, color="9A5B00")

    ws.freeze_panes = freeze
    ws.auto_filter.ref = f"A2:{get_column_letter(len(headers))}{2 + len(rows)}"
    return ws


# =====================================================================
# 1. SUMMARY
# =====================================================================
ws = wb.active
ws.title = "Summary"
ws.sheet_view.showGridLines = False
ws.column_dimensions["A"].width = 34
ws.column_dimensions["B"].width = 96

ws["A1"] = "Victoria Unit Flow - Engineering Report"
ws["A1"].font = Font(size=18, bold=True, color=NAVY_DK)
ws["A2"] = "Production tracking & piece-rate payroll - Victoria Garments, Tiruppur"
ws["A2"].font = Font(size=11, color="666666")

rows = [
    ("", ""),
    ("ENGAGEMENT", ""),
    ("Starting point",
     "A source-code ZIP exported from the Emergent platform. Code only - it contained no database, "
     "no data dump and no version control history."),
    ("Client situation",
     "The app was already in PRODUCTION use for real payroll. The client reported that it "
     "'does not give accurate data' and had too many bugs."),
    ("Objective",
     "Establish why the numbers were wrong, fix them, remove the dependency on Emergent, "
     "raise the interface to a professional standard, and deploy independently."),
    ("", ""),
    ("HEADLINE FINDING", ""),
    ("The arithmetic was never wrong",
     "Every 'pieces x rate' calculation in the codebase was correct. The numbers were wrong because of "
     "WHAT WAS COUNTED: production silently discarded on save, output counted several times over, and "
     "wage deductions shown on screen but omitted from the printed voucher."),
    ("Most serious defect",
     "Only ONE production entry per operator per week could ever be saved. Every later day of the week was "
     "silently dropped. Operators were paid for roughly one day in six."),
    ("", ""),
    ("OUTCOME", ""),
    ("Defects found and fixed", "23 (14 from the audit, 9 discovered while fixing, testing and deploying)"),
    ("Security issues resolved", "8, including undisclosed third-party session recording"),
    ("Automated test coverage", "95 assertions across every API endpoint - all passing"),
    ("Backend", "backend/server.py - 1,902 lines in, 2,180 out. Edited in place, never rewritten."),
    ("Frontend", "8 screens rebuilt, 8 edited, 8 original files untouched. New shared component kit."),
    ("Deployment", "Live at https://victoriya.onrender.com (Render + MongoDB Atlas). Emergent no longer required."),
    ("", ""),
    ("HOW TO READ THIS WORKBOOK", ""),
    ("Bug Register", "Every defect: what was wrong, the business impact, the root cause, the fix, how it was proven."),
    ("Security Findings", "Issues that were not bugs but exposures - kept separate because they need different action."),
    ("Files Changed", "Exactly which files were created, rewritten, edited or left alone."),
    ("UI and UX Changes", "The design system, motion work and per-screen status."),
    ("Test Coverage", "What the automated suite proves, mapped to the bugs it guards."),
    ("Deployment", "Hosting, configuration and where each secret lives."),
    ("Outstanding Actions", "What is NOT done, ranked. Read this one before anything else."),
    ("", ""),
    ("IMPORTANT CAVEAT", ""),
    ("Lost production cannot be recovered",
     "Entries discarded by the duplicate-key defect were never written to the database. They are absent "
     "from any backup because they never existed. If real payroll ran on this app, workers may have been "
     "underpaid, and the only surviving record is the paper from the factory floor."),
]

r = 4
for label, text in rows:
    a = ws.cell(row=r, column=1, value=label)
    b = ws.cell(row=r, column=2, value=text)
    if label and not text:
        a.font = Font(size=11, bold=True, color="FFFFFF")
        a.fill = PatternFill("solid", start_color=NAVY)
        b.fill = PatternFill("solid", start_color=NAVY)
        ws.row_dimensions[r].height = 20
    else:
        a.font = BOLD
        b.font = BODY
        a.alignment = TOP
        b.alignment = TOP
        if text and len(text) > 130:
            ws.row_dimensions[r].height = 46
        elif text and len(text) > 80:
            ws.row_dimensions[r].height = 32
    r += 1


# =====================================================================
# 2. BUG REGISTER
# =====================================================================
# ID, Area, Severity, Symptom, Business impact, Root cause, Fix, Location, Verified by, Phase
BUGS = [
    ("B01", "Production entry", "Critical",
     "Only the first production entry per operator per week was saved. Later days returned a dismissible "
     "orange 'already has entry' toast and the quantities were discarded.",
     "Operators paid for ~1 day in 6. Under-reported output and underpaid wages, for as long as the app has been live.",
     "The duplicate-detection query keyed on week + lot + operation + colour + operator but OMITTED the date, "
     "even though every entry stores a date and the UI has a date picker.",
     "Added 'date' to the duplicate query, so a duplicate now means the same operator on the same DAY. "
     "Same-day re-submission is still blocked - the check that was actually intended.",
     "create_production_batch()", "Test enters Mon + Tue and asserts BOTH save; a second Tue entry is still rejected.",
     "Audit"),

    ("B02", "Lot progress", "Critical",
     "Lot progress showed impossible figures - a completed 820-piece lot read 390% with a balance of minus 2,384.",
     "Every progress figure in the app was meaningless. Dangerous because a 4-operation lot at 19% real "
     "completion displayed as 76% - plausible enough that nobody would question it in a meeting.",
     "enrich_lot() summed total_quantity across ALL operations and divided by the planned count. Since every "
     "operation is applied to every piece, output was inflated by the number of operations.",
     "Lot output is now the MINIMUM across operations - a piece is only finished once every operation has "
     "covered it. Per-operation figures are returned alongside so the bottleneck is visible.",
     "enrich_lot()", "Test asserts produced = 20 (the minimum), not 47 (the sum), and that progress never exceeds 100%.",
     "Audit"),

    ("B03", "Payroll exports", "Critical",
     "The salary Excel sheet, salary PDF and the printed payment voucher all showed GROSS pay. None mentioned "
     "the advance deduction. The on-screen payroll showed a different figure for the same worker.",
     "Two contradictory numbers for the same wage. If paid from the voucher, the advance was never recovered "
     "and the factory lost money; if paid from the screen, too much was deducted and the worker lost money.",
     "Only the on-screen endpoint joined advances. The three export paths called the raw earnings helper, "
     "which had no advance logic at all.",
     "Created get_weekly_payroll_full() as the single source of truth and pointed all four consumers at it. "
     "The voucher now prints Gross / Less advance / Net payable.",
     "get_weekly_payroll_full(), export_excel(), export_pdf()",
     "Test opens the generated .xlsx and asserts the words 'advance' and 'net payable' are present.",
     "Audit"),

    ("B04", "Payroll", "Critical",
     "The full outstanding advance was deducted from a single week's earnings, producing negative wages "
     "(one operator: earned Rs.170, advance Rs.2,000, net MINUS Rs.1,830). The same debt reappeared every week.",
     "Negative wages on the salary sheet, and the same advance shown as deductible in consecutive weeks - "
     "a straightforward route to deducting the same money twice.",
     "The payroll endpoint subtracted the entire outstanding balance with no cap, and nothing linked a "
     "deduction to a week.",
     "Deduction is now capped at what the operator actually earned that week. Anything unrecovered is "
     "reported separately as 'advance carried forward'.",
     "get_weekly_payroll_full()", "Test creates a Rs.100,000 advance against small earnings and asserts net pay is never negative.",
     "Audit"),

    ("B05", "Production entry", "High",
     "Editing an existing entry bypassed the over-production check entirely. A 100-piece entry could be "
     "edited to 10,000.",
     "The app's single most important control was optional - reachable by editing instead of adding.",
     "The over-plan validation lived inline inside the batch-create route. The edit route never called it.",
     "Extracted the check into assert_within_plan() and called it from BOTH routes. The edited entry is "
     "excluded from the existing totals so an edit is measured against its replacement.",
     "assert_within_plan(), edit_production()", "Test attempts an over-plan edit and asserts HTTP 400.", "Audit"),

    ("B06", "Edit requests", "High",
     "A non-admin could request a correction and an admin could approve it, but the quantity never changed. "
     "Both parties believed the correction had been applied.",
     "Silent data-integrity failure. Known-wrong figures stayed in payroll while everyone believed they were fixed.",
     "The frontend posted only {entry_type, entry_id, reason} - never the proposed quantities. The backend "
     "required proposed_changes to be present before applying anything, so approval was a no-op.",
     "Frontend now sends the corrected quantities. Backend validates them, re-runs the plan check, recomputes "
     "wages and writes an audit entry. Approving an empty request is now refused rather than silently ignored.",
     "review_edit_request(), ProductionEntryPage.js",
     "Test creates a request, approves it, and asserts the entry quantity actually changed.", "Audit"),

    ("B07", "Production entry", "Medium",
     "A size entered as 0 by mistake could never be corrected through the interface.",
     "The only remedy was to delete and re-key the entry, losing its audit history.",
     "Zero-quantity sizes are stripped when saving, and the edit dialog only rendered sizes already present "
     "in the stored document - so a size at 0 was invisible and unreachable.",
     "The edit dialog now renders every size on the lot, including those currently at zero.",
     "ProductionEntryPage.js", "Manual - dialog renders the full size set from the lot.", "Audit"),

    ("B08", "Advances", "High",
     "Selecting a specific advance voucher to adjust had no effect - a different voucher was adjusted instead.",
     "Accounts staff could not control which advance was being settled. The ledger did not match intent.",
     "The route looked up the supplied advance_id, then discarded it and re-queried all of the operator's "
     "open advances oldest-first.",
     "The selected voucher is now cleared FIRST, with any remainder falling through to the others "
     "oldest-first (correct accounting order). Added validation that the amount is > 0 and within the balance.",
     "payroll_adjust_advance()", "Test adjusts a chosen voucher and asserts THAT one was reduced and the other untouched.",
     "Audit"),

    ("B09", "Vouchers", "High",
     "Voucher numbers were consumed on every print. Previewing twice burned two numbers; reprinting a lost "
     "voucher issued a different number.",
     "Broken audit sequence on a numbered financial document, with permanent gaps.",
     "The PDF handler called get_next_voucher_number(), which increments a counter, on every single render.",
     "Numbers are allocated once per operator per week, stored in a 'vouchers' collection with a unique "
     "index, and re-read on reprint.",
     "get_voucher_number_for()", "Test generates the same voucher twice and asserts identical output.", "Audit"),

    ("B10", "Reports", "High",
     "Excel export of a lot report returned HTTP 500 for any lot that had production against it.",
     "A core report was completely unusable. It only worked on empty lots, which is why it went unnoticed.",
     "The code read e['size'], but production entries store 'size_quantities' (a dictionary) and have no "
     "'size' key at all - raising KeyError.",
     "Iterates size_quantities properly, emitting one row per size.",
     "export_excel()", "Test exports a lot WITH entries and asserts HTTP 200 plus non-trivial content.", "Audit"),

    ("B11", "Reports", "High",
     "Even after fixing B10 the same export still returned HTTP 500 - a SECOND, independent cause.",
     "Same as B10. Would have looked like an incomplete fix.",
     "The worksheet title was set from the lot number (e.g. 'LOT1/26-27'). Excel forbids : \\ / ? * [ ] in "
     "sheet names, so openpyxl raised ValueError. Every lot number contains a slash.",
     "Added a sheet_title() helper that strips forbidden characters and truncates to Excel's 31-char limit.",
     "export_excel()", "Same test as B10 - it only passed once BOTH causes were fixed.", "Found while fixing"),

    ("B12", "Dashboard", "Medium",
     "The dashboard could report zero production for a week that had plenty.",
     "Management sees an empty dashboard and assumes nothing was produced.",
     "get_current_week() falls back to ISO week numbering when no week record covers today, but the app's own "
     "weeks are numbered sequentially from a chosen start date. The two schemes disagree, so the dashboard "
     "queried a week number no entry carried.",
     "Documented and mitigated. The generator and fallback are reconciled, but the underlying two-scheme "
     "design needs a client decision - see Outstanding Actions.",
     "get_current_week(), generate_weeks()", "Partially covered - full fix deferred pending a business decision.",
     "Audit"),

    ("B13", "Lots", "High",
     "Deleting a lot also deleted all its production entries.",
     "Silently rewrote payroll history. Advances stayed adjusted against earnings that no longer existed, so "
     "re-running a past week no longer matched what was actually paid.",
     "delete_lot() called delete_many() on production_entries with no guard, unlike delete_week() which "
     "already refused in the same situation.",
     "Deletion is now refused while entries exist, with a message explaining why and suggesting closing "
     "the lot instead. Also now honours the can_delete permission.",
     "delete_lot()", "Test attempts deletion with entries present and asserts HTTP 400 plus an explanatory message.",
     "Audit"),

    ("B14", "Advances", "Medium",
     "A negative adjustment amount INCREASED the outstanding balance and wrote a bogus ledger entry.",
     "The advance ledger could be inflated, and the audit trail falsified, through normal UI input.",
     "No validation that the amount was greater than zero.",
     "Both adjustment routes now reject amounts <= 0. Advance creation rejects non-positive amounts too.",
     "adjust_advance(), payroll_adjust_advance(), create_advance()",
     "Test asserts zero and over-balance adjustments are both rejected.", "Audit"),

    ("B15", "Dashboard / Reports", "Low",
     "Money rendered as 1234.5600000000002 on the dashboard and weekly report.",
     "Cosmetic, but corrosive: a client already doubting the figures reads it as another defect.",
     "Each entry was rounded and then accumulated, so floating-point error crept into the running total.",
     "Accumulate first, round once at the end.",
     "get_dashboard(), report_weekly_production()",
     "Test asserts every monetary value equals its own 2-decimal rounding.", "Audit"),

    ("B16", "Security / data integrity", "Critical",
     "Approving an edit request wrote the client's raw JSON payload straight into a payroll record.",
     "A non-admin could craft a request setting total_earnings, rate or operator_id to anything; an admin "
     "approving in good faith would commit it.",
     "review_edit_request() performed $set with er['proposed_changes'] unfiltered.",
     "Only size_quantities is accepted. Quantities are validated as non-negative integers, the plan check is "
     "re-run, and wages are recomputed server-side from the stored rate.",
     "review_edit_request()", "Covered by the B06 test plus explicit negative-quantity rejection.", "Audit"),

    ("B17", "UI", "Medium",
     "The page-transition animation never ran.",
     "The interface felt abrupt; the intended polish was absent.",
     "Layout.js applied the class 'animate-fade-in', which was never defined in the Tailwind config.",
     "Defined a full motion layer in CSS with the keyframes the app references.",
     "tailwind.config.js, index.css", "Verified the compiled CSS bundle contains the keyframes.", "Found while fixing"),

    ("B18", "UI", "High",
     "The login card was invisible - the background image showed straight through where the panel should be.",
     "The login screen looked broken.",
     "Used the Tailwind class 'bg-white/97'. 97 is not on Tailwind's opacity scale (it stops at 95), so no "
     "CSS was generated and the element had no background at all.",
     "Replaced with a valid value; confirmed the computed background in the live DOM.",
     "LoginPage.js", "Browser DOM check: background-color reports rgb(255,255,255).", "Found while fixing"),

    ("B19", "Branding", "High",
     "The logo rendered tiny in every location and looked broken.",
     "Client-visible branding defect on every screen.",
     "The supplied artwork is a 1394x711 canvas containing a 958x199 logo - about 62% of the file is empty "
     "white margin. CSS object-contain was scaling the padding, not the logo.",
     "Auto-trimmed the artwork to its actual content and repointed all references. No colours altered.",
     "frontend/public/, 7 source files", "DOM check: renders 212x44, matching the source 4.81:1 aspect ratio.",
     "Found while fixing"),

    ("B20", "UI", "Medium",
     "Six pages had a squashed, misaligned header after a bulk edit.",
     "Visibly inconsistent layout across the master-data screens.",
     "A scripted migration inserted the new PageHeader component inside an existing flex row that also held "
     "action buttons, so the header could not lay itself out. On one page it also mismatched a closing tag.",
     "Moved the buttons into PageHeader's own actions slot and repaired the broken markup.",
     "6 page files", "Production build compiles clean; headers verified consistent.", "Self-inflicted, fixed"),

    ("B21", "Deployment", "High",
     "On first deploy one of the two server workers crashed at startup with DuplicateKeyError, and the "
     "service ran at half capacity.",
     "Reduced throughput and an alarming traceback in the production log on every restart.",
     "seed_admin() did check-then-insert. With two workers both checked simultaneously, both saw no admin, "
     "both inserted - and the unique index on email killed the loser. Invisible locally, where only one "
     "worker ever ran.",
     "seed_admin() now catches DuplicateKeyError and treats it as 'another worker won the race'.",
     "seed_admin()", "Clean local startup; full suite re-run at 95/95.", "Found at deploy"),

    ("B22", "Deployment", "Medium",
     "The same startup race would have written duplicate settings rows.",
     "Configuration silently duplicated on every multi-worker boot.",
     "seed_settings() used check-then-insert, and system_settings has no unique index to catch it - so it "
     "would not even error, just quietly duplicate.",
     "Replaced with an idempotent upsert using $setOnInsert.",
     "seed_settings()", "Clean local startup.", "Found at deploy"),

    ("B23", "Deployment", "Medium",
     "The container hardcoded 2 web workers.",
     "Two workers oversubscribed a 0.1-CPU instance and doubled memory use for no throughput gain - "
     "significant on a 512 MB free plan.",
     "Dockerfile CMD had --workers 2 regardless of the host's actual capacity.",
     "Now follows WEB_CONCURRENCY, which the platform sets from available CPUs, defaulting to 1.",
     "Dockerfile", "Deployed and confirmed against Render's reported concurrency.", "Found at deploy"),
]

sheet("Bug Register",
      ["ID", "Area", "Severity", "Symptom", "Business impact", "Root cause", "Fix applied",
       "Location", "Verified by", "Discovered"],
      [6, 18, 10, 44, 44, 46, 46, 26, 40, 16],
      BUGS,
      note="23 defects. Severity reflects consequence for wages and records, not effort to fix.")


# =====================================================================
# 3. SECURITY FINDINGS
# =====================================================================
SEC = [
    ("S01", "Privacy", "Critical",
     "The app loaded a PostHog analytics tracker with SESSION RECORDING enabled and a hardcoded API key, "
     "sending data to a project the client does not control.",
     "Keystrokes and screen contents from a payroll application - worker names, wage amounts, advances - "
     "were being transmitted to a third party. A privacy exposure, not a bug.",
     "Removed entirely from frontend/public/index.html.", "Resolved"),

    ("S02", "Supply chain", "High",
     "index.html loaded a script from assets.emergent.sh on every page view.",
     "Third-party code executing in an authenticated payroll session, plus a hard dependency on a vendor "
     "the client is leaving.",
     "Removed. Also removed the @emergentbase/visual-edits dependency, which installed from the same private CDN.",
     "Resolved"),

    ("S03", "Credentials", "Critical",
     "JWT_SECRET was a shared development value committed in plain text ('a1b2c3d4e5f6...').",
     "Anyone holding the source could forge a valid admin token for the live deployment.",
     "Production generates a fresh random secret. The known value is now on an explicit blocklist, and the "
     "app REFUSES TO BOOT in public mode if it is used.",
     "Resolved"),

    ("S04", "Credentials", "High",
     "Default admin password 'admin123', and the app reset the admin password to match .env on every restart.",
     "A password changed through the UI silently reverted on the next deploy.",
     "Reset is now opt-in via ADMIN_PASSWORD_RESET. Weak passwords are rejected at boot in public mode.",
     "Resolved"),

    ("S05", "Credentials", "High",
     "The app wrote the admin password in plain text to backend/memory/test_credentials.md on every boot.",
     "A readable credentials file on disk, and a candidate for accidental commit.",
     "Restricted to local development only; never written in public mode. Excluded via .gitignore - verified "
     "absent from the public GitHub repository.",
     "Resolved"),

    ("S06", "Access control", "High",
     "Per-user permission checkboxes (can_edit, can_delete, can_view_financial) were displayed in the UI but "
     "never read by any route.",
     "Unticking a permission had no effect. Every user effectively held every permission.",
     "Added check_permission() and applied it across the financial and destructive routes. Enforcement is "
     "server-side, so it cannot be bypassed by URL.",
     "Resolved"),

    ("S07", "CORS", "Medium",
     "CORS_ORIGINS was set to '*' while the API uses credentialed cookies.",
     "A wildcard origin combined with cookie credentials allows any website to act as a logged-in user.",
     "Wildcards are rejected. Production runs same-origin only; local development lists the dev server explicitly.",
     "Resolved"),

    ("S08", "Availability", "Medium",
     "All logo and background artwork was hot-linked from Emergent's CDN.",
     "The client's own branding depended on the platform they were leaving - including on printed vouchers "
     "and reports.",
     "Downloaded and self-hosted (~700 KB). Favicon and PWA icons generated from the mark.",
     "Resolved"),

    ("S09", "Database access", "High",
     "The MongoDB Atlas user was created with the atlasAdmin role on All Resources, and the cluster also "
     "hosts an unrelated project's database.",
     "If the connection string leaked, it could read or drop every database on the cluster - including the "
     "other project.",
     "Scoping to readWrite on victoria_unit_flow only was recommended and walked through.",
     "Client action - see Outstanding"),

    ("S10", "Credentials", "High",
     "The database password was exposed twice during setup - once by terminal echo, once in a screenshot of "
     "Render's environment page with values revealed.",
     "A live production credential recorded outside the client's control.",
     "The helper script was switched from input() to getpass() so nothing echoes. Rotation was advised.",
     "Client action - see Outstanding"),
]

sheet("Security Findings",
      ["ID", "Category", "Severity", "Finding", "Why it matters", "Action taken", "Status"],
      [6, 18, 10, 60, 58, 58, 22],
      SEC,
      note="Exposures rather than defects - listed separately because they need different remediation.")


# =====================================================================
# 4. FILES CHANGED
# =====================================================================
FILES = [
    ("backend/server.py", "Backend", "Edited in place", "1,902 -> 2,180",
     "Targeted edits to individual functions. Routing, Pydantic models, auth flow and the denormalisation "
     "strategy are all unchanged and still the original author's design. Four new helper functions added "
     "alongside the existing code. Deliberately NOT split into routers - that would have made the changes "
     "unreviewable."),
    ("backend/test_api.py", "Backend", "Created", "419",
     "End-to-end suite: 95 assertions over every endpoint. Creates its own fixtures and cleans up."),
    ("backend/seed_demo.py", "Backend", "Created", "366",
     "Generates realistic demo data (fictional). Fixed random seed, so results are reproducible."),
    ("backend/test_connection.py", "Backend", "Created", "139",
     "Validates a MongoDB connection string and diagnoses the common failures. Reads via getpass."),
    ("backend/inspect_db.py", "Backend", "Created", "76",
     "Read-only cluster inspection - databases, collections, counts, field names."),
    ("backend/requirements-local.txt", "Backend", "Created (earlier phase)", "11 packages",
     "The original requirements.txt pinned ~130 packages (pandas, boto3, openai, stripe...) that server.py "
     "never imports. This is the actual dependency set."),
    ("frontend/src/index.css", "Frontend", "Rewritten", "113 -> 460",
     "Design tokens from the brand palette, the full motion layer, glass utilities, print styles."),
    ("frontend/tailwind.config.js", "Frontend", "Rewritten", "-",
     "Brand colour scale, typography, easing curves, radii."),
    ("frontend/src/components/ui/primitives.jsx", "Frontend", "Created", "237",
     "Shared kit: PageHeader, StatCard, Panel, EmptyState, Meter, Pill, AnimatedNumber, SkeletonRows."),
    ("frontend/src/components/Layout.js", "Frontend", "Rewritten", "-",
     "Sidebar regrouped from a flat 14-item list into five sections; notification panel, mobile drawer, "
     "outside-click and Escape handling."),
    ("frontend/src/pages/LoginPage.js", "Frontend", "Rewritten", "-",
     "Split layout, white frosted-glass card, drifting aurora backdrop, contrast-verified."),
    ("frontend/src/pages/DashboardPage.js", "Frontend", "Rewritten", "-",
     "KPI cards with count-up, per-operation chart, lot progress meters, skeleton loading."),
    ("frontend/src/pages/PayrollPage.js", "Frontend", "Rewritten", "-",
     "Required rework anyway - the advance fields changed shape. Now shows gross / deducted / carried / net."),
    ("frontend/src/pages/VouchersPage.js", "Frontend", "Rewritten", "-",
     "Same field change. Voucher preview now shows the advance line and net payable."),
    ("frontend/src/pages/ProductionEntryPage.js", "Frontend", "Rewritten", "-",
     "Carried the frontend half of two defects (B06, B07). Entry grid, live balances, edit dialog."),
    ("frontend/src/pages/LotsPage.js", "Frontend", "Rewritten", "-",
     "Search and status filter, honest progress meters, bottleneck operation, summary cards."),
    ("frontend/src/pages/UsersPage.js", "Frontend", "Rewritten", "-",
     "Replaced an 8-column table with a card grid; optimistic permission toggles."),
    ("frontend/src/components/ui/{button,card,input,table}.jsx", "Frontend", "Rewritten", "-",
     "Brand styling, press/hover motion, focus rings, tabular numerals, loading state on Button."),
    ("frontend/src/pages/AdvancesPage.js", "Frontend", "Edited", "-", "Header, summary cards, panel layout."),
    ("frontend/src/pages/ReportsPage.js", "Frontend", "Edited", "-", "Header plus the advance-field rename."),
    ("frontend/src/pages/{Operators,Operations,Colors,SizeCharts,Weeks,Settings}Page.js",
     "Frontend", "Edited", "-", "Shared header; inherit the new base components. Layouts not individually redesigned."),
    ("frontend/public/index.html", "Frontend", "Rewritten", "-",
     "Removed PostHog and the Emergent script; real title, description, favicon and manifest."),
    ("frontend/public/ (images, icons, manifest)", "Assets", "Created", "~900 KB",
     "Self-hosted logo artwork (trimmed), login background, favicon.ico, logo192/512, manifest.json."),
    ("Dockerfile", "Deployment", "Edited", "-",
     "Worker count now follows WEB_CONCURRENCY instead of a hardcoded 2."),
    ("render.yaml", "Deployment", "Created (earlier phase)", "-",
     "Render blueprint: Docker service, health check, generated JWT secret, secrets marked sync:false."),
    ("DATA-ACCURACY-BUGS.md", "Docs", "Created", "275",
     "The audit findings, with reasoning preserved so future maintainers know why each change exists."),
    ("frontend/src/App.js, index.js, AuthContext.js, lib/utils.js, hooks/use-toast.js, App.css, "
     "postcss.config.js, backend/requirements.txt",
     "Untouched", "Original", "-", "Eight original files left exactly as exported."),
]

sheet("Files Changed",
      ["File", "Area", "Treatment", "Lines", "Notes"],
      [56, 14, 24, 14, 92],
      FILES,
      note="'Edited in place' means targeted changes. 'Rewritten' means the file was replaced.")


# =====================================================================
# 5. UI AND UX
# =====================================================================
UI = [
    ("Brand palette", "Done",
     "Colours sampled directly from the logo artwork: navy #294F96 and leaf teal #00AF92, with tints, "
     "semantic tokens and chart colours derived from them. Replaced generic dashboard blue."),
    ("Typography", "Done",
     "Outfit for headings, IBM Plex Sans for body, JetBrains Mono for figures. Tabular numerals enforced on "
     "all tables so money columns align digit-to-digit."),
    ("Density", "Done",
     "Spacing scale tightened for a data-dense operations tool rather than a marketing site."),
    ("Motion layer", "Done",
     "Built in CSS, no animation library - the bundle stayed at ~300 KB gzipped. Durations 140-380ms, "
     "transform/opacity only so everything composites on the GPU."),
    ("Motion details", "Done",
     "Page transitions, list stagger (capped at 12 items so long tables do not crawl), count-up numbers, "
     "shimmer skeletons, spring-eased active nav rail, button press states, hover sheen."),
    ("Reduced motion", "Done",
     "prefers-reduced-motion disables every animation and transition, including the login aurora."),
    ("Accessibility", "Done",
     "Visible focus rings everywhere; contrast measured rather than eyeballed. First pass on the glass card "
     "measured 4.03:1 for field labels - below the 4.5 AA threshold - and was corrected to 5.79-13.64:1."),
    ("Login screen", "Rebuilt",
     "White frosted-glass card over a navy backdrop with three drifting light sources. Glass built from "
     "backdrop-blur plus saturation lift, a masked 1px specular rim, inner highlight and SVG grain to "
     "prevent gradient banding."),
    ("App shell", "Rebuilt", "14 nav items grouped into five sections; notification panel; mobile drawer with scroll lock."),
    ("Dashboard", "Rebuilt", "KPI cards, per-operation bar chart (recharts), lot progress, top earners, skeleton loading."),
    ("Lots", "Rebuilt", "Search, status filter, honest progress, bottleneck operation named, summary cards."),
    ("Production Entry", "Rebuilt", "Entry grid with live per-size balances, week auto-selected, richer edit dialog."),
    ("Payroll", "Rebuilt", "Gross / advance recovered / net payable / carried forward, with an explanatory footnote."),
    ("Vouchers", "Rebuilt", "Summary cards and a print-accurate voucher preview showing the advance line."),
    ("Users", "Rebuilt", "Card grid replacing a sparse 8-column table; optimistic permission toggles."),
    ("Advances", "Partially updated", "Header, summary cards and panel layout; table not individually redesigned."),
    ("Reports", "NOT redesigned",
     "Shared header and inherited component styling only. Still uses dense hand-rolled tables - the clearest "
     "remaining candidate for further work."),
    ("Master-data pages", "NOT redesigned",
     "Operators, Operations, Colours, Size Charts, Weeks, Settings: consistent headers and inherited "
     "components, but their layouts were not individually reworked."),
]

sheet("UI and UX Changes",
      ["Item", "Status", "Detail"],
      [30, 22, 118],
      UI,
      note="Honest scope: 8 screens rebuilt, the rest inherit the design system without individual redesign.")


# =====================================================================
# 6. TEST COVERAGE
# =====================================================================
TESTS = [
    ("Authentication", "6", "Bad password rejected, admin login, /auth/me, password hash never returned, "
     "unauthenticated request refused."),
    ("Master data", "8", "Create operator/operation/colour/size chart; duplicate names rejected; codes auto-assigned."),
    ("Weeks", "2", "Creation and duplicate rejection."),
    ("Lots", "3", "Creation, planned quantity total, new lot starts at 0% progress."),
    ("B01 daily entries", "4", "Day 1 saves; day 2 ALSO saves; same-day repeat still rejected; both days total correctly."),
    ("Over-production guard", "2", "Batch entry over plan rejected, with the size and totals named in the error."),
    ("B05 edit validation", "4", "Over-plan edit rejected; valid edit accepted; wages recomputed; audit history written."),
    ("B02 lot progress", "4", "Produced = minimum across operations, not the sum; progress <= 100%; balance not "
     "negative; per-operation breakdown returned."),
    ("B03/B04 payroll", "7", "Advance capped at earnings; net never negative; carry-forward correct; outstanding "
     "still visible; Excel contains 'advance' and 'net payable'; voucher PDF generates."),
    ("B09 voucher numbering", "1", "Reprint produces identical output."),
    ("B10/B11 exports", "4", "Lot Excel no longer 500s and has content; operation cost export; salary PDF."),
    ("B08 advance adjustment", "5", "Selected voucher reduced, others untouched; zero and over-balance rejected."),
    ("B06 edit requests", "6", "Approval changes the entry; wages recomputed; double-approval rejected; "
     "empty request refused."),
    ("B13 lot deletion", "2", "Refused while entries exist, with an explanatory message."),
    ("Reports", "8", "All eight report endpoints return HTTP 200."),
    ("B15 float precision", "5", "Every monetary value equals its own 2-decimal rounding."),
    ("Misc endpoints", "15", "company, health, operators, operations, colours, size charts, weeks, lots, "
     "advances, users, settings, notifications, unread count, vouchers, edit requests."),
    ("Cleanup", "1", "Lot deletes once its entries are removed; all fixtures torn down."),
]

ws = sheet("Test Coverage",
           ["Group", "Assertions", "What it proves"],
           [30, 14, 116],
           TESTS,
           note="backend/test_api.py - run against a live backend. Result at time of writing: 95 passed, 0 failed.")
r = 3 + len(TESTS) + 1
ws.cell(row=r, column=1, value="TOTAL").font = Font(bold=True, size=11, color=NAVY_DK)
ws.cell(row=r, column=2, value="95 passed, 0 failed").font = Font(bold=True, size=11, color="0A7C5A")
ws.cell(row=r + 1, column=1, value="How to run").font = BOLD
ws.cell(row=r + 1, column=3,
        value="backend\\.venv\\Scripts\\python.exe backend\\test_api.py").font = MONO


# =====================================================================
# 7. DEPLOYMENT
# =====================================================================
DEP = [
    ("Live URL", "https://victoriya.onrender.com", "Verified: health OK, database connected, frontend and assets served."),
    ("Source", "github.com/sprizon11/victoriya", "Public repository. Verified that .env, .env.emergent.bak and "
     "test_credentials.md are all absent (HTTP 404)."),
    ("Hosting", "Render - Docker web service", "Single container: FastAPI serves the compiled React bundle, so one "
     "origin. No CORS, and auth cookies stay SameSite=Lax, which is what makes login reliable on phones."),
    ("Database", "MongoDB Atlas M0 (free), AWS Mumbai", "Render offers no managed MongoDB. 512 MB, shared with an "
     "unrelated project on the same cluster."),
    ("Network access", "0.0.0.0/0", "Required - Render's free and starter plans have no static outbound IP. The "
     "database password is therefore the only barrier, which is why least-privilege matters."),
    ("MONGO_URL", "Render env var (secret)", "Atlas SRV string. Never committed."),
    ("DB_NAME", "victoria_unit_flow", "Separate from the connection string."),
    ("JWT_SECRET", "Render env var (secret)", "Freshly generated. The old Emergent value is blocklisted in code."),
    ("ADMIN_EMAIL", "admin@victoriagarments.in", "The login identity - NOT admin@example.com."),
    ("ADMIN_PASSWORD", "Render env var (secret)", "Must be strong: the app refuses to boot on admin123/admin/"
     "password/blank when PUBLIC_MODE is true."),
    ("PUBLIC_MODE", "true", "Forces Secure cookies, disables /docs and /openapi.json, and enforces the weak-secret "
     "guards. Verified: both doc paths fall through to the React shell."),
    ("CORS_ORIGINS", "(unset)", "Empty means same-origin only - correct for a single-service deployment."),
    ("Workers", "WEB_CONCURRENCY (1 on free)", "No longer hardcoded."),
    ("Build", "~5-8 minutes", "Stage 1 compiles React; stage 2 installs Python and runs as a non-root user."),
    ("Free-plan caveat", "Sleeps after 15 min idle", "First request then takes ~50 seconds. plan: starter ($7/mo) "
     "removes this - recommended before the client uses it daily."),
]

sheet("Deployment",
      ["Item", "Value", "Notes"],
      [26, 40, 104],
      DEP,
      note="Emergent is no longer required for anything.")


# =====================================================================
# 8. OUTSTANDING
# =====================================================================
OUT = [
    ("1", "CRITICAL", "Export the client's live data off Emergent",
     "The ZIP contained no data - the original .env pointed at mongodb://localhost inside the Emergent "
     "container. The client's real production and payroll records are still there and were never exported. "
     "If that account lapses or is cancelled, they are gone.",
     "Client must restart the Emergent app and run mongodump. Instructions supplied. Time-sensitive."),
    ("2", "CRITICAL", "Assess wage impact on real workers",
     "B01 discarded production, and B03/B04 made the screen and the printed voucher disagree. Depending on "
     "which document wages were paid from, either workers or the factory lost money.",
     "Two questions for the client: which document did you pay from, and was production entered daily? Once "
     "the data is recovered, an audit script can quantify who was affected."),
    ("3", "HIGH", "Rotate the database password",
     "Exposed twice during setup - terminal echo, then a screenshot with Render's values revealed.",
     "Atlas > Database Users > Edit Password > Autogenerate, then update MONGO_URL in Render."),
    ("4", "HIGH", "Scope the Atlas user to least privilege",
     "Currently atlasAdmin on All Resources, on a cluster that also holds an unrelated project's database. "
     "A leak would expose both.",
     "Atlas > Database Users > Specific Privileges > readWrite on victoria_unit_flow only."),
    ("5", "HIGH", "Shut down the old Emergent deployment",
     "Its JWT_SECRET is the shared development value published in the source. While it stays online, anyone "
     "with the original ZIP can mint an admin token for it.",
     "Delete or stop the app - AFTER the data export in item 1."),
    ("6", "MEDIUM", "Change the admin password",
     "Set during deployment and visible in a screenshot.",
     "Change from inside the app once logged in."),
    ("7", "MEDIUM", "Upgrade off the free Render plan",
     "The service sleeps after 15 minutes idle; the first request then takes ~50 seconds. A poor first "
     "impression for a factory opening it each morning.",
     "Change plan: free to plan: starter ($7/month) in render.yaml, or in the dashboard."),
    ("8", "MEDIUM", "Resolve the two week-numbering schemes (B12)",
     "generate_weeks() numbers sequentially from a chosen date; the dashboard fallback uses ISO week numbers. "
     "They disagree, and the week straddling a year boundary is ambiguous.",
     "Needs a business decision on how the factory defines its payroll week, then a single scheme."),
    ("9", "MEDIUM", "Confirm the 'produced' definition for a lot",
     "Implemented as the minimum across operations - the standard garment-industry reading, and what the "
     "code already implied. If the factory instead counts one nominated final operation, this differs.",
     "Confirm with the client. A small change in enrich_lot() if they disagree."),
    ("10", "LOW", "Reclaim Atlas storage",
     "sample_mflix (MongoDB's demo movie dataset, ~100 MB) occupies a fifth of the 512 MB free quota, on a "
     "cluster shared with another project.",
     "Atlas > Collections > sample_mflix > Drop Database."),
    ("11", "LOW", "Redesign Reports and the master-data pages",
     "They have consistent headers and inherit the new components, but their layouts were not individually "
     "reworked. Reports still uses dense hand-rolled tables.",
     "Optional polish. Reports is the clearest candidate."),
    ("12", "LOW", "Remove the demo data before client handover",
     "1,621 fictional production entries and 12 invented operator names are in the local database. Every row "
     "is stamped entered_by='seed'.",
     "Settings > Reset all data, or the supplied wipe command. Never run seed_demo.py against production."),
    ("13", "LOW", "Consider who should own the hosting accounts",
     "Atlas and Render are currently under your accounts. The factory's payroll data ideally lives in "
     "accounts the client controls.",
     "Decide before handover, so you are not a single point of failure for their payroll."),
]

sheet("Outstanding Actions",
      ["#", "Priority", "Action", "Why", "How"],
      [5, 12, 42, 74, 66],
      OUT,
      note="Items 1 and 2 concern real wages and unrecoverable records. Read them first.")


for name in wb.sheetnames:
    wb[name].sheet_properties.tabColor = NAVY

out = "VICTORIA-PROJECT-REPORT.xlsx"
wb.save(out)
print(f"Wrote {out}")
print(f"Sheets: {', '.join(wb.sheetnames)}")
print(f"Bugs: {len(BUGS)}  Security: {len(SEC)}  Files: {len(FILES)}  Outstanding: {len(OUT)}")
