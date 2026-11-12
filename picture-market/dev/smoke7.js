const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');
const { fetchAi } = require('./fetch-ai');

const NOTHING = 'Select the area you want filled in first, or erase the part you want replaced.';
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
  const log = { opened: 0, closed: 0, texts: [], toasts: [] };
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
        last: d.hi >= 0 ? d.hist[d.hi].name : null, sel: d.sel ? { ...d.sel.b } : null, stats: JSON.parse(JSON.stringify(api.ai.state.stats))
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
    async fill() {
      const t0 = performance.now();
      const out = await api.ai.fill(window.app.doc);
      return { out, ms: Math.round(performance.now() - t0) };
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
  const expected = /migan_pipeline_v2\.onnx|ai\/ort\.wasm\.bundle\.min\.mjs/;
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
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
    const fill = () => ev(() => window.T.fill());
    const state = () => ev(() => window.T.state());
    const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
    return { page, ev, settle, select, menu, menuFill, fill, state, shot, closed, waitClosed };
  };

  const A = await open(srv.url);
  await A.ev(() => window.T.grad(600, 450, 'Gradient'));
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
  check('the next attempt after a failure works', s1.stats.sessions === 1 && s1.stats.runs === 1, s1.stats);
  check('the dialog reports the download with a percentage', texts.some((t) => /^Getting the AI ready — 43 MB, first time only\|\d+%$/.test(t)), texts);
  check('the dialog then says Filling…', texts.includes('Filling…|'), texts);
  check('files come from ' + (local ? 'next to the page' : 'the public URLs'), s1.stats.home === (local ? 'local' : 'public'), s1.stats);
  check('inference runs in a worker', s1.stats.worker === true, s1.stats);
  check('a new layer AI Fill sits directly above the active layer', s1.layers.join() === 'Background,AI Fill' && s1.activeIndex === s0.activeIndex + 1 && s1.active === 'AI Fill', s1);
  check('history ends with AI Fill, one step', s1.last === 'AI Fill' && s1.hist === s0.hist + 1, s1);
  check('the selection stays', JSON.stringify(s1.sel) === JSON.stringify(s0.sel), [s0.sel, s1.sel]);
  const c1 = await A.ev((b) => window.T.compare('grad', b), box);
  check('the hole centre is within 25 levels of the gradient', c1.off <= 25, c1);
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
  await A.page.locator('.dialog .btn.primary').click();
  await A.waitClosed(nd);
  const sD = await A.state();
  check('Fill… ▸ Content-Aware (AI) runs AI Fill', sD.layers.join() === 'Background,AI Fill' && sD.last === 'AI Fill', sD);

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
  });
  await A.settle(300);
  const sB0 = await A.state();
  const rB = await A.fill();
  const sB = await A.state();
  const cB = await A.ev(() => window.T.compare('blanks', null));
  const corner = await A.ev(() => window.T.compare('truth', { x: 400, y: 10, w: 80, h: 80 }));
  check('no selection fills the blanks with a bottom layer', rB.out === 'done' && sB.layers.join() === 'AI Fill,Background' && sB.active === 'Background', [rB, sB.layers, sB.active]);
  check('the document is fully opaque afterwards', cB.alphaMin === 255, cB);
  check('every previously opaque pixel is unchanged', cB.opaqueChanged === 0, cB);
  check('the filled corner continues the picture', corner.off <= 45, corner);
  check('the blanks fill is one history step', sB.last === 'AI Fill' && sB.hist === sB0.hist + 1, sB);
  await A.shot('ai-blanks');
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  check('undo removes the bottom layer', (await A.state()).layers.join() === 'Background', null);

  await A.ev(() => {
    const d = window.T.grad(900, 700, 'Corners');
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
  const sK0 = await A.state();
  const rK = await A.fill();
  const sK = await A.state();
  const cK = await A.ev(() => window.T.compare('corners', null));
  const textsK = await A.ev(() => window.T.log.texts.slice());
  check('two separate blanks are filled one after the other', rK.out === 'done' && sK.stats.runs === sK0.stats.runs + 2 && textsK.includes('Filling… 2 of 2|'), [rK, sK.stats, textsK]);
  check('both blanks end up opaque in one layer and one history step', cK.alphaMin === 255 && cK.opaqueChanged === 0 && sK.layers.join() === 'AI Fill,Background' && sK.hist === sK0.hist + 1, [cK, sK]);
  await A.shot('ai-corners');

  await A.ev(() => window.T.grad(300, 200, 'Opaque'));
  await A.settle(200);
  const sN0 = await A.state();
  const tN = await A.ev(() => window.T.log.toasts.length);
  const rN = await A.ev(() => window.app.api.run('aiFill'));
  const sN = await A.state();
  const toastsN = await A.ev((n) => window.T.log.toasts.slice(n), tN);
  check('nothing to fill shows the hint', rN === 'nothing' && toastsN.join('|') === NOTHING, [rN, toastsN]);
  check('nothing to fill makes no history step', sN.hist === sN0.hist && sN.layers.length === 1 && sN.stats.runs === sN0.stats.runs, sN);
  await A.ev(() => window.app.api.newDoc({ w: 300, h: 200, dpi: 72, bg: 'transparent', name: 'Empty' }));
  await A.settle(200);
  const rE = await A.fill();
  check('an empty page is refused, not invented', rE.out === 'blind' && (await A.state()).hist === 0, rE);

  await A.ev(() => window.T.grad(2625, 3375, 'Yearbook'));
  await A.settle(500);
  const big = await A.select([900, 1300], [1600, 2000]);
  await A.ev(() => window.T.keep('big'));
  const rBig = await A.fill();
  times.big = rBig.ms;
  const sBig = await A.state();
  const cBig = await A.ev((b) => window.T.compare('big', b), big);
  check('a 700 px hole in a 2625×3375 page is filled', rBig.out === 'done' && Math.abs(big.w - 700) < 30 && cBig.off <= 25 && cBig.outside === 0, [rBig, big, cBig]);
  check('the model saw at most 512 px of the big page', sBig.stats.last.w <= 512 && sBig.stats.last.h <= 512 && sBig.stats.maxSide <= 512, sBig.stats);
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  const huge = await A.select([500, 700], [2100, 2500]);
  const rHuge = await A.fill();
  times.huge = rHuge.ms;
  const sHuge = await A.state();
  const cHuge = await A.ev((b) => window.T.compare('big', b), huge);
  check('a 1600 px hole is scaled down for the model', rHuge.out === 'done' && Math.max(sHuge.stats.last.w, sHuge.stats.last.h) === 512 && sHuge.stats.maxSide === 512, [rHuge, sHuge.stats]);
  check('the scaled fill stays inside the selection and near the gradient', cHuge.outside === 0 && cHuge.off <= 30, cHuge);
  await A.shot('ai-big');

  await A.ev(() => window.T.grad(600, 450, 'Cancel'));
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

  await A.ev(() => {
    window.app.api.ai.reset();
    window.app.api.ai.state.noWorker = true;
  });
  await A.page.keyboard.press('Control+z');
  await A.settle(300);
  const rL = await A.fill();
  const sL = await A.state();
  const cL = await A.ev((b) => window.T.compare('cancel', b), sL.sel);
  check('without a worker the fill runs on the main thread', rL.out === 'done' && sL.stats.worker === false && cL.off <= 25 && cL.outside === 0, [rL, sL.stats, cL]);
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
  const rT = await A.fill();
  await A.settle(300);
  await A.shot('ai-texture-after');
  const cT = await A.ev(() => { window.T.keep('tex'); return window.T.compare('tex', null); });
  check('realistic: a missing corner of a texture is filled', rT.out === 'done' && cT.alphaMin === 255, [rT, cT]);
  times.texture = rT.ms;

  await A.ev(() => window.T.leafy('Leafy Page'));
  await A.settle(600);
  await A.shot('ai-leafy-before');
  const rY = await A.fill();
  await A.settle(400);
  await A.shot('ai-leafy-after');
  const sY = await A.state();
  const cY = await A.ev(() => { window.T.keep('leafy'); return window.T.compare('leafy', null); });
  check('realistic: a leafy frame on an empty page is continued downwards', rY.out === 'done' && sY.layers.join() === 'AI Fill,Leaves' && cY.alphaMin === 255 && Math.max(sY.stats.last.w, sY.stats.last.h) <= 512, [rY, sY.layers, cY, sY.stats.last]);
  times.leafy = rY.ms;
  await A.page.close();

  const B = await open(iso.url);
  const isolated = await B.ev(() => self.crossOriginIsolated);
  check('PM_ISOLATE=1 makes the page cross-origin isolated', isolated === true, isolated);
  await B.ev(() => window.T.grad(600, 450, 'Threads'));
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
  check('the threaded result is right', cI.off <= 25 && cI.outside === 0, cI);
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
