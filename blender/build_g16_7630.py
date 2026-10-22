import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from g16_geo import (M, S, CUR, Bag, Geo, T, Rx, Ry, Rz, Sc, build_materials, rrect, circle, circle_matching,
                     round_poly, prism, ring, annulus_top, disk_top, bx, rbox, cylz, cylx, cyly, section, tri,
                     strip, text_geo, text_lines, pipe_geo, collection, obj, empty, meta, apply_mods, boolean, cut,
                     in_poly, in_rects, barcode, datamatrix, shade)
import g16_parts as P
from g16_layout import BOARD, BOTTOM, TOP, VRM_CPU, VRM_GPU, MOUNTS, IC_MARKS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []

W, D = 356.98, 288.73
YF, YR = -D / 2, D / 2
SHELF = 26.0
YSF = YR - SHELF
ZF, ZR, ZSH = 13.7, 18.4, 24.9
CR, WALL = 8.0, 1.4
SLOPE = math.atan((ZR - ZF) / (YSF - YF))
GAP = 80.0
OPEN = 115.0
U = 19.05
HF = 0.7 * U
KY = 42.1
TPX, TPY = -10.0, -56.7
YP = YSF - 6.0
LT = 6.4
LL = YP - YF + 0.2
ACT_W, ACT_H = 344.68, 215.42
FAN_Y = 90.0
FAN_X = 119.5
ZT, ZB = 11.8, 10.6
REAR_Z = 13.5
REAR_PORTS = [("usbc", -40.0), ("usba", -15.0), ("hdmi", 12.0), ("dc", 42.0)]
LEFT_RJ45 = (25.0, 10.2)
LEFT_AUDIO = (-40.0, 9.5)
RIGHT_USB = [(0.0, 10.0), (22.0, 10.0)]
SCREWS = [(-168, -134), (168, -134), (-168, -20), (168, -20), (-168, 134), (168, 134),
          (-60, -134), (60, -134), (-60, 134), (60, 134)]
RNG = random.Random(7630)


def zdeck(y):
    return ZF + (y - YF) / (YSF - YF) * (ZR - ZF)


ZP = zdeck(YP) + LT / 2


def top_m(x, y, rot=0.0):
    return T(x, y, ZT) @ Rz(rot)


def bot_m(x, y, rot=0.0):
    return T(x, y, ZB) @ Ry(math.pi) @ Rz(rot)


BOT_FLAT = T(0, 0, ZB) @ Sc(1, 1, -1)
TOP_FLAT = T(0, 0, ZT)


def down_text(lines, size, x, y, z):
    return Geo().merge(text_lines(lines, size, 0.0), T(x, y, z) @ Ry(math.pi))


def build_bottom_cover():
    collection("COL_BottomCover")
    g = meta(empty("GRP_BottomCover"), "Bottom cover (D-cover)",
             "Base panel with perforated fan intakes, rubber feet and 10 captive screws.", (0, 0, 0), 0)
    loop = rrect(0, 0, W, D, CR)
    plate = obj("SM_BottomCover_Plate", prism(loop, 0, 1.6), M["bottom"], g)
    holes = []
    for fx in (-FAN_X, FAN_X):
        for row in range(-9, 10):
            y = FAN_Y + row * 3.4
            off = 2.4 if row % 2 else 0.0
            for col in range(-8, 9):
                x = fx + col * 4.8 + off
                if (x - fx) ** 2 + (y - FAN_Y) ** 2 < 32.0 ** 2:
                    holes.append(rbox(x, y, 3.6, 1.7, -1.0, 3.0, 0.85, 2))
    for row in range(16):
        y = 56 + row * 3.4
        off = 2.4 if row % 2 else 0.0
        for col in range(-12, 13):
            holes.append(rbox(col * 4.8 + off, y, 3.6, 1.7, -1.0, 3.0, 0.85, 2))
    for sx in (-1, 1):
        for row in range(9):
            for col in range(4):
                holes.append(cylz(sx * (156 + col * 3.2), -118 + row * 3.2 + (1.6 if col % 2 else 0), -1.0, 3.0, 1.0, 8))
    cut(plate, holes)
    shade(plate.data, 30)
    lip = ring(loop, rrect(0, 0, W - 2 * WALL, D - 2 * WALL, CR - WALL), 1.6, 5.0)
    obj("SM_BottomCover_Lip", lip, M["bottom"], g, smooth=True)
    inner = Bag()
    for x, y in SCREWS:
        inner.add("bottom", ring(circle(x, y, 3.0, 20), circle(x, y, 1.2, 20), 1.6, 5.0))
    for x in range(-150, 151, 50):
        inner.add("bottom", bx(x - 0.5, x + 0.5, -125, -60, 1.6, 1.95))
    for y in (-125, -60):
        inner.add("bottom", bx(-150, 150, y - 0.5, y + 0.5, 1.6, 1.95))
    inner.add("mylar", rbox(0, -97, 280, 60, 1.6, 1.7, 3.0))
    inner.emit("SM_BottomCover_Inner", g)
    feet = Bag()
    feet.add("rubber", prism(rrect(0, -128, 298, 5.4, 2.6, 4), -1.0, 0.05, top_loop=rrect(0, -128, 300, 7, 3.4, 4)))
    feet.add("rubber", prism(rrect(0, 131, 298, 6.2, 3.0, 4), -1.6, 0.05, top_loop=rrect(0, 131, 300, 8, 3.9, 4)))
    feet.emit("SM_BottomCover_Feet", g, smooth=("rubber",))
    scr = Bag()
    for x, y in SCREWS:
        scr.put(P.screw(2.4, 0.3), T(x, y, 0.05) @ Ry(math.pi))
    scr.emit("SM_BottomCover_Screws", g, smooth=("steel",))
    lab = Bag()
    lab.add("label", rbox(0, -40, 66, 30, -0.12, 0.0, 2.0, 3))
    lab.add("labeltext", down_text(["DELL  G16 7630", "Input: 20V ⎓ 12A / 16.5A", "Made in China"],
                                   [2.6, 1.6, 1.6], 8.0, -34.5, -0.13))
    lab.add("labeltext", Geo().merge(barcode(RNG, -26, -2.0, 40, 4.0, 0.0), T(4, -47.0, -0.13) @ Ry(math.pi)))
    lab.add("labeltext", Geo().merge(datamatrix(RNG, 0, 0, 9.0, 0.0, 14), T(-22.0, -34.5, -0.13) @ Ry(math.pi)))
    lab.emit("SM_BottomCover_Label", g)
    return g


def thermal_bracket(bag, cx, cy, ex, ey, start_num):
    for k, (sx, sy) in enumerate(((-1, 1), (1, 1), (1, -1), (-1, -1))):
        tx, ty = cx + sx * ex, cy + sy * ey
        v = Vector((tx - cx, ty - cy, 0))
        bag.add("blacksteel", bx(0, v.length, -3.2, 3.2, 3.8, 4.3), T(cx, cy, 0) @ Rz(math.atan2(v.y, v.x)))
        bag.add("blacksteel", cylz(tx, ty, 3.8, 4.3, 4.0, 20))
        bag.put(P.spring_screw(2.2), T(tx, ty, 3.8) @ Ry(math.pi))
        bag.add("silk", Geo().merge(text_geo(str(start_num + k), 2.2), T(tx + sx * -5.0, ty, 3.79) @ Ry(math.pi)))
    bag.add("blacksteel", rbox(cx, cy, 16, 16, 3.8, 4.3, 3.0))


def build_thermal():
    collection("COL_Thermal")
    g = meta(empty("GRP_Thermal"), "Thermal module",
             "Six flattened copper heat pipes feed four aluminum fin stacks: two at the rear and one on each side.",
             (0, 0, GAP), 1)
    cable = Bag()
    for k, w in enumerate(("wirered", "cableblack", "wireyellow", "wireblue")):
        o = (k - 1.5) * 0.7
        cable.add(w, pipe_geo([(37.0, -14.0 + o, 8.0), (33.0, -30.0 + o, 8.4), (29.4 + o, -40.0, 8.8),
                               (29.4 + o, -43.5, 8.8)], 0.3, 1.0, 3.0, 1))
    cable.put(P.plug(4, 0.7, ("cablegrey",)), T(29.5, -44.6, 6.4))
    for side, sx in (("L", -1), ("R", 1)):
        f = meta(empty("GRP_Fan_" + side, parent=g), ("Left" if sx < 0 else "Right") + " fan",
                 "Dual-outlet blower: 47 curved blades, aluminum cover, exhausts into the rear and side fin stacks.")
        housing, imp = P.fan(RNG, ["DELL", "DC 5V 0.50A", "DFS5K12114363J", "FN4R"])
        m = T(sx * FAN_X, FAN_Y, 0) @ (Sc(-1, 1, 1) if sx > 0 else Sc(1, 1, 1))
        Bag().put(housing, m).emit("SM_Fan_" + side + "_Housing", f, smooth=("alu", "steel"))
        Bag().put(imp, m).emit("SM_Fan_" + side + "_Impeller", f)
        Bag().put(cable, m).emit("SM_Fan_" + side + "_Cable", f, smooth=("wirered", "cableblack", "wireyellow", "wireblue"))
    fins = Geo()
    for sx in (-1, 1):
        a, b = sorted((sx * 80.0, sx * 156.0))
        fins.merge(P.fin_stack(a, b, 131.0, 141.0, 2.6, 22.6, "x"))
        a, b = sorted((sx * 161.0, sx * 172.0))
        fins.merge(P.fin_stack(a, b, 58.0, 124.0, 2.6, 15.6, "y"))
    meta(obj("SM_FinStacks", fins, M["alu"], g), "Fin stacks", "Aluminum fins behind the rear and side exhaust vents.")
    z = 5.4
    paths = [
        [(-30, 34), (-62, 34), (-72, 44), (-72, 120), (-82, 134), (-156, 134)],
        [(-35, 28), (-60, 28), (-66, 36), (-66, 124), (-78, 139.5), (-156, 139.5)],
        [(-40, 22), (-130, 22), (-150, 40), (-165.5, 60), (-165.5, 124)],
        [(-55, 40), (30, 40), (66, 44), (76, 56), (76, 120), (86, 134), (156, 134)],
        [(46, 28), (62, 28), (70, 36), (70, 124), (82, 139.5), (156, 139.5)],
        [(40, 22), (125, 22), (150, 40), (165.5, 60), (165.5, 124)],
    ]
    pipes = Geo()
    for p in paths:
        pipes.merge(pipe_geo([(x, y, z) for x, y in p], 2.5, 0.4, 9.0, 3))
    meta(obj("SM_HeatPipes", pipes, M["copper"], g, smooth=True, angle=60), "Heat pipes",
         "Six flattened copper heat pipes carry heat from both cold plates to the fin stacks.")
    cpu = meta(empty("GRP_ColdPlate_CPU", parent=g), "CPU cold plate",
               "Copper plate with a machined pedestal and thermal paste over the processor die.")
    b = Bag()
    b.add("copper", rbox(-45, 30, 48, 38, 6.4, 7.9, 2.0, 4))
    b.add("copperdark", rbox(-45, 30, 26, 13, 7.9, 8.28, 0.6, 3))
    b.add("paste", rbox(-45, 30, 23, 10, 8.28, 8.3, 0.4, 3))
    thermal_bracket(b, -45, 30, 30, 24, 1)
    b.emit("SM_ColdPlate_CPU", cpu, smooth=("copper",))
    gpu = meta(empty("GRP_ColdPlate_GPU", parent=g), "GPU cold plate",
               "Copper plate over the GPU die with thermal pads on the four GDDR6 chips.")
    b = Bag()
    b.add("copper", rbox(40, 32, 76, 50, 6.4, 7.9, 3.0, 4))
    b.add("copperdark", rbox(40, 32, 15, 15, 7.9, 8.18, 0.6, 3))
    b.add("paste", rbox(40, 32, 12, 12, 8.18, 8.2, 0.4, 3))
    for k in ("VRAM1", "VRAM2", "VRAM3", "VRAM4"):
        cx, cy, w, d, _ = BOTTOM[k]
        b.add("thermalpad", rbox(cx, cy, w + 0.6, d + 0.6, 7.9, 9.2, 0.4, 2))
    thermal_bracket(b, 40, 32, 34, 26, 5)
    b.emit("SM_ColdPlate_GPU", gpu, smooth=("copper",))
    vrm = meta(empty("GRP_VRM_Plates", parent=g), "VRM heat spreaders",
               "Aluminum plates with pink thermal pads pressed onto the CPU and GPU power stages.")
    b = Bag()
    b.add("alu", rbox(-46, 61, 62, 16, 5.6, 6.0, 1.5))
    b.add("thermalpink", rbox(-46, 58, 58, 8, 6.0, 6.6, 0.5))
    b.add("thermalpink", rbox(-46, 66.5, 32, 6, 6.0, 9.7, 0.5))
    b.add("alu", rbox(40, 64, 56, 16, 5.6, 6.0, 1.5))
    b.add("thermalpink", rbox(40, 61, 52, 8, 6.0, 6.6, 0.5))
    b.add("thermalpink", rbox(40, 69.5, 52, 6, 6.0, 9.7, 0.5))
    b.emit("SM_VRM_Plates", vrm)
    return g


def build_battery_audio():
    collection("COL_Battery")
    g = meta(empty("GRP_Battery"), "Battery",
             "Li-ion pack, 56 Wh 3-cell or 86 Wh 6-cell. 295.2 × 77.7 × 7.56 mm.", (0, 0, 2 * GAP), 2)
    b = Bag()
    b.add("plastic", rbox(0, -97.5, 295.2, 77.7, 2.0, 2.8, 3.0, 4))
    for i in range(6):
        x = -120.0 + i * 48.0
        b.add("battery", prism(rrect(x, -99.0, 45.5, 72.0, 2.5, 4), 2.8, 9.56,
                               top_loop=rrect(x, -99.0, 43.5, 70.0, 2.0, 4)))
    b.add("pcbdark", rbox(0, -62.0, 70, 5.5, 2.8, 3.6, 0.5))
    for i, x in enumerate((-28, -16, 8, 22)):
        b.put(P.qfn(3.0, 3.0, 0.8, 4, 4), T(x, -62.0, 3.6))
    for x in range(-32, 33, 4):
        b.put(P.passive("0603", "mlcc"), T(x, -60.4, 3.6))
    b.add("kapton", rbox(0, -62.0, 72, 6.5, 3.62, 3.66, 0.6))
    b.add("label", rbox(-20, -99.0, 150, 50, 9.56, 9.62, 2.0, 3))
    b.add("labeltext", Geo().merge(text_lines(["DELL", "Li-ion Battery  86Wh  11.4V ⎓ 7.25Ah",
                                               "Type: M01WR   DP/N 0WM3J3", "Do not puncture, crush or heat above 60°C"],
                                              [5.0, 2.4, 2.0, 1.6], 0.0), T(-38, -94.0, 9.63)))
    b.add("labeltext", barcode(RNG, -88, -120.0, 70, 6.0, 9.625))
    b.add("labeltext", datamatrix(RNG, 42, -108, 11.0, 9.625, 14))
    for i in range(3):
        b.add("labeltext", tri(20 + i * 12, -84.0, 9.63, 7.0, 0.0))
        b.add("label", Geo().merge(text_geo("!", 3.0), T(20 + i * 12, -84.6, 9.64)))
    for x in (-120, -40, 40, 120):
        b.add("plastic", rbox(x, -56.6, 9, 5, 5.8, 6.6, 1.5))
        b.put(P.screw(1.6, 0.6), T(x, -56.6, 6.6))
    b.put(P.plug(6, 1.0, ("wirered", "cableblack")), T(0, -56.0, 7.8) @ Rz(math.pi))
    b.emit("SM_Battery", g, smooth=("battery", "steel"))
    a = meta(empty("GRP_Speakers"), "Speakers", "Stereo speaker pair, down-firing through the bottom cover.",
             (0, 0, 2 * GAP), 2)
    for side, sx in (("L", -1), ("R", 1)):
        x = sx * 162
        o = meta(obj("SM_Speaker_" + side, rbox(x, -100, 22, 55, 3.0, 11.0, 4.0, 4, inset=0.4), M["plastic"], a,
                     smooth=True), ("Left" if sx < 0 else "Right") + " speaker",
                 "Sealed speaker box, 11 × 25 mm driver, with acoustic foam gasket.")
        grille = obj("SM_Speaker_" + side + "_Grille", rbox(x, -100, 16, 42, 2.2, 3.0, 3.0, 3), M["speaker"], o)
        holes = []
        for i in range(-3, 4):
            for j in range(-9, 10):
                holes.append(cylz(x + i * 2.0 + (1.0 if j % 2 else 0), -100 + j * 2.0, 1.0, 4.0, 0.6, 6))
        cut(grille, holes)
        sb = Bag()
        sb.add("foam", ring(rrect(x, -100, 20, 48, 3.5, 4), rrect(x, -100, 16.4, 44.4, 2.0, 4), 2.0, 2.2))
        sb.add("label", rbox(x, -100, 12, 20, 11.0, 11.05, 1.0))
        sb.add("labeltext", Geo().merge(text_lines(["4Ω 2W", "SPK " + side], 1.2, 0.0), T(x, -100, 11.06) @ Rz(math.pi / 2)))
        sb.add("wirered", pipe_geo([(x - sx * 8, -74, 8.0), (x - sx * 10, -64, 8.5), (sx * 130 + 0.6, -55, 9.0)], 0.35, 1.0, 4.0, 1))
        sb.add("cableblack", pipe_geo([(x - sx * 7, -74, 8.0), (x - sx * 9, -64, 8.5), (sx * 130 - 0.6, -55, 9.0)], 0.35, 1.0, 4.0, 1))
        sb.put(P.plug(2, 1.25, ("zif",)), T(sx * 130, -52.6, 7.0))
        sb.emit("SM_Speaker_" + side + "_Detail", o, smooth=("wirered", "cableblack"))
    return g


def offset_rect(cx, cy, w, d, pad):
    return (cx - w / 2 - pad, cx + w / 2 + pad, cy - d / 2 - pad, cy + d / 2 + pad)


def bus(a, b, n, pitch, mode, ch=1.6):
    out = []
    ax, ay = a
    bxx, by = b
    sx = 1 if bxx >= ax else -1
    sy = 1 if by >= ay else -1
    for i in range(n):
        o = (i - (n - 1) / 2) * pitch
        if mode == "h":
            d = abs(by - ay)
            xm = (ax + bxx) / 2
            pts = [(ax, ay + o), (bxx, by + o)] if d < 0.01 else \
                [(ax, ay + o), (xm - sx * d / 2, ay + o), (xm + sx * d / 2, by + o), (bxx, by + o)]
        elif mode == "v":
            d = abs(bxx - ax)
            ym = (ay + by) / 2
            pts = [(ax + o, ay), (bxx + o, by)] if d < 0.01 else \
                [(ax + o, ay), (ax + o, ym - sy * d / 2), (bxx + o, ym + sy * d / 2), (bxx + o, by)]
        elif mode == "hv":
            cx = bxx - sx * sy * o
            cy = ay + o
            pts = [(ax, cy), (cx - sx * ch, cy), (cx, cy + sy * ch), (cx, by)]
        else:
            cy = by - sx * sy * o
            cx = ax + o
            pts = [(cx, ay), (cx, cy - sy * ch), (cx + sx * ch, cy), (bxx, cy)]
        out.append(pts)
    return out


def board_layer(side, rects, buses, extra_fan, n_stitch):
    lay = Bag()
    vias = []
    for (a, b, n, pitch, mode, w) in buses:
        for pts in bus(a, b, n, pitch, mode):
            if all(in_poly(x, y, BOARD) for x, y in pts):
                lay.add("trace", strip(pts, w, 0.0, 0.035))
                vias.append(pts[0])
                vias.append(pts[-1])
    for r in extra_fan:
        x0, x1, y0, y1 = r
        for _ in range(int((x1 - x0 + y1 - y0) * 0.9)):
            e = RNG.randrange(4)
            if e == 0:
                p, d = (RNG.uniform(x0, x1), y1 + 0.4), (0, 1)
            elif e == 1:
                p, d = (RNG.uniform(x0, x1), y0 - 0.4), (0, -1)
            elif e == 2:
                p, d = (x1 + 0.4, RNG.uniform(y0, y1)), (1, 0)
            else:
                p, d = (x0 - 0.4, RNG.uniform(y0, y1)), (-1, 0)
            l1, l2 = RNG.uniform(0.6, 2.4), RNG.uniform(0.4, 1.6)
            turn = RNG.choice((-1, 1))
            q = (p[0] + d[0] * l1, p[1] + d[1] * l1)
            q2 = (q[0] + (d[0] - d[1] * turn) * l2 * 0.7, q[1] + (d[1] + d[0] * turn) * l2 * 0.7)
            if in_poly(q2[0], q2[1], BOARD) and not in_rects(q2[0], q2[1], rects, 0.3):
                lay.add("trace", strip([p, q, q2], 0.14, 0.0, 0.035))
                vias.append(q2)
    k = 0
    tries = 0
    while k < n_stitch and tries < n_stitch * 20:
        tries += 1
        x, y = RNG.uniform(-170, 143), RNG.uniform(-54, 139)
        if in_poly(x, y, BOARD) and not in_rects(x, y, rects, 1.0):
            vias.append((x, y))
            k += 1
    ring_pts = round_poly([(-169.5, -53.5), (142.5, -53.5), (142.5, 47.5), (76.5, 47.5), (76.5, 138.5),
                           (-76.5, 138.5), (-76.5, 47.5), (-169.5, 47.5)], 2.0, 3)
    lay.add("pour", strip(ring_pts + [ring_pts[0]], 1.6, 0.0, 0.03, ends=False))
    for i in range(0, len(ring_pts), 2):
        vias.append(ring_pts[i])
    for x, y in vias:
        lay.add("via", annulus_top(x, y, 0.32, 0.14, 0.045, 8))
        lay.add("hole", disk_top(x, y, 0.15, 0.04, 6))
    silk = Geo()
    for key, (cx, cy, w, d, des) in (BOTTOM if side == "bottom" else TOP).items():
        x0, x1, y0, y1 = offset_rect(cx, cy, w, d, 0.7)
        silk.merge(strip([(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)], 0.15, 0.0, 0.03))
        silk.merge(disk_top(x0 - 0.8, y1 + 0.8, 0.35, 0.03, 8))
    lay.add("silk", silk)
    return lay


def silk_text(side, x, y, lines, size):
    if side == "top":
        return Geo().merge(text_lines(lines, size, 0.0), T(x, y, ZT + 0.03))
    return Geo().merge(text_lines(lines, size, 0.0), T(x, y, ZB - 0.03) @ Ry(math.pi))


def build_motherboard():
    collection("COL_Motherboard")
    g = meta(empty("GRP_Motherboard"), "System board",
             "Main logic board. The CPU, GPU, chipset, video memory, RAM, SSD and Wi-Fi card are attached to it and move with it.",
             (0, 0, 3 * GAP), 3)
    outline = round_poly(BOARD, 3.0, 4)
    pcb = obj("SM_MB_PCB", prism(outline, ZB, ZT), M["mask"], g)
    cut(pcb, [cylz(x, y, ZB - 1, ZT + 1, 1.6, 16) for x, y in MOUNTS])
    mb = Bag()
    for x, y in MOUNTS:
        mb.add("gold", ring(circle(x, y, 3.2, 20), circle(x, y, 1.6, 20), ZT, ZT + 0.05))
        mb.add("gold", ring(circle(x, y, 3.2, 20), circle(x, y, 1.6, 20), ZB - 0.05, ZB))
        mb.add("gold", ring(circle(x, y, 1.62, 16), circle(x, y, 1.5, 16), ZB, ZT, top=False, bottom=False))
    brect = [offset_rect(*v[:4], 0.5) for v in BOTTOM.values()] + [offset_rect(cx, cy, 8, 8, 0) for cx, cy in VRM_CPU + VRM_GPU]
    trect = [offset_rect(*v[:4], 0.5) for v in TOP.values()]
    bottom_buses = [
        ((-50, 11.2), (-50, -15.0), 36, 0.42, "v", 0.12),
        ((-28, 11.2), (30, -15.0), 30, 0.42, "vh" if False else "v", 0.12),
        ((-22.5, 30), (22.5, 30), 32, 0.4, "h", 0.11),
        ((-67.5, 30), (-99.5, 30), 18, 0.45, "h", 0.12),
        ((-112, 17.5), (-82, -26), 10, 0.5, "vh", 0.12),
        ((-99.5, 22), (86, 4), 10, 0.45, "h", 0.12),
        ((40, 14.5), (12, 22.5), 16, 0.4, "vh", 0.11),
        ((40, 49.5), (12, 42.5), 16, 0.4, "vh", 0.11),
        ((57.5, 40), (68, 54.5), 16, 0.4, "hv", 0.11),
        ((57.5, 24), (68, 9.5), 16, 0.4, "hv", 0.11),
        ((-45, 49), (-45, 54), 8, 1.5, "v", 0.9),
        ((40, 49.5), (40, 57), 6, 1.6, "v", 0.9),
        ((-112, 42.5), (-90, 44), 4, 0.6, "h", 0.2),
        ((0, -48.5), (0, -40), 6, 1.4, "v", 0.8),
    ]
    top_buses = [
        ((0, 17.5), (-95.5, 0), 26, 0.4, "vh", 0.12),
        ((-10, -43), (-100, -4.5), 12, 0.4, "vh", 0.12),
        ((-30, 122.5), (-45, 50), 20, 0.4, "v", 0.11),
        ((-40, 113.5), (-40, 128), 12, 0.4, "v", 0.12),
        ((-150, 18), (-158, 25), 8, 0.45, "vh", 0.14),
        ((20, 110.5), (12, 128), 8, 0.45, "v", 0.14),
        ((60, -26.5), (0, -53), 6, 1.4, "vh", 0.9),
        ((96, -30), (134, -32), 10, 0.5, "h", 0.16),
        ((-112, -23.5), (-100, -4.5), 6, 0.4, "vh", 0.12),
        ((-15, 128), (-15, 60), 8, 0.42, "v", 0.12),
        ((12, 128), (30, 60), 10, 0.42, "v", 0.12),
        ((-60, 60), (-60, 128), 6, 1.8, "v", 1.0),
    ]
    fan_bottom = [offset_rect(*BOTTOM[k][:4], 0) for k in ("PCH", "AUDIO", "WLAN", "SSD1", "SSD2", "COIN", "BATT")]
    fan_bottom += [offset_rect(cx, cy, 7.5, 7.5, 0) for cx, cy in VRM_CPU + VRM_GPU]
    fan_top = [offset_rect(*v[:4], 0) for v in TOP.values()]
    mb.put(board_layer("bottom", brect, bottom_buses, fan_bottom, 520), BOT_FLAT)
    mb.put(board_layer("top", trect, top_buses, fan_top, 380), TOP_FLAT)
    for key, (cx, cy, w, d, des) in BOTTOM.items():
        mb.add("silk", silk_text("bottom", cx + w / 2 + 2.2, cy + d / 2 + 1.4, [des], 1.1))
    for key, (cx, cy, w, d, des) in TOP.items():
        mb.add("silk", silk_text("top", cx, cy + d / 2 + 1.6, [des], 1.1))
    mb.add("silk", silk_text("bottom", 0, 105, ["DELL", "G16 7630 MB  LA-M591P", "REV: 1.0   94V-0  E89380",
                                                 "2324  MADE IN CHINA"], [3.2, 1.6, 1.4, 1.4]))
    mb.add("silk", silk_text("top", 60, 30, ["LA-M591P  REV 1.0", "DAZ  2324"], [1.8, 1.4]))
    mb.add("silk", Geo().merge(datamatrix(RNG, 0, 0, 7.0, 0.0, 14), T(-40, 85, ZT + 0.03)))
    mb.add("label", rbox(-40, 72, 34, 10, ZT, ZT + 0.06, 0.6))
    mb.add("labeltext", Geo().merge(text_lines(["SN CN0X7G9W1296132B0012", "DP/N 0X7G9W  A00"], 1.1, 0.0), T(-38, 73.5, ZT + 0.065)))
    mb.add("labeltext", barcode(RNG, -55, 68.0, 30, 2.4, ZT + 0.062))
    mb.emit("SM_MB_Board", g, smooth=())

    cpu = meta(empty("GRP_CPU", parent=g), "CPU",
               "Intel Core i7-13650HX (i5-13450HX to i9-13900HX options). Soldered BGA, bare die facing the cold plate.")
    bag, _ = P.cpu_package(RNG)
    Bag().put(bag, bot_m(-45, 30)).emit("SM_CPU", cpu)
    gpu = meta(empty("GRP_GPU", parent=g), "GPU",
               "NVIDIA GeForce RTX 4060 Laptop GPU (RTX 3050 to RTX 4070 options). AD107 die inside a steel stiffener.")
    bag, _ = P.gpu_package(RNG)
    Bag().put(bag, bot_m(40, 32)).emit("SM_GPU", gpu)
    pch = meta(empty("GRP_PCH", parent=g), "Chipset", "Intel HM770 platform controller hub, soldered BGA.")
    bag, _ = P.pch_package(RNG)
    Bag().put(bag, bot_m(-112, 30)).emit("SM_PCH", pch)
    vram = meta(empty("GRP_VRAM", parent=g), "Video memory", "8 GB GDDR6 in four 16 Gb chips around the GPU.")
    vb = Bag()
    chip = P.bga(14.0, 12.0, 1.1, ["SAMSUNG 247", "K4Z80325BC-HC18", "GKA151VG"], 0.8)
    for k in ("VRAM1", "VRAM2", "VRAM3", "VRAM4"):
        cx, cy = BOTTOM[k][:2]
        vb.put(chip, bot_m(cx, cy))
    vb.emit("SM_VRAM", vram)

    for slot, key in (("A", "DIMMA"), ("B", "DIMMB")):
        cx, cy = BOTTOM[key][:2]
        r = meta(empty("GRP_RAM_" + slot, parent=g), "Memory, slot " + slot,
                 "DDR5-4800 SO-DIMM, 16 GB 1Rx8: eight DRAM chips, on-module PMIC and SPD hub.")
        Bag().put(P.sodimm(RNG), bot_m(cx, cy) @ Rz(math.pi) @ T(0, 14.0, 1.4)).emit("SM_RAM_" + slot, r)
        Bag().put(P.dimm_slot(), bot_m(cx, cy) @ Rz(math.pi)).emit("SM_RAM_" + slot + "_Slot", g)

    ssd = meta(empty("GRP_SSD", parent=g), "SSD", "M.2 2280 PCIe Gen4 x4 NVMe SSD: controller, two NAND packages, PMU.")
    sx, sy = BOTTOM["SSD1"][:2]
    Bag().put(P.ssd_card(RNG), bot_m(sx, sy) @ Rz(-math.pi / 2) @ T(0, 40.0 - 1.0, 1.8)).emit("SM_SSD", ssd)
    Bag().put(P.m2_socket(), bot_m(sx, sy) @ Rz(math.pi)).put(P.screw(2.2, 0.9), bot_m(sx - 79.0, sy) @ T(0, 0, 2.6)) \
        .add("steel", cylz(0, 0, 0, 2.6, 2.4, 20), bot_m(sx - 79.0, sy)).emit("SM_SSD_Socket", g, smooth=("steel",))
    s2 = meta(empty("GRP_M2_Slot2", parent=g), "Second M.2 slot", "Free M.2 2230/2280 slot for a second SSD.")
    x2, y2 = BOTTOM["SSD2"][:2]
    Bag().put(P.m2_socket(), bot_m(x2, y2)).add("steel", cylz(0, 0, 0, 2.6, 2.4, 20), bot_m(x2 + 33.0, y2)) \
        .add("thermalpad", rbox(0, 0, 20, 24, 0, 0.4, 1.0), bot_m(x2 + 18.0, y2)).emit("SM_M2_Slot2", s2, smooth=("steel",))

    wifi = meta(empty("GRP_WiFi", parent=g), "Wireless card",
                "M.2 2230 Wi-Fi 6E and Bluetooth card (Intel AX211 or Killer options) with MAIN and AUX antenna leads.")
    wx, wy = BOTTOM["WLAN"][:2]
    wm = bot_m(wx, wy + 15.0 + 2.5 - 2.5) @ T(0, 0, 1.6)
    wb = Bag().put(P.wifi_card(RNG), bot_m(wx, wy + 15.5) @ T(0, 0, 1.6))
    wb.put(P.ufl_cable([(-4.0, 11.4, 3.3), (-4.0, 30.0, 3.6), (14.0, 45.0, 3.6), (14.0, 110.0, 3.6), (30.0, 120.0, 3.6)],
                       "cableblack"), bot_m(wx, wy + 15.5))
    wb.put(P.ufl_cable([(4.0, 11.4, 3.3), (4.0, 30.0, 3.9), (16.0, 45.0, 3.9), (16.0, 112.0, 3.9), (32.0, 122.0, 3.9)],
                       "cablegrey"), bot_m(wx, wy + 15.5))
    wb.put(P.m2_socket(22.0, 3.0, 2.0), bot_m(wx, wy) @ Rz(math.pi / 2))
    wb.put(P.screw(2.0, 0.8), bot_m(wx, wy + 30.0) @ T(0, 0, 2.4))
    wb.emit("SM_WiFi", wifi, smooth=("cableblack", "cablegrey", "gold"))

    coin = meta(empty("GRP_CoinCell", parent=g), "RTC coin-cell battery",
                "CR2032 cell in shrink wrap. Keeps the BIOS settings and clock when the main battery is removed.")
    ccx, ccy = BOTTOM["COIN"][:2]
    cb = Bag()
    cb.add("steel", cylz(0, 0, 0.2, 3.4, 10.0, 36), bot_m(ccx, ccy))
    cb.add("kapton", ring(circle(0, 0, 10.25, 36), circle(0, 0, 8.6, 36), 0.0, 3.5), bot_m(ccx, ccy))
    cb.add("labeltext", Geo().merge(text_lines(["CR2032", "3V"], 2.0, 0.0), T(0, 0, 3.41)), bot_m(ccx, ccy))
    cb.add("wirered", pipe_geo([(-140, 30, 9.0), (-132, 30, 9.0), (-128, 36, 9.2)], 0.35, 1.0, 3.0, 1))
    cb.add("cableblack", pipe_geo([(-140, 26, 9.0), (-131, 26, 9.0), (-127, 34, 9.2)], 0.35, 1.0, 3.0, 1))
    cb.emit("SM_CoinCell", coin, smooth=("steel", "kapton", "wirered", "cableblack"))

    pw = meta(empty("GRP_VRM", parent=g), "Power stages",
              "11 inductors with DrMOS power stages and polymer capacitors feeding the CPU and GPU.")
    pb = Bag()
    for cx, cy in VRM_CPU:
        pb.put(P.choke(7.5, 4.0, "R22"), bot_m(cx, cy))
        pb.put(P.drmos(), bot_m(cx, cy + 8.5))
    for cx, cy in VRM_GPU:
        pb.put(P.choke(7.5, 4.0, "R22"), bot_m(cx, cy))
        pb.put(P.drmos(), bot_m(cx, cy + 8.5))
    for i in range(4):
        pb.put(P.spcap("470"), bot_m(-12.0, 54.0 + i * 5.0) @ Rz(math.pi / 2) if False else bot_m(-14.0 + 0.0, 52.0 + i * 5.0))
    pb.emit("SM_VRM", pw, smooth=("ferrite",))

    io = meta(empty("GRP_Chips", parent=g), "Controller chips",
              "Embedded controller, BIOS flash, Thunderbolt controller, 2.5G LAN, USB-C PD and charger ICs.")
    ib = Bag()
    for key, bag in (("EC", P.lqfp(9.0, 24, 1.4, IC_MARKS["EC"], 0.8)), ("SPI", P.soic(4, 5.0, 4.0, 1.5, IC_MARKS["SPI"], 0.55)),
                     ("TBT", P.bga(11.0, 11.0, 1.0, IC_MARKS["TBT"], 0.9)), ("LAN", P.qfn(8.0, 8.0, 0.9, 12, 12, IC_MARKS["LAN"], 0.75)),
                     ("PD", P.qfn(5.0, 5.0, 0.8, 8, 8, IC_MARKS["PD"], 0.5)), ("CHG", P.qfn(7.0, 7.0, 0.9, 10, 10, IC_MARKS["CHG"], 0.7)),
                     ("RTC", P.qfn(4.0, 4.0, 0.8, 5, 5, IC_MARKS["RTC"], 0.5))):
        cx, cy = TOP[key][:2]
        ib.put(bag, top_m(cx, cy))
    for x, y in ((-92, 6), (-36, 104), (-146, 20)):
        ib.put(P.crystal(), top_m(x, y))
    for x, y in P_CHG_L:
        ib.put(P.choke(10.0, 3.0, "4R7"), top_m(x, y))
    ax, ay = BOTTOM["AUDIO"][:2]
    ib.add("steel", prism(rrect(0, 0, 16, 14, 0.6, 2), 0.0, 1.6, top_loop=rrect(0, 0, 15.6, 13.6, 0.4, 2)), bot_m(ax, ay))
    for i in range(5):
        for j in range(4):
            ib.add("hole", disk_top(-6 + i * 3, -4.5 + j * 3, 0.5, 1.61, 8), bot_m(ax, ay))
    ib.emit("SM_Chips", io, smooth=())

    conn = meta(empty("GRP_Connectors", parent=g), "Board connectors",
                "Keyboard, backlight, touchpad, display, battery, fan and speaker connectors.")
    cb = Bag()
    cb.put(P.zif(26), top_m(*TOP["KB"][:2]))
    cb.put(P.zif(12), top_m(*TOP["KBL"][:2]))
    cb.put(P.zif(12), top_m(*TOP["TP"][:2]))
    cb.put(P.zif(40, 0.4, 5.0, 1.3), top_m(*TOP["EDP"][:2]) @ Rz(math.pi))
    cb.put(P.zif(16), top_m(*TOP["IOFPC"][:2]) @ Rz(math.pi / 2))
    cb.put(P.jst(6, 2.0, "zif"), bot_m(*BOTTOM["BATT"][:2]))
    cb.put(P.jst(4, 0.7, "zif"), bot_m(*BOTTOM["FAN1"][:2]))
    cb.put(P.jst(4, 0.7, "zif"), bot_m(*BOTTOM["FAN2"][:2]))
    cb.put(P.jst(2, 1.25, "zif"), bot_m(*BOTTOM["SPK1"][:2]))
    cb.put(P.jst(2, 1.25, "zif"), bot_m(*BOTTOM["SPK2"][:2]))
    cb.emit("SM_Connectors", conn)

    smd = Bag()
    sizes = (("0201", 0.30), ("0402", 0.40), ("0603", 0.18), ("0805", 0.08), ("1206", 0.04))
    for side, n, rects in (("bottom", 900, brect), ("top", 600, trect)):
        k = 0
        tries = 0
        while k < n and tries < n * 30:
            tries += 1
            x, y = RNG.uniform(-170, 143), RNG.uniform(-54, 139)
            if not in_poly(x, y, BOARD) or in_rects(x, y, rects, 0.6):
                continue
            r = RNG.random()
            acc = 0
            size = "0402"
            for s_, p_ in sizes:
                acc += p_
                if r < acc:
                    size = s_
                    break
            body = "resistor" if RNG.random() < 0.35 else "mlcc"
            m = (top_m if side == "top" else bot_m)(x, y, RNG.choice((0.0, math.pi / 2)))
            smd.put(P.passive(size, body), m)
            k += 1
    for cx, cy, w, d, des in list(BOTTOM.values())[:3]:
        for i in range(int(w / 1.2)):
            for yy in (cy - d / 2 - 1.4, cy + d / 2 + 1.4):
                smd.put(P.passive("0402", "mlcc"), bot_m(cx - w / 2 + 0.6 + i * 1.2, yy, math.pi / 2))
    smd.emit("SM_MB_Passives", g)

    rear = meta(empty("GRP_Ports_Rear", parent=g), "Rear ports",
                "HDMI 2.1, USB 3.2 Gen 1 Type-A, Thunderbolt 4 (RTX 4070 models) or USB-C 3.2 Gen 2 with DisplayPort, and the 7.4 mm power jack.")
    rb = Bag()
    a0, a1 = YR - 16.0, YR - 0.25
    for kind, x in REAR_PORTS:
        if kind == "usba":
            rb.put(P.usb_a("y", a0, a1, x, REAR_Z))
        elif kind == "usbc":
            rb.put(P.usb_c("y", a0 + 4.0, a1, x, REAR_Z))
        elif kind == "hdmi":
            rb.put(P.hdmi("y", a0 + 2.0, a1, x, REAR_Z))
        else:
            rb.put(P.dc_jack("y", a0, a1, x, REAR_Z))
    rb.emit("SM_Ports_Rear", rear, smooth=())
    left = meta(empty("GRP_Ports_Left", parent=g), "Left ports", "Drop-jaw RJ-45 2.5G Ethernet and universal audio jack.")
    lb = Bag()
    ly, lz = LEFT_RJ45
    lb.put(P.rj45("x", W / 2 - 17.0, W / 2 - 0.25, ly, lz), Sc(-1, 1, 1))
    ay_, az = LEFT_AUDIO
    lb.put(P.audio_jack("x", W / 2 - 15.0, W / 2 - 0.25, ay_, az), Sc(-1, 1, 1))
    lb.emit("SM_Ports_Left", left)
    return g


P_CHG_L = [(84, -30), (96, -30)]


def build_ioboard():
    collection("COL_IOBoard")
    g = meta(empty("GRP_IOBoard"), "I/O board",
             "Right-side daughterboard with two USB 3.2 Gen 1 Type-A ports and a redriver chip.", (0, 0, 3 * GAP), 3)
    b = Bag()
    b.add("mask", prism(round_poly([(148, -50), (174, -50), (174, 48), (148, 48)], 2.0, 3), ZB, ZT))
    for y, z in RIGHT_USB:
        b.put(P.usb_a("x", W / 2 - 15.5, W / 2 - 0.25, y, z))
    b.put(P.qfn(4.0, 4.0, 0.8, 6, 6, ["PS8743", "B"], 0.6), top_m(155, -20))
    b.put(P.zif(16), top_m(151.5, -35) @ Rz(math.pi / 2))
    b.add("fpc", strip([(150.5, -35), (140, -35), (138, -33)], 8.0, ZT + 1.25, 0.12))
    for i in range(30):
        b.put(P.passive(RNG.choice(("0201", "0402", "0603")), RNG.choice(("mlcc", "resistor"))),
              top_m(RNG.uniform(150, 160), RNG.uniform(-46, 44), RNG.choice((0.0, math.pi / 2))))
    for y in (-30, 20, 40):
        b.add("trace", strip([(149, y), (157, y), (160, y + 3)], 0.3, ZT, 0.035))
    b.emit("SM_IO", g)
    return g


ROWS = [
    (HF, [(k, 15 / 16) for k in ["Esc"] + ["F%d" % i for i in range(1, 13)] + ["PrtSc", "Ins", "Del"]]),
    (U, [("`", 1)] + [(c, 1) for c in "1234567890"] + [("-", 1), ("=", 1), ("Backspace", 2)]),
    (U, [("Tab", 1.5)] + [(c, 1) for c in "QWERTYUIOP"] + [("[", 1), ("]", 1), ("\\", 1.5)]),
    (U, [("Caps", 1.75)] + [(c, 1) for c in "ASDFGHJKL"] + [(";", 1), ("'", 1), ("Enter", 2.25)]),
    (U, [("Shift", 2.25)] + [(c, 1) for c in "ZXCVBNM"] + [(",", 1), (".", 1), ("/", 1), ("Shift", 1.75),
                                                       ("#UP", 1)]),
    (U, [("Ctrl", 1.25), ("Fn", 1), ("#WIN", 1), ("Alt", 1.25), ("", 6.5), ("Alt", 1), ("Ctrl", 1),
         ("#LEFT", 1), ("#DOWN", 1)]),
]
COLUMN = ["#POWER", "Mic", "Mute", "Vol+", "Vol-", "#RIGHT"]


def legend(lbl, cx, cy, z):
    g = Geo()
    if not lbl:
        return g
    if lbl in ("#UP", "#DOWN", "#LEFT", "#RIGHT"):
        ang = {"#UP": 0, "#LEFT": math.pi / 2, "#DOWN": math.pi, "#RIGHT": -math.pi / 2}[lbl]
        return g.merge(tri(cx, cy, z, 4.0, ang))
    if lbl == "#WIN":
        for dx in (-0.95, 0.95):
            for dy in (-0.95, 0.95):
                g.merge(bx(cx + dx - 0.75, cx + dx + 0.75, cy + dy - 0.75, cy + dy + 0.75, z, z + 0.02))
        return g
    if lbl == "#POWER":
        g.merge(ring(circle(cx, cy - 0.3, 2.6, 28), circle(cx, cy - 0.3, 2.0, 28), z, z + 0.02))
        g.merge(bx(cx - 0.3, cx + 0.3, cy - 0.2, cy + 3.0, z + 0.01, z + 0.03))
        return g
    size = 4.2 if len(lbl) == 1 else (2.9 if len(lbl) <= 3 else 2.5)
    return g.merge(text_geo(lbl, size, 3), T(cx, cy, z))


def keycap(cx, cy, w, d):
    g = prism(rrect(cx, cy, w, d, 1.4, 3), -2.9, 0.25, top_loop=rrect(cx, cy, w - 0.8, d - 0.8, 1.2, 3))
    g.merge(prism(rrect(cx, cy, w - 0.8, d - 0.8, 1.2, 3), 0.25, 0.4, top_loop=rrect(cx, cy, w - 1.3, d - 1.3, 1.0, 3)))
    return g


def build_keyboard():
    collection("COL_Keyboard")
    g = meta(empty("GRP_Keyboard", (0, KY, zdeck(KY)), (SLOPE, 0, 0)), "Keyboard",
             "85-key US layout, 19.05 mm key pitch, scissor switches, one-zone RGB backlight (Cherry MX mechanical option).",
             (0, 0, 4 * GAP), 4)
    total_w, total_d = 16.25 * U, HF + 5 * U
    x0, top = -total_w / 2, total_d / 2
    kb = Bag()
    kb.add("kbplate", rbox(0, 0, 311, 110.5, -4.4, -3.6, 3.0))
    kb.add("glass", rbox(0, 0, 309, 108.5, -3.6, -3.3, 2.5))
    kb.add("mylar", rbox(0, 0, 309, 108.5, -3.3, -3.1, 2.5))
    for i in range(18):
        for j in range(3):
            kb.add("kbplate", cylz(-150 + i * 17.6, -45 + j * 45, -4.75, -4.4, 1.1, 8, top_r=1.3))
    caps = Geo()
    legends = Geo()
    mech = Geo()
    y = top
    centers = []
    for h, keys in ROWS:
        cy = y - h / 2
        x = x0
        for lbl, wu in keys:
            w = wu * U
            caps.merge(keycap(x + w / 2, cy, w - 2.6, h - 2.6))
            legends.merge(legend(lbl, x + w / 2, cy, 0.42))
            mech.merge(bx(x + w / 2 - 5.5, x + w / 2 + 5.5, cy - 0.5, cy + 0.5, -3.1, -2.9), )
            mech.merge(bx(x + w / 2 - 0.5, x + w / 2 + 0.5, cy - min(5.0, h / 2 - 1.8), cy + min(5.0, h / 2 - 1.8), -3.1, -2.9))
            x += w
        centers.append(cy)
        y -= h
    cx = x0 + 15.25 * U + U / 2
    power = None
    for i, lbl in enumerate(COLUMN):
        if lbl == "#POWER":
            power = keycap(cx, centers[i], U - 2.6, HF - 2.6)
        else:
            h = HF if i == 0 else U
            caps.merge(keycap(cx, centers[i], U - 2.6, h - 2.6))
        legends.merge(legend(lbl, cx, centers[i], 0.42))
    obj("SM_Keyboard_Keycaps", caps, M["keycap"], g, smooth=True, angle=40)
    obj("SM_Keyboard_Legends", legends, M["legend"], g)
    kb.add("plastic", mech)
    meta(obj("SM_Keyboard_PowerButton", power, M["keycap"], g, smooth=True, angle=40), "Power button",
         "Top-right power key with status light.")
    kb.add("fpc", strip([(0, -2), (0, -30), (0, -40)], 30.0, -4.6, 0.12))
    kb.add("fpc", strip([(40, -2), (40, -18), (40, -26)], 14.0, -4.6, 0.12))
    kb.add("kapton", rbox(0, -10, 34, 14, -4.75, -4.72, 1.0))
    kb.emit("SM_Keyboard", g)
    return g


def build_touchpad():
    collection("COL_Touchpad")
    g = meta(empty("GRP_Touchpad", (TPX, TPY, zdeck(TPY)), (SLOPE, 0, 0)), "Touchpad",
             "Precision touchpad, 105 × 65 mm glass with a mechanical click dome.", (0, 0, 4 * GAP), 4)
    obj("SM_Touchpad_Glass", rbox(0, 0, 105, 65, -1.0, -0.05, 3.0, 5), M["touchpad"], g, smooth=True)
    b = Bag()
    b.add("pcbdark", rbox(0, 0, 103, 63, -1.9, -1.0, 2.5, 4))
    b.put(P.qfn(6.0, 6.0, 0.8, 10, 10, ["ELAN", "33936", "2318"], 0.6), T(20, 10, -1.9) @ Ry(math.pi))
    b.put(P.qfn(3.0, 3.0, 0.7, 5, 5), T(-25, -12, -1.9) @ Ry(math.pi))
    for i in range(24):
        b.put(P.passive("0402", "mlcc"), T(10 + (i % 8) * 2.0, -2 - (i // 8) * 2.0, -1.9) @ Ry(math.pi))
    b.add("steel", rbox(0, -22, 60, 10, -2.4, -1.9, 1.5))
    b.add("steel", cylz(0, -26, -2.9, -2.4, 2.5, 16))
    b.put(P.zif(12), T(-30, 20, -1.9) @ Ry(math.pi))
    b.add("fpc", strip([(-30, 22), (-30, 32), (-30, 40)], 7.0, -2.2, 0.12))
    b.emit("SM_Touchpad", g, smooth=("steel",))
    return g


def build_palmrest():
    collection("COL_Palmrest")
    g = meta(empty("GRP_Palmrest"), "Palm rest (C-cover)",
             "Keyboard deck, side walls, rear thermal shelf, vents and port openings.", (0, 0, 5 * GAP), 5)
    ydeck_end = YSF + 12
    deck = obj("SM_Palmrest", prism(rrect(0, (YF + ydeck_end) / 2, W, ydeck_end - YF, CR), 5.0,
                                    ztop=lambda x, y: zdeck(y)), M["shell"], g)
    cutters = [
        ("UNION", obj("CUT_Shelf", prism(rrect(0, (YSF + YR) / 2, W, SHELF, CR), 5.0, ZSH), M["vent"])),
        ("DIFFERENCE", obj("CUT_Cav1", prism(rrect(0, (YF + WALL + YSF + 11) / 2, W - 2 * WALL, YSF + 11 - YF - WALL,
                                                   CR - WALL), 4.0, ztop=lambda x, y: zdeck(y) - 1.4), M["vent"])),
        ("DIFFERENCE", obj("CUT_Cav2", prism(rrect(0, (YSF + YR) / 2, W - 2 * WALL, SHELF - 2 * WALL, CR - WALL),
                                             4.0, ZSH - 1.6), M["vent"])),
        ("DIFFERENCE", obj("CUT_KB", rbox(0, KY, 313.6, 112.6, 8.0, 30.0, 3.0), M["vent"])),
        ("DIFFERENCE", obj("CUT_TP", rbox(TPX, TPY, 106.5, 66.5, 8.0, 30.0, 3.5), M["vent"])),
    ]
    for op, c in cutters:
        boolean(deck, c, op)
    apply_mods(deck)
    for _, c in cutters:
        bpy.data.objects.remove(c)
    holes = []
    x = -150.0
    while x <= 150.0:
        holes.append(rbox(x, 108.0, 1.6, 12.0, 10.0, 30.0, 0.8, 2))
        x += 3.6
    for sx in (-1, 1):
        x = 70.0
        while x <= 166.0:
            holes.append(rbox(sx * x, YR, 2.4, 6.0, 6.0, 21.5, 0.5, 2))
            x += 4.2
        y = 62.0
        while y <= 116.0:
            holes.append(rbox(sx * W / 2, y, 6.0, 2.2, 6.5, 15.5, 0.5, 2))
            y += 4.0
    for kind, x in REAR_PORTS:
        if kind == "dc":
            holes.append(cyly(YR - 4, YR + 2, x, REAR_Z, 4.2, 32))
        else:
            wv, hv, rv = {"usba": (12.8, 5.3, 0.4), "usbc": (9.0, 3.3, 1.6), "hdmi": (15.4, 6.0, 0.6)}[kind]
            holes.append(section(rrect(x, REAR_Z, wv, hv, rv, 4), YR - 4, YR + 2, "y"))
    holes.append(section(rrect(LEFT_RJ45[0], LEFT_RJ45[1], 16.0, 9.6, 0.4, 3), -W / 2 - 2, -W / 2 + 4, "x"))
    holes.append(section(circle(LEFT_AUDIO[0], LEFT_AUDIO[1], 3.1, 24), -W / 2 - 2, -W / 2 + 4, "x"))
    for y, z in RIGHT_USB:
        holes.append(section(rrect(y, z, 12.8, 5.3, 0.4, 3), W / 2 - 4, W / 2 + 2, "x"))
    cut(deck, holes)
    shade(deck.data, 30)
    pb = Bag()
    for x, y in SCREWS:
        pb.add("shell", ring(circle(x, y, 3.0, 16), circle(x, y, 1.1, 16), 5.0, zdeck(min(y, YSF)) - 1.3))
    for sx in (-1, 1):
        pb.add("steel", bx(min(sx * 146, sx * 164), max(sx * 146, sx * 164), 100, 117, 13.0, 16.6))
        for yy in (104, 112):
            pb.put(P.screw(1.8, 0.7), T(sx * 155, yy, 16.6))
    pb.add("led", bx(-102, -98, YF - 0.25, YF + 0.3, 6.2, 7.2))
    pb.emit("SM_Palmrest_Detail", g, smooth=("shell", "steel"))
    return g


def build_display():
    collection("COL_Display")
    g = meta(empty("GRP_Display", (0, YP, ZP), (SLOPE - math.radians(OPEN), 0, 0)), "Display assembly",
             "Opens on a full-width hinge at the front edge of the rear thermal shelf.", (0, 0, 6 * GAP + 60), 6)
    g["hinge_base"] = SLOPE
    g["open_deg"] = OPEN
    yc = (2.0 - LL) / 2
    ya = -LL + 8.0 + ACT_H / 2
    outer = rrect(0, yc, 356.0, LL + 2.0, 8.0, 6)
    back = meta(obj("SM_Display_BackCover", prism(outer, 0.4, LT / 2), M["shell"], g, smooth=True),
                "Display back cover (A-cover)", "Aluminum lid shell with the Dell logo, screw bosses and Wi-Fi antennas.",
                (0, 0, 40))
    bb = Bag()
    bb.add("chrome", ring(circle(0, -LL / 2, 23.5, 64), circle(0, -LL / 2, 22.0, 64), LT / 2, LT / 2 + 0.06))
    bb.add("chrome", Geo().merge(text_geo("DELL", 11.0, 3), T(0, -LL / 2, LT / 2 + 0.06) @ Rz(math.pi)))
    for i in range(9):
        for y in (-LL + 5.0, -6.0):
            bb.add("shell", ring(circle(-160 + i * 40, y, 2.2, 12), circle(-160 + i * 40, y, 0.9, 12), 0.0, 0.4))
    for sx in (-1, 1):
        bb.add("cableblack", rbox(sx * 120, -14, 32, 7, 0.32, 0.4, 1.0))
        bb.add("copper", rbox(sx * 120 + sx * 6, -14, 12, 5, 0.3, 0.32, 0.5))
        bb.add("cableblack" if sx < 0 else "cablegrey", pipe_geo([(sx * 104, -14, -0.2), (sx * 60, -6, -0.2), (sx * 20, 2, -0.2)], 0.5, 1.0, 6.0, 1))
    bb.emit("SM_Display_BackDetail", back, smooth=("cableblack", "cablegrey"))
    panel = meta(obj("SM_Display_Panel", rbox(0, ya, ACT_W + 6, ACT_H + 10.5, -2.0, 0.4, 1.5), M["panelback"], g),
                 "Display panel",
                 "16-inch QHD+ 2560 × 1600 WVA panel, 165 Hz or 240 Hz, 344.68 × 215.42 mm active area.", (0, 0, 0))
    sx0, sx1 = -ACT_W / 2, ACT_W / 2
    sy0, sy1 = ya - ACT_H / 2, ya + ACT_H / 2
    scr = Geo().add([(sx0, sy0, -2.06), (sx0, sy1, -2.06), (sx1, sy1, -2.06), (sx1, sy0, -2.06)], [[0, 1, 2, 3]])
    so = obj("SM_Display_Screen", scr, M["screen"], panel)
    uvl = so.data.uv_layers.new(name="UVMap")
    for lp in so.data.loops:
        co = so.data.vertices[lp.vertex_index].co / S
        uvl.data[lp.index].uv = ((co.x - sx0) / ACT_W, (sy1 - co.y) / ACT_H)
    pnl = Bag()
    tcy = sy1 + 2.5
    pnl.add("pcbdark", rbox(0, tcy, 230, 6, 0.4, 1.0, 0.5))
    for i, x in enumerate((-80, -30, 30, 80)):
        pnl.put(P.qfn(4.0, 4.0, 0.6, 6, 6, ["NT71" + str(860 + i)], 0.45), T(x, tcy, 1.0))
    for i in range(40):
        pnl.put(P.passive("0201", "mlcc"), T(-105 + i * 5.3, tcy + 2.0, 1.0))
    pnl.add("fpc", strip([(0, tcy), (0, tcy + 10), (0, -6)], 14, 1.0, 0.1))
    pnl.add("label", rbox(-90, ya - 30, 70, 22, 0.4, 0.45, 1.0))
    pnl.add("labeltext", Geo().merge(text_lines(["16.0\" QHD+ 240Hz WVA", "2560x1600  eDP 1.4b", "DP/N 0V3RKR  REV A00"],
                                                [1.8, 1.4, 1.4], 0.0), T(-90, ya - 26, 0.46)))
    pnl.add("labeltext", barcode(RNG, -120, ya - 38, 60, 4.0, 0.455))
    pnl.emit("SM_Display_PanelDetail", panel)
    bez = meta(obj("SM_Display_Bezel", ring(outer, rrect(0, ya, ACT_W + 1.0, ACT_H + 1.0, 1.0, 6), -LT / 2, -2.0),
                   M["bezel"], g, smooth=True), "Display bezel (B-cover)",
               "Front bezel with the 720p HD webcam module and rubber bumpers.", (0, 0, -40))
    bz = Bag()
    cam_y = -LL + 4.2
    bz.add("plastic", ring(circle(0, cam_y, 2.4, 24), circle(0, cam_y, 1.5, 24), -LT / 2 - 0.08, -LT / 2))
    bz.add("lens", cylz(0, cam_y, -LT / 2 - 0.1, -LT / 2, 1.5, 24))
    bz.add("pcbdark", rbox(0, cam_y, 28, 5.5, -2.0, -1.4, 0.5))
    bz.add("plastic", cylz(0, cam_y, -3.2, -2.0, 2.6, 20))
    bz.add("fpc", strip([(10, cam_y), (40, cam_y), (60, cam_y + 3)], 3.0, -1.5, 0.1))
    for x, y in ((-172, -LL + 6), (172, -LL + 6), (-172, -20), (172, -20)):
        bz.add("rubber", rbox(x, y, 4.0, 7.0, -LT / 2 - 0.5, -LT / 2, 1.5, 3))
    bz.emit("SM_Display_BezelDetail", bez, smooth=("lens",))
    obj("SM_Display_HingeCover", cylx(-146, 146, 0, 0, 3.7, 32), M["shell"], g, smooth=True)
    hb = Bag()
    for sx in (-1, 1):
        a, b = sorted((sx * 146, sx * 166))
        hb.add("steel", cylx(a, b, 0, 0, 3.2, 24))
        hb.add("steel", bx(min(sx * 148, sx * 164), max(sx * 148, sx * 164), -36, -2, 0.45, 1.6))
        for yy in (-10, -22, -32):
            hb.put(P.screw(1.5, 0.5), T(sx * 156, yy, 1.6))
        for k in range(3):
            hb.add("blacksteel", cylx(sx * (147 + k * 1.2) - 0.3, sx * (147 + k * 1.2) + 0.3, 0, 0, 3.6, 24))
    hg = meta(empty("GRP_Hinges", parent=g), "Hinges", "Two steel friction hinges inside the full-width hinge cover.")
    hb.emit("SM_Display_Hinges", hg, smooth=("steel",))
    return g


def bbox_world(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            mn = Vector((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
            mx = Vector((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
    return mn, mx


def set_explode(on):
    for o in bpy.context.scene.objects:
        if "explode" in o:
            if "_base" not in o:
                o["_base"] = list(o.location)
            o.location = Vector(o["_base"]) + (Vector(o["explode"]) if on else Vector((0, 0, 0)))
    bpy.context.view_layer.update()


def setup_render():
    from g16_geo import lin, make_mat
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = int(os.environ.get("G16_SAMPLES", "32"))
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1400, 1050
    world = bpy.data.worlds.new("World")
    sc.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*lin("#1b1e25"), 1)
    bg.inputs[1].default_value = 0.35
    collection("COL_RenderOnly")
    obj("RND_Floor", rbox(0, 0, 6000, 6000, -2.0, -1.7), make_mat("floor", "MAT_Floor", "#15171c", 0, 0.7))
    for name, loc, energy, size, color in [("LGT_Key", (-0.9, -1.1, 1.4), 140, 1.2, "#fff4e8"),
                                           ("LGT_Fill", (1.3, -0.6, 0.6), 45, 1.5, "#dfe8ff"),
                                           ("LGT_Rim", (0.4, 1.4, 1.2), 110, 1.0, "#cfe0ff")]:
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy, ld.size, ld.color = energy, size, lin(color)
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        CUR["col"].objects.link(lo)
    cd = bpy.data.cameras.new("CAM_Hero")
    cd.lens = 50
    cam = bpy.data.objects.new("CAM_Hero", cd)
    CUR["col"].objects.link(cam)
    sc.camera = cam


def render_view(path, azim, elev, scale, objs=None):
    sc = bpy.context.scene
    if objs is None:
        objs = [o for o in sc.objects if o.type == "MESH" and not o.name.startswith("RND_")]
    mn, mx = bbox_world(objs)
    center = (mn + mx) / 2
    radius = (mx - mn).length / 2
    dist = radius * scale / math.tan(sc.camera.data.angle / 2)
    a, e = math.radians(azim), math.radians(elev)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    sc.camera.location = center + d * dist
    sc.camera.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_materials()
    build_bottom_cover()
    build_thermal()
    build_battery_audio()
    build_motherboard()
    build_ioboard()
    build_keyboard()
    build_touchpad()
    build_palmrest()
    build_display()
    bpy.context.view_layer.update()
    sc = bpy.context.scene
    meshes = [o for o in sc.objects if o.type == "MESH"]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    print("G16 objects:", len(meshes), "triangles:", tris)
    os.makedirs(os.path.join(ROOT, "viewer"), exist_ok=True)
    glb = os.path.join(ROOT, "viewer", "g16-7630.raw.glb")
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_extras=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False)
    print("Exported", glb, os.path.getsize(glb))
    if "--render" in ARGV:
        os.makedirs(os.path.join(ROOT, "renders"), exist_ok=True)
        setup_render()
        set_explode(False)
        render_view(os.path.join(ROOT, "renders", "g16-7630-assembled.png"), -38, 24, 1.05)
        set_explode(True)
        render_view(os.path.join(ROOT, "renders", "g16-7630-exploded.png"), -38, 22, 1.3)
        set_explode(False)
        for o in list(sc.objects):
            if o.name.startswith(("RND_", "LGT_", "CAM_")):
                bpy.data.objects.remove(o)
    for o in sc.objects:
        if "_base" in o:
            del o["_base"]
    if "--no-blend" not in ARGV:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "g16_7630.blend"), compress=True)


main()
