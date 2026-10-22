import bpy
import math
import os
import random
import sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
S = 0.001

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
FAN_X = 118.0
FAN_R = 39.0

random.seed(7630)


def zdeck(y):
    return ZF + (y - YF) / (YSF - YF) * (ZR - ZF)


ZP = zdeck(YP) + LT / 2


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


M = {}


def make_mat(key, name, hexc, metal=0.0, rough=0.5, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    c = lin(hexc)
    bsdf.inputs["Base Color"].default_value = (*c, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = 0.08
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*lin(emit), 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (*c, 1)
    m.metallic = metal
    m.roughness = rough
    M[key] = m
    return m


def build_materials():
    make_mat("shell", "MAT_Shell_Nightshade", "#25272d", 0.4, 0.44)
    make_mat("bottom", "MAT_Shell_Bottom", "#1c1e22", 0.2, 0.6)
    make_mat("plastic", "MAT_Plastic_Black", "#121317", 0.0, 0.6)
    make_mat("bezel", "MAT_Bezel_Black", "#0c0d10", 0.0, 0.7)
    make_mat("vent", "MAT_Vent_Black", "#060708", 0.0, 0.9)
    make_mat("keycap", "MAT_Keycap", "#17181c", 0.0, 0.55)
    make_mat("legend", "MAT_Key_Legend", "#8fdcff", 0.0, 0.4, "#8fdcff", 4.0)
    make_mat("kbplate", "MAT_Keyboard_Plate", "#2a2c31", 0.6, 0.45)
    make_mat("touchpad", "MAT_Touchpad_Glass", "#1b1c21", 0.0, 0.3, coat=0.6)
    make_mat("pcb", "MAT_PCB", "#0f3a29", 0.0, 0.58)
    make_mat("gold", "MAT_Gold", "#d6a84a", 1.0, 0.25)
    make_mat("copper", "MAT_Copper", "#c27a4a", 1.0, 0.28)
    make_mat("alu", "MAT_Aluminum", "#b9bdc4", 1.0, 0.35)
    make_mat("steel", "MAT_Steel", "#8b8f97", 1.0, 0.38)
    make_mat("silicon", "MAT_Silicon_Die", "#3c4250", 0.8, 0.15)
    make_mat("substrate", "MAT_Substrate", "#2f5a3c", 0.0, 0.5)
    make_mat("chip", "MAT_Chip_Black", "#151517", 0.0, 0.45)
    make_mat("smd", "MAT_SMD", "#6b5a45", 0.0, 0.5)
    make_mat("choke", "MAT_Choke", "#4a4c52", 0.3, 0.5)
    make_mat("battery", "MAT_Battery_Wrap", "#18191c", 0.0, 0.5)
    make_mat("label", "MAT_Label", "#d9dadc", 0.0, 0.6)
    make_mat("labeltext", "MAT_Label_Text", "#202124", 0.0, 0.6)
    make_mat("rubber", "MAT_Rubber", "#0d0d0e", 0.0, 0.85)
    make_mat("fpc", "MAT_Flex_Cable", "#c8792a", 0.0, 0.45)
    make_mat("zif", "MAT_Connector_White", "#e6e1d3", 0.0, 0.6)
    make_mat("fan", "MAT_Fan_Plastic", "#141519", 0.0, 0.5)
    make_mat("screen", "MAT_Screen", "#0a0f1a", 0.0, 0.2, "#16243a", 1.0)
    make_mat("panelback", "MAT_Panel_Back", "#9aa0a8", 0.8, 0.4)
    make_mat("lens", "MAT_Lens", "#050608", 0.0, 0.05)
    make_mat("chrome", "MAT_Logo_Chrome", "#d8dbe0", 1.0, 0.12)
    make_mat("portin", "MAT_Port_Inner", "#2b2f38", 0.0, 0.5)
    make_mat("cableblack", "MAT_Cable_Black", "#101010", 0.0, 0.6)
    make_mat("cablegrey", "MAT_Cable_Grey", "#9a9a9a", 0.0, 0.6)
    make_mat("speaker", "MAT_Speaker_Mesh", "#2c2e33", 0.5, 0.6)
    make_mat("led", "MAT_LED", "#ffffff", 0.0, 0.3, "#ffffff", 6.0)


class Geo:
    def __init__(self):
        self.v = []
        self.f = []

    def add(self, verts, faces, m=None):
        o = len(self.v)
        for p in verts:
            p = Vector(p)
            if m is not None:
                p = m @ p
            self.v.append(p)
        for fc in faces:
            self.f.append([i + o for i in fc])
        return self

    def merge(self, g, m=None):
        return self.add(g.v, g.f, m)


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rx(a):
    return Matrix.Rotation(a, 4, "X")


def Ry(a):
    return Matrix.Rotation(a, 4, "Y")


def Rz(a):
    return Matrix.Rotation(a, 4, "Z")


def rrect(cx, cy, w, d, r, seg=6):
    r = max(0.0, min(r, w / 2 - 1e-4, d / 2 - 1e-4))
    if r <= 1e-6:
        seg, r = 0, 0.0
    corners = [(cx + w / 2 - r, cy - d / 2 + r, -90), (cx + w / 2 - r, cy + d / 2 - r, 0),
               (cx - w / 2 + r, cy + d / 2 - r, 90), (cx - w / 2 + r, cy - d / 2 + r, 180)]
    pts = []
    for ox, oy, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + (90 * i / seg if seg else 0))
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def circle(cx, cy, r, n=24):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def circle_matching(loop, cx, cy, r):
    out = []
    for x, y in loop:
        a = math.atan2(y - cy, x - cx)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return out


def prism(loop, z0, z1=None, top_loop=None, ztop=None):
    n = len(loop)
    tl = top_loop or loop
    verts = [(x, y, z0) for x, y in loop]
    verts += [(x, y, ztop(x, y) if ztop else z1) for x, y in tl]
    faces = [list(range(n - 1, -1, -1)), list(range(n, 2 * n))]
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return Geo().add(verts, faces)


def ring(outer, inner, z0, z1):
    n = len(outer)
    verts = [(x, y, z0) for x, y in outer] + [(x, y, z1) for x, y in outer]
    verts += [(x, y, z0) for x, y in inner] + [(x, y, z1) for x, y in inner]
    ob, ot, ib, it = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append([ob + i, ob + j, ot + j, ot + i])
        faces.append([ib + j, ib + i, it + i, it + j])
        faces.append([ot + i, ot + j, it + j, it + i])
        faces.append([ob + j, ob + i, ib + i, ib + j])
    return Geo().add(verts, faces)


def bx(x0, x1, y0, y1, z0, z1):
    return prism([(x1, y0), (x1, y1), (x0, y1), (x0, y0)], z0, z1)


def rbox(cx, cy, w, d, z0, z1, r=0.0, seg=3):
    return prism(rrect(cx, cy, w, d, r, seg), z0, z1)


def cylz(cx, cy, z0, z1, r, n=24):
    return prism(circle(cx, cy, r, n), z0, z1)


def cylx(x0, x1, cy, cz, r, n=24):
    return Geo().merge(prism(circle(-cz, cy, r, n), x0, x1), Ry(math.pi / 2))


def cyly(y0, y1, cx, cz, r, n=24):
    return Geo().merge(prism(circle(cx, -cz, r, n), y0, y1), Rx(-math.pi / 2))


def tri(cx, cy, z, s, ang):
    pts = [(0, s * 0.6), (-s * 0.55, -s * 0.4), (s * 0.55, -s * 0.4)]
    m = T(cx, cy, z) @ Rz(ang)
    return Geo().add([(x, y, 0) for x, y in pts], [[0, 1, 2]], m)


def scene_link(ob):
    bpy.context.scene.collection.objects.link(ob)


def text_geo(s, size):
    cu = bpy.data.curves.new("tmp_txt", "FONT")
    cu.body = s
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 3
    ob = bpy.data.objects.new("tmp_txt", cu)
    scene_link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    g = Geo().add([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return g


def rounded_path(pts, rad, n=6):
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p0, p1, p2 = (Vector((*pts[k], 0)) for k in (i - 1, i, i + 1))
        a, b = p0 - p1, p2 - p1
        d = min(rad, a.length / 2, b.length / 2)
        s, e = p1 + a.normalized() * d, p1 + b.normalized() * d
        for k in range(n + 1):
            t = k / n
            q = (1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t ** 2 * e
            out.append((q.x, q.y))
    out.append(pts[-1])
    return out


def pipe_geo(pts2d, z, r, flatten=1.0, corner=10.0):
    pts = rounded_path(pts2d, corner)
    cu = bpy.data.curves.new("tmp_pipe", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts):
        sp.points[i].co = (x, y, z, 1)
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    ob = bpy.data.objects.new("tmp_pipe", cu)
    scene_link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    verts = [Vector((v.co.x, v.co.y, z + (v.co.z - z) * flatten)) for v in me.vertices]
    g = Geo().add(verts, [list(p.vertices) for p in me.polygons])
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return g


CUR = {"col": None}


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    CUR["col"] = c
    return c


def shade(me, angle=32):
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(angle))


def obj(name, geo, mat, parent=None, smooth=False, angle=32):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p * S) for p in geo.v], [], geo.f)
    me.validate()
    me.update()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    CUR["col"].objects.link(ob)
    if parent is not None:
        ob.parent = parent
    if smooth:
        shade(me, angle)
    return ob


def empty(name, loc=(0, 0, 0), rot=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"
    ob.empty_display_size = 0.02
    ob.location = Vector(loc) * S
    ob.rotation_euler = rot
    CUR["col"].objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def meta(ob, label=None, info=None, explode=None, layer=None):
    if label:
        ob["label"] = label
    if info:
        ob["info"] = info
    if explode is not None:
        ob["explode"] = [e * S for e in explode]
    if layer is not None:
        ob["layer"] = layer
    return ob


def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def boolean(target, cutter, op):
    md = target.modifiers.new("bool_" + cutter.name, "BOOLEAN")
    md.operation = op
    md.object = cutter
    md.solver = "EXACT"
    cutter.hide_render = True
    cutter.display_type = "WIRE"


def build_bottom_cover():
    collection("COL_BottomCover")
    g = meta(empty("GRP_BottomCover"), "Bottom cover (D-cover)",
             "Base panel with fan intakes, rubber feet and 10 captive screws.", (0, 0, 0), 0)
    loop = rrect(0, 0, W, D, CR)
    shell = prism(loop, 0, 1.6)
    shell.merge(ring(loop, rrect(0, 0, W - 2 * WALL, D - 2 * WALL, CR - WALL), 1.6, 5.0))
    obj("SM_BottomCover_Shell", shell, M["bottom"], g, smooth=True)

    vents = Geo()
    for fx in (-FAN_X, FAN_X):
        for row in range(-8, 9):
            y = FAN_Y + row * 4.2
            off = 5.0 if row % 2 else 0.0
            for col in range(-4, 5):
                x = fx + col * 10.0 + off
                if (x - fx) ** 2 + (y - FAN_Y) ** 2 < 33.0 ** 2:
                    vents.merge(rbox(x, y, 8.0, 1.8, -0.12, 1.75, 0.9, 2))
    for row in range(14):
        y = 58 + row * 4.2
        off = 5.0 if row % 2 else 0.0
        for col in range(-6, 7):
            vents.merge(rbox(col * 10.0 + off, y, 8.0, 1.8, -0.12, 1.75, 0.9, 2))
    obj("SM_BottomCover_Vents", vents, M["vent"], g)

    feet = rbox(0, -128, 300, 7, -1.0, 0.05, 3.4, 4)
    feet.merge(rbox(0, 131, 300, 8, -1.6, 0.05, 3.9, 4))
    obj("SM_BottomCover_Feet", feet, M["rubber"], g, smooth=True)

    screws = Geo()
    recess = Geo()
    for x, y in [(-168, -134), (168, -134), (-168, -20), (168, -20), (-168, 134), (168, 134),
                 (-60, -134), (60, -134), (-60, 134), (60, 134)]:
        screws.merge(cylz(x, y, -0.25, 0.05, 2.4, 20))
        recess.merge(bx(x - 1.4, x + 1.4, y - 0.25, y + 0.25, -0.32, -0.2))
        recess.merge(bx(x - 0.25, x + 0.25, y - 1.4, y + 1.4, -0.32, -0.2))
    obj("SM_BottomCover_Screws", screws, M["steel"], g, smooth=True)
    obj("SM_BottomCover_ScrewRecess", recess, M["vent"], g)

    lab = rbox(0, -40, 62, 26, -0.12, 0.0, 2.0, 3)
    obj("SM_BottomCover_Label", lab, M["label"], g)
    txt = Geo()
    for i, (s, size) in enumerate([("DELL  G16 7630", 3.6), ("Model P223F  ·  Reg. Type P223F001", 2.0),
                                   ("Input 20V  16.5A", 2.0)]):
        txt.merge(text_geo(s, size), T(0, -32 - i * 6.5, -0.14) @ Rx(math.pi))
    obj("SM_BottomCover_LabelText", txt, M["labeltext"], g)
    return g


def build_thermal():
    collection("COL_Thermal")
    g = meta(empty("GRP_Thermal"), "Thermal module",
             "Six flattened copper heat pipes feed four aluminum fin stacks: two at the rear and one on each side.",
             (0, 0, GAP), 1)
    for side, fx in (("L", -FAN_X), ("R", FAN_X)):
        f = meta(empty("GRP_Fan_" + side, parent=g), ("Left" if side == "L" else "Right") + " fan",
                 "Blower fan. Pulls air in through the bottom cover and keyboard grille, pushes it through the fins.")
        outer = rrect(fx, FAN_Y, 80, 80, 16, 4)
        housing = ring(outer, circle_matching(outer, fx, FAN_Y, 24), 2.2, 2.8)
        housing.merge(ring(outer, rrect(fx, FAN_Y, 77.6, 77.6, 14.8, 4), 2.8, 14.4))
        obj("SM_Fan_" + side + "_Housing", housing, M["fan"], f, smooth=True)
        top = ring(outer, circle_matching(outer, fx, FAN_Y, 27), 14.4, 15.0)
        obj("SM_Fan_" + side + "_Cover", top, M["alu"], f, smooth=True)
        imp = cylz(fx, FAN_Y, 3.4, 13.6, 13.0, 32)
        imp.merge(ring(circle(fx, FAN_Y, 33.5, 48), circle(fx, FAN_Y, 30.5, 48), 13.0, 13.4))
        for i in range(41):
            a = 2 * math.pi * i / 41
            imp.merge(bx(-9.75, 9.75, -0.25, 0.25, 3.6, 13.4),
                      T(fx, FAN_Y, 0) @ Rz(a) @ T(23.75, 0, 0) @ Rz(math.radians(28)))
        obj("SM_Fan_" + side + "_Impeller", imp, M["fan"], f)
        hub = cylz(fx, FAN_Y, 13.6, 13.7, 9.0, 32)
        obj("SM_Fan_" + side + "_HubLabel", hub, M["label"], f, smooth=True)

    fins = Geo()
    for sx in (-1, 1):
        x = 80.0
        while x < 156.0:
            fins.merge(bx(sx * x - 0.1, sx * x + 0.1, 131.0, 141.0, 2.6, 22.6))
            x += 1.3
        fins.merge(bx(min(sx * 80, sx * 156), max(sx * 80, sx * 156), 131.0, 141.0, 2.3, 2.6))
        y = 58.0
        while y < 124.0:
            fins.merge(bx(min(sx * 159, sx * 172), max(sx * 159, sx * 172), y - 0.1, y + 0.1, 2.6, 15.6))
            y += 1.3
        fins.merge(bx(min(sx * 159, sx * 172), max(sx * 159, sx * 172), 58.0, 124.0, 2.3, 2.6))
    meta(obj("SM_FinStacks", fins, M["alu"], g), "Fin stacks",
         "Aluminum fins behind the rear and side exhaust vents.")

    pz, pr = 5.9, 2.5
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
        pipes.merge(pipe_geo(p, pz, pr, 0.6, 9.0))
    meta(obj("SM_HeatPipes", pipes, M["copper"], g, smooth=True, angle=60), "Heat pipes",
         "Six flattened copper heat pipes carry heat from both cold plates to the fin stacks.")

    meta(obj("SM_ColdPlate_CPU", rbox(-45, 30, 46, 36, 7.4, 8.9, 2.0), M["copper"], g, smooth=True),
         "CPU cold plate", "Copper contact plate over the processor die.")
    meta(obj("SM_ColdPlate_GPU", rbox(40, 32, 74, 48, 7.4, 8.9, 3.0), M["copper"], g, smooth=True),
         "GPU cold plate", "Copper plate covering the GPU die and the four GDDR6 chips.")

    br = Geo()
    heads = Geo()
    for cx, cy, ex, ey in ((-45, 30, 28, 24), (40, 32, 34, 26)):
        for sx in (-1, 1):
            for sy in (-1, 1):
                tx, ty = cx + sx * ex, cy + sy * ey
                v = Vector((tx - cx, ty - cy, 0))
                br.merge(bx(0, v.length, -3.0, 3.0, 3.2, 3.8), T(cx, cy, 0) @ Rz(math.atan2(v.y, v.x)))
                heads.merge(cylz(tx, ty, 2.6, 3.8, 2.6, 20))
        br.merge(rbox(cx, cy, 14, 14, 3.2, 3.8, 3.0))
    meta(obj("SM_RetentionBrackets", br, M["steel"], g), "Retention brackets",
         "Spring-steel brackets that press the cold plates onto the CPU and GPU.")
    obj("SM_RetentionScrews", heads, M["steel"], g, smooth=True)
    return g


def build_battery_audio():
    collection("COL_Battery")
    g = meta(empty("GRP_Battery"), "Battery",
             "Li-ion pack, 56 Wh 3-cell or 86 Wh 6-cell. 295.2 × 77.7 × 7.56 mm.", (0, 0, 2 * GAP), 2)
    obj("SM_Battery_Body", rbox(0, -97.5, 295.2, 77.7, 2.0, 9.56, 3.0, 4), M["battery"], g, smooth=True)
    obj("SM_Battery_Label", rbox(-40, -97.5, 130, 40, 9.56, 9.62, 2.0, 3), M["label"], g)
    txt = Geo()
    for i, (s, size) in enumerate([("DELL", 5.0), ("6-CELL  86Wh  LI-ION", 3.0), ("11.4V  ·  7.5Ah", 2.6)]):
        txt.merge(text_geo(s, size), T(-40, -86 - i * 9.0, 9.64))
    obj("SM_Battery_LabelText", txt, M["labeltext"], g)
    plug = rbox(0, -56.9, 20, 3.6, 7.8, 9.6, 0.4)
    obj("SM_Battery_Plug", plug, M["zif"], g)
    wires = Geo()
    for i in range(6):
        wires.merge(cyly(-58.7, -57.0, -6.25 + i * 2.5, 8.7, 0.6, 10))
    obj("SM_Battery_Wires", wires, M["cableblack"], g, smooth=True)

    a = meta(empty("GRP_Speakers"), "Speakers", "Stereo speaker pair, down-firing through the bottom cover.",
             (0, 0, 2 * GAP), 2)
    for side, sx in (("L", -1), ("R", 1)):
        sp = rbox(sx * 162, -100, 22, 55, 2.0, 11.0, 4.0, 4)
        o = obj("SM_Speaker_" + side, sp, M["plastic"], a, smooth=True)
        meta(o, ("Left" if sx < 0 else "Right") + " speaker", "Sealed speaker box with a down-firing driver.")
        obj("SM_Speaker_" + side + "_Grille", rbox(sx * 162, -100, 14, 40, 1.9, 2.0, 3.0, 3), M["speaker"], o)
        w = cyly(-72.5, -60, sx * 158, 8.0, 0.7, 10)
        w.merge(cyly(-72.5, -60, sx * 160, 8.0, 0.7, 10))
        obj("SM_Speaker_" + side + "_Wire", w, M["cableblack"], o, smooth=True)
    return g


BOARD = [(-172, -56), (145, -56), (145, 50), (79, 50), (79, 141), (-79, 141), (-79, 50), (-172, 50)]


def in_poly(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def in_rects(x, y, rects):
    return any(r[0] <= x <= r[1] and r[2] <= y <= r[3] for r in rects)


def build_motherboard():
    collection("COL_Motherboard")
    g = meta(empty("GRP_Motherboard"), "System board",
             "Main logic board. The CPU, GPU, video memory, RAM, SSD and Wi-Fi card are attached to it and move with it.",
             (0, 0, 3 * GAP), 3)
    z0, z1 = 10.6, 11.8
    obj("SM_MB_PCB", prism(BOARD, z0, z1), M["pcb"], g)

    pads = Geo()
    holes = Geo()
    for x, y in [(-165, -50), (138, -50), (-165, 44), (138, 44), (-72, 135), (72, 135), (-20, -50), (0, 80)]:
        pads.merge(ring(circle(x, y, 3.2, 20), circle(x, y, 1.5, 20), z1, z1 + 0.05))
        pads.merge(ring(circle(x, y, 3.2, 20), circle(x, y, 1.5, 20), z0 - 0.05, z0))
        holes.merge(cylz(x, y, z0 - 0.04, z1 + 0.04, 1.5, 20))
    obj("SM_MB_MountPads", pads, M["gold"], g)
    obj("SM_MB_MountHoles", holes, M["vent"], g)

    cpu = meta(obj("SM_CPU", rbox(-45, 30, 45, 37.5, 9.6, z0, 0.6), M["substrate"], g), "CPU",
               "Intel Core i7-13650HX (i5-13450HX to i9-13900HX options). Soldered BGA package, die facing the cold plate.")
    obj("SM_CPU_Die", rbox(-45, 30, 24, 11, 9.0, 9.6, 0.2), M["silicon"], cpu)
    caps = Geo()
    for i in range(14):
        caps.merge(bx(-63 + i * 2.6, -62 + i * 2.6, 40, 41.6, 9.35, 9.6))
        caps.merge(bx(-63 + i * 2.6, -62 + i * 2.6, 18.4, 20, 9.35, 9.6))
    obj("SM_CPU_Caps", caps, M["smd"], cpu)

    gpu = meta(obj("SM_GPU", rbox(40, 32, 35, 35, 9.6, z0, 0.6), M["substrate"], g), "GPU",
               "NVIDIA GeForce RTX 4060 Laptop GPU (RTX 3050 to RTX 4070 options). Soldered to the board.")
    obj("SM_GPU_Die", rbox(40, 32, 13, 13, 9.0, 9.6, 0.2), M["silicon"], gpu)
    caps = Geo()
    for i in range(10):
        caps.merge(bx(27 + i * 2.6, 28 + i * 2.6, 45.5, 47, 9.35, 9.6))
    obj("SM_GPU_Caps", caps, M["smd"], gpu)
    vram = Geo()
    for x, y in [(12, 48), (12, 16), (68, 48), (68, 16)]:
        vram.merge(rbox(x, y, 14, 12, 9.4, z0, 0.3))
    meta(obj("SM_VRAM", vram, M["chip"], g), "Video memory", "8 GB GDDR6 in four chips around the GPU.")

    for slot, cx in (("A", -40.0), ("B", 35.0)):
        r = meta(empty("GRP_RAM_" + slot, parent=g), "Memory, slot " + slot,
                 "DDR5-4800 SO-DIMM, 8 or 16 GB per slot, dual-channel.")
        obj("SM_RAM_" + slot + "_PCB", bx(cx - 34.8, cx + 34.8, -50, -20, 8.2, 9.2), M["pcb"], r)
        chips = Geo()
        for i in range(4):
            chips.merge(rbox(cx - 24 + i * 16, -37, 11, 10, 7.4, 8.2, 0.3))
        obj("SM_RAM_" + slot + "_Chips", chips, M["chip"], r)
        obj("SM_RAM_" + slot + "_Contacts", bx(cx - 32, cx + 32, -22.6, -19.8, 8.15, 9.25), M["gold"], r)
        obj("SM_RAM_" + slot + "_Label", rbox(cx + 16, -42, 26, 10, 7.36, 7.4, 0.6), M["label"], r)
        obj("SM_RAM_" + slot + "_Slot", bx(cx - 37, cx + 37, -21.5, -15.5, 7.0, z0), M["chip"], g)
        clips = bx(cx - 38.6, cx - 36.4, -46, -24, 7.6, z0)
        clips.merge(bx(cx + 36.4, cx + 38.6, -46, -24, 7.6, z0))
        obj("SM_RAM_" + slot + "_Clips", clips, M["steel"], g)

    ssd = meta(empty("GRP_SSD", parent=g), "SSD", "M.2 2280 PCIe Gen4 x4 NVMe solid-state drive.")
    obj("SM_SSD_PCB", bx(-159, -79, -41, -19, 7.6, 8.4), M["chip"], ssd)
    chips = rbox(-90, -30, 12, 12, 6.8, 7.6, 0.4)
    chips.merge(rbox(-112, -30, 16, 18, 6.8, 7.6, 0.4))
    chips.merge(rbox(-134, -30, 16, 18, 6.8, 7.6, 0.4))
    obj("SM_SSD_Chips", chips, M["chip"], ssd)
    obj("SM_SSD_Label", rbox(-124, -30, 46, 16, 6.74, 6.8, 0.8), M["label"], ssd)
    obj("SM_SSD_Contacts", bx(-82, -79.2, -39, -21, 7.55, 8.45), M["gold"], ssd)
    obj("SM_SSD_Connector", bx(-81, -75, -42, -18, 7.8, z0), M["chip"], g)
    obj("SM_SSD_Standoff", cylz(-159, -30, 7.2, z0, 2.4, 20), M["steel"], g, smooth=True)

    s2 = meta(empty("GRP_M2_Slot2", parent=g), "Second M.2 slot", "Free M.2 2230/2280 slot for a second SSD.")
    obj("SM_M2_Slot2_Connector", bx(75, 81, -42, -18, 7.8, z0), M["chip"], s2)
    obj("SM_M2_Slot2_Standoff", cylz(111, -30, 7.2, z0, 2.4, 20), M["steel"], s2, smooth=True)
    obj("SM_M2_Slot2_Pad", rbox(96, -30, 26, 20, 7.6, 7.9, 1.0), M["fpc"], s2)

    wifi = meta(empty("GRP_WiFi", parent=g), "Wireless card",
                "M.2 2230 Wi-Fi 6E and Bluetooth card (Intel AX211 or Killer options) with two antenna leads.")
    obj("SM_WiFi_PCB", bx(89, 111, -5, 25, 8.2, 9.0), M["pcb"], wifi)
    obj("SM_WiFi_Shield", rbox(100, 12, 18, 20, 7.4, 8.2, 0.8), M["alu"], wifi)
    obj("SM_WiFi_Connector", bx(87, 113, -8, -3, 8.0, z0), M["chip"], g)
    leads = pipe_geo([(96, 24), (96, 40), (77.5, 50), (77.5, 126), (64, 136)], 9.2, 0.6, 1.0, 6.0)
    obj("SM_WiFi_Lead_Main", leads, M["cableblack"], wifi, smooth=True)
    leads = pipe_geo([(104, 24), (104, 42), (78.6, 52), (78.6, 126), (66, 138)], 9.2, 0.6, 1.0, 6.0)
    obj("SM_WiFi_Lead_Aux", leads, M["cablegrey"], wifi, smooth=True)

    coin = meta(obj("SM_CoinCell", cylz(-120, 8, 8.0, z0, 10.0, 32), M["battery"], g, smooth=True),
                "RTC coin-cell battery", "Keeps the BIOS settings and clock when the main battery is removed.")
    obj("SM_CoinCell_Wire", pipe_geo([(-110, 8), (-100, 8), (-96, 0)], 9.0, 0.6, 1.0, 3.0), M["cableblack"], coin,
        smooth=True)

    vrm = Geo()
    mos = Geo()
    for i in range(6):
        vrm.merge(rbox(-70 + i * 9.5, 58, 7.5, 7.5, 7.6, z0, 0.6))
        mos.merge(rbox(-70 + i * 9.5, 66, 5, 6, 9.6, z0, 0.3))
    for i in range(5):
        vrm.merge(rbox(20 + i * 10, 61, 7.5, 7.5, 7.6, z0, 0.6))
        mos.merge(rbox(20 + i * 10, 69, 5, 6, 9.6, z0, 0.3))
    meta(obj("SM_VRM_Chokes", vrm, M["choke"], g, smooth=True, angle=50), "Power stages",
         "Inductors and MOSFETs that regulate power for the CPU and GPU.")
    obj("SM_VRM_Mosfets", mos, M["chip"], g)

    keep_bottom = [(-68, -22, 11, 49), (3, 77, 8, 56), (-76, 71, -52, -14), (-160, -74, -42, -17),
                   (86, 114, -9, 26), (-131, -109, -3, 19), (-75, 70, 53, 74), (73, 83, -43, -17)]
    smd = Geo()
    n = 0
    while n < 240:
        x, y = random.uniform(-171, 144), random.uniform(-55, 140)
        if not in_poly(x, y, BOARD) or in_rects(x, y, keep_bottom):
            continue
        w, d = random.choice([(1.6, 0.8), (1.0, 0.5), (2.0, 1.25), (3.2, 1.6)])
        if random.random() < 0.5:
            w, d = d, w
        smd.merge(bx(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z0 - 0.6, z0))
        n += 1
    n = 0
    keep_top = [(-20, 20, 15, 25), (-32, 12, -50, -40), (-60, 60, 125, 141)]
    while n < 140:
        x, y = random.uniform(-171, 144), random.uniform(-55, 140)
        if not in_poly(x, y, BOARD) or in_rects(x, y, keep_top):
            continue
        w, d = random.choice([(1.6, 0.8), (1.0, 0.5), (2.0, 1.25)])
        smd.merge(bx(x - w / 2, x + w / 2, y - d / 2, y + d / 2, z1, z1 + 0.6))
        n += 1
    obj("SM_MB_SMD", smd, M["smd"], g)

    ics = Geo()
    for x, y, w, d in [(-100, 0, 9, 9), (-112, -26, 6, 5), (-40, 112, 11, 11), (-150, -35, 6, 6),
                       (20, 114, 5, 5), (-150, 12, 8, 8), (-60, -30, 7, 7), (50, -30, 10, 10), (110, -30, 8, 8)]:
        ics.merge(rbox(x, y, w, d, z1, z1 + 0.9, 0.3))
    obj("SM_MB_ICs", ics, M["chip"], g)

    zif = rbox(0, 20, 30, 4.5, z1, z1 + 1.1, 0.4)
    zif.merge(rbox(-10, -45, 14, 4, z1, z1 + 1.0, 0.4))
    zif.merge(rbox(-30, 125, 22, 5, z1, z1 + 1.2, 0.4))
    zif.merge(rbox(0, -52, 24, 7, 7.6, z0, 0.4))
    obj("SM_MB_Connectors", zif, M["zif"], g)

    rear = meta(empty("GRP_Ports_Rear", parent=g), "Rear ports",
                "HDMI 2.1, USB 3.2 Gen 1 Type-A, Thunderbolt 4 (RTX 4070 models) or USB-C 3.2 Gen 2 with DisplayPort, and the 7.4 mm power jack.")
    shells = bx(-44.6, -35.4, 128, 144.0, 11.7, 15.3)
    shells.merge(bx(-21.6, -8.4, 126, 144.0, 10.6, 16.4))
    shells.merge(bx(4.4, 19.6, 126, 144.0, 10.5, 16.5))
    obj("SM_Ports_Rear_Shells", shells, M["steel"], rear)
    dc = bx(37.5, 46.5, 128, 143.0, 8.5, 18.5)
    obj("SM_Ports_Rear_DCJack", dc, M["chip"], rear)
    obj("SM_Ports_Rear_DCRing", cyly(143.0, 144.0, 42, 13.5, 4.4, 28), M["steel"], rear, smooth=True)

    left = meta(empty("GRP_Ports_Left", parent=g), "Left ports", "RJ-45 Ethernet and universal audio jack.")
    obj("SM_Ports_Left_RJ45", bx(-177.2, -158, -13, 3, 5.6, 15.4), M["chip"], left)
    obj("SM_Ports_Left_RJ45_Shield", bx(-177.3, -158, -13.2, 3.2, 15.4, 15.8), M["steel"], left)
    obj("SM_Ports_Left_Audio", bx(-177.2, -163, -51.5, -44.5, 6.5, 12.5), M["chip"], left)
    obj("SM_Ports_Left_AudioRing", cylx(-177.4, -176.6, -48, 9.5, 3.2, 24), M["steel"], left, smooth=True)
    return g


def build_ioboard():
    collection("COL_IOBoard")
    g = meta(empty("GRP_IOBoard"), "I/O board",
             "Right-side daughterboard with two USB 3.2 Gen 1 Type-A ports.", (0, 0, 3 * GAP), 3)
    obj("SM_IO_PCB", bx(148, 174, -50, 48, 10.6, 11.8), M["pcb"], g)
    shells = Geo()
    tongues = Geo()
    for y in (0, 22):
        shells.merge(bx(162.5, 177.2, y - 6.6, y + 6.6, 7.2, 12.8))
        tongues.merge(bx(162.5, 177.25, y - 5.4, y + 5.4, 9.8, 11.4))
    obj("SM_IO_USB_Shells", shells, M["steel"], g)
    obj("SM_IO_USB_Tongues", tongues, M["portin"], g)
    smd = Geo()
    for i in range(30):
        x, y = random.uniform(150, 160), random.uniform(-48, 46)
        smd.merge(bx(x - 0.5, x + 0.5, y - 0.8, y + 0.8, 11.8, 12.3))
    obj("SM_IO_SMD", smd, M["smd"], g)
    obj("SM_IO_Flex", bx(120, 152, -38, -26, 11.85, 11.95), M["fpc"], g)
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
    return g.merge(text_geo(lbl, size), T(cx, cy, z))


def keycap(cx, cy, w, d):
    return prism(rrect(cx, cy, w, d, 1.4, 3), -2.9, 0.4, top_loop=rrect(cx, cy, w - 1.2, d - 1.2, 1.1, 3))


def build_keyboard():
    collection("COL_Keyboard")
    g = meta(empty("GRP_Keyboard", (0, KY, zdeck(KY)), (SLOPE, 0, 0)), "Keyboard",
             "85-key US layout, 19.05 mm key pitch, one-zone RGB backlight (Cherry MX mechanical option).",
             (0, 0, 4 * GAP), 4)
    total_w = 16.25 * U
    total_d = HF + 5 * U
    x0 = -total_w / 2
    top = total_d / 2
    obj("SM_Keyboard_Plate", rbox(0, 0, 311, 110.5, -4.4, -2.9, 3.0), M["kbplate"], g)
    caps = Geo()
    legends = Geo()
    y = top
    centers = []
    for h, keys in ROWS:
        cy = y - h / 2
        x = x0
        for lbl, wu in keys:
            w = wu * U
            caps.merge(keycap(x + w / 2, cy, w - 2.6, h - 2.6))
            legends.merge(legend(lbl, x + w / 2, cy, 0.42))
            x += w
        centers.append(cy)
        y -= h
    cx = x0 + 15.25 * U + U / 2
    power = None
    for i, lbl in enumerate(COLUMN):
        if lbl == "#POWER":
            power = keycap(cx, centers[i], U - 2.6, HF - 2.6)
            legends.merge(legend(lbl, cx, centers[i], 0.42))
            continue
        h = HF if i == 0 else U
        caps.merge(keycap(cx, centers[i], U - 2.6, h - 2.6))
        legends.merge(legend(lbl, cx, centers[i], 0.42))
    obj("SM_Keyboard_Keycaps", caps, M["keycap"], g, smooth=True, angle=40)
    obj("SM_Keyboard_Legends", legends, M["legend"], g)
    meta(obj("SM_Keyboard_PowerButton", power, M["keycap"], g, smooth=True, angle=40), "Power button",
         "Top-right power key with status light.")
    flex = bx(-15, 15, -42, -2, -4.55, -4.45)
    flex.merge(bx(30, 50, -30, 0, -4.55, -4.45))
    obj("SM_Keyboard_Flex", flex, M["fpc"], g)
    return g


def build_touchpad():
    collection("COL_Touchpad")
    g = meta(empty("GRP_Touchpad", (TPX, TPY, zdeck(TPY)), (SLOPE, 0, 0)), "Touchpad",
             "Precision touchpad, 105 × 65 mm.", (0, 0, 4 * GAP), 4)
    obj("SM_Touchpad_Glass", rbox(0, 0, 105, 65, -1.0, -0.05, 3.0, 5), M["touchpad"], g, smooth=True)
    obj("SM_Touchpad_Board", rbox(0, 0, 103, 63, -3.2, -1.0, 2.5, 4), M["pcb"], g)
    obj("SM_Touchpad_Flex", bx(-6, 6, 10, 30, -3.35, -3.25), M["fpc"], g)
    return g


def build_palmrest():
    collection("COL_Palmrest")
    g = meta(empty("GRP_Palmrest"), "Palm rest (C-cover)",
             "Keyboard deck, side walls, rear thermal shelf and all port openings.", (0, 0, 5 * GAP), 5)
    ydeck_end = YSF + 12
    deck = obj("SM_Palmrest", prism(rrect(0, (YF + ydeck_end) / 2, W, ydeck_end - YF, CR), 5.0,
                                    ztop=lambda x, y: zdeck(y)), M["shell"], g)
    cutters = []

    def cutter(name, geo):
        c = obj(name, geo, M["vent"])
        cutters.append(c)
        return c

    shelf = cutter("CUT_Shelf", prism(rrect(0, (YSF + YR) / 2, W, SHELF, CR), 5.0, ZSH))
    cav1 = cutter("CUT_Cavity_Deck", prism(rrect(0, (YF + WALL + YSF + 11) / 2, W - 2 * WALL,
                                                 YSF + 11 - YF - WALL, CR - WALL), 4.0,
                                           ztop=lambda x, y: zdeck(y) - 1.4))
    cav2 = cutter("CUT_Cavity_Shelf", prism(rrect(0, (YSF + WALL + YR - WALL) / 2, W - 2 * WALL,
                                                  SHELF - 2 * WALL, CR - WALL), 4.0, ZSH - 1.6))
    kb = cutter("CUT_Keyboard", rbox(0, KY, 313.6, 112.6, 8.0, 30.0, 3.0))
    tp = cutter("CUT_Touchpad", rbox(TPX, TPY, 106.5, 66.5, 8.0, 30.0, 3.5))
    boolean(deck, shelf, "UNION")
    for c in (cav1, cav2, kb, tp):
        boolean(deck, c, "DIFFERENCE")
    apply_mods(deck)
    for c in cutters:
        bpy.data.objects.remove(c)
    shade(deck.data, 30)

    grille = Geo()
    x = -150.0
    while x <= 150.0:
        yc = 108.0
        grille.merge(rbox(x, yc, 1.6, 12.0, zdeck(yc) - 0.3, zdeck(yc) + 0.12, 0.8, 2))
        x += 3.6
    obj("SM_Palmrest_IntakeGrille", grille, M["vent"], g)

    rear = Geo()
    for sx in (-1, 1):
        x = 70.0
        while x <= 168.0:
            rear.merge(bx(sx * x - 1.2, sx * x + 1.2, YR - 0.4, YR + 0.15, 6.0, 21.5))
            x += 4.2
    for sx in (-1, 1):
        x0, x1 = (-W / 2 - 0.15, -W / 2 + 0.4) if sx < 0 else (W / 2 - 0.4, W / 2 + 0.15)
        y = 62.0
        while y <= 124.0:
            rear.merge(bx(x0, x1, y - 1.1, y + 1.1, 6.5, 15.5))
            y += 4.0
    obj("SM_Palmrest_ExhaustVents", rear, M["vent"], g)

    ports = Geo()
    inner = Geo()
    o0, o1 = YR - 0.2, YR + 0.3
    ports.merge(bx(-44.45, -35.55, o0, o1, 11.9, 15.1))
    inner.merge(bx(-42.2, -37.8, o0, o1 + 0.05, 13.2, 13.8))
    ports.merge(bx(-21.25, -8.75, o0, o1, 11.0, 16.0))
    inner.merge(bx(-20.0, -10.0, o0, o1 + 0.05, 13.8, 15.4))
    ports.merge(bx(4.5, 19.5, o0, o1, 10.75, 16.25))
    inner.merge(bx(6.5, 17.5, o0, o1 + 0.05, 13.0, 14.6))
    ports.merge(cyly(o0, o1, 42, 13.5, 4.0, 28))
    inner.merge(cyly(o0, o1 + 0.05, 42, 13.5, 1.0, 16))
    xl0, xl1 = -W / 2 - 0.3, -W / 2 + 0.2
    ports.merge(bx(xl0, xl1, -12, 2, 5.75, 15.25))
    inner.merge(bx(xl0 - 0.05, xl1, -10, 0, 13.8, 14.6))
    ports.merge(cylx(xl0, xl1, -48, 9.5, 2.9, 24))
    inner.merge(cylx(xl0 - 0.05, xl1, -48, 9.5, 1.6, 20))
    xr0, xr1 = W / 2 - 0.2, W / 2 + 0.3
    for y in (0, 22):
        ports.merge(bx(xr0, xr1, y - 6.25, y + 6.25, 7.5, 12.5))
        inner.merge(bx(xr0, xr1 + 0.05, y - 5.0, y + 5.0, 9.9, 11.3))
    obj("SM_Palmrest_PortOpenings", ports, M["vent"], g)
    obj("SM_Palmrest_PortInner", inner, M["portin"], g)
    obj("SM_Palmrest_StatusLED", bx(-102, -98, YF - 0.25, YF + 0.3, 6.2, 7.2), M["led"], g)

    hb = Geo()
    for sx in (-1, 1):
        hb.merge(bx(min(sx * 146, sx * 164), max(sx * 146, sx * 164), 100, 117, 13.0, 16.6))
    obj("SM_Palmrest_HingeMounts", hb, M["steel"], g)
    return g


def build_display():
    collection("COL_Display")
    g = meta(empty("GRP_Display", (0, YP, ZP), (SLOPE - math.radians(OPEN), 0, 0)), "Display assembly",
             "Opens on a full-width hinge at the front edge of the rear thermal shelf.", (0, 0, 6 * GAP + 60), 6)
    g["hinge_base"] = SLOPE
    g["open_deg"] = OPEN
    yc = (2.0 - LL) / 2
    ya = -LL + 8.0 + ACT_H / 2
    lw = 356.0
    outer = rrect(0, yc, lw, LL + 2.0, 8.0, 6)

    back = meta(obj("SM_Display_BackCover", prism(outer, 0.4, LT / 2), M["shell"], g, smooth=True),
                "Display back cover (A-cover)", "Aluminum lid shell with the Dell logo.", (0, 0, 40))
    logo = ring(circle(0, -LL / 2, 23.5, 64), circle(0, -LL / 2, 22.0, 64), LT / 2, LT / 2 + 0.06)
    logo.merge(text_geo("DELL", 11.0), T(0, -LL / 2, LT / 2 + 0.06) @ Rz(math.pi))
    obj("SM_Display_Logo", logo, M["chrome"], back)

    panel = meta(obj("SM_Display_Panel", rbox(0, ya, ACT_W + 6, ACT_H + 10.5, -2.0, 0.4, 1.5), M["panelback"], g),
                 "Display panel",
                 "16-inch QHD+ 2560 × 1600 WVA panel, 165 Hz or 240 Hz, 344.68 × 215.42 mm active area.", (0, 0, 0))
    sx0, sx1 = -ACT_W / 2, ACT_W / 2
    sy0, sy1 = ya - ACT_H / 2, ya + ACT_H / 2
    sz = -2.06
    scr = Geo().add([(sx0, sy0, sz), (sx0, sy1, sz), (sx1, sy1, sz), (sx1, sy0, sz)], [[0, 1, 2, 3]])
    so = obj("SM_Display_Screen", scr, M["screen"], panel)
    uvl = so.data.uv_layers.new(name="UVMap")
    for lp in so.data.loops:
        co = so.data.vertices[lp.vertex_index].co / S
        uvl.data[lp.index].uv = ((co.x - sx0) / ACT_W, (sy1 - co.y) / ACT_H)
    obj("SM_Display_eDPFlex", bx(-15, 15, ya + ACT_H / 2 + 2, -6, 0.42, 0.52), M["fpc"], panel)

    bez = meta(obj("SM_Display_Bezel", ring(outer, rrect(0, ya, ACT_W + 1.0, ACT_H + 1.0, 1.0, 6), -LT / 2, -2.0),
                   M["bezel"], g, smooth=True), "Display bezel (B-cover)",
               "Front bezel with the 720p HD webcam.", (0, 0, -40))
    cam = ring(circle(0, -LL + 4.2, 2.4, 24), circle(0, -LL + 4.2, 1.5, 24), -LT / 2 - 0.08, -LT / 2)
    obj("SM_Display_WebcamRing", cam, M["plastic"], bez)
    obj("SM_Display_WebcamLens", cylz(0, -LL + 4.2, -LT / 2 - 0.1, -LT / 2, 1.5, 24), M["lens"], bez)

    obj("SM_Display_HingeCover", cylx(-146, 146, 0, 0, 3.7, 32), M["shell"], g, smooth=True)
    hinges = Geo()
    for sx in (-1, 1):
        hinges.merge(cylx(min(sx * 146, sx * 166), max(sx * 146, sx * 166), 0, 0, 3.2, 24))
        hinges.merge(bx(min(sx * 148, sx * 164), max(sx * 148, sx * 164), -36, -2, 0.45, 1.6))
    meta(obj("SM_Display_Hinges", hinges, M["steel"], g, smooth=True, angle=50), "Hinges",
         "Two steel hinges inside the full-width hinge cover.")
    return g


def bbox_world(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != "MESH":
            continue
        for c in o.bound_box:
            p = o.matrix_world @ Vector(c)
            mn = Vector((min(mn.x, p.x), min(mn.y, p.y), min(mn.z, p.z)))
            mx = Vector((max(mx.x, p.x), max(mx.y, p.y), max(mx.z, p.z)))
    return mn, mx


def set_explode(on):
    for o in bpy.context.scene.objects:
        if "explode" in o:
            base = o.get("_base")
            if base is None:
                o["_base"] = list(o.location)
                base = o["_base"]
            o.location = Vector(base) + (Vector(o["explode"]) if on else Vector((0, 0, 0)))
    bpy.context.view_layer.update()


def setup_render():
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = int(os.environ.get("G16_SAMPLES", "40"))
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 1400
    sc.render.resolution_y = 1050
    sc.render.film_transparent = False
    world = bpy.data.worlds.new("World")
    sc.world = world
    if world.node_tree is None:
        world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*lin("#1b1e25"), 1)
    bg.inputs[1].default_value = 0.35
    collection("COL_RenderOnly")
    floor = obj("RND_Floor", rbox(0, 0, 6000, 6000, -2.0, -1.7), make_mat("floor", "MAT_Floor", "#15171c", 0, 0.7))
    for name, loc, energy, size, color in [("LGT_Key", (-0.9, -1.1, 1.4), 140, 1.2, "#fff4e8"),
                                           ("LGT_Fill", (1.3, -0.6, 0.6), 45, 1.5, "#dfe8ff"),
                                           ("LGT_Rim", (0.4, 1.4, 1.2), 110, 1.0, "#cfe0ff")]:
        ld = bpy.data.lights.new(name, "AREA")
        ld.energy = energy
        ld.size = size
        ld.color = lin(color)
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        lo.rotation_euler = (Vector((0, 0, 0.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        CUR["col"].objects.link(lo)
    cd = bpy.data.cameras.new("CAM_Hero")
    cd.lens = 50
    cam = bpy.data.objects.new("CAM_Hero", cd)
    CUR["col"].objects.link(cam)
    sc.camera = cam
    return floor


def render_view(path, azim, elev, scale):
    sc = bpy.context.scene
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
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.unit_settings.scale_length = 1.0
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

    meshes = [o for o in sc.objects if o.type == "MESH"]
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    print("G16 objects:", len(meshes), "triangles:", tris)

    os.makedirs(os.path.join(ROOT, "viewer"), exist_ok=True)
    glb = os.path.join(ROOT, "viewer", "g16-7630.glb")
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
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "blender", "g16_7630.blend"), compress=True)


main()
