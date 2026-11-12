(() => {
  const MAG = [255, 0, 255];
  const BACK = [0, 0, 0];
  const SAGE = [180, 197, 140, 1];
  const WHITE = [255, 255, 255, 1];
  const DARK = [47, 74, 60, 1];
  const INK = [58, 64, 92, 1];
  const PALE = [220, 237, 180, 1];
  const CLEAR = [0, 0, 0, 0];
  const state = { scene: null, click: null };
  const app = () => window.app;

  const mulberry = (a) => () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  function sample(spec) {
    const { w, h, mats, cls, tgt, far } = spec;
    const ss = spec.ss || 16;
    const n = w * h;
    const truth = new Float32Array(n);
    const ideal = new Float32Array(n * 3);
    const idealFill = new Float32Array(n * 3);
    const rgba = new Uint8ClampedArray(n * 4);
    for (let py = 0, i = 0; py < h; py++) {
      for (let px = 0; px < w; px++, i++) {
        const k = far && far(px + 0.5, py + 0.5) ? 1 : ss;
        let t = 0, r = 0, g = 0, b = 0, a = 0, ir = 0, ig = 0, ib = 0, fr = 0, fg = 0, fb = 0;
        for (let sy = 0; sy < k; sy++) {
          const y = py + (sy + 0.5) / k;
          for (let sx = 0; sx < k; sx++) {
            const x = px + (sx + 0.5) / k;
            const m = cls(x, y);
            const c = mats[m];
            const hit = tgt(x, y, m);
            if (hit) t++;
            if (c[3]) {
              r += c[0];
              g += c[1];
              b += c[2];
              a++;
            }
            if (hit) {
              ir += MAG[0];
              ig += MAG[1];
              ib += MAG[2];
              fr += MAG[0];
              fg += MAG[1];
              fb += MAG[2];
            } else if (c[3]) {
              ir += c[0];
              ig += c[1];
              ib += c[2];
              fr += c[0];
              fg += c[1];
              fb += c[2];
            } else {
              ir += MAG[0];
              ig += MAG[1];
              ib += MAG[2];
              fr += BACK[0];
              fg += BACK[1];
              fb += BACK[2];
            }
          }
        }
        const inv = 1 / (k * k);
        truth[i] = t * inv;
        ideal[i * 3] = ir * inv;
        ideal[i * 3 + 1] = ig * inv;
        ideal[i * 3 + 2] = ib * inv;
        idealFill[i * 3] = fr * inv;
        idealFill[i * 3 + 1] = fg * inv;
        idealFill[i * 3 + 2] = fb * inv;
        if (a) {
          rgba[i * 4] = r / a;
          rgba[i * 4 + 1] = g / a;
          rgba[i * 4 + 2] = b / a;
          rgba[i * 4 + 3] = a * inv * 255;
        }
      }
    }
    return { w, h, truth, ideal, idealFill, rgba };
  }

  function blur(src, w, h, sigma) {
    const rad = Math.ceil(sigma * 4);
    const k = new Float64Array(rad * 2 + 1);
    let sum = 0;
    for (let i = -rad; i <= rad; i++) {
      k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma));
      sum += k[i + rad];
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let j = -rad; j <= rad; j++) v += src[y * w + Math.min(w - 1, Math.max(0, x + j))] * k[j + rad];
        tmp[y * w + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0;
        for (let j = -rad; j <= rad; j++) v += tmp[Math.min(h - 1, Math.max(0, y + j)) * w + x] * k[j + rad];
        out[y * w + x] = Math.min(1, Math.max(0, v));
      }
    }
    return out;
  }

  function fromCoverage(w, h, cov, fg, bg) {
    const n = w * h;
    const ideal = new Float32Array(n * 3);
    const rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const a = cov[i];
      for (let c = 0; c < 3; c++) {
        rgba[i * 4 + c] = fg[c] * a + bg[c] * (1 - a);
        ideal[i * 3 + c] = MAG[c] * a + bg[c] * (1 - a);
      }
      rgba[i * 4 + 3] = 255;
    }
    return { w, h, truth: cov, ideal, idealFill: ideal, rgba };
  }

  function addNoise(sc, amp, seed) {
    const rnd = mulberry(seed);
    const n = sc.w * sc.h;
    for (let i = 0; i < n; i++) {
      const keep = 1 - sc.truth[i];
      for (let c = 0; c < 3; c++) {
        const p = i * 4 + c;
        const before = sc.rgba[p];
        sc.rgba[p] = before + Math.floor(rnd() * (amp * 2 + 1)) - amp;
        const add = (sc.rgba[p] - before) * keep;
        sc.ideal[i * 3 + c] += add;
        if (sc.idealFill !== sc.ideal) sc.idealFill[i * 3 + c] += add;
      }
    }
    return sc;
  }

  const inDisc = (x, y, d) => (x - d.x) * (x - d.x) + (y - d.y) * (y - d.y) < d.r * d.r;
  const nearRing = (x, y, d, r) => Math.abs(Math.hypot(x - d.x, y - d.y) - r) < 1;
  const centre = (d) => [Math.floor(d.x), Math.floor(d.y)];

  function discScene(o) {
    const d = o.disc;
    const sc = sample({
      w: o.w, h: o.h, mats: [o.bg, o.fg],
      cls: (x, y) => (inDisc(x, y, d) ? 1 : 0),
      tgt: (x, y, m) => m === (o.page ? 0 : 1),
      far: (x, y) => !nearRing(x, y, d, d.r)
    });
    sc.seed = o.page ? [20, 20] : centre(d);
    return sc;
  }

  const D1 = { x: 211.37, y: 208.61, r: 130.3 };

  function twoDiscs() {
    const a = { x: 130.4, y: 150.6, r: 90.25 };
    const b = { x: 310.7, y: 262.3, r: 105.6 };
    const sc = sample({
      w: 460, h: 420, mats: [SAGE, WHITE, DARK],
      cls: (x, y) => (inDisc(x, y, a) ? 1 : inDisc(x, y, b) ? 2 : 0),
      tgt: (x, y, m) => m === 0,
      far: (x, y) => !nearRing(x, y, a, a.r) && !nearRing(x, y, b, b.r)
    });
    sc.seed = [20, 20];
    return sc;
  }

  function starPoints(cx, cy, ro, ri, rot) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const a = rot + (i * Math.PI) / 5;
      const r = i % 2 ? ri : ro;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }

  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i];
      const b = pts[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }

  function inRound(x, y, q) {
    if (x < q.x0 || x > q.x1 || y < q.y0 || y > q.y1) return false;
    const dx = Math.max(q.x0 + q.r - x, 0, x - (q.x1 - q.r));
    const dy = Math.max(q.y0 + q.r - y, 0, y - (q.y1 - q.r));
    return dx * dx + dy * dy < q.r * q.r;
  }

  function shapes(which) {
    const q = { x0: 40.3, y0: 70.6, x1: 220.75, y1: 350.2, r: 30.4 };
    const star = starPoints(365.4, 214.7, 112.5, 46.2, -Math.PI / 2 + 0.12);
    const sc = sample({
      w: 500, h: 420, mats: [SAGE, WHITE, WHITE],
      cls: (x, y) => (inRound(x, y, q) ? 1 : inPoly(x, y, star) ? 2 : 0),
      tgt: (x, y, m) => m === which
    });
    sc.seed = which === 1 ? [130, 210] : which === 2 ? [365, 214] : [20, 20];
    return sc;
  }

  function textScene(page) {
    const w = 640;
    const h = 400;
    const k = 8;
    const top = 120;
    const rows = 160;
    const c = document.createElement('canvas');
    c.width = w * k;
    c.height = rows * k;
    const g = c.getContext('2d', { willReadFrequently: true });
    const size = 84;
    g.font = 'bold ' + size * k + 'px Arial, Helvetica, sans-serif';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#000';
    const ox = 28.3 * k;
    const base = 108.6 * k;
    g.fillText('Class of 2027', ox, base);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const W = c.width;
    const H = c.height;
    const bin = new Uint8Array(W * H);
    for (let i = 0; i < bin.length; i++) bin[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
    const full = (px, py) => {
      for (let y = py * k; y < (py + 1) * k; y++) for (let x = px * k; x < (px + 1) * k; x++) if (!bin[y * W + x]) return false;
      return true;
    };
    const solid = (px, py) => {
      for (let y = py - 2; y <= py + 2; y++) for (let x = px - 2; x <= px + 2; x++) if (x < 0 || y < 0 || x >= w || y >= rows || !full(x, y)) return false;
      return true;
    };
    const gx = Math.round((ox + g.measureText('C').width + g.measureText('l').width / 2) / k);
    const gy = Math.round((base - size * k * 0.36) / k);
    let seed = null;
    for (let r = 0; r < 60 && !seed; r++) {
      for (let dy = -r; dy <= r && !seed; dy++) {
        for (let dx = -r; dx <= r && !seed; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && solid(gx + dx, gy + dy)) seed = [gx + dx, gy + dy];
        }
      }
    }
    if (!seed) throw new Error('no glyph stem found for the text scene');
    const comp = new Uint8Array(W * H);
    const stack = [(seed[1] * k + 4) * W + seed[0] * k + 4];
    comp[stack[0]] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W;
      const y = (i - x) / W;
      if (x > 0 && bin[i - 1] && !comp[i - 1]) { comp[i - 1] = 1; stack.push(i - 1); }
      if (x < W - 1 && bin[i + 1] && !comp[i + 1]) { comp[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && bin[i - W] && !comp[i - W]) { comp[i - W] = 1; stack.push(i - W); }
      if (y < H - 1 && bin[i + W] && !comp[i + W]) { comp[i + W] = 1; stack.push(i + W); }
    }
    const outer = new Uint8Array(W * H);
    if (page) {
      const q = [0];
      outer[0] = 1;
      while (q.length) {
        const i = q.pop();
        const x = i % W;
        const y = (i - x) / W;
        if (x > 0 && !bin[i - 1] && !outer[i - 1]) { outer[i - 1] = 1; q.push(i - 1); }
        if (x < W - 1 && !bin[i + 1] && !outer[i + 1]) { outer[i + 1] = 1; q.push(i + 1); }
        if (y > 0 && !bin[i - W] && !outer[i - W]) { outer[i - W] = 1; q.push(i - W); }
        if (y < H - 1 && !bin[i + W] && !outer[i + W]) { outer[i + W] = 1; q.push(i + W); }
      }
    }
    const at = (x, y) => {
      const yy = Math.floor((y - top) * k);
      if (yy < 0 || yy >= H) return -1;
      return yy * W + Math.floor(x * k);
    };
    const sc = sample({
      w, h, ss: k, mats: [SAGE, DARK],
      cls: (x, y) => {
        const i = at(x, y);
        return i >= 0 && bin[i] ? 1 : 0;
      },
      tgt: (x, y) => {
        const i = at(x, y);
        if (page) return i < 0 || outer[i] === 1;
        return i >= 0 && comp[i] === 1;
      }
    });
    sc.seed = page ? [20, 20] : [seed[0], seed[1] + top];
    return sc;
  }

  function segDist(x, y, a, b) {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy)));
    return Math.hypot(x - a[0] - vx * t, y - a[1] - vy * t);
  }

  function thinLines() {
    const d = { x: 221.37, y: 224.61, r: 130.3 };
    const ang = (80 * Math.PI) / 180;
    const nx = Math.sin(ang);
    const ny = -Math.cos(ang);
    const px = d.x + d.r * 0.5;
    const py = d.y;
    const side = (x, y) => (x - px) * nx + (y - py) * ny;
    const yb = Math.floor(d.y - d.r) - 2;
    const s0 = [d.x - d.r - 30, d.y + 40];
    const s1 = [d.x - d.r + 45, d.y + 15];
    const line = (x, y) => {
      if (Math.abs(side(x, y)) <= 1) return true;
      if (y >= yb && y < yb + 1) return true;
      const dx = x - d.x;
      const dy = y - d.y;
      if (dx < 0 && dy > 12 && Math.abs(Math.hypot(dx, dy) - (d.r + 2.5)) <= 0.5) return true;
      return segDist(x, y, s0, s1) <= 0.5;
    };
    const sc = sample({
      w: 440, h: 440, mats: [SAGE, WHITE, INK],
      cls: (x, y) => (line(x, y) ? 2 : inDisc(x, y, d) ? 1 : 0),
      tgt: (x, y, m) => m === 1 && side(x, y) < 0
    });
    sc.seed = [Math.floor(d.x - 20), Math.floor(d.y - 30)];
    return sc;
  }

  function softEdge() {
    const base = discScene({ w: 420, h: 420, disc: D1, fg: WHITE, bg: SAGE });
    const sc = fromCoverage(420, 420, blur(base.truth, 420, 420, 1.5), WHITE, SAGE);
    sc.seed = centre(D1);
    return sc;
  }

  function gradient(inside) {
    const w = 480;
    const h = 400;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const to = [64, 96, 204];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = Math.min(1, Math.max(0, (x - 200 + 30 * Math.sin(y / 50)) / 280));
        const s = u * u * (3 - 2 * u);
        const p = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) rgba[p + c] = SAGE[c] + (to[c] - SAGE[c]) * s;
        rgba[p + 3] = 255;
      }
    }
    return { w, h, rgba, truth: null, ideal: null, seed: inside ? [390, 200] : [80, 200] };
  }

  function alphaLayer(empty) {
    const sc = sample({
      w: 420, h: 420, mats: [CLEAR, WHITE],
      cls: (x, y) => (inDisc(x, y, D1) ? 1 : 0),
      tgt: (x, y, m) => m === (empty ? 0 : 1),
      far: (x, y) => !nearRing(x, y, D1, D1.r)
    });
    sc.seed = empty ? [20, 20] : centre(D1);
    return sc;
  }

  function ring() {
    const d = { x: 210.3, y: 209.7, r: 100.4 };
    const out = d.r + 6;
    const sc = sample({
      w: 420, h: 420, mats: [SAGE, WHITE],
      cls: (x, y) => {
        const q = (x - d.x) * (x - d.x) + (y - d.y) * (y - d.y);
        return q >= d.r * d.r && q < out * out ? 1 : 0;
      },
      tgt: (x, y) => inDisc(x, y, d),
      far: (x, y) => !nearRing(x, y, d, d.r) && !nearRing(x, y, d, out)
    });
    sc.seed = centre(d);
    return sc;
  }

  const disc = (fg, bg, page) => () => discScene({ w: 420, h: 420, disc: D1, fg, bg, page });

  const SCENES = [
    { id: '01', name: 'white disc on sage', click: 'disc', build: disc(WHITE, SAGE, false) },
    { id: '01p', name: 'white disc on sage', click: 'page', build: disc(WHITE, SAGE, true) },
    { id: '02', name: 'dark green disc on sage', click: 'disc', build: disc(DARK, SAGE, false) },
    { id: '02p', name: 'dark green disc on sage', click: 'page', build: disc(DARK, SAGE, true) },
    { id: '03', name: 'two discs', click: 'page', build: twoDiscs },
    { id: '04a', name: 'rounded rectangle', click: 'shape', build: () => shapes(1) },
    { id: '04b', name: 'five-point star', click: 'shape', build: () => shapes(2) },
    { id: '04p', name: 'rectangle + star', click: 'page', build: () => shapes(0) },
    { id: '05', name: 'text Class of 2027', click: 'stem', build: () => textScene(false) },
    { id: '05p', name: 'text Class of 2027', click: 'page', build: () => textScene(true) },
    { id: '06', name: 'thin 1px and 2px lines', click: 'disc', build: thinLines },
    { id: '07', name: 'soft edge sigma 1.5', click: 'disc', build: softEdge },
    { id: '08', name: 'low contrast 40 levels', click: 'disc', build: disc(PALE, SAGE, false) },
    { id: '09', name: 'noisy +-6', click: 'disc', build: () => addNoise(discScene({ w: 420, h: 420, disc: D1, fg: DARK, bg: SAGE }), 6, 9) },
    { id: '10a', name: 'gradient beside flat', click: 'flat', build: () => gradient(false) },
    { id: '10b', name: 'gradient beside flat', click: 'gradient', build: () => gradient(true) },
    { id: '11a', name: 'alpha layer', click: 'disc', build: () => alphaLayer(false) },
    { id: '11b', name: 'alpha layer', click: 'empty', build: () => alphaLayer(true) },
    { id: '12', name: 'ring 6px', click: 'hole', build: ring }
  ];

  function bandOf(sc) {
    const { w, h, truth } = sc;
    const band = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = truth[y * w + x];
        if (!(t > 0.02 && t < 0.98)) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) band[yy * w + xx] = 1;
          }
        }
      }
    }
    let len = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        len += Math.hypot(truth[i + 1] - truth[i - 1], truth[i + w] - truth[i - w]) / 2;
      }
    }
    sc.edgeLen = len;
    return band;
  }

  function metrics(sc, cov) {
    const n = sc.w * sc.h;
    let mae = 0, bias = 0, nb = 0, inN = 0, miss = 0, exN = 0, leak = 0, worst = 0, area = 0;
    for (let i = 0; i < n; i++) {
      const t = sc.truth[i];
      const s = cov[i];
      area += s / 255 - t;
      if (sc.band[i]) {
        const e = s / 255 - t;
        mae += Math.abs(e);
        bias += e;
        if (Math.abs(e) > worst) worst = Math.abs(e);
        nb++;
      }
      if (t >= 0.98) {
        inN++;
        if (s < 250) miss++;
      } else if (t <= 0.02) {
        exN++;
        if (s > 5) leak++;
      }
    }
    return {
      edgeMAE: nb ? mae / nb : 0, bias: nb ? bias / nb : 0, worst,
      interiorMiss: inN ? miss / inN : 0, exteriorLeak: exN ? leak / exN : 0,
      bandPx: nb, interiorPx: inN, exteriorPx: exN, areaErrPx: area, edgeShiftPx: sc.edgeLen ? area / sc.edgeLen : 0
    };
  }

  function sanity(sc, cov) {
    const { w, h } = sc;
    const n = w * h;
    const on = new Uint8Array(n);
    let sel = 0;
    for (let i = 0; i < n; i++) {
      if (cov[i] >= 128) {
        on[i] = 1;
        sel++;
      }
    }
    const mark = new Uint8Array(n);
    const stack = new Int32Array(n);
    const flood = (start, want, eight) => {
      let top = 0;
      let count = 0;
      stack[top++] = start;
      mark[start] = 1;
      while (top) {
        const i = stack[--top];
        count++;
        const x = i % w;
        const y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (!eight && dx && dy) continue;
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = yy * w + xx;
            if (mark[j] || on[j] !== want) continue;
            mark[j] = 1;
            stack[top++] = j;
          }
        }
      }
      return count;
    };
    for (let x = 0; x < w; x++) {
      if (!on[x] && !mark[x]) flood(x, 0, false);
      const b = (h - 1) * w + x;
      if (!on[b] && !mark[b]) flood(b, 0, false);
    }
    for (let y = 0; y < h; y++) {
      if (!on[y * w] && !mark[y * w]) flood(y * w, 0, false);
      const r = y * w + w - 1;
      if (!on[r] && !mark[r]) flood(r, 0, false);
    }
    let holes = 0;
    let holePx = 0;
    for (let i = 0; i < n; i++) {
      if (!on[i] && !mark[i]) {
        holes++;
        holePx += flood(i, 0, false);
      }
    }
    const seed = sc.seed[1] * w + sc.seed[0];
    let main = 0;
    if (on[seed]) main = flood(seed, 1, true);
    let specks = 0;
    let speckPx = 0;
    let biggest = 0;
    for (let i = 0; i < n; i++) {
      if (on[i] && !mark[i]) {
        const c = flood(i, 1, true);
        specks++;
        speckPx += c;
        if (c > biggest) biggest = c;
      }
    }
    if (!main && specks) {
      specks--;
      speckPx -= biggest;
    }
    let partial = 0;
    for (let i = 0; i < n; i++) if (cov[i] > 5 && cov[i] < 250) partial++;
    return { selPx: sel, selShare: sel / n, seedSelected: !!on[seed], holes, holePx, specks, speckPx, partialPx: partial };
  }

  function readLayer(sc) {
    const l = app().doc.layers[0];
    const c = document.createElement('canvas');
    c.width = sc.w;
    c.height = sc.h;
    const g = c.getContext('2d');
    g.drawImage(l.canvas, l.x, l.y);
    return g.getImageData(0, 0, sc.w, sc.h).data;
  }

  function put(sc) {
    const d = app().doc;
    const l = d.layers[0];
    if (l.x || l.y || l.canvas.width !== sc.w || l.canvas.height !== sc.h) {
      const c = document.createElement('canvas');
      c.width = sc.w;
      c.height = sc.h;
      l.canvas = c;
      l.x = 0;
      l.y = 0;
    }
    l.canvas.getContext('2d').putImageData(new ImageData(sc.rgba, sc.w, sc.h), 0, 0);
    l.ver++;
    d.active = l.id;
    d.target = 'layer';
    d.touch('all');
  }

  function open(sc, name, tol) {
    const a = app();
    a.api.newDoc({ w: sc.w, h: sc.h, dpi: 72, bg: 'white', name });
    put(sc);
    sc.back = readLayer(sc);
    a.api.setTool('wand');
    const o = a.opts.wand;
    Object.assign(o, { mode: 'new', contiguous: true, all: false });
    if (tol != null) o.tolerance = tol;
    a.api.emit('opts');
    state.scene = sc;
    return JSON.parse(JSON.stringify(o));
  }

  function prepare(id, tol) {
    const def = SCENES.find((s) => s.id === id);
    const t0 = performance.now();
    const sc = def.build();
    if (sc.truth) sc.band = bandOf(sc);
    const buildMs = performance.now() - t0;
    const opts = open(sc, 'wand ' + def.id, tol);
    return { w: sc.w, h: sc.h, seed: sc.seed, hasTruth: !!sc.truth, opts, buildMs };
  }

  function arm(seed) {
    const d = app().doc;
    const s = seed || state.scene.seed;
    const c = { down: 0, up: 0, last: 0, live: 0, sets: 0, doc: d };
    let v = d.sel;
    Object.defineProperty(d, 'sel', {
      configurable: true, enumerable: true,
      get: () => v,
      set: (n) => {
        v = n;
        if (!c.down) return;
        c.sets++;
        c.last = performance.now();
        if (n) c.live = c.last;
      }
    });
    window.addEventListener('pointerdown', () => { c.down = performance.now(); }, { capture: true, once: true });
    window.addEventListener('pointerdown', () => { c.up = performance.now(); }, { once: true });
    state.click = c;
    const p = app().api.toClient(s[0] + 0.5, s[1] + 0.5);
    const r = app().api.view.stage.getBoundingClientRect();
    return { x: p.x, y: p.y, inStage: p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom, zoom: app().api.view.zoom };
  }

  function wait(limit) {
    const c = state.click;
    const t0 = performance.now();
    return new Promise((done) => {
      const finish = (timeout) => {
        const d = c.doc;
        const v = d.sel;
        Object.defineProperty(d, 'sel', { configurable: true, enumerable: true, writable: true, value: v });
        done({
          ms: c.live ? c.live - c.down : null, taskMs: c.up ? c.up - c.down : null,
          sets: c.sets, selected: !!v, timeout: !!timeout, clicked: !!c.down
        });
      };
      const tick = () => {
        const now = performance.now();
        if (c.down && c.live && now - c.last > 200) return finish(false);
        if (c.down && !c.live && c.sets && now - c.last > 1500) return finish(false);
        if (now - t0 > limit) return finish(true);
        return setTimeout(tick, 10);
      };
      tick();
    });
  }

  function readSel(sc) {
    const s = app().doc.sel;
    const cov = new Uint8Array(sc.w * sc.h);
    let note = null;
    if (s && s.c) {
      if (s.c.width !== sc.w || s.c.height !== sc.h) note = 'selection canvas is ' + s.c.width + 'x' + s.c.height;
      const c = document.createElement('canvas');
      c.width = sc.w;
      c.height = sc.h;
      const g = c.getContext('2d');
      g.drawImage(s.c, 0, 0);
      const d = g.getImageData(0, 0, sc.w, sc.h).data;
      for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4 + 3];
    }
    return { cov, note };
  }

  function grab() {
    const sc = state.scene;
    const r = readSel(sc);
    sc.cov = r.cov;
    const out = sc.truth ? metrics(sc, r.cov) : {};
    Object.assign(out, sanity(sc, r.cov));
    if (r.note) out.note = r.note;
    return out;
  }

  function halo(fill) {
    const sc = state.scene;
    const back = fill ? BACK : MAG;
    const ideal = fill ? sc.idealFill : sc.ideal;
    const d = readLayer(sc);
    const n = sc.w * sc.h;
    let sum = 0;
    let nb = 0;
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      if (d[p] !== sc.back[p] || d[p + 1] !== sc.back[p + 1] || d[p + 2] !== sc.back[p + 2] || d[p + 3] !== sc.back[p + 3]) changed++;
      if (!sc.band[i]) continue;
      const a = d[p + 3] / 255;
      for (let c = 0; c < 3; c++) sum += Math.abs(d[p + c] * a + back[c] * (1 - a) - ideal[i * 3 + c]);
      nb++;
    }
    put(sc);
    return { halo: nb ? sum / (nb * 3) : 0, changed };
  }

  function refs() {
    const sc = state.scene;
    const n = sc.w * sc.h;
    const hard = new Uint8Array(n);
    const shifted = new Uint8Array(n);
    let del = 0;
    let fill = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      hard[i] = sc.truth[i] >= 0.5 ? 255 : 0;
      shifted[i] = i % sc.w ? Math.round(sc.truth[i - 1] * 255) : 0;
      if (!sc.band[i]) continue;
      const p = i * 4;
      const s = Math.round(sc.truth[i] * 255) / 255;
      const a = sc.back[p + 3] / 255;
      const left = a * (1 - s);
      const over = s + left;
      for (let c = 0; c < 3; c++) {
        del += Math.abs(sc.back[p + c] * left + MAG[c] * (1 - left) - sc.ideal[i * 3 + c]);
        fill += Math.abs(MAG[c] * s + sc.back[p + c] * left + BACK[c] * (1 - over) - sc.idealFill[i * 3 + c]);
      }
      nb++;
    }
    const h = metrics(sc, hard);
    const m = metrics(sc, shifted);
    return {
      predictedDelete: nb ? del / (nb * 3) : 0, predictedFill: nb ? fill / (nb * 3) : 0,
      hardEdge: { edgeMAE: h.edgeMAE, bias: h.bias }, shiftOne: { edgeMAE: m.edgeMAE, bias: m.bias }
    };
  }

  function magenta() {
    app().fg = { r: MAG[0], g: MAG[1], b: MAG[2] };
    app().api.emit('color');
  }

  function feed() {
    const sc = state.scene;
    const { w, h } = sc;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const img = new ImageData(w, h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let i = 0; i < w * h; i++) {
      const a = Math.round(sc.truth[i] * 255);
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = 255;
      img.data[i * 4 + 2] = 255;
      img.data[i * 4 + 3] = a;
      if (a) {
        const x = i % w;
        const y = (i - x) / w;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    c.getContext('2d').putImageData(img, 0, 0);
    const d = app().doc;
    d.sel = x1 < 0 ? null : { c, b: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, path: null };
    app().api.emit('sel', d);
    return !!d.sel;
  }

  function close() {
    const a = app();
    if (!a.doc) return;
    a.doc.dirty = false;
    a.api.run('close');
  }

  function shot() {
    const sc = state.scene;
    const { w, h } = sc;
    const cov = sc.cov || new Uint8Array(w * h);
    const z = 8;
    const cw = Math.floor(w / z);
    const ch = Math.floor(h / z);
    let fx = sc.seed[0];
    let fy = sc.seed[1];
    if (sc.band) {
      let best = Infinity;
      for (let i = 0; i < w * h; i++) {
        if (!sc.band[i]) continue;
        const x = i % w;
        const y = (i - x) / w;
        const q = (x - sc.seed[0]) * (x - sc.seed[0]) + (y - sc.seed[1]) * (y - sc.seed[1]) * 4;
        if (q < best) {
          best = q;
          fx = x;
          fy = y;
        }
      }
    }
    const ox = Math.min(w - cw, Math.max(0, fx - (cw >> 1)));
    const oy = Math.min(h - ch, Math.max(0, fy - (ch >> 1)));
    const out = document.createElement('canvas');
    out.width = w * 5;
    out.height = h;
    const g = out.getContext('2d');
    g.fillStyle = '#ff00ff';
    g.fillRect(0, 0, out.width, h);
    const panel = (fn) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const img = new ImageData(w, h);
      for (let i = 0; i < w * h; i++) {
        const v = fn(i);
        img.data[i * 4] = v[0];
        img.data[i * 4 + 1] = v[1];
        img.data[i * 4 + 2] = v[2];
        img.data[i * 4 + 3] = v.length > 3 ? v[3] : 255;
      }
      c.getContext('2d').putImageData(img, 0, 0);
      return c;
    };
    const scene = panel((i) => [sc.rgba[i * 4], sc.rgba[i * 4 + 1], sc.rgba[i * 4 + 2], sc.rgba[i * 4 + 3]]);
    const sel = panel((i) => [cov[i], cov[i], cov[i]]);
    const err = panel((i) => {
      if (!sc.truth) return [40, 40, 40];
      const e = cov[i] / 255 - sc.truth[i];
      const m = Math.min(1, Math.abs(e));
      const base = 40;
      return e < 0 ? [base + (255 - base) * m, base * (1 - m), base * (1 - m)] : [base * (1 - m), base + (160 - base) * m, base + (255 - base) * m];
    });
    g.drawImage(scene, 0, 0);
    g.drawImage(sel, w, 0);
    g.drawImage(err, w * 2, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(scene, ox, oy, cw, ch, w * 3, 0, cw * z, ch * z);
    g.drawImage(err, ox, oy, cw, ch, w * 4, 0, cw * z, ch * z);
    g.strokeStyle = '#ffff00';
    g.lineWidth = 1;
    g.strokeRect(ox + 0.5, oy + 0.5, cw, ch);
    return out.toDataURL('image/png');
  }

  function ruler() {
    const out = [];
    for (const d of [D1, { x: 40.21, y: 37.83, r: 9.7 }]) {
      const pad = Math.ceil(d.r) + 4;
      const w = Math.ceil(d.x) + pad;
      const h = Math.ceil(d.y) + pad;
      for (const fast of [true, false]) {
        const sc = sample({
          w, h, mats: [SAGE, WHITE],
          cls: (x, y) => (inDisc(x, y, d) ? 1 : 0),
          tgt: (x, y, m) => m === 1,
          far: fast ? (x, y) => !nearRing(x, y, d, d.r) : null
        });
        let sum = 0;
        for (let i = 0; i < sc.truth.length; i++) sum += sc.truth[i];
        const exact = Math.PI * d.r * d.r;
        out.push({ r: d.r, fast, area: sum, exact, rel: (sum - exact) / exact });
      }
    }
    return out;
  }

  function prepareBig(tol) {
    const w = 2625;
    const h = 3375;
    const n = w * h;
    const t0 = performance.now();
    const rgba = new Uint8ClampedArray(n * 4).fill(255);
    const truth = new Float32Array(n).fill(1);
    const rnd = mulberry(2027);
    const cols = [SAGE, DARK, [20, 20, 24], [200, 52, 44], [36, 92, 180], [240, 180, 40]];
    const discs = [];
    let guard = 0;
    while (discs.length < 30 && guard++ < 100000) {
      const r = 70 + rnd() * 170 + rnd() * 0.9;
      const d = { x: 130 + r + rnd() * (w - 260 - 2 * r), y: 130 + r + rnd() * (h - 260 - 2 * r), r, c: cols[discs.length % cols.length] };
      if (discs.every((o) => Math.hypot(o.x - d.x, o.y - d.y) > o.r + d.r + 10)) discs.push(d);
    }
    let exact = 0;
    const ss = 16;
    for (const d of discs) {
      exact += Math.PI * d.r * d.r;
      const x0 = Math.floor(d.x - d.r - 1);
      const x1 = Math.ceil(d.x + d.r + 1);
      const y0 = Math.floor(d.y - d.r - 1);
      const y1 = Math.ceil(d.y + d.r + 1);
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const dist = Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y);
          if (dist >= d.r + 1) continue;
          let a = 1;
          if (dist > d.r - 1) {
            let hit = 0;
            for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) if (inDisc(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss, d)) hit++;
            a = hit / (ss * ss);
          }
          const i = y * w + x;
          truth[i] = 1 - a;
          for (let c = 0; c < 3; c++) rgba[i * 4 + c] = d.c[c] * a + 255 * (1 - a);
        }
      }
    }
    let area = 0;
    for (let i = 0; i < n; i++) area += 1 - truth[i];
    const sc = { w, h, rgba, truth, ideal: null, seed: [60, 60], seeds: [[60, 60], [w - 61, h - 61]] };
    sc.band = bandOf(sc);
    const buildMs = performance.now() - t0;
    const opts = open(sc, 'wand timing', tol);
    return { w, h, discs: discs.length, seeds: sc.seeds, opts, buildMs, area, exact, rel: (area - exact) / exact };
  }

  function grabBig(seed) {
    const sc = state.scene;
    const r = readSel(sc);
    const out = metrics(sc, r.cov);
    let sel = 0;
    for (let i = 0; i < r.cov.length; i++) if (r.cov[i] >= 128) sel++;
    out.selShare = sel / r.cov.length;
    out.seedSelected = r.cov[seed[1] * sc.w + seed[0]] >= 128;
    if (r.note) out.note = r.note;
    return out;
  }

  window.__wb = {
    list: () => SCENES.map((s) => ({ id: s.id, name: s.name, click: s.click })),
    prepare, arm, wait, grab, halo, refs, magenta, feed, close, shot, ruler, prepareBig, grabBig
  };
})();
