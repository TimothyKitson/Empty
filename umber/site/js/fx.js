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

export function flood(img, sx, sy, tol, contiguous) {
  const w = img.width;
  const hh = img.height;
  const d = img.data;
  const out = new Uint8Array(w * hh);
  sx = Math.floor(sx);
  sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= hh) return out;
  const s = (sy * w + sx) * 4;
  const r0 = d[s], g0 = d[s + 1], b0 = d[s + 2], a0 = d[s + 3];
  const match = (i) => {
    const p = i * 4;
    const a = d[p + 3];
    if (a0 === 0 && a === 0) return true;
    return Math.abs(d[p] - r0) <= tol && Math.abs(d[p + 1] - g0) <= tol && Math.abs(d[p + 2] - b0) <= tol && Math.abs(a - a0) <= tol;
  };
  if (!contiguous) {
    for (let i = 0; i < out.length; i++) if (match(i)) out[i] = 255;
    return out;
  }
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    let i = y * w + x;
    if (out[i] || !match(i)) continue;
    while (x > 0 && !out[i - 1] && match(i - 1)) { x--; i--; }
    let up = false;
    let down = false;
    while (x < w && !out[i] && match(i)) {
      out[i] = 255;
      if (y > 0) {
        const m = !out[i - w] && match(i - w);
        if (m && !up) stack.push(x, y - 1);
        up = m;
      }
      if (y < hh - 1) {
        const m = !out[i + w] && match(i + w);
        if (m && !down) stack.push(x, y + 1);
        down = m;
      }
      x++;
      i++;
    }
  }
  return out;
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
