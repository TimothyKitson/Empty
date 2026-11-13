const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');
const { fetchAi } = require('./fetch-ai');

const SELECT = 'Select the area to fill first: draw around it with the Lasso, then choose AI Fill again.';
const EMPTY_SEL = 'The selection is empty. Draw around the area you want filled, then choose AI Fill again.';
const NOT_EMPTY = 'Nothing is empty inside the selection.';
const NO_PICTURE = 'There is no solid picture on this page for the AI to continue from.';
const NO_AROUND = 'There is no solid picture around that area for the AI to continue from.';
const HOLES = 'Filling the empty space inside the selection';
const REPLACE = 'Replacing what is inside the selection';
const NO_DOWNLOAD = 'The AI model could not be downloaded. Check the internet connection and try again.';
const ZIP_NAMES = ['LICENSES.txt', '_headers', 'ai/migan_pipeline_v2.onnx', 'ai/ort-wasm-simd-threaded.wasm', 'ai/ort.wasm.bundle.min.mjs', 'index.html'];

function zipEntries(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 24);
    const n = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    out.push({ name: buf.slice(p + 46, p + 46 + n).toString('utf8'), method, size });
    p += 46 + n + extra;
  }
  return out;
}

function inPage() {
  const api = window.app.api;
  const log = { opened: 0, closed: 0, texts: [], toasts: [], what: [], gap: 0 };
  let beat = performance.now();
  const pulse = () => {
    const now = performance.now();
    if (now - beat > log.gap) log.gap = now - beat;
    beat = now;
    setTimeout(pulse, 8);
  };
  pulse();
  const has = (n, c) => !!(n.classList && n.classList.contains(c));
  new MutationObserver((list) => {
    for (const m of list) {
      for (const n of m.addedNodes) {
        if (has(n, 'aiback')) log.opened++;
        if (has(n, 'toast')) log.toasts.push(n.textContent);
      }
      for (const n of m.removedNodes) if (has(n, 'aiback')) log.closed++;
    }
    const t = document.querySelector('.aitext');
    if (!t) return;
    const what = document.querySelector('.aiwhat').textContent.trim();
    if (what && log.what[log.what.length - 1] !== what) log.what.push(what);
    const s = t.textContent + '|' + document.querySelector('.aipct').textContent;
    if (log.texts[log.texts.length - 1] !== s) log.texts.push(s);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  const kept = {};
  const pixels = (d) => {
    const c = api.flatten(d);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  };
  const paint = (d, fn) => {
    const l = d.layers[0];
    fn(l.canvas.getContext('2d'), l.canvas);
    l.ver++;
    d.touch('all');
    return d;
  };
  const noise = (g, w, h, amount, seed) => {
    const img = g.getImageData(0, 0, w, h);
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rnd() - 0.5) * amount;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  };
  window.T = {
    log,
    grad(w, h, name) {
      const d = api.newDoc({ w, h, dpi: 72, bg: 'white', name });
      return paint(d, (g) => {
        const a = g.createLinearGradient(0, 0, w, 0);
        a.addColorStop(0, 'rgb(60,197,0)');
        a.addColorStop(1, 'rgb(210,197,0)');
        g.fillStyle = a;
        g.fillRect(0, 0, w, h);
        const b = g.createLinearGradient(0, 0, 0, h);
        b.addColorStop(0, 'rgb(0,0,140)');
        b.addColorStop(1, 'rgb(0,0,60)');
        g.globalCompositeOperation = 'lighter';
        g.fillStyle = b;
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'source-over';
      });
    },
    rough(w, h, name, amount = 24) {
      const d = window.T.grad(w, h, name);
      return paint(d, (g) => noise(g, w, h, amount, 777));
    },
    flat(name) {
      const d = api.newDoc({ w: 900, h: 700, dpi: 72, bg: 'white', name });
      return paint(d, (g) => {
        g.fillStyle = 'rgb(20,120,130)';
        g.fillRect(0, 0, 900, 700);
        g.fillStyle = 'rgb(250,200,40)';
        g.beginPath();
        g.moveTo(0, 120);
        g.lineTo(900, 40);
        g.lineTo(900, 110);
        g.lineTo(0, 190);
        g.fill();
        g.fillStyle = 'rgb(230,60,60)';
        g.beginPath();
        g.arc(450, 450, 50, 0, 7);
        g.fill();
      });
    },
    halves(name) {
      const d = api.newDoc({ w: 900, h: 700, dpi: 72, bg: 'white', name });
      return paint(d, (g) => {
        g.fillStyle = 'rgb(244,208,63)';
        g.fillRect(0, 0, 450, 700);
        g.fillStyle = 'rgb(31,58,147)';
        g.fillRect(450, 0, 450, 700);
      });
    },
    cut(d, holes) {
      return paint(d, (g) => holes.forEach((r) => g.clearRect(r[0], r[1], r[2], r[3])));
    },
    side(name) {
      const d = api.newDoc({ w: 900, h: 600, dpi: 72, bg: 'transparent', name });
      const l = d.layers[0];
      l.canvas = document.createElement('canvas');
      l.canvas.width = 900;
      l.canvas.height = 600;
      return paint(d, (g) => {
        const a = g.createLinearGradient(0, 0, 0, 600);
        a.addColorStop(0, 'rgb(60,197,90)');
        a.addColorStop(1, 'rgb(130,190,110)');
        g.fillStyle = a;
        g.fillRect(0, 0, 300, 600);
      });
    },
    add(name, draw, opt) {
      const d = window.app.doc;
      const c = document.createElement('canvas');
      c.width = d.w;
      c.height = d.h;
      if (draw) draw(c.getContext('2d'));
      const l = new api.Layer(Object.assign({ name, canvas: c }, opt || {}));
      d.layers.push(l);
      d.touch('all');
      api.emit('layers');
      return l;
    },
    activate(name) {
      const d = window.app.doc;
      d.active = d.layers.find((l) => l.name === name).id;
      api.emit('layers');
    },
    sel(x, y, w, h, draw) {
      const d = window.app.doc;
      const c = document.createElement('canvas');
      c.width = d.w;
      c.height = d.h;
      const g = c.getContext('2d');
      g.fillStyle = '#000';
      if (draw) draw(g);
      else g.fillRect(x, y, w, h);
      d.sel = { c, b: { x, y, w, h }, path: null };
      api.emit('sel', d);
      return { x, y, w, h };
    },
    top() {
      const d = window.app.doc;
      const l = d.layers[d.layers.length - 1];
      return { name: l.name, opacity: l.opacity, clip: l.clip, blend: l.blend, x: l.x, y: l.y, w: l.w, h: l.h, active: d.active === l.id };
    },
    stats(key, box) {
      const d = window.app.doc;
      const a = kept[key];
      const b = pixels(d);
      const w = d.w;
      const lum = (px, p) => 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
      const was = [0, 0, 0];
      const now = [0, 0, 0];
      let n = 0;
      let worst = 0;
      let din = 0;
      let nin = 0;
      let dout = 0;
      let nout = 0;
      for (let y = Math.max(0, box.y - 30); y < Math.min(d.h, box.y + box.h + 30); y++) {
        for (let x = Math.max(0, box.x - 30); x < Math.min(w - 1, box.x + box.w + 30); x++) {
          const p = (y * w + x) * 4;
          const inside = x >= box.x && x < box.x + box.w - 1 && y >= box.y && y < box.y + box.h;
          const step = Math.abs(lum(b, p) - lum(b, p + 4));
          if (inside) {
            din += step;
            nin++;
            n++;
            for (let k = 0; k < 3; k++) {
              was[k] += a[p + k];
              now[k] += b[p + k];
              worst = Math.max(worst, Math.abs(a[p + k] - b[p + k]));
            }
          } else if (x < box.x - 1 || x >= box.x + box.w || y < box.y || y >= box.y + box.h) {
            dout += step;
            nout++;
          }
        }
      }
      const off = Math.max(...was.map((v, k) => Math.abs(v - now[k]) / Math.max(1, n)));
      return { off: Math.round(off * 10) / 10, worst, detailIn: Math.round((din / Math.max(1, nin)) * 10) / 10, detailOut: Math.round((dout / Math.max(1, nout)) * 10) / 10 };
    },
    colours(box) {
      const d = window.app.doc;
      const b = pixels(d);
      const seen = {};
      let edgeOff = 0;
      for (let y = box.y; y < box.y + box.h; y++) {
        let first = -1;
        for (let x = box.x; x < box.x + box.w; x++) {
          const p = (y * d.w + x) * 4;
          const k = b[p] + ',' + b[p + 1] + ',' + b[p + 2];
          seen[k] = (seen[k] || 0) + 1;
          if (first < 0 && b[p + 2] > 100) first = x;
        }
        edgeOff = Math.max(edgeOff, Math.abs(first - 450));
      }
      return { seen, edgeOff };
    },
    photo(name) {
      const w = 900;
      const h = 600;
      const d = api.newDoc({ w, h, dpi: 72, bg: 'white', name });
      return paint(d, (g) => {
        const sky = g.createLinearGradient(0, 0, 0, 330);
        sky.addColorStop(0, '#5d9fe0');
        sky.addColorStop(1, '#cfe6f7');
        g.fillStyle = sky;
        g.fillRect(0, 0, w, 330);
        g.fillStyle = 'rgba(255,255,255,0.75)';
        for (const [x, y, r] of [[150, 90, 46], [205, 80, 60], [270, 95, 44], [640, 150, 38], [690, 140, 52], [745, 155, 36]]) {
          g.beginPath();
          g.ellipse(x, y, r * 1.4, r * 0.7, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#6f8f6a';
        g.beginPath();
        g.moveTo(0, 330);
        for (let x = 0; x <= w; x += 30) g.lineTo(x, 300 - 40 * Math.sin(x / 140) - 18 * Math.sin(x / 47));
        g.lineTo(w, 330);
        g.fill();
        const sand = g.createLinearGradient(0, 330, 0, h);
        sand.addColorStop(0, '#d9c08a');
        sand.addColorStop(1, '#b89a63');
        g.fillStyle = sand;
        g.fillRect(0, 330, w, h - 330);
        g.strokeStyle = 'rgba(120,95,55,0.35)';
        g.lineWidth = 3;
        for (let y = 350; y < h; y += 22) {
          g.beginPath();
          for (let x = 0; x <= w; x += 20) g.lineTo(x, y + 5 * Math.sin((x + y * 3) / 60));
          g.stroke();
        }
        noise(g, w, h, 26, 4711);
        g.fillStyle = 'rgba(60,45,20,0.35)';
        g.beginPath();
        g.ellipse(476, 478, 46, 10, 0, 0, Math.PI * 2);
        g.fill();
        const ball = g.createRadialGradient(455, 425, 6, 468, 440, 42);
        ball.addColorStop(0, '#ff9a8a');
        ball.addColorStop(1, '#c81e1e');
        g.fillStyle = ball;
        g.beginPath();
        g.arc(468, 440, 40, 0, Math.PI * 2);
        g.fill();
      });
    },
    texture(name) {
      const w = 800;
      const h = 600;
      const d = api.newDoc({ w, h, dpi: 72, bg: 'white', name });
      return paint(d, (g) => {
        g.fillStyle = '#9c5a3c';
        g.fillRect(0, 0, w, h);
        let s = 99;
        const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
        for (let row = 0, y = 0; y < h; row++, y += 40) {
          for (let x = row % 2 ? -50 : 0; x < w; x += 100) {
            const v = Math.round(rnd() * 34 - 17);
            g.fillStyle = 'rgb(' + (168 + v) + ',' + (84 + v) + ',' + (58 + v) + ')';
            g.fillRect(x + 3, y + 3, 94, 34);
          }
        }
        noise(g, w, h, 30, 31337);
        g.clearRect(540, 0, 260, 210);
      });
    },
    leafy(name) {
      const w = 2625;
      const h = 3375;
      const d = api.newDoc({ w, h, dpi: 300, bg: 'transparent', name });
      const c = document.createElement('canvas');
      c.width = w;
      c.height = 760;
      const g = c.getContext('2d');
      g.fillStyle = '#1f4a22';
      g.fillRect(0, 0, w, 760);
      let s = 2024;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      for (let i = 0; i < 2600; i++) {
        const x = rnd() * w;
        const y = rnd() * 760;
        const len = 60 + rnd() * 90;
        const hue = 85 + rnd() * 50;
        g.save();
        g.translate(x, y);
        g.rotate(rnd() * Math.PI * 2);
        g.fillStyle = 'hsl(' + hue + ',' + (45 + rnd() * 30) + '%,' + (22 + rnd() * 30) + '%)';
        g.beginPath();
        g.ellipse(0, 0, len, len * 0.36, 0, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(-len, 0);
        g.lineTo(len, 0);
        g.stroke();
        g.restore();
      }
      const l = d.layers[0];
      l.canvas = c;
      l.name = 'Leaves';
      l.ver++;
      d.touch('all');
      api.emit('layers');
      return d;
    },
    keep(key) {
      kept[key] = pixels(window.app.doc);
      return kept[key].length;
    },
    state() {
      const d = window.app.doc;
      return {
        layers: d.layers.map((l) => l.name), active: d.al ? d.al.name : null, activeIndex: d.layers.indexOf(d.al), hist: d.hist.length, hi: d.hi,
        last: d.hi >= 0 ? d.hist[d.hi].name : null, names: d.hist.slice(0, d.hi + 1).map((e) => e.name), modal: !!window.app.modal,
        sel: d.sel ? { ...d.sel.b } : null, stats: JSON.parse(JSON.stringify(api.ai.state.stats))
      };
    },
    compare(key, box, pad = 0) {
      const d = window.app.doc;
      const a = kept[key];
      const b = pixels(d);
      const w = d.w;
      let outside = 0;
      let inside = 0;
      let alphaMin = 255;
      let opaqueChanged = 0;
      for (let p = 0, i = 0; p < b.length; p += 4, i++) {
        const x = i % w;
        const y = (i - x) / w;
        const same = a[p] === b[p] && a[p + 1] === b[p + 1] && a[p + 2] === b[p + 2] && a[p + 3] === b[p + 3];
        const isIn = box && x >= box.x - pad && x < box.x + box.w + pad && y >= box.y - pad && y < box.y + box.h + pad;
        if (!same && isIn) inside++;
        if (!same && !isIn) outside++;
        if (!same && a[p + 3] === 255) opaqueChanged++;
        if (b[p + 3] < alphaMin) alphaMin = b[p + 3];
      }
      const at = (px, x, y) => { const q = (Math.round(y) * w + Math.round(x)) * 4; return [px[q], px[q + 1], px[q + 2], px[q + 3]]; };
      const cx = box ? box.x + box.w / 2 : 0;
      const cy = box ? box.y + box.h / 2 : 0;
      const was = at(a, cx, cy);
      const now = at(b, cx, cy);
      return { outside, inside, alphaMin, opaqueChanged, was, now, off: Math.max(Math.abs(was[0] - now[0]), Math.abs(was[1] - now[1]), Math.abs(was[2] - now[2])) };
    },
    feather() {
      const d = window.app.doc;
      const l = d.layers.find((x) => x.name === 'AI Fill');
      const b = d.sel.b;
      const s = d.sel.c.getContext('2d').getImageData(b.x, b.y, b.w, b.h).data;
      const a = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height).data;
      let diff = 0;
      let partial = 0;
      for (let p = 3; p < s.length; p += 4) {
        diff = Math.max(diff, Math.abs(s[p] - a[p]));
        if (s[p] > 0 && s[p] < 255) partial++;
      }
      const px = pixels(d);
      let jump = 0;
      const step = (q1, q2) => { for (let k = 0; k < 3; k++) jump = Math.max(jump, Math.abs(px[q1 + k] - px[q2 + k])); };
      const my = Math.round(b.y + b.h / 2);
      const mx = Math.round(b.x + b.w / 2);
      for (let x = Math.max(0, b.x - 6); x < Math.min(d.w - 1, b.x + b.w + 6); x++) step((my * d.w + x) * 4, (my * d.w + x + 1) * 4);
      for (let y = Math.max(0, b.y - 6); y < Math.min(d.h - 1, b.y + b.h + 6); y++) step((y * d.w + mx) * 4, ((y + 1) * d.w + mx) * 4);
      return { sameBox: l.x === b.x && l.y === b.y && l.canvas.width === b.w && l.canvas.height === b.h, diff, partial, jump };
    },
    region(box) {
      const d = window.app.doc;
      const b = pixels(d);
      let alphaMin = 255;
      let alphaMax = 0;
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
          const v = b[(y * d.w + x) * 4 + 3];
          if (v < alphaMin) alphaMin = v;
          if (v > alphaMax) alphaMax = v;
        }
      }
      return { alphaMin, alphaMax };
    },
    audit(key, truth) {
      const d = window.app.doc;
      const a = kept[key];
      const t = truth ? kept[truth] : null;
      const b = pixels(d);
      const l = d.layers[d.layers.length - 1];
      const lw = l.canvas.width;
      const lh = l.canvas.height;
      const la = l.canvas.getContext('2d').getImageData(0, 0, lw, lh).data;
      const cov = d.sel.c.getContext('2d').getImageData(0, 0, d.w, d.h).data;
      const r = {
        layer: { x: l.x, y: l.y, w: lw, h: lh }, changed: 0, opaqueChanged: 0, outsideChanged: 0, opaqueInside: 0, soft: 0, unfilled: 0,
        alphaOff: 0, pageOff: 0, coverOff: 0, partial: 0, beyond: 0, onOpaque: 0, edgeOff: 0, fillOff: 0
      };
      for (let y = 0, p = 0; y < d.h; y++) {
        for (let x = 0; x < d.w; x++, p += 4) {
          const c = cov[p + 3];
          const was = a[p + 3];
          const inside = x >= l.x && y >= l.y && x < l.x + lw && y < l.y + lh;
          const top = inside ? la[((y - l.y) * lw + x - l.x) * 4 + 3] : 0;
          if (a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2] || was !== b[p + 3]) {
            r.changed++;
            if (was === 255) r.opaqueChanged++;
            if (!c) r.outsideChanged++;
          }
          if (c && was === 255) r.opaqueInside++;
          if (c && was > 0 && was < 255) r.soft++;
          if (c === 255 && was < 240 && b[p + 3] < 255) r.unfilled++;
          if (top > 0 && top < 255) r.partial++;
          if (top && !c) r.beyond++;
          if (top && was === 255) r.onOpaque++;
          r.coverOff = Math.max(r.coverOff, Math.abs(top - c));
          if (c && was === 0) {
            r.alphaOff = Math.max(r.alphaOff, Math.abs(top - c));
            r.pageOff = Math.max(r.pageOff, Math.abs(b[p + 3] - c));
          }
          if (!t || c < 255 || was === 255) continue;
          const off = Math.max(Math.abs(b[p] - t[p]), Math.abs(b[p + 1] - t[p + 1]), Math.abs(b[p + 2] - t[p + 2]));
          if (was > 0) r.edgeOff = Math.max(r.edgeOff, off);
          else r.fillOff = Math.max(r.fillOff, off);
        }
      }
      return r;
    },
    async fill(opts) {
      const t0 = performance.now();
      log.gap = 0;
      beat = t0;
      const out = await api.ai.fill(window.app.doc, opts || {});
      return { out, ms: Math.round(performance.now() - t0), gap: Math.round(log.gap) };
    }
  };
}

(async () => {
  const target = process.argv[2] || 'site/index.html';
  const root = path.resolve(__dirname, '..');
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  await fetchAi();
  const local = fs.existsSync(path.join(root, path.dirname(target), 'ai'));
  const srv = await serve(root);
  process.env.PM_ISOLATE = '1';
  const iso = await serve(root);
  delete process.env.PM_ISOLATE;
  const via = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(via ? { proxy: { server: via, bypass: '127.0.0.1,localhost' } } : {});
  const errors = [];
  const fails = [];
  const times = {};
  const expected = /migan_pipeline_v2\.onnx|ort\.wasm\.bundle\.min\.mjs/;
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const note = (name, data) => console.log('info ' + name + ' ' + JSON.stringify(data));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const open = async (base) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e)));
    page.on('console', (m) => {
      if (m.type() === 'error' && !expected.test((m.location() || {}).url || '')) errors.push('console: ' + m.text());
    });
    await page.goto(base + target + '?test=1');
    await page.waitForFunction(() => window.app && window.app.ready, null, { timeout: 15000 });
    await page.evaluate(inPage);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const settle = (ms = 150) => page.waitForTimeout(ms);
    const cli = (x, y) => ev(([x, y]) => window.app.api.toClient(x, y), [x, y]);
    const drag = async (a, b) => {
      const p = await cli(a[0], a[1]);
      const q = await cli(b[0], b[1]);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
      await page.mouse.move(q.x, q.y, { steps: 4 });
      await page.mouse.up();
      await settle();
    };
    const select = async (a, b, feather = 0, tool = 'marquee') => {
      await ev(([tool, feather]) => {
        window.app.api.setTool(tool);
        window.app.opts[tool].feather = feather;
        window.app.opts[tool].mode = 'new';
      }, [tool, feather]);
      await settle(250);
      await drag(a, b);
      return ev(() => window.app.doc.sel && { ...window.app.doc.sel.b });
    };
    const menu = async (labels) => {
      await page.locator('.mtitle', { hasText: new RegExp('^' + labels[0] + '$') }).click();
      for (let i = 1; i < labels.length; i++) {
        const it = page.locator('.menu .item .lbl', { hasText: new RegExp('^' + esc(labels[i]) + '$') }).last();
        if (i < labels.length - 1) await it.hover();
        else await it.click();
        await settle(60);
      }
    };
    const closed = () => ev(() => window.T.log.closed);
    const waitClosed = (n) => page.waitForFunction((n) => window.T.log.closed > n, n, { timeout: 240000 });
    const menuFill = async () => {
      const n = await closed();
      const t0 = Date.now();
      await menu(['Edit', 'AI Fill']);
      await waitClosed(n);
      return Date.now() - t0;
    };
    const lasso = async (pts) => {
      await ev(() => {
        window.app.api.setTool('lasso');
        window.app.opts.lasso.feather = 0;
        window.app.opts.lasso.mode = 'new';
      });
      await settle(250);
      const at = [];
      for (const p of pts) at.push(await cli(p[0], p[1]));
      await page.mouse.move(at[0].x, at[0].y);
      await page.mouse.down();
      for (const q of at.slice(1)) await page.mouse.move(q.x, q.y, { steps: 6 });
      await page.mouse.up();
      await settle();
      return ev(() => window.app.doc.sel && { ...window.app.doc.sel.b });
    };
    const fillDialog = async () => {
      await menu(['Edit', 'Fill…']);
      await settle(200);
      await page.locator('.dialog select').selectOption('ai');
      await page.locator('.dialog .btn.primary').click();
    };
    const fill = (opts) => ev((o) => window.T.fill(o), opts);
    const all = () => ev(() => { window.app.api.run('selAll'); });
    const toasts = (n = 0) => ev((n) => window.T.log.toasts.slice(n), n);
    const state = () => ev(() => window.T.state());
    const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
    return { page, ev, settle, select, lasso, menu, menuFill, fillDialog, fill, all, toasts, state, shot, closed, waitClosed };
  };

  const A = await open(srv.url);
  const asked = [];
  A.page.on('request', (r) => { if (/migan_pipeline|ort-wasm|ort\.wasm/.test(r.url())) asked.push(r.url()); });
  await A.ev(() => {
    window.T.cut(window.T.rough(600, 450, 'Unselected'), [[250, 180, 100, 80]]);
    window.T.keep('unselected');
  });
  await A.settle(300);
  const sNo0 = await A.state();
  const rNo = await A.ev(() => window.app.api.run('aiFill'));
  await A.menu(['Edit', 'AI Fill']);
  await A.settle(200);
  await A.fillDialog();
  await A.settle(400);
  const planNo = await A.ev(() => window.app.api.ai.plan(window.app.doc));
  const sNo = await A.state();
  const logNo = await A.ev(() => ({ toasts: window.T.log.toasts.slice(), opened: window.T.log.opened }));
  const cNo = await A.ev(() => window.T.compare('unselected', null));
  check('without a selection AI Fill answers select', rNo === 'select' && planNo.none === 'select', [rNo, planNo]);
  check('without a selection the command, the menu and Fill… each show the one hint', logNo.toasts.length === 3 && logNo.toasts.every((t) => t === SELECT), logNo.toasts);
  check('without a selection no dialog opens and nothing is downloaded', logNo.opened === 0 && asked.length === 0 && sNo.stats.downloads === 0 && sNo.stats.sessions === 0, [logNo, asked, sNo.stats]);
  check('without a selection the layers, history and pixels stay as they were', sNo.layers.join() === 'Background' && sNo.hist === sNo0.hist && sNo.hi === sNo0.hi && cNo.outside === 0 && cNo.inside === 0, [sNo0, sNo, cNo]);

  note('no selection', { out: rNo, plan: planNo, toasts: logNo.toasts.length, dialogs: logNo.opened, requests: asked.length, downloads: sNo.stats.downloads, changed: cNo.outside + cNo.inside });

  await A.ev(() => window.T.rough(600, 450, 'Grain'));
  await A.settle(300);
  const box = await A.select([220, 160], [380, 290]);
  check('the marquee selected the hole', box && Math.abs(box.w - 160) <= 4 && Math.abs(box.h - 130) <= 4, box);
  await A.ev(() => window.T.keep('grad'));
  const s0 = await A.state();

  await A.page.route(/migan_pipeline_v2\.onnx/, (r) => r.abort());
  await A.menuFill();
  const sFail = await A.state();
  const failToasts = await A.ev(() => window.T.log.toasts.slice());
  check('a failed download shows a plain toast', failToasts[failToasts.length - 1] === NO_DOWNLOAD, failToasts);
  check('a failed download adds nothing', sFail.layers.length === 1 && sFail.hist === s0.hist && sFail.stats.sessions === 0, sFail);
  check('the progress dialog is gone after a failure', (await A.page.locator('.aidialog').count()) === 0, null);
  await A.page.unroute(/migan_pipeline_v2\.onnx/);

  times.first = await A.menuFill();
  const s1 = await A.state();
  const texts = await A.ev(() => window.T.log.texts.slice());
  const what1 = await A.ev(() => window.T.log.what.slice());
  check('the next attempt after a failure works', s1.stats.sessions === 1 && s1.stats.runs === 1, s1.stats);
  check('a selection on solid picture is replaced, and the dialog says so', what1.join() === REPLACE && s1.stats.plan.kind === 'replace', [what1, s1.stats.plan.kind]);
  check('the dialog reports the download with a percentage', texts.some((t) => /^Getting the AI ready — 43 MB, first time only\|\d+%$/.test(t)), texts);
  check('the dialog then says Filling…', texts.includes('Filling…|'), texts);
  check('files come from ' + (local ? 'next to the page' : 'the public URLs'), s1.stats.home === (local ? 'local' : 'public'), s1.stats);
  check('inference runs in a worker', s1.stats.worker === true, s1.stats);
  check('a new layer AI Fill sits on top and is active', s1.layers.join() === 'Background,AI Fill' && s1.active === 'AI Fill', s1);
  check('history ends with AI Fill, one step', s1.last === 'AI Fill' && s1.hist === s0.hist + 1, s1);
  check('the selection stays', JSON.stringify(s1.sel) === JSON.stringify(s0.sel), [s0.sel, s1.sel]);
  const c1 = await A.ev((b) => window.T.compare('grad', b), box);
  const m1 = await A.ev((b) => window.T.stats('grad', b), box);
  check('the filled hole keeps the colour of its surroundings', m1.off <= 25, m1);
  check('the fill has the grain of its surroundings', m1.detailIn >= 0.6 * m1.detailOut && m1.detailIn <= 1.6 * m1.detailOut, m1);
  check('every pixel outside the selection is bit-identical', c1.outside === 0 && c1.inside > 0, c1);
  await A.shot('ai-gradient');
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  const sU = await A.state();
  const cU = await A.ev((b) => window.T.compare('grad', b), box);
  check('undo removes the AI Fill layer', sU.layers.join() === 'Background' && cU.inside === 0 && cU.outside === 0, [sU.layers, cU]);
  await A.page.keyboard.press('Control+Shift+z');
  await A.settle(300);
  const sR = await A.state();
  check('redo brings it back', sR.layers.join() === 'Background,AI Fill' && sR.last === 'AI Fill', sR);

  times.repeat = await A.menuFill();
  const s2 = await A.state();
  check('a second fill does not download or create a session again', s2.stats.downloads === s1.stats.downloads && s2.stats.sessions === 1 && s2.stats.runs === 2, s2.stats);
  check('a second fill is faster', times.repeat < times.first, times);
  check('the second layer sits above the first', s2.layers.join() === 'Background,AI Fill,AI Fill' && s2.activeIndex === 2, s2);

  await A.page.keyboard.press('Control+z');
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  const nd = await A.closed();
  await A.menu(['Edit', 'Fill…']);
  await A.settle(200);
  const options = await A.page.locator('.dialog select option').allTextContents();
  check('Fill… offers Content-Aware (AI)', options.includes('Content-Aware (AI)'), options);
  await A.page.locator('.dialog select').selectOption('ai');
  await A.page.locator('.dialog input.slider').first().evaluate((el) => {
    el.value = 30;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await A.page.locator('.dialog .btn.primary').click();
  await A.waitClosed(nd);
  const sD = await A.state();
  const tD = await A.ev(() => window.T.top());
  check('Fill… ▸ Content-Aware (AI) runs AI Fill', sD.layers.join() === 'Background,AI Fill' && sD.last === 'AI Fill', sD);
  check('Fill… ▸ Content-Aware (AI) uses the Opacity field', Math.abs(tD.opacity - 0.3) < 0.01, tD);

  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  await A.ev(() => {
    window.T.add('Invert', null, { type: 'adjust', adj: { kind: 'invert', p: {} } });
    window.T.activate('Background');
    window.T.keep('adjust');
  });
  await A.settle(300);
  const rJ = await A.fill();
  const sJ = await A.state();
  const mJ = await A.ev((b) => window.T.stats('adjust', b), box);
  const cJ = await A.ev((b) => window.T.compare('adjust', b), box);
  check('with an adjustment layer above, the fill goes on top and is not adjusted twice', rJ.out === 'done' && sJ.layers.join() === 'Background,Invert,AI Fill' && mJ.off <= 25 && cJ.outside === 0, [rJ, sJ.layers, mJ, cJ]);

  await A.ev(() => {
    window.T.grad(600, 450, 'Clip');
    window.T.add('Shape', (g) => { g.fillStyle = '#fff'; g.fillRect(100, 100, 300, 300); });
    window.T.add('Clipped', (g) => { g.fillStyle = '#00f'; g.fillRect(0, 0, 600, 450); }, { clip: true });
    window.T.activate('Shape');
    window.T.sel(440, 290, 80, 80);
    window.T.keep('clip');
  });
  await A.settle(300);
  const rQ = await A.fill();
  const sQ = await A.state();
  const cQ = await A.ev(() => window.T.compare('clip', { x: 440, y: 290, w: 80, h: 80 }));
  const tQ = await A.ev(() => window.T.top());
  check('a clipping group below stays intact', rQ.out === 'done' && sQ.layers.join() === 'Background,Shape,Clipped,AI Fill' && tQ.clip === false && cQ.outside === 0, [rQ, sQ.layers, tQ, cQ]);

  await A.ev(() => {
    window.T.grad(600, 450, 'Covered');
    window.T.add('Photo', (g) => {
      g.fillStyle = '#888';
      g.fillRect(0, 0, 600, 450);
      g.fillStyle = '#c00';
      g.beginPath();
      g.arc(300, 220, 40, 0, 7);
      g.fill();
    });
    window.T.activate('Background');
    window.T.sel(240, 160, 120, 120);
    window.T.keep('covered');
  });
  await A.settle(300);
  const rV = await A.fill();
  const cV = await A.ev(() => window.T.compare('covered', { x: 240, y: 160, w: 120, h: 120 }));
  check('with a lower layer active the fill is still visible', rV.out === 'done' && cV.now.join() === '136,136,136,255' && cV.outside === 0, [rV, cV]);

  const runs0 = (await A.state()).stats.runs;
  await A.ev(() => {
    window.T.flat('Flat');
    window.T.sel(350, 350, 200, 200);
    window.T.keep('flat');
  });
  await A.settle(300);
  const rG = await A.fill();
  const flatSeen = await A.ev(() => window.T.colours({ x: 350, y: 350, w: 200, h: 200 }).seen);
  check('flat artwork comes back exactly flat', rG.out === 'done' && Object.keys(flatSeen).join() === '20,120,130', [rG, flatSeen]);
  await A.shot('ai-flat');
  await A.ev(() => {
    window.T.halves('Halves');
    window.T.sel(300, 200, 300, 300);
  });
  await A.settle(300);
  const rH = await A.fill();
  const halves = await A.ev(() => window.T.colours({ x: 300, y: 200, w: 300, h: 300 }));
  check('a hard edge in flat artwork continues sharp and straight', rH.out === 'done' && Object.keys(halves.seen).sort().join('|') === '244,208,63|31,58,147' && halves.edgeOff <= 2, [rH, halves]);
  await A.ev(() => {
    window.T.grad(600, 450, 'Smooth');
    window.T.sel(200, 150, 200, 150);
    window.T.keep('smooth');
  });
  await A.settle(300);
  const rW = await A.fill();
  const mW = await A.ev(() => window.T.stats('smooth', { x: 200, y: 150, w: 200, h: 150 }));
  check('a smooth gradient is continued without invented detail', rW.out === 'done' && mW.worst <= 12, [rW, mW]);
  check('flat and smooth fills do not need the model', (await A.state()).stats.runs === runs0, [runs0, (await A.state()).stats.runs]);

  await A.ev(() => window.T.grad(600, 450, 'Feather'));
  await A.settle(300);
  await A.select([200, 150], [400, 300], 14);
  await A.ev(() => window.T.keep('feather'));
  const rF = await A.fill();
  const f = await A.ev(() => window.T.feather());
  check('a feathered selection is filled', rF.out === 'done' && f.partial > 500, [rF, f]);
  check('the layer alpha is the selection coverage', f.sameBox && f.diff <= 1, f);
  check('a feathered fill has no hard seam', f.jump <= 8, f);
  const cF = await A.ev(() => window.T.compare('feather', window.app.doc.sel.b));
  check('a feathered fill leaves everything outside untouched', cF.outside === 0 && cF.off <= 25, cF);
  await A.shot('ai-feather');

  await A.ev(() => {
    const d = window.T.grad(500, 400, 'Blanks');
    window.T.keep('truth');
    const l = d.layers[0];
    const g = l.canvas.getContext('2d');
    g.globalCompositeOperation = 'destination-out';
    g.filter = 'blur(3px)';
    g.fillRect(360, -30, 180, 160);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    l.ver++;
    d.touch('all');
    window.T.keep('blanks');
    window.app.api.run('selAll');
    window.T.log.what.length = 0;
  });
  await A.settle(300);
  const sB0 = await A.state();
  const rB = await A.fill();
  const sB = await A.state();
  const cB = await A.ev(() => window.T.compare('blanks', null));
  const corner = await A.ev(() => window.T.compare('truth', { x: 400, y: 10, w: 80, h: 80 }));
  const whatB = await A.ev(() => window.T.log.what.slice());
  check('Select All fills the blanks with a layer on top', rB.out === 'done' && sB.stats.plan.kind === 'holes' && sB.layers.join() === 'Background,AI Fill' && sB.active === 'AI Fill', [rB, sB.layers, sB.active]);
  check('the dialog says the empty space inside the selection is being filled', whatB.join() === HOLES, whatB);
  check('the document is fully opaque afterwards', cB.alphaMin === 255, cB);
  check('every previously opaque pixel is unchanged', cB.opaqueChanged === 0, cB);
  check('the filled corner continues the picture', corner.off <= 45, corner);
  check('the blanks fill is one history step', sB.last === 'AI Fill' && sB.hist === sB0.hist + 1, sB);
  await A.shot('ai-blanks');
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  check('undo removes the layer again', (await A.state()).layers.join() === 'Background', null);

  await A.ev(() => {
    const d = window.T.rough(900, 700, 'Corners');
    const l = d.layers[0];
    const g = l.canvas.getContext('2d');
    g.clearRect(0, 0, 120, 100);
    g.clearRect(790, 610, 110, 90);
    l.ver++;
    d.touch('all');
    window.T.keep('corners');
    window.T.log.texts.length = 0;
  });
  await A.settle(300);
  await A.menu(['Select', 'All']);
  await A.settle(300);
  const sK0 = await A.state();
  const rK = await A.fill();
  const sK = await A.state();
  const cK = await A.ev(() => window.T.compare('corners', null));
  const textsK = await A.ev(() => window.T.log.texts.slice());
  check('two separate blanks are filled one after the other', rK.out === 'done' && sK.stats.runs === sK0.stats.runs + 2 && textsK.includes('Filling… 2 of 2|'), [rK, sK.stats, textsK]);
  check('Select ▸ All fills every empty area in one layer and one history step', sK.stats.plan.kind === 'holes' && cK.alphaMin === 255 && cK.opaqueChanged === 0 && sK.layers.join() === 'Background,AI Fill' && sK.hist === sK0.hist + 1 && sK0.last === 'Select All', [cK, sK]);
  note('Select ▸ All with two empty corners', { kind: sK.stats.plan.kind, alphaMin: cK.alphaMin, opaqueChanged: cK.opaqueChanged, runs: sK.stats.runs - sK0.stats.runs });
  await A.shot('ai-corners');

  await A.ev(() => {
    window.T.rough(900, 700, 'Edge');
    window.T.sel(0, 250, 200, 200);
    window.T.keep('edge');
  });
  await A.settle(300);
  const rX = await A.fill();
  const sX = await A.state();
  const mX = await A.ev(() => window.T.stats('edge', { x: 0, y: 250, w: 200, h: 200 }));
  check('a hole at the page edge is still given to the model', rX.out === 'done' && sX.stats.plan.comps[0].model >= 0.75 && mX.off <= 25, [rX, sX.stats.plan.comps, mX]);

  await A.ev(() => {
    const d = window.app.api.newDoc({ w: 900, h: 600, dpi: 72, bg: 'transparent', name: 'Beside' });
    const l = d.layers[0];
    l.canvas = document.createElement('canvas');
    l.canvas.width = 900;
    l.canvas.height = 600;
    const g = l.canvas.getContext('2d');
    const a = g.createLinearGradient(0, 0, 0, 600);
    a.addColorStop(0, 'rgb(60,197,90)');
    a.addColorStop(1, 'rgb(130,190,110)');
    g.fillStyle = a;
    g.fillRect(0, 0, 300, 600);
    l.ver++;
    d.touch('all');
    window.T.sel(310, 250, 100, 100);
    window.T.keep('beside');
  });
  await A.settle(300);
  const runsY = (await A.state()).stats.runs;
  const rYy = await A.fill();
  const beside = await A.ev(() => [window.app.api.pixel(360, 300), window.app.api.pixel(290, 300)]);
  const farY = Math.max(...[0, 1, 2].map((k) => Math.abs(beside[0][k] - beside[1][k])));
  check('an empty area beside a smooth picture gets its colour, not a texture', rYy.out === 'done' && beside[0][3] === 255 && farY <= 20 && (await A.state()).stats.runs === runsY, [rYy, beside]);

  await A.ev(() => {
    const d = window.T.rough(600, 450, 'Two holes');
    window.T.keep('two:whole');
    window.T.cut(d, [[120, 120, 90, 70], [400, 260, 90, 70]]);
    window.T.keep('two');
    window.T.log.what.length = 0;
  });
  await A.settle(300);
  const loop = await A.lasso([[96, 98], [170, 86], [246, 102], [252, 160], [236, 214], [150, 226], [92, 196]]);
  const sH0 = await A.state();
  await A.menuFill();
  const sH = await A.state();
  const aH = await A.ev(() => window.T.audit('two'));
  const nearH = await A.ev(() => window.T.region({ x: 120, y: 120, w: 90, h: 70 }));
  const farH = await A.ev(() => window.T.region({ x: 400, y: 260, w: 90, h: 70 }));
  const mH = await A.ev(() => window.T.stats('two:whole', { x: 120, y: 120, w: 90, h: 70 }));
  const whatH = await A.ev(() => window.T.log.what.slice());
  check('the lasso was drawn loosely around one hole with the mouse', !!loop && loop.w > 130 && loop.h > 110 && sH0.last === 'Lasso' && aH.opaqueInside > 5000, [loop, sH0.last, aH.opaqueInside]);
  check('a lasso around one of two holes fills only that hole', sH.stats.plan.kind === 'holes' && nearH.alphaMin === 255 && aH.changed === 6300 && aH.unfilled === 0 && JSON.stringify(aH.layer) === JSON.stringify({ x: 120, y: 120, w: 90, h: 70 }), [sH.stats.plan.kind, nearH, aH]);
  check('the other hole is still fully transparent', farH.alphaMax === 0 && aH.outsideChanged === 0 && aH.beyond === 0, [farH, aH]);
  check('every opaque pixel is bit-identical, the picture inside the lasso included', aH.opaqueChanged === 0 && aH.onOpaque === 0, aH);
  check('the dialog says the empty space inside the selection is filled', whatH.join() === HOLES, whatH);
  check('the hole inside the lasso gets the colour and grain around it', mH.off <= 25 && mH.detailIn >= 0.6 * mH.detailOut && mH.detailIn <= 1.6 * mH.detailOut, mH);
  check('filling a hole is one layer on top, one history step, and the lasso stays', sH.layers.join() === 'Background,AI Fill' && sH.active === 'AI Fill' && sH.hist === sH0.hist + 1 && JSON.stringify(sH.sel) === JSON.stringify(sH0.sel), [sH0, sH]);
  note('lasso around one of two holes', { lasso: loop, kind: sH.stats.plan.kind, layer: aH.layer, changed: aH.changed, opaqueInLasso: aH.opaqueInside, opaqueChanged: aH.opaqueChanged, outsideChanged: aH.outsideChanged, filledHole: nearH, otherHole: farH, colour: mH });
  await A.ev(() => window.app.api.run('deselect'));
  await A.settle(200);
  await A.shot('ai-one-hole');

  await A.ev(() => {
    window.T.side('Across');
    window.T.keep('across');
  });
  await A.settle(300);
  const loopX = await A.lasso([[190, 210], [330, 150], [470, 190], [500, 330], [400, 430], [230, 410]]);
  const rAx = await A.fill();
  const sAx = await A.state();
  const aAx = await A.ev(() => window.T.audit('across'));
  const restAx = await A.ev(() => window.T.region({ x: 520, y: 0, w: 380, h: 600 }));
  const pxAx = await A.ev(() => [window.app.api.pixel(330, 300), window.app.api.pixel(290, 300)]);
  const stepAx = Math.max(...[0, 1, 2].map((k) => Math.abs(pxAx[0][k] - pxAx[1][k])));
  check('a lasso from the picture into empty space fills only the empty part inside it', rAx.out === 'done' && sAx.stats.plan.kind === 'holes' && !!loopX && loopX.x < 300 && loopX.x + loopX.w > 450 && aAx.opaqueInside > 5000 && aAx.changed > 20000 && aAx.unfilled === 0 && aAx.layer.x >= 299 && pxAx[0][3] === 255 && stepAx <= 20, [rAx, loopX, aAx, pxAx]);
  check('the cut along the lasso is anti-aliased and nothing lies beyond it', aAx.partial > 100 && aAx.alphaOff <= 1 && aAx.pageOff <= 1 && aAx.beyond === 0, aAx);
  check('nothing outside the lasso changes and the rest of the empty area stays empty', aAx.outsideChanged === 0 && aAx.opaqueChanged === 0 && aAx.onOpaque === 0 && restAx.alphaMax === 0, [aAx, restAx]);
  note('lasso from picture into empty space', { lasso: loopX, kind: sAx.stats.plan.kind, layer: aAx.layer, changed: aAx.changed, opaqueInLasso: aAx.opaqueInside, partialEdgePixels: aAx.partial, alphaOff: aAx.alphaOff, beyond: aAx.beyond, outsideChanged: aAx.outsideChanged, opaqueChanged: aAx.opaqueChanged, restAlphaMax: restAx.alphaMax, stepAtPictureEdge: stepAx });
  await A.shot('ai-across');

  await A.ev(() => {
    const d = window.T.grad(600, 450, 'Feathered hole');
    window.T.keep('fh:whole');
    window.T.cut(d, [[250, 180, 100, 80]]);
  });
  await A.settle(300);
  await A.select([240, 170], [360, 270]);
  await A.menu(['Select', 'Feather…']);
  await A.settle(200);
  await A.page.locator('.dialog input.slider').first().evaluate((el) => {
    el.value = 12;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await A.page.locator('.dialog .btn.primary').click();
  await A.settle(400);
  await A.ev(() => window.T.keep('fh'));
  const sFh0 = await A.state();
  const rFh = await A.fill();
  const sFh = await A.state();
  const aFh = await A.ev(() => window.T.audit('fh', 'fh:whole'));
  const midFh = await A.ev(() => window.app.api.pixel(300, 220));
  check('Select ▸ Feather… feathered the selection around the hole', sFh0.last === 'Feather' && sFh0.sel.w > 130, sFh0);
  check('a feathered selection around a hole fades the fill with the coverage', rFh.out === 'done' && sFh.stats.plan.kind === 'holes' && aFh.partial > 500 && aFh.alphaOff <= 1 && aFh.pageOff <= 1 && midFh[3] === 255, [rFh, aFh, midFh]);
  check('a feathered fill touches no solid picture and nothing outside the selection', aFh.opaqueChanged === 0 && aFh.onOpaque === 0 && aFh.beyond === 0 && aFh.outsideChanged === 0 && aFh.fillOff <= 12, aFh);
  note('feathered selection around a hole', { sel: sFh0.sel, kind: sFh.stats.plan.kind, partial: aFh.partial, alphaOff: aFh.alphaOff, pageOff: aFh.pageOff, fillOff: aFh.fillOff, opaqueChanged: aFh.opaqueChanged, middle: midFh });
  await A.shot('ai-feathered-hole');

  await A.ev(() => {
    const d = window.T.grad(500, 400, 'Soft edge');
    window.T.keep('soft:whole');
    const l = d.layers[0];
    const g = l.canvas.getContext('2d');
    g.globalCompositeOperation = 'destination-out';
    g.filter = 'blur(3px)';
    g.fillRect(200, 150, 120, 100);
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
    l.ver++;
    d.touch('all');
    window.T.sel(170, 120, 180, 160);
    window.T.keep('soft');
  });
  await A.settle(300);
  const rSo = await A.fill();
  const sSo = await A.state();
  const aSo = await A.ev(() => window.T.audit('soft', 'soft:whole'));
  const inSo = await A.ev(() => window.T.region({ x: 170, y: 120, w: 180, h: 160 }));
  check('a semi-transparent picture edge inside the selection keeps its colour over the fill', rSo.out === 'done' && sSo.stats.plan.kind === 'holes' && aSo.soft > 500 && inSo.alphaMin === 255 && aSo.edgeOff <= 12 && aSo.fillOff <= 12 && aSo.opaqueChanged === 0, [rSo, aSo, inSo]);
  note('semi-transparent picture edge', { kind: sSo.stats.plan.kind, softPixels: aSo.soft, edgeOff: aSo.edgeOff, fillOff: aSo.fillOff, alphaMin: inSo.alphaMin, opaqueChanged: aSo.opaqueChanged });
  await A.shot('ai-soft-edge');

  await A.ev(() => {
    window.T.cut(window.T.rough(600, 450, 'Mixed'), [[250, 180, 100, 80]]);
    window.T.sel(220, 150, 160, 140);
    window.T.keep('mixed');
    window.T.log.what.length = 0;
  });
  await A.settle(300);
  const planMx = await A.ev(() => window.app.api.ai.plan(window.app.doc));
  const nMx = await A.closed();
  await A.fillDialog();
  await A.waitClosed(nMx);
  const sMx = await A.state();
  const aMx = await A.ev(() => window.T.audit('mixed'));
  const whatMx = await A.ev(() => window.T.log.what.slice());
  check('left to itself AI Fill would fill only the hole in that selection', planMx.kind === 'holes' && JSON.stringify(planMx.box) === JSON.stringify({ x: 250, y: 180, w: 100, h: 80 }), planMx);
  check('Fill… ▸ Content-Aware (AI) replaces everything inside a selection with picture and empty space', sMx.stats.plan.kind === 'replace' && whatMx.join() === REPLACE && JSON.stringify(aMx.layer) === JSON.stringify({ x: 220, y: 150, w: 160, h: 140 }) && aMx.coverOff <= 1 && aMx.onOpaque === 160 * 140 - 8000 && aMx.opaqueChanged > 10000 && aMx.outsideChanged === 0, [sMx.stats.plan.kind, whatMx, aMx]);
  note('Fill… Content-Aware on picture and empty space', { auto: planMx.kind, autoBox: planMx.box, kind: sMx.stats.plan.kind, layer: aMx.layer, coverOff: aMx.coverOff, pictureReplaced: aMx.onOpaque, opaqueChanged: aMx.opaqueChanged, outsideChanged: aMx.outsideChanged });
  await A.shot('ai-mixed-replace');

  await A.ev(() => {
    window.T.rough(600, 450, 'Solid');
    window.T.sel(220, 150, 160, 140);
  });
  await A.settle(300);
  const sSd0 = await A.state();
  const tSd = (await A.toasts()).length;
  const rSd = await A.fill({ mode: 'holes' });
  const sSd = await A.state();
  const toastsSd = await A.toasts(tSd);
  check('{mode: holes} on a solid selection says nothing is empty', rSd.out === 'solid' && toastsSd.join('|') === NOT_EMPTY && sSd.hist === sSd0.hist && sSd.layers.length === 1 && sSd.stats.runs === sSd0.stats.runs, [rSd, toastsSd, sSd]);
  await A.ev(() => window.T.sel(700, 500, 50, 50));
  const tOut = (await A.toasts()).length;
  const rOut = await A.fill();
  const toastsOut = await A.toasts(tOut);
  note('forced holes on solid, and a selection outside the page', { solid: rSd.out, outside: rOut.out });
  check('a selection outside the page is called empty', rOut.out === 'nothing' && toastsOut.join('|') === EMPTY_SEL && (await A.state()).hist === sSd0.hist, [rOut, toastsOut]);

  await A.ev(() => {
    const d = window.T.grad(600, 450, 'Visible');
    window.T.add('Sheer', (g) => { g.fillStyle = 'rgb(30,60,200)'; g.fillRect(360, 230, 120, 120); }, { opacity: 0.5 });
    window.T.add('Hidden', (g) => { g.fillStyle = 'rgb(255,0,0)'; g.fillRect(80, 80, 120, 120); }, { visible: false });
    window.T.keep('vis:whole');
    window.T.cut(d, [[100, 100, 80, 80], [380, 250, 80, 80]]);
    window.T.activate('Background');
    window.T.sel(60, 60, 440, 310);
    window.T.keep('vis');
  });
  await A.settle(300);
  const wasVis = await A.ev(() => [window.app.api.pixel(140, 140), window.app.api.pixel(420, 290)]);
  const rVis = await A.fill();
  const sVis = await A.state();
  const aVis = await A.ev(() => window.T.audit('vis', 'vis:whole'));
  const inVis = await A.ev(() => window.T.region({ x: 60, y: 60, w: 440, h: 310 }));
  const nowVis = await A.ev(() => [window.app.api.pixel(140, 140), window.app.api.pixel(420, 290), window.app.api.pixel(370, 290), window.app.api.pixel(470, 290)]);
  const kVis = wasVis[1][3] / 255;
  const offVis = Math.max(...[0, 1, 2].map((k) => Math.abs(nowVis[1][k] - (wasVis[1][k] * kVis + ((nowVis[2][k] + nowVis[3][k]) / 2) * (1 - kVis)))));
  check('a hidden layer over a hole does not count: the hole is filled from the picture', rVis.out === 'done' && sVis.stats.plan.kind === 'holes' && wasVis[0][3] === 0 && nowVis[0][3] === 255 && nowVis[0][0] < 200 && aVis.fillOff <= 12, [rVis, wasVis, nowVis, aVis]);
  check('a half-opaque layer over a hole keeps its colour over the fill of what is visible around it', wasVis[1][3] > 120 && wasVis[1][3] < 136 && nowVis[1][3] === 255 && offVis <= 12 && inVis.alphaMin === 255, [wasVis, nowVis, offVis, aVis, inVis]);
  console.log('info half-opaque layer over a hole: ' + JSON.stringify({ was: wasVis[1], now: nowVis[1], around: [nowVis[2], nowVis[3]], offFromRule: offVis, offFromLayeredTruth: aVis.edgeOff }));
  check('with hidden and half-opaque layers the solid picture stays bit-identical', aVis.opaqueChanged === 0 && aVis.onOpaque === 0 && aVis.outsideChanged === 0 && sVis.layers.join() === 'Background,Sheer,Hidden,AI Fill', [aVis, sVis.layers]);
  note('hidden and half-opaque layers', { kind: sVis.stats.plan.kind, hiddenHole: [wasVis[0], nowVis[0]], fillOff: aVis.fillOff, opaqueChanged: aVis.opaqueChanged, alphaMin: inVis.alphaMin });
  await A.shot('ai-visible');

  await A.ev(() => {
    window.app.api.newDoc({ w: 300, h: 200, dpi: 72, bg: 'transparent', name: 'Empty' });
    window.app.api.run('selAll');
  });
  await A.settle(200);
  const sE0 = await A.state();
  const tE = (await A.toasts()).length;
  const rE = await A.fill();
  const toastsE0 = await A.toasts(tE);
  check('an empty page is refused with its own message', rE.out === 'empty' && toastsE0.join('|') === NO_PICTURE && (await A.state()).hist === sE0.hist, [rE, toastsE0]);
  await A.ev(() => {
    const d = window.T.grad(400, 300, 'Sheer');
    const l = d.layers[0];
    const g = l.canvas.getContext('2d');
    g.clearRect(160, 110, 80, 80);
    l.opacity = 0.95;
    l.ver++;
    d.touch('all');
    window.T.keep('sheer');
    window.app.api.run('selAll');
  });
  await A.settle(200);
  const rS = await A.fill();
  const hole = await A.ev(() => window.app.api.pixel(200, 150));
  check('a slightly see-through picture still counts as picture', rS.out === 'done' && hole[3] === 255, [rS, hole]);

  await A.ev(() => window.T.grad(600, 450, 'Typing'));
  await A.settle(300);
  await A.select([220, 160], [380, 290]);
  await A.ev(() => window.app.api.setTool('text'));
  await A.settle(300);
  const at = await A.ev(() => window.app.api.toClient(60, 60));
  await A.page.mouse.click(at.x, at.y);
  await A.settle(300);
  await A.page.keyboard.type('Hi');
  await A.settle(200);
  const sT0 = await A.state();
  await A.menuFill();
  const sT = await A.state();
  check('AI Fill while typing finishes the text first', sT0.modal === true && sT.modal === false && sT.names.slice(-2).join() === 'Type Tool,AI Fill' && sT.layers.length === 3 && sT.active === 'AI Fill', [sT0, sT]);
  await A.page.keyboard.press('Control+z');
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  const sT2 = await A.state();
  check('undoing both steps leaves a clean document', sT2.layers.join() === 'Background' && sT2.hi === sT0.hi && sT2.modal === false, sT2);
  await A.ev(() => { window.app.api.run('deselect'); });
  await A.settle(200);
  await A.page.mouse.click(at.x, at.y);
  await A.settle(300);
  await A.page.keyboard.type('Yo');
  await A.settle(200);
  const sM0 = await A.state();
  const rM = await A.ev(() => window.app.api.run('aiFill'));
  const sM = await A.state();
  check('without a selection a text edit stays open and nothing is committed', rM === 'select' && sM0.modal === true && sM.modal === true && sM.hi === sM0.hi && sM.hist === sM0.hist && sM.sel === null, [rM, sM0, sM]);
  await A.page.keyboard.press('Escape');
  await A.settle(200);
  await A.ev(() => window.app.api.setTool('marquee'));

  await A.ev(() => {
    const d = window.T.rough(2625, 3375, 'Yearbook');
    const l = d.layers[0];
    const g = l.canvas.getContext('2d');
    for (const [x, y] of [[300, 1800], [2200, 1750], [400, 3100], [2100, 3150], [1300, 2400]]) g.clearRect(x, y, 60, 60);
    l.ver++;
    d.touch('all');
    window.T.keep('holes');
    window.app.api.run('selAll');
  });
  await A.settle(500);
  const rO = await A.fill();
  const sO = await A.state();
  const cO = await A.ev(() => window.T.compare('holes', null));
  const mO = await A.ev(() => window.T.stats('holes', { x: 1300, y: 2400, w: 60, h: 60 }));
  const planO = sO.stats.plan;
  check('five far-apart small holes are each filled at full resolution', rO.out === 'done' && planO.comps.length === 5 && planO.comps.every((c) => c.scale === 1) && planO.windows.every((w) => w.scale === 1 && w.w <= 512 && w.h <= 512) && planO.runs === 5, [rO, planO]);
  check('the small holes are opaque and textured like the page', cO.alphaMin === 255 && cO.opaqueChanged === 0 && mO.detailIn >= 0.5 * mO.detailOut, [cO, mO]);
  check('the page stays responsive while it fills', rO.gap < 400, rO);
  times.fiveHoles = rO.ms;
  note('Select All on the yearbook page', { kind: planO.kind, took: planO.took, ms: rO.ms, gap: rO.gap });
  times.longestPause = rO.gap;

  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  await A.ev(() => {
    const spots = [];
    for (let i = 0; i < 14; i++) spots.push([200 + ((i * 617) % 2200), 300 + ((i * 1171) % 2700)]);
    window.T.spots = spots;
    window.T.sel(0, 0, 2625, 3375, (g) => {
      for (const [x, y] of spots) {
        g.beginPath();
        g.arc(x, y, 22, 0, 7);
        g.fill();
      }
    });
    window.T.keep('spots');
  });
  await A.settle(300);
  const rZ = await A.fill();
  const sZ = await A.state();
  const mZ = await A.ev(() => window.T.stats('spots', { x: window.T.spots[3][0] - 12, y: window.T.spots[3][1] - 12, w: 24, h: 24 }));
  const planZ = sZ.stats.plan;
  check('fourteen scattered spots share the run budget without one low-resolution blob', rZ.out === 'done' && planZ.runs <= 12 && planZ.comps.length >= 10 && planZ.comps.every((c) => c.scale >= 0.4) && mZ.detailIn >= 0.5 * mZ.detailOut, [rZ, planZ.runs, planZ.comps.map((c) => c.scale), mZ]);
  times.spots = rZ.ms;

  await A.ev(() => window.T.grad(2625, 3375, 'Smooth page'));
  await A.settle(500);
  const big = await A.select([900, 1300], [1600, 2000]);
  await A.ev(() => window.T.keep('big'));
  const runsBig = (await A.state()).stats.runs;
  const rBig = await A.fill();
  times.big = rBig.ms;
  const mBig = await A.ev((b) => window.T.stats('big', b), big);
  const cBig = await A.ev((b) => window.T.compare('big', b), big);
  check('a 700 px hole in a smooth 2625×3375 page is continued without the model', rBig.out === 'done' && Math.abs(big.w - 700) < 30 && mBig.worst <= 12 && cBig.outside === 0 && (await A.state()).stats.runs === runsBig, [rBig, big, mBig, cBig]);

  await A.ev(() => window.T.rough(2625, 3375, 'Grainy page'));
  await A.settle(500);
  const tex = await A.ev(() => window.T.sel(900, 1300, 700, 700));
  await A.ev(() => window.T.keep('tex'));
  const rTex = await A.fill();
  times.bigPhoto = rTex.ms;
  const sTex = await A.state();
  const mTex = await A.ev((b) => window.T.stats('tex', b), tex);
  const cTex = await A.ev((b) => window.T.compare('tex', b), tex);
  const textsTex = await A.ev(() => window.T.log.texts.slice(-14));
  check('a 700 px hole in a grainy page is filled in pieces within the budget', rTex.out === 'done' && sTex.stats.plan.runs > 1 && sTex.stats.plan.runs <= 12 && textsTex.some((t) => /^Filling… \d+ of \d+\|$/.test(t)), [rTex, sTex.stats.plan.runs, textsTex]);
  check('the model never sees more than 512 px', sTex.stats.maxSide <= 512 && sTex.stats.plan.windows.every((w) => Math.round(w.w * w.scale) <= 512 && Math.round(w.h * w.scale) <= 512), [sTex.stats.maxSide, sTex.stats.plan.windows]);
  check('the pieces match the page in colour and grain', mTex.off <= 25 && cTex.outside === 0 && mTex.detailIn >= 0.6 * mTex.detailOut && mTex.detailIn <= 1.6 * mTex.detailOut, [mTex, cTex]);
  await A.shot('ai-big');
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  await A.ev(() => window.T.sel(500, 700, 1600, 1800));
  const planHuge = await A.ev(() => window.app.api.ai.plan(window.app.doc));
  check('a 1600 px hole is planned at a coarser scale inside the budget', planHuge.runs >= 1 && planHuge.runs <= 12 && planHuge.comps[0].scale < 1 && planHuge.windows.every((w) => Math.round(w.w * w.scale) <= 512), planHuge);

  await A.ev(() => window.T.rough(600, 450, 'Cancel'));
  await A.settle(300);
  await A.select([220, 160], [380, 290]);
  await A.ev(() => window.T.keep('cancel'));
  const sC0 = await A.state();
  const tC = await A.ev(() => window.T.log.toasts.length);
  const nC = await A.closed();
  await A.menu(['Edit', 'AI Fill']);
  await A.page.waitForFunction(() => { const t = document.querySelector('.aitext'); return t && t.textContent === 'Filling…'; }, null, { timeout: 60000 });
  await A.page.locator('.aidialog .btn', { hasText: 'Cancel' }).click();
  await A.waitClosed(nC);
  await A.settle(3500);
  const sC = await A.state();
  const cC = await A.ev(() => window.T.compare('cancel', null));
  const toastsC = await A.ev((n) => window.T.log.toasts.slice(n), tC);
  check('Cancel during the fill leaves the document untouched', sC.layers.join() === 'Background' && sC.hist === sC0.hist && cC.outside === 0 && sC.stats.runs === sC0.stats.runs, [sC, cC]);
  check('Cancel shows no toast', toastsC.length === 0, toastsC);
  const rC = await A.fill();
  const sC2 = await A.state();
  check('a fill after Cancel works without downloading again', rC.out === 'done' && sC2.layers.join() === 'Background,AI Fill' && sC2.stats.downloads === sC0.stats.downloads, [rC, sC2.stats]);
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  const early = await A.ev(async () => {
    const p = window.app.api.ai.fill(window.app.doc);
    document.querySelector('.aidialog .btn').click();
    const out = await p;
    const runs = window.app.api.ai.state.stats.runs;
    await new Promise((r) => setTimeout(r, 3000));
    return { out, runs, later: window.app.api.ai.state.stats.runs };
  });
  check('Cancel right at the start does not leave a model run behind', early.out === 'cancel' && early.later === early.runs && early.runs === sC2.stats.runs, [early, sC2.stats.runs]);

  const bad = await A.ev(async () => {
    const api = window.app.api;
    api.ai.reset();
    api.ai.state.noWorker = true;
    const c = await caches.open('picture-market-ai-1');
    const url = (await c.keys()).map((k) => k.url).find((u) => /ort-wasm-simd-threaded\.wasm$/.test(u));
    const junk = new Uint8Array(14848852).fill(66);
    junk.set([0, 0x61, 0x73, 0x6d]);
    await c.put(url, new Response(junk, { headers: { 'Content-Type': 'application/octet-stream' } }));
    const first = await api.ai.fill(window.app.doc);
    return { first, layers: window.app.doc.layers.length };
  });
  const rL = await A.fill();
  const sL = await A.state();
  const mL = await A.ev((b) => window.T.stats('cancel', b), sL.sel);
  const cL = await A.ev((b) => window.T.compare('cancel', b), sL.sel);
  check('a broken cached runtime fails once with a plain message', bad.first === 'failed' && bad.layers === 1, bad);
  check('the next try on the main thread works', rL.out === 'done' && sL.stats.worker === false && mL.off <= 25 && cL.outside === 0, [rL, sL.stats, mL, cL]);
  await A.ev(() => {
    window.app.api.ai.state.noWorker = false;
    window.app.api.ai.reset();
  });

  await A.ev(() => window.T.photo('Photo'));
  await A.settle(400);
  await A.shot('ai-photo-before');
  await A.select([405, 385], [535, 500], 3, 'ellipse');
  const rP = await A.fill();
  await A.ev(() => window.app.api.run('deselect'));
  await A.settle(300);
  await A.shot('ai-photo-after');
  check('realistic: an object is removed from a photo-like image', rP.out === 'done', rP);
  times.photo = rP.ms;

  await A.ev(() => window.T.texture('Texture'));
  await A.settle(400);
  await A.shot('ai-texture-before');
  await A.all();
  const rT = await A.fill();
  await A.settle(300);
  await A.shot('ai-texture-after');
  const cT = await A.ev(() => { window.T.keep('tex2'); return window.T.compare('tex2', null); });
  check('realistic: a missing corner of a texture is filled', rT.out === 'done' && cT.alphaMin === 255, [rT, cT]);
  times.texture = rT.ms;

  await A.ev(() => window.T.leafy('Leafy Page'));
  await A.settle(600);
  await A.shot('ai-leafy-before');
  await A.all();
  const rY = await A.fill();
  await A.settle(400);
  await A.shot('ai-leafy-after');
  const sY = await A.state();
  const cY = await A.ev(() => { window.T.keep('leafy'); return window.T.compare('leafy', null); });
  check('realistic: a leafy frame on an empty page is continued downwards', rY.out === 'done' && sY.layers.join() === 'Leaves,AI Fill' && cY.alphaMin === 255 && sY.stats.plan.runs <= 12 && sY.stats.maxSide <= 512, [rY, sY.layers, cY, sY.stats.plan.runs]);
  times.leafy = rY.ms;
  await A.ev(() => {
    const d = window.app.api.newDoc({ w: 800, h: 1000, dpi: 72, bg: 'white', name: 'White page' });
    window.T.add('Frame', (g) => { g.fillStyle = '#284'; g.fillRect(0, 0, 800, 300); });
    return d.layers.length;
  });
  await A.settle(300);
  const tW = (await A.toasts()).length;
  await A.all();
  const sW0 = await A.state();
  const rWp = await A.fill();
  const toastsW = await A.toasts(tW);
  check('Select All on a page with nothing empty has nothing to continue from', rWp.out === 'blind' && toastsW.join('|') === NO_AROUND && (await A.state()).hist === sW0.hist, [rWp, toastsW]);
  await A.page.close();

  const B = await open(iso.url);
  const isolated = await B.ev(() => self.crossOriginIsolated);
  check('PM_ISOLATE=1 makes the page cross-origin isolated', isolated === true, isolated);
  await B.ev(() => window.T.rough(600, 450, 'Threads'));
  await B.settle(300);
  await B.select([220, 160], [380, 290]);
  await B.ev(() => window.T.keep('iso'));
  const nB = await B.closed();
  await B.menu(['Edit', 'AI Fill']);
  await B.page.locator('.aidialog .btn', { hasText: 'Cancel' }).click();
  await B.waitClosed(nB);
  await B.settle(1500);
  const sE = await B.state();
  const toastsE = await B.ev(() => window.T.log.toasts.slice());
  check('Cancel while the AI is still loading is clean', sE.layers.join() === 'Background' && sE.hist === 1 && toastsE.length === 0 && sE.stats.runs === 0, [sE, toastsE]);
  const rI = await B.fill();
  times.threaded = rI.ms;
  const sI = await B.state();
  const cI = await B.ev((b) => window.T.compare('iso', b), sI.sel);
  check('the isolated page uses more than one thread', rI.out === 'done' && sI.stats.threads > 1 && sI.stats.worker === true, [rI, sI.stats]);
  const mI = await B.ev((b) => window.T.stats('iso', b), sI.sel);
  check('the threaded result is right', mI.off <= 25 && cI.outside === 0, [mI, cI]);
  const rI2 = await B.fill();
  times.threadedRepeat = rI2.ms;
  await B.ev(() => window.app.api.setTool('text'));
  await B.settle(300);
  const fontMenu = B.page.locator('select', { has: B.page.locator('option', { hasText: /^Lobster$/ }) }).first();
  await fontMenu.selectOption('Lobster');
  const fonts = await B.ev(async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 12000 && !([...document.fonts].some((x) => /Lobster/.test(x.family) && x.status === 'loaded'))) await new Promise((r) => setTimeout(r, 100));
    await document.fonts.load('500 14px "Inter"').catch(() => {});
    const list = [...document.fonts].filter((x) => x.status === 'loaded').map((x) => x.family.replace(/"/g, ''));
    return { lobster: list.includes('Lobster'), inter: list.includes('Inter') };
  });
  check('Google Fonts still load on the isolated page', fonts.lobster && fonts.inter, fonts);
  await B.page.close();

  const single = path.join(root, 'dist', 'picture-market.html');
  const zipFile = path.join(root, 'dist', 'picture-market-netlify.zip');
  check('dist exists (run node dev/build.js first)', fs.existsSync(single) && fs.existsSync(zipFile), null);
  if (fs.existsSync(single) && fs.existsSync(zipFile)) {
    const html = fs.readFileSync(single, 'utf8');
    const ai = path.join(root, 'site', 'ai');
    const runtime = fs.readFileSync(path.join(ai, 'ort.wasm.bundle.min.mjs'), 'utf8');
    const marks = ['registerBackend', '_OrtInit', 'onnxruntime-common'].filter((m) => runtime.includes(m));
    const head = (f) => fs.readFileSync(path.join(ai, f)).subarray(0, 3000).toString('base64');
    const clean = html.length < 1500000 && marks.length > 0 && !marks.some((m) => html.includes(m)) && !html.includes(runtime.slice(2000, 2400)) && !html.includes(head('migan_pipeline_v2.onnx')) && !html.includes(head('ort-wasm-simd-threaded.wasm'));
    check('the single file holds no model or runtime bytes', clean, { size: html.length, marks });
    const entries = zipEntries(fs.readFileSync(zipFile));
    const names = entries.map((e) => e.name).sort();
    const onnx = entries.find((e) => e.name === 'ai/migan_pipeline_v2.onnx');
    check('the zip holds the page, licences, headers and the three AI files', names.join() === ZIP_NAMES.join(), names);
    check('the model is stored, the rest deflated', !!onnx && onnx.method === 0 && onnx.size === 28079181 && entries.every((e) => e === onnx || e.method === 8), entries);
    times.html = (fs.statSync(single).size / 1024).toFixed(0) + ' KB';
    times.zip = (fs.statSync(zipFile).size / 1048576).toFixed(1) + ' MB';
  }

  console.log('times ' + JSON.stringify(times));
  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
  await iso.close();
  if (fails.length || errors.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
