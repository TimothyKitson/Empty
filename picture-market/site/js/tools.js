import { mk, cx, clone, crop, clamp, emit, on, rgba, h, bounds } from './util.js';
import { Layer, cover, flatten, sample, selShape, setSel, renderText, bake, fontOf } from './doc.js';
import { wandSelect, wandSeed, wandMix, wandSum, deconPaint, deconJoin } from './fx.js';
import { app, view, toScreen, setZoom, zoomStep, overlay, handle, dualStroke, setCursor, invalidate } from './view.js';

const R = (k, label, min, max, v, unit) => ({ k, label, min, max, v, unit, type: 'range' });
const C = (k, label, v = false) => ({ k, label, v, type: 'check' });
const S = (k, label, options, v) => ({ k, label, options, v, type: 'select' });
const toast = (m) => emit('toast', m);
const O = (id) => app.opts[id];
const luma = (c) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
const union = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
const selMode = (e, id) => (e.shift && e.alt ? 'int' : e.shift ? 'add' : e.alt ? 'sub' : O(id).mode || 'new');
const MODES = [['new', 'New selection'], ['add', 'Add to selection'], ['sub', 'Subtract from selection'], ['int', 'Intersect with selection']];
const SAMPLES = [['1', 'Point Sample'], ['3', '3 by 3 Average'], ['5', '5 by 5 Average'], ['11', '11 by 11 Average']];

export const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS',
  'Inter', 'Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Oswald', 'Raleway', 'Nunito', 'Quicksand', 'Josefin Sans', 'Bebas Neue', 'Anton', 'Archivo Black',
  'Playfair Display', 'Merriweather', 'Lora', 'Libre Baskerville', 'Cormorant Garamond', 'DM Serif Display', 'Abril Fatface', 'Cinzel', 'Alfa Slab One',
  'Pacifico', 'Lobster', 'Dancing Script', 'Great Vibes', 'Sacramento', 'Satisfy', 'Kaushan Script', 'Caveat', 'Indie Flower', 'Patrick Hand', 'Shadows Into Light',
  'Permanent Marker', 'Rock Salt', 'Amatic SC', 'Bangers', 'Fredoka', 'Righteous', 'Comfortaa', 'Luckiest Guy', 'Titan One', 'Black Ops One', 'Monoton', 'Creepster',
  'Orbitron', 'Press Start 2P', 'Special Elite'];
const SYSTEM = new Set(FONTS.slice(0, 8));
const loaded = new Set();
export async function loadFont(family) {
  if (SYSTEM.has(family) || loaded.has(family)) return;
  loaded.add(family);
  const link = h('link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=' + family.replace(/ /g, '+') + '&display=swap' });
  document.head.append(link);
  try {
    await Promise.race([
      new Promise((res) => { link.onload = res; link.onerror = res; }),
      new Promise((res) => setTimeout(res, 5000))
    ]);
    await Promise.race([document.fonts.load('400 24px "' + family + '"'), new Promise((res) => setTimeout(res, 5000))]);
  } catch (e) {
    console.warn(e);
  }
  for (const d of app.docs) {
    for (const l of d.layers) if (l.type === 'text' && l.text.font === family) renderText(l);
    d.touch();
  }
}

export function paintTarget(doc, quiet) {
  const l = doc.al;
  if (!l) return null;
  if (doc.target === 'mask' && l.mask) return { l, key: 'mask' };
  if (l.type !== 'raster') {
    if (!quiet) toast(l.type === 'text' ? 'Rasterize this type layer first (Layer > Rasterize).' : 'Pick a pixel layer to paint on.');
    return null;
  }
  if (l.lock) {
    if (!quiet) toast('This layer is locked.');
    return null;
  }
  if (!l.visible) {
    if (!quiet) toast('The layer is hidden.');
    return null;
  }
  return { l, key: 'canvas' };
}

const tips = new Map();
function getTip(size, hard, color, aliased) {
  const key = [Math.round(size * 2), Math.round(hard * 100), color.r, color.g, color.b, aliased ? 1 : 0].join(',');
  let c = tips.get(key);
  if (c) return c;
  if (tips.size > 24) tips.clear();
  const dim = Math.ceil(size) + 2;
  c = mk(dim, dim);
  const g = cx(c);
  const m = dim / 2;
  const r = size / 2;
  if (aliased || size < 2.5) {
    g.fillStyle = rgba(color, 1);
    g.beginPath();
    g.arc(m, m, Math.max(0.5, r), 0, Math.PI * 2);
    g.fill();
    if (aliased) {
      const img = g.getImageData(0, 0, dim, dim);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 100 ? 255 : 0;
      g.putImageData(img, 0, 0);
    }
  } else {
    const grad = g.createRadialGradient(m, m, 0, m, m, r);
    const hs = clamp(hard, 0, 0.97);
    grad.addColorStop(0, rgba(color, 1));
    grad.addColorStop(hs, rgba(color, 1));
    for (let k = 1; k < 6; k++) {
      const t = k / 6;
      grad.addColorStop(hs + (1 - hs) * t, rgba(color, (1 + Math.cos(Math.PI * t)) / 2));
    }
    grad.addColorStop(1, rgba(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, dim, dim);
  }
  tips.set(key, c);
  return c;
}

let bufCanvas = null;
function getBuf(w, hh) {
  if (!bufCanvas || bufCanvas.width !== w || bufCanvas.height !== hh) bufCanvas = mk(w, hh);
  const g = cx(bufCanvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, hh);
  return bufCanvas;
}
let tmpCanvas = null;
function getTmp(w, hh) {
  if (!tmpCanvas || tmpCanvas.width < w || tmpCanvas.height < hh) tmpCanvas = mk(Math.max(w, 64), Math.max(hh, 64));
  const g = cx(tmpCanvas);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, tmpCanvas.width, tmpCanvas.height);
  return g;
}

const lastPoint = {};
function brushCursor(g, id) {
  const p = view.pointer;
  if (!p.inside) return;
  const r = (O(id).size * view.zoom) / 2;
  if (r < 2) return;
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.beginPath();
  g.arc(p.sx, p.sy, r + 0.5, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(p.sx, p.sy, r - 0.5 > 0 ? r - 0.5 : r, 0, Math.PI * 2);
  g.stroke();
}
function sizeKeys(id, ev) {
  if (ev.key !== '[' && ev.key !== ']' && ev.key !== '{' && ev.key !== '}') return false;
  const o = O(id);
  if (ev.shiftKey && o.hardness != null) {
    o.hardness = clamp(o.hardness + (ev.key === '}' ? 25 : -25), 0, 100);
  } else {
    const s = o.size;
    const step = s < 10 ? 1 : s < 50 ? 5 : s < 100 ? 10 : s < 300 ? 25 : 50;
    o.size = clamp(ev.key === ']' ? s + step : s - step, 1, 2000);
  }
  emit('opts');
  overlay();
  return true;
}

function strokeTool(cfg) {
  let s = null;
  const dab = (x, y, pressure) => {
    const size = Math.max(1, s.size * (s.pen ? 0.25 + 0.75 * pressure : 1));
    const half = (Math.ceil(size) + 2) / 2;
    const lx = x - s.ox;
    const ly = y - s.oy;
    const g = s.bg;
    g.globalAlpha = s.flow;
    if (cfg.source) {
      const t = getTmp(Math.ceil(half * 2), Math.ceil(half * 2));
      const src = cfg.source(s);
      if (!src) return null;
      t.drawImage(src.canvas, -(lx + src.dx - half), -(ly + src.dy - half));
      t.globalCompositeOperation = 'destination-in';
      t.drawImage(getTip(size, s.hard, { r: 255, g: 255, b: 255 }, false), 0, 0);
      const d = Math.ceil(half * 2);
      g.drawImage(t.canvas, 0, 0, d, d, Math.round(lx - half), Math.round(ly - half), d, d);
    } else if (s.aliased) {
      g.drawImage(getTip(size, 1, s.color, true), Math.round(lx - half), Math.round(ly - half));
    } else {
      g.drawImage(getTip(size, s.hard, s.color, false), lx - half, ly - half);
    }
    return { x: lx - half - 1, y: ly - half - 1, w: half * 2 + 2, h: half * 2 + 2 };
  };
  const seg = (x0, y0, x1, y1, pressure) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    let d = s.rest;
    let r = null;
    while (d <= dist) {
      const t = dist ? d / dist : 0;
      r = union(r, dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, pressure));
      d += s.spacing;
    }
    s.rest = d - dist;
    return r;
  };
  const apply = (r) => {
    if (!r) return;
    const x = clamp(Math.floor(r.x), 0, s.c.width);
    const y = clamp(Math.floor(r.y), 0, s.c.height);
    const w = Math.min(s.c.width, Math.ceil(r.x + r.w)) - x;
    const hh = Math.min(s.c.height, Math.ceil(r.y + r.h)) - y;
    if (w <= 0 || hh <= 0) return;
    s.rect = union(s.rect, { x, y, w, h: hh });
    const g = cx(s.c);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(x, y, w, hh);
    g.drawImage(s.ps.backup, x, y, w, hh, x, y, w, hh);
    let src = s.buf;
    let sx = x;
    let sy = y;
    if (s.doc.sel || s.atop) {
      const t = getTmp(w, hh);
      t.drawImage(s.buf, x, y, w, hh, 0, 0, w, hh);
      t.globalCompositeOperation = 'destination-in';
      if (s.doc.sel) t.drawImage(s.doc.sel.c, -(x + s.ox), -(y + s.oy));
      if (s.atop) t.drawImage(s.ps.backup, -x, -y);
      src = t.canvas;
      sx = 0;
      sy = 0;
    }
    g.globalAlpha = s.opacity;
    g.globalCompositeOperation = s.comp;
    g.drawImage(src, sx, sy, w, hh, x, y, w, hh);
    g.restore();
    s.l.ver++;
    s.doc.touch();
  };
  return {
    ...cfg,
    coalesce: true,
    cursor: 'crosshair',
    down(e) {
      const doc = app.doc;
      const o = O(cfg.id);
      if (e.alt && cfg.alt) {
        cfg.alt(e, doc);
        return;
      }
      const tg = paintTarget(doc);
      if (!tg) return;
      if (cfg.ready && !cfg.ready(e, doc)) return;
      const ps = doc.beginPaint(tg.l, tg.key);
      const c = tg.key === 'mask' ? tg.l.mask.canvas : tg.l.canvas;
      const off = tg.key === 'mask' ? tg.l.mask : tg.l;
      const buf = getBuf(c.width, c.height);
      const st = cfg.setup(o, tg.key, e);
      s = {
        doc, ps, c, l: tg.l, key: tg.key, ox: off.x, oy: off.y, buf, bg: cx(buf), rect: null, rest: 0,
        size: o.size, hard: (o.hardness == null ? 100 : o.hardness) / 100, flow: (o.flow == null ? 100 : o.flow) / 100,
        opacity: (o.opacity == null ? 100 : o.opacity) / 100, pen: e.ev.pointerType === 'pen',
        spacing: Math.max(1, o.size * (cfg.spacing || 0.12)), color: st.color || app.fg, comp: st.comp || 'source-over',
        atop: !!st.atop, aliased: !!st.aliased, start: { x: e.x, y: e.y }, last: { x: e.x, y: e.y }
      };
      if (st.opacity != null) s.opacity = st.opacity;
      if (cfg.begin) cfg.begin(s, e);
      let r = null;
      const lp = lastPoint[doc.id];
      if (e.shift && lp) {
        r = seg(lp.x, lp.y, e.x, e.y, e.pressure);
      } else {
        r = dab(e.x, e.y, e.pressure);
        s.rest = s.spacing;
      }
      apply(r);
    },
    move(e) {
      if (!s) return;
      apply(seg(s.last.x, s.last.y, e.x, e.y, e.pressure));
      s.last = { x: e.x, y: e.y };
    },
    up() {
      if (!s) return;
      lastPoint[s.doc.id] = s.last;
      if (cfg.finish) cfg.finish(s);
      s.doc.endPaint(cfg.name, s.ps, s.rect);
      s = null;
    },
    cancel() {
      if (!s) return;
      if (s.rect) {
        const g = cx(s.c);
        g.clearRect(0, 0, s.c.width, s.c.height);
        g.drawImage(s.ps.backup, 0, 0);
      }
      if (s.ps.grew) s.doc.restore(s.ps.before);
      s.doc.touch('all');
      s = null;
    },
    hover() {
      overlay();
    },
    overlay(g) {
      brushCursor(g, cfg.id);
      if (cfg.over) cfg.over(g);
    },
    key(ev) {
      if (sizeKeys(cfg.id, ev)) return true;
      if (/^[0-9]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey && O(cfg.id).opacity != null) {
        O(cfg.id).opacity = ev.key === '0' ? 100 : Number(ev.key) * 10;
        emit('opts');
        return true;
      }
      return false;
    }
  };
}

const pick = (e, doc) => {
  const c = sample(doc, e.x, e.y, true);
  if (c.a === 0) return;
  app.fg = { r: c.r, g: c.g, b: c.b };
  emit('color');
};
const maskSetup = (key, color) => {
  if (key !== 'mask') return { color };
  return luma(color) < 128 ? { comp: 'destination-out', color: { r: 0, g: 0, b: 0 } } : { comp: 'source-over', color: { r: 255, g: 255, b: 255 } };
};
const BRUSH_OPTS = () => [R('size', 'Size', 1, 2000, 30, 'px'), R('hardness', 'Hardness', 0, 100, 50, '%'), R('opacity', 'Opacity', 1, 100, 100, '%'), R('flow', 'Flow', 1, 100, 100, '%')];

let cloneSrc = null;

export const TOOLS = [
  {
    id: 'move', name: 'Move Tool', k: 'V', cursor: 'default',
    opts: [C('auto', 'Auto-Select', true), { type: 'btn', label: 'Free Transform', run: () => emit('cmd', 'transform') }],
    m: null,
    down(e) {
      const doc = app.doc;
      if (O('move').auto && !doc.sel) {
        for (let i = doc.layers.length - 1; i >= 0; i--) {
          const l = doc.layers[i];
          if (!l.visible || l.type === 'adjust' || l.lock) continue;
          const lx = Math.floor(e.x - l.x);
          const ly = Math.floor(e.y - l.y);
          if (lx < 0 || ly < 0 || lx >= l.w || ly >= l.h) continue;
          if (l.type === 'text' || cx(l.canvas).getImageData(lx, ly, 1, 1).data[3] > 8) {
            if (doc.active !== l.id) {
              doc.active = l.id;
              doc.target = 'layer';
              emit('layers');
            }
            break;
          }
        }
      }
      let l = doc.al;
      if (!l || l.type === 'adjust') return;
      if (l.lock) {
        toast('This layer is locked.');
        return;
      }
      const before = doc.snap();
      if (doc.sel && l.type === 'raster') {
        const k = deconFor(doc, l);
        cover(doc, l);
        const src = l.canvas;
        const float = clone(src);
        const fg = cx(float);
        fg.globalCompositeOperation = 'destination-in';
        fg.drawImage(doc.sel.c, -l.x, -l.y);
        if (k) deconStamp(float, l.x, l.y, doc.w, k, deconPaint(k, 'lift'));
        const hole = clone(src);
        if (!e.alt) {
          const hg = cx(hole);
          hg.globalCompositeOperation = 'destination-out';
          hg.drawImage(doc.sel.c, -l.x, -l.y);
          if (k) deconStamp(hole, l.x, l.y, doc.w, k, deconPaint(k, 'clear'));
        }
        l.canvas = clone(src);
        this.m = { mode: 'float', doc, l, before, float, hole, sx: e.x, sy: e.y, dx: 0, dy: 0 };
        return;
      }
      if (e.alt) {
        const d = new Layer({ ...l, id: null, name: l.name + ' copy', canvas: clone(l.canvas), mask: l.mask ? { ...l.mask, canvas: clone(l.mask.canvas) } : null, text: l.text ? JSON.parse(JSON.stringify(l.text)) : null, fx: l.fx ? JSON.parse(JSON.stringify(l.fx)) : null });
        doc.add(d, doc.layers.indexOf(l) + 1);
        l = d;
        emit('layers');
      }
      this.m = { mode: 'layer', doc, l, before, sx: e.x, sy: e.y, x0: l.x, y0: l.y, mx: l.mask ? l.mask.x : 0, my: l.mask ? l.mask.y : 0, tx: l.text ? l.text.x : 0, ty: l.text ? l.text.y : 0, dx: 0, dy: 0, dup: e.alt, cb: contentBox(l) };
    },
    move(e) {
      const m = this.m;
      if (!m) return;
      let dx = Math.round(e.x - m.sx);
      let dy = Math.round(e.y - m.sy);
      if (e.shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      const l = m.l;
      this.lines = null;
      if (m.mode === 'layer' && m.cb && !e.ctrl) {
        const s = snapBox(m.doc, l, m.x0 + dx + m.cb.x, m.y0 + dy + m.cb.y, m.cb.w, m.cb.h);
        dx += s.dx;
        dy += s.dy;
        this.lines = s.lines;
      }
      m.dx = dx;
      m.dy = dy;
      if (m.mode === 'layer') {
        l.x = m.x0 + dx;
        l.y = m.y0 + dy;
        if (l.mask) {
          l.mask.x = m.mx + dx;
          l.mask.y = m.my + dy;
        }
        if (l.text) {
          l.text.x = m.tx + dx;
          l.text.y = m.ty + dy;
        }
      } else {
        const g = cx(l.canvas);
        g.clearRect(0, 0, l.w, l.h);
        g.drawImage(m.hole, 0, 0);
        g.drawImage(m.float, dx, dy);
        l.ver++;
      }
      m.doc.touch();
    },
    overlay(g) {
      if (!this.lines) return;
      g.strokeStyle = '#ff3fd0';
      g.lineWidth = 1;
      g.beginPath();
      for (const ln of this.lines) {
        if (ln.v) {
          const x = Math.round(ln.pos * view.zoom + view.px) + 0.5;
          g.moveTo(x, 0);
          g.lineTo(x, view.h);
        } else {
          const y = Math.round(ln.pos * view.zoom + view.py) + 0.5;
          g.moveTo(0, y);
          g.lineTo(view.w, y);
        }
      }
      g.stroke();
    },
    up() {
      const m = this.m;
      this.m = null;
      this.lines = null;
      if (!m) return;
      if (!m.dx && !m.dy && !m.dup) {
        if (m.mode === 'float') m.doc.restore(m.before);
        m.doc.touch('all');
        return;
      }
      if (m.mode === 'float') {
        const c = mk(m.doc.w, m.doc.h);
        cx(c).drawImage(m.doc.sel.c, m.dx, m.dy);
        setSel(m.doc, c);
      }
      m.doc.commit('Move', m.before);
    },
    key(ev) {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      const doc = app.doc;
      const l = doc && doc.al;
      if (!d || !l || l.lock || l.type === 'adjust' || ev.ctrlKey || ev.metaKey) return false;
      const n = ev.shiftKey ? 10 : 1;
      doc.act('Nudge', () => {
        l.x += d[0] * n;
        l.y += d[1] * n;
        if (l.mask) {
          l.mask.x += d[0] * n;
          l.mask.y += d[1] * n;
        }
        if (l.text) {
          l.text.x += d[0] * n;
          l.text.y += d[1] * n;
        }
      });
      return true;
    }
  },
  marquee('marquee', 'Rectangular Marquee Tool', false),
  marquee('ellipse', 'Elliptical Marquee Tool', true),
  {
    id: 'lasso', name: 'Lasso Tool', k: 'L', cursor: 'crosshair',
    opts: [S('mode', 'Mode', MODES, 'new'), R('feather', 'Feather', 0, 250, 0, 'px')],
    pts: null,
    down(e) {
      this.pts = [[e.x, e.y]];
      this.mode = selMode(e, 'lasso');
    },
    move(e) {
      if (this.pts) this.pts.push([e.x, e.y]);
    },
    up() {
      const pts = this.pts;
      this.pts = null;
      if (!pts) return;
      const doc = app.doc;
      if (pts.length < 3) {
        if (doc.sel && this.mode === 'new') doc.act('Deselect', () => setSel(doc, null));
        return;
      }
      doc.act('Lasso', () => selShape(doc, (g) => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
        g.fill();
      }, this.mode, O('lasso').feather));
    },
    overlay(g) {
      if (!this.pts) return;
      dualStroke(g, (c) => this.pts.forEach((p, i) => {
        const s = toScreen(p[0], p[1]);
        if (i) c.lineTo(s.x, s.y);
        else c.moveTo(s.x, s.y);
      }));
    }
  },
  {
    id: 'polylasso', name: 'Polygonal Lasso Tool', k: 'L', cursor: 'crosshair',
    opts: [S('mode', 'Mode', MODES, 'new'), R('feather', 'Feather', 0, 250, 0, 'px')],
    pts: null,
    down(e) {
      if (!this.pts) {
        this.pts = [[e.x, e.y]];
        this.mode = selMode(e, 'polylasso');
        return;
      }
      const f = toScreen(this.pts[0][0], this.pts[0][1]);
      if (this.pts.length > 2 && Math.hypot(f.x - e.sx, f.y - e.sy) < 8) this.finish();
      else this.pts.push([e.x, e.y]);
    },
    hover(e) {
      this.cur = [e.x, e.y];
    },
    dbl() {
      this.finish();
    },
    finish() {
      const pts = this.pts;
      this.pts = null;
      if (!pts || pts.length < 3) return;
      const doc = app.doc;
      doc.act('Polygonal Lasso', () => selShape(doc, (g) => {
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
        g.closePath();
        g.fill();
      }, this.mode, O('polylasso').feather));
    },
    off() {
      this.pts = null;
    },
    key(ev) {
      if (!this.pts) return false;
      if (ev.key === 'Enter') this.finish();
      else if (ev.key === 'Escape') this.pts = null;
      else if (ev.key === 'Backspace' || ev.key === 'Delete') {
        this.pts.pop();
        if (!this.pts.length) this.pts = null;
      } else return false;
      overlay();
      return true;
    },
    overlay(g) {
      if (!this.pts) return;
      dualStroke(g, (c) => {
        this.pts.forEach((p, i) => {
          const s = toScreen(p[0], p[1]);
          if (i) c.lineTo(s.x, s.y);
          else c.moveTo(s.x, s.y);
        });
        if (this.cur) {
          const s = toScreen(this.cur[0], this.cur[1]);
          c.lineTo(s.x, s.y);
        }
      });
    }
  },
  {
    id: 'wand', name: 'Magic Wand Tool', k: 'W', cursor: 'crosshair',
    opts: [S('mode', 'Mode', MODES, 'new'), S('sample', 'Sample Size', SAMPLES, '1'), R('tolerance', 'Tolerance', 0, 255, 32), C('aa', 'Anti-alias', true),
      C('contiguous', 'Contiguous', true), C('all', 'Sample All Layers', false)],
    stats: null,
    down(e) {
      const doc = app.doc;
      const o = O('wand');
      if (e.x < 0 || e.y < 0 || e.x >= doc.w || e.y >= doc.h) return;
      const t0 = performance.now();
      const reads = pixReads;
      const img = docPixels(doc, o.all);
      const t1 = performance.now();
      const s = wandPick(img, e.x, e.y, { tolerance: o.tolerance, contiguous: o.contiguous, antialias: o.aa, sample: Number(o.sample) || 1 });
      const t2 = performance.now();
      const mode = selMode(e, 'wand');
      doc.act('Magic Wand', () => wandCombine(doc, s, mode, img, o.all));
      keepPixels(doc, img, o.all);
      this.stats = { ms: performance.now() - t0, read: pixReads !== reads, load: t1 - t0, select: t2 - t1, reused: s.reused };
    }
  },
  {
    id: 'crop', name: 'Crop Tool', k: 'C', cursor: 'crosshair',
    opts: [S('ratio', 'Ratio', [['free', 'Free'], ['1', '1 : 1 (Square)'], ['0.8', '4 : 5 (8 x 10)'], ['0.7143', '5 : 7'], ['0.6667', '2 : 3 (4 x 6)'], ['0.7727', '8.5 : 11'], ['1.5', '3 : 2'], ['1.7778', '16 : 9']], 'free'),
      { type: 'btn', label: 'Crop', run: () => TOOL.crop.commit() }, { type: 'btn', label: 'Cancel', run: () => TOOL.crop.reset() }],
    r: null, drag: null,
    on() {
      this.r = null;
    },
    off() {
      this.r = null;
    },
    reset() {
      this.r = null;
      overlay();
    },
    hit(e) {
      const r = this.r;
      if (!r) return null;
      const pts = boxHandles(r);
      for (let i = 0; i < pts.length; i++) {
        const s = toScreen(pts[i][0], pts[i][1]);
        if (Math.hypot(s.x - e.sx, s.y - e.sy) < 9) return i;
      }
      return e.x > r.x && e.y > r.y && e.x < r.x + r.w && e.y < r.y + r.h ? 'in' : null;
    },
    down(e) {
      const hit = this.hit(e);
      if (hit == null) {
        this.drag = { kind: 'new', x: e.x, y: e.y };
        this.r = { x: e.x, y: e.y, w: 0, h: 0 };
      } else this.drag = { kind: hit, x: e.x, y: e.y, r: { ...this.r } };
    },
    move(e) {
      const d = this.drag;
      if (!d) return;
      const ratio = O('crop').ratio === 'free' ? 0 : Number(O('crop').ratio);
      if (d.kind === 'new') {
        let w = e.x - d.x;
        let hh = e.y - d.y;
        if (ratio) hh = Math.sign(hh || 1) * Math.abs(w) / ratio;
        this.r = norm(d.x, d.y, d.x + w, d.y + hh);
      } else if (d.kind === 'in') {
        this.r = { ...d.r, x: d.r.x + e.x - d.x, y: d.r.y + e.y - d.y };
      } else {
        this.r = resizeBox(d.r, d.kind, e.x - d.x, e.y - d.y, ratio);
      }
    },
    up() {
      this.drag = null;
      if (this.r && (this.r.w < 2 || this.r.h < 2)) this.r = null;
    },
    dbl() {
      this.commit();
    },
    commit() {
      const r = this.r;
      const doc = app.doc;
      if (!r || !doc) return;
      const x = Math.round(r.x);
      const y = Math.round(r.y);
      const w = Math.max(1, Math.round(r.w));
      const hh = Math.max(1, Math.round(r.h));
      this.r = null;
      doc.act('Crop', () => cropDoc(doc, x, y, w, hh));
      emit('fit');
    },
    key(ev) {
      if (!this.r) return false;
      if (ev.key === 'Enter') this.commit();
      else if (ev.key === 'Escape') this.reset();
      else return false;
      return true;
    },
    overlay(g) {
      const r = this.r;
      if (!r) return;
      const a = toScreen(r.x, r.y);
      const b = toScreen(r.x + r.w, r.y + r.h);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.beginPath();
      g.rect(0, 0, view.w, view.h);
      g.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      g.fill('evenodd');
      g.strokeStyle = '#fff';
      g.lineWidth = 1;
      g.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
      g.strokeStyle = 'rgba(255,255,255,0.4)';
      g.beginPath();
      for (let i = 1; i < 3; i++) {
        g.moveTo(a.x + ((b.x - a.x) * i) / 3, a.y);
        g.lineTo(a.x + ((b.x - a.x) * i) / 3, b.y);
        g.moveTo(a.x, a.y + ((b.y - a.y) * i) / 3);
        g.lineTo(b.x, a.y + ((b.y - a.y) * i) / 3);
      }
      g.stroke();
      for (const p of boxHandles(r)) {
        const s = toScreen(p[0], p[1]);
        handle(g, s.x, s.y);
      }
    }
  },
  {
    id: 'eyedropper', name: 'Eyedropper Tool', k: 'I', cursor: 'crosshair', opts: [C('layer', 'Current Layer Only', false)],
    down(e) {
      this.move(e);
    },
    move(e) {
      const doc = app.doc;
      const c = sample(doc, e.x, e.y, !O('eyedropper').layer);
      if (c.a === 0) return;
      if (e.alt) app.bg = { r: c.r, g: c.g, b: c.b };
      else app.fg = { r: c.r, g: c.g, b: c.b };
      emit('color');
    }
  },
  strokeTool({
    id: 'brush', name: 'Brush Tool', k: 'B', opts: BRUSH_OPTS(), alt: pick,
    setup: (o, key) => maskSetup(key, app.fg)
  }),
  strokeTool({
    id: 'pencil', name: 'Pencil Tool', k: 'B', opts: [R('size', 'Size', 1, 500, 2, 'px'), R('opacity', 'Opacity', 1, 100, 100, '%')], alt: pick, spacing: 0.3,
    setup: (o, key) => ({ ...maskSetup(key, app.fg), aliased: true })
  }),
  strokeTool({
    id: 'eraser', name: 'Eraser Tool', k: 'E', opts: BRUSH_OPTS(),
    setup: () => ({ comp: 'destination-out', color: { r: 0, g: 0, b: 0 } })
  }),
  strokeTool({
    id: 'stamp', name: 'Clone Stamp Tool', k: 'S', opts: [...BRUSH_OPTS(), C('aligned', 'Aligned', true)],
    alt(e, doc) {
      cloneSrc = { x: e.x, y: e.y, doc: doc.id, off: null };
      toast('Clone source set. Now paint.');
      overlay();
    },
    ready(e, doc) {
      if (!cloneSrc || cloneSrc.doc !== doc.id) {
        toast('Alt-click (Option-click) to set the clone source first.');
        return false;
      }
      return true;
    },
    setup: () => ({}),
    begin(s, e) {
      if (!cloneSrc.off || !O('stamp').aligned) cloneSrc.off = { dx: cloneSrc.x - e.x, dy: cloneSrc.y - e.y };
    },
    source: (s) => ({ canvas: s.ps.backup, dx: cloneSrc.off.dx, dy: cloneSrc.off.dy }),
    over(g) {
      if (!cloneSrc || !app.doc || cloneSrc.doc !== app.doc.id) return;
      const p = cloneSrc.off && view.pointer.inside ? toScreen(view.pointer.x + cloneSrc.off.dx, view.pointer.y + cloneSrc.off.dy) : toScreen(cloneSrc.x, cloneSrc.y);
      g.strokeStyle = '#fff';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(p.x - 6, p.y); g.lineTo(p.x + 6, p.y); g.moveTo(p.x, p.y - 6); g.lineTo(p.x, p.y + 6);
      g.stroke();
    }
  }),
  strokeTool({
    id: 'heal', name: 'Spot Healing Brush Tool', k: 'J', opts: [R('size', 'Size', 1, 500, 30, 'px'), R('hardness', 'Hardness', 0, 100, 40, '%')],
    setup: () => ({ color: { r: 255, g: 0, b: 80 }, opacity: 0.35 }),
    finish(s) {
      if (!s.rect) return;
      healRegion(s);
    }
  }),
  strokeTool({
    id: 'blur', name: 'Blur Tool', k: '', opts: [R('size', 'Size', 1, 500, 40, 'px'), R('hardness', 'Hardness', 0, 100, 0, '%'), R('strength', 'Strength', 1, 100, 50, '%')],
    setup: (o) => ({ opacity: o.strength / 100 }),
    begin(s) {
      const c = clone(s.ps.backup);
      const g = cx(c);
      if ('filter' in g) {
        g.clearRect(0, 0, c.width, c.height);
        g.filter = 'blur(' + Math.max(1, s.size / 12) + 'px)';
        g.drawImage(s.ps.backup, 0, 0);
        g.filter = 'none';
      }
      s.blurred = c;
      s.atop = true;
    },
    source: (s) => ({ canvas: s.blurred, dx: 0, dy: 0 })
  }),
  strokeTool({
    id: 'dodge', name: 'Dodge Tool', k: 'O', opts: [R('size', 'Size', 1, 1000, 60, 'px'), R('hardness', 'Hardness', 0, 100, 0, '%'), R('exposure', 'Exposure', 1, 100, 30, '%')],
    setup: (o) => ({ comp: 'soft-light', color: { r: 255, g: 255, b: 255 }, opacity: o.exposure / 100, atop: true })
  }),
  strokeTool({
    id: 'burn', name: 'Burn Tool', k: 'O', opts: [R('size', 'Size', 1, 1000, 60, 'px'), R('hardness', 'Hardness', 0, 100, 0, '%'), R('exposure', 'Exposure', 1, 100, 30, '%')],
    setup: (o) => ({ comp: 'soft-light', color: { r: 0, g: 0, b: 0 }, opacity: o.exposure / 100, atop: true })
  }),
  {
    id: 'gradient', name: 'Gradient Tool', k: 'G', cursor: 'crosshair',
    opts: [S('type', 'Style', [['linear', 'Linear'], ['radial', 'Radial']], 'linear'), S('fill', 'Gradient', [['fgbg', 'Foreground to Background'], ['fgt', 'Foreground to Transparent'], ['bw', 'Black, White'], ['rainbow', 'Spectrum']], 'fgbg'), R('opacity', 'Opacity', 1, 100, 100, '%'), C('reverse', 'Reverse', false)],
    d: null,
    down(e) {
      if (!paintTarget(app.doc)) return;
      this.d = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
    },
    move(e) {
      if (!this.d) return;
      this.d.x1 = e.x;
      this.d.y1 = e.y;
      if (e.shift) {
        if (Math.abs(e.x - this.d.x0) > Math.abs(e.y - this.d.y0)) this.d.y1 = this.d.y0;
        else this.d.x1 = this.d.x0;
      }
    },
    up() {
      const d = this.d;
      this.d = null;
      if (!d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 2) return;
      const doc = app.doc;
      const tg = paintTarget(doc);
      if (!tg) return;
      const o = O('gradient');
      const ps = doc.beginPaint(tg.l, tg.key);
      const c = tg.key === 'mask' ? tg.l.mask.canvas : tg.l.canvas;
      const off = tg.key === 'mask' ? tg.l.mask : tg.l;
      const t = mk(c.width, c.height);
      const g = cx(t);
      const ax = d.x0 - off.x, ay = d.y0 - off.y, bx = d.x1 - off.x, by = d.y1 - off.y;
      const gr = o.type === 'radial' ? g.createRadialGradient(ax, ay, 0, ax, ay, Math.hypot(bx - ax, by - ay)) : g.createLinearGradient(ax, ay, bx, by);
      let stops = [[0, rgba(app.fg, 1)], [1, rgba(app.bg, 1)]];
      if (o.fill === 'fgt') stops = [[0, rgba(app.fg, 1)], [1, rgba(app.fg, 0)]];
      else if (o.fill === 'bw') stops = [[0, '#000'], [1, '#fff']];
      else if (o.fill === 'rainbow') stops = [[0, '#f00'], [0.17, '#ff0'], [0.33, '#0f0'], [0.5, '#0ff'], [0.67, '#00f'], [0.83, '#f0f'], [1, '#f00']];
      if (tg.key === 'mask') stops = [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']];
      for (const s of stops) gr.addColorStop(o.reverse ? 1 - s[0] : s[0], s[1]);
      g.fillStyle = gr;
      g.fillRect(0, 0, t.width, t.height);
      if (doc.sel) {
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(doc.sel.c, -off.x, -off.y);
      }
      const lg = cx(c);
      lg.save();
      if (tg.key === 'mask') {
        lg.globalCompositeOperation = 'copy';
        if (doc.sel) lg.globalCompositeOperation = 'source-over';
      }
      lg.globalAlpha = o.opacity / 100;
      lg.drawImage(t, 0, 0);
      lg.restore();
      tg.l.ver++;
      doc.endPaint('Gradient', ps, { x: 0, y: 0, w: c.width, h: c.height });
    },
    overlay(g) {
      const d = this.d;
      if (!d) return;
      const a = toScreen(d.x0, d.y0);
      const b = toScreen(d.x1, d.y1);
      dualStroke(g, (c) => {
        c.moveTo(a.x, a.y);
        c.lineTo(b.x, b.y);
      });
      handle(g, a.x, a.y);
      handle(g, b.x, b.y);
    }
  },
  {
    id: 'bucket', name: 'Paint Bucket Tool', k: 'G', cursor: 'crosshair',
    opts: [R('tolerance', 'Tolerance', 0, 255, 32), R('opacity', 'Opacity', 1, 100, 100, '%'), C('aa', 'Anti-alias', true), C('contiguous', 'Contiguous', true), C('all', 'All Layers', false)],
    down(e) {
      const doc = app.doc;
      const tg = paintTarget(doc);
      if (!tg || tg.key === 'mask') return;
      if (e.x < 0 || e.y < 0 || e.x >= doc.w || e.y >= doc.h) return;
      const o = O('bucket');
      const img = docPixels(doc, o.all);
      const s = wandSelect(img, e.x, e.y, { tolerance: o.tolerance, contiguous: o.contiguous, antialias: o.aa });
      const b = s.b;
      if (!b) return;
      const k = s.est && sampled(doc, o.all) === tg.l ? s.est : null;
      const clip = k && doc.sel ? covAt(doc.sel.c, k.idx, doc.w, b) : null;
      const ps = doc.beginPaint(tg.l);
      const fill = maskCanvas(s.cov, doc.w, doc.h, app.fg, b);
      if (doc.sel) {
        const fg = cx(fill);
        fg.globalCompositeOperation = 'destination-in';
        fg.drawImage(doc.sel.c, 0, 0);
      }
      const g = cx(tg.l.canvas);
      g.save();
      g.globalAlpha = o.opacity / 100;
      g.drawImage(fill, -tg.l.x, -tg.l.y);
      g.restore();
      if (k) deconStamp(tg.l.canvas, tg.l.x, tg.l.y, doc.w, k, deconPaint(k, 'fill', app.fg, o.opacity / 100, clip));
      tg.l.ver++;
      doc.endPaint('Paint Bucket', ps, { x: b.x - tg.l.x, y: b.y - tg.l.y, w: b.w, h: b.h });
    }
  },
  {
    id: 'text', name: 'Horizontal Type Tool', k: 'T', cursor: 'text',
    opts: [S('font', 'Font', FONTS.map((f) => [f, f]), 'Arial'), R('size', 'Size', 4, 1000, 36, 'pt'), C('bold', 'Bold', false), C('italic', 'Italic', false),
      S('align', 'Align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], 'left'), { type: 'color', k: 'color', label: 'Color' }],
    down(e) {
      const doc = app.doc;
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const l = doc.layers[i];
        if (l.type === 'text' && l.visible && e.x >= l.x && e.y >= l.y && e.x < l.x + l.w && e.y < l.y + l.h) {
          editText(doc, l, false);
          return;
        }
      }
      const o = O('text');
      const size = Math.round((o.size * doc.dpi) / 72);
      const l = new Layer({
        type: 'text', name: 'Text',
        text: { str: '', font: o.font, size, color: { ...(o.color || app.fg) }, bold: o.bold, italic: o.italic, align: o.align, x: Math.round(e.x), y: Math.round(e.y - size * 0.6), angle: 0, lh: 1.2 }
      });
      const before = doc.snap();
      doc.add(l);
      renderText(l);
      emit('layers');
      editText(doc, l, true, before);
    }
  },
  shape('rect', 'Rectangle Tool'),
  shape('oval', 'Ellipse Tool'),
  shape('line', 'Line Tool'),
  { id: 'hand', name: 'Hand Tool', k: 'H', cursor: 'grab', opts: [{ type: 'btn', label: '100%', run: () => emit('cmd', 'actual') }, { type: 'btn', label: 'Fit Screen', run: () => emit('cmd', 'fit') }] },
  {
    id: 'zoom', name: 'Zoom Tool', k: 'Z', cursor: 'zoom-in',
    opts: [{ type: 'btn', label: '100%', run: () => emit('cmd', 'actual') }, { type: 'btn', label: 'Fit Screen', run: () => emit('cmd', 'fit') }],
    down(e) {
      this.d = { sx: e.sx, sy: e.sy, z: view.zoom, moved: false, alt: e.alt };
    },
    move(e) {
      if (!this.d) return;
      const dx = e.sx - this.d.sx;
      if (Math.abs(dx) > 3) this.d.moved = true;
      if (this.d.moved) setZoom(this.d.z * Math.exp(dx * 0.01), this.d.sx, this.d.sy);
    },
    up() {
      const d = this.d;
      this.d = null;
      if (d && !d.moved) zoomStep(d.alt ? -1 : 1, d.sx, d.sy);
    }
  }
];
export const TOOL = {};
for (const t of TOOLS) TOOL[t.id] = t;

function marquee(id, name, round) {
  return {
    id, name, k: 'M', cursor: 'crosshair',
    opts: [S('mode', 'Mode', MODES, 'new'), R('feather', 'Feather', 0, 250, 0, 'px'), C('square', round ? 'Circle' : 'Square', false)],
    d: null,
    down(e) {
      const doc = app.doc;
      const mode = selMode(e, id);
      if (mode === 'new' && doc.sel && !e.shift && !e.alt && cx(doc.sel.c).getImageData(clamp(Math.floor(e.x), 0, doc.w - 1), clamp(Math.floor(e.y), 0, doc.h - 1), 1, 1).data[3] > 127) {
        this.d = { drag: true, x: e.x, y: e.y, before: doc.snap(), src: doc.sel.c, dx: 0, dy: 0 };
        return;
      }
      this.d = { x0: e.x, y0: e.y, x1: e.x, y1: e.y, mode };
    },
    move(e) {
      const d = this.d;
      if (!d) return;
      if (d.drag) {
        d.dx = Math.round(e.x - d.x);
        d.dy = Math.round(e.y - d.y);
        const c = mk(app.doc.w, app.doc.h);
        cx(c).drawImage(d.src, d.dx, d.dy);
        setSel(app.doc, c);
        return;
      }
      d.x1 = e.x;
      d.y1 = e.y;
      if (O(id).square) {
        const s = Math.max(Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
        d.x1 = d.x0 + Math.sign(d.x1 - d.x0 || 1) * s;
        d.y1 = d.y0 + Math.sign(d.y1 - d.y0 || 1) * s;
      }
    },
    up() {
      const d = this.d;
      this.d = null;
      const doc = app.doc;
      if (!d) return;
      if (d.drag) {
        if (d.dx || d.dy) doc.commit('Move Selection', d.before);
        else doc.act('Deselect', () => setSel(doc, null));
        return;
      }
      const r = norm(Math.round(d.x0), Math.round(d.y0), Math.round(d.x1), Math.round(d.y1));
      if (r.w < 1 || r.h < 1) {
        if (doc.sel && d.mode === 'new') doc.act('Deselect', () => setSel(doc, null));
        return;
      }
      doc.act(round ? 'Elliptical Marquee' : 'Rectangular Marquee', () => selShape(doc, (g) => {
        g.beginPath();
        if (round) g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        else g.rect(r.x, r.y, r.w, r.h);
        g.fill();
      }, d.mode, O(id).feather));
    },
    overlay(g) {
      const d = this.d;
      if (!d || d.drag) return;
      const a = toScreen(d.x0, d.y0);
      const b = toScreen(d.x1, d.y1);
      dualStroke(g, (c) => {
        if (round) c.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        else c.rect(Math.round(Math.min(a.x, b.x)) + 0.5, Math.round(Math.min(a.y, b.y)) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      });
    }
  };
}

function shape(id, name) {
  return {
    id, name, k: 'U', cursor: 'crosshair',
    opts: id === 'line' ? [R('width', 'Weight', 1, 500, 8, 'px')] : [C('fill', 'Fill', true), R('width', 'Stroke', 0, 500, 0, 'px'), ...(id === 'rect' ? [R('radius', 'Radius', 0, 1000, 0, 'px')] : [])],
    d: null,
    down(e) {
      this.d = { x0: e.x, y0: e.y, x1: e.x, y1: e.y };
    },
    move(e) {
      const d = this.d;
      if (!d) return;
      d.x1 = e.x;
      d.y1 = e.y;
      if (e.shift) {
        if (id === 'line') {
          const a = Math.round(Math.atan2(d.y1 - d.y0, d.x1 - d.x0) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(d.x1 - d.x0, d.y1 - d.y0);
          d.x1 = d.x0 + Math.cos(a) * len;
          d.y1 = d.y0 + Math.sin(a) * len;
        } else {
          const s = Math.max(Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
          d.x1 = d.x0 + Math.sign(d.x1 - d.x0 || 1) * s;
          d.y1 = d.y0 + Math.sign(d.y1 - d.y0 || 1) * s;
        }
      }
    },
    path(g, d, ox, oy) {
      const o = O(id);
      const r = norm(d.x0 - ox, d.y0 - oy, d.x1 - ox, d.y1 - oy);
      g.beginPath();
      if (id === 'line') {
        g.moveTo(d.x0 - ox, d.y0 - oy);
        g.lineTo(d.x1 - ox, d.y1 - oy);
      } else if (id === 'oval') {
        g.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      } else if (o.radius > 0 && g.roundRect) {
        g.roundRect(r.x, r.y, r.w, r.h, Math.min(o.radius, r.w / 2, r.h / 2));
      } else g.rect(r.x, r.y, r.w, r.h);
    },
    up() {
      const d = this.d;
      this.d = null;
      if (!d || Math.hypot(d.x1 - d.x0, d.y1 - d.y0) < 2) return;
      const doc = app.doc;
      const o = O(id);
      const pad = Math.ceil((o.width || 0) / 2) + 2;
      const r = norm(d.x0, d.y0, d.x1, d.y1);
      const x = Math.floor(r.x) - pad;
      const y = Math.floor(r.y) - pad;
      const c = mk(Math.ceil(r.w) + pad * 2 + 1, Math.ceil(r.h) + pad * 2 + 1);
      const g = cx(c);
      this.path(g, d, x, y);
      if (id === 'line') {
        g.strokeStyle = rgba(app.fg, 1);
        g.lineWidth = o.width;
        g.lineCap = 'round';
        g.stroke();
      } else {
        if (o.fill) {
          g.fillStyle = rgba(app.fg, 1);
          g.fill();
        }
        if (o.width > 0 || !o.fill) {
          g.strokeStyle = rgba(o.fill ? app.bg : app.fg, 1);
          g.lineWidth = Math.max(1, o.width);
          g.stroke();
        }
      }
      const label = id === 'rect' ? 'Rectangle' : id === 'oval' ? 'Ellipse' : 'Line';
      doc.act(name, () => doc.add(new Layer({ name: doc.newName(label), canvas: c, x, y })));
      emit('layers');
    },
    overlay(g) {
      const d = this.d;
      if (!d) return;
      g.save();
      g.translate(view.px, view.py);
      g.scale(view.zoom, view.zoom);
      this.path(g, d, 0, 0);
      g.restore();
      g.lineWidth = 1;
      g.strokeStyle = '#e8a33d';
      g.stroke();
    }
  };
}

export function contentBox(l) {
  if (l.type === 'adjust' || l.w * l.h > 24e6) return null;
  if (!l.cbc || l.cbc.ver !== l.ver) l.cbc = { ver: l.ver, b: bounds(l.canvas) };
  return l.cbc.b;
}
function snapBox(doc, self, x, y, w, hh) {
  const t = 6 / view.zoom;
  const xs = [0, doc.w / 2, doc.w];
  const ys = [0, doc.h / 2, doc.h];
  for (const g of doc.guides) (g.v ? xs : ys).push(g.pos);
  let n = 0;
  for (const l of doc.layers) {
    if (l === self || !l.visible || l.type === 'adjust' || n > 16 || l.w * l.h > 6e6) continue;
    const b = contentBox(l);
    if (!b) continue;
    n++;
    xs.push(l.x + b.x, l.x + b.x + b.w / 2, l.x + b.x + b.w);
    ys.push(l.y + b.y, l.y + b.y + b.h / 2, l.y + b.y + b.h);
  }
  const best = (targets, pts) => {
    let d = null;
    let pos = 0;
    for (const p of pts) for (const s of targets) {
      const v = s - p;
      if (Math.abs(v) < t && (d == null || Math.abs(v) < Math.abs(d))) {
        d = v;
        pos = s;
      }
    }
    return d == null ? null : { d: Math.round(d), pos };
  };
  const bx = best(xs, [x, x + w / 2, x + w]);
  const by = best(ys, [y, y + hh / 2, y + hh]);
  const lines = [];
  if (bx) lines.push({ v: true, pos: bx.pos });
  if (by) lines.push({ v: false, pos: by.pos });
  return { dx: bx ? bx.d : 0, dy: by ? by.d : 0, lines };
}

function norm(x0, y0, x1, y1) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}
function boxHandles(r) {
  const { x, y, w } = r;
  const hh = r.h;
  return [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + hh / 2], [x + w, y + hh], [x + w / 2, y + hh], [x, y + hh], [x, y + hh / 2]];
}
function resizeBox(r, i, dx, dy, ratio) {
  let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
  if (i === 0 || i === 6 || i === 7) x0 += dx;
  if (i === 2 || i === 3 || i === 4) x1 += dx;
  if (i === 0 || i === 1 || i === 2) y0 += dy;
  if (i === 4 || i === 5 || i === 6) y1 += dy;
  if (ratio) {
    if (i === 1 || i === 5) {
      const w = Math.abs(y1 - y0) * ratio;
      const m = (x0 + x1) / 2;
      x0 = m - w / 2;
      x1 = m + w / 2;
    } else {
      const hh = Math.abs(x1 - x0) / ratio;
      if (i === 0 || i === 2) y0 = y1 - hh;
      else if (i === 3 || i === 7) {
        const m = (y0 + y1) / 2;
        y0 = m - hh / 2;
        y1 = m + hh / 2;
      } else y1 = y0 + hh;
    }
  }
  return norm(x0, y0, x1, y1);
}

export function cropDoc(doc, x, y, w, hh) {
  for (const l of doc.layers) {
    l.x -= x;
    l.y -= y;
    if (l.mask) l.mask = { ...l.mask, x: l.mask.x - x, y: l.mask.y - y };
    if (l.text) {
      l.text.x -= x;
      l.text.y -= y;
    }
  }
  if (doc.sel) {
    const c = mk(w, hh);
    cx(c).drawImage(doc.sel.c, -x, -y);
    doc.w = w;
    doc.h = hh;
    setSel(doc, c);
  }
  doc.guides = [];
  doc.w = w;
  doc.h = hh;
}

let pix = null;
let pixReads = 0;
on('docclosed', (d) => {
  if (!pix || !d || pix.doc !== d.id) return;
  pix = null;
  picked = null;
});
function pixKey(doc, flat) {
  const part = (l) => [l.id, l.ver, l.x, l.y, l.w, l.h, l.visible, l.opacity, l.blend, l.clip, l.mask ? [l.mask.on, l.mask.x, l.mask.y] : 0, l.fx, l.adj, l.tm];
  return JSON.stringify([doc.id, doc.rev, doc.w, doc.h, flat, flat ? doc.layers.map(part) : part(doc.al)]);
}
const isFlat = (doc, merged) => !!(merged || !doc.al || doc.al.type === 'adjust');
function keepPixels(doc, img, merged) {
  if (pix && pix.img === img) pix.key = pixKey(doc, isFlat(doc, merged));
}
export function docPixels(doc, merged) {
  const l = doc.al;
  const flat = isFlat(doc, merged);
  const key = pixKey(doc, flat);
  if (pix && pix.key === key) return pix.img;
  pix = null;
  let c;
  if (flat) c = flatten(doc);
  else if (!l.x && !l.y && l.w === doc.w && l.h === doc.h) c = l.canvas;
  else {
    c = mk(doc.w, doc.h);
    cx(c, { willReadFrequently: true }).drawImage(l.canvas, l.x, l.y);
  }
  const img = cx(c).getImageData(0, 0, doc.w, doc.h);
  pixReads++;
  pix = { key, img, doc: doc.id };
  if (picked && picked.img !== img) picked = null;
  return img;
}

let picked = null;
function wandPick(img, x, y, o) {
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  const key = [o.tolerance, o.contiguous, o.antialias, o.sample].join();
  const seed = wandSeed(img, sx, sy, o.sample);
  const p = picked;
  if (p && p.img === img && p.key === key && p.s.b && seed.every((v, i) => v === p.s.seed[i]) && (!o.contiguous || (o.sample === 1 && p.s.cov[sy * img.width + sx] === 255))) {
    p.s.reused = true;
    return p.s;
  }
  const s = wandSelect(img, x, y, o);
  s.reused = false;
  s.canvas = null;
  s.sel = null;
  picked = { img, key, s };
  return s;
}
function plain(l) {
  return l.type === 'raster' && l.visible && l.opacity === 1 && l.blend === 'normal' && !l.clip && !l.fx && !l.tm && !(l.mask && l.mask.on);
}
function sampled(doc, merged) {
  if (!isFlat(doc, merged)) return doc.al;
  const seen = doc.layers.filter((l) => l.visible);
  return seen.length === 1 && plain(seen[0]) ? seen[0] : null;
}
function wandDecon(doc, est, img, merged) {
  const l = est && sampled(doc, merged);
  return l ? { idx: est.idx, cov: est.cov, out: est.out, inn: est.inn, sum: wandSum(img, est.idx), layer: l.id, ver: l.ver, all: isFlat(doc, merged) } : null;
}
export function deconFor(doc, l) {
  const k = doc.sel && doc.sel.decon;
  if (!k || !l || l !== doc.al || k.layer !== l.id || l.type !== 'raster' || doc.target === 'mask') return null;
  if (k.all && sampled(doc, true) !== l) return null;
  if (wandSum(docPixels(doc, false), k.idx) !== k.sum) return null;
  k.ver = l.ver;
  return k;
}
export function deconStamp(c, ox, oy, w, k, px) {
  const g = cx(c);
  const idx = k.idx;
  const n = idx.length;
  let s = 0;
  while (s < n) {
    const y0 = Math.floor(idx[s] / w);
    const lim = (y0 + 128) * w;
    let e = s;
    let x0 = w;
    let x1 = -1;
    for (; e < n && idx[e] < lim; e++) {
      const x = idx[e] % w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
    }
    const y1 = Math.floor(idx[e - 1] / w);
    const r = meet({ x: x0 - ox, y: y0 - oy, w: x1 - x0 + 1, h: y1 - y0 + 1 }, { x: 0, y: 0, w: c.width, h: c.height });
    if (r) {
      const img = g.getImageData(r.x, r.y, r.w, r.h);
      const d = img.data;
      for (let j = s; j < e; j++) {
        const x = (idx[j] % w) - ox - r.x;
        const y = Math.floor(idx[j] / w) - oy - r.y;
        if (x < 0 || y < 0 || x >= r.w || y >= r.h) continue;
        const q = (y * r.w + x) * 4;
        d[q] = px[j * 4];
        d[q + 1] = px[j * 4 + 1];
        d[q + 2] = px[j * 4 + 2];
        d[q + 3] = px[j * 4 + 3];
      }
      g.putImageData(img, r.x, r.y);
    }
    s = e;
  }
}
function covAt(c, idx, w, b) {
  const a = cx(c).getImageData(b.x, b.y, b.w, b.h).data;
  const out = new Uint8Array(idx.length);
  for (let j = 0; j < idx.length; j++) {
    const x = (idx[j] % w) - b.x;
    const y = Math.floor(idx[j] / w) - b.y;
    out[j] = a[(y * b.w + x) * 4 + 3];
  }
  return out;
}
export function maskCanvas(m, w, hh, color, b) {
  const out = mk(w, hh);
  const r = b === undefined ? { x: 0, y: 0, w, h: hh } : b;
  if (!r) return out;
  const img = new ImageData(r.w, r.h);
  const d = new Int32Array(img.data.buffer);
  const c = color || { r: 255, g: 255, b: 255 };
  const v = (c.b << 16) | (c.g << 8) | c.r;
  for (let y = 0, k = 0; y < r.h; y++) {
    for (let x = 0, i = (r.y + y) * w + r.x; x < r.w; x++, i++, k++) d[k] = (m[i] << 24) | v;
  }
  cx(out).putImageData(img, r.x, r.y);
  return out;
}

function stampCov(c, out, k) {
  const img = new ImageData(k.w, k.h);
  const d = new Int32Array(img.data.buffer);
  for (let i = 0; i < out.length; i++) d[i] = (out[i] << 24) | 0xffffff;
  cx(c).putImageData(img, k.x, k.y);
  return c;
}
function meet(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.w, b.x + b.w) - x;
  const hh = Math.min(a.y + a.h, b.y + b.h) - y;
  return w > 0 && hh > 0 ? { x, y, w, h: hh } : null;
}
function trimmed(c, r, k) {
  if (k.x > r.x && k.y > r.y && k.x + k.w < r.x + r.w && k.y + k.h < r.y + r.h) return r;
  const t = bounds(crop(c, r.x, r.y, r.w, r.h));
  return t && { x: t.x + r.x, y: t.y + r.y, w: t.w, h: t.h };
}
function wandCombine(doc, s, mode, img, merged) {
  const old = doc.sel;
  if (!old || mode === 'new') {
    if (!s.canvas) s.canvas = maskCanvas(s.cov, doc.w, doc.h, null, s.b);
    setSel(doc, s.canvas, s.b, wandDecon(doc, s.est, img, merged));
    if (doc.sel && s.sel && s.sel.c === doc.sel.c) doc.sel.path = s.sel.path;
    s.sel = doc.sel;
    return;
  }
  const k = s.b && (mode === 'add' ? s.b : meet(old.b, s.b));
  if (!k) {
    setSel(doc, mode === 'int' ? null : old.c, mode === 'int' ? null : old.b, mode === 'int' ? null : old.decon);
    return;
  }
  const m = wandMix(alphaOf(cx(old.c).getImageData(k.x, k.y, k.w, k.h)), s.cov, doc.w, k, mode);
  const c = stampCov(mode === 'int' ? mk(doc.w, doc.h) : clone(old.c), m.out, k);
  let dec = null;
  if (mode === 'add') {
    const l = sampled(doc, merged);
    const od = old.decon;
    const keep = od && l && od.layer === l.id && od.all === isFlat(doc, merged) && wandSum(img, od.idx) === od.sum ? od : null;
    dec = l ? wandDecon(doc, deconJoin(keep, s.est, m.out, doc.w, k), img, merged) : null;
  }
  setSel(doc, c, mode === 'add' ? union(old.b, k) : mode === 'int' ? m.b : trimmed(c, old.b, k), dec);
}
function alphaOf(img) {
  const d = img.data;
  const out = new Uint8Array(img.width * img.height);
  for (let i = 0, p = 3; i < out.length; i++, p += 4) out[i] = d[p];
  return out;
}
function healRegion(s) {
  const pad = Math.ceil(s.size * 1.5) + 8;
  const x = clamp(Math.floor(s.rect.x - pad), 0, s.c.width);
  const y = clamp(Math.floor(s.rect.y - pad), 0, s.c.height);
  const w = Math.min(s.c.width, Math.ceil(s.rect.x + s.rect.w + pad)) - x;
  const hh = Math.min(s.c.height, Math.ceil(s.rect.y + s.rect.h + pad)) - y;
  if (w < 3 || hh < 3) return;
  const src = cx(s.ps.backup).getImageData(x, y, w, hh);
  const mk8 = cx(s.buf).getImageData(x, y, w, hh).data;
  const d = src.data;
  const n = w * hh;
  const hole = new Uint8Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mk8[i * 4 + 3] > 20) {
      hole[i] = 1;
      count++;
    }
  }
  if (!count) return;
  if (s.doc.sel) {
    const sa = cx(s.doc.sel.c).getImageData(x + s.ox, y + s.oy, w, hh).data;
    for (let i = 0; i < n; i++) if (sa[i * 4 + 3] < 128) hole[i] = 0;
  }
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    f[i * 3] = d[i * 4];
    f[i * 3 + 1] = d[i * 4 + 1];
    f[i * 3 + 2] = d[i * 4 + 2];
  }
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (!hole[i] && d[i * 4 + 3] > 0) { sr += f[i * 3]; sg += f[i * 3 + 1]; sb += f[i * 3 + 2]; cnt++; }
  if (!cnt) return;
  for (let i = 0; i < n; i++) if (hole[i]) { f[i * 3] = sr / cnt; f[i * 3 + 1] = sg / cnt; f[i * 3 + 2] = sb / cnt; }
  const iters = clamp(Math.round(Math.max(w, hh) * 1.5), 60, 500);
  for (let it = 0; it < iters; it++) {
    for (let yy = 1; yy < hh - 1; yy++) {
      for (let xx = 1; xx < w - 1; xx++) {
        const i = yy * w + xx;
        if (!hole[i]) continue;
        const p = i * 3;
        for (let c = 0; c < 3; c++) f[p + c] = (f[p - 3 + c] + f[p + 3 + c] + f[p - w * 3 + c] + f[p + w * 3 + c]) / 4;
      }
    }
  }
  let best = null;
  const tries = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]];
  const span = Math.ceil(Math.max(s.rect.w, s.rect.h)) + 4;
  for (const t of tries) {
    const ox = t[0] * span;
    const oy = t[1] * span;
    let ok = true;
    let energy = 0;
    let m = 0;
    for (let yy = 0; yy < hh && ok; yy += 2) {
      for (let xx = 0; xx < w; xx += 2) {
        const i = yy * w + xx;
        if (!hole[i]) continue;
        const qx = xx + ox;
        const qy = yy + oy;
        if (qx < 1 || qy < 1 || qx >= w - 1 || qy >= hh - 1 || hole[qy * w + qx]) {
          ok = false;
          break;
        }
        const q = (qy * w + qx) * 4;
        energy += Math.abs(d[q] - d[q + 4]) + Math.abs(d[q] - d[q + w * 4]);
        m++;
      }
    }
    if (ok && m && (!best || energy / m < best.e)) best = { ox, oy, e: energy / m };
  }
  if (best) {
    const tex = new Float32Array(n * 3);
    const rad = 2;
    for (let yy = 0; yy < hh; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const i = yy * w + xx;
        if (!hole[i]) continue;
        const qx = xx + best.ox;
        const qy = yy + best.oy;
        let ar = 0, ag = 0, ab = 0, k = 0;
        for (let v = -rad; v <= rad; v++) {
          for (let u = -rad; u <= rad; u++) {
            const px = clamp(qx + u, 0, w - 1);
            const py = clamp(qy + v, 0, hh - 1);
            const q = (py * w + px) * 4;
            ar += d[q]; ag += d[q + 1]; ab += d[q + 2]; k++;
          }
        }
        const q = (qy * w + qx) * 4;
        tex[i * 3] = d[q] - ar / k;
        tex[i * 3 + 1] = d[q + 1] - ag / k;
        tex[i * 3 + 2] = d[q + 2] - ab / k;
      }
    }
    for (let i = 0; i < n; i++) if (hole[i]) { f[i * 3] += tex[i * 3]; f[i * 3 + 1] += tex[i * 3 + 1]; f[i * 3 + 2] += tex[i * 3 + 2]; }
  }
  for (let i = 0; i < n; i++) {
    if (!hole[i]) continue;
    const a = clamp(mk8[i * 4 + 3] / 90, 0, 1);
    d[i * 4] = d[i * 4] * (1 - a) + f[i * 3] * a;
    d[i * 4 + 1] = d[i * 4 + 1] * (1 - a) + f[i * 3 + 1] * a;
    d[i * 4 + 2] = d[i * 4 + 2] * (1 - a) + f[i * 3 + 2] * a;
  }
  const g = cx(s.c);
  g.clearRect(0, 0, s.c.width, s.c.height);
  g.drawImage(s.ps.backup, 0, 0);
  g.putImageData(src, x, y);
  s.rect = union(s.rect, { x, y, w, h: hh });
  s.l.ver++;
  s.doc.touch();
}

export function setTool(id) {
  const t = TOOL[id];
  if (!t) return;
  if (app.modal) endModal(true);
  if (app.tool && app.tool.off) app.tool.off();
  app.tool = t;
  if (t.on) t.on();
  setCursor(t.cursor || 'default');
  emit('tool');
  overlay();
}

export function endModal(commit) {
  const m = app.modal;
  if (!m) return;
  app.modal = null;
  if (commit) m.commit();
  else m.cancel();
  setCursor(app.tool ? app.tool.cursor : 'default');
  emit('modal');
  invalidate();
}

function editText(doc, l, isNew, snap) {
  if (app.modal) endModal(true);
  const before = snap || doc.snap();
  const t = l.text;
  const orig = JSON.parse(JSON.stringify(t));
  doc.active = l.id;
  const ta = h('textarea.text-edit', { spellcheck: false, value: t.str, wrap: 'off' });
  view.stage.append(ta);
  l.visible = false;
  const wasVisible = true;
  const place = () => {
    const p = toScreen(t.x, t.y);
    const z = view.zoom;
    ta.style.font = fontOf(t, t.size * z);
    ta.style.lineHeight = String(t.lh || 1.2);
    ta.style.color = rgba(t.color, 1);
    ta.style.textAlign = t.align;
    ta.style.left = p.x + 'px';
    ta.style.top = p.y + 'px';
    ta.style.transform = 'rotate(' + (t.angle || 0) + 'deg)';
    const lines = ta.value.split('\n');
    const m = cx(mk(2, 2));
    m.font = fontOf(t, t.size * z);
    const w = Math.max(...lines.map((s) => m.measureText(s).width), t.size * z * 0.6);
    ta.style.width = Math.ceil(w + t.size * z * 0.5) + 'px';
    ta.style.height = Math.ceil(lines.length * t.size * z * (t.lh || 1.2) + 4) + 'px';
  };
  const sync = () => {
    const o = O('text');
    o.font = t.font;
    o.size = Math.round((t.size * 72) / doc.dpi);
    o.bold = !!t.bold;
    o.italic = !!t.italic;
    o.align = t.align;
    o.color = { ...t.color };
    emit('opts');
  };
  sync();
  place();
  ta.addEventListener('input', place);
  ta.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') {
      ev.preventDefault();
      endModal(false);
    } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      endModal(true);
    }
  });
  setTimeout(() => {
    ta.focus();
    if (!isNew) ta.select();
  }, 0);
  const done = () => {
    ta.remove();
    l.visible = wasVisible;
  };
  app.modal = {
    id: 'text', name: 'Type', layer: l, place,
    apply(key, value) {
      if (key === 'size') t.size = Math.round((value * doc.dpi) / 72);
      else if (key === 'color') t.color = { ...value };
      else t[key] = value;
      if (key === 'font') loadFont(value).then(place);
      place();
    },
    down() {
      endModal(true);
    },
    commit() {
      done();
      t.str = ta.value.replace(/\s+$/, '');
      if (!t.str) {
        doc.restore(before);
        if (!isNew) {
          doc.act('Delete Layer', () => {
            doc.layers = doc.layers.filter((x) => x !== l);
            doc.active = doc.layers.length ? doc.layers[doc.layers.length - 1].id : null;
          });
        }
        doc.touch('all');
        emit('layers');
        return;
      }
      l.name = t.str.split('\n')[0].slice(0, 24);
      renderText(l);
      doc.commit(isNew ? 'Type Tool' : 'Edit Type Layer', before);
      emit('layers');
    },
    cancel() {
      done();
      if (isNew) doc.restore(before);
      else {
        l.text = orig;
        renderText(l);
      }
      doc.touch('all');
      emit('layers');
    }
  };
  emit('modal');
  invalidate();
}
export { editText };

export function startTransform() {
  const doc = app.doc;
  if (!doc) return;
  if (app.modal) endModal(true);
  let l = doc.al;
  if (!l || l.type === 'adjust') return;
  if (l.lock) {
    toast('This layer is locked.');
    return;
  }
  const before = doc.snap();
  let floated = false;
  if (doc.sel && l.type === 'raster') {
    const b = doc.sel.b;
    const piece = mk(b.w, b.h);
    const pg = cx(piece);
    pg.drawImage(l.canvas, l.x - b.x, l.y - b.y);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(doc.sel.c, -b.x, -b.y);
    const hole = clone(l.canvas);
    const hg = cx(hole);
    hg.globalCompositeOperation = 'destination-out';
    hg.drawImage(doc.sel.c, -l.x, -l.y);
    l.canvas = hole;
    l.ver++;
    const fl = new Layer({ name: 'Floating Selection', canvas: piece, x: b.x, y: b.y, opacity: 1 });
    doc.layers.splice(doc.layers.indexOf(l) + 1, 0, fl);
    fl.base = l;
    l = fl;
    floated = true;
    view.hideAnts = true;
  }
  const st = { w: l.w, h: l.h, cx: l.x + l.w / 2, cy: l.y + l.h / 2, sx: 1, sy: 1, rot: 0 };
  const matrix = () => {
    const c = Math.cos(st.rot);
    const s = Math.sin(st.rot);
    const a = c * st.sx, b = s * st.sx, cc = -s * st.sy, d = c * st.sy;
    return [a, b, cc, d, st.cx - (a * st.w) / 2 - (cc * st.h) / 2, st.cy - (b * st.w) / 2 - (d * st.h) / 2];
  };
  const pt = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const corners = () => {
    const m = matrix();
    return [pt(m, 0, 0), pt(m, st.w / 2, 0), pt(m, st.w, 0), pt(m, st.w, st.h / 2), pt(m, st.w, st.h), pt(m, st.w / 2, st.h), pt(m, 0, st.h), pt(m, 0, st.h / 2)];
  };
  const update = () => {
    l.tm = matrix();
    doc.touch();
    emit('modalopts');
  };
  const HX = [-1, 0, 1, 1, 1, 0, -1, -1];
  const HY = [-1, -1, -1, 0, 1, 1, 1, 0];
  let drag = null;
  update();
  app.modal = {
    id: 'transform', name: 'Free Transform', st,
    fields: () => [['W', Math.round(st.sx * 1000) / 10, '%'], ['H', Math.round(st.sy * 1000) / 10, '%'], ['Angle', Math.round(((st.rot * 180) / Math.PI) * 10) / 10, '°']],
    setField(i, v) {
      if (i === 0) st.sx = v / 100;
      else if (i === 1) st.sy = v / 100;
      else st.rot = (v * Math.PI) / 180;
      update();
    },
    down(e) {
      const cs = corners();
      for (let i = 0; i < 8; i++) {
        const s = toScreen(cs[i].x, cs[i].y);
        if (Math.hypot(s.x - e.sx, s.y - e.sy) < 9) {
          drag = { kind: 'scale', i, st: { ...st }, x: e.x, y: e.y };
          return;
        }
      }
      const c = Math.cos(-st.rot);
      const s = Math.sin(-st.rot);
      const dx = e.x - st.cx;
      const dy = e.y - st.cy;
      const lx = dx * c - dy * s;
      const ly = dx * s + dy * c;
      if (Math.abs(lx) <= Math.abs(st.w * st.sx) / 2 && Math.abs(ly) <= Math.abs(st.h * st.sy) / 2) drag = { kind: 'move', st: { ...st }, x: e.x, y: e.y };
      else drag = { kind: 'rot', st: { ...st }, a: Math.atan2(dy, dx) };
    },
    move(e) {
      if (!drag) return;
      const o = drag.st;
      if (drag.kind === 'move') {
        let dx = e.x - drag.x;
        let dy = e.y - drag.y;
        if (e.shift) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        st.cx = o.cx + dx;
        st.cy = o.cy + dy;
      } else if (drag.kind === 'rot') {
        let r = o.rot + Math.atan2(e.y - o.cy, e.x - o.cx) - drag.a;
        if (e.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
        st.rot = r;
      } else {
        const hx = HX[drag.i];
        const hy = HY[drag.i];
        const c = Math.cos(o.rot);
        const s = Math.sin(o.rot);
        const hw = (o.w * o.sx) / 2;
        const hh = (o.h * o.sy) / 2;
        const ax = o.cx + c * (-hx * hw) - s * (-hy * hh);
        const ay = o.cy + s * (-hx * hw) + c * (-hy * hh);
        const vx = e.x - ax;
        const vy = e.y - ay;
        let nw = hx ? (vx * c + vy * s) * hx : o.w * o.sx;
        let nh = hy ? (-vx * s + vy * c) * hy : o.h * o.sy;
        if (hx && hy && !e.shift) {
          const k = Math.max(Math.abs(nw / (o.w * o.sx)), Math.abs(nh / (o.h * o.sy)));
          nw = o.w * o.sx * k * Math.sign(nw || 1);
          nh = o.h * o.sy * k * Math.sign(nh || 1);
        }
        if (e.alt) {
          st.sx = hx ? ((nw - hw) * 2) / o.w + 0 : o.sx;
          st.sy = hy ? ((nh - hh) * 2) / o.h + 0 : o.sy;
          st.cx = o.cx;
          st.cy = o.cy;
        } else {
          st.sx = nw / o.w;
          st.sy = nh / o.h;
          const mx = hx ? (hx * nw) / 2 : 0;
          const my = hy ? (hy * nh) / 2 : 0;
          const bx = hx ? ax : o.cx;
          const by = hy ? ay : o.cy;
          const px = hx ? ax : o.cx + c * 0 - s * (-hy * hh);
          const py = hy ? ay : o.cy;
          if (hx && hy) {
            st.cx = ax + c * mx - s * my;
            st.cy = ay + s * mx + c * my;
          } else if (hx) {
            st.cx = o.cx + c * (mx - hx * hw);
            st.cy = o.cy + s * (mx - hx * hw);
          } else {
            st.cx = o.cx - s * (my - hy * hh);
            st.cy = o.cy + c * (my - hy * hh);
          }
          void bx; void by; void px; void py;
        }
      }
      update();
    },
    up() {
      drag = null;
    },
    hover(e) {
      const cs = corners();
      let cur = 'default';
      for (let i = 0; i < 8; i++) {
        const s = toScreen(cs[i].x, cs[i].y);
        if (Math.hypot(s.x - e.sx, s.y - e.sy) < 9) cur = 'nwse-resize';
      }
      setCursor(cur);
    },
    overlay(g) {
      const cs = corners().map((p) => toScreen(p.x, p.y));
      g.strokeStyle = '#e8a33d';
      g.lineWidth = 1;
      g.beginPath();
      [0, 2, 4, 6].forEach((i, n) => (n ? g.lineTo(cs[i].x, cs[i].y) : g.moveTo(cs[i].x, cs[i].y)));
      g.closePath();
      g.stroke();
      cs.forEach((p) => handle(g, p.x, p.y));
    },
    key(ev) {
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
      if (!d) return false;
      st.cx += d[0] * (ev.shiftKey ? 10 : 1);
      st.cy += d[1] * (ev.shiftKey ? 10 : 1);
      update();
      return true;
    },
    commit() {
      view.hideAnts = false;
      const uniform = Math.abs(Math.abs(st.sx) - Math.abs(st.sy)) < 0.002 && st.sx > 0 && st.sy > 0;
      if (l.type === 'text' && uniform) {
        l.tm = null;
        const t = l.text;
        t.size = Math.max(1, t.size * st.sx);
        t.angle = (t.angle || 0) + (st.rot * 180) / Math.PI;
        renderText(l);
        t.x += st.cx - (l.x + l.w / 2);
        t.y += st.cy - (l.y + l.h / 2);
        renderText(l);
      } else {
        if (l.type === 'text') {
          l.type = 'raster';
          l.text = null;
        }
        bake(l);
      }
      if (floated) {
        const base = l.base;
        const x0 = Math.min(base.x, l.x), y0 = Math.min(base.y, l.y);
        const x1 = Math.max(base.x + base.w, l.x + l.w), y1 = Math.max(base.y + base.h, l.y + l.h);
        const c = mk(x1 - x0, y1 - y0);
        const g = cx(c);
        g.drawImage(base.canvas, base.x - x0, base.y - y0);
        g.drawImage(l.canvas, l.x - x0, l.y - y0);
        base.canvas = c;
        base.x = x0;
        base.y = y0;
        base.ver++;
        const sc = mk(doc.w, doc.h);
        const sg = cx(sc);
        const m = matrix();
        const b = before.sel.b;
        sg.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        sg.drawImage(before.sel.c, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
        doc.layers = doc.layers.filter((x) => x !== l);
        doc.active = base.id;
        setSel(doc, sc);
      }
      doc.commit('Free Transform', before);
      emit('layers');
    },
    cancel() {
      view.hideAnts = false;
      l.tm = null;
      doc.restore(before);
      doc.touch('all');
      emit('layers');
    }
  };
  setCursor('default');
  emit('modal');
  invalidate();
}

export function initTools() {
  for (const t of TOOLS) {
    const o = {};
    for (const s of t.opts || []) if (s.k) o[s.k] = s.v;
    app.opts[t.id] = o;
  }
  app.opts.text.color = null;
  setTool('move');
}
