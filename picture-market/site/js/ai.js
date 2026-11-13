import { h, mk, cx, emit } from './util.js';
import { Layer, render, freeScratch } from './doc.js';
import { toast } from './ui.js';
import { synthCore } from './synth.js';

const KNOWN = 240;
const CLEAR = 128;
const PICKED = 128;
const BLEED = 8;
const SLICE = 12;
const BAND_PX = 1200000;
const BUDGET = 20000;
const SHOW_AFTER = 400;
const LAYER_NAME = 'AI Fill';

const TEXT = {
  select: 'Select the area to fill first: draw around it with the Lasso, then choose AI Fill again.',
  nothing: 'The selection is empty. Draw around the area you want filled, then choose AI Fill again.',
  solid: 'Nothing is empty inside the selection.',
  blind: 'There is no solid picture around that area for the AI to continue from.',
  empty: 'There is no solid picture on this page for the AI to continue from.',
  whole: 'The whole picture is selected, so there is nothing left to copy from. Select just the part you want replaced.',
  changed: 'The picture changed while the AI was working, so nothing was filled in.',
  failed: 'The AI fill did not work this time. Try again.',
  holes: 'Filling the empty space inside the selection',
  replace: 'Replacing what is inside the selection',
  look: 'Looking at the picture…',
  filling: 'Filling…',
  finishing: 'Finishing…'
};

export const ai = {
  noWorker: false,
  stats: { runs: 0, worker: false, last: null, plan: null }
};

let busy = false;

function workerMain(make) {
  self.onmessage = (ev) => {
    try {
      const run = make().start(ev.data);
      let last = 0;
      while (!run.step(100)) {
        const p = run.progress();
        if (p - last >= 0.01) {
          last = p;
          self.postMessage({ p });
        }
      }
      const r = run.result();
      self.postMessage({ done: true, rgba: r.rgba, stats: r.stats }, [r.rgba.buffer]);
    } catch (err) {
      self.postMessage({ error: String((err && err.message) || err) });
    }
  };
}

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

function fail(kind) {
  const e = new Error(kind);
  e.kind = kind;
  return e;
}

async function pause(job) {
  if (job.cancelled) throw fail('cancel');
  if (performance.now() - job.tick < SLICE) return;
  await nextTask();
  job.tick = performance.now();
  if (job.cancelled) throw fail('cancel');
}

async function flatPixels(d, job) {
  const w = d.w;
  const out = new Uint8ClampedArray(w * d.h * 4);
  const band = Math.max(16, Math.min(d.h, Math.floor(BAND_PX / w)));
  const g = cx(mk(w, band), { willReadFrequently: true });
  for (let y = 0; y < d.h; y += band) {
    const n = Math.min(band, d.h - y);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, w, band);
    render(d, g, 1, 0, -y);
    out.set(g.getImageData(0, 0, w, n).data, y * w * 4);
    await pause(job);
  }
  freeScratch();
  return out;
}

function selBox(d) {
  const b = d.sel.b;
  const x = Math.max(0, Math.floor(b.x));
  const y = Math.max(0, Math.floor(b.y));
  const x1 = Math.min(d.w, Math.ceil(b.x + b.w));
  const y1 = Math.min(d.h, Math.ceil(b.y + b.h));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

function coverage(d, sb) {
  const cov = new Uint8Array(d.w * d.h);
  const a = cx(d.sel.c).getImageData(sb.x, sb.y, sb.w, sb.h).data;
  for (let j = 0, p = 3; j < sb.h; j++) {
    const row = (sb.y + j) * d.w + sb.x;
    for (let i = 0; i < sb.w; i++, p += 4) cov[row + i] = a[p];
  }
  return cov;
}

function grow(b, x, y) {
  if (x < b.x) b.x = x;
  if (x > b.x1) b.x1 = x;
  if (y < b.y) b.y = y;
  if (y > b.y1) b.y1 = y;
}

async function prepare(d, job, forced) {
  if (!d.sel) return { none: 'select' };
  const sb = selBox(d);
  if (!sb) return { none: 'nothing' };
  const px = await flatPixels(d, job);
  const cov = coverage(d, sb);
  const w = d.w;
  let any = false;
  let clear = false;
  for (let j = 0; j < sb.h; j++) {
    const row = (sb.y + j) * w + sb.x;
    for (let i = 0; i < sb.w; i++) {
      const c = cov[row + i];
      if (!c) continue;
      any = true;
      if (c >= PICKED && px[(row + i) * 4 + 3] < CLEAR) clear = true;
    }
  }
  if (!any) return { none: 'nothing' };
  const kind = forced || (clear ? 'holes' : 'replace');
  const n = w * d.h;
  const target = new Uint8Array(n);
  const known = new Uint8Array(n);
  const tb = { x: w, y: d.h, x1: -1, y1: -1 };
  const lb = { x: w, y: d.h, x1: -1, y1: -1 };
  let targets = 0;
  for (let j = 0; j < sb.h; j++) {
    const y = sb.y + j;
    const row = y * w + sb.x;
    for (let i = 0; i < sb.w; i++) {
      const k = row + i;
      if (!cov[k]) continue;
      const a = px[k * 4 + 3];
      if (kind === 'replace' || a < KNOWN) {
        target[k] = 1;
        targets++;
        grow(tb, sb.x + i, y);
      }
      if (kind === 'replace' || a < 255) grow(lb, sb.x + i, y);
    }
  }
  if (!targets) return { none: kind === 'holes' ? 'solid' : 'nothing' };
  await pause(job);
  let knowns = 0;
  let solid = 0;
  for (let k = 0; k < n; k++) {
    if (px[k * 4 + 3] < KNOWN) continue;
    solid++;
    if (target[k]) continue;
    known[k] = 1;
    knowns++;
  }
  if (!knowns) return { none: solid ? 'whole' : 'empty' };
  const pad = kind === 'holes' ? BLEED : 0;
  const x0 = Math.max(0, lb.x - pad);
  const y0 = Math.max(0, lb.y - pad);
  const box = { x: x0, y: y0, w: Math.min(w, lb.x1 + 1 + pad) - x0, h: Math.min(d.h, lb.y1 + 1 + pad) - y0 };
  return {
    d, kind, px, cov, target, known, box, targets, knowns, rev: d.rev,
    tbox: { x: tb.x, y: tb.y, w: tb.x1 - tb.x + 1, h: tb.y1 - tb.y + 1 }
  };
}

function runWorker(job, input, onProgress) {
  return new Promise((resolve, reject) => {
    let url = '';
    let w = null;
    try {
      url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')(' + synthCore.toString() + ');'], { type: 'text/javascript' }));
      w = new Worker(url);
    } catch (e) {
      if (url) URL.revokeObjectURL(url);
      resolve(null);
      return;
    }
    let started = false;
    const end = () => {
      w.terminate();
      URL.revokeObjectURL(url);
      job.stop = null;
    };
    job.stop = () => {
      end();
      reject(fail('cancel'));
    };
    w.onerror = (ev) => {
      if (ev.preventDefault) ev.preventDefault();
      end();
      if (started) reject(fail('failed'));
      else resolve(null);
    };
    w.onmessage = (ev) => {
      const m = ev.data;
      started = true;
      if (m.error) {
        end();
        reject(fail('failed'));
      } else if (m.done) {
        end();
        resolve({ rgba: m.rgba, stats: m.stats });
      } else {
        onProgress(m.p);
      }
    };
    w.postMessage(input);
  });
}

async function runLocal(job, input, onProgress) {
  const run = synthCore().start(input);
  while (!run.step(8)) {
    onProgress(run.progress());
    await nextTask();
    if (job.cancelled) throw fail('cancel');
  }
  return run.result();
}

async function synth(P, job, seed, onProgress) {
  const input = { w: P.d.w, h: P.d.h, rgba: P.px, target: P.target, known: P.known, init: null, seed, maxMs: BUDGET };
  let r = null;
  if (!ai.noWorker && typeof Worker === 'function') r = await runWorker(job, input, onProgress);
  ai.stats.worker = !!r;
  if (!r) r = await runLocal(job, input, onProgress);
  return r;
}

function bleed(alpha, bw, bh) {
  const tmp = new Uint8Array(bw * bh);
  const out = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let on = 0;
      for (let k = Math.max(0, x - BLEED); k <= Math.min(bw - 1, x + BLEED) && !on; k++) on = alpha[y * bw + k] === 255 ? 1 : 0;
      tmp[y * bw + x] = on;
    }
  }
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      let on = 0;
      for (let k = Math.max(0, y - BLEED); k <= Math.min(bh - 1, y + BLEED) && !on; k++) on = tmp[k * bw + x];
      out[y * bw + x] = on;
    }
  }
  return out;
}

function layerCanvas(P, F) {
  const { box, px, cov, d } = P;
  const w = d.w;
  const img = new ImageData(box.w, box.h);
  const o = img.data;
  const alpha = new Uint8Array(box.w * box.h);
  for (let j = 0, q = 0; j < box.h; j++) {
    for (let i = 0; i < box.w; i++, q++) {
      const k = (box.y + j) * w + box.x + i;
      const c = cov[k];
      if (!c) continue;
      const p = k * 4;
      const t = q * 4;
      if (P.kind === 'replace') {
        o[t] = F[p];
        o[t + 1] = F[p + 1];
        o[t + 2] = F[p + 2];
        o[t + 3] = c;
        alpha[q] = c;
        continue;
      }
      const a = px[p + 3];
      if (a === 255) continue;
      const e = a / 255;
      const s = P.target[k] ? F : px;
      o[t] = px[p] * e + s[p] * (1 - e) + 0.5;
      o[t + 1] = px[p + 1] * e + s[p + 1] * (1 - e) + 0.5;
      o[t + 2] = px[p + 2] * e + s[p + 2] * (1 - e) + 0.5;
      o[t + 3] = c;
      alpha[q] = c;
    }
  }
  if (P.kind === 'holes') {
    const ring = bleed(alpha, box.w, box.h);
    for (let j = 0, q = 0; j < box.h; j++) {
      for (let i = 0; i < box.w; i++, q++) {
        if (!ring[q] || alpha[q]) continue;
        const p = ((box.y + j) * w + box.x + i) * 4;
        if (px[p + 3] !== 255) continue;
        const t = q * 4;
        o[t] = px[p];
        o[t + 1] = px[p + 1];
        o[t + 2] = px[p + 2];
        o[t + 3] = 255;
      }
    }
  }
  const c = mk(box.w, box.h);
  cx(c).putImageData(img, 0, 0);
  return c;
}

function commit(d, P, canvas, opts) {
  const l = new Layer({ name: LAYER_NAME, canvas, x: P.box.x, y: P.box.y, opacity: opts.opacity == null ? 1 : Math.min(1, Math.max(0.01, opts.opacity)) });
  d.act(LAYER_NAME, () => d.add(l, d.layers.length));
  emit('layers');
}

function summary(P) {
  if (P.none) return { none: P.none };
  return { kind: P.kind, box: P.box, targetBox: P.tbox, target: P.targets, known: P.knowns };
}

const modeOf = (opts) => (opts && (opts.mode === 'holes' || opts.mode === 'replace') ? opts.mode : '');

export async function planFill(d, opts) {
  return summary(await prepare(d, { cancelled: false, tick: performance.now() }, modeOf(opts)));
}

function progressDialog(onCancel) {
  const line = h('div.aiwhat', { text: ' ' });
  const text = h('span.aitext', { text: TEXT.look });
  const pct = h('span.aipct');
  const fill = h('i');
  const bar = h('div.aibar.wait', null, fill);
  const back = h('div.backdrop.aiback');
  let shown = false;
  let last = 0;
  const key = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    onCancel();
  };
  back.append(h('div.dialog.aidialog', null,
    h('div.dhead', { text: LAYER_NAME }),
    h('div.dbody', null, line, h('div.aistat', null, text, pct), bar),
    h('div.dfoot', null, h('button.btn', { text: 'Cancel', onclick: () => onCancel() }))));
  document.addEventListener('keydown', key, true);
  const timer = setTimeout(() => {
    shown = true;
    document.body.append(back);
  }, SHOW_AFTER);
  return {
    what(kind) {
      line.textContent = TEXT[kind];
    },
    set(stage, frac) {
      if (stage === 'fill') {
        last = Math.max(last, Math.min(1, frac || 0));
        text.textContent = TEXT.filling;
        pct.textContent = Math.floor(last * 100) + '%';
        bar.classList.remove('wait');
        fill.style.width = (last * 100).toFixed(1) + '%';
      } else {
        text.textContent = stage === 'done' ? TEXT.finishing : TEXT.look;
        pct.textContent = '';
      }
    },
    close() {
      clearTimeout(timer);
      if (shown) back.remove();
      document.removeEventListener('keydown', key, true);
    }
  };
}

export async function aiFill(d, opts = {}) {
  if (!d || busy) return 'busy';
  if (!d.sel) {
    toast(TEXT.select);
    return 'select';
  }
  busy = true;
  const job = { cancelled: false, tick: performance.now(), stop: null };
  let stop = null;
  const cancelled = new Promise((r) => { stop = r; });
  const dlg = progressDialog(() => {
    if (job.cancelled) return;
    job.cancelled = true;
    if (job.stop) job.stop();
    stop('cancel');
  });
  const seed = Number.isInteger(opts.seed) ? opts.seed : (Math.random() * 0x7fffffff) | 0;
  const work = (async () => {
    const t0 = performance.now();
    const forced = modeOf(opts);
    if (forced) dlg.what(forced);
    const P = await prepare(d, job, forced);
    if (P.none) return P.none;
    dlg.what(P.kind);
    ai.stats.plan = summary(P);
    const t1 = performance.now();
    dlg.set('fill', 0);
    const r = await synth(P, job, seed, (f) => {
      if (!job.cancelled) dlg.set('fill', f);
    });
    if (job.cancelled) return 'cancel';
    ai.stats.runs++;
    ai.stats.last = { seed, kind: P.kind, stats: r.stats, prepMs: Math.round(t1 - t0), fillMs: Math.round(performance.now() - t1), worker: ai.stats.worker };
    if (r.stats && r.stats.fallback === 'grey') return 'blind';
    dlg.set('done');
    await pause(job);
    const canvas = layerCanvas(P, r.rgba);
    if (job.cancelled) return 'cancel';
    if (d.rev !== P.rev) return 'changed';
    commit(d, P, canvas, opts);
    return 'done';
  })();
  let out = 'failed';
  try {
    out = await Promise.race([work, cancelled]);
  } catch (e) {
    out = job.cancelled || (e && e.kind === 'cancel') ? 'cancel' : 'failed';
    if (out !== 'cancel') console.warn('AI Fill:', e);
  }
  work.catch(() => {});
  dlg.close();
  busy = false;
  if (TEXT[out]) toast(TEXT[out]);
  return out;
}
