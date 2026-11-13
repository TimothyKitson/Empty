const fs = require('fs');
const path = require('path');
const lib = require('./synth-lib');

function inPage() {
  function workerMain(factory) {
    const core = factory();
    self.onmessage = (e) => {
      const job = e.data.job;
      const slice = e.data.slice;
      const t0 = performance.now();
      const run = core.start(job);
      let worst = 0;
      let mono = true;
      let last = 0;
      for (;;) {
        const a = performance.now();
        const fin = run.step(slice);
        const d = performance.now() - a;
        if (d > worst) worst = d;
        const p = run.progress();
        if (p < last) mono = false;
        last = p;
        if (fin) break;
      }
      const r = run.result();
      self.postMessage({ rgba: r.rgba, stats: r.stats, ms: performance.now() - t0, worst, mono, end: run.progress() }, [r.rgba.buffer]);
    };
  }
  const hash = (arr) => {
    let a = 2166136261;
    for (let i = 0; i < arr.length; i++) a = Math.imul(a ^ arr[i], 16777619);
    return (a >>> 0).toString(16);
  };
  const S = { cores: {}, images: {} };
  S.load = async (name, url) => {
    const m = await import(url);
    S.cores[name] = m.synthCore;
    return m.synthCore.toString().length;
  };
  S.loadText = async (name, text) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    const m = await import(url);
    S.cores[name] = m.synthCore;
    return m.synthCore.toString().length;
  };
  S.image = async (name, url, crop) => {
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const w = crop ? crop.w : bmp.width;
    const h = crop ? crop.h : bmp.height;
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, crop ? -crop.x : 0, crop ? -crop.y : 0);
    S.images[name] = g.getImageData(0, 0, w, h);
    return [w, h];
  };
  S.job = (spec) => {
    const img = S.images[spec.image];
    const w = spec.w || img.width;
    const h = spec.h || img.height;
    const n = w * h;
    const rgba = new Uint8ClampedArray(n * 4);
    const target = new Uint8Array(n);
    const known = new Uint8Array(n);
    if (spec.band) {
      rgba.set(img.data.subarray(0, w * spec.band * 4));
      known.fill(1, 0, w * spec.band);
      target.fill(1, w * spec.band);
    } else {
      rgba.set(img.data.subarray(0, n * 4));
      known.fill(1);
      const r = spec.rect;
      for (let y = r.y; y < r.y + r.h; y++) {
        target.fill(1, y * w + r.x, y * w + r.x + r.w);
        known.fill(0, y * w + r.x, y * w + r.x + r.w);
      }
    }
    return { w, h, rgba, target, known, init: null, seed: spec.seed || 3, maxMs: spec.maxMs };
  };
  S.direct = (name, spec, slice) => {
    const job = S.job(spec);
    const t0 = performance.now();
    const run = S.cores[name]().start(job);
    let worst = 0;
    if (slice > 0) {
      for (;;) {
        const a = performance.now();
        const fin = run.step(slice);
        const d = performance.now() - a;
        if (d > worst) worst = d;
        if (fin) break;
      }
    }
    const r = run.result();
    return { hash: hash(r.rgba), ms: Math.round(performance.now() - t0), worst: Math.round(worst * 10) / 10, stats: r.stats };
  };
  S.worker = (name, spec, slice) => new Promise((resolve, reject) => {
    const job = S.job(spec);
    const text = '(' + workerMain.toString() + ')(' + S.cores[name].toString() + ')';
    const wk = new Worker(URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
    wk.onerror = (e) => reject(new Error('worker: ' + e.message));
    wk.onmessage = (e) => {
      wk.terminate();
      const d = e.data;
      resolve({ hash: hash(d.rgba), ms: Math.round(d.ms), worst: Math.round(d.worst * 10) / 10, mono: d.mono, end: d.end, stats: d.stats });
    };
    wk.postMessage({ job, slice }, [job.rgba.buffer, job.target.buffer, job.known.buffer]);
  });
  window.S = S;
}

function v1Page() {
  window.V = {
    async run(url, maskB64, w, h) {
      const api = window.app.api;
      const bmp = await createImageBitmap(await (await fetch(url)).blob());
      const d = api.newDoc({ w, h, dpi: 72, bg: 'white', name: 'bench' });
      const l = d.layers[0];
      l.canvas.getContext('2d').drawImage(bmp, 0, 0);
      l.ver++;
      d.touch('all');
      const bin = atob(maskB64);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const id = g.createImageData(w, h);
      let x0 = w;
      let x1 = -1;
      let y0 = h;
      let y1 = -1;
      for (let i = 0; i < w * h; i++) {
        if (bin.charCodeAt(i >> 3) & (1 << (i & 7))) {
          id.data[i * 4 + 3] = 255;
          const x = i % w;
          const y = (i / w) | 0;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      g.putImageData(id, 0, 0);
      d.sel = { c, b: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, path: null };
      api.emit('sel', d);
      const t0 = performance.now();
      const out = await api.ai.fill(d);
      const ms = Math.round(performance.now() - t0);
      const flat = api.flatten(d);
      return { out, ms, png: flat.toDataURL('image/png') };
    }
  };
}

function packMask(mask) {
  const b = Buffer.alloc((mask.length + 7) >> 3);
  for (let i = 0; i < mask.length; i++) if (mask[i]) b[i >> 3] |= 1 << (i & 7);
  return b.toString('base64');
}

async function openEngine(browser, base, minified, rel) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e)));
  await page.goto(base + 'dev/serve.js');
  await page.evaluate(inPage);
  await page.evaluate((u) => window.S.load('plain', u), base + (rel || 'site/js/synth.js'));
  await page.evaluate((t) => window.S.loadText('min', t), minified);
  return { page, errors };
}

async function runV1(browser, base, def, c, cacheDir, refresh) {
  const file = path.join(cacheDir, def.id + '.png');
  const meta = path.join(cacheDir, def.id + '.json');
  if (!refresh && fs.existsSync(file) && fs.existsSync(meta)) return { rgba: lib.decodePng(fs.readFileSync(file)).rgba, ms: JSON.parse(fs.readFileSync(meta, 'utf8')).ms };
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  try {
    await page.goto(base + 'dev/fill-v1/index.html?test=1');
    await page.waitForFunction(() => window.app && window.app.ready, null, { timeout: 20000 });
    await page.evaluate(v1Page);
    const tmp = path.join(lib.FIX, 'tmp-' + def.id + '.png');
    lib.savePng(tmp, { w: c.w, h: c.h, rgba: c.truth });
    const r = await page.evaluate(([u, m, w, h]) => window.V.run(u, m, w, h), [base + 'dev/fixtures/tmp-' + def.id + '.png', packMask(c.target), c.w, c.h]);
    fs.unlinkSync(tmp);
    if (r.out !== 'done') throw new Error('v1 answered ' + JSON.stringify(r.out));
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
    fs.writeFileSync(meta, JSON.stringify({ ms: r.ms }));
    return { rgba: lib.decodePng(fs.readFileSync(file)).rgba, ms: r.ms };
  } finally {
    await page.close();
  }
}

module.exports = { openEngine, runV1 };
