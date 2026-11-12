const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { serve } = require('./serve');

function args(argv) {
  const o = { target: 'site/index.html', tol: null, json: null, shots: null, only: null, selfcheck: false, big: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--tol') o.tol = Number(argv[++i]);
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--shots') o.shots = argv[++i];
    else if (a === '--only') o.only = argv[++i].split(',');
    else if (a === '--selfcheck') o.selfcheck = true;
    else if (a === '--no-big') o.big = false;
    else if (!a.startsWith('--')) o.target = a;
  }
  if (o.tol != null && !Number.isFinite(o.tol)) o.tol = null;
  return o;
}

const num = (v, d) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));
const pct = (v) => (v == null || !Number.isFinite(v) ? '-' : (v * 100).toFixed(3));
const signed = (v, d) => (v == null || !Number.isFinite(v) ? '-' : (v >= 0 ? '+' : '') + v.toFixed(d));
const COLS = [
  ['scene', 34, (r) => r.id.padEnd(4) + r.name + ' / ' + r.click],
  ['edgeMAE', 8, (r) => num(r.edgeMAE, 4)],
  ['bias', 8, (r) => signed(r.bias, 4)],
  ['shiftPx', 8, (r) => signed(r.edgeShiftPx, 3)],
  ['intMiss%', 9, (r) => pct(r.interiorMiss)],
  ['extLeak%', 9, (r) => pct(r.exteriorLeak)],
  ['haloDel', 8, (r) => num(r.haloDelete, 2)],
  ['haloFill', 9, (r) => num(r.haloFill, 2)],
  ['floor', 7, (r) => num(r.haloFloor, 2)],
  ['ms', 8, (r) => num(r.ms, 1)],
  ['note', 0, (r) => r.note || '']
];

function table(rows) {
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(COLS[i][1]) : COLS[i][1] ? c.padStart(COLS[i][1]) : '  ' + c)).join('').trimEnd();
  const out = [line(COLS.map((c) => c[0]))];
  for (const r of rows) out.push(line(COLS.map((c) => c[2](r))));
  return out.join('\n');
}

async function main(o) {
  const srv = await serve(path.resolve(__dirname, '..'));
  const browser = await chromium.launch();
  const errors = [];
  const result = { target: o.target, tol: o.tol, date: new Date().toISOString(), scenes: [], timing: null, ruler: null, errors };
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await page.goto(srv.url + o.target + '?test=1');
    await page.waitForFunction(() => window.app && window.app.ready, null, { timeout: 15000 });
    await page.evaluate(fs.readFileSync(path.join(__dirname, 'wand-page.js'), 'utf8'));
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const settle = (ms = 120) => page.waitForTimeout(ms);

    const click = async (seed, limit) => {
      await settle(160);
      const p = await ev((s) => window.__wb.arm(s), seed || null);
      if (!p.inStage) throw new Error('seed point is outside the stage');
      await page.mouse.click(p.x, p.y);
      return ev((ms) => window.__wb.wait(ms), limit);
    };
    const halos = async () => {
      await page.keyboard.press('Delete');
      await settle();
      const del = await ev(() => window.__wb.halo(false));
      await ev(() => window.__wb.magenta());
      await page.keyboard.press('Alt+Backspace');
      await settle();
      const fill = await ev(() => window.__wb.halo(true));
      return { del, fill };
    };

    const rulerDisc = await ev(() => window.__wb.ruler());
    const list = (await ev(() => window.__wb.list())).filter((s) => !o.only || o.only.includes(s.id));
    for (const def of list) {
      const row = { id: def.id, name: def.name, click: def.click };
      try {
        const info = await ev(([id, tol]) => window.__wb.prepare(id, tol), [def.id, o.tol]);
        Object.assign(row, { w: info.w, h: info.h, seed: info.seed, opts: info.opts });
        result.opts = info.opts;
        const t = await click(null, 20000);
        Object.assign(row, { ms: t.ms, taskMs: t.taskMs, selected: t.selected, timeout: t.timeout });
        const m = await ev(() => window.__wb.grab());
        Object.assign(row, m);
        if (o.shots) {
          fs.mkdirSync(o.shots, { recursive: true });
          await page.screenshot({ path: path.join(o.shots, 'wand-' + def.id + '-app.png') });
        }
        const notes = [];
        if (t.timeout) notes.push('timed out');
        if (!t.selected) notes.push('no selection');
        if (m.note) notes.push(m.note);
        if (info.hasTruth) {
          const hw = await halos();
          row.haloDelete = hw.del.halo;
          row.haloFill = hw.fill.halo;
          if (t.selected && !hw.del.changed) notes.push('Delete changed nothing');
          if (t.selected && !hw.fill.changed) notes.push('Fill changed nothing');
          if (o.shots) row.shot = await ev(() => window.__wb.shot());
          await ev(() => window.__wb.feed());
          const tm = await ev(() => window.__wb.grab());
          const th = await halos();
          const ref = await ev(() => window.__wb.refs());
          row.truthFeed = {
            edgeMAE: tm.edgeMAE, bias: tm.bias, edgeShiftPx: tm.edgeShiftPx, worst: tm.worst, interiorMiss: tm.interiorMiss, exteriorLeak: tm.exteriorLeak,
            haloDelete: th.del.halo, haloFill: th.fill.halo, predictedDelete: ref.predictedDelete, predictedFill: ref.predictedFill,
            haloGap: Math.max(Math.abs(th.del.halo - ref.predictedDelete), Math.abs(th.fill.halo - ref.predictedFill))
          };
          row.hardEdge = ref.hardEdge;
          row.shiftOne = ref.shiftOne;
          row.haloFloor = Math.max(th.del.halo, th.fill.halo);
        } else {
          notes.push('holes=' + m.holes + ' (' + m.holePx + 'px) specks=' + m.specks + ' (' + m.speckPx + 'px) selected=' + (m.selShare * 100).toFixed(1) + '%');
          if (o.shots) row.shot = await ev(() => window.__wb.shot());
        }
        row.note = notes.join('; ');
        await ev(() => window.__wb.close());
        await settle(60);
      } catch (e) {
        row.error = String((e && e.message) || e);
        row.note = 'ERROR ' + row.error.split('\n')[0];
      }
      if (row.shot) {
        fs.mkdirSync(o.shots, { recursive: true });
        fs.writeFileSync(path.join(o.shots, 'wand-' + row.id + '.png'), Buffer.from(row.shot.split(',')[1], 'base64'));
        delete row.shot;
      }
      result.scenes.push(row);
    }

    if (o.big) {
      const tm = {};
      try {
        const info = await ev((tol) => window.__wb.prepareBig(tol), o.tol);
        Object.assign(tm, { w: info.w, h: info.h, discs: info.discs, area: info.area, exact: info.exact, areaRel: info.rel });
        await settle(400);
        const a = await click(info.seeds[0], 180000);
        tm.first = Object.assign({ ms: a.ms, taskMs: a.taskMs, selected: a.selected, timeout: a.timeout }, await ev((s) => window.__wb.grabBig(s), info.seeds[0]));
        const b = await click(info.seeds[1], 180000);
        tm.second = Object.assign({ ms: b.ms, taskMs: b.taskMs, selected: b.selected, timeout: b.timeout }, await ev((s) => window.__wb.grabBig(s), info.seeds[1]));
        await ev(() => window.__wb.close());
      } catch (e) {
        tm.error = String((e && e.message) || e);
      }
      result.timing = tm;
    }

    const feeds = result.scenes.filter((r) => r.truthFeed).map((r) => r.truthFeed);
    const peak = (k) => feeds.reduce((m, f) => Math.max(m, Math.abs(f[k])), 0);
    result.ruler = {
      disc: rulerDisc,
      truthFeedMax: feeds.length ? {
        edgeMAE: peak('edgeMAE'), bias: peak('bias'), worst: peak('worst'), interiorMiss: peak('interiorMiss'), exteriorLeak: peak('exteriorLeak'),
        haloDelete: peak('haloDelete'), haloFill: peak('haloFill'), haloGap: peak('haloGap')
      } : null
    };
  } catch (e) {
    result.fatal = String((e && e.stack) || e);
  }
  await browser.close();
  await srv.close();
  return result;
}

function report(o, r) {
  const tol = r.opts ? r.opts.tolerance : o.tol;
  console.log('wand-bench  target=' + r.target + '  tolerance=' + tol + '  options=' + JSON.stringify(r.opts || {}));
  console.log(table(r.scenes));
  if (r.timing) {
    const t = r.timing;
    if (t.error) console.log('T   timing scene ERROR ' + t.error.split('\n')[0]);
    else {
      const part = (n, c) => n + ' click ' + num(c.ms, 0) + ' ms (handler ' + num(c.taskMs, 0) + ' ms, edgeMAE ' + num(c.edgeMAE, 4) + ', bias ' + signed(c.bias, 4) + ', shift ' + signed(c.edgeShiftPx, 3) + ' px, intMiss ' + pct(c.interiorMiss) + '%, extLeak ' + pct(c.exteriorLeak) + '%' + (c.selected ? '' : ', no selection') + (c.timeout ? ', timed out' : '') + ')';
      console.log('T   ' + t.w + 'x' + t.h + ' page with ' + t.discs + ' discs / page: ' + part('first', t.first) + '; ' + part('second', t.second));
    }
  }
  if (r.ruler && r.ruler.disc) {
    const d = r.ruler.disc.filter((x) => x.fast)[0];
    const f = r.ruler.truthFeedMax;
    console.log('ruler: disc r=' + d.r + ' supersampled area ' + d.area.toFixed(3) + ' vs pi r^2 ' + d.exact.toFixed(3) + ' (' + (d.rel * 100).toFixed(5) + '%)' +
      (f ? '; truth fed back as the selection, worst scene: edgeMAE ' + f.edgeMAE.toFixed(5) + ' |bias| ' + f.bias.toFixed(5) + ' intMiss ' + pct(f.interiorMiss) + '% extLeak ' + pct(f.exteriorLeak) + '%, halo = floor column (colour left in mixed pixels), measured vs predicted within ' + f.haloGap.toFixed(3) + ' levels' : ''));
  }
  if (o.selfcheck) {
    console.log('\ntruth fed back as the selection (floor = what a perfect coverage selection scores)');
    const extra = (s) => 'worst pixel ' + s.truthFeed.worst.toFixed(4) + '; predicted halo ' + s.truthFeed.predictedDelete.toFixed(2) + ' / ' + s.truthFeed.predictedFill.toFixed(2) +
      '; hard 50% edge would score edgeMAE ' + s.hardEdge.edgeMAE.toFixed(4) + ' bias ' + signed(s.hardEdge.bias, 4) + '; truth shifted 1px scores ' + s.shiftOne.edgeMAE.toFixed(4);
    console.log(table(r.scenes.filter((s) => s.truthFeed).map((s) => Object.assign({ id: s.id, name: s.name, click: s.click, ms: null, note: extra(s) }, s.truthFeed, { haloFloor: null }))));
    for (const d of r.ruler.disc) console.log('disc r=' + d.r + (d.fast ? ' (edge-only supersampling)' : ' (every pixel 16x16)') + ' area ' + d.area.toFixed(4) + ' exact ' + d.exact.toFixed(4) + ' rel ' + (d.rel * 100).toFixed(5) + '%');
    if (r.timing && !r.timing.error) console.log('timing scene discs: area ' + r.timing.area.toFixed(2) + ' exact ' + r.timing.exact.toFixed(2) + ' rel ' + (r.timing.areaRel * 100).toFixed(5) + '%');
  }
  if (r.fatal) console.log('FATAL ' + r.fatal);
  console.log(r.errors.length ? 'page errors: ' + r.errors.length + '\n' + r.errors.slice(0, 10).join('\n') : 'no page errors');
  console.log('RESULT ' + JSON.stringify(r));
  if (o.json) {
    fs.mkdirSync(path.dirname(path.resolve(o.json)), { recursive: true });
    fs.writeFileSync(o.json, JSON.stringify(r, null, 2));
  }
}

const opts = args(process.argv.slice(2));
main(opts)
  .then((r) => report(opts, r))
  .catch((e) => {
    console.log('FATAL ' + ((e && e.stack) || e));
    console.log('RESULT ' + JSON.stringify({ target: opts.target, fatal: String((e && e.stack) || e) }));
  })
  .finally(() => process.exit(0));
