const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const lib = require('./synth-lib');
const { CASES } = require('./synth-cases');

const args = process.argv.slice(2);
const flag = (name) => args.includes('--' + name);
const value = (name, d) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};

const SETS = {
  scenes: ['m-lake', 's-lake', 'm-tree', 'm-beach', 'l-house', 'l-sofa', 'multi-house', 'ext-sunset', 'm-house', 'l-lake', 'm-room', 'edge-beach', 'ext-beach', 'corner-room'],
  tex: ['m-brick', 'm-paving', 'm-planks', 'm-grass', 'm-leaves', 'm-gravel', 's-brick', 's-grass', 'l-brick', 'l-leaves', 'edge-paving', 'corner-gravel', 'ext-brick', 'ext-planks', 'ext-grass', 'multi-leaves'],
  smooth: ['m-sunset', 'm-sofa', 's-sunset'],
  proc: ['proc-flat', 'proc-grad', 'proc-noisy'],
  page: ['page-A', 'page-B', 'page-C'],
  pageab: ['page-A', 'page-B']
};
SETS.std = SETS.scenes.concat(SETS.tex, SETS.smooth, SETS.proc);
SETS.all = SETS.std.concat(SETS.page);
SETS.core = ['m-lake', 's-lake', 'm-tree', 'm-beach', 'l-house', 'l-sofa', 'multi-house', 'ext-sunset', 'm-house', 'l-lake', 'm-brick', 'm-paving', 'm-grass', 'm-leaves', 'm-gravel', 'm-sofa', 'm-sunset', 'ext-planks', 'proc-grad'];

const OUT = value('out', path.join(lib.SHOTS, 'eval'));

function expand(spec) {
  const ids = [];
  for (const part of spec.split(',')) for (const id of SETS[part] || [part]) if (!ids.includes(id)) ids.push(id);
  return ids;
}

function child() {
  const ids = value('ids', '').split(',');
  const seed = Number(value('seed', '7'));
  const tune = JSON.parse(value('tune', 'null'));
  const tag = value('tag', '');
  const synthCore = lib.loadCore();
  const { makeSheet } = require('./synth-sheet');
  const rows = [];
  for (const id of ids) {
    const def = CASES.find((c) => c.id === id);
    const c = def.make();
    if (!c) continue;
    const job = { w: c.w, h: c.h, rgba: c.rgba, target: c.target, known: c.known, init: null, seed, debug: true };
    if (tune) job.tune = tune;
    const r = lib.runJob(synthCore, job, 12);
    const mt = lib.metrics(c.truth, r.rgba, c.target, c.known, c.w, c.h);
    const s = r.stats;
    rows.push({
      id, seed, px: s.target, ms: r.ms, worst: r.worst, low: c.noTruth ? 0 : mt.low, mae: c.noTruth ? 0 : mt.mae, detail: c.noTruth ? mt.detailKnown : mt.detail, detailT: c.noTruth ? mt.detailKnown : mt.detailTruth,
      seam: mt.seam, seamT: mt.seamTruth, seamB: mt.seamB, seamBT: mt.seamBTruth, rim: mt.rim, share: s.topShare, coh: s.coherent, L: s.coarsest, iters: s.iters.join('/'), cut: s.budgetCut ? 1 : 0, hash: lib.hash(r.rgba), extra: s.extra || null
    });
    if (flag('sheets')) {
      let v1 = null;
      const vf = path.join(lib.SHOTS, 'v1', id + '.png');
      if (flag('v1') && fs.existsSync(vf)) v1 = lib.decodePng(fs.readFileSync(vf)).rgba;
      fs.mkdirSync(OUT, { recursive: true });
      makeSheet(c, r, v1, path.join(OUT, id + (tag ? '-' + tag : '') + (seed !== 7 ? '-s' + seed : '') + '.png'));
    }
    if (flag('save')) lib.savePng(path.join(OUT, id + (tag ? '-' + tag : '') + (seed !== 7 ? '-s' + seed : '') + '-full.png'), { w: c.w, h: c.h, rgba: r.rgba });
  }
  process.stdout.write('ROWS' + JSON.stringify(rows) + '\n');
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length);
}

async function parent() {
  const ids = expand(value('ids', 'core'));
  const seeds = value('seeds', '7').split(',').map(Number);
  const tag = value('tag', 'x');
  const par = Number(value('par', '3'));
  const jobs = [];
  const big = ids.filter((id) => id.startsWith('page'));
  const small = ids.filter((id) => !id.startsWith('page'));
  for (const seed of seeds) {
    const buckets = [];
    for (let i = 0; i < par; i++) buckets.push([]);
    small.forEach((id, i) => buckets[i % par].push(id));
    for (const b of buckets) if (b.length) jobs.push({ seed, ids: b });
    for (const id of big) jobs.push({ seed, ids: [id] });
  }
  const rows = [];
  let next = 0;
  const pass = ['work', 'sheets', 'save', 'v1'].filter(flag).map((f) => '--' + f);
  const runOne = () => new Promise((resolve) => {
    const j = jobs[next++];
    if (!j) return resolve();
    const a = [__filename, '--child', '--ids', j.ids.join(','), '--seed', String(j.seed), '--tag', tag, '--out', OUT].concat(pass);
    if (value('tune', '')) a.push('--tune', value('tune', ''));
    execFile(process.execPath, a, { maxBuffer: 1 << 26 }, (err, stdout, stderr) => {
      if (err) console.log('child failed: ' + j.ids.join(',') + ' ' + String(stderr).slice(0, 2000));
      const line = String(stdout).split('\n').find((l) => l.startsWith('ROWS'));
      if (line) rows.push(...JSON.parse(line.slice(4)));
      resolve(runOne());
    });
  });
  const t0 = Date.now();
  await Promise.all(Array.from({ length: par }, runOne));
  const keys = ['low', 'detailT', 'detail', 'rim', 'seam', 'seamT', 'seamB', 'seamBT', 'coh', 'share', 'ms'];
  const mean = {};
  for (const id of ids) {
    const rs = rows.filter((r) => r.id === id);
    if (!rs.length) continue;
    const m = { id, n: rs.length };
    for (const k of keys) m[k] = Math.round((rs.reduce((s, r) => s + r[k], 0) / rs.length) * 100) / 100;
    m.ms = Math.round(m.ms);
    m.iters = rs[0].iters;
    m.cut = rs.some((r) => r.cut) ? 'CUT' : '';
    m.hashes = rs.map((r) => r.hash).join(',');
    mean[id] = m;
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'eval-' + tag + '.json'), JSON.stringify({ mean, rows }, null, 1));
  const cmpTag = value('cmp', '');
  const cmp = cmpTag && fs.existsSync(path.join(OUT, 'eval-' + cmpTag + '.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'eval-' + cmpTag + '.json'), 'utf8')).mean : null;
  const cols = [['id', 14], ['low', 6], ['detailT', 7], ['detail', 6], ['rim', 5], ['seam', 5], ['seamT', 5], ['seamB', 5], ['seamBT', 6], ['coh', 5], ['share', 5], ['ms', 6], ['iters', 14], ['cut', 3]];
  console.log(cols.map(([k, n]) => pad(k, n)).join('') + (cmp ? '| d.low  d.detT d.seam d.ms' : ''));
  const sum = { low: 0, seam: 0, ms: 0, dlow: 0, dseam: 0, n: 0 };
  for (const id of ids) {
    const m = mean[id];
    if (!m) continue;
    let line = cols.map(([k, n]) => pad(m[k], n)).join('');
    sum.low += m.low;
    sum.seam += m.seam;
    sum.ms += m.ms;
    sum.n++;
    if (cmp && cmp[id]) {
      const c = cmp[id];
      const f = (v) => pad((v >= 0 ? '+' : '') + v.toFixed(2), 6);
      line += '| ' + f(m.low - c.low) + f(m.detailT - c.detailT) + f(m.seam - c.seam) + pad(m.ms - c.ms, 6);
      sum.dlow += m.low - c.low;
      sum.dseam += m.seam - c.seam;
    }
    console.log(line);
  }
  console.log('sum low ' + sum.low.toFixed(1) + '  sum seam ' + sum.seam.toFixed(2) + '  sum ms ' + sum.ms + (cmp ? '  d.low ' + sum.dlow.toFixed(1) + '  d.seam ' + sum.dseam.toFixed(2) : '') + '  (' + sum.n + ' cases, ' + Math.round((Date.now() - t0) / 1000) + ' s)');
}

if (flag('child')) child();
else parent();
