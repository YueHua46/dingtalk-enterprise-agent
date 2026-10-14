#!/usr/bin/env python3
"""Render a structured Amazon advertising diagnosis as a readable PDF.

The script is intentionally deterministic: the model supplies facts and
recommendations as JSON, while this renderer owns page layout, colours,
tables, pagination and metadata. It writes only to the requested output path.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


NAVY = colors.HexColor("#17324D")
BLUE = colors.HexColor("#2F6B9A")
TEAL = colors.HexColor("#0F766E")
INK = colors.HexColor("#1F2937")
MUTED = colors.HexColor("#64748B")
LIGHT = colors.HexColor("#F1F5F9")
PALE_BLUE = colors.HexColor("#E8F1F8")
PALE_GREEN = colors.HexColor("#E8F5F0")
PALE_AMBER = colors.HexColor("#FFF7E6")
PALE_RED = colors.HexColor("#FDECEC")
GRID = colors.HexColor("#CBD5E1")


def load_font() -> tuple[str, str]:
    candidates = [
        ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", "WQYZenHei"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "NotoSansCJK-Regular"),
        ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", "NotoSansCJK-Regular"),
        ("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "NotoSansCJK-Bold"),
    ]
    regular = bold = "Helvetica"
    for path, name in candidates:
        if not os.path.exists(path):
            continue
        try:
            # ReportLab's TTC support can select the wrong regional cmap. Use
            # fontTools to extract Simplified Chinese (collection index 2)
            # into a temporary TTF before registering it.
            from fontTools.ttLib import TTCollection
            target = Path(tempfile.gettempdir()) / f"{name}-SC.ttf"
            if not target.exists():
                collection = TTCollection(path)
                # WQY is a single-font TTC; Noto's Simplified Chinese face
                # is collection index 2.
                collection.fonts[0 if "WQY" in name else 2].save(str(target))
            pdfmetrics.registerFont(TTFont(name, str(target)))
            if "Bold" in name:
                bold = name
            else:
                regular = name
        except Exception:
            continue
    if regular != "Helvetica" and bold == "Helvetica":
        bold = regular
    if regular == "Helvetica":
        for path, name in [
            ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "DejaVuSans"),
            ("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "LiberationSans"),
        ]:
            if os.path.exists(path):
                try:
                    pdfmetrics.registerFont(TTFont(name, path))
                    regular = bold = name
                    break
                except Exception:
                    pass
    # ReportLab ships a CID font mapping for Simplified Chinese. It is a
    # reliable last resort in development images that do not have Noto fonts;
    # production file-worker images install Noto CJK as an additional fallback.
    if regular == "Helvetica":
        try:
            pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
            regular = bold = "STSong-Light"
        except Exception:
            pass
    return regular, bold


def text(value: Any, default: str = "未知") -> str:
    if value is None or value == "":
        return default
    if isinstance(value, (list, tuple)):
        return "、".join(text(item, "") for item in value)
    return str(value)


def para(value: Any, style: ParagraphStyle) -> Paragraph:
    escaped = text(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    escaped = escaped.replace("\n", "<br/>")
    return Paragraph(escaped, style)


def status_colour(value: Any) -> colors.Color:
    val = text(value, "").lower()
    if any(word in val for word in ("高", "危险", "亏损", "停止", "red", "critical")):
        return PALE_RED
    if any(word in val for word in ("中", "观察", "待验证", "amber", "warning")):
        return PALE_AMBER
    if any(word in val for word in ("低", "正常", "通过", "green", "good")):
        return PALE_GREEN
    return colors.white


def make_table(rows: list[list[Any]], widths: list[float], styles: dict[str, ParagraphStyle], header: bool = True) -> Table:
    prepared = []
    header_style = ParagraphStyle("TableHeader", parent=styles["table"], textColor=colors.white, fontName=styles["font_bold"])
    for index, row in enumerate(rows):
        cell_style = header_style if header and index == 0 else styles["table"]
        prepared.append([item if isinstance(item, Paragraph) else para(item, cell_style) for item in row])
    table = Table(prepared, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT", splitInRow=1)
    commands = [
        ("GRID", (0, 0), (-1, -1), 0.35, GRID),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]
    if header:
        commands += [("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white)]
        for col in range(len(rows[0]) if rows else 0):
            commands.append(("FONTNAME", (col, 0), (col, 0), styles["font_bold"]))
    for index, row in enumerate(rows[1:] if header else rows, start=1 if header else 0):
        if index % 2 == (1 if header else 0):
            commands.append(("BACKGROUND", (0, index), (-1, index), colors.HexColor("#FAFCFE")))
    table.setStyle(TableStyle(commands))
    return table


def section(title: str, styles: dict[str, ParagraphStyle]) -> list[Any]:
    heading = Paragraph(title, styles["section"])
    heading.keepWithNext = True
    return [Spacer(1, 5 * mm), heading]


def render(data: dict[str, Any], output: Path) -> None:
    regular, bold = load_font()
    styles = getSampleStyleSheet()
    styles_map = {
        "font": regular,
        "font_bold": bold,
        "title": ParagraphStyle("ReportTitle", parent=styles["Title"], fontName=bold, fontSize=24, leading=29, textColor=NAVY, alignment=TA_CENTER, spaceAfter=8),
        "subtitle": ParagraphStyle("Subtitle", parent=styles["Normal"], fontName=regular, fontSize=10, leading=15, textColor=MUTED, alignment=TA_CENTER),
        "section": ParagraphStyle("Section", parent=styles["Heading2"], fontName=bold, fontSize=14, leading=18, textColor=NAVY, spaceBefore=5, spaceAfter=4),
        "h3": ParagraphStyle("H3", parent=styles["Heading3"], fontName=bold, fontSize=10.5, leading=14, textColor=BLUE, spaceBefore=4, spaceAfter=3),
        "body": ParagraphStyle("Body", parent=styles["BodyText"], fontName=regular, fontSize=9.5, leading=14, textColor=INK, spaceAfter=4),
        "small": ParagraphStyle("Small", parent=styles["BodyText"], fontName=regular, fontSize=8, leading=11, textColor=MUTED),
        "table": ParagraphStyle("Table", parent=styles["BodyText"], fontName=regular, fontSize=8.5, leading=12, textColor=INK),
        "cover_box": ParagraphStyle("CoverBox", parent=styles["BodyText"], fontName=regular, fontSize=10, leading=15, textColor=INK, alignment=TA_LEFT),
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(output), pagesize=A4, rightMargin=15 * mm, leftMargin=15 * mm, topMargin=17 * mm, bottomMargin=16 * mm, title=text(data.get("report_title"), "Amazon 广告分析报告"), author="Amazon Advertising AI Optimizer")
    story: list[Any] = []
    title = text(data.get("report_title"), "Amazon 广告分析报告")
    marketplace = text(data.get("marketplace"), "未知")
    period = text(data.get("analysis_period"), "未知")
    generated = text(data.get("generated_at"), datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
    story += [Spacer(1, 24 * mm), Paragraph(title, styles_map["title"]), Paragraph(f"{marketplace} · 广告诊断与调优建议", styles_map["subtitle"]), Spacer(1, 12 * mm)]
    cover_rows = [
        [para("分析对象", styles_map["table"]), para(text(data.get("store_name"), "未知店铺"), styles_map["cover_box"])],
        [para("ASIN / SKU", styles_map["table"]), para(text(data.get("asins") or data.get("sku")), styles_map["cover_box"])],
        [para("分析周期", styles_map["table"]), para(period, styles_map["cover_box"])],
        [para("广告阶段", styles_map["table"]), para(text(data.get("advertising_stage")), styles_map["cover_box"])],
        [para("报告生成", styles_map["table"]), para(generated, styles_map["cover_box"])],
    ]
    cover = Table(cover_rows, colWidths=[35 * mm, 125 * mm], hAlign="CENTER")
    cover.setStyle(TableStyle([("BACKGROUND", (0, 0), (0, -1), PALE_BLUE), ("BACKGROUND", (1, 0), (1, -1), colors.white), ("GRID", (0, 0), (-1, -1), 0.4, GRID), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.append(cover)
    story += [Spacer(1, 17 * mm), Paragraph("本报告只提供分析和建议；竞价、预算、否定词及活动状态的实际修改仍需人工确认。", styles_map["small"]), PageBreak()]

    story += section("一、执行摘要", styles_map)
    summary = data.get("executive_summary") or data.get("summary") or "未知"
    story.append(para(summary, styles_map["body"]))
    metrics = data.get("overall_metrics") or []
    if metrics:
        story.append(Paragraph("核心指标", styles_map["h3"]))
        rows = [["指标", "当前值", "参考/目标", "状态"]]
        for item in metrics:
            rows.append([item.get("metric", "未知"), item.get("value", "未知"), item.get("benchmark", "未知"), item.get("status", "未知")])
        story.append(make_table(rows, [38 * mm, 35 * mm, 45 * mm, 42 * mm], styles_map))

    story += section("二、数据质量与口径", styles_map)
    quality = data.get("data_quality") or {}
    quality_rows = [["项目", "结果"]]
    if isinstance(quality, dict):
        for key, value in quality.items():
            quality_rows.append([key, value])
    else:
        quality_rows.append(["说明", quality])
    story.append(make_table(quality_rows, [45 * mm, 115 * mm], styles_map))

    def add_records(title_text: str, key: str, columns: list[tuple[str, str]], widths: list[float]) -> None:
        records = data.get(key) or []
        if not records:
            return
        story.extend(section(title_text, styles_map))
        # Narrative decisions need reading width; a five-column grid makes
        # original names and execution conditions unreadable on portrait A4.
        if key in ("anomalies", "budget_bid", "execution_plan"):
            for index, item in enumerate(records, 1):
                heading = para(f"{index}. {text(item.get('object'))}", styles_map["h3"])
                heading.keepWithNext = True
                story.append(heading)
                rows = [[label, item.get(field, "未知")] for label, field in columns if field != "object"]
                known = {field for _, field in columns}
                rows += [[str(field), value] for field, value in item.items() if field not in known and value not in (None, "")]
                story.append(make_table(rows, [30 * mm, 130 * mm], styles_map, header=False))
                story.append(Spacer(1, 3 * mm))
            return
        rows = [[label for label, _ in columns]]
        for item in records:
            rows.append([item.get(field, "未知") if isinstance(item, dict) else "未知" for _, field in columns])
        story.append(make_table(rows, widths, styles_map))

    add_records("三、异常问题清单", "anomalies", [("优先级", "priority"), ("对象", "object"), ("问题", "issue"), ("证据", "evidence"), ("建议动作", "action")], [20 * mm, 27 * mm, 42 * mm, 40 * mm, 31 * mm])
    add_records("四、搜索词优化", "search_terms", [("搜索词", "term"), ("类型", "classification"), ("指标证据", "evidence"), ("建议", "recommendation"), ("确认", "confirmation")], [34 * mm, 23 * mm, 43 * mm, 42 * mm, 18 * mm])
    add_records("五、投放目标优化", "targets", [("目标", "target"), ("问题", "issue"), ("证据", "evidence"), ("建议调整", "recommendation"), ("复查", "review")], [32 * mm, 35 * mm, 38 * mm, 38 * mm, 17 * mm])
    add_records("六、广告位分析", "placements", [("广告位", "placement"), ("曝光/点击", "traffic"), ("转化/成本", "efficiency"), ("建议", "recommendation")], [30 * mm, 40 * mm, 45 * mm, 45 * mm])
    add_records("七、预算与竞价建议", "budget_bid", [("对象", "object"), ("当前", "current"), ("建议调整", "recommendation"), ("观察周期", "observation"), ("止损/回退", "rollback")], [29 * mm, 29 * mm, 42 * mm, 27 * mm, 33 * mm])
    add_records("八、否定词建议", "negatives", [("词/目标", "term"), ("匹配方式", "match_type"), ("证据", "evidence"), ("建议", "recommendation"), ("语言备注", "language_note")], [32 * mm, 24 * mm, 41 * mm, 40 * mm, 23 * mm])
    add_records("九、优先级执行清单", "execution_plan", [("优先级", "priority"), ("对象", "object"), ("动作", "action"), ("验收指标", "acceptance"), ("人工确认", "confirmation")], [20 * mm, 30 * mm, 49 * mm, 39 * mm, 22 * mm])
    add_records("十、复盘计划", "review_plan", [("时间点", "when"), ("检查内容", "check"), ("验收指标", "acceptance"), ("触发回退", "rollback")], [27 * mm, 53 * mm, 48 * mm, 32 * mm])
    add_records("十一、风险、止损与回退", "risks", [("风险", "risk"), ("影响", "impact"), ("预防", "mitigation"), ("回退条件", "rollback")], [38 * mm, 38 * mm, 45 * mm, 39 * mm])

    for extra in data.get("sections") or []:
        story += section(extra["title"], styles_map)
        for paragraph in extra.get("paragraphs") or []:
            story.append(para(paragraph, styles_map["body"]))
        if extra.get("columns") and extra.get("rows"):
            columns = extra["columns"]
            # Wide metrics tables are split automatically, repeating the
            # object column. Preserve all values without a model repair turn.
            groups = [list(range(len(columns)))] if len(columns) <= 6 else [
                [0] + list(range(start, min(start + 5, len(columns))))
                for start in range(1, len(columns), 5)
            ]
            for indices in groups:
                rows = [[row[i] for i in indices] for row in [columns] + extra["rows"]]
                story.append(make_table(rows, [160 * mm / len(indices)] * len(indices), styles_map))
                story.append(Spacer(1, 2 * mm))

    sources = data.get("sources") or []
    story += section("十二、来源与说明", styles_map)
    if sources:
        for source in sources:
            story.append(Paragraph("• " + text(source), styles_map["body"]))
    else:
        story.append(Paragraph("未提供来源明细。请以数据质量部分的覆盖范围和数据截至时间为准。", styles_map["body"]))

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(GRID)
        canvas.line(15 * mm, 11 * mm, A4[0] - 15 * mm, 11 * mm)
        canvas.setFont(regular, 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(15 * mm, 6.5 * mm, "Amazon Advertising AI Optimizer · 仅供运营分析与人工确认")
        canvas.drawRightString(A4[0] - 15 * mm, 6.5 * mm, f"{document.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render an Amazon advertising report PDF")
    parser.add_argument("--input", required=True, help="Structured report JSON")
    parser.add_argument("--output", required=True, help="PDF path under the task output directory")
    args = parser.parse_args()
    try:
        data = json.loads(Path(args.input).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError("report JSON must be an object")
        render(data, Path(args.output))
        print(json.dumps({"output": str(Path(args.output)), "pages": "generated"}, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"render_ad_report failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
