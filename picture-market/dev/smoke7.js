const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');

const SELECT = 'Select the area to fill first: draw around it with the Lasso, then choose AI Fill again.';
const SOLID = 'Nothing is empty inside the selection.';
const WHOLE = 'The whole picture is selected, so there is nothing left to copy from. Select just the part you want replaced.';
const EMPTY = 'There is no solid picture on this page for the AI to continue from.';

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


function morePage() {
  const api = window.app.api;
  const pixels = (d) => {
    const c = api.flatten(d);
    return c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  };
  const lum = (px, p) => 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  Object.assign(window.T, {
    brick(name) {
      const w = 800;
      const h = 600;
      const d = api.newDoc({ w, h, dpi: 72, bg: 'white', name });
      const l = d.layers[0];
      const g = l.canvas.getContext('2d');
      g.fillStyle = '#6e4a3a';
      g.fillRect(0, 0, w, h);
      let s = 99;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
      for (let row = 0, y = 0; y < h; row++, y += 40) {
        for (let x = row % 2 ? -50 : 0; x < w; x += 100) {
          const v = Math.round(rnd() * 34 - 17);
          g.fillStyle = 'rgb(' + (178 + v) + ',' + (88 + v) + ',' + (60 + v) + ')';
          g.fillRect(x + 4, y + 4, 92, 32);
        }
      }
      const img = g.getImageData(0, 0, w, h);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (rnd() - 0.5) * 24;
        img.data[i] += n;
        img.data[i + 1] += n;
        img.data[i + 2] += n;
      }
      g.putImageData(img, 0, 0);
      l.ver++;
      d.touch('all');
      return d;
    },
    blank(w, h, name) {
      return api.newDoc({ w, h, dpi: 72, bg: 'transparent', name });
    },
    mortar(box) {
      const d = window.app.doc;
      const b = pixels(d);
      let ml = 0;
      let mn = 0;
      let bl = 0;
      let bn = 0;
      for (let y = box.y; y < box.y + box.h; y++) {
        const r = y % 40;
        const isMortar = r < 3 || r > 36;
        const isBrick = r > 8 && r < 32;
        for (let x = box.x; x < box.x + box.w; x++) {
          const v = lum(b, (y * d.w + x) * 4);
          if (isMortar) { ml += v; mn++; }
          if (isBrick) { bl += v; bn++; }
        }
      }
      return Math.round((bl / Math.max(1, bn) - ml / Math.max(1, mn)) * 10) / 10;
    },
    texture2(box) {
      const d = window.app.doc;
      const b = pixels(d);
      let s = 0;
      let n = 0;
      const seen = new Set();
      let alphaMin = 255;
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w - 1; x++) {
          const p = (y * d.w + x) * 4;
          s += Math.abs(lum(b, p) - lum(b, p + 4));
          n++;
          seen.add((b[p] >> 2) + ',' + (b[p + 1] >> 2) + ',' + (b[p + 2] >> 2));
          if (b[p + 3] < alphaMin) alphaMin = b[p + 3];
        }
      }
      return { detail: Math.round((s / Math.max(1, n)) * 100) / 100, colours: seen.size, alphaMin };
    },
    hair(box, s) {
      const d = window.app.doc;
      const pad = 6;
      const W = Math.ceil((box.w + pad * 2) * s);
      const H = Math.ceil((box.h + pad * 2) * s);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      const g = c.getContext('2d');
      api.render(d, g, s, -(box.x - pad) * s, -(box.y - pad) * s);
      const a = g.getImageData(0, 0, W, H).data;
      let min = 255;
      for (let p = 3; p < a.length; p += 4) if (a[p] < min) min = a[p];
      return min;
    },
    hash() {
      const d = window.app.doc;
      const l = d.layers[d.layers.length - 1];
      const a = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height).data;
      let h = 2166136261;
      for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 16777619);
      return (h >>> 0).toString(16) + ':' + l.x + ',' + l.y + ',' + l.canvas.width + 'x' + l.canvas.height;
    },
    reddish(box) {
      const d = window.app.doc;
      const b = pixels(d);
      let n = 0;
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
          const p = (y * d.w + x) * 4;
          if (b[p] > b[p + 1] + 70 && b[p] > b[p + 2] + 70) n++;
        }
      }
      return n;
    },
    ellipse(cx0, cy0, rx, ry) {
      return window.T.sel(cx0 - rx, cy0 - ry, rx * 2, ry * 2, (g) => {
        g.beginPath();
        g.ellipse(cx0, cy0, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      });
    }
  });
}

(async () => {
  const target = process.argv[2] || 'site/index.html';
  const root = path.resolve(__dirname, '..');
  const shots = path.join(__dirname, 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const srv = await serve(root);
  const browser = await chromium.launch();
  const errors = [];
  const fails = [];
  const times = {};
  const outside = [];
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const note = (name, data) => console.log('info ' + name + ' ' + JSON.stringify(data));
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const open = async (url) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('request', (r) => {
      const u = r.url();
      if (!/^(data|blob):|127\.0\.0\.1|^file:|fonts\.(googleapis|gstatic)\.com/.test(u)) outside.push(u);
    });
    await page.goto(url);
    await page.waitForFunction(() => window.app && window.app.ready, null, { timeout: 15000 });
    await page.evaluate(inPage);
    await page.evaluate(morePage);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const settle = (ms = 150) => page.waitForTimeout(ms);
    const cli = (x, y) => ev(([x, y]) => window.app.api.toClient(x, y), [x, y]);
    const menu = async (labels) => {
      await page.locator('.mtitle', { hasText: new RegExp('^' + labels[0] + '$') }).click();
      for (let i = 1; i < labels.length; i++) {
        const it = page.locator('.menu .item .lbl', { hasText: new RegExp('^' + esc(labels[i]) + '$') }).last();
        if (i < labels.length - 1) await it.hover();
        else await it.click();
        await settle(60);
      }
    };
    const mark = () => ev(() => ({ h: window.app.doc.hi, n: window.app.doc.hist.length, t: window.T.log.toasts.length }));
    const done = (b) => page.waitForFunction((b) => {
      const d = window.app.doc;
      return (d.hi !== b.h || d.hist.length !== b.n || window.T.log.toasts.length > b.t) && !document.querySelector('.aiback');
    }, b, { timeout: 120000 });
    const menuFill = async () => {
      const b = await mark();
      const t0 = Date.now();
      await menu(['Edit', 'AI Fill']);
      await done(b);
      await settle(100);
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
    const fill = (opts) => ev((o) => window.T.fill(o), opts);
    const toasts = (n = 0) => ev((n) => window.T.log.toasts.slice(n), n);
    const state = () => ev(() => window.T.state());
    const undo = async () => { await page.keyboard.press('Control+z'); await settle(250); };
    const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
    return { page, ev, settle, menu, menuFill, mark, done, lasso, fill, toasts, state, undo, shot };
  };

  const A = await open(srv.url + target + '?test=1');

  await A.ev(() => {
    const d = window.T.rough(600, 450, 'Two holes');
    window.T.keep('truth');
    window.T.cut(d, [[120, 120, 90, 70], [380, 250, 90, 70]]);
    window.T.keep('cut');
  });
  await A.settle(300);
  const s0 = await A.state();
  const t0 = (await A.toasts()).length;
  const rNo = await A.fill();
  const sNo = await A.state();
  check('no selection: nothing is filled and the hint is shown', rNo.out === 'select' && (await A.toasts(t0)).join() === SELECT && sNo.layers.join() === 'Background' && sNo.hist === s0.hist, [rNo, sNo.layers]);
  const tm = (await A.toasts()).length;
  await A.menu(['Edit', 'AI Fill']);
  await A.settle(300);
  check('Edit > AI Fill without a selection shows the hint', (await A.toasts(tm)).join() === SELECT && (await A.ev(() => window.T.log.opened)) === 0, await A.toasts(tm));

  const loop = await A.lasso([[96, 98], [170, 86], [246, 102], [252, 160], [236, 214], [150, 226], [92, 196]]);
  const sL0 = await A.state();
  times.oneHole = await A.menuFill();
  const sL = await A.state();
  const aL = await A.ev(() => window.T.audit('cut', 'truth'));
  const h1 = await A.ev(() => window.T.region({ x: 120, y: 120, w: 90, h: 70 }));
  const h2 = await A.ev(() => window.T.region({ x: 380, y: 250, w: 90, h: 70 }));
  const mL = await A.ev(() => window.T.stats('truth', { x: 120, y: 120, w: 90, h: 70 }));
  check('the lasso was drawn around one hole with the mouse', !!loop && loop.w > 130 && sL0.last === 'Lasso', [loop, sL0.last]);
  check('a lasso around one of two holes fills only that hole', sL.stats.plan.kind === 'holes' && h1.alphaMin === 255 && h2.alphaMax === 0 && aL.changed === 6300, [sL.stats.plan, h1, h2, aL.changed]);
  check('every opaque pixel and everything outside the lasso is bit-identical', aL.opaqueChanged === 0 && aL.outsideChanged === 0, aL);
  check('the filled hole matches the colour and grain around it', mL.off <= 12 && mL.detailIn >= 0.75 * mL.detailOut && mL.detailIn <= 1.3 * mL.detailOut, mL);
  check('one AI Fill layer on top, active, one history step, the lasso stays', sL.layers.join() === 'Background,AI Fill' && sL.active === 'AI Fill' && sL.hist === sL0.hist + 1 && sL.last === 'AI Fill' && JSON.stringify(sL.sel) === JSON.stringify(sL0.sel), [sL0, sL]);
  check('the engine ran in a worker without a dialog for a small fill', sL.stats.last.worker === true && (await A.ev(() => window.T.log.opened)) === 0, sL.stats.last);
  const hair = [];
  for (const z of [0.15, 0.22, 0.33, 0.67, 1.63]) hair.push(await A.ev(([z]) => window.T.hair({ x: 120, y: 120, w: 90, h: 70 }, z), [z]));
  check('no light line around the fill at fractional zoom', hair.every((v) => v === 255), hair);
  note('one hole', { ms: times.oneHole, colour: mL, engine: sL.stats.last.fillMs, hair });
  await A.shot('ai-one-hole');
  await A.undo();
  const sU = await A.state();
  const cU = await A.ev(() => window.T.compare('cut', null));
  check('undo removes the fill', sU.layers.join() === 'Background' && cU.outside === 0, [sU.layers, cU]);
  await A.page.keyboard.press('Control+Shift+z');
  await A.settle(300);
  check('redo brings it back', (await A.state()).layers.join() === 'Background,AI Fill', null);
  await A.undo();

  await A.ev(() => window.T.sel(110, 110, 110, 90));
  const rW = await A.fill({ seed: 5 });
  const hW = await A.ev(() => window.T.hash());
  const wW = (await A.state()).stats.last.worker;
  await A.undo();
  await A.ev(() => { window.app.api.ai.state.noWorker = true; });
  const rM = await A.fill({ seed: 5 });
  const hM = await A.ev(() => window.T.hash());
  const wM = (await A.state()).stats.last.worker;
  await A.undo();
  await A.ev(() => { window.app.api.ai.state.noWorker = false; });
  const rS = await A.fill({ seed: 6 });
  const hS = await A.ev(() => window.T.hash());
  await A.undo();
  check('worker and main thread give identical pixels for the same seed', rW.out === 'done' && rM.out === 'done' && wW === true && wM === false && hW === hM, [rW, rM, wW, wM, hW, hM]);
  check('the main-thread fallback keeps the page responsive', rM.gap < 400, rM);
  check('another seed gives a different fill', rS.out === 'done' && hS !== hW, [hS, hW]);

  await A.ev(() => window.T.sel(100, 100, 160, 140));
  const bD = await A.mark();
  await A.menu(['Edit', 'Fill…']);
  await A.settle(200);
  await A.page.locator('.dialog select').selectOption('ai');
  await A.page.locator('.dialog .btn.primary').click();
  await A.done(bD);
  const sD = await A.state();
  check('Fill > Content-Aware replaces everything inside the selection', sD.stats.plan.kind === 'replace' && sD.layers.join() === 'Background,AI Fill' && JSON.stringify(sD.stats.plan.box) === JSON.stringify({ x: 100, y: 100, w: 160, h: 140 }), sD.stats.plan);
  await A.undo();

  await A.ev(() => window.app.api.run('selAll'));
  await A.settle(150);
  const rA = await A.fill();
  const sA = await A.state();
  const a1 = await A.ev(() => window.T.region({ x: 120, y: 120, w: 90, h: 70 }));
  const a2 = await A.ev(() => window.T.region({ x: 380, y: 250, w: 90, h: 70 }));
  const aA = await A.ev(() => window.T.audit('cut'));
  check('Select All fills every empty area and nothing else', rA.out === 'done' && sA.stats.plan.kind === 'holes' && a1.alphaMin === 255 && a2.alphaMin === 255 && aA.opaqueChanged === 0, [rA, sA.stats.plan, a1, a2, aA.opaqueChanged]);
  await A.undo();

  await A.ev(() => window.T.side('Side'));
  await A.settle(300);
  await A.ev(() => window.T.keep('side'));
  const loopX = await A.lasso([[190, 210], [330, 150], [470, 190], [500, 330], [400, 430], [230, 410]]);
  times.side = await A.menuFill();
  const aX = await A.ev(() => window.T.audit('side'));
  const restX = await A.ev(() => window.T.region({ x: 600, y: 470, w: 250, h: 100 }));
  const stepX = await A.ev(() => { const a = window.app.api.pixel(298, 300); const b = window.app.api.pixel(303, 300); return Math.max(...[0, 1, 2].map((k) => Math.abs(a[k] - b[k]))); });
  check('a lasso from the picture into empty space fills only the empty part inside it', !!loopX && aX.changed > 20000 && aX.unfilled === 0 && aX.opaqueChanged === 0 && aX.outsideChanged === 0 && restX.alphaMax === 0, [loopX, aX, restX]);
  check('the edge along the lasso is soft and follows the selection', aX.partial > 100 && aX.pageOff <= 1, aX);
  check('the fill continues the picture without a step', stepX <= 15, stepX);
  note('lasso into empty space', { ms: times.side, changed: aX.changed, partial: aX.partial, step: stepX });
  await A.shot('ai-side');

  await A.ev(() => window.T.brick('Brick'));
  await A.settle(300);
  await A.ev(() => window.T.keep('brick'));
  await A.ev(() => window.T.ellipse(380, 300, 90, 70));
  times.brick = (await A.fill({ mode: 'replace' })).ms;
  const bIn = await A.ev(() => window.T.mortar({ x: 320, y: 255, w: 120, h: 90 }));
  const bTruth = await A.ev(() => window.T.mortar({ x: 120, y: 255, w: 120, h: 90 }));
  const mB = await A.ev(() => window.T.stats('brick', { x: 320, y: 255, w: 120, h: 90 }));
  check('a hole in brick is filled with brick courses that line up', bIn >= 0.5 * bTruth, [bIn, bTruth]);
  check('the brick fill keeps colour and grain', mB.off <= 12 && mB.detailIn >= 0.75 * mB.detailOut && mB.detailIn <= 1.3 * mB.detailOut, mB);
  note('brick', { ms: times.brick, mortar: bIn, truth: bTruth, colour: mB });
  await A.shot('ai-brick');

  await A.ev(() => window.T.photo('Photo'));
  await A.settle(300);
  await A.ev(() => window.T.keep('photo'));
  const redBefore = await A.ev(() => window.T.reddish({ x: 420, y: 395, w: 100, h: 95 }));
  await A.ev(() => window.T.ellipse(470, 448, 62, 52));
  const bP = await A.mark();
  await A.menu(['Edit', 'AI Fill']);
  await A.done(bP);
  const sP = await A.state();
  const redAfter = await A.ev(() => window.T.reddish({ x: 420, y: 395, w: 100, h: 95 }));
  const fP = await A.ev(() => window.T.feather());
  check('a lasso on solid picture replaces it and the ball is gone', sP.stats.plan.kind === 'replace' && redBefore > 3000 && redAfter < 60, [sP.stats.plan.kind, redBefore, redAfter]);
  check('the replaced area fades with the selection edge', fP.sameBox && fP.diff <= 1, fP);
  await A.shot('ai-photo');
  await A.undo();
  await A.ev(() => window.T.sel(100, 400, 120, 100));
  const tS = (await A.toasts()).length;
  const rSo = await A.fill({ mode: 'holes' });
  check('forcing holes mode on solid picture says nothing is empty', rSo.out === 'solid' && (await A.toasts(tS)).join() === SOLID, rSo);
  await A.ev(() => window.app.api.run('selAll'));
  const tW = (await A.toasts()).length;
  const rWh = await A.fill();
  check('selecting the whole picture explains there is nothing to copy from', rWh.out === 'whole' && (await A.toasts(tW)).join() === WHOLE, rWh);
  await A.ev(() => window.T.blank(300, 200, 'Blank'));
  await A.settle(200);
  await A.ev(() => window.app.api.run('selAll'));
  const tE = (await A.toasts()).length;
  const rE = await A.fill();
  check('an empty page says there is no picture', rE.out === 'empty' && (await A.toasts(tE)).join() === EMPTY, rE);

  await A.ev(() => window.T.leafy('Leafy page'));
  await A.settle(600);
  await A.ev(() => window.T.keep('leafy'));
  await A.shot('ai-leafy-before');
  const loopP = await A.lasso([[600, 640], [1500, 600], [2050, 900], [1950, 1700], [1100, 1950], [650, 1500]]);
  const rP = await A.fill();
  times.leafy = rP.ms;
  const band = await A.ev(() => window.T.texture2({ x: 1100, y: 200, w: 400, h: 400 }));
  const inP = await A.ev(() => window.T.texture2({ x: 1100, y: 1000, w: 400, h: 400 }));
  const restP = await A.ev(() => window.T.region({ x: 200, y: 2600, w: 300, h: 300 }));
  const aP = await A.ev(() => window.T.audit('leafy'));
  check('the owner\'s page: the lasso below the leaves fills with leaves', rP.out === 'done' && !!loopP && inP.alphaMin === 255 && inP.detail >= 0.65 * band.detail && inP.detail <= 1.4 * band.detail && inP.colours >= 0.5 * band.colours, [rP, band, inP]);
  check('the owner\'s page: nothing outside the lasso changes', restP.alphaMax === 0 && aP.outsideChanged === 0 && aP.opaqueChanged === 0, [restP, aP.outsideChanged, aP.opaqueChanged]);
  check('the owner\'s page: the fill finishes in time and the page stays responsive', rP.ms < 25000 && rP.gap < 400, rP);
  note('leafy page, lasso touching the band', { ms: rP.ms, gap: rP.gap, band, fill: inP, engine: (await A.state()).stats.last.stats.totalMs });
  await A.shot('ai-leafy-after');
  await A.undo();
  await A.ev(() => window.T.ellipse(1300, 2500, 450, 350));
  const rF = await A.fill();
  const farP = await A.ev(() => window.T.texture2({ x: 1100, y: 2350, w: 400, h: 300 }));
  check('a lasso that does not touch the picture is still filled from it', rF.out === 'done' && farP.alphaMin === 255 && farP.detail >= 0.4 * band.detail && farP.colours >= 0.25 * band.colours, [rF, farP]);
  note('leafy page, lasso away from the band', { ms: rF.ms, gap: rF.gap, fill: farP });
  await A.shot('ai-leafy-far');
  await A.undo();

  await A.ev(() => window.app.api.run('selAll'));
  await A.settle(150);
  const sC0 = await A.state();
  const pending = A.fill();
  await A.page.waitForSelector('.aidialog', { timeout: 10000 });
  await A.settle(1200);
  const pct = await A.ev(() => document.querySelector('.aipct').textContent);
  await A.page.locator('.aidialog .btn').click();
  const rC = await pending;
  const sC = await A.state();
  check('the dialog shows what is filled and real progress', /^\d+%$/.test(pct) && (await A.ev(() => window.T.log.what.slice(-1)[0])) === 'Filling the empty space inside the selection', [pct, await A.ev(() => window.T.log.what)]);
  check('Cancel during the fill leaves the document untouched', rC.out === 'cancel' && sC.layers.join() === sC0.layers.join() && sC.hist === sC0.hist && sC.hi === sC0.hi, [rC, sC.layers, sC.hist, sC0.hist]);
  await A.ev(() => window.T.ellipse(1300, 1000, 200, 150));
  const rN = await A.fill();
  check('a fill after Cancel works', rN.out === 'done', rN);
  check('no network request during any fill', outside.length === 0, outside);

  if (target.startsWith('dist/')) {
    const html = fs.readFileSync(path.join(root, target), 'utf8');
    check('the single file holds no trace of the old neural network', !/onnx|migan|wasm/i.test(html), null);
    const zip = path.join(root, path.dirname(target), 'picture-market-netlify.zip');
    const names = zipEntries(fs.readFileSync(zip)).map((e) => e.name).sort();
    check('the zip holds only the page and the licences and is small', names.join() === 'LICENSES.txt,index.html' && fs.statSync(zip).size < 1048576, [names, fs.statSync(zip).size]);
    const F = await open('file://' + path.join(root, target) + '?test=1');
    await F.ev(() => {
      const d = window.T.rough(400, 300, 'File');
      window.T.cut(d, [[150, 100, 80, 60]]);
      window.T.sel(140, 90, 100, 80);
    });
    const rFile = await F.fill();
    const sFile = await F.state();
    check('the single file works when opened from disk', rFile.out === 'done' && sFile.layers.join() === 'Background,AI Fill', [rFile, sFile.stats.last && sFile.stats.last.worker]);
  }

  console.log('times ' + JSON.stringify(times));
  await browser.close();
  await srv.close();
  if (fails.length) {
    console.log('\nFAILED:\n' + fails.join('\n'));
  } else {
    console.log('all checks passed');
  }
  if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
  else console.log('no page errors');
  process.exit(fails.length || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
