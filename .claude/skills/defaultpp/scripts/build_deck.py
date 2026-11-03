#!/usr/bin/env python3

import json
import os
import sys

from lxml import etree
from PIL import Image
from pptx import Presentation
from pptx.enum.dml import MSO_THEME_COLOR
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

HERE = os.path.dirname(os.path.abspath(__file__))
TEMPLATE = os.path.join(HERE, "..", "assets", "template.pptx")

W = 80 / 3
H = 7.5
MARGIN = 0.5
TITLE_EM = 0.58
BODY_EM = 0.5


def wrapped_lines(text, width_in, pt, em):
    char_w = em * pt / 72
    max_chars = max(1, int(width_in / char_w))
    lines = 0
    for para in text.split("\n"):
        words = para.split()
        if not words:
            lines += 1
            continue
        cur = 0
        lines += 1
        for w in words:
            need = len(w) if cur == 0 else cur + 1 + len(w)
            if need > max_chars and cur > 0:
                lines += 1
                cur = len(w)
            else:
                cur = need
    return lines


def fit_size(paras, width_in, height_in, max_pt, min_pt, em, gap_pt=0, line=1.2):
    for pt in range(int(max_pt), int(min_pt) - 1, -2):
        total = 0.0
        for p in paras:
            total += wrapped_lines(p, width_in, pt, em) * pt * line / 72
        total += gap_pt * max(0, len(paras) - 1) / 72
        if total <= height_in:
            return pt
    return int(min_pt)


def white(run):
    run.font.color.theme_color = MSO_THEME_COLOR.BACKGROUND_1


def set_text(tf, paras, pt, bold=None, align=PP_ALIGN.LEFT, bullets=False, first_indent=None, gap_pt=14):
    tf.word_wrap = True
    for i, text in enumerate(paras):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        if gap_pt and i < len(paras) - 1:
            p.space_after = Pt(gap_pt)
        pPr = p._p.get_or_add_pPr()
        if bullets:
            indent = int(Inches(0.9))
            pPr.set("marL", str(indent))
            pPr.set("indent", str(-indent))
            buFont = etree.SubElement(pPr, qn("a:buFont"))
            buFont.set("typeface", "Arial")
            buChar = etree.SubElement(pPr, qn("a:buChar"))
            buChar.set("char", "•")
        elif first_indent:
            pPr.set("indent", str(int(Inches(first_indent))))
        r = p.add_run()
        r.text = text
        r.font.size = Pt(pt)
        if bold is not None:
            r.font.bold = bold
        white(r)


def add_photo(slide, path, side):
    with Image.open(path) as im:
        iw, ih = im.size
    max_w = W * 0.45
    full_w = H * iw / ih
    w = min(full_w, max_w)
    x = 0 if side == "left" else W - w
    pic = slide.shapes.add_picture(path, Inches(x), 0, Inches(w), Inches(H))
    if full_w > max_w:
        crop = (1 - max_w / full_w) / 2
        pic.crop_left = crop
        pic.crop_right = crop
    pic.name = "Photo"
    return w


def title_slide(prs, s, base):
    slide = prs.slides.add_slide(layout(prs, "Title"))
    x0, x1 = MARGIN, W - MARGIN
    if s.get("photo"):
        pw = add_photo(slide, os.path.join(base, s["photo"]), "left")
        x0 = pw + 0.4
    ph = title_ph(slide)
    ph.left, ph.top, ph.width, ph.height = Inches(x0), Inches(0.4), Inches(x1 - x0), Inches(H - 0.8)
    tf = ph.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    text = s.get("title", "")
    pt = fit_size([text], x1 - x0, H - 1.0, s.get("size", 200), 60, TITLE_EM, line=1.05)
    set_text(tf, [text], pt, bold=True, align=PP_ALIGN.CENTER, gap_pt=0)
    return slide


def content_slide(prs, s, base):
    slide = prs.slides.add_slide(layout(prs, "Content"))
    x0, x1 = MARGIN, W - MARGIN
    if s.get("photo"):
        pw = add_photo(slide, os.path.join(base, s["photo"]), "right")
        x1 = W - pw - 0.4
    top = MARGIN
    if s.get("title"):
        ph = title_ph(slide)
        ph.left, ph.top, ph.width, ph.height = Inches(x0), Inches(0.3), Inches(x1 - x0), Inches(1.3)
        tsize = fit_size([s["title"]], x1 - x0, 1.3, 60, 36, TITLE_EM, line=1.05)
        set_text(ph.text_frame, [s["title"]], tsize, bold=True, gap_pt=0)
        top = 1.6
    else:
        slide.shapes._spTree.remove(title_ph(slide)._element)
    box_w, box_h = x1 - x0, H - top - 0.3
    tb = slide.shapes.add_textbox(Inches(x0), Inches(top), Inches(box_w), Inches(box_h))
    tb.name = "Body"
    tf = tb.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    if s["type"] == "bullets":
        items = s.get("bullets", [])
        pt = fit_size(items, box_w - 1.0, box_h - 0.2, s.get("size", 48), 24, BODY_EM, gap_pt=14)
        set_text(tf, items, pt, bullets=True)
    else:
        paras = [p for p in s.get("text", "").split("\n") if p.strip()]
        pt = fit_size(paras, box_w - 0.2, box_h - 0.2, s.get("size", 54), 24, BODY_EM, gap_pt=14)
        set_text(tf, paras, pt, first_indent=1.0)
    return slide


def title_ph(slide):
    for ph in slide.placeholders:
        if ph.placeholder_format.type in (PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE):
            return ph
    return None


def layout(prs, name):
    for l in prs.slide_layouts:
        if l.name == name:
            return l
    raise SystemExit(f"layout {name} missing from template")


def main():
    spec_path = os.path.abspath(sys.argv[1])
    base = os.path.dirname(spec_path)
    with open(spec_path) as f:
        spec = json.load(f)
    prs = Presentation(TEMPLATE)
    prs.core_properties.title = spec.get("title", "")
    for s in spec["slides"]:
        kind = s.get("type", "bullets")
        if kind == "title":
            slide = title_slide(prs, s, base)
        elif kind in ("bullets", "paragraph"):
            slide = content_slide(prs, s, base)
        else:
            raise SystemExit(f"unknown slide type: {kind}")
        if s.get("notes"):
            slide.notes_slide.notes_text_frame.text = s["notes"]
    out = spec.get("output") or (spec.get("title", "Presentation") + ".pptx")
    out = out if os.path.isabs(out) else os.path.join(base, out)
    prs.save(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
