import { h, mk, cx, emit } from './util.js';
import { Layer, render, freeScratch } from './doc.js';
import { toast } from './ui.js';

const ORT_VERSION = '1.31.1';
const CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@' + ORT_VERSION + '/dist/';
const HUB = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/';
const RUNTIME = 'ort.wasm.bundle.min.mjs';
const WASM = 'ort-wasm-simd-threaded.wasm';
const MODEL = 'migan_pipeline_v2.onnx';
const WASM_BYTES = 14848852;
const MODEL_BYTES = 28079181;
const CACHE = 'picture-market-ai-1';
const MAX_SIDE = 512;
const MIN_PAD = 128;
const MAX_PARTS = 4;
const GRID = 256;
const TRUST_LOW = 0.1;
const TRUST_HIGH = 0.26;
const STRIP = 256;
const LAYER_NAME = 'AI Fill';

const TEXT = {
  nothing: 'Select the area you want filled in first, or erase the part you want replaced.',
  blind: 'There is nothing around that area for the AI to look at. Select a smaller area.',
  download: 'The AI model could not be downloaded. Check the internet connection and try again.',
  wasm: 'This browser cannot run the AI model because WebAssembly is switched off.',
  memory: 'There was not enough memory to run the AI model. Close other tabs and try again.',
  changed: 'The picture changed while the AI was working, so nothing was filled in.',
  failed: 'The AI fill did not work this time. Try again.',
  ready: 'Getting the AI ready…',
  first: 'Getting the AI ready — 43 MB, first time only',
  filling: 'Filling…'
};

export const ai = {
  noWorker: false,
  stats: { downloads: 0, sessions: 0, runs: 0, threads: 0, worker: false, home: '', maxSide: 0, last: null }
};

let home = null;
let live = null;
let busy = false;

function engine() {
  let ort = null;
  let session = null;
  return {
    async boot(m) {
      if (!ort) ort = await import(m.runtime);
      return {};
    },
    async load(m) {
      const w = ort.env.wasm;
      w.numThreads = m.threads;
      w.proxy = false;
      w.wasmBinary = m.wasm;
      session = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'] });
      return {};
    },
    async run(m) {
      const feeds = {
        image: new ort.Tensor('uint8', new Uint8Array(m.image), [1, 3, m.h, m.w]),
        mask: new ort.Tensor('uint8', new Uint8Array(m.mask), [1, 1, m.h, m.w])
      };
      const out = await session.run(feeds);
      const t = out.result || out[session.outputNames[0]];
      const data = new Uint8Array(t.data.length);
      data.set(t.data);
      if (t.dispose) t.dispose();
      return { data: data.buffer };
    }
  };
}

function workerMain(make) {
  const e = make();
  self.onmessage = async (ev) => {
    const m = ev.data;
    try {
      const r = await e[m.op](m);
      self.postMessage({ id: m.id, ok: true, r }, r.data ? [r.data] : []);
    } catch (err) {
      self.postMessage({ id: m.id, ok: false, error: String((err && err.message) || err) });
    }
  };
  self.postMessage({ ready: true });
}

function fail(kind, detail) {
  const e = new Error(detail || kind);
  e.kind = kind;
  return e;
}

function startWorker(type) {
  return new Promise((resolve) => {
    let w = null;
    let url = '';
    let done = false;
    const waits = new Map();
    let seq = 0;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!v && w) w.terminate();
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), 5000);
    const dead = (why) => {
      for (const p of waits.values()) p.reject(fail('worker', why));
      waits.clear();
    };
    try {
      url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')(' + engine.toString() + ');'], { type: 'text/javascript' }));
      w = new Worker(url, { type });
    } catch (e) {
      finish(null);
      return;
    }
    w.onerror = (ev) => {
      if (ev.preventDefault) ev.preventDefault();
      dead(ev.message || 'worker error');
      finish(null);
    };
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.ready) {
        URL.revokeObjectURL(url);
        finish({
          worker: true,
          call: (op, msg, transfer) => new Promise((res, rej) => {
            const id = ++seq;
            waits.set(id, { resolve: res, reject: rej });
            w.postMessage({ ...msg, op, id }, transfer || []);
          }),
          kill: () => {
            w.terminate();
            dead('stopped');
          }
        });
        return;
      }
      const p = waits.get(m.id);
      if (!p) return;
      waits.delete(m.id);
      if (m.ok) p.resolve(m.r);
      else p.reject(fail('engine', m.error));
    };
  });
}

function startLocal() {
  const e = engine();
  let chain = Promise.resolve();
  return {
    worker: false,
    call: (op, msg) => {
      const r = chain.then(() => e[op](msg));
      chain = r.catch(() => {});
      return r;
    },
    kill: () => {}
  };
}

async function openCache() {
  try {
    return await caches.open(CACHE);
  } catch (e) {
    return null;
  }
}

async function cached(url) {
  const c = await openCache();
  try {
    return !!(c && await c.match(url));
  } catch (e) {
    return false;
  }
}

async function findHome() {
  const pub = { name: 'public', runtime: CDN + RUNTIME, wasm: CDN + WASM, model: HUB + MODEL };
  let base = '';
  try {
    base = new URL('ai/', document.baseURI).href;
  } catch (e) {
    return pub;
  }
  if (!/^https?:/.test(base)) return pub;
  const local = { name: 'local', runtime: base + RUNTIME, wasm: base + WASM, model: base + MODEL };
  try {
    const r = await fetch(local.runtime, { method: 'HEAD', cache: 'no-store' });
    return r.ok && /javascript/.test(r.headers.get('content-type') || '') ? local : pub;
  } catch (e) {
    return (await cached(local.model)) ? local : pub;
  }
}

async function readBody(res, size, tick) {
  const buf = new Uint8Array(size);
  let n = 0;
  if (!res.body || !res.body.getReader) {
    const all = new Uint8Array(await res.arrayBuffer());
    if (all.length !== size) throw fail('download', 'size');
    tick(size);
    return all;
  }
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > size) {
      reader.cancel().catch(() => {});
      throw fail('download', 'size');
    }
    buf.set(value, n);
    n += value.length;
    tick(n);
  }
  if (n !== size) throw fail('download', 'size');
  return buf;
}

async function getBytes(url, size, tick, signal) {
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const b = await hit.arrayBuffer();
        if (b.byteLength === size) {
          tick(size, true);
          return b;
        }
        await cache.delete(url);
      }
    } catch (e) {
      console.warn(e);
    }
  }
  ai.stats.downloads++;
  let buf = null;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw fail('download', 'status ' + res.status);
    buf = await readBody(res, size, tick);
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    throw fail('download', String((e && e.message) || e));
  }
  if (cache) cache.put(url, new Response(buf, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } })).catch(() => {});
  return buf.buffer;
}

async function forget() {
  const c = await openCache();
  if (!c || !home) return;
  await Promise.all([c.delete(home.wasm), c.delete(home.model)]).catch(() => {});
}

function drop() {
  if (live) live.kill();
  live = null;
}

async function transportFor(runtime) {
  for (const type of ai.noWorker || typeof Worker !== 'function' ? [] : ['classic', 'module']) {
    const w = await startWorker(type);
    if (!w) continue;
    try {
      await w.call('boot', { runtime });
      return w;
    } catch (e) {
      w.kill();
    }
  }
  const t = startLocal();
  await t.call('boot', { runtime });
  return t;
}

async function ensure(job) {
  if (live) return live;
  if (typeof WebAssembly !== 'object' || typeof WebAssembly.instantiate !== 'function') throw fail('wasm');
  if (!home) home = await findHome();
  ai.stats.home = home.name;
  const want = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const tries = want > 1 ? [want, 1] : [1];
  let last = null;
  for (const threads of tries) {
    const got = { wasm: 0, model: 0 };
    const tick = (k) => (n, quiet) => {
      got[k] = n;
      if (!quiet) job.progress('download', Math.min(1, (got.wasm + got.model) / (WASM_BYTES + MODEL_BYTES)));
    };
    const [wasm, model] = await Promise.all([
      getBytes(home.wasm, WASM_BYTES, tick('wasm'), job.signal),
      getBytes(home.model, MODEL_BYTES, tick('model'), job.signal)
    ]);
    if (job.cancelled) throw fail('cancel');
    job.progress('start');
    let t = null;
    try {
      t = await transportFor(home.runtime);
    } catch (e) {
      throw fail('download', String((e && e.message) || e));
    }
    if (job.cancelled) {
      t.kill();
      throw fail('cancel');
    }
    job.transport = t;
    const use = t.worker ? threads : 1;
    try {
      await t.call('load', { wasm, model, threads: use }, t.worker ? [wasm, model] : []);
      if (job.cancelled) throw fail('cancel');
      ai.stats.sessions++;
      ai.stats.threads = use;
      ai.stats.worker = t.worker;
      live = t;
      return t;
    } catch (e) {
      t.kill();
      job.transport = null;
      if (job.cancelled) throw fail('cancel');
      last = e;
      if (!t.worker) break;
    }
  }
  if (kindOf(last) !== 'memory') await forget();
  throw last;
}

export async function inpaint(image, mask, w, hh, opts = {}) {
  if (w > MAX_SIDE || hh > MAX_SIDE) throw fail('engine', 'too large');
  const job = opts.job || { progress: opts.onProgress || (() => {}), signal: opts.signal, cancelled: false, transport: null };
  const t = await ensure(job);
  job.transport = t;
  job.progress('fill');
  const t0 = performance.now();
  const r = await t.call('run', { image: image.buffer, mask: mask.buffer, w, h: hh }, t.worker ? [image.buffer, mask.buffer] : []);
  ai.stats.runs++;
  ai.stats.maxSide = Math.max(ai.stats.maxSide, w, hh);
  ai.stats.last = { w, h: hh, ms: Math.round(performance.now() - t0) };
  return new Uint8Array(r.data);
}

function strips(hh, fn) {
  for (let y = 0; y < hh; y += STRIP) fn(y, Math.min(STRIP, hh - y));
}

const READ = { willReadFrequently: true };

function readable(w, hh) {
  const c = mk(w, hh);
  return { c, g: cx(c, READ) };
}

function flatDoc(d) {
  const r = readable(d.w, d.h);
  render(d, r.g, 1, 0, 0);
  if (d.w * d.h > 3e6) freeScratch();
  return r.c;
}

function clip(d, x0, y0, x1, y1) {
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  return { x, y, w: Math.min(d.w, Math.ceil(x1)) - x, h: Math.min(d.h, Math.ceil(y1)) - y };
}

function scan(d, flat, sel) {
  const cell = Math.max(1, Math.ceil(Math.max(d.w, d.h) / GRID));
  const gw = Math.ceil(d.w / cell);
  const gh = Math.ceil(d.h / cell);
  const grid = new Uint8Array(gw * gh);
  const area = sel ? clip(d, d.sel.b.x, d.sel.b.y, d.sel.b.x + d.sel.b.w, d.sel.b.y + d.sel.b.h) : { x: 0, y: 0, w: d.w, h: d.h };
  if (area.w < 1 || area.h < 1) return null;
  let g = cx(flat, READ);
  let ox = area.x;
  let oy = area.y;
  if (sel) {
    g = readable(area.w, area.h).g;
    g.drawImage(sel, -area.x, -area.y);
    ox = 0;
    oy = 0;
  }
  const col = new Int32Array(area.w);
  for (let i = 0; i < area.w; i++) col[i] = ((area.x + i) / cell) | 0;
  let x0 = d.w;
  let y0 = d.h;
  let x1 = -1;
  let y1 = -1;
  strips(area.h, (y, n) => {
    const a = g.getImageData(ox, oy + y, area.w, n).data;
    for (let j = 0, p = 3; j < n; j++) {
      const row = (((area.y + y + j) / cell) | 0) * gw;
      for (let i = 0; i < area.w; i++, p += 4) {
        if (sel ? a[p] === 0 : a[p] === 255) continue;
        grid[row + col[i]] = 1;
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (y + j < y0) y0 = y + j;
        y1 = y + j;
      }
    }
  });
  if (x1 < 0) return null;
  return { cell, gw, gh, grid, x: area.x + x0, y: area.y + y0, x1: area.x + x1 + 1, y1: area.y + y1 + 1 };
}

function islands(m) {
  const { grid, gw, gh, cell } = m;
  const seen = new Uint8Array(gw * gh);
  const stack = new Int32Array(gw * gh);
  const out = [];
  for (let s = 0; s < grid.length; s++) {
    if (!grid[s] || seen[s]) continue;
    let top = 0;
    stack[top++] = s;
    seen[s] = 1;
    const r = { x: gw, y: gh, x1: 0, y1: 0 };
    while (top) {
      const i = stack[--top];
      const x = i % gw;
      const y = (i - x) / gw;
      if (x < r.x) r.x = x;
      if (y < r.y) r.y = y;
      if (x + 1 > r.x1) r.x1 = x + 1;
      if (y + 1 > r.y1) r.y1 = y + 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const k = ny * gw + nx;
          if (!grid[k] || seen[k]) continue;
          seen[k] = 1;
          stack[top++] = k;
        }
      }
    }
    out.push({ x: Math.max(m.x, r.x * cell), y: Math.max(m.y, r.y * cell), x1: Math.min(m.x1, r.x1 * cell), y1: Math.min(m.y1, r.y1 * cell) });
  }
  return out;
}

const join = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const size = (r) => (r.x1 - r.x) * (r.y1 - r.y);
const near = (a, b, gap) => a.x - gap < b.x1 && b.x - gap < a.x1 && a.y - gap < b.y1 && b.y - gap < a.y1;

function pairUp(rs, pick) {
  let best = null;
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const v = pick(rs[i], rs[j]);
      if (v !== null && (!best || v < best.v)) best = { i, j, v };
    }
  }
  if (!best) return false;
  rs[best.i] = join(rs[best.i], rs[best.j]);
  rs.splice(best.j, 1);
  return true;
}

function regions(m) {
  let rs = islands(m);
  if (rs.length > 60) rs = [rs.reduce(join)];
  const gap = m.cell + 8;
  for (;;) {
    while (pairUp(rs, (a, b) => (near(a, b, gap) ? 0 : null)));
    if (rs.length <= MAX_PARTS) return rs;
    pairUp(rs, (a, b) => size(join(a, b)) - size(a) - size(b));
  }
}

function unknownMap(flat, sel, crop) {
  const c = mk(crop.w, crop.h);
  const g = cx(c);
  const fg = cx(flat, READ);
  let sg = null;
  if (sel) {
    sg = readable(crop.w, crop.h).g;
    sg.drawImage(sel, -crop.x, -crop.y);
  }
  let known = 0;
  strips(crop.h, (y, n) => {
    const f = fg.getImageData(crop.x, crop.y + y, crop.w, n).data;
    const s = sg ? sg.getImageData(0, y, crop.w, n).data : null;
    const out = g.createImageData(crop.w, n);
    const o = out.data;
    for (let p = 3; p < f.length; p += 4) {
      if (f[p] < 255 || (s && s[p] > 0)) o[p] = 255;
      else known++;
    }
    g.putImageData(out, 0, y);
  });
  return { c, known };
}

function grow(c, r) {
  const n = mk(c.width, c.height);
  const g = cx(n);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r * r + 1) g.drawImage(c, dx, dy);
    }
  }
  return n;
}

function pull(src, w, hh) {
  const nw = (w + 1) >> 1;
  const nh = (hh + 1) >> 1;
  const d = new Float32Array(nw * nh * 4);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (!src[p + 3]) continue;
      const q = ((y >> 1) * nw + (x >> 1)) * 4;
      d[q] += src[p];
      d[q + 1] += src[p + 1];
      d[q + 2] += src[p + 2];
      d[q + 3] += 1;
    }
  }
  for (let q = 0; q < d.length; q += 4) {
    const k = d[q + 3];
    if (!k) continue;
    d[q] /= k;
    d[q + 1] /= k;
    d[q + 2] /= k;
    d[q + 3] = 1;
  }
  return { d, w: nw, h: nh };
}

function push(dst, w, hh, c) {
  const holes = [];
  for (let y = 0; y < hh; y++) {
    const fy = Math.max(0, (y + 0.5) / 2 - 0.5);
    const y0 = Math.min(c.h - 1, Math.floor(fy));
    const y1 = Math.min(c.h - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      if (dst[p + 3]) continue;
      const fx = Math.max(0, (x + 0.5) / 2 - 0.5);
      const x0 = Math.min(c.w - 1, Math.floor(fx));
      const x1 = Math.min(c.w - 1, x0 + 1);
      const tx = fx - x0;
      const a = (y0 * c.w + x0) * 4;
      const b = (y0 * c.w + x1) * 4;
      const e = (y1 * c.w + x0) * 4;
      const f = (y1 * c.w + x1) * 4;
      for (let k = 0; k < 3; k++) {
        const top = c.d[a + k] + (c.d[b + k] - c.d[a + k]) * tx;
        const bot = c.d[e + k] + (c.d[f + k] - c.d[e + k]) * tx;
        dst[p + k] = top + (bot - top) * ty;
      }
      dst[p + 3] = 1;
      holes.push(p);
    }
  }
  return holes;
}

function relax(d, w, hh, holes, rounds) {
  const row = w * 4;
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < holes.length; i++) {
      const p = holes[i];
      const x = (p / 4) % w;
      const l = x > 0 ? p - 4 : p;
      const rt = x < w - 1 ? p + 4 : p;
      const u = p >= row ? p - row : p;
      const dn = p + row < d.length ? p + row : p;
      d[p] = (d[l] + d[rt] + d[u] + d[dn]) / 4;
      d[p + 1] = (d[l + 1] + d[rt + 1] + d[u + 1] + d[dn + 1]) / 4;
      d[p + 2] = (d[l + 2] + d[rt + 2] + d[u + 2] + d[dn + 2]) / 4;
    }
  }
}

function extend(d, w, hh) {
  if (w === 1 && hh === 1) return;
  const c = pull(d, w, hh);
  extend(c.d, c.w, c.h);
  relax(d, w, hh, push(d, w, hh, c), 6);
}

function widen(unk, w, hh) {
  const out = unk.slice();
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (unk[i]) continue;
      if ((x > 0 && unk[i - 1]) || (x < w - 1 && unk[i + 1]) || (y > 0 && unk[i - w]) || (y < hh - 1 && unk[i + w])) out[i] = 1;
    }
  }
  return out;
}

function boxBlur(src, w, hh, r) {
  const tmp = new Float32Array(w * hh);
  const out = new Float32Array(w * hh);
  const k = 2 * r + 1;
  for (let y = 0; y < hh; y++) {
    let sum = 0;
    const o = y * w;
    for (let x = -r; x < w; x++) {
      if (x + r < w) sum += src[o + x + r];
      if (x - r - 1 >= 0) sum -= src[o + x - r - 1];
      if (x >= 0) tmp[o + x] = sum / k;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y < hh; y++) {
      if (y + r < hh) sum += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
      if (y >= 0) out[y * w + x] = sum / k;
    }
  }
  return out;
}

function trustMap(unk, w, hh) {
  let k = new Float32Array(w * hh);
  for (let i = 0; i < k.length; i++) k[i] = unk[i] ? 0 : 1;
  const r = Math.max(1, Math.round(Math.max(w, hh) * 0.2));
  for (let i = 0; i < 3; i++) k = boxBlur(k, w, hh, r);
  const t = new Uint8Array(w * hh);
  let soft = false;
  for (let i = 0; i < t.length; i++) {
    const v = Math.min(1, Math.max(0, (k[i] - TRUST_LOW) / (TRUST_HIGH - TRUST_LOW)));
    t[i] = unk[i] ? Math.round(v * v * (3 - 2 * v) * 255) : 255;
    if (t[i] < 255) soft = true;
  }
  return soft ? t : null;
}

function tensors(flat, unknown, crop, mw, mh) {
  const ig = readable(mw, mh).g;
  ig.imageSmoothingQuality = 'high';
  ig.drawImage(flat, crop.x, crop.y, crop.w, crop.h, 0, 0, mw, mh);
  const mg = readable(mw, mh).g;
  mg.imageSmoothingQuality = 'high';
  mg.drawImage(unknown, 0, 0, crop.w, crop.h, 0, 0, mw, mh);
  const px = ig.getImageData(0, 0, mw, mh).data;
  const ma = mg.getImageData(0, 0, mw, mh).data;
  const n = mw * mh;
  let unk = new Uint8Array(n);
  for (let i = 0; i < n; i++) unk[i] = ma[i * 4 + 3] > 0 ? 1 : 0;
  if (mw < crop.w || mh < crop.h) unk = widen(unk, mw, mh);
  const f = new Float32Array(n * 4);
  const mask = new Uint8Array(n);
  let known = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (unk[i]) continue;
    known++;
    mask[i] = 255;
    f[p] = px[p];
    f[p + 1] = px[p + 1];
    f[p + 2] = px[p + 2];
    f[p + 3] = 1;
  }
  if (!known) return null;
  extend(f, mw, mh);
  const image = new Uint8Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    image[i] = f[p] + 0.5;
    image[n + i] = f[p + 1] + 0.5;
    image[2 * n + i] = f[p + 2] + 0.5;
  }
  const trust = trustMap(unk, mw, mh);
  return { image, mask, trust, smooth: trust ? image.slice() : null };
}

function planPart(d, flat, sel, r) {
  const w = r.x1 - r.x;
  const hh = r.y1 - r.y;
  const pad = Math.max(MIN_PAD, Math.round(Math.max(w, hh) * 0.5));
  const crop = clip(d, r.x - pad, r.y - pad, r.x1 + pad, r.y1 + pad);
  const unknown = unknownMap(flat, sel, crop);
  if (!unknown.known) return null;
  const s = Math.min(1, MAX_SIDE / Math.max(crop.w, crop.h));
  const mw = Math.max(1, Math.min(MAX_SIDE, Math.round(crop.w * s)));
  const mh = Math.max(1, Math.min(MAX_SIDE, Math.round(crop.h * s)));
  const t = tensors(flat, unknown.c, crop, mw, mh);
  if (!t) return null;
  return { ...t, crop, mw, mh, keep: clip(d, r.x - 3, r.y - 3, r.x1 + 3, r.y1 + 3), cover: sel ? null : grow(unknown.c, 2) };
}

export function planFill(d) {
  const flat = flatDoc(d);
  const sel = d.sel ? d.sel.c : null;
  const m = scan(d, flat, sel);
  if (!m) return { none: 'nothing' };
  const parts = regions(m).map((r) => planPart(d, flat, sel, r)).filter(Boolean);
  if (!parts.length) return { none: 'blind' };
  const grown = sel ? 0 : 2;
  return { kind: sel ? 'sel' : 'blanks', rev: d.rev, sel, parts, box: clip(d, m.x - grown, m.y - grown, m.x1 + grown, m.y1 + grown) };
}

function resultCanvas(p, data) {
  const n = p.mw * p.mh;
  const img = new ImageData(p.mw, p.mh);
  const o = img.data;
  for (let i = 0, q = 0; i < n; i++, q += 4) {
    const a = p.trust ? p.trust[i] / 255 : 1;
    for (let k = 0; k < 3; k++) o[q + k] = a === 1 ? data[k * n + i] : data[k * n + i] * a + p.smooth[k * n + i] * (1 - a) + 0.5;
    o[q + 3] = 255;
  }
  const c = mk(p.mw, p.mh);
  cx(c).putImageData(img, 0, 0);
  return c;
}

function fillLayer(plan, results) {
  const box = plan.box;
  const c = mk(box.w, box.h);
  const g = cx(c);
  plan.parts.forEach((p, i) => {
    const t = mk(p.crop.w, p.crop.h);
    const tg = cx(t);
    tg.imageSmoothingQuality = 'high';
    tg.drawImage(resultCanvas(p, results[i]), 0, 0, p.mw, p.mh, 0, 0, p.crop.w, p.crop.h);
    if (p.cover) {
      tg.globalCompositeOperation = 'destination-in';
      tg.drawImage(p.cover, 0, 0);
    }
    g.save();
    g.beginPath();
    g.rect(p.keep.x - box.x, p.keep.y - box.y, p.keep.w, p.keep.h);
    g.clip();
    g.drawImage(t, p.crop.x - box.x, p.crop.y - box.y);
    g.restore();
  });
  if (plan.kind === 'sel') {
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(plan.sel, -box.x, -box.y);
  }
  return new Layer({ name: LAYER_NAME, canvas: c, x: box.x, y: box.y });
}

function commit(d, plan, results) {
  const l = fillLayer(plan, results);
  d.act(LAYER_NAME, () => {
    if (plan.kind === 'sel') d.add(l);
    else d.layers.unshift(l);
  });
  emit('layers');
}

function progressDialog(onCancel) {
  const text = h('span.aitext', { text: TEXT.ready });
  const pct = h('span.aipct');
  const fill = h('i');
  const bar = h('div.aibar.wait', null, fill);
  const back = h('div.backdrop.aiback');
  const key = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    onCancel();
  };
  back.append(h('div.dialog.aidialog', null,
    h('div.dhead', { text: LAYER_NAME }),
    h('div.dbody', null, h('div.aistat', null, text, pct), bar),
    h('div.dfoot', null, h('button.btn', { text: 'Cancel', onclick: () => onCancel() }))));
  document.body.append(back);
  document.addEventListener('keydown', key, true);
  return {
    set(stage, frac, part) {
      const loading = stage === 'download';
      const count = part && part[1] > 1 ? ' ' + part[0] + ' of ' + part[1] : '';
      text.textContent = loading ? TEXT.first : stage === 'fill' ? TEXT.filling + count : TEXT.ready;
      pct.textContent = loading ? Math.floor(frac * 100) + '%' : '';
      bar.classList.toggle('wait', !loading);
      fill.style.width = loading ? (frac * 100).toFixed(1) + '%' : '';
    },
    close() {
      back.remove();
      document.removeEventListener('keydown', key, true);
    }
  };
}

function kindOf(e) {
  if (e && e.kind && e.kind !== 'engine' && e.kind !== 'worker') return e.kind;
  const m = String((e && e.message) || e);
  if (typeof e === 'number' || /memory|alloc|oom|^\d+$/i.test(m) || (e && e.name === 'RangeError')) return 'memory';
  return 'failed';
}

const frame = () => new Promise((r) => setTimeout(r, 40));

export async function aiFill(d) {
  if (!d || busy) return 'busy';
  busy = true;
  let stop = null;
  const cancelled = new Promise((r) => { stop = r; });
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const job = { cancelled: false, signal: ctl ? ctl.signal : undefined, transport: null, part: null, progress: () => {} };
  const dlg = progressDialog(() => {
    if (job.cancelled) return;
    job.cancelled = true;
    if (ctl) ctl.abort();
    if (job.transport && job.transport.worker) {
      if (live === job.transport) live = null;
      job.transport.kill();
    }
    stop('cancel');
  });
  job.progress = (stage, frac) => {
    if (!job.cancelled) dlg.set(stage, frac, job.part);
  };
  if (live) dlg.set('fill');
  const work = (async () => {
    await frame();
    const plan = planFill(d);
    if (plan.none) return plan.none;
    const results = [];
    for (const p of plan.parts) {
      job.part = [results.length + 1, plan.parts.length];
      results.push(await inpaint(p.image, p.mask, p.mw, p.mh, { job }));
      if (job.cancelled) return 'cancel';
    }
    if (d.rev !== plan.rev) return 'changed';
    commit(d, plan, results);
    return 'done';
  })();
  let out = 'failed';
  try {
    out = await Promise.race([work, cancelled]);
  } catch (e) {
    out = job.cancelled || (e && e.name === 'AbortError') ? 'cancel' : kindOf(e);
    if (out !== 'cancel') {
      console.warn('AI Fill:', e);
      drop();
      home = null;
    }
  }
  work.catch(() => {});
  dlg.close();
  busy = false;
  if (TEXT[out]) toast(TEXT[out]);
  return out;
}

export function resetAi() {
  drop();
  home = null;
}
