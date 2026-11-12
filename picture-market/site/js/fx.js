import { mk, cx, clamp, rgb2hsl, hsl2rgb } from './util.js';

const R = (k, label, min, max, v, step = 1) => ({ k, label, min, max, v, step, type: 'range' });
const C = (k, label, v = false) => ({ k, label, v, type: 'check' });
const COL = (k, label, v) => ({ k, label, v, type: 'color' });
const S = (k, label, options, v) => ({ k, label, options, v, type: 'select' });

export const ADJ = {
  brightness: { name: 'Brightness/Contrast', p: [R('brightness', 'Brightness', -150, 150, 0), R('contrast', 'Contrast', -100, 100, 0)] },
  levels: { name: 'Levels', key: 'Ctrl+L', p: [R('black', 'Shadows', 0, 253, 0), R('gamma', 'Midtones', 0.1, 9.99, 1, 0.01), R('white', 'Highlights', 2, 255, 255), R('outBlack', 'Output Black', 0, 255, 0), R('outWhite', 'Output White', 0, 255, 255)] },
  curves: { name: 'Curves', key: 'Ctrl+M', p: [R('shadows', 'Shadows', -100, 100, 0), R('darks', 'Darks', -100, 100, 0), R('mids', 'Midtones', -100, 100, 0), R('lights', 'Lights', -100, 100, 0), R('highlights', 'Highlights', -100, 100, 0)] },
  exposure: { name: 'Exposure', p: [R('exposure', 'Exposure', -5, 5, 0, 0.01), R('offset', 'Offset', -0.5, 0.5, 0, 0.001), R('gamma', 'Gamma Correction', 0.1, 5, 1, 0.01)] },
  vibrance: { name: 'Vibrance', p: [R('vibrance', 'Vibrance', -100, 100, 0), R('saturation', 'Saturation', -100, 100, 0)] },
  hue: { name: 'Hue/Saturation', key: 'Ctrl+U', p: [R('hue', 'Hue', -180, 180, 0), R('saturation', 'Saturation', -100, 100, 0), R('lightness', 'Lightness', -100, 100, 0), C('colorize', 'Colorize')] },
  balance: { name: 'Color Balance', key: 'Ctrl+B', p: [R('cr', 'Cyan / Red', -100, 100, 0), R('mg', 'Magenta / Green', -100, 100, 0), R('yb', 'Yellow / Blue', -100, 100, 0)] },
  temperature: { name: 'Temperature & Tint', p: [R('temp', 'Temperature', -100, 100, 0), R('tint', 'Tint', -100, 100, 0)] },
  bw: { name: 'Black & White', p: [R('r', 'Reds', -200, 300, 40), R('y', 'Yellows', -200, 300, 60), R('g', 'Greens', -200, 300, 40), R('c', 'Cyans', -200, 300, 60), R('b', 'Blues', -200, 300, 20), R('m', 'Magentas', -200, 300, 80)] },
  photo: { name: 'Photo Filter', p: [COL('color', 'Color', { r: 236, g: 138, b: 0 }), R('density', 'Density', 1, 100, 25)] },
  shadows: { name: 'Shadows/Highlights', p: [R('shadows', 'Shadows', 0, 100, 35), R('highlights', 'Highlights', 0, 100, 0)] },
  invert: { name: 'Invert', key: 'Ctrl+I', p: [] },
  posterize: { name: 'Posterize', p: [R('levels', 'Levels', 2, 64, 4)] },
  threshold: { name: 'Threshold', p: [R('level', 'Threshold Level', 1, 255, 128)] },
  desaturate: { name: 'Desaturate', key: 'Shift+Ctrl+U', p: [] }
};

export function defaults(spec) {
  const o = {};
  for (const s of spec) o[s.k] = typeof s.v === 'object' ? { ...s.v } : s.v;
  return o;
}

function lut(fn) {
  const t = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) t[i] = fn(i);
  return t;
}
function applyLut(d, t, tg, tb) {
  const g = tg || t;
  const b = tb || t;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = t[d[i]];
    d[i + 1] = g[d[i + 1]];
    d[i + 2] = b[d[i + 2]];
  }
}
function spline(xs, ys) {
  const n = xs.length;
  const m = new Array(n).fill(0);
  const dl = [];
  for (let i = 0; i < n - 1; i++) dl.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = dl[0];
  m[n - 1] = dl[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2;
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i];
    const t = clamp((x - xs[i]) / hh, 0, 1);
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
  };
}

export function applyAdjust(d, kind, p) {
  const n = d.length;
  if (kind === 'brightness') {
    const c = p.contrast * 2.55;
    const f = (259 * (c + 255)) / (255 * (259 - c));
    applyLut(d, lut((v) => f * (v + p.brightness - 128) + 128));
  } else if (kind === 'levels') {
    const range = Math.max(1, p.white - p.black);
    applyLut(d, lut((v) => Math.pow(clamp((v - p.black) / range, 0, 1), 1 / p.gamma) * (p.outWhite - p.outBlack) + p.outBlack));
  } else if (kind === 'curves') {
    const f = spline([0, 32, 80, 128, 176, 224, 255], [0, 32 + p.shadows * 0.3, 80 + p.darks * 0.5, 128 + p.mids * 0.6, 176 + p.lights * 0.5, 224 + p.highlights * 0.3, 255]);
    applyLut(d, lut(f));
  } else if (kind === 'exposure') {
    const mul = Math.pow(2, p.exposure);
    applyLut(d, lut((v) => 255 * Math.pow(Math.pow(clamp(Math.pow(v / 255, 2.2) * mul + p.offset, 0, 1), 1 / p.gamma), 1 / 2.2)));
  } else if (kind === 'vibrance') {
    const vib = p.vibrance / 100;
    const sat = 1 + p.saturation / 100;
    for (let i = 0; i < n; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const gray = (r + g + b) / 3;
      const k = (1 + vib * (1 - (mx - mn) / 255)) * sat;
      d[i] = gray + (r - gray) * k;
      d[i + 1] = gray + (g - gray) * k;
      d[i + 2] = gray + (b - gray) * k;
    }
  } else if (kind === 'hue') {
    const ds = p.saturation / 100;
    const dl = p.lightness / 100;
    for (let i = 0; i < n; i += 4) {
      let [hh, s, l] = rgb2hsl(d[i], d[i + 1], d[i + 2]);
      if (p.colorize) {
        hh = (p.hue + 360) % 360;
        s = clamp(0.25 + ds * 0.75 + (ds > 0 ? 0 : 0), 0, 1);
      } else {
        hh = (hh + p.hue + 360) % 360;
        s = clamp(ds < 0 ? s * (1 + ds) : s + (1 - s) * ds * (s > 0 ? 1 : 0), 0, 1);
      }
      l = dl < 0 ? l * (1 + dl) : l + (1 - l) * dl;
      const c = hsl2rgb(hh, s, l);
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
  } else if (kind === 'balance') {
    const w = (v) => Math.sin((Math.PI * v) / 255);
    applyLut(d, lut((v) => v + p.cr * 0.8 * w(v)), lut((v) => v + p.mg * 0.8 * w(v)), lut((v) => v + p.yb * 0.8 * w(v)));
  } else if (kind === 'temperature') {
    applyLut(d, lut((v) => v + p.temp * 0.5), lut((v) => v - p.tint * 0.4), lut((v) => v - p.temp * 0.5));
  } else if (kind === 'bw') {
    const wr = p.r / 100, wy = p.y / 100, wg = p.g / 100, wc = p.c / 100, wb = p.b / 100, wm = p.m / 100;
    for (let i = 0; i < n; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const md = r + g + b - mx - mn;
      let prim, sec;
      if (mx === r) { prim = wr; sec = g >= b ? wy : wm; }
      else if (mx === g) { prim = wg; sec = r >= b ? wy : wc; }
      else { prim = wb; sec = r >= g ? wm : wc; }
      const v = mn + (md - mn) * sec + (mx - md) * prim;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else if (kind === 'photo') {
    const k = p.density / 100;
    const cr = p.color.r / 255, cg = p.color.g / 255, cb = p.color.b / 255;
    for (let i = 0; i < n; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const l0 = 0.299 * r + 0.587 * g + 0.114 * b;
      let nr = r * (1 - k) + r * cr * k;
      let ng = g * (1 - k) + g * cg * k;
      let nb = b * (1 - k) + b * cb * k;
      const l1 = 0.299 * nr + 0.587 * ng + 0.114 * nb || 1;
      const f = l0 / l1;
      d[i] = nr * f;
      d[i + 1] = ng * f;
      d[i + 2] = nb * f;
    }
  } else if (kind === 'shadows') {
    const sh = p.shadows / 100;
    const hi = p.highlights / 100;
    for (let i = 0; i < n; i += 4) {
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
      const up = sh * (1 - l) * (1 - l) * 0.9;
      const dn = hi * l * l * 0.7;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c];
        d[i + c] = v + (255 - v) * up - v * dn;
      }
    }
  } else if (kind === 'invert') {
    applyLut(d, lut((v) => 255 - v));
  } else if (kind === 'posterize') {
    const lv = Math.max(2, p.levels);
    applyLut(d, lut((v) => Math.round((Math.floor((v / 256) * lv) / (lv - 1)) * 255)));
  } else if (kind === 'threshold') {
    for (let i = 0; i < n; i += 4) {
      const v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] >= p.level ? 255 : 0;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } else if (kind === 'desaturate') {
    for (let i = 0; i < n; i += 4) {
      const v = (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) / 2;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  }
}

export function autoLevels(d) {
  const hist = new Uint32Array(256);
  let count = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
    count++;
  }
  const cut = count * 0.005;
  let lo = 0, hi = 255, acc = 0;
  while (lo < 254 && (acc += hist[lo]) < cut) lo++;
  acc = 0;
  while (hi > lo + 1 && (acc += hist[hi]) < cut) hi--;
  return { black: lo, gamma: 1, white: hi, outBlack: 0, outWhite: 255 };
}

function premul(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255) continue;
    d[i] = (d[i] * a) / 255;
    d[i + 1] = (d[i + 1] * a) / 255;
    d[i + 2] = (d[i + 2] * a) / 255;
  }
}
function unpremul(d) {
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a === 255 || a === 0) continue;
    d[i] = (d[i] * 255) / a;
    d[i + 1] = (d[i + 1] * 255) / a;
    d[i + 2] = (d[i + 2] * 255) / a;
  }
}
function boxPass(src, dst, w, hh, r, horiz) {
  const len = horiz ? w : hh;
  const lines = horiz ? hh : w;
  const step = horiz ? 4 : w * 4;
  const win = r * 2 + 1;
  for (let line = 0; line < lines; line++) {
    const base = horiz ? line * w * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      const first = src[base + c];
      const last = src[base + (len - 1) * step + c];
      sum = first * (r + 1);
      for (let i = 0; i < r; i++) sum += i < len ? src[base + i * step + c] : last;
      for (let i = 0; i < len; i++) {
        const add = i + r < len ? src[base + (i + r) * step + c] : last;
        sum += add;
        dst[base + i * step + c] = sum / win;
        const sub = i - r >= 0 ? src[base + (i - r) * step + c] : first;
        sum -= sub;
      }
    }
  }
}
export function gaussian(img, sigma) {
  if (sigma < 0.3) return img;
  const d = img.data;
  const w = img.width;
  const hh = img.height;
  premul(d);
  const tmp = new Uint8ClampedArray(d.length);
  const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl--;
  const mIdeal = (12 * sigma * sigma - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  for (let i = 0; i < 3; i++) {
    const r = Math.max(0, ((i < m ? wl : wl + 2) - 1) / 2);
    if (r < 1) continue;
    boxPass(d, tmp, w, hh, r, true);
    boxPass(tmp, d, w, hh, r, false);
  }
  unpremul(d);
  return img;
}

const canFilter = typeof CanvasRenderingContext2D !== 'undefined' && 'filter' in CanvasRenderingContext2D.prototype;
export function blurCanvas(c, r) {
  const n = mk(c.width, c.height);
  const g = cx(n);
  if (canFilter) {
    g.filter = 'blur(' + r + 'px)';
    g.drawImage(c, 0, 0);
    g.filter = 'none';
    return n;
  }
  const img = cx(c).getImageData(0, 0, c.width, c.height);
  gaussian(img, r);
  g.putImageData(img, 0, 0);
  return n;
}

export function chamfer(d, w, hh, inside) {
  const dist = new Float32Array(w * hh);
  const BIG = 1e9;
  for (let i = 0, p = 3; i < dist.length; i++, p += 4) {
    const on = d[p] > 127;
    dist[i] = on !== inside ? 0 : BIG;
  }
  const D = Math.SQRT2;
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, dist[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, dist[i - w] + 1);
        if (x > 0) v = Math.min(v, dist[i - w - 1] + D);
        if (x < w - 1) v = Math.min(v, dist[i - w + 1] + D);
      }
      dist[i] = v;
    }
  }
  for (let y = hh - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = dist[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, dist[i + 1] + 1);
      if (y < hh - 1) {
        v = Math.min(v, dist[i + w] + 1);
        if (x < w - 1) v = Math.min(v, dist[i + w + 1] + D);
        if (x > 0) v = Math.min(v, dist[i + w - 1] + D);
      }
      dist[i] = v;
    }
  }
  return dist;
}

const IN = 255;
const RING = 254;
const CAPS = [1, 1, 0.7, 0.35];
const DIRS = [1, 0, 1, 1, 0, 1, -1, 1, -1, 0, -1, -1, 0, -1, 1, -1];

export function wandSeed(img, x, y, size = 1) {
  const w = img.width;
  const hh = img.height;
  const d = img.data;
  const r = Math.max(0, (size - 1) >> 1);
  const x0 = Math.max(0, x - r);
  const y0 = Math.max(0, y - r);
  const x1 = Math.min(w - 1, x + r);
  const y1 = Math.min(hh - 1, y + r);
  let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const p = (yy * w + xx) * 4;
      const a = d[p + 3];
      sr += d[p] * a;
      sg += d[p + 1] * a;
      sb += d[p + 2] * a;
      sa += a;
      n++;
    }
  }
  if (!sa) return [0, 0, 0, 0];
  return [Math.round(sr / sa), Math.round(sg / sa), Math.round(sb / sa), Math.round(sa / n)];
}

function matcher(seed, tol) {
  const r0 = seed[0], g0 = seed[1], b0 = seed[2], a0 = seed[3];
  return (v) => {
    const a = v >>> 24;
    if (a === 0 && a0 === 0) return true;
    let t = (v & 255) - r0;
    if (t > tol || t < -tol) return false;
    t = ((v >>> 8) & 255) - g0;
    if (t > tol || t < -tol) return false;
    t = ((v >>> 16) & 255) - b0;
    if (t > tol || t < -tol) return false;
    t = a - a0;
    return t <= tol && t >= -tol;
  };
}

function floodFill(st, w, hh, d32, s32, ok, starts, edge) {
  const stack = [];
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  const reach = (j, step, stop) => {
    while (j !== stop && st[j] === 0) {
      const v = d32[j];
      if (v !== s32 && !ok(v)) {
        st[j] = 1;
        edge.push(j);
        break;
      }
      j += step;
    }
    return j;
  };
  const seedRow = (lo, hi) => {
    let from = -1;
    for (let j = lo; j < hi; j++) {
      if (st[j] === 0) {
        const v = d32[j];
        if (v === s32 || ok(v)) {
          st[j] = IN;
          if (from < 0) from = j;
          continue;
        }
        st[j] = 1;
        edge.push(j);
      }
      if (from >= 0) stack.push(from, j);
      from = -1;
    }
    if (from >= 0) stack.push(from, hi);
  };
  for (let k = 0; k < starts.length; k++) seedRow(starts[k], starts[k] + 1);
  while (stack.length) {
    const b = stack.pop();
    const a = stack.pop();
    const y = (a / w) | 0;
    const row = y * w;
    const lo = reach(a - 1, -1, row - 1) + 1;
    const hi = reach(b, 1, row + w);
    st.fill(IN, lo, a);
    st.fill(IN, b, hi);
    if (y > 0) seedRow(lo - w, hi - w);
    if (y < hh - 1) seedRow(lo + w, hi + w);
    if (lo - row < x0) x0 = lo - row;
    if (hi - 1 - row > x1) x1 = hi - 1 - row;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

function scanFill(st, w, hh, d32, s32, ok, edge) {
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < hh; y++) {
    let lo = -1, hi = -1;
    for (let x = 0; x < w; x++, i++) {
      const v = d32[i];
      if (v !== s32 && !ok(v)) continue;
      st[i] = IN;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo < 0) continue;
    if (lo < x0) x0 = lo;
    if (hi > x1) x1 = hi;
    if (y < y0) y0 = y;
    y1 = y;
  }
  if (x1 < 0) return null;
  const mark = (j) => {
    if (st[j] === 0) {
      st[j] = 1;
      edge.push(j);
    }
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0, i = y * w + x0; x <= x1; x++, i++) {
      if (st[i] !== IN) continue;
      if (x > 0) mark(i - 1);
      if (x < w - 1) mark(i + 1);
      if (y > 0) mark(i - w);
      if (y < hh - 1) mark(i + w);
    }
  }
  return [x0, y0, x1, y1];
}

function spread(st, w, hh, src, test, mark, out) {
  for (let k = 0; k < src.length; k++) {
    const i = src[k];
    const x = i % w;
    const y = (i - x) / w;
    const xa = x > 0 ? -1 : 0;
    const xb = x < w - 1 ? 1 : 0;
    const ya = y > 0 ? -1 : 0;
    const yb = y < hh - 1 ? 1 : 0;
    for (let dy = ya; dy <= yb; dy++) {
      for (let dx = xa; dx <= xb; dx++) {
        const j = i + dy * w + dx;
        if (st[j] === test) {
          st[j] = mark;
          out.push(j);
        }
      }
    }
  }
  return out;
}

function matte(img, d32, s32, st, seed, tol, ring, outs) {
  const w = img.width;
  const hh = img.height;
  const d = img.data;
  const r0 = seed[0], g0 = seed[1], b0 = seed[2], a0 = seed[3];
  const fs = a0 / 255;
  const sr = r0 * fs, sg = g0 * fs, sb = b0 * fs;
  const level = tol + 0.5;
  const n = ring.length + outs.length;
  const band = new Int32Array(n);
  const val = new Uint8Array(n);
  const eo = new Float32Array(n * 4);
  const ei = new Float32Array(n * 4);
  const ek = new Uint8Array(n);
  let hit = false;
  let or = 0, og = 0, ob = 0, oa = 0;
  let qr = 0, qg = 0, qb = 0, qa = 0;
  let ir = 0, ig = 0, ib = 0, ia = 0;
  let vr = 0, vg = 0, vb = 0, va = 0, vv = 0, th = 0;
  let nx = 0, ny = 0, outer = false;
  let best = -1, bestU = 0, bestT = 0, bestO = 0, far = -1, farU = 0, farT = 0, farO = 0;
  let near = -1, nearU = 0, nearT = 0, nearO = 0, tight = 0;
  let seen = 0, shelf = -1, rough = 0;
  let cr = 0, cg = 0, cb = 0, ca = 0;

  let noise = 0;
  const load = (j) => {
    const p = j * 4;
    const a = d[p + 3];
    if (a === 255) {
      qr = d[p];
      qg = d[p + 1];
      qb = d[p + 2];
    } else {
      const f = a / 255;
      qr = d[p] * f;
      qg = d[p + 1] * f;
      qb = d[p + 2] * f;
    }
    qa = a;
  };
  const metric = (j) => {
    const p = j * 4;
    const a = d[p + 3];
    if (a === 0 && a0 === 0) return 0;
    return Math.max(Math.abs(d[p] - r0), Math.abs(d[p + 1] - g0), Math.abs(d[p + 2] - b0), Math.abs(a - a0));
  };
  const normal = (x, y) => {
    const xa = Math.max(-3, -x);
    const xb = Math.min(3, w - 1 - x);
    const ya = Math.max(-3, -y);
    const yb = Math.min(3, hh - 1 - y);
    let sx = 0, sy = 0;
    for (let dy = ya; dy <= yb; dy++) {
      const row = (y + dy) * w + x;
      for (let dx = xa; dx <= xb; dx++) {
        if (st[row + dx] >= RING) {
          sx -= dx;
          sy -= dy;
        } else {
          sx += dx;
          sy += dy;
        }
      }
    }
    const len = Math.sqrt(sx * sx + sy * sy);
    if (len < 1) return false;
    nx = sx / len;
    ny = sy / len;
    return true;
  };
  const gap = (pr, pg, pb, pa) => Math.sqrt((qr - pr) * (qr - pr) + (qg - pg) * (qg - pg) + (qb - pb) * (qb - pb) + (qa - pa) * (qa - pa));
  const grain = () => {
    let x0 = w, y0 = hh, x1 = -1, y1 = -1;
    for (let q = 0; q < ring.length; q++) {
      const x = ring[q] % w;
      const y = (ring[q] - x) / w;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    x0 = Math.max(2, x0 + 2);
    y0 = Math.max(2, y0 + 2);
    x1 = Math.min(w - 3, x1 - 2);
    y1 = Math.min(hh - 3, y1 - 2);
    if (x1 < x0 || y1 < y0) return 0;
    const sx = Math.max(1, Math.ceil((x1 - x0 + 1) / 48));
    const sy = Math.max(1, Math.ceil((y1 - y0 + 1) / 48));
    const gaps = [];
    for (let y = y0; y <= y1; y += sy) {
      for (let x = x0; x <= x1; x += sx) {
        const i = y * w + x;
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = -2; dx <= 2; dx++) if (st[i + dy * w + dx] !== IN) ok = false;
        if (!ok) continue;
        load(i);
        const pr = qr, pg = qg, pb = qb, pa = qa;
        load(i + 1);
        gaps.push(gap(pr, pg, pb, pa));
        load(i + w);
        gaps.push(gap(pr, pg, pb, pa));
      }
    }
    if (gaps.length < 16) return 0;
    gaps.sort((a, b) => a - b);
    return gaps[gaps.length >> 1];
  };
  const inside = (x, y) => {
    let pr = 0, pg = 0, pb = 0, pa = 0;
    let tr = 0, tg = 0, tb = 0, ta = 0, cnt = 0;
    let have = false;
    let met = false;
    for (let k = 1; k <= 7; k++) {
      const xx = Math.round(x - nx * k);
      const yy = Math.round(y - ny * k);
      if (xx < 0 || yy < 0 || xx >= w || yy >= hh) break;
      const j = yy * w + xx;
      const s = st[j];
      if (s === RING) met = true;
      if (s !== IN) {
        if (met && s !== RING) break;
        continue;
      }
      met = true;
      load(j);
      const far = have ? gap(pr, pg, pb, pa) : -1;
      ir = have ? (qr + pr) / 2 : qr;
      ig = have ? (qg + pg) / 2 : qg;
      ib = have ? (qb + pb) / 2 : qb;
      ia = have ? (qa + pa) / 2 : qa;
      if (have) rough = far;
      if (have && far <= 3 && noise <= 3) return true;
      have = true;
      cnt++;
      tr += qr;
      tg += qg;
      tb += qb;
      ta += qa;
      pr = qr;
      pg = qg;
      pb = qb;
      pa = qa;
    }
    if (cnt > 2) {
      ir = tr / cnt;
      ig = tg / cnt;
      ib = tb / cnt;
      ia = ta / cnt;
    }
    return have;
  };
  const weigh = (j) => {
    load(j);
    seen++;
    const ur = qr - ir, ug = qg - ig, ub = qb - ib, ua = qa - ia;
    const uu = ur * ur + ug * ug + ub * ub + ua * ua;
    if (uu < 1) return 0;
    const len = Math.sqrt(uu);
    const vu = vr * ur + vg * ug + vb * ub + va * ua;
    const al = vu / uu;
    const off = Math.sqrt(Math.max(0, vv - vu * al));
    const side = off > th ? (off - th) / len : 0;
    const t = outer || al > 0 ? Math.sqrt(al * al + side * side) : side;
    if (uu > farU) {
      farU = uu;
      far = j;
      farT = t;
      farO = off;
    }
    if (uu > bestU && off <= th) {
      bestU = uu;
      best = j;
      bestT = t;
      bestO = off;
    }
    if (uu > nearU && off <= tight) {
      nearU = uu;
      near = j;
      nearT = t;
      nearO = off;
    }
    return len;
  };
  const walk = (x, y) => {
    let prev = -1;
    let run = 0;
    let pr = 0, pg = 0, pb = 0, pa = 0;
    let or = 0, og = 0, ob = 0, oa = 0;
    for (let k = 1; k <= 6; k++) {
      const xx = Math.round(x + nx * k);
      const yy = Math.round(y + ny * k);
      if (xx < 0 || yy < 0 || xx >= w || yy >= hh) return true;
      const j = yy * w + xx;
      if (st[j] >= RING) return true;
      const len = weigh(j);
      const slack = Math.max(3, 0.06 * len, 2.5 * noise);
      if (prev >= 0 && prev - len > slack) return true;
      if (prev >= 0 && len - prev <= slack) {
        run++;
        shelf = len;
        if (run > 2 || k === 6) {
          rough = Math.max(rough, run > 2 ? gap(or, og, ob, oa) : gap(pr, pg, pb, pa));
          return true;
        }
      } else run = 0;
      prev = len;
      or = pr;
      og = pg;
      ob = pb;
      oa = pa;
      pr = qr;
      pg = qg;
      pb = qb;
      pa = qa;
    }
    return false;
  };
  const around = (x, y) => {
    for (let q = 0; q < 16; q += 2) {
      for (let k = 1; k <= 3; k++) {
        const xx = x + DIRS[q] * k;
        const yy = y + DIRS[q + 1] * k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= hh) break;
        const j = yy * w + xx;
        if (st[j] >= RING) break;
        weigh(j);
      }
    }
  };
  const flat = (j, eps) => {
    const x = j % w;
    const y = (j - x) / w;
    if (x < 1 || y < 1 || x > w - 2 || y > hh - 2) return false;
    load(j);
    const pr = qr, pg = qg, pb = qb, pa = qa;
    let miss = 0;
    for (let q = 0; q < 16 && miss < 3; q += 2) {
      const n = j + DIRS[q + 1] * w + DIRS[q];
      if (st[n] >= RING) {
        miss++;
        continue;
      }
      load(n);
      if (gap(pr, pg, pb, pa) > eps) miss++;
    }
    return miss < 3;
  };
  const mixed = (j, fr, fg, fb, fa, eps) => {
    load(j);
    const ar = fr - ir, ag = fg - ig, ab = fb - ib, aa = fa - ia;
    const br = qr - ir, bg = qg - ig, bb = qb - ib, ba = qa - ia;
    const g11 = ar * ar + ag * ag + ab * ab + aa * aa;
    const g22 = br * br + bg * bg + bb * bb + ba * ba;
    const g12 = ar * br + ag * bg + ab * bb + aa * ba;
    const det = g11 * g22 - g12 * g12;
    if (det < 0.02 * g11 * g22 || det <= 0) return 1;
    const b1 = vr * ar + vg * ag + vb * ab + va * aa;
    const b2 = vr * br + vg * bg + vb * bb + va * ba;
    const a1 = (b1 * g22 - b2 * g12) / det;
    const a2 = (b2 * g11 - b1 * g12) / det;
    if (a1 < -0.02 || a2 < -0.02 || a1 + a2 > 1.02) return 1;
    if (Math.sqrt(Math.max(0, vv - a1 * b1 - a2 * b2)) > eps) return 1;
    return clamp(1 - a1 - a2, 0, 1);
  };
  const third = (x, y, eps) => {
    const ka = best;
    const kb = far;
    let cap = 1;
    for (let q = 0; q < 16; q += 2) {
      for (let k = 1; k <= 5; k++) {
        const xx = x + DIRS[q] * k;
        const yy = y + DIRS[q + 1] * k;
        if (xx < 0 || yy < 0 || xx >= w || yy >= hh) break;
        const j = yy * w + xx;
        if (st[j] >= RING) break;
        if (!flat(j, eps)) continue;
        load(j);
        const fr = qr, fg = qg, fb = qb, fa = qa;
        if (gap(cr, cg, cb, ca) <= eps) return 0;
        if (ka >= 0) cap = Math.min(cap, mixed(ka, fr, fg, fb, fa, eps));
        if (kb >= 0 && kb !== ka) cap = Math.min(cap, mixed(kb, fr, fg, fb, fa, eps));
      }
    }
    return cap;
  };
  const settle = () => {
    if (near < 0 || nearU < 0.7 * bestU) return;
    best = near;
    bestU = nearU;
    bestT = nearT;
    bestO = nearO;
  };
  const calm = (o, t) => {
    const x = o % w;
    const y = (o - x) / w;
    load(o);
    or = qr;
    og = qg;
    ob = qb;
    oa = qa;
    if (noise <= 0) return t;
    let tr = 0, tg = 0, tb = 0, ta = 0, cnt = 0;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(hh - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
        const j = yy * w + xx;
        if (st[j] >= RING) continue;
        load(j);
        if (gap(or, og, ob, oa) > 2.5 * noise) continue;
        tr += qr;
        tg += qg;
        tb += qb;
        ta += qa;
        cnt++;
      }
    }
    const ur = tr / cnt - ir, ug = tg / cnt - ig, ub = tb / cnt - ib, ua = ta / cnt - ia;
    const uu = ur * ur + ug * ug + ub * ub + ua * ua;
    if (uu < 1) return t;
    or = tr / cnt;
    og = tg / cnt;
    ob = tb / cnt;
    oa = ta / cnt;
    const vu = vr * ur + vg * ug + vb * ub + va * ua;
    const al = vu / uu;
    const off = Math.sqrt(Math.max(0, vv - vu * al));
    const side = off > th ? (off - th) / Math.sqrt(uu) : 0;
    return outer || al > 0 ? Math.sqrt(al * al + side * side) : side;
  };
  const shaded = (x, y) => {
    const xx = Math.round(x - nx);
    const yy = Math.round(y - ny);
    if (xx < 0 || yy < 0 || xx >= w || yy >= hh) return false;
    const j = yy * w + xx;
    if (st[j] >= RING) return false;
    load(j);
    return gap(ir, ig, ib, ia) > Math.sqrt(vv) + tight;
  };
  const soft = (i, x, y, lvl, aimed) => {
    if (!aimed) return lvl === 0 ? 1 : 0;
    const dp = metric(i);
    if (lvl === 0) {
      const xx = Math.round(x + nx);
      const yy = Math.round(y + ny);
      if (xx < 0 || yy < 0 || xx >= w || yy >= hh) return 1;
      const j = yy * w + xx;
      if (st[j] >= RING) return 1;
      const dq = metric(j);
      return dq > level ? Math.min(1, 0.5 + (level - dp) / (dq - dp)) : 1;
    }
    if (lvl > 1 || dp <= level) return 0;
    const xx = Math.round(x - nx);
    const yy = Math.round(y - ny);
    if (xx < 0 || yy < 0 || xx >= w || yy >= hh) return 0;
    const j = yy * w + xx;
    if (st[j] < RING) return 0;
    const dq = metric(j);
    return Math.max(0, (level - dq) / (dp - dq) - 0.5);
  };
  const solve = (i, lvl) => {
    const x = i % w;
    const y = (i - x) / w;
    outer = lvl > 0;
    if (outer && metric(i) <= tol) return 0;
    rough = 0;
    const aimed = normal(x, y);
    const deep = aimed && inside(x, y);
    if (!deep) {
      ir = sr;
      ig = sg;
      ib = sb;
      ia = a0;
    }
    load(i);
    cr = qr;
    cg = qg;
    cb = qb;
    ca = qa;
    vr = qr - ir;
    vg = qg - ig;
    vb = qb - ib;
    va = qa - ia;
    vv = vr * vr + vg * vg + vb * vb + va * va;
    th = 4 + 0.04 * Math.sqrt(vv);
    tight = Math.min(th, 2 + Math.max(noise, rough));
    near = -1;
    nearU = 0;
    if (lvl > 1 && aimed && shaded(x, y)) return 0;
    best = -1;
    bestU = 0;
    far = -1;
    farU = 0;
    seen = 0;
    shelf = -1;
    const done = aimed ? walk(x, y) : true;
    settle();
    let o = best >= 0 ? best : far;
    let len = o >= 0 ? Math.sqrt(best >= 0 ? bestU : farU) : 0;
    if (done && (!seen || (o >= 0 && (shelf < 0 || Math.abs(len - shelf) > Math.max(3, 0.06 * shelf))))) {
      around(x, y);
      settle();
      o = best >= 0 ? best : far;
      len = o >= 0 ? Math.sqrt(best >= 0 ? bestU : farU) : 0;
    }
    if (o < 0) return outer ? 0 : 1;
    if (!done || metric(o) <= tol || len < 4 * rough + 10) return soft(i, x, y, lvl, aimed);
    const e = Math.min(0.25, Math.max(rough, 1.65 * noise) / len);
    const t = calm(o, best >= 0 ? bestT : farT);
    let c = t <= e ? 1 : t >= 1 - e ? 0 : 1 - t;
    const eps = 2 + Math.max(noise, rough);
    if (outer && c > 0 && (best >= 0 ? bestO : farO) > eps) c = Math.min(c, third(x, y, eps));
    if (outer && c <= 0) return 0;
    hit = true;
    return outer ? Math.min(c, CAPS[lvl]) : deep ? c : Math.max(c, 0.5);
  };
  const lit = new Uint8Array(w * hh);
  const above = (i, lvl) => {
    const x = i % w;
    const y = (i - x) / w;
    const xa = x > 0 ? x - 1 : x;
    const xb = x < w - 1 ? x + 1 : x;
    const yb = y < hh - 1 ? y + 1 : y;
    let m = 0;
    for (let yy = y > 0 ? y - 1 : y; yy <= yb; yy++) {
      for (let j = yy * w + xa; j <= yy * w + xb; j++) if (st[j] === lvl - 1 && lit[j] > m) m = lit[j];
    }
    return m;
  };
  const put = (k, i, lvl) => {
    band[k] = i;
    const cap = lvl > 1 ? above(i, lvl) : 255;
    if (!cap) return;
    hit = false;
    const v = lvl === 0 && d32[i] === s32 ? 255 : Math.min(cap, Math.round(solve(i, lvl) * 255));
    val[k] = v;
    if (lvl > 0) lit[i] = v;
    if (!hit || v === 0 || v === 255) return;
    ek[k] = 1;
    eo[k * 4] = or;
    eo[k * 4 + 1] = og;
    eo[k * 4 + 2] = ob;
    eo[k * 4 + 3] = oa;
    ei[k * 4] = ir;
    ei[k * 4 + 1] = ig;
    ei[k * 4 + 2] = ib;
    ei[k * 4 + 3] = ia;
  };
  noise = grain();
  let k = 0;
  for (let q = 0; q < ring.length; q++) put(k++, ring[q], 0);
  for (let q = 0; q < outs.length; q++) put(k++, outs[q], st[outs[q]]);
  return { band, val, eo, ei, ek };
}

function grow(box, band, val, st, w) {
  let x0 = box[0], y0 = box[1], x1 = box[2], y1 = box[3];
  for (let k = 0; k < band.length; k++) {
    const i = band[k];
    st[i] = val[k];
    if (!val[k]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function wandSelect(img, x, y, o = {}) {
  const w = img.width;
  const hh = img.height;
  const tol = o.tolerance == null ? 32 : o.tolerance;
  const cov = new Uint8Array(w * hh);
  const res = { cov, b: null, seed: null, band: null, est: null };
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (!(sx >= 0 && sy >= 0 && sx < w && sy < hh)) return res;
  const d32 = new Int32Array(img.data.buffer, img.data.byteOffset, w * hh);
  const seed = wandSeed(img, sx, sy, o.sample || 1);
  res.seed = seed;
  const s32 = (seed[3] << 24) | (seed[2] << 16) | (seed[1] << 8) | seed[0];
  const ok = matcher(seed, tol);
  const edge = [];
  const box = o.contiguous === false ? scanFill(cov, w, hh, d32, s32, ok, edge) : floodFill(cov, w, hh, d32, s32, ok, starts(sx, sy, w, hh, o.sample || 1), edge);
  if (!box) {
    for (let k = 0; k < edge.length; k++) cov[edge[k]] = 0;
    return res;
  }
  if (o.antialias === false) {
    for (let k = 0; k < edge.length; k++) cov[edge[k]] = 0;
    res.b = { x: box[0], y: box[1], w: box[2] - box[0] + 1, h: box[3] - box[1] + 1 };
    return res;
  }
  const ring = spread(cov, w, hh, edge, IN, RING, []);
  spread(cov, w, hh, ring, 0, 1, edge);
  const far = spread(cov, w, hh, edge, 0, 2, []);
  const outs = edge.concat(far, spread(cov, w, hh, far, 0, 3, []));
  const m = matte(img, d32, s32, cov, seed, tol, ring, outs);
  res.b = grow(box, m.band, m.val, cov, w);
  res.band = m.band;
  res.est = estimates(img, m);
  return res;
}

const NEAR = [];
for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) if (dx || dy) NEAR.push([dx * dx + dy * dy, dx, dy]);
NEAR.sort((p, q) => p[0] - q[0]);

function straight(v, out, o) {
  const a = clamp(v[3], 0, 255);
  const f = a > 0 ? 255 / a : 0;
  out[o] = clamp(v[0], 0, a) * f;
  out[o + 1] = clamp(v[1], 0, a) * f;
  out[o + 2] = clamp(v[2], 0, a) * f;
  out[o + 3] = a;
}
function premult(d, p, v) {
  const f = d[p + 3] / 255;
  v[0] = d[p] * f;
  v[1] = d[p + 1] * f;
  v[2] = d[p + 2] * f;
  v[3] = d[p + 3];
}
function rest(v, part, share, out) {
  const f = 1 / (1 - share);
  for (let c = 0; c < 4; c++) out[c] = (v[c] - share * part[c]) * f;
}
function rank(list, v) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function estimates(img, m) {
  const d = img.data;
  const band = m.band;
  const val = m.val;
  let cnt = 0;
  for (let k = 0; k < band.length; k++) if (val[k] > 0 && val[k] < 255) cnt++;
  if (!cnt) return null;
  const at = new Int32Array(cnt);
  const tc = new Uint8Array(cnt);
  const to = new Uint8ClampedArray(cnt * 4);
  const ti = new Uint8ClampedArray(cnt * 4);
  const P = [0, 0, 0, 0];
  const I = [0, 0, 0, 0];
  const O = [0, 0, 0, 0];
  let n = 0;
  for (let k = 0; k < band.length; k++) {
    const v = val[k];
    if (v === 0 || v === 255) continue;
    const i = band[k];
    const a = v / 255;
    if (!m.ek[k]) continue;
    premult(d, i * 4, P);
    for (let c = 0; c < 4; c++) {
      O[c] = m.eo[k * 4 + c];
      I[c] = m.ei[k * 4 + c];
    }
    let off = 0;
    for (let c = 0; c < 4; c++) off += (P[c] - a * I[c] - (1 - a) * O[c]) ** 2;
    if (a < 0.5 && off > 2.25) rest(P, I, a, O);
    else if (a >= 0.25) rest(P, O, 1 - a, I);
    at[n] = i;
    tc[n] = v;
    straight(O, to, n * 4);
    straight(I, ti, n * 4);
    n++;
  }
  if (!n) return null;
  const idx = at.slice(0, n).sort();
  const est = { idx, cov: new Uint8Array(n), out: new Uint8ClampedArray(n * 4), inn: new Uint8ClampedArray(n * 4) };
  for (let j = 0; j < n; j++) {
    const r = rank(idx, at[j]);
    est.cov[r] = tc[j];
    est.out.set(to.subarray(j * 4, j * 4 + 4), r * 4);
    est.inn.set(ti.subarray(j * 4, j * 4 + 4), r * 4);
  }
  return est;
}

export function deconPaint(k, mode, color = null, opacity = 1, clip = null) {
  const n = k.idx.length;
  const out = k.out;
  const inn = k.inn;
  const px = new Uint8ClampedArray(n * 4);
  for (let j = 0, p = 0; j < n; j++, p += 4) {
    const a = k.cov[j] / 255;
    if (mode === 'lift') {
      px[p] = inn[p];
      px[p + 1] = inn[p + 1];
      px[p + 2] = inn[p + 2];
      px[p + 3] = a * inn[p + 3];
      continue;
    }
    const q = mode === 'fill' ? opacity * (clip ? clip[j] / 255 : 1) : 0;
    const wi = mode === 'fill' ? (a * (1 - q) * inn[p + 3]) / 255 : 0;
    const wf = a * q;
    const wo = ((1 - a) * out[p + 3]) / 255;
    const al = wi + wf + wo;
    if (al <= 0) continue;
    px[p] = (inn[p] * wi + (color ? color.r : 0) * wf + out[p] * wo) / al;
    px[p + 1] = (inn[p + 1] * wi + (color ? color.g : 0) * wf + out[p + 1] * wo) / al;
    px[p + 2] = (inn[p + 2] * wi + (color ? color.b : 0) * wf + out[p + 2] * wo) / al;
    px[p + 3] = al * 255;
  }
  return px;
}

export function deconInvert(k) {
  const cov = new Uint8Array(k.cov.length);
  for (let j = 0; j < cov.length; j++) cov[j] = 255 - k.cov[j];
  return { ...k, cov, out: k.inn, inn: k.out };
}

export function deconJoin(a, b, mix, w, r) {
  const na = a ? a.idx.length : 0;
  const nb = b ? b.idx.length : 0;
  const idx = new Int32Array(na + nb);
  const cov = new Uint8Array(na + nb);
  const out = new Uint8ClampedArray((na + nb) * 4);
  const inn = new Uint8ClampedArray((na + nb) * 4);
  const A = [0, 0, 0, 0], B = [0, 0, 0, 0], P = [0, 0, 0, 0], I = [0, 0, 0, 0], O = [0, 0, 0, 0];
  const now = (i, old) => {
    const x = (i % w) - r.x;
    const y = Math.floor(i / w) - r.y;
    return x >= 0 && y >= 0 && x < r.w && y < r.h ? mix[y * r.w + x] : old;
  };
  const copy = (k, j, n) => {
    idx[n] = k.idx[j];
    cov[n] = k.cov[j];
    out.set(k.out.subarray(j * 4, j * 4 + 4), n * 4);
    inn.set(k.inn.subarray(j * 4, j * 4 + 4), n * 4);
  };
  let n = 0;
  let ja = 0;
  let jb = 0;
  while (ja < na || jb < nb) {
    const ia = ja < na ? a.idx[ja] : Infinity;
    const ib = jb < nb ? b.idx[jb] : Infinity;
    const i = Math.min(ia, ib);
    const ca = ia === i ? a.cov[ja] : 0;
    const cb = ib === i ? b.cov[jb] : 0;
    const u = now(i, ca);
    if (u > 0 && u < 255) {
      if (ia === i && u === ca) copy(a, ja, n++);
      else if (ib === i && u === cb) copy(b, jb, n++);
      else if (ia === i && ib === i && Math.abs(u - ca - cb) <= 1) {
        premult(a.inn, ja * 4, A);
        premult(b.inn, jb * 4, B);
        premult(a.out, ja * 4, O);
        for (let c = 0; c < 4; c++) {
          P[c] = (ca * A[c] + (255 - ca) * O[c]) / 255;
          I[c] = (ca * A[c] + cb * B[c]) / u;
        }
        rest(P, I, u / 255, O);
        idx[n] = i;
        cov[n] = u;
        straight(O, out, n * 4);
        straight(I, inn, n * 4);
        n++;
      }
    }
    if (ia === i) ja++;
    if (ib === i) jb++;
  }
  return n ? { idx: idx.slice(0, n), cov: cov.slice(0, n), out: out.slice(0, n * 4), inn: inn.slice(0, n * 4) } : null;
}

export function wandMix(old, cov, w, b, mode) {
  const out = new Uint8Array(b.w * b.h);
  let x0 = b.w, y0 = b.h, x1 = -1, y1 = -1;
  const same = (x, y) => {
    for (let n = 0; n < NEAR.length; n++) {
      const xx = x + NEAR[n][1];
      const yy = y + NEAR[n][2];
      if (xx >= 0 && yy >= 0 && xx < b.w && yy < b.h && cov[(b.y + yy) * w + b.x + xx] === 255) return old[yy * b.w + xx] > 127 ? 1 : 0;
    }
    return -1;
  };
  const blend = (a, n, s) => {
    if (mode === 'add') return s < 0 ? a + n - (a * n) / 255 : s ? Math.max(a, n) : Math.min(255, a + n);
    if (mode === 'sub') return s < 0 ? (a * (255 - n)) / 255 : s ? Math.max(0, a - n) : a;
    return s < 0 ? (a * n) / 255 : s ? Math.min(a, n) : 0;
  };
  for (let y = 0, k = 0; y < b.h; y++) {
    for (let x = 0, i = (b.y + y) * w + b.x; x < b.w; x++, i++, k++) {
      const a = old[k];
      const n = cov[i];
      const v = n === 0 || n === 255 || a === 0 ? blend(a, n, 1) : Math.round(blend(a, n, same(x, y)));
      if (!v) continue;
      out[k] = v;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return { out, b: x1 < 0 ? null : { x: b.x + x0, y: b.y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

export function wandSum(img, band) {
  const d = new Int32Array(img.data.buffer, img.data.byteOffset, img.width * img.height);
  let sum = band ? band.length : 0;
  for (let k = 0; band && k < band.length; k++) sum = (Math.imul(sum ^ d[band[k]], 16777619) + band[k]) | 0;
  return sum;
}

function starts(sx, sy, w, hh, size) {
  const r = Math.max(0, (size - 1) >> 1);
  const list = [];
  for (let y = Math.max(0, sy - r); y <= Math.min(hh - 1, sy + r); y++) {
    for (let x = Math.max(0, sx - r); x <= Math.min(w - 1, sx + r); x++) list.push(y * w + x);
  }
  list.push(sy * w + sx);
  return list;
}

export function flood(img, sx, sy, tol, contiguous) {
  return wandSelect(img, sx, sy, { tolerance: tol, contiguous, antialias: false }).cov;
}

function convolve3(img, k, div, bias) {
  const w = img.width;
  const hh = img.height;
  const s = new Uint8ClampedArray(img.data);
  const d = img.data;
  for (let y = 0; y < hh; y++) {
    const y0 = Math.max(0, y - 1) * w;
    const y1 = y * w;
    const y2 = Math.min(hh - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1);
      const x2 = Math.min(w - 1, x + 1);
      const o = (y1 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = s[(y0 + x0) * 4 + c] * k[0] + s[(y0 + x) * 4 + c] * k[1] + s[(y0 + x2) * 4 + c] * k[2] +
          s[(y1 + x0) * 4 + c] * k[3] + s[o + c] * k[4] + s[(y1 + x2) * 4 + c] * k[5] +
          s[(y2 + x0) * 4 + c] * k[6] + s[(y2 + x) * 4 + c] * k[7] + s[(y2 + x2) * 4 + c] * k[8];
        d[o + c] = v / div + bias;
      }
    }
  }
}

function remap(img, fn) {
  const w = img.width;
  const hh = img.height;
  const s = new Uint8ClampedArray(img.data);
  const d = img.data;
  const out = [0, 0];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, out);
      const fx = clamp(out[0], 0, w - 1);
      const fy = clamp(out[1], 0, hh - 1);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(w - 1, x0 + 1);
      const y1 = Math.min(hh - 1, y0 + 1);
      const ax = fx - x0;
      const ay = fy - y0;
      const o = (y * w + x) * 4;
      const p00 = (y0 * w + x0) * 4, p10 = (y0 * w + x1) * 4, p01 = (y1 * w + x0) * 4, p11 = (y1 * w + x1) * 4;
      for (let c = 0; c < 4; c++) {
        d[o + c] = (s[p00 + c] * (1 - ax) + s[p10 + c] * ax) * (1 - ay) + (s[p01 + c] * (1 - ax) + s[p11 + c] * ax) * ay;
      }
    }
  }
}

function noise2(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FILTERS = [
  { id: 'gaussian', group: 'Blur', name: 'Gaussian Blur', p: [R('radius', 'Radius', 0.1, 250, 4, 0.1)], run: (img, p, k) => gaussian(img, p.radius * k) },
  { id: 'motion', group: 'Blur', name: 'Motion Blur', p: [R('angle', 'Angle', -90, 90, 0), R('distance', 'Distance', 1, 400, 20)], run(img, p, k) {
    const dist = Math.max(1, Math.round(p.distance * k));
    const a = (p.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = -Math.sin(a);
    const w = img.width, hh = img.height;
    premul(img.data);
    const s = new Uint8ClampedArray(img.data);
    const d = img.data;
    const taps = Math.min(dist, 48);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, al = 0;
      for (let t = 0; t < taps; t++) {
        const f = (t / (taps - 1 || 1) - 0.5) * dist;
        const px = clamp(Math.round(x + dx * f), 0, w - 1);
        const py = clamp(Math.round(y + dy * f), 0, hh - 1);
        const q = (py * w + px) * 4;
        r += s[q]; g += s[q + 1]; b += s[q + 2]; al += s[q + 3];
      }
      const o = (y * w + x) * 4;
      d[o] = r / taps; d[o + 1] = g / taps; d[o + 2] = b / taps; d[o + 3] = al / taps;
    }
    unpremul(d);
  } },
  { id: 'unsharp', group: 'Sharpen', name: 'Unsharp Mask', p: [R('amount', 'Amount', 1, 500, 100), R('radius', 'Radius', 0.1, 64, 2, 0.1), R('threshold', 'Threshold', 0, 255, 0)], run(img, p, k) {
    const blur = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    gaussian(blur, Math.max(0.3, p.radius * k));
    const d = img.data, b = blur.data, am = p.amount / 100;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) {
      const diff = d[i + c] - b[i + c];
      if (Math.abs(diff) >= p.threshold) d[i + c] = d[i + c] + diff * am;
    }
  } },
  { id: 'sharpen', group: 'Sharpen', name: 'Sharpen', p: [], run: (img) => convolve3(img, [0, -1, 0, -1, 5, -1, 0, -1, 0], 1, 0) },
  { id: 'sharpenMore', group: 'Sharpen', name: 'Sharpen More', p: [], run: (img) => convolve3(img, [-1, -1, -1, -1, 9, -1, -1, -1, -1], 1, 0) },
  { id: 'noise', group: 'Noise', name: 'Add Noise', p: [R('amount', 'Amount', 0.1, 100, 12, 0.1), C('mono', 'Monochromatic')], run(img, p) {
    const rnd = noise2(1234);
    const d = img.data, am = p.amount * 2.55;
    const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.6;
    for (let i = 0; i < d.length; i += 4) {
      if (p.mono) {
        const v = gauss() * am;
        d[i] += v; d[i + 1] += v; d[i + 2] += v;
      } else {
        d[i] += gauss() * am; d[i + 1] += gauss() * am; d[i + 2] += gauss() * am;
      }
    }
  } },
  { id: 'despeckle', group: 'Noise', name: 'Despeckle', p: [], run: (img) => convolve3(img, [1, 2, 1, 2, 4, 2, 1, 2, 1], 16, 0) },
  { id: 'mosaic', group: 'Pixelate', name: 'Mosaic', p: [R('size', 'Cell Size', 2, 200, 12)], run(img, p, k) {
    const sz = Math.max(2, Math.round(p.size * k));
    const w = img.width, hh = img.height, d = img.data;
    for (let by = 0; by < hh; by += sz) for (let bx = 0; bx < w; bx += sz) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ex = Math.min(w, bx + sz), ey = Math.min(hh, by + sz);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const q = (y * w + x) * 4;
        const al = d[q + 3];
        r += d[q] * al; g += d[q + 1] * al; b += d[q + 2] * al; a += al; n++;
      }
      const ar = a || 1;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const q = (y * w + x) * 4;
        d[q] = r / ar; d[q + 1] = g / ar; d[q + 2] = b / ar; d[q + 3] = a / n;
      }
    }
  } },
  { id: 'twirl', group: 'Distort', name: 'Twirl', p: [R('angle', 'Angle', -720, 720, 120)], run(img, p) {
    const w = img.width, hh = img.height, cxm = w / 2, cym = hh / 2, rad = Math.min(w, hh) / 2, ang = (p.angle * Math.PI) / 180;
    remap(img, (x, y, o) => {
      const dx = x - cxm, dy = y - cym, r = Math.sqrt(dx * dx + dy * dy);
      if (r >= rad) { o[0] = x; o[1] = y; return; }
      const t = 1 - r / rad;
      const a = ang * t * t;
      const cs = Math.cos(a), sn = Math.sin(a);
      o[0] = cxm + dx * cs - dy * sn;
      o[1] = cym + dx * sn + dy * cs;
    });
  } },
  { id: 'pinch', group: 'Distort', name: 'Pinch', p: [R('amount', 'Amount', -100, 100, 50)], run(img, p) {
    const w = img.width, hh = img.height, cxm = w / 2, cym = hh / 2, rad = Math.min(w, hh) / 2, am = p.amount / 100;
    remap(img, (x, y, o) => {
      const dx = x - cxm, dy = y - cym, r = Math.sqrt(dx * dx + dy * dy);
      if (r >= rad || r === 0) { o[0] = x; o[1] = y; return; }
      const t = r / rad;
      const f = Math.pow(t, am > 0 ? 1 - am * 0.75 : 1 / (1 + am * 0.75)) / t;
      o[0] = cxm + dx * f;
      o[1] = cym + dy * f;
    });
  } },
  { id: 'ripple', group: 'Distort', name: 'Ripple', p: [R('amount', 'Amount', -100, 100, 30), R('size', 'Wavelength', 4, 200, 40)], run(img, p, k) {
    const am = p.amount * 0.2 * k, wl = Math.max(2, p.size * k);
    remap(img, (x, y, o) => {
      o[0] = x + Math.sin((y / wl) * Math.PI * 2) * am;
      o[1] = y + Math.sin((x / wl) * Math.PI * 2) * am;
    });
  } },
  { id: 'emboss', group: 'Stylize', name: 'Emboss', p: [R('amount', 'Amount', 1, 500, 100)], run(img, p) {
    const a = p.amount / 100;
    convolve3(img, [-2 * a, -a, 0, -a, 1, a, 0, a, 2 * a], 1, 0);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = 128 + (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] - 128) * 0.9;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
  } },
  { id: 'edges', group: 'Stylize', name: 'Find Edges', p: [], run(img) {
    const w = img.width, hh = img.height, s = new Uint8ClampedArray(img.data), d = img.data;
    const L = (x, y) => {
      const q = (clamp(y, 0, hh - 1) * w + clamp(x, 0, w - 1)) * 4;
      return 0.299 * s[q] + 0.587 * s[q + 1] + 0.114 * s[q + 2];
    };
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const gx = L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1);
      const gy = L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1);
      const v = 255 - Math.sqrt(gx * gx + gy * gy);
      const o = (y * w + x) * 4;
      d[o] = d[o + 1] = d[o + 2] = v;
    }
  } },
  { id: 'solarize', group: 'Stylize', name: 'Solarize', p: [], run: (img) => applyLut(img.data, lut((v) => (v > 127 ? 255 - v : v))) },
  { id: 'vignette', group: 'Stylize', name: 'Vignette', p: [R('amount', 'Amount', -100, 100, 50), R('mid', 'Midpoint', 0, 100, 50), R('feather', 'Feather', 1, 100, 60)], run(img, p) {
    const w = img.width, hh = img.height, d = img.data, cxm = w / 2, cym = hh / 2;
    const maxr = Math.sqrt(cxm * cxm + cym * cym);
    const inner = (p.mid / 100) * 0.9;
    const span = Math.max(0.02, p.feather / 100);
    const am = p.amount / 100;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const r = Math.sqrt((x - cxm) * (x - cxm) + (y - cym) * (y - cym)) / maxr;
      let t = clamp((r - inner) / span, 0, 1);
      t = t * t * (3 - 2 * t);
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) d[o + c] = am > 0 ? d[o + c] * (1 - t * am) : d[o + c] + (255 - d[o + c]) * t * -am;
    }
  } },
  { id: 'highpass', group: 'Other', name: 'High Pass', p: [R('radius', 'Radius', 0.1, 250, 10, 0.1)], run(img, p, k) {
    const blur = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    gaussian(blur, Math.max(0.3, p.radius * k));
    const d = img.data, b = blur.data;
    for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) d[i + c] = d[i + c] - b[i + c] + 128;
  } },
  { id: 'clouds', group: 'Render', name: 'Clouds', p: [], run(img, p, k, env) {
    const w = img.width, hh = img.height, d = img.data;
    const rnd = noise2((Date.now() & 0xffff) + 7);
    const N = 257;
    const grid = new Float32Array(N * N);
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    const val = (x, y) => {
      const x0 = Math.floor(x) % 256, y0 = Math.floor(y) % 256;
      const fx = x - Math.floor(x), fy = y - Math.floor(y);
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const a = grid[y0 * N + x0], b = grid[y0 * N + x0 + 1], c = grid[(y0 + 1) * N + x0], e = grid[(y0 + 1) * N + x0 + 1];
      return (a + (b - a) * sx) * (1 - sy) + (c + (e - c) * sx) * sy;
    };
    const base = Math.max(w, hh) / 4;
    const f = env.fg, b = env.bg;
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      let v = 0, amp = 0.5, fr = 1 / base;
      for (let o = 0; o < 6; o++) { v += val(x * fr + o * 17, y * fr + o * 31) * amp; amp /= 2; fr *= 2; }
      v = clamp((v - 0.25) * 1.9, 0, 1);
      const q = (y * w + x) * 4;
      d[q] = b.r + (f.r - b.r) * v; d[q + 1] = b.g + (f.g - b.g) * v; d[q + 2] = b.b + (f.b - b.b) * v; d[q + 3] = 255;
    }
  } }
];
export { R, C, COL, S };
