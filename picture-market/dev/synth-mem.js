const lib = require('./synth-lib');
const { CASES } = require('./synth-cases');

const id = process.argv[2] || 'page-C';
const def = CASES.find((c) => c.id === id);
const c = def.make();
const synthCore = lib.loadCore();
if (global.gc) global.gc();
const base = process.memoryUsage().arrayBuffers;
let peak = 0;
let rss = 0;
const run = synthCore().start({ w: c.w, h: c.h, rgba: c.rgba, target: c.target, known: c.known, init: null, seed: 7 });
const t0 = Date.now();
for (;;) {
  const fin = run.step(12);
  const m = process.memoryUsage();
  if (m.arrayBuffers - base > peak) peak = m.arrayBuffers - base;
  if (m.rss > rss) rss = m.rss;
  if (fin) break;
}
const st = run.result().stats;
console.log(JSON.stringify({ id, px: st.target, megapixels: Math.round((st.roi.w * st.roi.h) / 1e4) / 100, ms: Date.now() - t0, peakMB: Math.round(peak / 1e6), rssMB: Math.round(rss / 1e6), perMegapixelMB: Math.round(peak / 1e6 / ((st.roi.w * st.roi.h) / 1e6)) }));
