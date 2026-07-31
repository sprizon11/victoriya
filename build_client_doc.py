"""
Generates VICTORIA-CLIENT-REPORT.pdf - a short client-facing summary.

Three sections only: problems found, what was changed, login details.

    backend\\.venv\\Scripts\\python.exe build_client_doc.py
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image, Table, TableStyle,
)

NAVY = colors.HexColor("#294F96")
NAVY_DK = colors.HexColor("#1D386B")
GREY = colors.HexColor("#5A6472")
LINE = colors.HexColor("#DCE2EC")
TINT = colors.HexColor("#F4F7FB")

title = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=19, textColor=NAVY_DK,
                       leading=23, spaceAfter=2)
sub = ParagraphStyle("s", fontName="Helvetica", fontSize=10.5, textColor=GREY, leading=14)
h = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=12.5, textColor=NAVY,
                   leading=16, spaceBefore=14, spaceAfter=6)
body = ParagraphStyle("b", fontName="Helvetica", fontSize=10.5, leading=15.5,
                      textColor=colors.HexColor("#242C38"), spaceAfter=5)
bullet = ParagraphStyle("bu", parent=body, leftIndent=13, bulletIndent=3, spaceAfter=4)
desc = ParagraphStyle("d", parent=body, leftIndent=13, spaceAfter=8)
foot = ParagraphStyle("f", fontName="Helvetica", fontSize=8.5, textColor=GREY, leading=12)

# Table cells must be Paragraph objects - reportlab will not wrap a raw string
# inside a table, it renders it as one long line that runs off the page.
tlabel = ParagraphStyle("tl", fontName="Helvetica-Bold", fontSize=10.5, leading=15, textColor=NAVY_DK)
tval = ParagraphStyle("tv", fontName="Helvetica", fontSize=10.5, leading=15,
                      textColor=colors.HexColor("#242C38"))

S = []

# ---------------------------------------------------------------- header
S.append(Image("frontend/public/victoria-logo-mark.png", width=52 * mm, height=10.8 * mm))
S.append(Spacer(1, 11))
S.append(Paragraph("System Review and Update", title))
S.append(Paragraph("Victoria Unit Flow &nbsp;|&nbsp; Production and Payroll System", sub))
S.append(Spacer(1, 5))
S.append(Table([[""]], colWidths=[168 * mm], rowHeights=[2],
               style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY)])))
S.append(Spacer(1, 13))

S.append(Paragraph(
    "We reviewed the production and payroll software in detail and found <b>23 problems</b>. "
    "The wage calculation itself was correct - pieces multiplied by rate was always right. "
    "The errors came from what the system was counting. All 23 have been corrected and tested.",
    body))

# ------------------------------------------------------- problems found
S.append(Paragraph("Problems we found", h))

items = [
    ("Production was being lost",
     "The system saved only <b>one day of production per worker each week</b> for each job. When more "
     "days were entered, the figures were quietly discarded and only a small warning appeared. Workers "
     "were credited with far less than they actually produced."),
    ("Wage slips did not match the screen",
     "The printed voucher showed the <b>full amount before deducting advances</b>, while the payroll "
     "screen showed the correct amount after deduction. The same worker had two different figures for "
     "the same week."),
    ("Advances were deducted incorrectly",
     "The entire advance was taken out of a single week's wages instead of being spread out. This could "
     "show a worker <b>owing money instead of earning it</b>, and the same advance could appear again "
     "the following week."),
    ("Job completion figures were wrong",
     "A finished job could show as <b>390% complete</b> with a negative balance. A job that was really "
     "only 19% done could show as 76% - close enough to look believable."),
    ("Some reports would not open at all",
     "The Excel report for a job failed every time, as long as that job had any production recorded "
     "against it."),
    ("Corrections appeared to save but did not",
     "When a staff member requested a correction and it was approved, <b>nothing actually changed</b>. "
     "Both people believed the figure had been fixed."),
    ("Quantities could be entered beyond the planned order",
     "The limit was applied when adding production, but not when editing it afterwards."),
    ("Voucher numbers changed each time they were printed",
     "Reprinting a lost voucher produced a different number, leaving gaps in the records."),
    ("Deleting a job erased its wage history",
     "Removing a job also removed all production recorded against it, so past wage records no longer "
     "matched what had been paid."),
    ("User permissions had no effect",
     "The permission settings shown on screen were never applied. Every user could do everything, "
     "regardless of what was ticked."),
    ("Screen activity was being sent outside the company",
     "The software was recording screen activity and sending it to an outside company's account - "
     "including worker names, wages and advances."),
]
for t, d in items:
    S.append(Paragraph(f"<b>{t}</b>", bullet, bulletText="•"))
    S.append(Paragraph(d, desc))

# ---------------------------------------------------------- what changed
S.append(Paragraph("What has been changed", h))
for line in [
    "All 23 problems corrected.",
    "Every day of production is now saved correctly for each worker.",
    "The payroll screen, the Excel sheet and the printed voucher now all show the same figures.",
    "Advance deductions are limited to what the worker earned that week, so wages can never be "
    "negative. Anything remaining is carried forward and shown clearly.",
    "Job completion percentages now reflect real progress, and show which operation is holding a job up.",
    "Reports and Excel exports open correctly.",
    "Requested corrections are now actually applied when approved, with a record of who changed what.",
    "The planned order quantity can no longer be exceeded, whether adding or editing.",
    "Voucher numbers are issued once and stay the same when reprinted.",
    "A job with production recorded against it can no longer be deleted, protecting wage history.",
    "User permissions are now enforced properly.",
    "The screen recording sent to the outside company has been removed.",
    "Your logo and images are now stored with the system instead of on the old platform.",
    "Automated checks now test the whole system - 95 checks, all passing - so these problems cannot "
    "return unnoticed.",
    "The appearance has been rebuilt around your logo and brand colours, and works on phone and tablet.",
]:
    S.append(Paragraph(line, bullet, bulletText="•"))

# --------------------------------------------------------------- login
S.append(Paragraph("Login details", h))
info = [
    ("Web address", "https://victoriya.onrender.com"),
    ("Login", "admin@victoria.in"),
    ("Password", "Victoria@2026 &nbsp;&nbsp;<font color='#8A6A00'>(please change this after your "
                 "first login)</font>"),
    ("Hosting", "Render (application) and MongoDB Atlas (database)"),
]
S.append(Table([[Paragraph(a, tlabel), Paragraph(b, tval)] for a, b in info],
               colWidths=[36 * mm, 125 * mm], style=TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), TINT),
    ("LINEBELOW", (0, 0), (-1, -2), 0.5, LINE),
    ("BOX", (0, 0), (-1, -1), 0.6, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 7),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ("LEFTPADDING", (0, 0), (-1, -1), 9),
    ("RIGHTPADDING", (0, 0), (-1, -1), 9),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
])))
S.append(Paragraph(
    "The first time the system is opened after a period of inactivity it may take about a minute "
    "to start.",
    ParagraphStyle("nn", parent=body, fontSize=9.5, textColor=GREY, spaceBefore=7)))

S.append(Spacer(1, 16))
S.append(Table([[""]], colWidths=[168 * mm], rowHeights=[0.6],
               style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), LINE)])))
S.append(Spacer(1, 6))
S.append(Paragraph(
    "A detailed technical report listing every problem, its cause and the correction made is "
    "available on request.", foot))

doc = SimpleDocTemplate(
    "VICTORIA-CLIENT-REPORT.pdf", pagesize=A4,
    leftMargin=21 * mm, rightMargin=21 * mm, topMargin=17 * mm, bottomMargin=16 * mm,
    title="Victoria Unit Flow - System Review and Update",
    author="Victoria Unit Flow",
)
doc.build(S)
print("Wrote VICTORIA-CLIENT-REPORT.pdf")
