import math

import bpy
from mathutils import Matrix, Vector

S = 0.001
M = {}
CUR = {"col": None}


def lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def make_mat(key, name, hexc, metal=0.0, rough=0.5, emit=None, strength=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
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


MATERIALS = [
    ("shell", "MAT_Shell_Nightshade", "#25272d", 0.4, 0.44),
    ("bottom", "MAT_Shell_Bottom", "#1c1e22", 0.2, 0.6),
    ("plastic", "MAT_Plastic_Black", "#121317", 0.0, 0.6),
    ("bezel", "MAT_Bezel_Black", "#0c0d10", 0.0, 0.7),
    ("vent", "MAT_Vent_Black", "#060708", 0.0, 0.9),
    ("keycap", "MAT_Keycap", "#17181c", 0.0, 0.55),
    ("legend", "MAT_Key_Legend", "#8fdcff", 0.0, 0.4, "#8fdcff", 4.0),
    ("kbplate", "MAT_Keyboard_Plate", "#2a2c31", 0.6, 0.45),
    ("touchpad", "MAT_Touchpad_Glass", "#1b1c21", 0.0, 0.3, None, 0.0, 0.6),
    ("mask", "MAT_PCB_Soldermask", "#0f3a29", 0.0, 0.36, None, 0.0, 0.3),
    ("trace", "MAT_PCB_Trace", "#1f6a46", 0.1, 0.32),
    ("pour", "MAT_PCB_CopperPour", "#18543a", 0.1, 0.34),
    ("silk", "MAT_PCB_Silkscreen", "#e9ece6", 0.0, 0.6),
    ("via", "MAT_PCB_Via", "#b7a36a", 0.8, 0.35),
    ("hole", "MAT_PCB_Hole", "#050605", 0.0, 0.9),
    ("gold", "MAT_Gold", "#d6a84a", 1.0, 0.22),
    ("solder", "MAT_Solder_Tin", "#c4c8ce", 1.0, 0.3),
    ("copper", "MAT_Copper", "#c27a4a", 1.0, 0.28),
    ("copperdark", "MAT_Copper_Oxidized", "#9a5a36", 1.0, 0.42),
    ("alu", "MAT_Aluminum", "#b9bdc4", 1.0, 0.35),
    ("steel", "MAT_Steel", "#8b8f97", 1.0, 0.38),
    ("blacksteel", "MAT_Steel_Black", "#2b2d31", 0.8, 0.45),
    ("die", "MAT_Silicon_Die", "#4a5468", 0.9, 0.07),
    ("underfill", "MAT_Underfill", "#1d2420", 0.0, 0.5),
    ("substrate", "MAT_Substrate_CPU", "#2f5a3c", 0.0, 0.42, None, 0.0, 0.3),
    ("substrate2", "MAT_Substrate_GPU", "#1c2f24", 0.0, 0.42, None, 0.0, 0.3),
    ("chip", "MAT_Chip_Mold", "#151517", 0.0, 0.45),
    ("marking", "MAT_Chip_Marking", "#8d9096", 0.0, 0.6),
    ("mlcc", "MAT_MLCC_Ceramic", "#a68c64", 0.0, 0.5),
    ("resistor", "MAT_Resistor_Body", "#141414", 0.0, 0.5),
    ("ferrite", "MAT_Inductor_Ferrite", "#3b3d42", 0.2, 0.55),
    ("spcap", "MAT_Polymer_Cap", "#2a2b2e", 0.1, 0.4),
    ("pin1", "MAT_Pin1_Dot", "#0a0a0b", 0.0, 0.8),
    ("pcbdark", "MAT_PCB_Black", "#151a1d", 0.0, 0.4, None, 0.0, 0.3),
    ("ssdpcb", "MAT_PCB_SSD", "#16213a", 0.0, 0.4, None, 0.0, 0.3),
    ("battery", "MAT_Battery_Wrap", "#18191c", 0.0, 0.42),
    ("label", "MAT_Label", "#d9dadc", 0.0, 0.6),
    ("labeltext", "MAT_Label_Text", "#202124", 0.0, 0.6),
    ("rubber", "MAT_Rubber", "#0d0d0e", 0.0, 0.85),
    ("fpc", "MAT_Flex_Cable", "#c8792a", 0.0, 0.45),
    ("kapton", "MAT_Kapton_Tape", "#c9832a", 0.0, 0.28, None, 0.0, 0.5),
    ("zif", "MAT_Connector_White", "#e6e1d3", 0.0, 0.6),
    ("fan", "MAT_Fan_Plastic", "#141519", 0.0, 0.5),
    ("screen", "MAT_Screen", "#0a0f1a", 0.0, 0.2, "#16243a", 1.0),
    ("panelback", "MAT_Panel_Back", "#9aa0a8", 0.8, 0.4),
    ("lens", "MAT_Lens", "#050608", 0.0, 0.05),
    ("chrome", "MAT_Logo_Chrome", "#d8dbe0", 1.0, 0.12),
    ("portin", "MAT_Port_Inner", "#2b2f38", 0.0, 0.5),
    ("cableblack", "MAT_Cable_Black", "#101010", 0.0, 0.6),
    ("cablegrey", "MAT_Cable_Grey", "#9a9a9a", 0.0, 0.6),
    ("wirered", "MAT_Wire_Red", "#b3261e", 0.0, 0.5),
    ("wireyellow", "MAT_Wire_Yellow", "#d4b020", 0.0, 0.5),
    ("wireblue", "MAT_Wire_Blue", "#2050b0", 0.0, 0.5),
    ("wirewhite", "MAT_Wire_White", "#dddddd", 0.0, 0.5),
    ("speaker", "MAT_Speaker_Mesh", "#2c2e33", 0.5, 0.6),
    ("led", "MAT_LED", "#ffffff", 0.0, 0.3, "#ffffff", 6.0),
    ("ledgreen", "MAT_LED_Green", "#5cff8a", 0.0, 0.3, "#5cff8a", 3.0),
    ("ledamber", "MAT_LED_Amber", "#ffb347", 0.0, 0.3, "#ffb347", 3.0),
    ("thermalpad", "MAT_Thermal_Pad", "#7d8ea0", 0.0, 0.85),
    ("thermalpink", "MAT_Thermal_Pad_Pink", "#c98a9a", 0.0, 0.85),
    ("paste", "MAT_Thermal_Paste", "#9a9da4", 0.3, 0.6),
    ("mylar", "MAT_Mylar", "#0b0b0c", 0.0, 0.25),
    ("foam", "MAT_Foam", "#151515", 0.0, 0.95),
    ("cell", "MAT_Battery_Cell", "#20252c", 0.3, 0.35),
    ("glass", "MAT_Glass_Dark", "#0d1117", 0.0, 0.08),
]


def build_materials():
    for row in MATERIALS:
        make_mat(*row)


class Geo:
    def __init__(self):
        self.v = []
        self.f = []

    def add(self, verts, faces, m=None):
        o = len(self.v)
        flip = m is not None and m.determinant() < 0
        if m is None:
            self.v.extend(Vector(p) for p in verts)
        else:
            self.v.extend(m @ Vector(p) for p in verts)
        for fc in faces:
            fc = [i + o for i in fc]
            if flip:
                fc.reverse()
            self.f.append(fc)
        return self

    def merge(self, g, m=None):
        return self.add(g.v, g.f, m)


class Bag:
    def __init__(self):
        self.g = {}

    def add(self, key, geo, m=None):
        self.g.setdefault(key, Geo()).merge(geo, m)
        return self

    def put(self, other, m=None):
        for k, geo in other.g.items():
            self.add(k, geo, m)
        return self

    def emit(self, name, parent, smooth=(), angle=40):
        out = []
        for k, geo in self.g.items():
            if geo.f:
                out.append(obj(name + "_" + k, geo, M[k], parent, smooth=k in smooth, angle=angle))
        return out


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def Rx(a):
    return Matrix.Rotation(a, 4, "X")


def Ry(a):
    return Matrix.Rotation(a, 4, "Y")


def Rz(a):
    return Matrix.Rotation(a, 4, "Z")


def Sc(x, y, z):
    return Matrix.Diagonal((x, y, z, 1.0))


AXIS_Y = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))
AXIS_X = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1)))


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


def round_poly(pts, r, n=4):
    out = []
    k = len(pts)
    for i in range(k):
        p0, p1, p2 = (Vector((*pts[j % k], 0)) for j in (i - 1, i, i + 1))
        a, b = p0 - p1, p2 - p1
        d = min(r, a.length / 2, b.length / 2)
        s, e = p1 + a.normalized() * d, p1 + b.normalized() * d
        for j in range(n + 1):
            t = j / n
            q = (1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t ** 2 * e
            out.append((q.x, q.y))
    return out


def prism(loop, z0, z1=None, top_loop=None, ztop=None, caps=True):
    n = len(loop)
    tl = top_loop or loop
    verts = [(x, y, z0) for x, y in loop]
    verts += [(x, y, ztop(x, y) if ztop else z1) for x, y in tl]
    faces = [list(range(n - 1, -1, -1)), list(range(n, 2 * n))] if caps else []
    for i in range(n):
        j = (i + 1) % n
        faces.append([i, j, n + j, n + i])
    return Geo().add(verts, faces)


def ring(outer, inner, z0, z1, top=True, bottom=True, sides=True):
    n = len(outer)
    verts = [(x, y, z0) for x, y in outer] + [(x, y, z1) for x, y in outer]
    verts += [(x, y, z0) for x, y in inner] + [(x, y, z1) for x, y in inner]
    ob, ot, ib, it = 0, n, 2 * n, 3 * n
    faces = []
    for i in range(n):
        j = (i + 1) % n
        if sides:
            faces.append([ob + i, ob + j, ot + j, ot + i])
            faces.append([ib + j, ib + i, it + i, it + j])
        if top:
            faces.append([ot + i, ot + j, it + j, it + i])
        if bottom:
            faces.append([ob + j, ob + i, ib + i, ib + j])
    return Geo().add(verts, faces)


def annulus_top(cx, cy, ro, ri, z, n=8):
    o = circle(cx, cy, ro, n)
    i = circle(cx, cy, ri, n)
    verts = [(x, y, z) for x, y in o] + [(x, y, z) for x, y in i]
    faces = [[k, (k + 1) % n, n + (k + 1) % n, n + k] for k in range(n)]
    return Geo().add(verts, faces)


def disk_top(cx, cy, r, z, n=8):
    return Geo().add([(x, y, z) for x, y in circle(cx, cy, r, n)], [list(range(n))])


def bx(x0, x1, y0, y1, z0, z1):
    return prism([(x1, y0), (x1, y1), (x0, y1), (x0, y0)], z0, z1)


def rbox(cx, cy, w, d, z0, z1, r=0.0, seg=3, inset=0.0):
    tl = rrect(cx, cy, w - 2 * inset, d - 2 * inset, max(r - inset, 0.0), seg) if inset else None
    return prism(rrect(cx, cy, w, d, r, seg), z0, z1, top_loop=tl)


def cylz(cx, cy, z0, z1, r, n=24, top_r=None):
    tl = circle(cx, cy, top_r, n) if top_r else None
    return prism(circle(cx, cy, r, n), z0, z1, top_loop=tl)


def section(loop_uw, t0, t1, axis):
    if axis == "y":
        loop = [(u, -w) for u, w in loop_uw][::-1]
        return Geo().merge(prism(loop, t0, t1), AXIS_Y)
    loop = [(-w, u) for u, w in loop_uw]
    return Geo().merge(prism(loop, t0, t1), AXIS_X)


def section_ring(outer_uw, inner_uw, t0, t1, axis, front=True, back=True):
    if axis == "y":
        o = [(u, -w) for u, w in outer_uw][::-1]
        i = [(u, -w) for u, w in inner_uw][::-1]
        return Geo().merge(ring(o, i, t0, t1, top=front, bottom=back), AXIS_Y)
    o = [(-w, u) for u, w in outer_uw]
    i = [(-w, u) for u, w in inner_uw]
    return Geo().merge(ring(o, i, t0, t1, top=front, bottom=back), AXIS_X)


def cylx(x0, x1, cy, cz, r, n=24):
    return section(circle(cy, cz, r, n), x0, x1, "x")


def cyly(y0, y1, cx, cz, r, n=24):
    return section(circle(cx, cz, r, n), y0, y1, "y")


def tri(cx, cy, z, s, ang):
    pts = [(0, s * 0.6), (-s * 0.55, -s * 0.4), (s * 0.55, -s * 0.4)]
    return Geo().add([(x, y, 0) for x, y in pts], [[0, 1, 2]], T(cx, cy, z) @ Rz(ang))


def strip(points, w, z0, h, ends=True):
    n = len(points)
    g = Geo()
    if n < 2:
        return g
    pts = [Vector((p[0], p[1])) for p in points]
    left, right = [], []
    for i in range(n):
        if i == 0:
            d = (pts[1] - pts[0]).normalized()
            nrm = Vector((-d.y, d.x))
            off = nrm * (w / 2)
        elif i == n - 1:
            d = (pts[i] - pts[i - 1]).normalized()
            nrm = Vector((-d.y, d.x))
            off = nrm * (w / 2)
        else:
            d0 = (pts[i] - pts[i - 1]).normalized()
            d1 = (pts[i + 1] - pts[i]).normalized()
            n0 = Vector((-d0.y, d0.x))
            n1 = Vector((-d1.y, d1.x))
            mit = n0 + n1
            if mit.length < 1e-6:
                mit = n0.copy()
            mit.normalize()
            off = mit * ((w / 2) / max(0.35, mit.dot(n0)))
        left.append(pts[i] + off)
        right.append(pts[i] - off)
    verts = []
    for i in range(n):
        verts += [(left[i].x, left[i].y, z0 + h), (right[i].x, right[i].y, z0 + h),
                  (left[i].x, left[i].y, z0), (right[i].x, right[i].y, z0)]
    faces = []
    for i in range(n - 1):
        a, b = 4 * i, 4 * (i + 1)
        faces.append([a + 1, b + 1, b, a])
        faces.append([b + 2, a + 2, a, b])
        faces.append([a + 3, b + 3, b + 1, a + 1])
    if ends:
        faces.append([2, 3, 1, 0])
        e = 4 * (n - 1)
        faces.append([e + 3, e + 2, e, e + 1])
    return g.add(verts, faces)


def scene_link(ob):
    bpy.context.scene.collection.objects.link(ob)


_TXT = {}


def text_geo(s, size, res=2, bold=False):
    key = (s, size, res)
    if key in _TXT:
        return _TXT[key]
    cu = bpy.data.curves.new("tmp_txt", "FONT")
    cu.body = s
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = res
    ob = bpy.data.objects.new("tmp_txt", cu)
    scene_link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    g = Geo().add([v.co.copy() for v in me.vertices], [list(p.vertices) for p in me.polygons])
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    _TXT[key] = g
    return g


def text_lines(lines, size, z, spacing=1.45, res=2):
    g = Geo()
    n = len(lines)
    for i, s in enumerate(lines):
        if not s:
            continue
        sz = size[i] if isinstance(size, (list, tuple)) else size
        y = ((n - 1) / 2 - i) * (size[0] if isinstance(size, (list, tuple)) else size) * spacing
        g.merge(text_geo(s, sz, res), T(0, y, z))
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


def pipe_geo(pts3d, r, flatten=1.0, corner=10.0, res=3):
    pts2 = [(p[0], p[1]) for p in pts3d]
    zs = [p[2] for p in pts3d]
    pts = rounded_path(pts2, corner)
    zmap = []
    total = [0.0]
    for i in range(1, len(pts2)):
        total.append(total[-1] + (Vector(pts2[i]) - Vector(pts2[i - 1])).length)
    acc = [0.0]
    for i in range(1, len(pts)):
        acc.append(acc[-1] + (Vector(pts[i]) - Vector(pts[i - 1])).length)
    scale = total[-1] / acc[-1] if acc[-1] > 0 else 1.0
    for a in acc:
        d = a * scale
        for k in range(1, len(total)):
            if d <= total[k] + 1e-9 or k == len(total) - 1:
                t = 0.0 if total[k] == total[k - 1] else (d - total[k - 1]) / (total[k] - total[k - 1])
                zmap.append(zs[k - 1] + (zs[k] - zs[k - 1]) * max(0.0, min(1.0, t)))
                break
    cu = bpy.data.curves.new("tmp_pipe", "CURVE")
    cu.dimensions = "3D"
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, (x, y) in enumerate(pts):
        sp.points[i].co = (x, y, zmap[i], 1)
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    ob = bpy.data.objects.new("tmp_pipe", cu)
    scene_link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    zc = sum(zs) / len(zs)
    verts = []
    for v in me.vertices:
        verts.append(Vector((v.co.x, v.co.y, v.co.z if flatten == 1.0 else zc + (v.co.z - zc) * flatten)))
    g = Geo().add(verts, [list(p.vertices) for p in me.polygons])
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return g


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


def boolean(target, cutter, op, solver="EXACT"):
    md = target.modifiers.new("bool_" + cutter.name, "BOOLEAN")
    md.operation = op
    md.object = cutter
    md.solver = solver
    cutter.hide_render = True
    cutter.display_type = "WIRE"


def cut(target, geos, solver="MANIFOLD"):
    g = Geo()
    for x in geos:
        g.merge(x)
    if not g.f:
        return
    c = obj("CUT_" + target.name, g, M["vent"])
    boolean(target, c, "DIFFERENCE", solver)
    apply_mods(target)
    bpy.data.objects.remove(c)


def in_poly(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def in_rects(x, y, rects, pad=0.0):
    return any(r[0] - pad <= x <= r[1] + pad and r[2] - pad <= y <= r[3] + pad for r in rects)


def barcode(rng, x0, y0, w, h, z, bars=36):
    g = Geo()
    x = x0
    widths = [rng.choice((0.18, 0.18, 0.36, 0.54)) for _ in range(bars)]
    scale = w / (sum(widths) * 2)
    for bw in widths:
        g.merge(bx(x, x + bw * scale, y0, y0 + h, z, z + 0.01))
        x += bw * scale * 2
    return g


def datamatrix(rng, cx, cy, size, z, n=12):
    g = Geo()
    c = size / n
    x0, y0 = cx - size / 2, cy - size / 2
    for i in range(n):
        for j in range(n):
            on = i == 0 or j == 0 or (i == n - 1 and j % 2 == 0) or (j == n - 1 and i % 2 == 0) or rng.random() < 0.45
            if on:
                g.merge(bx(x0 + i * c, x0 + (i + 1) * c, y0 + j * c, y0 + (j + 1) * c, z, z + 0.01))
    return g
