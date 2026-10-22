import math
import random

from mathutils import Vector

from g16_geo import (Bag, Geo, T, Rz, Sc, bx, rbox, rrect, circle, circle_matching, prism, ring, cylz, cylx,
                     cyly, section, section_ring, strip, text_geo, text_lines, annulus_top, disk_top, barcode,
                     datamatrix)

PASSIVE_SIZES = {
    "0201": (0.6, 0.3, 0.3),
    "0402": (1.0, 0.5, 0.35),
    "0603": (1.6, 0.8, 0.45),
    "0805": (2.0, 1.25, 0.6),
    "1206": (3.2, 1.6, 0.6),
}
_PASSIVE = {}


def passive(size, body):
    key = (size, body)
    if key in _PASSIVE:
        return _PASSIVE[key]
    l, w, h = PASSIVE_SIZES[size]
    e = l * 0.22
    b = Bag()
    b.add(body, bx(-l / 2 + e, l / 2 - e, -w / 2, w / 2, 0.02, h))
    b.add("solder", bx(-l / 2, -l / 2 + e, -w / 2, w / 2, 0.0, h + 0.01))
    b.add("solder", bx(l / 2 - e, l / 2, -w / 2, w / 2, 0.0, h + 0.01))
    _PASSIVE[key] = b
    return b


def marking(lines, size, z, rot=0.0):
    return Geo().merge(text_lines(lines, size, 0.0), T(0, 0, z) @ Rz(rot))


def qfn(w, d, h, nx, ny, lines=None, size=0.55, body="chip", pad="solder"):
    b = Bag()
    b.add(body, prism(rrect(0, 0, w, d, 0.12, 2), 0.0, h, top_loop=rrect(0, 0, w - 0.08, d - 0.08, 0.1, 2)))
    pw, pl = min(0.24, w * 0.8 / max(nx, 1) * 0.55), 0.42
    for i in range(nx):
        x = (i - (nx - 1) / 2) * (w * 0.8 / max(nx, 1))
        b.add(pad, bx(x - pw / 2, x + pw / 2, -d / 2 - 0.03, -d / 2 + pl, 0, 0.16))
        b.add(pad, bx(x - pw / 2, x + pw / 2, d / 2 - pl, d / 2 + 0.03, 0, 0.16))
    pw2 = min(0.24, d * 0.8 / max(ny, 1) * 0.55)
    for i in range(ny):
        y = (i - (ny - 1) / 2) * (d * 0.8 / max(ny, 1))
        b.add(pad, bx(-w / 2 - 0.03, -w / 2 + pl, y - pw2 / 2, y + pw2 / 2, 0, 0.16))
        b.add(pad, bx(w / 2 - pl, w / 2 + 0.03, y - pw2 / 2, y + pw2 / 2, 0, 0.16))
    if lines:
        b.add("marking", marking(lines, size, h + 0.004))
    b.add("pin1", disk_top(-w / 2 + 0.6, d / 2 - 0.6, min(0.28, w * 0.06), h + 0.003, 10))
    return b


def lqfp(w, n, h=1.4, lines=None, size=0.9):
    b = Bag()
    b.add("chip", prism(rrect(0, 0, w, w, 0.2, 2), 0.1, 0.1 + h, top_loop=rrect(0, 0, w - 0.2, w - 0.2, 0.15, 2)))
    pitch = (w - 1.6) / max(n - 1, 1)
    lead = Geo()
    for i in range(n):
        o = -(w - 1.6) / 2 + i * pitch
        lead.merge(bx(w / 2, w / 2 + 0.45, o - 0.09, o + 0.09, 0.62, 0.78))
        lead.merge(bx(w / 2 + 0.45, w / 2 + 0.6, o - 0.09, o + 0.09, 0.0, 0.78))
        lead.merge(bx(w / 2 + 0.6, w / 2 + 1.05, o - 0.09, o + 0.09, 0.0, 0.15))
    for k in range(4):
        b.add("solder", lead, Rz(k * math.pi / 2))
    if lines:
        b.add("marking", marking(lines, size, 0.1 + h + 0.004))
    b.add("pin1", disk_top(-w / 2 + 1.2, w / 2 - 1.2, 0.45, 0.1 + h + 0.003, 12))
    return b


def soic(n_side, w=5.0, d=4.0, h=1.5, lines=None, size=0.5):
    b = Bag()
    b.add("chip", prism(rrect(0, 0, w, d, 0.1, 2), 0.1, 0.1 + h, top_loop=rrect(0, 0, w - 0.15, d - 0.15, 0.08, 2)))
    pitch = 1.27
    lead = Geo()
    for i in range(n_side):
        x = (i - (n_side - 1) / 2) * pitch
        lead.merge(bx(x - 0.2, x + 0.2, d / 2, d / 2 + 0.5, 0.6, 0.8))
        lead.merge(bx(x - 0.2, x + 0.2, d / 2 + 0.5, d / 2 + 0.7, 0.0, 0.8))
        lead.merge(bx(x - 0.2, x + 0.2, d / 2 + 0.7, d / 2 + 1.2, 0.0, 0.18))
    b.add("solder", lead)
    b.add("solder", lead, Rz(math.pi))
    if lines:
        b.add("marking", marking(lines, size, 0.1 + h + 0.004))
    b.add("pin1", disk_top(-w / 2 + 0.6, -d / 2 + 0.6, 0.3, 0.1 + h + 0.003, 10))
    return b


def balls(w, d, gap, pitch=0.8, rows=2, r=0.24):
    g = Geo()
    nx = max(2, int((w - 1.2) / pitch) + 1)
    ny = max(2, int((d - 1.2) / pitch) + 1)
    x0 = -(nx - 1) * pitch / 2
    y0 = -(ny - 1) * pitch / 2
    for i in range(nx):
        for j in range(ny):
            if min(i, j, nx - 1 - i, ny - 1 - j) < rows:
                g.merge(cylz(x0 + i * pitch, y0 + j * pitch, 0.0, gap + 0.02, r, 6, top_r=r * 0.85))
    return g


def bga(w, d, h, lines=None, size=0.9, gap=0.3, body="chip"):
    b = Bag()
    b.add("solder", balls(w, d, gap))
    b.add(body, prism(rrect(0, 0, w, d, 0.25, 2), gap, gap + h, top_loop=rrect(0, 0, w - 0.1, d - 0.1, 0.2, 2)))
    if lines:
        b.add("marking", marking(lines, size, gap + h + 0.004))
    b.add("pin1", disk_top(-w / 2 + 1.0, d / 2 - 1.0, 0.45, gap + h + 0.003, 14))
    return b


def cap_field(rng, x0, x1, y0, y1, z, step=0.9, size="0201", body="mlcc", density=0.85, rot90=False):
    b = Bag()
    p = passive(size, body)
    nx = max(1, int((x1 - x0) / step))
    ny = max(1, int((y1 - y0) / (step * 0.75)))
    for i in range(nx):
        for j in range(ny):
            if rng.random() > density:
                continue
            x = x0 + (i + 0.5) * (x1 - x0) / nx
            y = y0 + (j + 0.5) * (y1 - y0) / ny
            b.put(p, T(x, y, z) @ Rz(math.pi / 2 if rot90 else 0.0))
    return b


def cpu_package(rng):
    w, d = 45.0, 37.5
    gap, sub = 0.45, 1.1
    b = Bag()
    b.add("solder", balls(w, d, gap, pitch=0.65, rows=2, r=0.2))
    b.add("copperdark", prism(rrect(0, 0, w, d, 0.4, 3), gap, gap + sub * 0.55))
    b.add("substrate", prism(rrect(0, 0, w - 0.1, d - 0.1, 0.35, 3), gap + sub * 0.55, gap + sub))
    top = gap + sub
    dw, dd = 23.8, 10.8
    b.add("underfill", prism(rrect(0, 0, dw + 1.4, dd + 1.4, 0.6, 3), top, top + 0.25,
                             top_loop=rrect(0, 0, dw + 0.2, dd + 0.2, 0.2, 3)))
    b.add("die", prism(rrect(0, 0, dw, dd, 0.05, 1), top, top + 0.75, top_loop=rrect(0, 0, dw - 0.12, dd - 0.12, 0.03, 1)))
    b.put(cap_field(rng, -dw / 2, dw / 2, dd / 2 + 1.2, dd / 2 + 5.2, top, 0.85))
    b.put(cap_field(rng, -dw / 2, dw / 2, -dd / 2 - 5.2, -dd / 2 - 1.2, top, 0.85))
    b.put(cap_field(rng, dw / 2 + 1.2, dw / 2 + 5.0, -dd / 2, dd / 2, top, 0.85, rot90=True))
    b.put(cap_field(rng, -dw / 2 - 5.0, -dw / 2 - 1.2, -dd / 2, dd / 2, top, 0.85, rot90=True))
    p = passive("0402", "mlcc")
    for sx in (-1, 1):
        for i in range(6):
            b.put(p, T(sx * (w / 2 - 2.0), -d / 2 + 4 + i * 1.3, top))
    b.add("silk", Geo().merge(text_lines(["INTEL ©'22", "i7-13650HX", "SRMCF  V3XK"], 1.5, 0.0),
                              T(-6.0, -d / 2 + 6.5, top + 0.004)))
    b.add("silk", datamatrix(rng, w / 2 - 6.5, -d / 2 + 5.2, 5.0, top + 0.002, 14))
    b.add("gold", Geo().add([(-w / 2 + 1.0, d / 2 - 1.0, top + 0.004), (-w / 2 + 3.2, d / 2 - 1.0, top + 0.004),
                             (-w / 2 + 1.0, d / 2 - 3.2, top + 0.004)], [[0, 2, 1]]))
    return b, top + 0.75


def gpu_package(rng):
    w = 35.0
    gap, sub = 0.45, 1.2
    b = Bag()
    b.add("solder", balls(w, w, gap, pitch=0.7, rows=2, r=0.21))
    b.add("pcbdark", prism(rrect(0, 0, w, w, 0.4, 3), gap, gap + sub))
    top = gap + sub
    dw = 12.6
    b.add("blacksteel", ring(rrect(0, 0, 31.5, 31.5, 1.2, 3), rrect(0, 0, 19.5, 19.5, 0.8, 3), top, top + 0.35))
    b.add("underfill", prism(rrect(0, 0, dw + 1.4, dw + 1.4, 0.6, 3), top, top + 0.25,
                             top_loop=rrect(0, 0, dw + 0.2, dw + 0.2, 0.2, 3)))
    b.add("die", prism(rrect(0, 0, dw, dw, 0.05, 1), top, top + 0.75, top_loop=rrect(0, 0, dw - 0.12, dw - 0.12, 0.03, 1)))
    b.add("marking", Geo().merge(text_lines(["NVIDIA", "AD107-400-A1", "2318A1  TAIWAN"], 0.85, 0.0),
                                 T(0, 0, top + 0.755)))
    b.put(cap_field(rng, -8.6, 8.6, 7.6, 9.4, top, 0.75))
    b.put(cap_field(rng, -8.6, 8.6, -9.4, -7.6, top, 0.75))
    b.put(cap_field(rng, 7.6, 9.4, -8.6, 8.6, top, 0.75, rot90=True))
    b.put(cap_field(rng, -9.4, -7.6, -8.6, 8.6, top, 0.75, rot90=True))
    b.add("silk", Geo().merge(text_lines(["GN21-X4-A1"], 0.9, 0.0), T(0, -w / 2 + 0.9, top + 0.004)))
    b.add("silk", datamatrix(rng, w / 2 - 2.2, -w / 2 + 2.2, 2.6, top + 0.002, 10))
    return b, top + 0.75


def pch_package(rng):
    w, d = 25.0, 24.0
    gap, sub = 0.4, 1.0
    b = Bag()
    b.add("solder", balls(w, d, gap, pitch=0.65, rows=2, r=0.2))
    b.add("substrate", prism(rrect(0, 0, w, d, 0.3, 3), gap, gap + sub))
    top = gap + sub
    b.add("underfill", prism(rrect(0, 0, 9.4, 11.4, 0.5, 3), top, top + 0.2, top_loop=rrect(0, 0, 8.2, 10.2, 0.2, 3)))
    b.add("die", prism(rrect(0, 0, 8.0, 10.0, 0.05, 1), top, top + 0.6))
    b.put(cap_field(rng, -9.5, -5.5, -8, 8, top, 0.8, rot90=True))
    b.put(cap_field(rng, 5.5, 9.5, -8, 8, top, 0.8, rot90=True))
    b.add("silk", Geo().merge(text_lines(["intel", "HM770", "SRLDA"], 1.2, 0.0), T(0, -d / 2 + 4.0, top + 0.004)))
    return b, top + 0.6


def choke(w, h, label="R22"):
    b = Bag()
    b.add("ferrite", prism(rrect(0, 0, w, w, 0.7, 3), 0.15, h, top_loop=rrect(0, 0, w - 0.5, w - 0.5, 0.5, 3)))
    b.add("solder", bx(-w / 2 - 0.05, -w / 2 + 1.3, -w * 0.32, w * 0.32, 0.0, 0.7))
    b.add("solder", bx(w / 2 - 1.3, w / 2 + 0.05, -w * 0.32, w * 0.32, 0.0, 0.7))
    b.add("marking", Geo().merge(text_geo(label, w * 0.28), T(0, 0, h + 0.004)))
    return b


def spcap(label="470"):
    b = Bag()
    l, w, h = 7.3, 4.3, 1.9
    b.add("spcap", prism(rrect(0, 0, l, w, 0.4, 2), 0.05, h, top_loop=rrect(0, 0, l - 0.3, w - 0.3, 0.3, 2)))
    b.add("silk", bx(-l / 2 + 0.4, -l / 2 + 1.3, -w / 2 + 0.3, w / 2 - 0.3, h, h + 0.01))
    b.add("solder", bx(-l / 2 - 0.05, -l / 2 + 0.9, -1.2, 1.2, 0.0, 0.5))
    b.add("solder", bx(l / 2 - 0.9, l / 2 + 0.05, -1.2, 1.2, 0.0, 0.5))
    b.add("marking", Geo().merge(text_lines([label, "2.5V"], 0.9, 0.0), T(0.6, 0, h + 0.004)))
    return b


def crystal(l=3.2, w=2.5, h=0.8):
    b = Bag()
    b.add("chip", bx(-l / 2, l / 2, -w / 2, w / 2, 0.0, 0.25))
    b.add("steel", prism(rrect(0, 0, l - 0.3, w - 0.3, 0.3, 3), 0.25, h))
    return b


def drmos():
    return qfn(5.0, 6.0, 0.9, 4, 4, ["AOZ5332", "QI"], 0.5)


def zif(n, pitch=0.5, depth=4.2, h=1.2):
    w = n * pitch + 2.6
    b = Bag()
    b.add("zif", bx(-w / 2, w / 2, -depth / 2, depth * 0.1, 0.0, h))
    b.add("plastic", bx(-w / 2 + 0.5, w / 2 - 0.5, depth * 0.1, depth / 2, 0.15, h * 0.92))
    b.add("pin1", bx(-w / 2 + 1.2, w / 2 - 1.2, -depth / 2 + 0.2, -depth / 2 + 0.9, h * 0.4, h + 0.01))
    for i in range(n):
        x = (i - (n - 1) / 2) * pitch
        b.add("gold", bx(x - 0.1, x + 0.1, -depth / 2 - 0.6, -depth / 2 + 0.05, 0.0, 0.12))
    b.add("solder", bx(-w / 2 - 0.6, -w / 2 + 0.2, -0.9, 0.9, 0.0, 0.8))
    b.add("solder", bx(w / 2 - 0.2, w / 2 + 0.6, -0.9, 0.9, 0.0, 0.8))
    return b


def jst(n, pitch=1.0, body="zif"):
    w = n * pitch + 2.0
    b = Bag()
    b.add(body, bx(-w / 2, w / 2, -1.5, 1.5, 0.0, 2.9))
    for i in range(n):
        x = (i - (n - 1) / 2) * pitch
        b.add("pin1", bx(x - 0.3, x + 0.3, -1.55, -1.0, 0.8, 2.3))
        b.add("gold", bx(x - 0.12, x + 0.12, 1.5, 2.3, 0.0, 0.15))
    b.add("solder", bx(-w / 2 - 0.5, -w / 2 + 0.3, -0.6, 0.6, 0.0, 1.6))
    b.add("solder", bx(w / 2 - 0.3, w / 2 + 0.5, -0.6, 0.6, 0.0, 1.6))
    return b


def plug(n, pitch=1.0, wires=("wirered", "cableblack")):
    w = n * pitch + 1.0
    b = Bag()
    b.add("zif", bx(-w / 2, w / 2, -1.2, 1.2, 0.0, 2.4))
    for i in range(n):
        x = (i - (n - 1) / 2) * pitch
        b.add(wires[i % len(wires)], cyly(-6.0, -1.2, x, 1.2, 0.3, 8))
    return b


def m2_socket(depth=22.0, h=3.2, key=5.6):
    b = Bag()
    b.add("plastic", bx(-3.0, 3.0, -depth / 2, depth / 2, 0.0, h))
    b.add("pin1", bx(-3.05, 3.05, key - 0.6, key + 0.6, h * 0.25, h + 0.01))
    for i in range(34):
        y = -depth / 2 + 1.2 + i * (depth - 2.4) / 33
        b.add("gold", bx(-3.6, -2.95, y - 0.12, y + 0.12, 0.0, 0.12))
    b.add("solder", bx(-1.5, 1.5, -depth / 2 - 0.8, -depth / 2 + 0.1, 0.0, 1.2))
    b.add("solder", bx(-1.5, 1.5, depth / 2 - 0.1, depth / 2 + 0.8, 0.0, 1.2))
    return b


def fingers(x0, x1, y_edge, depth, z, pitch=0.5, width=0.32, notch=None, toward=1):
    g = Geo()
    x = x0
    while x <= x1:
        if not (notch and notch[0] <= x <= notch[1]):
            if toward > 0:
                g.merge(bx(x - width / 2, x + width / 2, y_edge + 0.15, y_edge + depth, z, z + 0.03))
            else:
                g.merge(bx(x - width / 2, x + width / 2, y_edge - depth, y_edge - 0.15, z, z + 0.03))
        x += pitch
    return g


def card_outline(w, d, notch_x=None, notch_w=1.2, notch_d=4.0, half_moon=True, side_notches=False, r=0.6):
    pts = []
    pts.append((-w / 2, -d / 2))
    if notch_x is not None:
        pts += [(notch_x - notch_w / 2, -d / 2), (notch_x - notch_w / 2, -d / 2 + notch_d),
                (notch_x + notch_w / 2, -d / 2 + notch_d), (notch_x + notch_w / 2, -d / 2)]
    pts.append((w / 2, -d / 2))
    if side_notches:
        for k in range(9):
            a = -math.pi / 2 + math.pi * k / 8
            pts.append((w / 2 - 1.5 * math.cos(a), 1.0 + 1.5 * math.sin(a)))
    pts.append((w / 2, d / 2))
    if half_moon:
        for k in range(9):
            a = math.pi * k / 8
            pts.append((1.75 * math.cos(a), d / 2 - 1.75 * math.sin(a)))
    pts.append((-w / 2, d / 2))
    if side_notches:
        for k in range(9):
            a = -math.pi / 2 + math.pi * k / 8
            pts.append((-w / 2 + 1.5 * math.cos(a), 1.0 - 1.5 * math.sin(a)))
    return pts


def sodimm(rng, label=True):
    w, d, t = 69.6, 30.0, 1.0
    b = Bag()
    outline = card_outline(w, d, notch_x=-4.0, notch_w=1.0, notch_d=3.0, half_moon=False, side_notches=True)
    b.add("mask", prism(outline, 0.0, t))
    b.add("gold", fingers(-w / 2 + 2.0, w / 2 - 2.0, -d / 2, 3.2, t, 0.5, 0.32, (-4.6, -3.4)))
    b.add("gold", fingers(-w / 2 + 2.0, w / 2 - 2.0, -d / 2, 3.2, -0.03, 0.5, 0.32, (-4.6, -3.4)))
    chip_lines = ["SK hynix", "H5CG48AGBDX018N", "AAB  2307"]
    chip = bga(10.0, 11.5, 1.0, chip_lines, 0.7, gap=0.25)
    for x in (-26.5, -14.5, 4.5, 16.5):
        b.put(chip, T(x, 1.5, t))
        b.put(chip, Sc(1, 1, -1) @ T(x, 1.5, 0.0))
    b.put(qfn(3.2, 3.2, 0.8, 6, 6, ["PMIC", "5100"], 0.45), T(-5.0, 6.0, t))
    b.put(choke(2.5, 1.0, "1R0"), T(-5.0, -2.2, t))
    b.put(choke(2.5, 1.0, "1R0"), T(-2.0, 9.5, t))
    b.put(qfn(2.0, 2.0, 0.6, 4, 4), T(28.0, 9.0, t))
    for x in range(-30, 31, 3):
        b.put(passive("0402", "mlcc"), T(x, -9.6, t) @ Rz(math.pi / 2))
    for i in range(10):
        b.put(passive("0201", "resistor"), T(-8.0 + i * 0.8, 11.5, t) @ Rz(math.pi / 2))
    if label:
        b.add("label", rbox(16.0, 10.3, 24.0, 7.2, t, t + 0.06, 0.6, 3))
        b.add("labeltext", Geo().merge(text_lines(["16GB 1Rx8 PC5-4800B", "SA0-1010-XT"], 0.9, 0.0),
                                       T(13.5, 11.2, t + 0.065)))
        b.add("labeltext", barcode(rng, 5.0, 7.3, 18.0, 1.4, t + 0.062))
    for x in (-w / 2 + 6, w / 2 - 6):
        b.add("via", annulus_top(x, d / 2 - 3.0, 1.2, 0.6, t + 0.02, 12))
    return b


def dimm_slot():
    b = Bag()
    b.add("plastic", bx(-37.0, 37.0, -3.0, 3.0, 0.0, 3.4))
    b.add("pin1", bx(-34.5, 34.5, 2.95, 3.05, 1.2, 2.4))
    for i in range(70):
        x = -34.0 + i * 0.98
        b.add("gold", bx(x - 0.12, x + 0.12, -3.6, -2.95, 0.0, 0.12))
    for sx in (-1, 1):
        b.add("plastic", bx(sx * 37.0 - 1.4, sx * 37.0 + 1.4, -3.0, 14.0, 0.0, 3.4))
        b.add("steel", bx(sx * 37.0 - 1.0, sx * 37.0 + 1.0, 14.0, 26.0, 2.8, 3.3))
        b.add("steel", bx(sx * 36.2 - 0.8, sx * 36.2 + 0.8, 13.5, 16.5, 1.4, 3.3))
        b.add("steel", bx(sx * 37.0 - 1.0, sx * 37.0 + 1.0, 24.5, 26.5, 2.8, 4.4))
    return b


def ssd_card(rng):
    w, d, t = 22.0, 80.0, 0.8
    b = Bag()
    b.add("ssdpcb", prism(card_outline(w, d, notch_x=4.4, notch_w=1.2, notch_d=4.0, half_moon=True), 0.0, t))
    b.add("gold", fingers(-w / 2 + 1.0, w / 2 - 1.0, -d / 2, 2.6, t, 0.5, 0.32, (3.8, 5.0)))
    b.add("gold", fingers(-w / 2 + 1.0, w / 2 - 1.0, -d / 2, 2.6, -0.03, 0.5, 0.32, (3.8, 5.0)))
    b.put(bga(11.5, 11.5, 1.0, ["KIOXIA", "TC58NC1110", "2310KAI"], 0.75, gap=0.2), T(0, -24.0, t) @ Rz(math.pi / 2))
    nand = bga(14.0, 18.0, 1.1, ["KIOXIA", "TH58LJT2T24", "TAIWAN 2302"], 0.8, gap=0.2)
    b.put(nand, T(0, -4.5, t))
    b.put(nand, T(0, 15.0, t))
    b.put(qfn(3.0, 3.0, 0.8, 5, 5, ["PMU"], 0.5), T(-6.0, -33.5, t))
    b.put(choke(2.5, 1.0, "R47"), T(6.0, -33.5, t))
    for i in range(16):
        b.put(passive("0402", "mlcc"), T(-9.6 if i < 8 else 9.6, -30.0 + (i % 8) * 1.5, t) @ Rz(math.pi / 2))
    for i in range(8):
        b.put(passive("0201", "resistor"), T(-3.0 + i * 0.8, 27.0, t) @ Rz(math.pi / 2))
    lab = Geo().merge(text_lines(["DELL  512GB SSD", "PCIe NVMe Gen4 M.2 2280", "DP/N 0X9T3K  REV A00"],
                                 [1.4, 1.0, 0.9], 0.0), Rz(math.pi / 2))
    b.add("label", rbox(0, 5.0, 19.0, 40.0, t + 1.31, t + 1.37, 0.8, 3))
    b.add("labeltext", lab, T(3.5, 5.0, t + 1.38))
    b.add("labeltext", Geo().merge(barcode(rng, -14.0, -1.6, 28.0, 3.2, 0.0), T(0, 0, t + 1.375) @ Rz(math.pi / 2)),
          T(-5.0, 5.0, 0))
    b.add("labeltext", datamatrix(rng, -5.5, 20.0, 5.0, t + 1.375, 12))
    b.add("via", annulus_top(0, d / 2 - 1.75, 1.4, 0.9, t + 0.01, 14))
    return b


def wifi_card(rng):
    w, d, t = 22.0, 30.0, 0.8
    b = Bag()
    pts = card_outline(w, d, notch_x=-w / 2 + 6.625, notch_w=1.2, notch_d=4.0, half_moon=True)
    b.add("pcbdark", prism(pts, 0.0, t))
    b.add("gold", fingers(-w / 2 + 1.0, w / 2 - 1.0, -d / 2, 2.6, t, 0.5, 0.32, (-w / 2 + 6.0, -w / 2 + 7.3)))
    b.add("gold", fingers(-w / 2 + 1.0, w / 2 - 1.0, -d / 2, 2.6, -0.03, 0.5, 0.32, (-w / 2 + 6.0, -w / 2 + 7.3)))
    b.add("alu", prism(rrect(0, -1.0, 19.0, 19.0, 0.8, 3), t, t + 1.6, top_loop=rrect(0, -1.0, 18.6, 18.6, 0.6, 3)))
    b.add("label", rbox(0, -1.0, 17.5, 17.5, t + 1.6, t + 1.65, 0.6, 3))
    b.add("labeltext", Geo().merge(text_lines(["Intel® Wi-Fi 6E AX211", "AX211NGW", "FCC ID: PD9AX211NG",
                                               "IC: 1000M-AX211NG"], [0.95, 0.85, 0.7, 0.7], 0.0),
                                   T(0, 3.2, t + 1.66)))
    b.add("labeltext", datamatrix(rng, -4.5, -6.0, 5.0, t + 1.655, 12))
    b.add("labeltext", barcode(rng, 0.0, -8.4, 7.5, 4.6, t + 1.655, 22))
    for x, lab in ((-4.0, "MAIN"), (4.0, "AUX")):
        b.add("gold", cylz(x, 11.4, t, t + 1.25, 1.0, 16))
        b.add("silk", Geo().merge(text_geo(lab, 0.8), T(x, 13.6, t + 0.004)))
    b.add("via", annulus_top(0, d / 2 - 1.75, 1.4, 0.9, t + 0.01, 14))
    return b


def ufl_cable(path3d, mat):
    from g16_geo import pipe_geo
    b = Bag()
    b.add(mat, pipe_geo(path3d, 0.55, 1.0, 4.0, 2))
    p = path3d[0]
    b.add("gold", cylz(p[0], p[1], p[2] - 0.2, p[2] + 1.0, 1.2, 16))
    return b


def screw(r=1.6, h=0.8, phillips=True):
    b = Bag()
    b.add("steel", cylz(0, 0, 0.0, h, r, 20, top_r=r * 0.82))
    if phillips:
        b.add("pin1", bx(-r * 0.6, r * 0.6, -0.12, 0.12, h - 0.02, h + 0.01))
        b.add("pin1", bx(-0.12, 0.12, -r * 0.6, r * 0.6, h - 0.02, h + 0.01))
    return b


def usb_a(axis, along0, along1, cu, cw, inner_mat="portin"):
    b = Bag()
    w, h = 12.4, 4.9
    o = rrect(cu, cw, w, h, 0.3, 2)
    i = rrect(cu, cw, w - 0.6, h - 0.6, 0.15, 2)
    b.add("steel", section_ring(o, i, along0, along1, axis))
    b.add("steel", section(rrect(cu, cw, w, h, 0.3, 2), along0 - 0.3, along0, axis))
    b.add(inner_mat, section(rrect(cu, cw + 0.85, w - 1.6, 1.8, 0.2, 2), along0, along1 - 0.6, axis))
    for k in range(5):
        u = cu - 4.0 + k * 2.0
        b.add("gold", section(rrect(u, cw - 0.07, 0.8, 0.12, 0.02, 1), along0 + 2.0, along1 - 1.2, axis))
    return b


def hdmi(axis, along0, along1, cu, cw):
    def loop(w, h, ch):
        return [(cu + w / 2, cw - h / 2 + ch), (cu + w / 2, cw + h / 2), (cu - w / 2, cw + h / 2),
                (cu - w / 2, cw - h / 2 + ch), (cu - w / 2 + ch, cw - h / 2), (cu + w / 2 - ch, cw - h / 2)]
    b = Bag()
    b.add("steel", section_ring(loop(15.0, 5.6, 1.6), loop(14.4, 5.0, 1.4), along0, along1, axis))
    b.add("steel", section(loop(15.0, 5.6, 1.6), along0 - 0.3, along0, axis))
    b.add("portin", section(rrect(cu, cw + 0.4, 11.8, 1.2, 0.2, 2), along0, along1 - 0.8, axis))
    for k in range(10):
        u = cu - 5.0 + k * 1.1
        b.add("gold", section(rrect(u, cw - 0.25, 0.4, 0.1, 0.02, 1), along0 + 1.0, along1 - 1.4, axis))
    return b


def usb_c(axis, along0, along1, cu, cw):
    b = Bag()
    o = rrect(cu, cw, 8.6, 2.9, 1.45, 6)
    i = rrect(cu, cw, 8.1, 2.4, 1.2, 6)
    b.add("steel", section_ring(o, i, along0, along1, axis))
    b.add("steel", section(o, along0 - 0.3, along0, axis))
    b.add("portin", section(rrect(cu, cw, 6.6, 0.7, 0.3, 3), along0, along1 - 0.7, axis))
    for k in range(12):
        u = cu - 2.75 + k * 0.5
        b.add("gold", section(rrect(u, cw + 0.37, 0.25, 0.06, 0.02, 1), along0 + 1.0, along1 - 1.4, axis))
        b.add("gold", section(rrect(u, cw - 0.37, 0.25, 0.06, 0.02, 1), along0 + 1.0, along1 - 1.4, axis))
    return b


def dc_jack(axis, along0, along1, cu, cw):
    b = Bag()
    b.add("chip", section(rrect(cu, cw, 9.0, 10.0, 0.6, 3), along0, along1 - 1.0, axis))
    b.add("chip", section_ring(circle(cu, cw, 4.0, 32), circle(cu, cw, 3.1, 32), along1 - 1.0, along1, axis))
    b.add("pin1", section(circle(cu, cw, 3.1, 24), along1 - 6.0, along1 - 5.9, axis))
    b.add("steel", section(circle(cu, cw, 0.9, 16), along1 - 6.0, along1 - 0.8, axis))
    return b


def rj45(axis, along0, along1, cu, cw):
    b = Bag()
    b.add("chip", section_ring(rrect(cu, cw, 15.6, 11.2, 0.4, 2), rrect(cu, cw - 0.4, 13.8, 9.4, 0.3, 2),
                               along0, along1, axis))
    b.add("chip", section(rrect(cu, cw, 15.6, 11.2, 0.4, 2), along0 - 0.4, along0, axis))
    b.add("steel", section(rrect(cu, cw + 5.75, 15.8, 0.3, 0.05, 1), along0, along1 - 1.0, axis))
    for k in range(8):
        u = cu - 4.45 + k * 1.27
        b.add("gold", section(rrect(u, cw + 3.4, 0.3, 0.3, 0.05, 1), along0 + 3.0, along1 - 2.0, axis))
    b.add("ledgreen", section(rrect(cu - 5.6, cw + 4.4, 2.0, 1.2, 0.2, 2), along1 - 0.2, along1 + 0.05, axis))
    b.add("ledamber", section(rrect(cu + 5.6, cw + 4.4, 2.0, 1.2, 0.2, 2), along1 - 0.2, along1 + 0.05, axis))
    return b


def audio_jack(axis, along0, along1, cu, cw):
    b = Bag()
    b.add("chip", section(rrect(cu, cw, 7.0, 6.0, 0.5, 3), along0, along1 - 1.4, axis))
    b.add("chip", section_ring(circle(cu, cw, 3.0, 28), circle(cu, cw, 1.75, 28), along1 - 1.4, along1, axis))
    b.add("steel", section_ring(circle(cu, cw, 2.2, 28), circle(cu, cw, 1.75, 28), along1 - 0.1, along1 + 0.02, axis))
    return b


def fan_outline():
    pts = [(-41.0, -24.0)]
    for k in range(25):
        a = math.radians(225 + 135 * k / 24)
        r = 34.0 + 6.0 * k / 24
        pts.append((r * math.cos(a), r * math.sin(a)))
    pts.append((40.0, 41.0))
    pts.append((-41.0, 41.0))
    return pts


def fan_wall():
    pts = [(-41.0, -24.0)]
    for k in range(25):
        a = math.radians(225 + 135 * k / 24)
        r = 34.0 + 6.0 * k / 24
        pts.append((r * math.cos(a), r * math.sin(a)))
    pts.append((40.0, 41.0))
    return pts


def fan(rng, label_lines):
    b = Bag()
    outline = fan_outline()
    hole_b = circle_matching(outline, 0, 0, 29.0)
    b.add("fan", ring(outline, hole_b, 2.2, 2.7))
    b.add("fan", cylz(0, 0, 2.2, 3.2, 13.0, 32))
    for k in range(3):
        a = math.radians(90 + 120 * k)
        b.add("fan", bx(12.5, 29.5, -1.1, 1.1, 2.2, 2.7), Rz(a))
    b.add("fan", strip(fan_wall(), 1.2, 2.7, 11.7))
    hole_t = circle_matching(outline, 0, 0, 27.0)
    b.add("alu", ring(outline, hole_t, 14.4, 14.85))
    for a in range(0, 360, 30):
        r0 = 28.3
        b.add("alu", bx(-0.15, 0.15, r0, r0 + 0.6, 14.85, 14.9), Rz(math.radians(a)))
    for tx, ty in ((-38.0, -30.0), (46.0, 4.0), (46.0, 36.0)):
        tab = rrect(tx, ty, 9.0, 8.0, 2.5, 3)
        b.add("steel", ring(tab, circle_matching(tab, tx, ty, 1.3), 14.4, 14.85))
        b.put(screw(1.9, 0.9), T(tx, ty, 14.85))
    imp = Bag()
    imp.add("fan", cylz(0, 0, 3.4, 13.0, 12.6, 40, top_r=12.0))
    imp.add("fan", ring(circle(0, 0, 21.0, 48), circle(0, 0, 12.4, 48), 3.4, 3.9))
    imp.add("fan", ring(circle(0, 0, 33.4, 64), circle(0, 0, 30.8, 64), 13.0, 13.5))
    for i in range(47):
        a0 = 2 * math.pi * i / 47
        pts = []
        for k in range(6):
            rr = 13.4 + (33.0 - 13.4) * k / 5
            a = a0 + 0.55 * (k / 5) ** 1.2
            pts.append((rr * math.cos(a), rr * math.sin(a)))
        imp.add("fan", strip(pts, 0.38, 3.6, 9.6))
    imp.add("label", cylz(0, 0, 13.0, 13.08, 9.6, 40))
    imp.add("labeltext", Geo().merge(text_lines(label_lines, [1.6, 0.85, 0.85, 0.85], 0.0), T(0, 0.3, 13.09)))
    return b, imp


def fin_stack(x0, x1, y0, y1, z0, z1, along="x", pitch=1.2, t=0.15):
    g = Geo()
    if along == "x":
        x = x0
        while x <= x1:
            g.merge(bx(x - t / 2, x + t / 2, y0, y1, z0, z1))
            g.merge(bx(x - t / 2, x + pitch * 0.55, y0, y0 + 0.25, z0, z1))
            x += pitch
        g.merge(bx(x0, x1, y0, y1, z0 - 0.3, z0))
        g.merge(bx(x0, x1, y0, y1, z1, z1 + 0.3))
    else:
        y = y0
        while y <= y1:
            g.merge(bx(x0, x1, y - t / 2, y + t / 2, z0, z1))
            g.merge(bx(x0, x0 + 0.25, y - t / 2, y + pitch * 0.55, z0, z1))
            y += pitch
        g.merge(bx(x0, x1, y0, y1, z0 - 0.3, z0))
        g.merge(bx(x0, x1, y0, y1, z1, z1 + 0.3))
    return g


def spring_screw(r=2.0):
    b = Bag()
    b.add("blacksteel", cylz(0, 0, 0.0, 1.0, r, 20, top_r=r * 0.85))
    b.add("pin1", bx(-r * 0.6, r * 0.6, -0.13, 0.13, 0.98, 1.01))
    b.add("pin1", bx(-0.13, 0.13, -r * 0.6, r * 0.6, 0.98, 1.01))
    for k in range(4):
        b.add("steel", ring(circle(0, 0, r * 0.9, 16), circle(0, 0, r * 0.62, 16), -0.6 - k * 0.55, -0.32 - k * 0.55))
    b.add("steel", cylz(0, 0, -2.8, 0.0, 0.8, 10))
    return b
