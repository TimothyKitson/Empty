const fs = require('fs');
const path = require('path');
const lib = require('./synth-lib');
const { CASES, QUICK, V1, procedural, PAGE_W, PAGE_H, BAND } = require('./synth-cases');
const { makeSheet } = require('./synth-sheet');

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const value = (name, d) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const QUICKRUN = flag('quick');
const ONLY = value('only', '');
const TAG = value('tag', '');
const TUNE = JSON.parse(value('tune', 'null'));
const SEED = Number(value('seed', '7'));
const EXPERIMENT = !!ONLY || !!TUNE || flag('cases-only');
const WITH_CHECKS = !EXPERIMENT || flag('checks');
const WITH_BROWSER = (!EXPERIMENT || flag('browser')) && !flag('no-browser');
const WITH_V1 = !QUICKRUN && !flag('no-v1') && (!EXPERIMENT || flag('v1'));
const SPEED = [
  { name: '100x100 hole', px: 10000, limit: 600, spec: { image: 'page', rect: { x: 500, y: 900, w: 100, h: 100 } } },
  { name: '300x300 hole', px: 90000, limit: 2500, spec: { image: 'page', rect: { x: 500, y: 900, w: 300, h: 300 } } },
  { name: '700x700 hole on the page', px: 490000, limit: 8000, spec: { image: 'page', rect: { x: 500, y: 900, w: 700, h: 700 } } },
  { name: '1600x1600 hole', px: 2560000, limit: 20000, spec: { image: 'page', rect: { x: 500, y: 900, w: 1600, h: 1600 } }, slow: true },
  { name: 'page under a 760 px band', px: PAGE_W * (PAGE_H - BAND), limit: 45000, spec: { image: 'page', band: BAND }, slow: true }
];

const fails = [];
const notes = [];
const check = (name, ok, info) => {
  if (ok) console.log('ok  ' + name);
  else {
    console.log('FAIL ' + name + ' ' + JSON.stringify(info));
    fails.push(name + ' ' + JSON.stringify(info));
  }
};

function pad(s, nn) {
  s = String(s);
  return s.length >= nn ? s + ' ' : s + ' '.repeat(nn - s.length);
}

function maxDiff(a, b, mask, want) {
  let worst = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!!mask[i] !== want) continue;
    for (let k = 0; k < 4; k++) {
      const d = Math.abs(a[i * 4 + k] - b[i * 4 + k]);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

function alphaMin(rgba, mask) {
  let lo = 255;
  for (let i = 0; i < mask.length; i++) if (mask[i] && rgba[i * 4 + 3] < lo) lo = rgba[i * 4 + 3];
  return lo;
}

function tiny(w, h, paint, hole, know) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const target = new Uint8Array(w * h);
  const known = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const c = paint(x, y);
      target[i] = hole(x, y) ? 1 : 0;
      known[i] = !target[i] && (!know || know(x, y)) ? 1 : 0;
      rgba[i * 4] = c[0];
      rgba[i * 4 + 1] = c[1];
      rgba[i * 4 + 2] = c[2];
      rgba[i * 4 + 3] = known[i] ? 255 : 0;
    }
  }
  return { w, h, rgba, target, known, init: null, seed: 5 };
}

function runChecks(synthCore) {
  const text = fs.readFileSync(lib.corePath(), 'utf8');
  check('the engine file exports only synthCore and has no comments, imports or Math.random', (text.match(/^export /gm) || []).length === 1 && !/Math\.random|^\s*import |\/\/|\/\*|document\.|window\./m.test(text), null);
  let free = 'ok';
  try {
    const fn = new Function('return (' + synthCore.toString() + ')')();
    const r = fn().start(tiny(24, 24, (x, y) => [x * 9, y * 9, 90], (x, y) => x > 9 && x < 14 && y > 9 && y < 14)).result();
    if (alphaMin(r.rgba, new Uint8Array(24 * 24).fill(1)) !== 255) free = 'pixels left unset';
  } catch (e) {
    free = String(e);
  }
  check('synthCore.toString() is a complete program', free === 'ok', free);

  const noisy = procedural('noisy')();
  const jobN = () => ({ w: noisy.w, h: noisy.h, rgba: noisy.rgba, target: noisy.target, known: noisy.known, init: null, seed: 11 });
  const a = lib.runJob(synthCore, jobN(), 12);
  const b = lib.runJob(synthCore, jobN(), 1);
  const c0 = lib.runJob(synthCore, jobN(), 0);
  const d = lib.runJob(synthCore, Object.assign(jobN(), { seed: 12 }), 12);
  check('same input and seed give the same bytes, whatever the step size', lib.hash(a.rgba) === lib.hash(b.rgba) && lib.hash(a.rgba) === lib.hash(c0.rgba) && !a.stats.budgetCut, [lib.hash(a.rgba), lib.hash(b.rgba), lib.hash(c0.rgba)]);
  check('progress never goes backwards and ends at 1', a.mono && b.mono && a.end === 1 && b.end === 1, [a.mono, b.mono, a.end]);
  notes.push('another seed gives ' + (lib.hash(d.rgba) === lib.hash(a.rgba) ? 'the same' : 'a different') + ' result');
  check('the input arrays are not modified and the result is a new array', a.rgba !== noisy.rgba && lib.hash(noisy.rgba) === lib.hash(procedural('noisy')().rgba), null);
  check('only target pixels are written (noisy gradient)', maxDiff(a.rgba, noisy.rgba, noisy.target, false) === 0 && alphaMin(a.rgba, noisy.target) === 255, maxDiff(a.rgba, noisy.rgba, noisy.target, false));
  check('stats carry the documented fields', ['levels', 'stopLevel', 'msLevel', 'totalMs', 'patch', 'sources', 'fallback', 'meanDist', 'iters', 'budgetCut', 'coarsest', 'roi', 'topShare', 'coherent', 'longestStep'].every((k) => a.stats[k] !== undefined) && a.stats.msLevel.length === a.stats.levels, Object.keys(a.stats));

  const flat = procedural('flat')();
  const rf = lib.runJob(synthCore, { w: flat.w, h: flat.h, rgba: flat.rgba, target: flat.target, known: flat.known, init: null, seed: 3 }, 12);
  const offFlat = maxDiff(rf.rgba, flat.truth, flat.target, true);
  check('flat colour blocks with a straight edge come back exactly (0 levels off)', offFlat === 0, offFlat);
  const grad = procedural('grad')();
  const rg = lib.runJob(synthCore, { w: grad.w, h: grad.h, rgba: grad.rgba, target: grad.target, known: grad.known, init: null, seed: 3 }, 12);
  const offGrad = maxDiff(rg.rgba, grad.truth, grad.target, true);
  check('a clean two-way gradient is within 3 levels everywhere', offGrad <= 3, offGrad);
  notes.push('flat scene worst error ' + offFlat + ', clean gradient worst error ' + offGrad + ' levels');

  const paint = (x, y) => [40 + ((x * 7 + y * 3) % 60), 120 + ((x * 5) % 40), 60 + ((y * 11) % 50)];
  const two = tiny(220, 180, paint, (x, y) => (x - 60) * (x - 60) + (y - 90) * (y - 90) < 900, (x, y) => (x - 160) * (x - 160) + (y - 90) * (y - 90) >= 900 && y < 150);
  const rt = lib.runJob(synthCore, two, 12);
  let otherAlpha = 0;
  let below = 0;
  for (let y = 0; y < two.h; y++) {
    for (let x = 0; x < two.w; x++) {
      const i = y * two.w + x;
      if ((x - 160) * (x - 160) + (y - 90) * (y - 90) < 900) otherAlpha = Math.max(otherAlpha, rt.rgba[i * 4 + 3]);
      if (y >= 150) below = Math.max(below, rt.rgba[i * 4 + 3]);
    }
  }
  check('only the hole inside the target is filled: a second hole and the empty strip stay untouched', maxDiff(rt.rgba, two.rgba, two.target, false) === 0 && otherAlpha === 0 && below === 0 && alphaMin(rt.rgba, two.target) === 255 && rt.stats.fallback === 'none', [maxDiff(rt.rgba, two.rgba, two.target, false), otherAlpha, below, rt.stats.fallback]);

  const cases = {
    'no target': [tiny(40, 30, paint, () => false), 'none'],
    'nothing known': [tiny(40, 30, paint, (x, y) => x > 10 && x < 30 && y > 5, () => false), 'grey'],
    'target is the whole picture': [tiny(16, 16, paint, () => true), 'grey'],
    'one pixel picture': [tiny(1, 1, paint, () => true), 'grey'],
    'thin strip, 2 px': [tiny(60, 2, paint, (x) => x >= 20 && x < 40), 'smooth'],
    'single row': [tiny(50, 1, paint, (x) => x >= 20 && x < 30), 'smooth'],
    'single column': [tiny(1, 50, paint, (x, y) => y >= 20 && y < 30), 'smooth'],
    'one known pixel': [tiny(30, 30, paint, (x, y) => !(x === 3 && y === 4)), 'smooth'],
    'tiny 5x5 with one hole': [tiny(5, 5, paint, (x, y) => x === 2 && y === 2), null],
    'strip 6 px high (smaller patch)': [tiny(80, 6, paint, (x) => x >= 30 && x < 50), 'none'],
    'known only in scattered dots': [tiny(40, 40, paint, (x, y) => x > 10 && x < 30 && y > 10 && y < 30, (x, y) => (x + y) % 3 === 0), null],
    'hole touching every border': [tiny(64, 64, paint, (x, y) => Math.abs(x - 32) < 6 || Math.abs(y - 32) < 6), 'none']
  };
  const bad = [];
  for (const name of Object.keys(cases)) {
    const [job, want] = cases[name];
    try {
      const before = lib.hash(job.rgba);
      const r = lib.runJob(synthCore, job, 12);
      const st = r.stats;
      if (want && st.fallback !== want) bad.push(name + ': fallback ' + st.fallback);
      if (maxDiff(r.rgba, job.rgba, job.target, false) !== 0) bad.push(name + ': wrote outside the target');
      if (alphaMin(r.rgba, job.target) !== 255) bad.push(name + ': target pixel left unset');
      if (lib.hash(job.rgba) !== before) bad.push(name + ': input modified');
      if (name === 'nothing known' && maxDiff(r.rgba, new Uint8ClampedArray(job.rgba.length).fill(128), job.target, true) > 127) bad.push(name + ': not grey');
      if (name === 'strip 6 px high (smaller patch)' && st.patch >= 7) bad.push(name + ': patch ' + st.patch);
      notes.push('degenerate "' + name + '": fallback ' + st.fallback + ', patch ' + st.patch);
    } catch (e) {
      bad.push(name + ': threw ' + e.message);
    }
  }
  check('degenerate inputs never throw, fill every target pixel and say which fallback was taken', bad.length === 0, bad);

  const withInit = Object.assign(jobN(), { init: noisy.truth });
  const ri = lib.runJob(synthCore, withInit, 12);
  const mi = lib.metrics(noisy.truth, ri.rgba, noisy.target, noisy.known, noisy.w, noisy.h);
  check('a first guess (init) is accepted and steers the fill', maxDiff(ri.rgba, noisy.rgba, noisy.target, false) === 0 && mi.low < 6, mi);
  const slow = lib.runJob(synthCore, Object.assign(jobN(), { maxMs: 1 }), 12);
  check('a budget of 1 ms still finishes, with less optimisation, and says so', slow.stats.budgetCut === true && alphaMin(slow.rgba, noisy.target) === 255 && slow.stats.iters.reduce((s, v) => s + v, 0) < a.stats.iters.reduce((s, v) => s + v, 0), slow.stats.iters);
}

async function runBrowser(synthCore) {
  const { chromium } = require('playwright');
  const { serve } = require('./serve');
  const esbuild = require('esbuild');
  const { openEngine } = require('./synth-page');
  const srv = await serve(lib.ROOT);
  const browser = await chromium.launch();
  const rows = [];
  try {
    const min = esbuild.transformSync(fs.readFileSync(lib.corePath(), 'utf8'), { minify: true, format: 'esm', target: 'es2022' }).code;
    const { page, errors } = await openEngine(browser, srv.url, min, path.relative(lib.ROOT, lib.corePath()).split(path.sep).join('/'));
    await page.evaluate((u) => window.S.image('lake', u), srv.url + 'dev/fixtures/lake.png');
    await page.evaluate(([u, c]) => window.S.image('page', u, c), [srv.url + 'dev/fixtures/ferns.png', { x: 0, y: 300, w: PAGE_W, h: PAGE_H }]);
    const spec = { image: 'lake', rect: { x: 520, y: 380, w: 300, h: 220 }, seed: 9 };
    const direct = await page.evaluate((s) => window.S.direct('plain', s, 12), spec);
    const whole = await page.evaluate((s) => window.S.direct('plain', s, 0), spec);
    const wPlain = await page.evaluate((s) => window.S.worker('plain', s, 12), spec);
    const wMin = await page.evaluate((s) => window.S.worker('min', s, 12), spec);
    check('a Worker started from synthCore.toString() gives the same bytes as the direct call', direct.hash === wPlain.hash && direct.hash === whole.hash && !direct.stats.budgetCut, [direct.hash, whole.hash, wPlain.hash]);
    check('the esbuild-minified function text, run in a Worker, gives the same bytes too', direct.hash === wMin.hash, [direct.hash, wMin.hash]);
    const lake = lib.loadFixture('lake');
    const tg = lib.rect(lake.w, lake.h, 520, 380, 300, 220);
    const kn = new Uint8Array(lake.w * lake.h);
    for (let i = 0; i < kn.length; i++) kn[i] = tg[i] ? 0 : 1;
    const nodeRun = lib.runJob(synthCore, { w: lake.w, h: lake.h, rgba: lake.rgba, target: tg, known: kn, init: null, seed: 9 }, 12);
    notes.push('Node and Chromium ' + (lib.hash(nodeRun.rgba) === direct.hash ? 'agree' : 'differ') + ' on the same job (' + lib.hash(nodeRun.rgba) + ' / ' + direct.hash + ')');
    check('step(12) on the main thread never runs long (under 60 ms)', direct.worst < 60, direct.worst);
    let worstStep = 0;
    for (const s of SPEED) {
      if (QUICKRUN && s.slow) continue;
      let r = await page.evaluate((sp) => window.S.worker('min', sp, 12), s.spec);
      if (r.ms > s.limit || r.worst >= 60) {
        notes.push(s.name + ': first run ' + r.ms + ' ms, longest step ' + r.worst + ' ms, ran again');
        r = await page.evaluate((sp) => window.S.worker('min', sp, 12), s.spec);
      }
      worstStep = Math.max(worstStep, r.worst);
      rows.push({ name: s.name, px: r.stats.target, ms: r.ms, limit: s.limit, worst: r.worst, iters: r.stats.iters.join('/'), sparse: r.stats.sparse.join('/'), stop: r.stats.stopLevel, cut: r.stats.budgetCut, roi: r.stats.roi.w + 'x' + r.stats.roi.h, mono: r.mono });
      check('speed: ' + s.name + ' (' + r.stats.target + ' px) in ' + r.ms + ' ms, limit ' + s.limit, r.ms <= s.limit && r.mono && r.end === 1, r.ms);
    }
    check('step(12) in a Worker never runs long (under 60 ms)', worstStep < 60, worstStep);
    check('no page errors', errors.length === 0, errors);
  } finally {
    await browser.close();
    await srv.close();
  }
  return rows;
}

async function ensureFixtures() {
  const missing = lib.FIXTURES.filter((f) => !fs.existsSync(path.join(lib.FIX, f.name + '.png')));
  if (!missing.length) return;
  const failed = await lib.fetchFixtures((m) => console.log(m));
  if (failed.length) console.log('FIXTURES NOT DOWNLOADED: ' + failed.join('; '));
  const { chromium } = require('playwright');
  const { serve } = require('./serve');
  const srv = await serve(lib.ROOT);
  const browser = await chromium.launch();
  try {
    await lib.decodeFixtures(browser, srv.url);
  } finally {
    await browser.close();
    await srv.close();
  }
}

async function main() {
  const started = Date.now();
  await ensureFixtures();
  const real = lib.FIXTURES.filter((f) => fs.existsSync(path.join(lib.FIX, f.name + '.png'))).length;
  console.log(real + ' of ' + lib.FIXTURES.length + ' real fixture images present');
  const synthCore = lib.loadCore();
  if (WITH_CHECKS) runChecks(synthCore);
  const want = ONLY ? ONLY.split(',') : QUICKRUN ? QUICK : CASES.map((c) => c.id);
  let v1 = null;
  if (WITH_V1) {
    const { chromium } = require('playwright');
    const { serve } = require('./serve');
    const srv = await serve(lib.ROOT);
    const via = process.env.HTTPS_PROXY || process.env.https_proxy;
    const browser = await chromium.launch(via ? { proxy: { server: via, bypass: '127.0.0.1,localhost' } } : {});
    v1 = { srv, browser };
  }
  const rows = [];
  try {
    for (const def of CASES) {
      if (!want.includes(def.id)) continue;
      const c = def.make();
      if (!c) {
        console.log('skip ' + def.id + ' (fixture missing)');
        continue;
      }
      const job = { w: c.w, h: c.h, rgba: c.rgba, target: c.target, known: c.known, init: null, seed: SEED, debug: true };
      if (TUNE) job.tune = TUNE;
      const r = lib.runJob(synthCore, job, 12);
      const mt = lib.metrics(c.truth, r.rgba, c.target, c.known, c.w, c.h);
      const s = r.stats;
      const row = {
        id: def.id, px: s.target, ms: r.ms, worst: r.worst, mae: c.noTruth ? '-' : mt.mae, low: c.noTruth ? '-' : mt.low, detail: c.noTruth ? mt.detailKnown : mt.detail, detailT: mt.detailTruth,
        seam: mt.seam, share: s.topShare, coh: s.coherent, L: s.coarsest, stop: s.stopLevel, iters: s.iters.join('/'), dist: s.meanDist, cut: s.budgetCut ? 'CUT' : ''
      };
      let other = null;
      if (v1 && V1.includes(def.id)) {
        const { runV1 } = require('./synth-page');
        try {
          const o = await runV1(v1.browser, v1.srv.url, def, c, path.join(lib.SHOTS, 'v1'), flag('v1-refresh'));
          other = o.rgba;
          const m1 = lib.metrics(c.truth, o.rgba, c.target, c.known, c.w, c.h);
          Object.assign(row, { v1ms: o.ms, v1mae: m1.mae, v1low: m1.low, v1detail: m1.detail, v1detailT: m1.detailTruth, v1seam: m1.seam });
        } catch (e) {
          console.log('v1 failed on ' + def.id + ': ' + e.message);
        }
      }
      rows.push(row);
      console.log(Object.keys(row).map((k) => k + '=' + row[k]).join(' '));
      makeSheet(c, r, other, path.join(lib.SHOTS, def.id + (TAG ? '-' + TAG : '') + '.png'));
      if (flag('save')) lib.savePng(path.join(lib.SHOTS, def.id + (TAG ? '-' + TAG : '') + '-full.png'), { w: c.w, h: c.h, rgba: r.rgba });
    }
  } finally {
    if (v1) {
      await v1.browser.close();
      await v1.srv.close();
    }
  }
  let speed = [];
  if (WITH_BROWSER) speed = await runBrowser(synthCore);
  if (WITH_CHECKS && !QUICKRUN && fs.existsSync(path.join(lib.FIX, 'ferns.png'))) {
    const out = require('child_process').execFileSync(process.execPath, ['--expose-gc', path.join(__dirname, 'synth-mem.js'), 'page-C'].concat(flag('work') ? ['--work'] : []), { encoding: 'utf8' });
    const mem = JSON.parse(out.trim().split('\n').pop());
    check('the whole-page case peaks under 600 MB (engine arrays ' + mem.peakMB + ' MB, process ' + mem.rssMB + ' MB)', mem.rssMB < 600, mem);
    notes.push('memory, page case: ' + mem.peakMB + ' MB of typed arrays at the peak (result included, inputs not), ' + mem.perMegapixelMB + ' MB per megapixel of working area');
  }
  fs.mkdirSync(lib.SHOTS, { recursive: true });
  fs.writeFileSync(path.join(lib.SHOTS, 'results' + (TAG ? '-' + TAG : '') + '.json'), JSON.stringify({ rows, speed, notes, fails }, null, 1));
  const cols = [['id', 15], ['px', 8], ['ms', 6], ['worst', 6], ['mae', 6], ['low', 6], ['detail', 7], ['detailT', 8], ['seam', 6], ['share', 6], ['coh', 6], ['L', 2], ['stop', 4], ['iters', 16], ['cut', 4]];
  const hasV1 = rows.some((r) => r.v1ms !== undefined);
  if (hasV1) cols.push(['v1ms', 6], ['v1mae', 6], ['v1low', 6], ['v1detail', 8], ['v1detailT', 9], ['v1seam', 6]);
  console.log('');
  console.log(cols.map(([k, n]) => pad(k, n)).join(''));
  for (const r of rows) console.log(cols.map(([k, n]) => pad(r[k] === undefined ? '' : r[k], n)).join(''));
  if (speed.length) {
    console.log('');
    console.log('speed in headless Chromium, one Worker, default budget');
    for (const s of speed) console.log(pad(s.name, 28) + pad(s.px + ' px', 12) + pad(s.ms + ' ms', 10) + pad('limit ' + s.limit, 12) + pad('longest step ' + s.worst, 20) + pad('iters ' + s.iters, 26) + (s.cut ? 'CUT' : ''));
  }
  if (notes.length) {
    console.log('');
    for (const nn of notes) console.log('note: ' + nn);
  }
  console.log('');
  console.log('took ' + Math.round((Date.now() - started) / 1000) + ' s');
  if (fails.length) {
    console.log(fails.length + ' CHECKS FAILED');
    for (const f of fails) console.log('  ' + f);
    process.exit(1);
  }
  console.log(WITH_CHECKS || WITH_BROWSER ? 'all checks passed' : 'cases done (checks not run in this mode)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
