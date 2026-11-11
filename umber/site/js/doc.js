import { mk, cx, clone, crop, uid, emit, bounds, clamp, rgba } from './util.js';
import { applyAdjust, blurCanvas, chamfer } from './fx.js';

export const BLENDS = [
  ['normal', 'Normal'], null,
  ['darken', 'Darken'], ['multiply', 'Multiply'], ['color-burn', 'Color Burn'], null,
  ['lighten', 'Lighten'], ['screen', 'Screen'], ['color-dodge', 'Color Dodge'], ['lighter', 'Linear Dodge (Add)'], null,
  ['overlay', 'Overlay'], ['soft-light', 'Soft Light'], ['hard-light', 'Hard Light'], null,
  ['difference', 'Difference'], ['exclusion', 'Exclusion'], null,
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']
];
const gco = (b) => (b === 'normal' ? 'source-over' : b);
const copy = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

export class Layer {
  constructor(o = {}) {
    this.id = o.id || uid();
    this.name = o.name || 'Layer';
    this.type = o.type || 'raster';
    this.visible = o.visible !== false;
    this.opacity = o.opacity == null ? 1 : o.opacity;
    this.blend = o.blend || 'normal';
    this.x = o.x || 0;
    this.y = o.y || 0;
    this.canvas = o.canvas || mk(1, 1);
    this.mask = o.mask || null;
    this.clip = !!o.clip;
    this.lock = !!o.lock;
    this.text = o.text || null;
    this.fx = o.fx || null;
    this.adj = o.adj || null;
    this.ver = 0;
    this.tm = null;
    this.fxc = null;
  }
  get w() { return this.canvas.width; }
  get h() { return this.canvas.height; }
}

export class Doc {
  constructor(w, h, dpi = 300, name = 'Untitled-1') {
    this.id = uid();
    this.w = Math.round(w);
    this.h = Math.round(h);
    this.dpi = dpi;
    this.name = name;
    this.layers = [];
    this.active = null;
    this.target = 'layer';
    this.sel = null;
    this.hist = [];
    this.hi = -1;
    this.dirty = false;
    this.zoom = 0;
    this.px = 0;
    this.py = 0;
    this.guides = [];
  }
  get al() { return this.layers.find((l) => l.id === this.active) || null; }
  touch(what) {
    emit('doc', { doc: this, what: what || 'pixels' });
  }
  add(l, i) {
    if (i == null) {
      const a = this.al;
      i = a ? this.layers.indexOf(a) + 1 : this.layers.length;
    }
    this.layers.splice(i, 0, l);
    this.active = l.id;
    this.target = 'layer';
    return l;
  }
  newName(prefix = 'Layer') {
    let n = 1;
    while (this.layers.some((l) => l.name === prefix + ' ' + n)) n++;
    return prefix + ' ' + n;
  }
  snap() {
    return {
      w: this.w, h: this.h, dpi: this.dpi, active: this.active, target: this.target, sel: this.sel,
      layers: this.layers.map((l) => ({
        ref: l,
        p: {
          name: l.name, type: l.type, visible: l.visible, opacity: l.opacity, blend: l.blend, x: l.x, y: l.y,
          canvas: l.canvas, clip: l.clip, lock: l.lock, mask: l.mask ? { ...l.mask } : null,
          text: copy(l.text), fx: copy(l.fx), adj: copy(l.adj)
        }
      }))
    };
  }
  restore(s) {
    this.w = s.w;
    this.h = s.h;
    this.dpi = s.dpi;
    this.active = s.active;
    this.target = s.target;
    this.sel = s.sel;
    this.layers = s.layers.map((e) => {
      const l = e.ref;
      Object.assign(l, e.p, { mask: e.p.mask ? { ...e.p.mask } : null, text: copy(e.p.text), fx: copy(e.p.fx), adj: copy(e.p.adj) });
      l.ver++;
      l.tm = null;
      return l;
    });
    if (!this.al) this.active = this.layers.length ? this.layers[this.layers.length - 1].id : null;
  }
  push(name, undo, redo, bytes = 0) {
    this.hist.length = this.hi + 1;
    this.hist.push({ name, undo, redo, bytes });
    let total = this.hist.reduce((n, e) => n + e.bytes, 0);
    while (this.hist.length > 40 || (total > 7e8 && this.hist.length > 2)) {
      total -= this.hist.shift().bytes;
    }
    this.hi = this.hist.length - 1;
    this.dirty = true;
    emit('hist', this);
  }
  commit(name, before) {
    const after = this.snap();
    const seen = new Set(before.layers.map((e) => e.p.canvas));
    let bytes = 0;
    for (const e of after.layers) if (!seen.has(e.p.canvas)) bytes += e.p.canvas.width * e.p.canvas.height * 4;
    this.push(name, () => this.restore(before), () => this.restore(after), bytes);
    this.touch('all');
  }
  act(name, fn) {
    const before = this.snap();
    const r = fn();
    this.commit(name, before);
    return r;
  }
  patch(name, l, key, backup, r) {
    const c = key === 'mask' ? l.mask.canvas : l.canvas;
    const x = clamp(Math.floor(r.x), 0, c.width);
    const y = clamp(Math.floor(r.y), 0, c.height);
    const w = Math.min(c.width, Math.ceil(r.x + r.w)) - x;
    const hh = Math.min(c.height, Math.ceil(r.y + r.h)) - y;
    if (w <= 0 || hh <= 0) return;
    const before = crop(backup, x, y, w, hh);
    const after = crop(c, x, y, w, hh);
    const put = (img) => {
      const g = cx(c);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(x, y, w, hh);
      g.drawImage(img, x, y);
      g.restore();
      l.ver++;
    };
    this.push(name, () => put(before), () => put(after), w * hh * 8);
    this.touch();
  }
  beginPaint(l, key = 'canvas') {
    const before = this.snap();
    const grew = cover(this, l);
    const c = key === 'mask' ? l.mask.canvas : l.canvas;
    return { l, key, before, grew, backup: clone(c) };
  }
  endPaint(name, s, r) {
    if (s.grew) this.commit(name, s.before);
    else if (r) this.patch(name, s.l, s.key, s.backup, r);
  }
  undo() {
    if (this.hi < 0) return false;
    this.hist[this.hi].undo();
    this.hi--;
    this.dirty = true;
    emit('hist', this);
    this.touch('all');
    return true;
  }
  redo() {
    if (this.hi >= this.hist.length - 1) return false;
    this.hi++;
    this.hist[this.hi].redo();
    this.dirty = true;
    emit('hist', this);
    this.touch('all');
    return true;
  }
  goto(i) {
    while (this.hi > i) this.undo();
    while (this.hi < i && this.redo());
  }
}

export function cover(doc, l) {
  const x0 = Math.min(l.x, 0);
  const y0 = Math.min(l.y, 0);
  const x1 = Math.max(l.x + l.w, doc.w);
  const y1 = Math.max(l.y + l.h, doc.h);
  if (x0 === l.x && y0 === l.y && x1 - x0 === l.w && y1 - y0 === l.h) return false;
  const c = mk(x1 - x0, y1 - y0);
  cx(c).drawImage(l.canvas, l.x - x0, l.y - y0);
  if (l.mask) {
    const m = mk(x1 - x0, y1 - y0);
    const g = cx(m);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, m.width, m.height);
    g.clearRect(l.mask.x - x0, l.mask.y - y0, l.mask.canvas.width, l.mask.canvas.height);
    g.drawImage(l.mask.canvas, l.mask.x - x0, l.mask.y - y0);
    l.mask = { canvas: m, x: x0, y: y0, on: l.mask.on };
  }
  l.canvas = c;
  l.x = x0;
  l.y = y0;
  l.ver++;
  return true;
}

let pool = {};
function sc(key, w, h, smooth) {
  const k = key + w + 'x' + h;
  let c = pool[k];
  if (!c) c = pool[k] = mk(w, h);
  const g = cx(c);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  g.imageSmoothingEnabled = smooth.on;
  g.imageSmoothingQuality = smooth.q;
  return g;
}
export function freeScratch() {
  pool = {};
}

function fxOf(l) {
  const f = l.fx;
  const st = f && f.stroke && f.stroke.on && f.stroke.size > 0 ? f.stroke : null;
  const sh = f && f.shadow && f.shadow.on ? f.shadow : null;
  const ov = f && f.overlay && f.overlay.on ? f.overlay : null;
  if (!st && !sh && !ov) return l;
  const key = l.ver + JSON.stringify(f) + l.w + 'x' + l.h;
  if (l.fxc && l.fxc.key === key) {
    l.fxc.x = l.x - l.fxc.pad;
    l.fxc.y = l.y - l.fxc.pad;
    return l.fxc;
  }
  const sp = st ? Math.ceil(st.size) : 0;
  const pad = sp + (sh ? Math.ceil(sh.blur * 2 + sh.dist) : 0) + 2;
  const w = l.w + pad * 2;
  const hh = l.h + pad * 2;
  let body = l.canvas;
  if (ov) {
    body = clone(l.canvas);
    const g = cx(body);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = rgba(ov.color, ov.opacity == null ? 1 : ov.opacity);
    g.fillRect(0, 0, body.width, body.height);
  }
  const combo = mk(w, hh);
  const cg = cx(combo);
  if (st) {
    const n = Math.max(12, Math.ceil(2 * Math.PI * sp));
    for (let ring = 1; ring <= (sp > 6 ? 2 : 1); ring++) {
      const rad = sp * (ring === 1 ? 1 : 0.5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        cg.drawImage(l.canvas, pad + Math.cos(a) * rad, pad + Math.sin(a) * rad);
      }
    }
    cg.globalCompositeOperation = 'source-in';
    cg.fillStyle = rgba(st.color, 1);
    cg.fillRect(0, 0, w, hh);
    cg.globalCompositeOperation = 'source-over';
  }
  cg.drawImage(body, pad, pad);
  const out = mk(w, hh);
  const og = cx(out);
  if (sh) {
    const a = ((sh.angle == null ? 135 : sh.angle) * Math.PI) / 180;
    og.shadowColor = rgba(sh.color, sh.opacity == null ? 0.6 : sh.opacity);
    og.shadowBlur = sh.blur;
    og.shadowOffsetX = Math.cos(a) * sh.dist;
    og.shadowOffsetY = Math.sin(a) * sh.dist;
  }
  og.drawImage(combo, 0, 0);
  l.fxc = { key, pad, canvas: out, x: l.x - pad, y: l.y - pad };
  return l.fxc;
}

function drawRaw(g, l, s, tx, ty) {
  const f = fxOf(l);
  g.setTransform(s, 0, 0, s, tx, ty);
  if (l.tm) {
    g.transform(l.tm[0], l.tm[1], l.tm[2], l.tm[3], l.tm[4], l.tm[5]);
    g.drawImage(f.canvas, f.x - l.x, f.y - l.y);
  } else {
    g.drawImage(f.canvas, f.x, f.y);
  }
}
function drawMask(g, l, s, tx, ty) {
  const m = l.mask;
  g.setTransform(s, 0, 0, s, tx, ty);
  if (l.tm) {
    g.transform(l.tm[0], l.tm[1], l.tm[2], l.tm[3], l.tm[4], l.tm[5]);
    g.drawImage(m.canvas, m.x - l.x, m.y - l.y);
  } else {
    g.drawImage(m.canvas, m.x, m.y);
  }
}
function drawLayer(g, l, W, H, s, tx, ty, alpha, op, smooth) {
  if (l.mask && l.mask.on) {
    const t = sc('m', W, H, smooth);
    drawRaw(t, l, s, tx, ty);
    t.globalCompositeOperation = 'destination-in';
    drawMask(t, l, s, tx, ty);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.drawImage(t.canvas, 0, 0);
  } else {
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    drawRaw(g, l, s, tx, ty);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}
function drawAdjust(g, l, W, H, s, tx, ty, doc, smooth) {
  const x0 = clamp(Math.floor(tx), 0, W);
  const y0 = clamp(Math.floor(ty), 0, H);
  const x1 = clamp(Math.ceil(tx + doc.w * s), 0, W);
  const y1 = clamp(Math.ceil(ty + doc.h * s), 0, H);
  if (x1 <= x0 || y1 <= y0) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(x0, y0, x1 - x0, y1 - y0);
  applyAdjust(img.data, l.adj.kind, l.adj.p, img.width, img.height);
  const t = sc('m', W, H, smooth);
  t.putImageData(img, x0, y0);
  if (l.mask && l.mask.on) {
    t.globalCompositeOperation = 'destination-in';
    drawMask(t, l, s, tx, ty);
  }
  g.globalAlpha = l.opacity;
  g.globalCompositeOperation = gco(l.blend);
  g.drawImage(t.canvas, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
}

export function render(doc, g, s = 1, tx = 0, ty = 0, o = {}) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const smooth = { on: s < 2 || s % 1 !== 0, q: s < 1 ? 'high' : 'low' };
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(tx, ty, doc.w * s, doc.h * s);
  g.clip();
  g.imageSmoothingEnabled = smooth.on;
  g.imageSmoothingQuality = smooth.q;
  const ls = o.layers || doc.layers;
  let i = 0;
  while (i < ls.length) {
    const l = ls[i];
    let j = i + 1;
    while (j < ls.length && ls[j].clip) j++;
    const kids = ls.slice(i + 1, j).filter((k) => k.visible);
    i = j;
    if (!l.visible) continue;
    if (l.type === 'adjust') {
      drawAdjust(g, l, W, H, s, tx, ty, doc, smooth);
      continue;
    }
    if (!kids.length) {
      drawLayer(g, l, W, H, s, tx, ty, l.opacity, gco(l.blend), smooth);
      continue;
    }
    const a = sc('a', W, H, smooth);
    drawLayer(a, l, W, H, s, tx, ty, 1, 'source-over', smooth);
    for (const k of kids) {
      if (k.type === 'adjust') {
        drawAdjust(a, k, W, H, s, tx, ty, doc, smooth);
      } else if (k.blend === 'normal') {
        drawLayer(a, k, W, H, s, tx, ty, k.opacity, 'source-atop', smooth);
      } else {
        const b = sc('b', W, H, smooth);
        drawLayer(b, k, W, H, s, tx, ty, 1, 'source-over', smooth);
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.globalCompositeOperation = 'destination-in';
        b.drawImage(a.canvas, 0, 0);
        a.setTransform(1, 0, 0, 1, 0, 0);
        a.globalAlpha = k.opacity;
        a.globalCompositeOperation = gco(k.blend);
        a.drawImage(b.canvas, 0, 0);
        a.globalAlpha = 1;
        a.globalCompositeOperation = 'source-over';
      }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = l.opacity;
    g.globalCompositeOperation = gco(l.blend);
    g.drawImage(a.canvas, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }
  g.restore();
}

export function flatten(doc, o) {
  const c = mk(doc.w, doc.h);
  render(doc, cx(c), 1, 0, 0, o);
  if (doc.w * doc.h > 3e6) freeScratch();
  return c;
}

export function sample(doc, x, y, merged = true) {
  const c = mk(1, 1);
  const g = cx(c, { willReadFrequently: true });
  const l = doc.al;
  if (merged || !l) render(doc, g, 1, -Math.floor(x), -Math.floor(y));
  else g.drawImage(l.canvas, l.x - Math.floor(x), l.y - Math.floor(y));
  const d = g.getImageData(0, 0, 1, 1).data;
  return { r: d[0], g: d[1], b: d[2], a: d[3] };
}

export function setSel(doc, c) {
  doc.sel = null;
  if (c) {
    const b = bounds(c);
    if (b) doc.sel = { c, b, path: null };
  }
  emit('sel', doc);
}

export function combineSel(doc, c, mode = 'new', feather = 0) {
  if (feather > 0) c = blurCanvas(c, feather);
  const old = doc.sel && doc.sel.c;
  if (old && mode !== 'new') {
    const n = mk(doc.w, doc.h);
    const g = cx(n);
    g.drawImage(old, 0, 0);
    if (mode === 'sub') g.globalCompositeOperation = 'destination-out';
    else if (mode === 'int') g.globalCompositeOperation = 'destination-in';
    g.drawImage(c, 0, 0);
    c = n;
  }
  setSel(doc, c);
}

export function selShape(doc, draw, mode, feather) {
  const c = mk(doc.w, doc.h);
  const g = cx(c);
  g.fillStyle = '#fff';
  draw(g);
  combineSel(doc, c, mode, feather);
}

export function selInvert(doc) {
  const c = mk(doc.w, doc.h);
  const g = cx(c);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, doc.w, doc.h);
  if (doc.sel) {
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(doc.sel.c, 0, 0);
  }
  setSel(doc, c);
}

export function selGrow(doc, n) {
  if (!doc.sel || !n) return;
  const w = doc.w;
  const hh = doc.h;
  const img = cx(doc.sel.c).getImageData(0, 0, w, hh);
  const d = img.data;
  const inside = n < 0;
  const dist = chamfer(d, w, hh, inside);
  const r = Math.abs(n);
  for (let i = 0, p = 3; i < dist.length; i++, p += 4) {
    const v = dist[i];
    let a;
    if (inside) a = clamp((v - r) * 255 + 128, 0, 255);
    else a = clamp((r - v) * 255 + 128, 0, 255);
    d[p - 3] = d[p - 2] = d[p - 1] = 255;
    d[p] = a;
  }
  const c = mk(w, hh);
  cx(c).putImageData(img, 0, 0);
  setSel(doc, c);
}

export function selFeather(doc, r) {
  if (!doc.sel || r <= 0) return;
  setSel(doc, blurCanvas(doc.sel.c, r));
}

export function selPath(sel) {
  if (sel.path) return sel.path;
  const b = sel.b;
  const w = b.w + 2;
  const hh = b.h + 2;
  const src = cx(sel.c).getImageData(b.x - 1, b.y - 1, w, hh).data;
  const on = new Uint8Array(w * hh);
  for (let i = 0, p = 3; i < on.length; i++, p += 4) on[i] = src[p] > 127 ? 1 : 0;
  const path = new Path2D();
  const ox = b.x - 1;
  const oy = b.y - 1;
  for (let y = 1; y < hh; y++) {
    let start = -1;
    const r0 = (y - 1) * w;
    const r1 = y * w;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on[r0 + x] !== on[r1 + x];
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) {
        path.moveTo(ox + start, oy + y);
        path.lineTo(ox + x, oy + y);
        start = -1;
      }
    }
  }
  for (let x = 1; x < w; x++) {
    let start = -1;
    for (let y = 0; y <= hh; y++) {
      const edge = y < hh && on[y * w + x - 1] !== on[y * w + x];
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) {
        path.moveTo(ox + x, oy + start);
        path.lineTo(ox + x, oy + y);
        start = -1;
      }
    }
  }
  sel.path = path;
  return path;
}

export function clipToSel(doc, c, ox, oy) {
  if (!doc.sel) return c;
  const g = cx(c);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(doc.sel.c, -ox, -oy);
  g.restore();
  return c;
}

const measurer = cx(mk(4, 4));
export function fontOf(t, size) {
  return (t.italic ? 'italic ' : '') + (t.bold ? '700 ' : '400 ') + (size || t.size) + 'px "' + t.font + '", sans-serif';
}
export function renderText(l) {
  const t = l.text;
  const font = fontOf(t);
  measurer.font = font;
  const lines = String(t.str || '').split('\n');
  const widths = lines.map((s) => measurer.measureText(s).width);
  const m = measurer.measureText('Mg');
  const asc = m.fontBoundingBoxAscent || t.size * 0.9;
  const desc = m.fontBoundingBoxDescent || t.size * 0.25;
  const lh = t.size * (t.lh || 1.2);
  const W = Math.max(1, Math.ceil(Math.max(...widths)));
  const H = Math.max(1, Math.ceil(lines.length * lh));
  const pad = Math.ceil(t.size * 0.35) + 2;
  const c = mk(W + pad * 2, H + pad * 2);
  const g = cx(c);
  g.font = font;
  g.fillStyle = rgba(t.color, 1);
  g.textBaseline = 'alphabetic';
  lines.forEach((s, i) => {
    const x = pad + (t.align === 'center' ? (W - widths[i]) / 2 : t.align === 'right' ? W - widths[i] : 0);
    const y = pad + i * lh + (lh - (asc + desc)) / 2 + asc;
    g.fillText(s, x, y);
    if (t.underline) g.fillRect(x, y + Math.max(1, t.size * 0.08), widths[i], Math.max(1, t.size * 0.06));
  });
  t.bw = W;
  t.bh = H;
  const ang = ((t.angle || 0) * Math.PI) / 180;
  if (!ang) {
    l.canvas = c;
    l.x = Math.round(t.x - pad);
    l.y = Math.round(t.y - pad);
  } else {
    const cs = Math.cos(ang);
    const sn = Math.sin(ang);
    const pts = [[-pad, -pad], [W + pad, -pad], [W + pad, H + pad], [-pad, H + pad]].map(([px, py]) => [px * cs - py * sn, px * sn + py * cs]);
    const x0 = Math.floor(Math.min(...pts.map((p) => p[0])));
    const y0 = Math.floor(Math.min(...pts.map((p) => p[1])));
    const x1 = Math.ceil(Math.max(...pts.map((p) => p[0])));
    const y1 = Math.ceil(Math.max(...pts.map((p) => p[1])));
    const r = mk(x1 - x0, y1 - y0);
    const rg = cx(r);
    rg.imageSmoothingQuality = 'high';
    rg.translate(-x0, -y0);
    rg.rotate(ang);
    rg.drawImage(c, -pad, -pad);
    l.canvas = r;
    l.x = Math.round(t.x + x0);
    l.y = Math.round(t.y + y0);
  }
  l.ver++;
}

export function thumb(doc, l, size = 40) {
  const sx = size / Math.max(doc.w, doc.h);
  const c = mk(Math.max(1, doc.w * sx), Math.max(1, doc.h * sx));
  const g = cx(c);
  g.imageSmoothingQuality = 'medium';
  if (l.type === 'adjust') return c;
  g.drawImage(l.canvas, l.x * sx, l.y * sx, l.w * sx, l.h * sx);
  return c;
}

export function maskThumb(doc, l, size = 40) {
  const sx = size / Math.max(doc.w, doc.h);
  const c = mk(Math.max(1, doc.w * sx), Math.max(1, doc.h * sx));
  const g = cx(c);
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const m = l.mask;
  g.drawImage(m.canvas, m.x * sx, m.y * sx, m.canvas.width * sx, m.canvas.height * sx);
  return c;
}

export function newMask(doc, l, fromSel, hide) {
  const x0 = Math.min(l.type === 'adjust' ? 0 : l.x, 0);
  const y0 = Math.min(l.type === 'adjust' ? 0 : l.y, 0);
  const x1 = Math.max(l.type === 'adjust' ? 0 : l.x + l.w, doc.w);
  const y1 = Math.max(l.type === 'adjust' ? 0 : l.y + l.h, doc.h);
  const c = mk(x1 - x0, y1 - y0);
  const g = cx(c);
  if (fromSel && doc.sel) {
    g.drawImage(doc.sel.c, -x0, -y0);
    if (hide) {
      g.globalCompositeOperation = 'source-out';
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
    }
  } else if (!hide) {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
  }
  l.mask = { canvas: c, x: x0, y: y0, on: true };
  l.ver++;
}

export function bake(l) {
  if (!l.tm) return;
  const m = l.tm;
  const pts = [[0, 0], [l.w, 0], [l.w, l.h], [0, l.h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  const x0 = Math.floor(Math.min(...pts.map((p) => p[0])));
  const y0 = Math.floor(Math.min(...pts.map((p) => p[1])));
  const x1 = Math.ceil(Math.max(...pts.map((p) => p[0])));
  const y1 = Math.ceil(Math.max(...pts.map((p) => p[1])));
  const draw = (src, dx, dy) => {
    const c = mk(x1 - x0, y1 - y0);
    const g = cx(c);
    g.imageSmoothingQuality = 'high';
    g.setTransform(m[0], m[1], m[2], m[3], m[4] - x0, m[5] - y0);
    g.drawImage(src, dx, dy);
    return c;
  };
  const canvas = draw(l.canvas, 0, 0);
  if (l.mask) l.mask = { canvas: draw(l.mask.canvas, l.mask.x - l.x, l.mask.y - l.y), x: x0, y: y0, on: l.mask.on };
  l.canvas = canvas;
  l.x = x0;
  l.y = y0;
  l.tm = null;
  l.ver++;
}
