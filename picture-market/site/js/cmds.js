import { h, emit, mk, cx, clone, clamp, rgba, pickFiles, loadImage, bounds, isMac } from './util.js';
import { Layer, render, flatten, setSel, selInvert, selGrow, selFeather, renderText, newMask, bake, cover } from './doc.js';
import { ADJ, FILTERS, defaults, applyAdjust, autoLevels, chamfer, R, C, COL, S } from './fx.js';
import { app, view, fit, setZoom, zoomStep, invalidate } from './view.js';
import { paintTarget, startTransform, endModal, editText, cropDoc, setTool, TOOLS, contentBox } from './tools.js';
import { dialog, form, toast, pickColor } from './ui.js';
import { PRESETS, activate, addDoc, removeDoc, newDoc, busy } from './docs.js';
import { openFiles, saveProject, exportImage, exportPsd, printDoc, placeCanvas } from './io.js';

const doc = () => app.doc;
const copyObj = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

function applyPixels(name, fn) {
  const d = doc();
  const tg = paintTarget(d);
  if (!tg) return false;
  if (tg.key !== 'canvas') {
    toast('Click the layer thumbnail (not the mask) first.');
    return false;
  }
  const l = tg.l;
  const ps = d.beginPaint(l);
  let r = { x: 0, y: 0, w: l.w, h: l.h };
  if (d.sel) {
    const b = d.sel.b;
    const x0 = Math.max(0, b.x - l.x);
    const y0 = Math.max(0, b.y - l.y);
    const x1 = Math.min(l.w, b.x + b.w - l.x);
    const y1 = Math.min(l.h, b.y + b.h - l.y);
    if (x1 <= x0 || y1 <= y0) {
      toast('The selection is empty on this layer.');
      return false;
    }
    r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const g = cx(l.canvas);
  const img = g.getImageData(r.x, r.y, r.w, r.h);
  const out = fn(img) || img;
  if (d.sel) {
    const t = mk(r.w, r.h);
    const tgx = cx(t);
    tgx.putImageData(out, 0, 0);
    tgx.globalCompositeOperation = 'destination-in';
    tgx.drawImage(d.sel.c, -(r.x + l.x), -(r.y + l.y));
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(d.sel.c, -l.x, -l.y);
    g.globalCompositeOperation = 'lighter';
    g.drawImage(t, r.x, r.y);
    g.restore();
  } else g.putImageData(out, r.x, r.y);
  l.ver++;
  d.endPaint(name, ps, r);
  return true;
}

async function fxDialog(name, specs, fn, initial) {
  const d = doc();
  const tg = paintTarget(d);
  if (!tg) return null;
  if (tg.key !== 'canvas') {
    toast('Click the layer thumbnail (not the mask) first.');
    return null;
  }
  const l = tg.l;
  const params = initial || defaults(specs);
  const orig = l.canvas;
  const k = l.mask || l.fx ? 1 : Math.min(1, 1100 / Math.max(orig.width, orig.height));
  const pw = Math.max(1, Math.round(orig.width * k));
  const ph = Math.max(1, Math.round(orig.height * k));
  const proxy = mk(pw, ph);
  const pg = cx(proxy, { willReadFrequently: true });
  pg.imageSmoothingQuality = 'high';
  pg.drawImage(orig, 0, 0, pw, ph);
  const base = pg.getImageData(0, 0, pw, ph);
  let selP = null;
  if (d.sel) {
    selP = mk(pw, ph);
    const sg = cx(selP);
    sg.setTransform(k, 0, 0, k, -l.x * k, -l.y * k);
    sg.drawImage(d.sel.c, 0, 0);
  }
  const lx = l.x;
  const ly = l.y;
  let raf = 0;
  const preview = () => {
    raf = 0;
    const img = new ImageData(new Uint8ClampedArray(base.data), pw, ph);
    const out = fn(img, params, k) || img;
    const c = mk(pw, ph);
    const g = cx(c);
    g.putImageData(out, 0, 0);
    if (selP) {
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(selP, 0, 0);
      g.globalCompositeOperation = 'destination-over';
      g.drawImage(proxy, 0, 0);
    }
    l.canvas = c;
    l.tm = k === 1 ? null : [1 / k, 0, 0, 1 / k, lx, ly];
    l.ver++;
    d.touch();
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(preview);
  };
  schedule();
  const ok = specs.length ? await dialog(name, form(specs, params, schedule), undefined, { clear: true, width: 340 }) : true;
  cancelAnimationFrame(raf);
  l.canvas = orig;
  l.tm = null;
  l.ver++;
  if (!ok) {
    d.touch();
    return null;
  }
  await busy(name, () => applyPixels(name, (img) => fn(img, params, 1)));
  return params;
}

const env = () => ({ fg: app.fg, bg: app.bg });
async function runFilter(f, repeat) {
  if (!doc()) return;
  const fn = (img, p, k) => f.run(img, p, k, env());
  if (repeat && app.lastFilter && app.lastFilter.id === f.id) {
    await busy(f.name, () => applyPixels(f.name, (img) => fn(img, app.lastFilter.p, 1)));
    return;
  }
  if (!f.p.length) {
    await busy(f.name, () => applyPixels(f.name, (img) => fn(img, {}, 1)));
    app.lastFilter = { id: f.id, p: {} };
    return;
  }
  const p = await fxDialog(f.name, f.p, fn);
  if (p) app.lastFilter = { id: f.id, p };
}
async function runAdjust(kind) {
  if (!doc()) return;
  const a = ADJ[kind];
  const fn = (img, p) => applyAdjust(img.data, kind, p);
  if (!a.p.length) {
    await busy(a.name, () => applyPixels(a.name, (img) => fn(img, {})));
    return;
  }
  await fxDialog(a.name, a.p, fn);
}
async function adjLayer(kind) {
  const d = doc();
  if (!d) return;
  const a = ADJ[kind];
  const before = d.snap();
  const l = new Layer({ type: 'adjust', name: a.name, adj: { kind, p: defaults(a.p) } });
  d.add(l);
  if (d.sel) newMask(d, l, true, false);
  emit('layers');
  d.touch('all');
  if (a.p.length) {
    const ok = await dialog(a.name, form(a.p, l.adj.p, () => {
      l.ver++;
      d.touch();
    }), undefined, { clear: true, width: 340 });
    if (!ok) {
      d.restore(before);
      d.touch('all');
      emit('layers');
      return;
    }
  }
  d.commit(a.name + ' Layer', before);
  emit('layers');
}
async function editAdj(l) {
  const d = doc();
  const a = ADJ[l.adj.kind];
  if (!a.p.length) return;
  const before = d.snap();
  const ok = await dialog(a.name, form(a.p, l.adj.p, () => {
    l.ver++;
    d.touch();
  }), undefined, { clear: true, width: 340 });
  if (ok) d.commit('Modify ' + a.name, before);
  else {
    d.restore(before);
    d.touch('all');
  }
}

async function layerStyle() {
  const d = doc();
  const l = d && d.al;
  if (!l || l.type === 'adjust') return;
  const before = d.snap();
  const f = l.fx || {};
  const v = {
    strokeOn: !!(f.stroke && f.stroke.on), strokeSize: f.stroke ? f.stroke.size : 6, strokeColor: f.stroke ? f.stroke.color : { r: 0, g: 0, b: 0 },
    shadowOn: !!(f.shadow && f.shadow.on), shadowColor: f.shadow ? f.shadow.color : { r: 0, g: 0, b: 0 }, shadowOpacity: f.shadow ? Math.round(f.shadow.opacity * 100) : 60,
    shadowAngle: f.shadow ? f.shadow.angle : 135, shadowDist: f.shadow ? f.shadow.dist : 12, shadowBlur: f.shadow ? f.shadow.blur : 14,
    overlayOn: !!(f.overlay && f.overlay.on), overlayColor: f.overlay ? f.overlay.color : { ...app.fg }
  };
  const apply = () => {
    l.fx = v.strokeOn || v.shadowOn || v.overlayOn ? {
      stroke: { on: v.strokeOn, size: v.strokeSize, color: v.strokeColor },
      shadow: { on: v.shadowOn, color: v.shadowColor, opacity: v.shadowOpacity / 100, angle: v.shadowAngle, dist: v.shadowDist, blur: v.shadowBlur },
      overlay: { on: v.overlayOn, color: v.overlayColor }
    } : null;
    l.ver++;
    d.touch();
  };
  const specs = [C('strokeOn', 'Stroke'), R('strokeSize', 'Size', 1, 60, 6), COL('strokeColor', 'Color'),
    C('shadowOn', 'Drop Shadow'), COL('shadowColor', 'Color'), R('shadowOpacity', 'Opacity', 0, 100, 60), R('shadowAngle', 'Angle', 0, 360, 135), R('shadowDist', 'Distance', 0, 200, 12), R('shadowBlur', 'Size', 0, 100, 14),
    C('overlayOn', 'Color Overlay'), COL('overlayColor', 'Color')];
  const ok = await dialog('Layer Style', form(specs, v, apply), undefined, { clear: true, width: 340 });
  if (ok) {
    apply();
    d.commit('Layer Style', before);
  } else {
    d.restore(before);
    d.touch('all');
  }
  emit('layers');
}

async function ask(title, label, value, min, max) {
  const v = { n: value };
  const ok = await dialog(title, form([R('n', label, min, max, value)], v, () => {}), undefined, { width: 320 });
  return ok ? v.n : null;
}

async function newDialog() {
  const v = { name: 'Untitled', preset: '0', w: PRESETS[0].w, h: PRESETS[0].h, unit: 'px', dpi: PRESETS[0].dpi, bg: 'white' };
  const box = h('div');
  const build = () => {
    const toU = (px) => (v.unit === 'in' ? Math.round((px / v.dpi) * 1000) / 1000 : px);
    const vals = { name: v.name, preset: v.preset, w: toU(v.w), h: toU(v.h), unit: v.unit, dpi: v.dpi, bg: v.bg };
    const specs = [
      { k: 'name', label: 'Name', type: 'text' },
      S('preset', 'Preset', [...PRESETS.map((p, i) => [String(i), p.name]), ['c', 'Custom']], v.preset),
      { k: 'w', label: 'Width', type: 'text' }, { k: 'h', label: 'Height', type: 'text' },
      S('unit', 'Units', [['px', 'Pixels'], ['in', 'Inches']], v.unit),
      { k: 'dpi', label: 'Resolution (ppi)', type: 'text' },
      S('bg', 'Background', [['white', 'White'], ['transparent', 'Transparent'], ['bgc', 'Background Color'], ['black', 'Black']], v.bg)
    ];
    box.replaceChildren(form(specs, vals, (k, val) => {
      const toPx = (n) => Math.round(v.unit === 'in' ? n * v.dpi : n);
      if (k === 'preset') {
        v.preset = val;
        if (val !== 'c') {
          const p = PRESETS[Number(val)];
          v.w = p.w;
          v.h = p.h;
          v.dpi = p.dpi;
        }
        build();
      } else if (k === 'unit') {
        v.unit = val;
        build();
      } else if (k === 'w' || k === 'h') {
        const n = parseFloat(val);
        if (n > 0) v[k] = toPx(n);
        v.preset = 'c';
      } else if (k === 'dpi') {
        const n = parseFloat(val);
        if (n > 0) {
          if (v.unit === 'in') {
            v.w = Math.round((v.w / v.dpi) * n);
            v.h = Math.round((v.h / v.dpi) * n);
          }
          v.dpi = n;
        }
      } else v[k] = val;
    }));
  };
  build();
  const ok = await dialog('New Document', box, [['Create', true], ['Cancel', null]], { width: 360 });
  if (!ok) return;
  const w = clamp(v.w, 1, 12000);
  const hh = clamp(v.h, 1, 12000);
  if (w * hh > 60e6) {
    toast('That is too large. Keep it under 60 megapixels.');
    return;
  }
  newDoc({ name: v.name || 'Untitled', w, h: hh, dpi: v.dpi, bg: v.bg === 'bgc' ? rgba(app.bg, 1) : v.bg });
}

function scaleDoc(d, nw, nh) {
  const kx = nw / d.w;
  const ky = nh / d.h;
  for (const l of d.layers) {
    const sc = (c) => {
      const o = mk(Math.max(1, Math.round(c.width * kx)), Math.max(1, Math.round(c.height * ky)));
      const g = cx(o);
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, o.width, o.height);
      return o;
    };
    if (l.mask) l.mask = { ...l.mask, canvas: sc(l.mask.canvas), x: Math.round(l.mask.x * kx), y: Math.round(l.mask.y * ky) };
    if (l.type === 'text') {
      l.text.size = Math.max(1, l.text.size * ky);
      l.text.x *= kx;
      l.text.y *= ky;
      renderText(l);
    } else if (l.type !== 'adjust') {
      l.canvas = sc(l.canvas);
      l.x = Math.round(l.x * kx);
      l.y = Math.round(l.y * ky);
      l.ver++;
    }
    if (l.fx) {
      if (l.fx.stroke) l.fx.stroke.size = Math.max(1, Math.round(l.fx.stroke.size * ky));
      if (l.fx.shadow) {
        l.fx.shadow.dist = Math.round(l.fx.shadow.dist * ky);
        l.fx.shadow.blur = Math.round(l.fx.shadow.blur * ky);
      }
    }
  }
  setSel(d, null);
  d.w = nw;
  d.h = nh;
}

async function imageSize() {
  const d = doc();
  const v = { w: d.w, h: d.h, dpi: d.dpi, link: true, resample: true };
  const ratio = d.w / d.h;
  const box = h('div');
  const build = () => {
    box.replaceChildren(form([
      { k: 'w', label: 'Width (px)', type: 'text' }, { k: 'h', label: 'Height (px)', type: 'text' }, { k: 'dpi', label: 'Resolution (ppi)', type: 'text' },
      C('link', 'Constrain Proportions', true), C('resample', 'Resample Image', true)
    ], { ...v }, (k, val) => {
      if (k === 'w' || k === 'h') {
        const n = Math.round(parseFloat(val));
        if (!(n > 0)) return;
        v[k] = n;
        if (v.link) {
          if (k === 'w') v.h = Math.max(1, Math.round(n / ratio));
          else v.w = Math.max(1, Math.round(n * ratio));
          const other = box.querySelectorAll('input.txt')[k === 'w' ? 1 : 0];
          if (other) other.value = k === 'w' ? v.h : v.w;
        }
      } else if (k === 'dpi') {
        const n = parseFloat(val);
        if (n > 0) v.dpi = n;
      } else v[k] = val;
    }), h('div.note', { text: 'Print size: ' + (d.w / d.dpi).toFixed(2) + ' × ' + (d.h / d.dpi).toFixed(2) + ' in at ' + d.dpi + ' ppi' }));
  };
  build();
  const ok = await dialog('Image Size', box, undefined, { width: 340 });
  if (!ok) return;
  if (v.w * v.h > 60e6) {
    toast('That is too large. Keep it under 60 megapixels.');
    return;
  }
  await busy('Image Size', () => d.act('Image Size', () => {
    if (v.resample && (v.w !== d.w || v.h !== d.h)) scaleDoc(d, v.w, v.h);
    d.dpi = v.dpi;
  }));
  fit();
  emit('docs');
}

async function canvasSize() {
  const d = doc();
  const v = { w: d.w, h: d.h, anchor: '4' };
  const names = ['Top Left', 'Top', 'Top Right', 'Left', 'Center', 'Right', 'Bottom Left', 'Bottom', 'Bottom Right'];
  const body = form([{ k: 'w', label: 'Width (px)', type: 'text' }, { k: 'h', label: 'Height (px)', type: 'text' }, S('anchor', 'Anchor', names.map((n, i) => [String(i), n]), '4')], v, () => {});
  const ok = await dialog('Canvas Size', body, undefined, { width: 340 });
  if (!ok) return;
  const nw = Math.round(parseFloat(v.w));
  const nh = Math.round(parseFloat(v.h));
  if (!(nw > 0 && nh > 0) || nw * nh > 60e6) return;
  const a = Number(v.anchor);
  const dx = Math.round((nw - d.w) * ((a % 3) / 2));
  const dy = Math.round((nh - d.h) * (Math.floor(a / 3) / 2));
  d.act('Canvas Size', () => cropDoc(d, -dx, -dy, nw, nh));
  fit();
  emit('docs');
}

function rotateDoc(d, kind) {
  const W = d.w;
  const H = d.h;
  for (const l of d.layers) {
    if (l.type === 'adjust' && !l.mask) continue;
    if (l.type === 'text' && (kind === 'cw' || kind === 'ccw' || kind === '180')) {
      const t = l.text;
      const ccx = l.x + l.w / 2;
      const ccy = l.y + l.h / 2;
      let nx, ny;
      if (kind === 'cw') { nx = H - ccy; ny = ccx; t.angle = (t.angle || 0) + 90; }
      else if (kind === 'ccw') { nx = ccy; ny = W - ccx; t.angle = (t.angle || 0) - 90; }
      else { nx = W - ccx; ny = H - ccy; t.angle = (t.angle || 0) + 180; }
      renderText(l);
      t.x += nx - (l.x + l.w / 2);
      t.y += ny - (l.y + l.h / 2);
      renderText(l);
      continue;
    }
    if (l.type === 'text') {
      l.type = 'raster';
      l.text = null;
    }
    if (kind === 'cw') l.tm = [0, 1, -1, 0, H - l.y, l.x];
    else if (kind === 'ccw') l.tm = [0, -1, 1, 0, l.y, W - l.x];
    else if (kind === '180') l.tm = [-1, 0, 0, -1, W - l.x, H - l.y];
    else if (kind === 'h') l.tm = [-1, 0, 0, 1, W - l.x, l.y];
    else l.tm = [1, 0, 0, -1, l.x, H - l.y];
    if (l.type === 'adjust') {
      const m = l.mask;
      const tmp = new Layer({ canvas: m.canvas, x: m.x, y: m.y });
      tmp.tm = l.tm.slice();
      tmp.tm[4] += kind === 'cw' ? l.y - m.y : kind === 'ccw' ? m.y - l.y : kind === '180' || kind === 'h' ? l.x - m.x : 0;
      tmp.tm[5] += kind === 'cw' ? m.x - l.x : kind === 'ccw' ? l.x - m.x : kind === '180' || kind === 'v' ? l.y - m.y : 0;
      bake(tmp);
      l.mask = { ...m, canvas: tmp.canvas, x: tmp.x, y: tmp.y };
      l.tm = null;
      l.ver++;
    } else bake(l);
  }
  setSel(d, null);
  if (kind === 'cw' || kind === 'ccw') {
    d.w = H;
    d.h = W;
  }
}

function layerFlip(kind) {
  const d = doc();
  const l = d && d.al;
  if (!l || l.type === 'adjust' || l.lock) return;
  const names = { h: 'Flip Horizontal', v: 'Flip Vertical', cw: 'Rotate 90° Clockwise', ccw: 'Rotate 90° Counter Clockwise', 180: 'Rotate 180°' };
  d.act(names[kind], () => {
    const ccx = l.x + l.w / 2;
    const ccy = l.y + l.h / 2;
    if (l.type === 'text' && kind !== 'h' && kind !== 'v') {
      const t = l.text;
      t.angle = (t.angle || 0) + (kind === 'cw' ? 90 : kind === 'ccw' ? -90 : 180);
      renderText(l);
      t.x += ccx - (l.x + l.w / 2);
      t.y += ccy - (l.y + l.h / 2);
      renderText(l);
      return;
    }
    if (l.type === 'text') {
      l.type = 'raster';
      l.text = null;
    }
    const w = l.w;
    const hh = l.h;
    if (kind === 'h') l.tm = [-1, 0, 0, 1, l.x + w, l.y];
    else if (kind === 'v') l.tm = [1, 0, 0, -1, l.x, l.y + hh];
    else if (kind === '180') l.tm = [-1, 0, 0, -1, l.x + w, l.y + hh];
    else if (kind === 'cw') l.tm = [0, 1, -1, 0, ccx + hh / 2, ccy - w / 2];
    else l.tm = [0, -1, 1, 0, ccx - hh / 2, ccy + w / 2];
    bake(l);
  });
  emit('layers');
}

function copySel(merged) {
  const d = doc();
  const l = d.al;
  let c, x, y;
  if (merged) {
    c = flatten(d);
    x = 0;
    y = 0;
  } else {
    if (!l || l.type === 'adjust') return null;
    c = clone(l.canvas);
    x = l.x;
    y = l.y;
  }
  if (d.sel) {
    const b = d.sel.b;
    const o = mk(b.w, b.h);
    const g = cx(o);
    g.drawImage(c, x - b.x, y - b.y);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(d.sel.c, -b.x, -b.y);
    c = o;
    x = b.x;
    y = b.y;
  }
  return { canvas: c, x, y, doc: d.id };
}
function doCopy(merged) {
  const c = copySel(merged);
  if (!c) return false;
  app.clip = c;
  c.synced = false;
  try {
    c.canvas.toBlob((blob) => {
      if (!blob || !navigator.clipboard || !window.ClipboardItem) return;
      c.size = blob.size;
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => { c.synced = true; }).catch(() => {});
    });
  } catch (e) {
    console.warn(e);
  }
  return true;
}
function clearSel(name = 'Clear') {
  const d = doc();
  if (!d.sel) {
    if (app.tool && app.tool.id === 'move' && !app.modal) run('delLayer');
    return;
  }
  const tg = paintTarget(d);
  if (!tg) return;
  const ps = d.beginPaint(tg.l, tg.key);
  const c = tg.key === 'mask' ? tg.l.mask.canvas : tg.l.canvas;
  const off = tg.key === 'mask' ? tg.l.mask : tg.l;
  const g = cx(c);
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(d.sel.c, -off.x, -off.y);
  g.restore();
  tg.l.ver++;
  d.endPaint(name, ps, { x: d.sel.b.x - off.x, y: d.sel.b.y - off.y, w: d.sel.b.w, h: d.sel.b.h });
}
function pasteClip() {
  const d = doc();
  const c = app.clip;
  if (!c) return;
  if (!d) {
    const nd = newDoc({ w: c.canvas.width, h: c.canvas.height, bg: 'transparent', name: 'Clipboard' });
    nd.layers[0].canvas = clone(c.canvas);
    nd.touch('all');
    return;
  }
  let x = c.x;
  let y = c.y;
  if (c.doc !== d.id || x + c.canvas.width < 0 || y + c.canvas.height < 0 || x > d.w || y > d.h) {
    x = Math.round((d.w - c.canvas.width) / 2);
    y = Math.round((d.h - c.canvas.height) / 2);
  }
  d.act('Paste', () => {
    d.add(new Layer({ name: d.newName(), canvas: clone(c.canvas), x, y }));
    setSel(d, null);
  });
  emit('layers');
}
export async function pasteExternal(file) {
  if (file && !(app.clip && (!app.clip.synced || app.clip.size === file.size))) {
    try {
      const c = await loadImage(file);
      placeCanvas(c, doc() ? doc().newName() : 'Clipboard');
    } catch (e) {
      toast('The clipboard image could not be read.');
    }
    return;
  }
  pasteClip();
}

function fillWith(color, opacity = 1, name = 'Fill') {
  const d = doc();
  const tg = paintTarget(d);
  if (!tg) return;
  const ps = d.beginPaint(tg.l, tg.key);
  const c = tg.key === 'mask' ? tg.l.mask.canvas : tg.l.canvas;
  const off = tg.key === 'mask' ? tg.l.mask : tg.l;
  const t = mk(c.width, c.height);
  const g = cx(t);
  const lum = 0.299 * color.r + 0.587 * color.g + 0.114 * color.b;
  g.fillStyle = tg.key === 'mask' ? '#fff' : rgba(color, 1);
  if (d.sel) {
    g.drawImage(d.sel.c, -off.x, -off.y);
    g.globalCompositeOperation = 'source-in';
    g.fillRect(0, 0, t.width, t.height);
  } else g.fillRect(-off.x, -off.y, d.w, d.h);
  const lg = cx(c);
  lg.save();
  lg.globalAlpha = opacity;
  if (tg.key === 'mask' && lum < 128) lg.globalCompositeOperation = 'destination-out';
  lg.drawImage(t, 0, 0);
  lg.restore();
  tg.l.ver++;
  d.endPaint(name, ps, { x: 0, y: 0, w: c.width, h: c.height });
}
async function fillDialog() {
  const v = { use: 'fg', opacity: 100 };
  const ok = await dialog('Fill', form([S('use', 'Contents', [['fg', 'Foreground Color'], ['bg', 'Background Color'], ['color', 'Color…'], ['black', 'Black'], ['gray', '50% Gray'], ['white', 'White']], 'fg'), R('opacity', 'Opacity', 1, 100, 100)], v, () => {}), undefined, { width: 320 });
  if (!ok) return;
  let c = app.fg;
  if (v.use === 'bg') c = app.bg;
  else if (v.use === 'black') c = { r: 0, g: 0, b: 0 };
  else if (v.use === 'white') c = { r: 255, g: 255, b: 255 };
  else if (v.use === 'gray') c = { r: 128, g: 128, b: 128 };
  else if (v.use === 'color') {
    c = await pickColor(app.fg);
    if (!c) return;
  }
  fillWith(c, v.opacity / 100);
}
async function strokeDialog() {
  const d = doc();
  if (!d.sel) {
    toast('Make a selection first.');
    return;
  }
  const v = { width: 4, pos: 'center', color: { ...app.fg } };
  const ok = await dialog('Stroke', form([R('width', 'Width', 1, 250, 4), COL('color', 'Color'), S('pos', 'Location', [['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']], 'center')], v, () => {}), undefined, { width: 320 });
  if (!ok) return;
  const tg = paintTarget(d);
  if (!tg || tg.key !== 'canvas') return;
  await busy('Stroke', () => {
    const w = d.w;
    const hh = d.h;
    const src = cx(d.sel.c).getImageData(0, 0, w, hh);
    const out = chamfer(src.data, w, hh, false);
    const inn = chamfer(src.data, w, hh, true);
    const img = new ImageData(w, hh);
    const px = img.data;
    const wo = v.pos === 'outside' ? v.width : v.pos === 'center' ? v.width / 2 : 0;
    const wi = v.pos === 'inside' ? v.width : v.pos === 'center' ? v.width / 2 : 0;
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      let a = 0;
      if (out[i] > 0) a = wo > 0 ? clamp(wo - out[i] + 1, 0, 1) : 0;
      else a = wi > 0 ? clamp(wi - inn[i] + 1, 0, 1) : 0;
      if (a > 0) {
        px[p] = v.color.r;
        px[p + 1] = v.color.g;
        px[p + 2] = v.color.b;
        px[p + 3] = a * 255;
      }
    }
    const t = mk(w, hh);
    cx(t).putImageData(img, 0, 0);
    const ps = d.beginPaint(tg.l);
    cx(tg.l.canvas).drawImage(t, -tg.l.x, -tg.l.y);
    tg.l.ver++;
    d.endPaint('Stroke', ps, { x: -tg.l.x, y: -tg.l.y, w, h: hh });
  });
}

async function exportDialog() {
  const d = doc();
  const v = { name: d.name, type: 'png', quality: 92, scale: 100 };
  const ok = await dialog('Export As', form([{ k: 'name', label: 'File name', type: 'text' }, S('type', 'Format', [['png', 'PNG'], ['jpg', 'JPEG'], ['webp', 'WebP'], ['pdf', 'PDF (print)']], 'png'), R('quality', 'Quality (JPEG, WebP, PDF)', 10, 100, 92), R('scale', 'Scale %', 5, 200, 100)], v, () => {}), [['Export', true], ['Cancel', null]], { width: 360 });
  if (ok) await exportImage(d, v);
}

async function closeDoc(d) {
  if (!d) return;
  if (app.modal) endModal(false);
  if (d.dirty) {
    const r = await dialog('Close', h('div.note', { text: 'Save changes to "' + d.name + '" before closing?' }), [['Save Project', 'save'], ["Don't Save", 'no'], ['Cancel', null]], { width: 360 });
    if (!r) return;
    if (r === 'save') await saveProject(d);
  }
  removeDoc(d);
}

function mergeLayers(d, list, name) {
  const c = mk(d.w, d.h);
  const g = cx(c);
  render({ w: d.w, h: d.h, layers: list }, g, 1, 0, 0);
  const b = bounds(c);
  const out = new Layer({ name });
  if (b) {
    const t = mk(b.w, b.h);
    cx(t).drawImage(c, -b.x, -b.y);
    out.canvas = t;
    out.x = b.x;
    out.y = b.y;
  }
  return out;
}

function align(kind) {
  const d = doc();
  const l = d && d.al;
  if (!l || l.lock) return;
  const b = contentBox(l);
  if (!b) return;
  const r = d.sel ? d.sel.b : { x: 0, y: 0, w: d.w, h: d.h };
  let dx = 0;
  let dy = 0;
  if (kind === 'left') dx = r.x - (l.x + b.x);
  else if (kind === 'hcenter') dx = r.x + r.w / 2 - (l.x + b.x + b.w / 2);
  else if (kind === 'right') dx = r.x + r.w - (l.x + b.x + b.w);
  else if (kind === 'top') dy = r.y - (l.y + b.y);
  else if (kind === 'vcenter') dy = r.y + r.h / 2 - (l.y + b.y + b.h / 2);
  else dy = r.y + r.h - (l.y + b.y + b.h);
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (!dx && !dy) return;
  d.act('Align', () => {
    l.x += dx;
    l.y += dy;
    if (l.mask) l.mask = { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy };
    if (l.text) {
      l.text.x += dx;
      l.text.y += dy;
    }
  });
}
async function newGuide() {
  const d = doc();
  const v = { dir: 'v', pos: Math.round(d.w / 2) };
  const ok = await dialog('New Guide', form([S('dir', 'Orientation', [['v', 'Vertical'], ['h', 'Horizontal']], 'v'), { k: 'pos', label: 'Position (px)', type: 'text' }], v, () => {}), undefined, { width: 320 });
  if (!ok) return;
  const pos = parseFloat(v.pos);
  if (Number.isNaN(pos)) return;
  d.guides.push({ v: v.dir === 'v', pos });
  invalidate();
}
async function marginGuides() {
  const d = doc();
  const n = await ask('Margin Guides', 'Margin (px)', Math.round(d.dpi * 0.5), 0, Math.round(Math.min(d.w, d.h) / 2));
  if (n == null) return;
  d.guides.push({ v: true, pos: n }, { v: true, pos: d.w - n }, { v: false, pos: n }, { v: false, pos: d.h - n });
  invalidate();
  toast('Guides added ' + (n / d.dpi).toFixed(2) + ' in from each edge.');
}

const SHORTCUTS = [
  ['Tools', 'V Move · M Marquee · L Lasso · W Magic Wand · C Crop · I Eyedropper · J Spot Healing · B Brush · S Clone Stamp · E Eraser · G Gradient / Paint Bucket · O Dodge / Burn · T Type · U Shapes · H Hand · Z Zoom'],
  ['Painting', '[ and ] change brush size · Shift+[ and Shift+] change hardness · number keys set opacity · Alt-click samples a color · Shift-click draws a straight line · X swaps colors · D resets them'],
  ['Selections', 'Shift adds · Alt subtracts · Ctrl+A All · Ctrl+D Deselect · Shift+Ctrl+I Inverse · Shift+F6 Feather · Delete clears · Alt+Backspace fills with the foreground color · Ctrl+Backspace with the background color'],
  ['Layers', 'Ctrl+J Layer Via Copy · Shift+Ctrl+N New Layer · Ctrl+E Merge Down · Shift+Ctrl+E Merge Visible · Alt+Ctrl+G Clipping Mask · Ctrl+[ and Ctrl+] move a layer down or up'],
  ['Editing', 'Ctrl+Z Undo · Shift+Ctrl+Z Redo · Ctrl+T Free Transform (Alt+Ctrl+T in browsers that keep Ctrl+T) · Enter commits · Esc cancels · Ctrl+L Levels · Ctrl+M Curves · Ctrl+U Hue/Saturation · Ctrl+I Invert'],
  ['View', 'Space-drag pans · Ctrl+scroll zooms · Ctrl+0 Fit · Ctrl+1 100% · Ctrl++ and Ctrl+- zoom · F full screen · Tab hides panels'],
  ['Files', 'Ctrl+O Open · Ctrl+S Save Project · Alt+Shift+Ctrl+S Export As · Ctrl+P Print · drop or paste images to add them as layers']
];

const CMD = {
  new: newDialog,
  newPreset: (p) => newDoc({ w: p.w, h: p.h, dpi: p.dpi }),
  open: async () => openFiles(await pickFiles('image/*,.picproj,.umber,.psd,.zip', true), false),
  place: async () => openFiles(await pickFiles('image/*', true), true),
  save: () => doc() && saveProject(doc()),
  exportAs: () => doc() && exportDialog(),
  quickPng: () => doc() && exportImage(doc(), { type: 'png' }),
  quickJpg: () => doc() && exportImage(doc(), { type: 'jpg', quality: 92 }),
  exportPdf: () => doc() && exportImage(doc(), { type: 'pdf', quality: 95 }),
  exportPsd: () => doc() && exportPsd(doc()).catch((e) => toast(e.message)),
  print: () => doc() && printDoc(doc()),
  close: (d) => closeDoc(d || doc()),
  activate: (d) => activate(d),
  undo: () => {
    if (app.modal) endModal(false);
    else if (doc()) doc().undo();
    emit('layers');
  },
  redo: () => {
    if (doc()) doc().redo();
    emit('layers');
  },
  cut: () => {
    if (doc() && doc().sel && doCopy(false)) clearSel('Cut');
  },
  copy: () => doc() && doCopy(false),
  copyMerged: () => doc() && doCopy(true),
  paste: pasteClip,
  clear: () => doc() && clearSel(),
  fill: () => doc() && fillDialog(),
  fillFg: () => doc() && fillWith(app.fg),
  fillBg: () => doc() && fillWith(app.bg),
  stroke: () => doc() && strokeDialog(),
  transform: startTransform,
  flipH: () => layerFlip('h'),
  flipV: () => layerFlip('v'),
  rotCw: () => layerFlip('cw'),
  rotCcw: () => layerFlip('ccw'),
  rot180: () => layerFlip('180'),
  autoContrast: () => doc() && busy('Auto Contrast', () => applyPixels('Auto Contrast', (img) => applyAdjust(img.data, 'levels', autoLevels(img.data)))),
  imageSize: () => doc() && imageSize(),
  canvasSize: () => doc() && canvasSize(),
  canvasCw: () => doc() && (doc().act('Rotate Canvas', () => rotateDoc(doc(), 'cw')), fit(), emit('docs')),
  canvasCcw: () => doc() && (doc().act('Rotate Canvas', () => rotateDoc(doc(), 'ccw')), fit(), emit('docs')),
  canvas180: () => doc() && (doc().act('Rotate Canvas', () => rotateDoc(doc(), '180')), emit('docs')),
  canvasFlipH: () => doc() && (doc().act('Flip Canvas Horizontal', () => rotateDoc(doc(), 'h')), emit('docs')),
  canvasFlipV: () => doc() && (doc().act('Flip Canvas Vertical', () => rotateDoc(doc(), 'v')), emit('docs')),
  cropSel: () => {
    const d = doc();
    if (!d || !d.sel) {
      toast('Make a selection first.');
      return;
    }
    const b = d.sel.b;
    d.act('Crop', () => cropDoc(d, b.x, b.y, b.w, b.h));
    fit();
    emit('docs');
  },
  trim: () => {
    const d = doc();
    if (!d) return;
    const b = bounds(flatten(d));
    if (!b) return;
    d.act('Trim', () => cropDoc(d, b.x, b.y, b.w, b.h));
    fit();
    emit('docs');
  },
  grayscale: () => runAdjust('desaturate'),
  newLayer: () => {
    const d = doc();
    if (!d) return;
    d.act('New Layer', () => d.add(new Layer({ name: d.newName() })));
    emit('layers');
  },
  dupLayer: () => {
    const d = doc();
    const l = d && d.al;
    if (!l) return;
    d.act('Duplicate Layer', () => d.add(new Layer({ ...l, id: null, name: l.name + ' copy', canvas: clone(l.canvas), mask: l.mask ? { ...l.mask, canvas: clone(l.mask.canvas) } : null, text: copyObj(l.text), fx: copyObj(l.fx), adj: copyObj(l.adj) })));
    emit('layers');
  },
  viaCopy: () => {
    const d = doc();
    if (!d) return;
    if (!d.sel) {
      run('dupLayer');
      return;
    }
    const c = copySel(false);
    if (!c) return;
    d.act('Layer Via Copy', () => {
      d.add(new Layer({ name: d.newName(), canvas: c.canvas, x: c.x, y: c.y }));
      setSel(d, null);
    });
    emit('layers');
  },
  viaCut: () => {
    const d = doc();
    if (!d || !d.sel) return;
    const tg = paintTarget(d);
    if (!tg || tg.key !== 'canvas') return;
    const c = copySel(false);
    d.act('Layer Via Cut', () => {
      const l = tg.l;
      cover(d, l);
      const n = clone(l.canvas);
      const g = cx(n);
      g.globalCompositeOperation = 'destination-out';
      g.drawImage(d.sel.c, -l.x, -l.y);
      l.canvas = n;
      l.ver++;
      d.add(new Layer({ name: d.newName(), canvas: c.canvas, x: c.x, y: c.y }));
      setSel(d, null);
    });
    emit('layers');
  },
  delLayer: () => {
    const d = doc();
    const l = d && d.al;
    if (!l) return;
    if (d.layers.length < 2) {
      toast('A document needs at least one layer.');
      return;
    }
    d.act('Delete Layer', () => {
      const i = d.layers.indexOf(l);
      d.layers.splice(i, 1);
      d.active = d.layers[Math.max(0, i - 1)].id;
      d.target = 'layer';
    });
    emit('layers');
  },
  rename: async (l) => {
    const d = doc();
    l = l && l.id ? l : d && d.al;
    if (!l) return;
    const v = { name: l.name };
    const ok = await dialog('Rename Layer', form([{ k: 'name', label: 'Name', type: 'text' }], v, () => {}), undefined, { width: 320 });
    if (ok && v.name) d.act('Rename Layer', () => { l.name = v.name; });
    emit('layers');
  },
  layerProp: (p) => {
    const d = doc();
    const l = d && d.al;
    if (!l) return;
    const name = p.blend ? 'Blending Change' : p.opacity != null ? 'Opacity Change' : 'Lock Layer';
    d.act(name, () => Object.assign(l, p));
    emit('layers');
  },
  layerVis: (l) => {
    const d = doc();
    d.act(l.visible ? 'Hide Layer' : 'Show Layer', () => { l.visible = !l.visible; });
    emit('layers');
  },
  layerDbl: (l) => {
    const d = doc();
    if (l.type === 'text') {
      setTool('text');
      editText(d, l, false);
    } else if (l.type === 'adjust') editAdj(l);
    else layerStyle();
  },
  layerStyle,
  reorder: ({ layer, target, above }) => {
    const d = doc();
    d.act('Layer Order', () => {
      d.layers.splice(d.layers.indexOf(layer), 1);
      const i = d.layers.indexOf(target);
      d.layers.splice(above ? i + 1 : i, 0, layer);
    });
    emit('layers');
  },
  arrange: (dir) => {
    const d = doc();
    const l = d && d.al;
    if (!l) return;
    const i = d.layers.indexOf(l);
    const n = d.layers.length - 1;
    const j = dir === 'front' ? n : dir === 'back' ? 0 : clamp(i + (dir === 'up' ? 1 : -1), 0, n);
    if (j === i) return;
    d.act('Layer Order', () => {
      d.layers.splice(i, 1);
      d.layers.splice(j, 0, l);
    });
    emit('layers');
  },
  addMask: () => {
    const d = doc();
    const l = d && d.al;
    if (!l) return;
    if (l.mask) {
      d.target = 'mask';
      emit('layers');
      return;
    }
    d.act('Add Layer Mask', () => {
      newMask(d, l, !!d.sel, false);
      if (d.sel) setSel(d, null);
      d.target = 'mask';
    });
    emit('layers');
    toast('Mask added. Paint with black to hide and white to reveal.');
  },
  maskHide: () => {
    const d = doc();
    const l = d && d.al;
    if (!l || l.mask) return;
    d.act('Add Layer Mask', () => {
      newMask(d, l, !!d.sel, true);
      if (d.sel) setSel(d, null);
      d.target = 'mask';
    });
    emit('layers');
  },
  maskToggle: (l) => {
    const d = doc();
    l = l && l.id ? l : d && d.al;
    if (!l || !l.mask) return;
    d.act(l.mask.on ? 'Disable Layer Mask' : 'Enable Layer Mask', () => {
      l.mask = { ...l.mask, on: !l.mask.on };
      l.ver++;
    });
    emit('layers');
  },
  delMask: () => {
    const d = doc();
    const l = d && d.al;
    if (!l || !l.mask) return;
    d.act('Delete Layer Mask', () => {
      l.mask = null;
      d.target = 'layer';
      l.ver++;
    });
    emit('layers');
  },
  applyMask: () => {
    const d = doc();
    const l = d && d.al;
    if (!l || !l.mask || l.type !== 'raster') return;
    d.act('Apply Layer Mask', () => {
      const c = clone(l.canvas);
      const g = cx(c);
      g.globalCompositeOperation = 'destination-in';
      g.drawImage(l.mask.canvas, l.mask.x - l.x, l.mask.y - l.y);
      l.canvas = c;
      l.mask = null;
      d.target = 'layer';
      l.ver++;
    });
    emit('layers');
  },
  clipToggle: () => {
    const d = doc();
    const l = d && d.al;
    if (!l || d.layers.indexOf(l) === 0) return;
    d.act(l.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', () => { l.clip = !l.clip; });
    emit('layers');
  },
  rasterize: () => {
    const d = doc();
    const l = d && d.al;
    if (!l || l.type !== 'text') return;
    d.act('Rasterize Type', () => {
      l.type = 'raster';
      l.text = null;
    });
    emit('layers');
  },
  mergeDown: () => {
    const d = doc();
    const l = d && d.al;
    const i = d ? d.layers.indexOf(l) : -1;
    if (i < 1) return;
    const below = d.layers[i - 1];
    d.act('Merge Down', () => {
      const m = mergeLayers(d, [below, l].map((x) => Object.assign(Object.create(Object.getPrototypeOf(x)), x, { visible: true, clip: false })), below.name);
      d.layers.splice(i - 1, 2, m);
      d.active = m.id;
      d.target = 'layer';
    });
    emit('layers');
  },
  mergeVisible: () => {
    const d = doc();
    if (!d) return;
    const vis = d.layers.filter((l) => l.visible);
    if (vis.length < 2) return;
    d.act('Merge Visible', () => {
      const m = mergeLayers(d, vis, vis[0].name);
      const i = d.layers.indexOf(vis[0]);
      d.layers = d.layers.filter((l) => !l.visible);
      d.layers.splice(Math.min(i, d.layers.length), 0, m);
      d.active = m.id;
      d.target = 'layer';
    });
    emit('layers');
  },
  flatten: () => {
    const d = doc();
    if (!d) return;
    d.act('Flatten Image', () => {
      const c = mk(d.w, d.h);
      const g = cx(c);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, d.w, d.h);
      g.drawImage(flatten(d), 0, 0);
      const l = new Layer({ name: 'Background', canvas: c });
      d.layers = [l];
      d.active = l.id;
      d.target = 'layer';
    });
    emit('layers');
  },
  selAll: () => {
    const d = doc();
    if (!d) return;
    d.act('Select All', () => {
      const c = mk(d.w, d.h);
      const g = cx(c);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, d.w, d.h);
      setSel(d, c);
    });
  },
  deselect: () => {
    const d = doc();
    if (d && d.sel) d.act('Deselect', () => setSel(d, null));
  },
  inverse: () => {
    const d = doc();
    if (d && d.sel) d.act('Select Inverse', () => selInvert(d));
  },
  feather: async () => {
    const d = doc();
    if (!d || !d.sel) return toast('Make a selection first.');
    const n = await ask('Feather Selection', 'Feather Radius (px)', 5, 0.2, 250);
    if (n) d.act('Feather', () => selFeather(d, n));
    return null;
  },
  expand: async () => {
    const d = doc();
    if (!d || !d.sel) return toast('Make a selection first.');
    const n = await ask('Expand Selection', 'Expand By (px)', 4, 1, 500);
    if (n) await busy('Expand', () => d.act('Expand', () => selGrow(d, n)));
    return null;
  },
  contract: async () => {
    const d = doc();
    if (!d || !d.sel) return toast('Make a selection first.');
    const n = await ask('Contract Selection', 'Contract By (px)', 4, 1, 500);
    if (n) await busy('Contract', () => d.act('Contract', () => selGrow(d, -n)));
    return null;
  },
  selLayer: () => {
    const d = doc();
    const l = d && d.al;
    if (!l || l.type === 'adjust') return;
    d.act('Load Selection', () => {
      const c = mk(d.w, d.h);
      const g = cx(c);
      g.drawImage(l.canvas, l.x, l.y);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = '#fff';
      g.fillRect(0, 0, d.w, d.h);
      setSel(d, c);
    });
  },
  lastFilter: () => {
    const f = app.lastFilter && FILTERS.find((x) => x.id === app.lastFilter.id);
    if (f) runFilter(f, true);
  },
  zoomIn: () => zoomStep(1),
  zoomOut: () => zoomStep(-1),
  fit,
  actual: () => setZoom(1),
  fullscreen: () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  },
  panels: () => document.body.classList.toggle('nopanels'),
  align,
  newGuide: () => doc() && newGuide(),
  marginGuides: () => doc() && marginGuides(),
  centerGuides: () => {
    const d = doc();
    if (!d) return;
    d.guides.push({ v: true, pos: d.w / 2 }, { v: false, pos: d.h / 2 });
    invalidate();
  },
  clearGuides: () => {
    if (!doc()) return;
    doc().guides = [];
    invalidate();
  },
  swap: () => {
    [app.fg, app.bg] = [app.bg, app.fg];
    emit('color');
  },
  defaultColors: () => {
    app.fg = { r: 0, g: 0, b: 0 };
    app.bg = { r: 255, g: 255, b: 255 };
    emit('color');
  },
  shortcuts: () => dialog('Keyboard Shortcuts', h('div.help', null, SHORTCUTS.map(([t, s]) => h('div.hsec', null, h('b', { text: t }), h('p', { text: isMac ? s.replace(/Ctrl/g, 'Cmd').replace(/Alt/g, 'Option') : s })))), [['Close', true]], { width: 560 }),
  about: () => dialog('About Picture Market', h('div.help', null,
    h('p', { text: 'Picture Market is a layered photo editor that runs entirely in your browser. Nothing you open is uploaded anywhere.' }),
    h('p', { text: 'Save Project keeps your layers in a .picproj file you can reopen here. Export makes PNG, JPEG, WebP, PDF or PSD files, with the document resolution written into PNG, JPEG and PDF for printing.' }),
    h('p', { text: 'Colors are RGB, 8 bits per channel.' })), [['Close', true]], { width: 420 })
};

export function run(name, arg) {
  const fn = CMD[name];
  if (!fn) return undefined;
  try {
    const r = fn(arg);
    if (r && r.catch) r.catch((e) => {
      console.error(e);
      toast('Something went wrong: ' + (e.message || e));
    });
    return r;
  } catch (e) {
    console.error(e);
    toast('Something went wrong: ' + (e.message || e));
    return undefined;
  }
}

const has = () => !!doc();
const hasSel = () => !!(doc() && doc().sel);
const I = (label, cmd, key, on) => ({ label, cmd, key, on: on || has });
const adjItems = (layer) => Object.keys(ADJ).filter((k) => !layer || !['desaturate'].includes(k)).map((k) => ({ label: ADJ[k].name + (ADJ[k].p.length ? '…' : ''), key: layer ? '' : ADJ[k].key, on: has, run: () => (layer ? adjLayer(k) : runAdjust(k)) }));
const filterItems = () => {
  const groups = [];
  for (const f of FILTERS) {
    let g = groups.find((x) => x.label === f.group);
    if (!g) groups.push(g = { label: f.group, sub: [] });
    g.sub.push({ label: f.name + (f.p.length ? '…' : ''), on: has, run: () => runFilter(f) });
  }
  return groups;
};

export const MENUS = [
  { id: 'file', label: 'File', items: () => [
    { label: 'New…', cmd: 'new', key: 'Alt+Ctrl+N' }, { label: 'Open…', cmd: 'open', key: 'Ctrl+O' }, I('Place Image as Layer…', 'place'), '-',
    I('Save Project', 'save', 'Ctrl+S'), '-',
    I('Export As…', 'exportAs', 'Alt+Shift+Ctrl+S'), I('Quick Export as PNG', 'quickPng'), I('Quick Export as JPEG', 'quickJpg'), I('Export as PDF', 'exportPdf'), I('Export as PSD', 'exportPsd'), '-',
    I('Print…', 'print', 'Ctrl+P'), '-', I('Close', 'close', 'Alt+Ctrl+W')
  ] },
  { id: 'edit', label: 'Edit', items: () => [
    I('Undo', 'undo', 'Ctrl+Z', () => !!(doc() && (doc().hi >= 0 || app.modal))), I('Redo', 'redo', 'Shift+Ctrl+Z', () => !!(doc() && doc().hi < doc().hist.length - 1)), '-',
    I('Cut', 'cut', 'Ctrl+X', hasSel), I('Copy', 'copy', 'Ctrl+C'), I('Copy Merged', 'copyMerged', 'Shift+Ctrl+C'), { label: 'Paste', cmd: 'paste', key: 'Ctrl+V', on: () => !!app.clip }, I('Clear', 'clear', 'Delete'), '-',
    I('Fill…', 'fill', 'Shift+F5'), I('Stroke…', 'stroke', '', hasSel), '-',
    I('Free Transform', 'transform', 'Ctrl+T'),
    { label: 'Transform', sub: [I('Flip Horizontal', 'flipH'), I('Flip Vertical', 'flipV'), '-', I('Rotate 180°', 'rot180'), I('Rotate 90° Clockwise', 'rotCw'), I('Rotate 90° Counter Clockwise', 'rotCcw')] }
  ] },
  { id: 'image', label: 'Image', items: () => [
    { label: 'Adjustments', sub: adjItems(false) }, I('Auto Contrast', 'autoContrast', 'Alt+Shift+Ctrl+L'), '-',
    I('Image Size…', 'imageSize', 'Alt+Ctrl+I'), I('Canvas Size…', 'canvasSize', 'Alt+Ctrl+C'),
    { label: 'Image Rotation', sub: [I('180°', 'canvas180'), I('90° Clockwise', 'canvasCw'), I('90° Counter Clockwise', 'canvasCcw'), '-', I('Flip Canvas Horizontal', 'canvasFlipH'), I('Flip Canvas Vertical', 'canvasFlipV')] },
    I('Crop', 'cropSel', '', hasSel), I('Trim', 'trim')
  ] },
  { id: 'layer', label: 'Layer', adjustItems: () => adjItems(true), items: () => {
    const l = doc() && doc().al;
    return [
      I('New Layer', 'newLayer', 'Shift+Ctrl+N'), I('Layer Via Copy', 'viaCopy', 'Ctrl+J'), I('Layer Via Cut', 'viaCut', 'Shift+Ctrl+J', hasSel), I('Duplicate Layer', 'dupLayer'), I('Delete Layer', 'delLayer'), I('Rename Layer…', 'rename'), '-',
      I('Layer Style…', 'layerStyle'), { label: 'New Adjustment Layer', sub: adjItems(true) }, '-',
      { label: 'Layer Mask', sub: [I('Reveal All', 'addMask', '', () => !!l && !l.mask), I('Hide All', 'maskHide', '', () => !!l && !l.mask), '-', I(l && l.mask && !l.mask.on ? 'Enable' : 'Disable', 'maskToggle', '', () => !!(l && l.mask)), I('Apply', 'applyMask', '', () => !!(l && l.mask)), I('Delete', 'delMask', '', () => !!(l && l.mask))] },
      I(l && l.clip ? 'Release Clipping Mask' : 'Create Clipping Mask', 'clipToggle', 'Alt+Ctrl+G'), I('Rasterize Type', 'rasterize', '', () => !!(l && l.type === 'text')), '-',
      { label: 'Arrange', sub: [{ label: 'Bring to Front', key: 'Shift+Ctrl+]', on: has, run: () => run('arrange', 'front') }, { label: 'Bring Forward', key: 'Ctrl+]', on: has, run: () => run('arrange', 'up') }, { label: 'Send Backward', key: 'Ctrl+[', on: has, run: () => run('arrange', 'down') }, { label: 'Send to Back', key: 'Shift+Ctrl+[', on: has, run: () => run('arrange', 'back') }] }, '-',
      { label: 'Align', sub: [['Left Edges', 'left'], ['Horizontal Centers', 'hcenter'], ['Right Edges', 'right'], null, ['Top Edges', 'top'], ['Vertical Centers', 'vcenter'], ['Bottom Edges', 'bottom']].map((a) => (a ? { label: a[0], on: has, run: () => run('align', a[1]) } : '-')) }, '-',
      I('Merge Down', 'mergeDown', 'Ctrl+E'), I('Merge Visible', 'mergeVisible', 'Shift+Ctrl+E'), I('Flatten Image', 'flatten')
    ];
  } },
  { id: 'select', label: 'Select', items: () => [
    I('All', 'selAll', 'Ctrl+A'), I('Deselect', 'deselect', 'Ctrl+D', hasSel), I('Inverse', 'inverse', 'Shift+Ctrl+I', hasSel), '-',
    I('Feather…', 'feather', 'Shift+F6', hasSel), I('Expand…', 'expand', '', hasSel), I('Contract…', 'contract', '', hasSel), '-', I('Load Selection from Layer', 'selLayer')
  ] },
  { id: 'filter', label: 'Filter', items: () => [{ label: 'Last Filter', cmd: 'lastFilter', key: 'Alt+Ctrl+F', on: () => !!(doc() && app.lastFilter) }, '-', ...filterItems()] },
  { id: 'view', label: 'View', items: () => [
    I('Zoom In', 'zoomIn', 'Ctrl+='), I('Zoom Out', 'zoomOut', 'Ctrl+-'), I('Fit on Screen', 'fit', 'Ctrl+0'), I('100%', 'actual', 'Ctrl+1'), '-',
    I('New Guide…', 'newGuide'), I('Center Guides', 'centerGuides'), I('Margin Guides…', 'marginGuides'), I('Clear Guides', 'clearGuides'), '-',
    { label: 'Full Screen', cmd: 'fullscreen', key: 'F' }, { label: 'Show/Hide Panels', cmd: 'panels', key: 'Tab' }
  ] },
  { id: 'help', label: 'Help', items: () => [{ label: 'Keyboard Shortcuts…', cmd: 'shortcuts' }, { label: 'About Picture Market…', cmd: 'about' }] }
];

export const KEYS = {
  'Alt+Ctrl+N': 'new', 'Ctrl+N': 'new', 'Ctrl+O': 'open', 'Ctrl+S': 'save', 'Alt+Shift+Ctrl+S': 'exportAs', 'Ctrl+P': 'print', 'Alt+Ctrl+W': 'close',
  'Ctrl+Z': 'undo', 'Shift+Ctrl+Z': 'redo', 'Ctrl+Y': 'redo', 'Ctrl+X': 'cut', 'Ctrl+C': 'copy', 'Shift+Ctrl+C': 'copyMerged',
  Delete: 'clear', Backspace: 'clear', 'Shift+F5': 'fill', 'Alt+Backspace': 'fillFg', 'Alt+Delete': 'fillFg', 'Ctrl+Backspace': 'fillBg', 'Ctrl+Delete': 'fillBg',
  'Ctrl+T': 'transform', 'Alt+Ctrl+T': 'transform', 'Alt+Shift+Ctrl+L': 'autoContrast', 'Alt+Ctrl+I': 'imageSize', 'Alt+Ctrl+C': 'canvasSize',
  'Shift+Ctrl+N': 'newLayer', 'Ctrl+J': 'viaCopy', 'Shift+Ctrl+J': 'viaCut', 'Alt+Ctrl+G': 'clipToggle', 'Ctrl+E': 'mergeDown', 'Shift+Ctrl+E': 'mergeVisible',
  'Ctrl+A': 'selAll', 'Ctrl+D': 'deselect', 'Shift+Ctrl+I': 'inverse', 'Shift+F6': 'feather', 'Alt+Ctrl+F': 'lastFilter',
  'Ctrl+=': 'zoomIn', 'Shift+Ctrl+=': 'zoomIn', 'Ctrl+-': 'zoomOut', 'Ctrl+0': 'fit', 'Ctrl+1': 'actual', F: 'fullscreen', Tab: 'panels', X: 'swap', D: 'defaultColors'
};
export const KEYFN = {
  'Ctrl+]': () => run('arrange', 'up'), 'Ctrl+[': () => run('arrange', 'down'), 'Shift+Ctrl+]': () => run('arrange', 'front'), 'Shift+Ctrl+[': () => run('arrange', 'back'),
  'Ctrl+L': () => runAdjust('levels'), 'Ctrl+M': () => runAdjust('curves'), 'Ctrl+U': () => runAdjust('hue'), 'Ctrl+B': () => runAdjust('balance'), 'Ctrl+I': () => runAdjust('invert'), 'Shift+Ctrl+U': () => runAdjust('desaturate')
};
export { TOOLS, view, invalidate, addDoc };
