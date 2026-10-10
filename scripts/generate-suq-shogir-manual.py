from pathlib import Path
import re
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image, PageBreak, Paragraph, SimpleDocTemplate, Spacer,
)

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "suq-shogir"
OUTPUT = DOCS / "SUQ_SHOGIR_PANDUAN_OPERASIONAL.pdf"
SOURCES = [
    DOCS / "PANDUAN_ADMIN_TENANT.md",
    DOCS / "PANDUAN_OWNER.md",
    DOCS / "PANDUAN_KASIR_SUPERVISOR.md",
    DOCS / "HARI_PERTAMA_OPERASIONAL.md",
    DOCS / "TROUBLESHOOTING.md",
]

font = Path("C:/Windows/Fonts/arial.ttf")
font_bold = Path("C:/Windows/Fonts/arialbd.ttf")
if font.exists() and font_bold.exists():
    pdfmetrics.registerFont(TTFont("SuqSans", str(font)))
    pdfmetrics.registerFont(TTFont("SuqSansBold", str(font_bold)))
    BODY_FONT, BOLD_FONT = "SuqSans", "SuqSansBold"
else:
    BODY_FONT, BOLD_FONT = "Helvetica", "Helvetica-Bold"

GREEN = colors.HexColor("#0F5C36")
LIGHT = colors.HexColor("#EAF4EE")
TEXT = colors.HexColor("#18221C")
MUTED = colors.HexColor("#5D6D63")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CoverTitle", fontName=BOLD_FONT, fontSize=28, leading=34, textColor=GREEN, alignment=TA_CENTER, spaceAfter=12))
styles.add(ParagraphStyle(name="CoverSub", fontName=BODY_FONT, fontSize=12, leading=18, textColor=MUTED, alignment=TA_CENTER))
styles.add(ParagraphStyle(name="H1Suq", fontName=BOLD_FONT, fontSize=21, leading=26, textColor=GREEN, spaceAfter=12))
styles.add(ParagraphStyle(name="H2Suq", fontName=BOLD_FONT, fontSize=14, leading=18, textColor=TEXT, spaceBefore=10, spaceAfter=6))
styles.add(ParagraphStyle(name="BodySuq", fontName=BODY_FONT, fontSize=9.5, leading=14, textColor=TEXT, spaceAfter=6))
styles.add(ParagraphStyle(name="BulletSuq", fontName=BODY_FONT, fontSize=9.5, leading=14, textColor=TEXT, leftIndent=12, firstLineIndent=-7, bulletIndent=3, spaceAfter=3))
styles.add(ParagraphStyle(name="NoteSuq", fontName=BODY_FONT, fontSize=8.5, leading=12, textColor=MUTED, backColor=LIGHT, borderPadding=8, spaceAfter=8))

def inline(text):
    text = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"`(.+?)`", r"<font name='Courier'>\1</font>", text)
    return text

def append_markdown(story, source):
    for raw in source.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line:
            story.append(Spacer(1, 2.5 * mm))
            continue
        image_match = re.fullmatch(r"!\[(.*?)\]\((.*?)\)", line)
        if image_match:
            image_path = (source.parent / image_match.group(2)).resolve()
            if image_path.exists():
                img = Image(str(image_path))
                max_w, max_h = 174 * mm, 105 * mm
                scale = min(max_w / img.imageWidth, max_h / img.imageHeight, 1)
                img.drawWidth = img.imageWidth * scale
                img.drawHeight = img.imageHeight * scale
                story.extend([img, Paragraph(inline(image_match.group(1)), styles["NoteSuq"])])
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), styles["H1Suq"]))
        elif line.startswith("## "):
            story.append(Paragraph(inline(line[3:]), styles["H2Suq"]))
        elif re.match(r"^[-*] \[[ xX]\] ", line):
            checked = line[3].lower() == "x"
            story.append(Paragraph(("☑ " if checked else "☐ ") + inline(line[6:]), styles["BulletSuq"]))
        elif re.match(r"^[-*] ", line):
            story.append(Paragraph("• " + inline(line[2:]), styles["BulletSuq"]))
        elif re.match(r"^\d+\. ", line):
            story.append(Paragraph(inline(line), styles["BulletSuq"]))
        elif line.startswith("Terakhir diperbarui:"):
            story.append(Paragraph(inline(line), styles["NoteSuq"]))
        else:
            story.append(Paragraph(inline(line), styles["BodySuq"]))

def page(canvas, doc):
    canvas.saveState()
    canvas.setFont(BODY_FONT, 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 12 * mm, "Suq Shogir · Didukung KlikPesantren")
    canvas.drawRightString(192 * mm, 12 * mm, f"Halaman {doc.page}")
    canvas.restoreState()

story = [
    Spacer(1, 48 * mm),
    Paragraph("SUQ SHOGIR", styles["CoverTitle"]),
    Paragraph("Panduan Operasional", styles["CoverTitle"]),
    Paragraph("Admin Tenant · Owner · Kasir · Supervisor · Toko Online", styles["CoverSub"]),
    Spacer(1, 12 * mm),
    Paragraph("Dokumen lokal untuk kesiapan operasional dan pelatihan. Tidak memuat credential, data pelanggan nyata, atau nilai finansial production.", styles["NoteSuq"]),
    PageBreak(),
]
for index, source in enumerate(SOURCES):
    append_markdown(story, source)
    if index < len(SOURCES) - 1:
        story.append(PageBreak())

doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm,
    topMargin=18 * mm, bottomMargin=20 * mm,
    title="Suq Shogir — Panduan Operasional",
    author="KlikPesantren",
)
doc.build(story, onFirstPage=page, onLaterPages=page)
print(f"Created {OUTPUT.name} ({OUTPUT.stat().st_size} bytes)")
