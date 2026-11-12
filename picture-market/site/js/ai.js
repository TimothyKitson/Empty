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
const WASM_MAGIC = [0, 0x61, 0x73, 0x6d];
const MODEL_BYTES = 28079181;
const CACHE = 'picture-market-ai-1';
const MAX_SIDE = 512;
const GRID = 256;
const RUNS = 12;
const CAP = 1 / 3;
const REAL_MIN = 0.5;
const REACH = 0.85;
const CALM_R = 12;
const CALM_MIN = 8;
const MAX_COMPS = 32;
const KNOWN = 240;
const TRUST_LOW = 0.1;
const TRUST_HIGH = 0.26;
const RING = 40;
const BINS = 64;
const ACTIVE = 1.6;
const ACTIVE_FAR = 2;
const STRONG = 6;
const FAR = 4;
const TEX_LOW = 0.15;
const TEX_HIGH = 0.4;
const FLAT_PX = 24;
const TONE_TOL = 2;
const MAX_COLOURS = 8;
const BASE_PX = 500000;
const WEIGHT_MIN = 0.02;
const GRAIN_MIN = 0.6;
const GRAIN_GAIN = 0.88;
const AMP_STEP = 8;
const SEED = 0x5bd1e995;
const SLICE = 10;
const STRIP_PX = 200000;
const BAND_PX = 1200000;
const LAYER_NAME = 'AI Fill';

const TEXT = {
  nothing: 'Nothing is empty on this page. Select the area you want filled in first.',
  blind: 'There is no solid picture around that area for the AI to continue from.',
  empty: 'There is no solid picture on this page for the AI to continue from.',
  download: 'The AI model could not be downloaded. Check the internet connection and try again.',
  wasm: 'This browser cannot run the AI model because WebAssembly is switched off.',
  memory: 'There was not enough memory to run the AI model. Close other tabs and try again.',
  changed: 'The picture changed while the AI was working, so nothing was filled in.',
  failed: 'The AI fill did not work this time. Try again.',
  whatSel: 'Filling the selected area',
  whatPage: 'Filling the empty areas of the page',
  look: 'Looking at the picture…',
  ready: 'Getting the AI ready…',
  first: 'Getting the AI ready — 43 MB, first time only',
  filling: 'Filling…',
  finishing: 'Finishing…'
};

export const ai = {
  noWorker: false,
  stats: { downloads: 0, sessions: 0, runs: 0, threads: 0, worker: false, home: '', maxSide: 0, last: null, plan: null }
};

let home = null;
let live = null;
let busy = false;
let stale = 0;

function engine() {
  let ort = null;
  let session = null;
  return {
    async boot(m) {
      if (!ort) ort = await import(m.fresh ? m.runtime + '?retry=' + m.fresh : m.runtime);
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

function starts(buf, magic) {
  const head = new Uint8Array(buf, 0, Math.min(buf.byteLength, magic.length));
  return magic.every((v, i) => head[i] === v);
}

async function getBytes(url, size, tick, signal, magic = []) {
  const cache = await openCache();
  if (cache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const b = await hit.arrayBuffer();
        if (b.byteLength === size && starts(b, magic)) {
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
    if (!starts(buf.buffer, magic)) throw fail('download', 'content');
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
  await t.call('boot', { runtime, fresh: stale });
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
      getBytes(home.wasm, WASM_BYTES, tick('wasm'), job.signal, WASM_MAGIC),
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
      if (!t.worker) {
        stale++;
        break;
      }
    }
  }
  if (kindOf(last) !== 'memory') await forget();
  throw last;
}

export async function inpaint(image, mask, w, hh, opts = {}) {
  if (w > MAX_SIDE || hh > MAX_SIDE) throw fail('engine', 'too large');
  const job = opts.job || { progress: opts.onProgress || (() => {}), signal: opts.signal, cancelled: false, transport: null };
  const t = await ensure(job);
  if (job.cancelled) throw fail('cancel');
  job.transport = t;
  job.progress('fill');
  const t0 = performance.now();
  const r = await t.call('run', { image: image.buffer, mask: mask.buffer, w, h: hh }, t.worker ? [image.buffer, mask.buffer] : []);
  ai.stats.runs++;
  ai.stats.maxSide = Math.max(ai.stats.maxSide, w, hh);
  ai.stats.last = { w, h: hh, ms: Math.round(performance.now() - t0) };
  return new Uint8Array(r.data);
}

const READ = { willReadFrequently: true };
const waiters = [];
let port = null;

function nextTask() {
  return new Promise((r) => {
    if (!port && typeof MessageChannel === 'function') {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        const f = waiters.shift();
        if (f) f();
      };
      port = ch.port2;
    }
    if (!port) {
      setTimeout(r, 0);
      return;
    }
    waiters.push(r);
    port.postMessage(0);
  });
}

async function pause(job) {
  if (job.cancelled) throw fail('cancel');
  if (performance.now() - job.tick < SLICE) return;
  await nextTask();
  job.tick = performance.now();
  if (job.cancelled) throw fail('cancel');
}

async function rows(job, y0, y1, w, fn) {
  const step = Math.max(4, Math.min(512, Math.floor(STRIP_PX / Math.max(1, w))));
  for (let y = y0; y < y1; y += step) {
    fn(y, Math.min(step, y1 - y));
    await pause(job);
  }
}

function readable(w, hh) {
  const c = mk(w, hh);
  return { c, g: cx(c, READ) };
}

function clip(d, x0, y0, x1, y1) {
  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  return { x, y, w: Math.min(d.w, Math.ceil(x1)) - x, h: Math.min(d.h, Math.ceil(y1)) - y };
}

const step01 = (v) => {
  const t = Math.min(1, Math.max(0, v));
  return t * t * (3 - 2 * t);
};

function makeGrid(d) {
  const cell = Math.max(8, Math.ceil(Math.max(d.w, d.h) / GRID));
  const gw = Math.ceil(d.w / cell);
  const gh = Math.ceil(d.h / cell);
  const n = gw * gh;
  return {
    cell, gw, gh, n,
    tgt: new Float32Array(n), known: new Float32Array(n), seen: new Float32Array(n), comp: new Int16Array(n).fill(-1),
    m: new Float32Array(n), need: new Float32Array(n), todo: new Uint8Array(n)
  };
}

async function flatDoc(d, area, job) {
  const r = readable(d.w, d.h);
  const band = Math.max(32, Math.min(area.h, Math.floor(BAND_PX / area.w)));
  const b = mk(area.w, band);
  const bg = cx(b);
  for (let y = area.y; y < area.y + area.h; y += band) {
    const n = Math.min(band, area.y + area.h - y);
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, area.w, band);
    render(d, bg, 1, -area.x, -y);
    r.g.drawImage(b, 0, 0, area.w, n, area.x, y, area.w, n);
    await pause(job);
  }
  freeScratch();
  return r;
}

async function scan(P, job) {
  const { d, G, area } = P;
  const { cell, gw, gh } = G;
  const col = new Int32Array(area.w);
  for (let i = 0; i < area.w; i++) col[i] = ((area.x + i) / cell) | 0;
  const t = { x: d.w, y: d.h, x1: -1, y1: -1 };
  const s = { x: d.w, y: d.h, x1: -1, y1: -1 };
  const grow = (b, x, y) => {
    if (x < b.x) b.x = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y) b.y = y;
    if (y > b.y1) b.y1 = y;
  };
  await rows(job, area.y, area.y + area.h, area.w, (y, n) => {
    const f = P.fg.getImageData(area.x, y, area.w, n).data;
    const sa = P.selG ? P.selG.getImageData(0, y - area.y, area.w, n).data : null;
    for (let j = 0, p = 3; j < n; j++) {
      const row = (((y + j) / cell) | 0) * gw;
      for (let i = 0; i < area.w; i++, p += 4) {
        const a = f[p];
        if (sa ? sa[p] > 0 : a < KNOWN) {
          G.tgt[row + col[i]]++;
          grow(t, area.x + i, y + j);
        } else if (a >= KNOWN) {
          G.known[row + col[i]]++;
        }
        if (!sa && a < 255) grow(s, area.x + i, y + j);
      }
    }
  });
  for (let gy = 0; gy < gh; gy++) {
    const hh = Math.min(area.y + area.h, (gy + 1) * cell) - Math.max(area.y, gy * cell);
    for (let gx = 0; gx < gw; gx++) {
      const w = Math.min(area.x + area.w, (gx + 1) * cell) - Math.max(area.x, gx * cell);
      G.seen[gy * gw + gx] = w > 0 && hh > 0 ? w * hh : 0;
    }
  }
  const rect = (b) => (b.x1 < 0 ? null : { x: b.x, y: b.y, w: b.x1 - b.x + 1, h: b.y1 - b.y + 1 });
  return { target: rect(t), soft: rect(s) };
}

function spread(src, gw, gh, r) {
  const a = new Uint8Array(gw * gh);
  const b = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!src[y * gw + x]) continue;
      for (let k = Math.max(0, x - r); k <= Math.min(gw - 1, x + r); k++) a[y * gw + k] = 1;
    }
  }
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!a[y * gw + x]) continue;
      for (let k = Math.max(0, y - r); k <= Math.min(gh - 1, y + r); k++) b[k * gw + x] = 1;
    }
  }
  return b;
}

function islands(G, on) {
  const { gw, gh, n } = G;
  const mark = new Int16Array(n).fill(-1);
  const stack = new Int32Array(n);
  let count = 0;
  for (let s = 0; s < n; s++) {
    if (!on[s] || mark[s] >= 0) continue;
    let top = 0;
    stack[top++] = s;
    mark[s] = count;
    while (top) {
      const i = stack[--top];
      const x = i % gw;
      const y = (i - x) / gw;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const k = ny * gw + nx;
          if (!on[k] || mark[k] >= 0) continue;
          mark[k] = count;
          stack[top++] = k;
        }
      }
    }
    count++;
  }
  return { mark, count };
}

function findComps(P, target) {
  const { d, G } = P;
  const { gw, cell, n } = G;
  let found = null;
  for (let reach = 1; ; reach *= 2) {
    found = islands(G, spread(G.tgt, gw, G.gh, reach));
    if (found.count <= MAX_COMPS || reach > GRID) break;
  }
  const list = [];
  for (let i = 0; i < n; i++) {
    if (!G.tgt[i]) continue;
    const id = found.mark[i];
    G.comp[i] = id;
    const x = i % gw;
    const y = (i - x) / gw;
    const c = list[id] || (list[id] = { id, x, y, x1: x + 1, y1: y + 1, px: 0, si: 0, need: 0, blind: false, pal: [], lab: null, other: null, touched: false, grain: 0 });
    c.x = Math.min(c.x, x);
    c.y = Math.min(c.y, y);
    c.x1 = Math.max(c.x1, x + 1);
    c.y1 = Math.max(c.y1, y + 1);
    c.px += G.tgt[i];
  }
  const out = list.filter(Boolean);
  for (const c of out) {
    const x0 = Math.max(target.x, c.x * cell);
    const y0 = Math.max(target.y, c.y * cell);
    const x1 = Math.min(target.x + target.w, c.x1 * cell, d.w);
    const y1 = Math.min(target.y + target.h, c.y1 * cell, d.h);
    c.box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  return out;
}

const bin = (v) => Math.min(BINS - 1, Math.round(Math.abs(v) * 4));

async function study(P, job) {
  const { G, area } = P;
  const { cell, gw, gh, n } = G;
  const reach = Math.ceil(RING / cell) + 1;
  const close = spread(G.tgt, gw, gh, reach);
  const slot = new Int32Array(n).fill(-1);
  let slots = 0;
  for (let i = 0; i < n; i++) if (close[i] && G.known[i] > 0) slot[i] = slots++;
  const S = {
    reach, slot, act: new Float32Array(n), valid: new Float32Array(n),
    tone: new Int32Array(n).fill(-1), hist: new Uint16Array(slots * BINS * 3)
  };
  for (let gy = 0; gy < gh; gy++) {
    let a = -1;
    let b = -1;
    for (let gx = 0; gx < gw; gx++) {
      if (slot[gy * gw + gx] < 0) continue;
      if (a < 0) a = gx;
      b = gx;
    }
    if (a < 0) continue;
    const x0 = Math.max(area.x, a * cell - FAR);
    const x1 = Math.min(area.x + area.w, (b + 1) * cell + FAR);
    const y0 = Math.max(area.y, gy * cell - FAR);
    const y1 = Math.min(area.y + area.h, (gy + 1) * cell + FAR);
    const w = x1 - x0;
    const hh = y1 - y0;
    if (w < 3 || hh < 3) continue;
    const f = P.fg.getImageData(x0, y0, w, hh).data;
    const s = P.selG ? P.selG.getImageData(x0 - area.x, y0 - area.y, w, hh).data : null;
    const ok = new Uint8Array(w * hh);
    const lum = new Float32Array(w * hh);
    const busy = new Uint8Array(w * hh);
    for (let q = 0, p = 0; q < ok.length; q++, p += 4) {
      ok[q] = f[p + 3] >= KNOWN && !(s && s[p + 3] > 0) ? 1 : 0;
      lum[q] = 0.299 * f[p] + 0.587 * f[p + 1] + 0.114 * f[p + 2];
    }
    for (let y = 1; y < hh - 1; y++) {
      for (let x = 1, q = y * w + 1; x < w - 1; x++, q++) {
        if (!ok[q] || !ok[q - 1] || !ok[q + 1] || !ok[q - w] || !ok[q + w]) continue;
        const v = Math.abs(lum[q] - (lum[q - 1] + lum[q + 1] + lum[q - w] + lum[q + w]) / 4);
        if (v > ACTIVE) busy[q] = v > STRONG ? 2 : 1;
      }
    }
    const ya = Math.max(y0, gy * cell);
    const yb = Math.min(y1, (gy + 1) * cell);
    const xa = Math.max(x0, a * cell);
    const xb = Math.min(x1, (b + 1) * cell);
    const w4 = w * 4;
    const fw = FAR * w;
    for (let y = ya; y < yb; y++) {
      const rim = y - 1 < y0 || y + 1 >= y1;
      const deep = y - FAR >= y0 && y + FAR < y1;
      for (let x = xa; x < xb; x++) {
        const c = gy * gw + ((x / cell) | 0);
        const k = slot[c];
        const q = (y - y0) * w + x - x0;
        if (k < 0 || !ok[q]) continue;
        const p = q * 4;
        const rgb = (f[p] << 16) | (f[p + 1] << 8) | f[p + 2];
        const t = S.tone[c];
        if (t === -1) S.tone[c] = rgb;
        else if (t !== rgb) S.tone[c] = -2;
        let coarse = false;
        if (!busy[q] && deep && x - FAR >= x0 && x + FAR < x1 && ok[q - FAR] && ok[q + FAR] && ok[q - fw] && ok[q + fw]) {
          if (Math.abs(lum[q] - (lum[q - FAR] + lum[q + FAR] + lum[q - fw] + lum[q + fw]) / 4) > ACTIVE_FAR) {
            let edge = 0;
            for (let i = 1; i <= FAR && edge < 2; i++) edge = Math.max(busy[q - i], busy[q + i], busy[q - i * w], busy[q + i * w]);
            coarse = edge < 2;
          }
        }
        if (rim || x - 1 < x0 || x + 1 >= x1 || !ok[q - 1] || !ok[q + 1] || !ok[q - w] || !ok[q + w]) continue;
        const hr = f[p] - (f[p - 4] + f[p + 4] + f[p - w4] + f[p + w4]) / 4;
        const hg = f[p + 1] - (f[p - 3] + f[p + 5] + f[p - w4 + 1] + f[p + w4 + 1]) / 4;
        const hb = f[p + 2] - (f[p - 2] + f[p + 6] + f[p - w4 + 2] + f[p + w4 + 2]) / 4;
        const o = k * BINS * 3;
        S.hist[o + bin(hr)]++;
        S.hist[o + BINS + bin(hg)]++;
        S.hist[o + BINS * 2 + bin(hb)]++;
        S.valid[c]++;
        if (busy[q] || coarse) S.act[c]++;
      }
    }
    await pause(job);
  }
  return S;
}

function median(hist, o, total) {
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[o + b];
    if (acc * 2 >= total) return b / 4;
  }
  return BINS / 4;
}

function soften(v, wt, gw, gh, k) {
  const out = new Float32Array(v.length);
  const sum = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      let s = 0;
      const acc = [0, 0, 0];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const j = ny * gw + nx;
          const ww = wt[j];
          if (!ww) continue;
          s += ww;
          for (let c = 0; c < k; c++) acc[c] += v[j * k + c] * ww;
        }
      }
      const i = y * gw + x;
      sum[i] = s;
      if (s) for (let c = 0; c < k; c++) out[i * k + c] = acc[c] / s;
    }
  }
  return { out, sum };
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
  const holes = push(d, w, hh, c);
  relax(d, w, hh, holes, Math.min(40, Math.max(6, Math.floor(200000 / (holes.length + 1)))));
}

function boxBlur(src, w, hh, r) {
  const tmp = new Float32Array(w * hh);
  const out = new Float32Array(w * hh);
  for (let y = 0; y < hh; y++) {
    let sum = 0;
    const o = y * w;
    for (let x = -r; x < w; x++) {
      if (x + r < w) sum += src[o + x + r];
      if (x - r - 1 >= 0) sum -= src[o + x - r - 1];
      if (x >= 0) tmp[o + x] = sum;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -r; y < hh; y++) {
      if (y + r < hh) sum += tmp[(y + r) * w + x];
      if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x];
      if (y >= 0) out[y * w + x] = sum;
    }
  }
  return out;
}

function trustFor(P, c) {
  const { d, G } = P;
  const { cell, gw, gh } = G;
  const r = Math.max(2, Math.round(Math.min(0.5 * Math.max(c.box.w, c.box.h), 0.2 * Math.max(d.w, d.h)) / cell));
  const x0 = Math.max(0, c.x - 3 * r);
  const y0 = Math.max(0, c.y - 3 * r);
  const w = Math.min(gw, c.x1 + 3 * r) - x0;
  const hh = Math.min(gh, c.y1 + 3 * r) - y0;
  let num = new Float32Array(w * hh);
  let den = new Float32Array(w * hh);
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y + y0) * gw + x + x0;
      num[y * w + x] = G.known[i];
      den[y * w + x] = G.seen[i];
    }
  }
  for (let i = 0; i < 3; i++) {
    num = boxBlur(num, w, hh, r);
    den = boxBlur(den, w, hh, r);
  }
  for (let y = c.y; y < c.y1; y++) {
    for (let x = c.x; x < c.x1; x++) {
      const i = y * gw + x;
      if (G.comp[i] !== c.id) continue;
      const q = (y - y0) * w + x - x0;
      const k = den[q] > 0 ? num[q] / den[q] : 0;
      G.m[i] = step01((k - TRUST_LOW) / (TRUST_HIGH - TRUST_LOW));
    }
  }
}

function flatCells(G, tone) {
  const { gw, gh, n, cell } = G;
  const nb = Math.ceil(FLAT_PX / cell);
  const run = new Int32Array(n);
  const tall = new Int32Array(n);
  const out = new Int32Array(n).fill(-1);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      const t = tone[i];
      if (t < 0) continue;
      run[i] = x > 0 && tone[i - 1] === t ? run[i - 1] + 1 : 1;
      if (run[i] < nb) continue;
      tall[i] = y > 0 && tall[i - gw] > 0 && tone[i - gw] === t ? tall[i - gw] + 1 : 1;
      if (tall[i] < nb) continue;
      for (let yy = y - nb + 1; yy <= y; yy++) for (let xx = x - nb + 1; xx <= x; xx++) out[yy * gw + xx] = t;
    }
  }
  return out;
}

function paletteFor(G, c, flat, reach) {
  const seen = new Map();
  for (let y = Math.max(0, c.y - reach); y < Math.min(G.gh, c.y1 + reach); y++) {
    for (let x = Math.max(0, c.x - reach); x < Math.min(G.gw, c.x1 + reach); x++) {
      const t = flat[y * G.gw + x];
      if (t >= 0) seen.set(t, (seen.get(t) || 0) + 1);
    }
  }
  return [...seen].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLOURS).map((e) => [e[0] >> 16, (e[0] >> 8) & 255, e[0] & 255]);
}

function fields(P, S) {
  const { G } = P;
  const { gw, gh, n } = G;
  const frac = new Float32Array(n);
  const wt = new Float32Array(n);
  const sig = new Float32Array(n * 3);
  const sw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = S.valid[i];
    if (v >= 8) {
      frac[i] = S.act[i] / v;
      wt[i] = v;
    }
    if (v >= 16) {
      const o = S.slot[i] * BINS * 3;
      for (let c = 0; c < 3; c++) sig[i * 3 + c] = 1.4826 * median(S.hist, o + c * BINS, v);
      sw[i] = v;
    }
  }
  const a = soften(frac, wt, gw, gh, 1);
  const b = soften(sig, sw, gw, gh, 3);
  const f = new Float32Array(n * 4);
  const g = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (wt[i]) {
      f[i * 4] = step01((a.out[i] - TEX_LOW) / (TEX_HIGH - TEX_LOW));
      f[i * 4 + 3] = 1;
    }
    if (sw[i]) {
      g[i * 4] = b.out[i * 3];
      g[i * 4 + 1] = b.out[i * 3 + 1];
      g[i * 4 + 2] = b.out[i * 3 + 2];
      g[i * 4 + 3] = 1;
    }
  }
  extend(f, gw, gh);
  extend(g, gw, gh);
  P.tex = new Float32Array(n);
  P.grain = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    P.tex[i] = Math.min(1, Math.max(0, f[i * 4]));
    for (let c = 0; c < 3; c++) P.grain[i * 3 + c] = Math.max(0, g[i * 4 + c]);
  }
  for (const c of P.comps) trustFor(P, c);
  for (let i = 0; i < n; i++) G.m[i] *= P.tex[i];
  for (let round = 0; round < 2; round++) {
    const prev = G.m.slice();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (G.tgt[i]) continue;
        let best = prev[i];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < gw && ny < gh) best = Math.max(best, prev[ny * gw + nx]);
          }
        }
        G.m[i] = best;
      }
    }
  }
  const flat = flatCells(G, S.tone);
  for (const c of P.comps) c.pal = paletteFor(G, c, flat, S.reach);
  const img = new ImageData(gw, gh);
  for (let i = 0; i < n; i++) img.data[i * 4 + 3] = Math.round(G.m[i] * 255);
  P.mC = mk(gw, gh);
  cx(P.mC).putImageData(img, 0, 0);
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

function match(pal, r, g, b) {
  let best = pal.length;
  let far = TONE_TOL * 3 + 1;
  for (let k = 0; k < pal.length; k++) {
    const dr = Math.abs(pal[k][0] - r);
    const dg = Math.abs(pal[k][1] - g);
    const db = Math.abs(pal[k][2] - b);
    if (dr > TONE_TOL || dg > TONE_TOL || db > TONE_TOL || dr + dg + db >= far) continue;
    far = dr + dg + db;
    best = k;
  }
  return best;
}

function readBase(P, c, pad) {
  const { d } = P;
  const crop = clip(d, c.box.x - pad, c.box.y - pad, c.box.x + c.box.w + pad, c.box.y + c.box.h + pad);
  const k = Math.min(1, Math.sqrt(BASE_PX / (crop.w * crop.h)));
  const bw = Math.max(1, Math.round(crop.w * k));
  const bh = Math.max(1, Math.round(crop.h * k));
  const t = readable(bw, bh);
  t.g.imageSmoothingQuality = 'high';
  t.g.drawImage(P.flat, crop.x, crop.y, crop.w, crop.h, 0, 0, bw, bh);
  const px = t.g.getImageData(0, 0, bw, bh).data;
  let sa = null;
  if (P.sel) {
    t.g.clearRect(0, 0, bw, bh);
    t.g.drawImage(P.sel, crop.x, crop.y, crop.w, crop.h, 0, 0, bw, bh);
    sa = t.g.getImageData(0, 0, bw, bh).data;
  }
  const lim = bw < crop.w || bh < crop.h ? 255 : KNOWN;
  let unk = new Uint8Array(bw * bh);
  let aim = new Uint8Array(bw * bh);
  for (let i = 0, p = 3; i < unk.length; i++, p += 4) {
    aim[i] = sa ? (sa[p] > 0 ? 1 : 0) : px[p] < lim ? 1 : 0;
    unk[i] = aim[i] || px[p] < lim ? 1 : 0;
  }
  if (lim === 255) {
    unk = widen(unk, bw, bh);
    aim = widen(aim, bw, bh);
  }
  const close = widen(widen(unk, bw, bh), bw, bh);
  const rim = new Uint8Array(bw * bh);
  let known = 0;
  for (let i = 0; i < unk.length; i++) {
    if (unk[i]) continue;
    known++;
    rim[i] = close[i];
  }
  return { crop, bw, bh, px, unk, aim, rim, known, whole: crop.w >= d.w && crop.h >= d.h };
}

async function baseFor(P, c, job) {
  let b = null;
  for (let pad = 16; ; pad *= 4) {
    b = readBase(P, c, pad);
    if (b.known) break;
    if (b.whole) {
      c.blind = true;
      return;
    }
  }
  await pause(job);
  const { bw, bh, px, unk, rim } = b;
  const n = bw * bh;
  const f = new Float32Array(n * 4);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (!rim[i]) continue;
    f[p] = px[p];
    f[p + 1] = px[p + 1];
    f[p + 2] = px[p + 2];
    f[p + 3] = 1;
  }
  extend(f, bw, bh);
  const img = new ImageData(bw, bh);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const from = unk[i] ? f : px;
    img.data[p] = from[p] + (unk[i] ? 0.5 : 0);
    img.data[p + 1] = from[p + 1] + (unk[i] ? 0.5 : 0);
    img.data[p + 2] = from[p + 2] + (unk[i] ? 0.5 : 0);
    img.data[p + 3] = 255;
  }
  c.rgb = mk(bw, bh);
  cx(c.rgb).putImageData(img, 0, 0);
  c.crop = b.crop;
  await pause(job);
  if (c.pal.length) await labelFields(P, c, b, job);
}

async function labelFields(P, c, b, job) {
  const { G } = P;
  const { bw, bh, px, unk, aim, rim, crop } = b;
  const n = bw * bh;
  const K = c.pal.length;
  const lab = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) lab[i] = unk[i] ? 255 : match(c.pal, px[p], px[p + 1], px[p + 2]);
  const top = new Float32Array(n);
  const arg = new Uint8Array(n).fill(K);
  c.lab = [];
  for (let g0 = 0; g0 <= K; g0 += 3) {
    const f = new Float32Array(n * 4);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      if (!rim[i]) continue;
      const k = lab[i] - g0;
      if (k >= 0 && k < 3) f[p + k] = 1;
      f[p + 3] = 1;
    }
    extend(f, bw, bh);
    const img = new ImageData(bw, bh);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      for (let k = 0; k < 3; k++) {
        const v = f[p + k];
        img.data[p + k] = Math.round(Math.min(1, Math.max(0, v)) * 255);
        if (g0 + k <= K && v > top[i]) {
          top[i] = v;
          arg[i] = g0 + k;
        }
      }
      img.data[p + 3] = 255;
    }
    const cv = mk(bw, bh);
    cx(cv).putImageData(img, 0, 0);
    c.lab.push(cv);
    await pause(job);
  }
  const other = new ImageData(bw, bh);
  const all = new Float32Array(G.n);
  const odd = new Float32Array(G.n);
  for (let y = 0; y < bh; y++) {
    const gy = (((crop.y + ((y + 0.5) * crop.h) / bh) / G.cell) | 0) * G.gw;
    for (let x = 0; x < bw; x++) {
      const i = y * bw + x;
      const isOther = !unk[i] || arg[i] === K;
      other.data[i * 4 + 3] = isOther ? 255 : 0;
      if (!aim[i]) continue;
      const cell = gy + (((crop.x + ((x + 0.5) * crop.w) / bw) / G.cell) | 0);
      all[cell]++;
      if (isOther) odd[cell]++;
    }
  }
  c.other = mk(bw, bh);
  cx(c.other).putImageData(other, 0, 0);
  c.share = { all, odd };
}

function scratch(P, w, hh) {
  if (!P.tmp || P.tmp.c.width < w || P.tmp.c.height < hh) P.tmp = readable(Math.max(w, P.tmp ? P.tmp.c.width : 0), Math.max(hh, P.tmp ? P.tmp.c.height : 0));
  return P.tmp.g;
}

function pullRect(P, src, crop, x, y, w, n) {
  const g = scratch(P, w, n + 4);
  const kx = src.width / crop.w;
  const ky = src.height / crop.h;
  const exact = kx === 1 && ky === 1;
  const m = exact ? 0 : 2;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, n + 4);
  g.imageSmoothingEnabled = !exact;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (x - crop.x) * kx, (y - m - crop.y) * ky, w * kx, (n + 2 * m) * ky, 0, 0, w, n + 2 * m);
  return g.getImageData(0, m, w, n).data;
}

function labelRows(P, c, x, y, w, n) {
  const K = c.pal.length;
  const out = new Uint8Array(w * n).fill(K);
  const top = new Uint8Array(w * n);
  c.lab.forEach((cv, gi) => {
    const f = pullRect(P, cv, c.crop, x, y, w, n);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      for (let k = 0; k < 3; k++) {
        if (gi * 3 + k > K || f[p + k] <= top[i]) continue;
        top[i] = f[p + k];
        out[i] = gi * 3 + k;
      }
    }
  });
  return out;
}

function targetRows(P, x, y, w, n) {
  if (P.selG) return P.selG.getImageData(x - P.area.x, y - P.area.y, w, n).data;
  return P.fg.getImageData(x, y, w, n).data;
}

async function paintBase(P, c, job) {
  const { G, box } = P;
  const b = c.box;
  const col = new Int32Array(b.w);
  for (let i = 0; i < b.w; i++) col[i] = ((b.x + i) / G.cell) | 0;
  const lim = P.selG ? 1 : KNOWN;
  await rows(job, b.y, b.y + b.h, b.w, (y, n) => {
    const rgb = pullRect(P, c.rgb, c.crop, b.x, y, b.w, n);
    const lab = c.lab ? labelRows(P, c, b.x, y, b.w, n) : null;
    const t = targetRows(P, b.x, y, b.w, n);
    const img = P.fill.g.getImageData(b.x - box.x, y - box.y, b.w, n);
    const o = img.data;
    const K = c.pal.length;
    for (let j = 0, p = 0, q = 0; j < n; j++) {
      const row = (((y + j) / G.cell) | 0) * G.gw;
      for (let i = 0; i < b.w; i++, p += 4, q++) {
        if (G.comp[row + col[i]] !== c.id) continue;
        if (P.selG ? t[p + 3] < lim : t[p + 3] >= lim) continue;
        const k = lab ? lab[q] : K;
        if (k < K) {
          o[p] = c.pal[k][0];
          o[p + 1] = c.pal[k][1];
          o[p + 2] = c.pal[k][2];
        } else {
          o[p] = rgb[p];
          o[p + 1] = rgb[p + 1];
          o[p + 2] = rgb[p + 2];
        }
        o[p + 3] = 255;
      }
    }
    P.fill.g.putImageData(img, b.x - box.x, y - box.y);
  });
}

function needs(P) {
  const { G } = P;
  G.gain = new Float32Array(G.n);
  for (const c of P.comps) c.need = 0;
  for (let i = 0; i < G.n; i++) {
    const c = G.comp[i] >= 0 ? P.byId[G.comp[i]] : null;
    if (!c || c.blind || G.m[i] <= WEIGHT_MIN) continue;
    const part = c.share ? (c.share.all[i] ? c.share.odd[i] / c.share.all[i] : 0) : 1;
    G.need[i] = G.tgt[i] * part;
    G.gain[i] = G.need[i] * G.m[i];
    if (G.need[i] > 0) {
      G.todo[i] = 1;
      c.need += G.need[i];
    }
  }
}

function span(lo, hi, stride) {
  const out = [];
  for (let v = lo; v < hi; v += stride) out.push(v);
  out.push(hi);
  return out;
}

function greedy(P, s, ids) {
  const { d, G } = P;
  const { cell, gw, gh, n } = G;
  const nc = Math.max(1, Math.floor(MAX_SIDE / (s * cell)));
  const nx = Math.min(nc, gw);
  const ny = Math.min(nc, gh);
  const stride = Math.max(1, Math.floor(nc / 16));
  const left = new Float32Array(n);
  const made = new Float32Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    if (G.need[i] <= 0 || !ids.has(G.comp[i])) continue;
    left[i] = G.need[i];
    total += left[i];
  }
  const W = gw + 1;
  const size = W * (gh + 1);
  const I = new Float64Array(size);
  const V = new Float64Array(size);
  const J = new Float64Array(size);
  const M = new Float64Array(size);
  const X = new Float64Array(size);
  const Y = new Float64Array(size);
  const box = (A, x, y) => A[(y + ny) * W + x + nx] - A[y * W + x + nx] - A[(y + ny) * W + x] + A[y * W + x];
  for (let y = 0; y < gh; y++) {
    let run = 0;
    for (let x = 0; x < gw; x++) {
      run += G.known[y * gw + x];
      J[(y + 1) * W + x + 1] = J[y * W + x + 1] + run;
    }
  }
  const out = [];
  let covered = 0;
  while (total > 0.5 && out.length < 48) {
    let x0 = gw;
    let y0 = gh;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < gh; y++) {
      let ri = 0;
      let rv = 0;
      let rm = 0;
      let rx = 0;
      let ry = 0;
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const v = left[i];
        if (v > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          y1 = y;
        }
        ri += v;
        rv += v * G.m[i];
        rm += made[i];
        rx += v * (x + 0.5);
        ry += v * (y + 0.5);
        const o = (y + 1) * W + x + 1;
        I[o] = I[o - W] + ri;
        V[o] = V[o - W] + rv;
        M[o] = M[o - W] + rm;
        X[o] = X[o - W] + rx;
        Y[o] = Y[o - W] + ry;
      }
    }
    if (x1 < 0) break;
    let best = null;
    for (const gy of span(Math.max(0, y0 - ny + 1), Math.min(gh - ny, y1), stride)) {
      for (const gx of span(Math.max(0, x0 - nx + 1), Math.min(gw - nx, x1), stride)) {
        const u = box(I, gx, gy);
        if (u <= 0) continue;
        const area = (Math.min(d.w, (gx + nx) * cell) - gx * cell) * (Math.min(d.h, (gy + ny) * cell) - gy * cell);
        const real = box(J, gx, gy);
        const done = box(M, gx, gy);
        if (u > CAP * area || real + done < REAL_MIN * area) continue;
        const firm = real >= REAL_MIN * area;
        const off = Math.abs(box(X, gx, gy) / u - gx - nx / 2) / nx + Math.abs(box(Y, gx, gy) / u - gy - ny / 2) / ny;
        const v = box(V, gx, gy) * (0.2 + (real + done) / area) * (1 - 0.15 * off);
        if (!best || (firm && !best.firm) || (firm === best.firm && v > best.v)) best = { gx, gy, v, firm };
      }
    }
    if (!best) break;
    out.push({ gx: best.gx, gy: best.gy, nx, ny, s });
    for (let y = best.gy; y < best.gy + ny; y++) {
      for (let x = best.gx; x < best.gx + nx; x++) {
        const i = y * gw + x;
        made[i] += left[i];
        if (best.firm) covered += left[i] * G.m[i];
        total -= left[i];
        left[i] = 0;
      }
    }
  }
  return { wins: out, covered };
}

async function schedule(P, job) {
  const { d } = P;
  const comps = P.comps.filter((c) => !c.blind && c.need > 0);
  const top = Math.max(0, Math.ceil(4 * Math.log2(Math.max(d.w, d.h) / MAX_SIDE)));
  const scale = (i) => Math.pow(2, -i / 4);
  for (const c of comps) {
    const got = [];
    let all = 0;
    for (let i = 0; i < P.G.n; i++) if (P.G.comp[i] === c.id) all += P.G.gain[i];
    for (let i = 0; i <= top; i++) {
      got.push(greedy(P, scale(i), new Set([c.id])).covered);
      if (got[i] >= 0.995 * all) break;
      await pause(job);
    }
    const most = Math.max(...got);
    c.si = got.findIndex((v) => v >= REACH * most);
    c.dead = most <= 0;
  }
  const alive = comps.filter((c) => !c.dead);
  const memo = new Map();
  for (;;) {
    const groups = new Map();
    for (const c of alive) groups.set(c.si, (groups.get(c.si) || []).concat(c));
    let wins = [];
    let worst = null;
    for (const [i, list] of [...groups].sort((a, b) => a[0] - b[0])) {
      const key = i + ':' + list.map((c) => c.id).join();
      if (!memo.has(key)) memo.set(key, greedy(P, scale(i), new Set(list.map((c) => c.id))).wins);
      const w = memo.get(key);
      wins = wins.concat(w);
      if (i < top && (!worst || w.length > worst.n)) worst = { list, n: w.length };
      await pause(job);
    }
    if (wins.length <= RUNS || !worst) return wins;
    const big = Math.max(...worst.list.map((c) => c.need * Math.pow(2, -c.si / 2)));
    for (const c of worst.list) if (c.need * Math.pow(2, -c.si / 2) >= 0.6 * big) c.si++;
  }
}

async function prepare(d, job) {
  const sel = d.sel ? d.sel.c : null;
  const G = makeGrid(d);
  let area = { x: 0, y: 0, w: d.w, h: d.h };
  if (sel) {
    const sb = clip(d, d.sel.b.x, d.sel.b.y, d.sel.b.x + d.sel.b.w, d.sel.b.y + d.sel.b.h);
    if (sb.w < 1 || sb.h < 1) return { none: 'nothing' };
    const pad = Math.max(384, Math.round(Math.max(sb.w, sb.h) * 1.5));
    const snap = (v) => Math.floor(v / G.cell) * G.cell;
    area = clip(d, snap(sb.x - pad), snap(sb.y - pad), snap(sb.x + sb.w + pad) + G.cell, snap(sb.y + sb.h + pad) + G.cell);
  }
  const P = { d, G, sel, area, rev: d.rev, kind: sel ? 'sel' : 'blanks', selG: null, tmp: null, comps: [], wins: [], took: {} };
  let t0 = performance.now();
  const lap = (name) => {
    const t = performance.now();
    P.took[name] = Math.round(t - t0);
    t0 = t;
  };
  const flat = await flatDoc(d, area, job);
  lap('flatten');
  P.flat = flat.c;
  P.fg = flat.g;
  if (sel) {
    const r = readable(area.w, area.h);
    r.g.drawImage(sel, -area.x, -area.y);
    P.selG = r.g;
  }
  const found = await scan(P, job);
  lap('scan');
  if (!found.target) return { none: 'nothing' };
  let known = 0;
  for (let i = 0; i < G.n; i++) known += G.known[i];
  if (!known) return { none: sel ? 'blind' : 'empty' };
  P.box = sel ? found.target : found.soft;
  P.fill = readable(P.box.w, P.box.h);
  P.comps = findComps(P, found.target);
  P.byId = [];
  for (const c of P.comps) P.byId[c.id] = c;
  const S = await study(P, job);
  lap('study');
  fields(P, S);
  lap('fields');
  await pause(job);
  for (const c of P.comps) {
    await baseFor(P, c, job);
    if (!c.blind) await paintBase(P, c, job);
  }
  lap('base');
  if (P.comps.every((c) => c.blind)) return { none: sel ? 'blind' : 'empty' };
  needs(P);
  P.wins = await schedule(P, job);
  lap('plan');
  return P;
}

function picture(P, g, r, dw, dh) {
  const fx = r.x - P.box.x;
  const fy = r.y - P.box.y;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, dw, dh);
  if (P.sel) {
    g.drawImage(P.flat, r.x, r.y, r.w, r.h, 0, 0, dw, dh);
    g.drawImage(P.fill.c, fx, fy, r.w, r.h, 0, 0, dw, dh);
  } else {
    g.drawImage(P.fill.c, fx, fy, r.w, r.h, 0, 0, dw, dh);
    g.drawImage(P.flat, r.x, r.y, r.w, r.h, 0, 0, dw, dh);
  }
}

function weights(P, r, tw, th) {
  const { cell } = P.G;
  const g = readable(tw, th).g;
  const kx = tw / r.w;
  const ky = th / r.h;
  g.fillStyle = '#000';
  g.fillRect(0, 0, tw, th);
  for (const c of P.comps) {
    if (!c.other) continue;
    const x = (c.crop.x - r.x) * kx;
    const y = (c.crop.y - r.y) * ky;
    const w = c.crop.w * kx;
    const hh = c.crop.h * ky;
    if (x >= tw || y >= th || x + w <= 0 || y + hh <= 0) continue;
    g.clearRect(x, y, w, hh);
    g.drawImage(c.other, x, y, w, hh);
  }
  g.globalCompositeOperation = 'destination-in';
  g.imageSmoothingEnabled = true;
  g.drawImage(P.mC, r.x / cell, r.y / cell, r.w / cell, r.h / cell, 0, 0, tw, th);
  return g.getImageData(0, 0, tw, th).data;
}

function windowRect(P, win) {
  const { d, G } = P;
  const x = win.gx * G.cell;
  const y = win.gy * G.cell;
  return { x, y, w: Math.min(d.w, (win.gx + win.nx) * G.cell) - x, h: Math.min(d.h, (win.gy + win.ny) * G.cell) - y };
}

function lowPass(src, wt, w, hh, r) {
  const n = w * hh;
  let den = new Float32Array(n);
  for (let i = 0; i < n; i++) den[i] = wt[i] ? 1 : 0;
  den = boxBlur(den, w, hh, r);
  const out = [];
  for (let k = 0; k < 3; k++) {
    let num = new Float32Array(n);
    for (let i = 0; i < n; i++) if (wt[i]) num[i] = src(i, k);
    num = boxBlur(num, w, hh, r);
    out.push(num);
  }
  return { den, out };
}

function tolerance(px, real, w, hh) {
  const low = lowPass((i, k) => px[i * 4 + k], real, w, hh, CALM_R);
  const full = (2 * CALM_R + 1) ** 2;
  const tol = [];
  const lo = [];
  const hi = [];
  for (let k = 0; k < 3; k++) {
    const v = [];
    const fine = [];
    for (let i = 0; i < w * hh; i += 7) {
      if (low.den[i] <= 0.85 * full || !real[i]) continue;
      v.push(low.out[k][i] / low.den[i]);
      fine.push(px[i * 4 + k] - low.out[k][i] / low.den[i]);
    }
    if (v.length < 64) return null;
    v.sort((a, b) => a - b);
    fine.sort((a, b) => a - b);
    tol.push(Math.max(CALM_MIN, v[Math.floor(v.length * 0.75)] - v[Math.floor(v.length * 0.25)]));
    lo.push(fine[Math.floor(fine.length * 0.005)] * 1.15 - 2);
    hi.push(fine[Math.floor(fine.length * 0.995)] * 1.15 + 2);
  }
  return { tol, lo, hi };
}

function calm(out, px, keep, lim, w, hh) {
  const n = w * hh;
  const gen = new Uint8Array(n);
  for (let i = 0; i < n; i++) gen[i] = keep[i] ? 0 : 1;
  const a = lowPass((i, k) => out[k * n + i], gen, w, hh, CALM_R);
  const b = lowPass((i, k) => px[i * 4 + k], gen, w, hh, CALM_R);
  const fix = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (!gen[i] || !a.den[i]) continue;
    for (let k = 0; k < 3; k++) {
      const soft = a.out[k][i] / a.den[i];
      const dv = soft - b.out[k][i] / a.den[i];
      const fine = out[k * n + i] - soft;
      fix[i * 3 + k] = lim.tol[k] * Math.tanh(dv / lim.tol[k]) - dv + Math.min(lim.hi[k], Math.max(lim.lo[k], fine)) - fine;
    }
  }
  return fix;
}

async function runWindow(P, win, job) {
  const { G, box } = P;
  const r = windowRect(P, win);
  const tw = Math.max(1, Math.min(MAX_SIDE, Math.round(r.w * win.s)));
  const th = Math.max(1, Math.min(MAX_SIDE, Math.round(r.h * win.s)));
  const smooth = tw !== r.w || th !== r.h;
  const a = readable(tw, th);
  a.g.imageSmoothingEnabled = smooth;
  a.g.imageSmoothingQuality = 'high';
  picture(P, a.g, r, tw, th);
  const px = a.g.getImageData(0, 0, tw, th).data;
  a.g.clearRect(0, 0, tw, th);
  a.g.drawImage(P.fill.c, r.x - box.x, r.y - box.y, r.w, r.h, 0, 0, tw, th);
  const fa = a.g.getImageData(0, 0, tw, th).data;
  const wa = weights(P, r, tw, th);
  const n = tw * th;
  const mask = new Uint8Array(n).fill(255);
  const col = new Int32Array(tw);
  for (let i = 0; i < tw; i++) col[i] = ((r.x + ((i + 0.5) * r.w) / tw) / G.cell) | 0;
  let gen = 0;
  for (let j = 0, q = 0; j < th; j++) {
    const row = (((r.y + ((j + 0.5) * r.h) / th) / G.cell) | 0) * G.gw;
    for (let i = 0; i < tw; i++, q++) {
      if (fa[q * 4 + 3] === 0 || wa[q * 4 + 3] <= 6 || !G.todo[row + col[i]]) continue;
      mask[q] = 0;
      gen++;
    }
  }
  for (let y = win.gy; y < win.gy + win.ny; y++) for (let x = win.gx; x < win.gx + win.nx; x++) G.todo[y * G.gw + x] = 0;
  if (!gen) return;
  const f = new Float32Array(n * 4);
  let holes = false;
  for (let p = 0; p < f.length; p += 4) {
    if (px[p + 3] < 255) {
      holes = true;
      continue;
    }
    f[p] = px[p];
    f[p + 1] = px[p + 1];
    f[p + 2] = px[p + 2];
    f[p + 3] = 1;
  }
  if (holes) extend(f, tw, th);
  const image = new Uint8Array(3 * n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    image[i] = f[p] + 0.5;
    image[n + i] = f[p + 1] + 0.5;
    image[2 * n + i] = f[p + 2] + 0.5;
  }
  const keep = mask.slice();
  const real = new Uint8Array(n);
  for (let i = 0; i < n; i++) real[i] = keep[i] && px[i * 4 + 3] === 255 ? 1 : 0;
  await pause(job);
  const tol = tolerance(px, real, tw, th);
  const base = px.slice();
  await pause(job);
  const out = await inpaint(image, mask, tw, th, { job });
  if (job.cancelled) throw fail('cancel');
  job.tick = performance.now();
  const fix = tol ? calm(out, base, keep, tol, tw, th) : null;
  await pause(job);
  const img = new ImageData(tw, th);
  const o = img.data;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (keep[i]) continue;
    for (let k = 0; k < 3; k++) o[p + k] = Math.min(255, Math.max(0, out[k * n + i] + (fix ? fix[i * 3 + k] : 0) + 0.5));
    o[p + 3] = wa[p + 3];
  }
  const res = mk(tw, th);
  cx(res).putImageData(img, 0, 0);
  const fg = P.fill.g;
  fg.save();
  fg.globalCompositeOperation = 'source-atop';
  fg.imageSmoothingEnabled = smooth;
  fg.imageSmoothingQuality = 'high';
  fg.drawImage(res, 0, 0, tw, th, r.x - box.x, r.y - box.y, r.w, r.h);
  fg.restore();
  for (const c of P.comps) {
    if (c.blind || c.box.x >= r.x + r.w || c.box.y >= r.y + r.h || c.box.x + c.box.w <= r.x || c.box.y + c.box.h <= r.y) continue;
    c.touched = true;
  }
}

function noise(x, y) {
  let v = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ SEED;
  v = Math.imul(v ^ (v >>> 13), 1274126177);
  v ^= v >>> 16;
  return (((v & 255) + ((v >>> 8) & 255) + ((v >>> 16) & 255) + (v >>> 24)) / 255 - 2) * 1.7321;
}

async function measure(P, c, job) {
  const { d, G, box } = P;
  const b = c.box;
  const sum = new Float32Array(G.n * 3);
  const cnt = new Float32Array(G.n);
  const g = readable(Math.min(d.w, b.w + 2), Math.min(512, Math.floor(STRIP_PX / Math.max(1, b.w))) + 6).g;
  await rows(job, b.y, b.y + b.h, b.w, (y, n) => {
    const r = clip(d, b.x - 1, y - 1, b.x + b.w + 1, y + n + 1);
    picture(P, g, r, r.w, r.h);
    const f = g.getImageData(0, 0, r.w, r.h).data;
    const fa = P.fill.g.getImageData(b.x - box.x, y - box.y, b.w, n).data;
    const w4 = r.w * 4;
    for (let j = 0; j < n; j++) {
      const yy = y + j - r.y;
      if (yy < 1 || yy >= r.h - 1) continue;
      const row = (((y + j) / G.cell) | 0) * G.gw;
      for (let i = 0; i < b.w; i++) {
        const xx = b.x + i - r.x;
        if (xx < 1 || xx >= r.w - 1 || fa[(j * b.w + i) * 4 + 3] === 0) continue;
        const cell = row + (((b.x + i) / G.cell) | 0);
        if (G.comp[cell] !== c.id) continue;
        const p = (yy * r.w + xx) * 4;
        for (let k = 0; k < 3; k++) {
          const v = Math.abs(f[p + k] - (f[p + k - 4] + f[p + k + 4] + f[p + k - w4] + f[p + k + w4]) / 4);
          sum[cell * 3 + k] += Math.min(v, 3 * P.grain[cell * 3 + k] + 1.5);
        }
        cnt[cell]++;
      }
    }
  });
  const mean = new Float32Array(G.n * 3);
  for (let i = 0; i < G.n; i++) {
    if (!cnt[i]) continue;
    for (let k = 0; k < 3; k++) mean[i * 3 + k] = sum[i * 3 + k] / cnt[i];
  }
  const soft = soften(mean, cnt, G.gw, G.gh, 3).out;
  let most = 0;
  for (let i = 0; i < G.n; i++) {
    if (G.comp[i] !== c.id || !cnt[i]) continue;
    for (let k = 0; k < 3; k++) {
      const had = 1.2533 * soft[i * 3 + k];
      const want = P.grain[i * 3 + k];
      const add = GRAIN_GAIN * Math.sqrt(Math.max(0, want * want - had * had));
      const v = add >= GRAIN_MIN ? add : 0;
      P.amp[i * 3 + k] = v;
      if (v > most) most = v;
    }
  }
  c.grain = most;
}

function ampCanvas(P) {
  const { G } = P;
  const img = new ImageData(G.gw, G.gh);
  const wt = new Float32Array(G.n);
  for (let i = 0; i < G.n; i++) wt[i] = G.tgt[i] ? 1 : 0;
  const f = new Float32Array(G.n * 4);
  for (let i = 0; i < G.n; i++) {
    if (!wt[i]) continue;
    f[i * 4] = P.amp[i * 3];
    f[i * 4 + 1] = P.amp[i * 3 + 1];
    f[i * 4 + 2] = P.amp[i * 3 + 2];
    f[i * 4 + 3] = 1;
  }
  extend(f, G.gw, G.gh);
  for (let i = 0; i < G.n; i++) {
    for (let k = 0; k < 3; k++) img.data[i * 4 + k] = Math.min(255, Math.round(f[i * 4 + k] * AMP_STEP));
    img.data[i * 4 + 3] = 255;
  }
  const cv = mk(G.gw, G.gh);
  cx(cv).putImageData(img, 0, 0);
  return cv;
}

async function polish(P, c, amp, job) {
  const { G, box } = P;
  const b = c.box;
  const grid = { x: 0, y: 0, w: G.gw * G.cell, h: G.gh * G.cell };
  const col = new Int32Array(b.w);
  for (let i = 0; i < b.w; i++) col[i] = ((b.x + i) / G.cell) | 0;
  const K = c.pal.length;
  const eg = readable(b.w + 8, Math.min(512, Math.floor(STRIP_PX / Math.max(1, b.w))) + 12).g;
  const canBlur = typeof eg.filter === 'string';
  await rows(job, b.y, b.y + b.h, b.w, (y, n) => {
    const img = P.fill.g.getImageData(b.x - box.x, y - box.y, b.w, n);
    const o = img.data;
    const av = c.grain > 0 ? pullRect(P, amp, grid, b.x, y, b.w, n) : null;
    const lab = c.lab ? labelRows(P, c, b.x, y, b.w, n) : null;
    let edge = null;
    if (av && canBlur) {
      eg.clearRect(0, 0, b.w + 8, n + 8);
      eg.filter = 'blur(1.5px)';
      eg.drawImage(P.fill.c, b.x - box.x - 4, y - box.y - 4, b.w + 8, n + 8, 0, 0, b.w + 8, n + 8);
      eg.filter = 'none';
      edge = eg.getImageData(4, 4, b.w, n).data;
    }
    for (let j = 0, p = 0, q = 0; j < n; j++) {
      const row = (((y + j) / G.cell) | 0) * G.gw;
      for (let i = 0; i < b.w; i++, p += 4, q++) {
        if (o[p + 3] === 0 || G.comp[row + col[i]] !== c.id) continue;
        const k = lab ? lab[q] : K;
        if (k < K) {
          o[p] = c.pal[k][0];
          o[p + 1] = c.pal[k][1];
          o[p + 2] = c.pal[k][2];
          continue;
        }
        if (!av || !(av[p] || av[p + 1] || av[p + 2])) continue;
        const fade = edge ? Math.min(1, Math.max(0, (edge[p + 3] / 255 - 0.5) * 2)) : 1;
        const v = (noise(b.x + i, y + j) * fade) / (AMP_STEP * 1.118);
        o[p] = Math.min(255, Math.max(0, o[p] + av[p] * v + 0.5));
        o[p + 1] = Math.min(255, Math.max(0, o[p + 1] + av[p + 1] * v + 0.5));
        o[p + 2] = Math.min(255, Math.max(0, o[p + 2] + av[p + 2] * v + 0.5));
      }
    }
    P.fill.g.putImageData(img, b.x - box.x, y - box.y);
  });
}

async function finish(P, job) {
  const live = P.comps.filter((c) => !c.blind);
  P.amp = new Float32Array(P.G.n * 3);
  for (const c of live) {
    let want = 0;
    for (let i = 0; i < P.G.n; i++) if (P.G.comp[i] === c.id) want = Math.max(want, P.grain[i * 3], P.grain[i * 3 + 1], P.grain[i * 3 + 2]);
    if (want >= GRAIN_MIN) await measure(P, c, job);
  }
  const amp = live.some((c) => c.grain > 0) ? ampCanvas(P) : null;
  for (const c of live) if (c.grain > 0 || (c.lab && c.touched)) await polish(P, c, amp, job);
}

async function layerCanvas(P, job) {
  const { box } = P;
  const out = mk(box.w, box.h);
  const og = cx(out);
  if (P.sel) {
    og.drawImage(P.fill.c, 0, 0);
    og.globalCompositeOperation = 'destination-in';
    og.drawImage(P.sel, -box.x, -box.y);
    return out;
  }
  await rows(job, box.y, box.y + box.h, box.w, (y, n) => {
    const f = P.fg.getImageData(box.x, y, box.w, n).data;
    const img = P.fill.g.getImageData(0, y - box.y, box.w, n);
    const o = img.data;
    for (let p = 0; p < o.length; p += 4) {
      const a = f[p + 3];
      if (a === 255) {
        o[p + 3] = 0;
      } else if (o[p + 3]) {
        const k = a / 255;
        o[p] = f[p] * k + o[p] * (1 - k) + 0.5;
        o[p + 1] = f[p + 1] * k + o[p + 1] * (1 - k) + 0.5;
        o[p + 2] = f[p + 2] * k + o[p + 2] * (1 - k) + 0.5;
        o[p + 3] = 255;
      } else if (a >= KNOWN) {
        o[p] = f[p];
        o[p + 1] = f[p + 1];
        o[p + 2] = f[p + 2];
        o[p + 3] = 255;
      }
    }
    og.putImageData(img, 0, y - box.y);
  });
  return out;
}

function commit(d, P, canvas, opts) {
  const l = new Layer({ name: LAYER_NAME, canvas, x: P.box.x, y: P.box.y, opacity: opts.opacity == null ? 1 : Math.min(1, Math.max(0.01, opts.opacity)) });
  d.act(LAYER_NAME, () => d.add(l, d.layers.length));
  emit('layers');
}

function modelShare(P, c) {
  const { G } = P;
  let all = 0;
  let got = 0;
  for (let i = 0; i < G.n; i++) {
    if (G.comp[i] !== c.id) continue;
    all += G.tgt[i];
    got += G.gain ? G.gain[i] : 0;
  }
  return all ? Math.round((got / all) * 100) / 100 : 0;
}

function summary(P) {
  if (P.none) return P;
  return {
    kind: P.kind, box: P.box, runs: P.wins.length, took: P.took,
    comps: P.comps.map((c) => ({ box: c.box, blind: c.blind, colours: c.pal.length, scale: Math.pow(2, -c.si / 4), need: Math.round(c.need), model: modelShare(P, c) })),
    windows: P.wins.map((w) => ({ ...windowRect(P, w), scale: w.s }))
  };
}

export async function planFill(d) {
  return summary(await prepare(d, { cancelled: false, tick: performance.now() }));
}

function progressDialog(what, onCancel) {
  const text = h('span.aitext', { text: TEXT.look });
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
    h('div.dbody', null, h('div.aiwhat', { text: what }), h('div.aistat', null, text, pct), bar),
    h('div.dfoot', null, h('button.btn', { text: 'Cancel', onclick: () => onCancel() }))));
  document.body.append(back);
  document.addEventListener('keydown', key, true);
  return {
    set(stage, frac, part) {
      const loading = stage === 'download';
      const count = part && part[1] > 1 ? ' ' + part[0] + ' of ' + part[1] : '';
      text.textContent = loading ? TEXT.first : stage === 'fill' ? TEXT.filling + count : stage === 'look' ? TEXT.look : stage === 'done' ? TEXT.finishing : TEXT.ready;
      pct.textContent = loading ? Math.floor(frac * 100) + '%' : '';
      const steps = stage === 'fill' && part && part[1] > 1;
      bar.classList.toggle('wait', !loading && !steps);
      fill.style.width = loading ? (frac * 100).toFixed(1) + '%' : steps ? (((part[0] - 1) / part[1]) * 100).toFixed(1) + '%' : '';
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

export async function aiFill(d, opts = {}) {
  if (!d || busy) return 'busy';
  busy = true;
  let stop = null;
  const cancelled = new Promise((r) => { stop = r; });
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const job = { cancelled: false, signal: ctl ? ctl.signal : undefined, transport: null, part: null, progress: () => {}, tick: performance.now() };
  const dlg = progressDialog(d.sel ? TEXT.whatSel : TEXT.whatPage, () => {
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
  const work = (async () => {
    await frame();
    job.tick = performance.now();
    const P = await prepare(d, job);
    if (P.none) return P.none;
    ai.stats.plan = summary(P);
    for (let i = 0; i < P.wins.length; i++) {
      job.part = [i + 1, P.wins.length];
      if (live) job.progress('fill');
      await runWindow(P, P.wins[i], job);
      job.tick = performance.now();
    }
    job.progress('done');
    await finish(P, job);
    const canvas = await layerCanvas(P, job);
    if (job.cancelled) return 'cancel';
    if (d.rev !== P.rev) return 'changed';
    commit(d, P, canvas, opts);
    return 'done';
  })();
  let out = 'failed';
  try {
    out = await Promise.race([work, cancelled]);
  } catch (e) {
    out = job.cancelled || (e && (e.name === 'AbortError' || e.kind === 'cancel')) ? 'cancel' : kindOf(e);
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
