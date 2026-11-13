const lib = require('./synth-lib');

const PAGE_W = 2625;
const PAGE_H = 3375;
const BAND = 760;

function photo(name, hole) {
  return () => {
    const img = lib.loadFixture(name);
    if (!img) return null;
    const { w, h } = img;
    const target = hole(w, h);
    const known = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) known[i] = target[i] ? 0 : 1;
    return { w, h, truth: img.rgba, rgba: holed(img.rgba, target), target, known };
  };
}

function holed(rgba, target) {
  const o = new Uint8ClampedArray(rgba);
  for (let i = 0; i < target.length; i++) {
    if (target[i]) {
      o[i * 4] = 255;
      o[i * 4 + 1] = 0;
      o[i * 4 + 2] = 255;
    }
  }
  return o;
}

const at = (fx, fy, fr, seed, ratio = 1) => (w, h) => lib.blob(w, h, w * fx, h * fy, w * fr, w * fr * ratio, seed);

function multi(w, h) {
  const m = lib.blob(w, h, w * 0.22, h * 0.3, w * 0.06, w * 0.05, 11);
  lib.blob(w, h, w * 0.7, h * 0.25, w * 0.05, w * 0.07, 0, m);
  lib.blob(w, h, w * 0.4, h * 0.72, w * 0.08, w * 0.05, 13, m);
  lib.blob(w, h, w * 0.85, h * 0.8, w * 0.04, w * 0.04, 14, m);
  return m;
}

function page(which) {
  return () => {
    const img = lib.loadFixture('ferns');
    if (!img) return null;
    const w = PAGE_W;
    const h = PAGE_H;
    const src = lib.crop(img, 0, 300, w, h);
    const rgba = new Uint8ClampedArray(w * h * 4);
    rgba.set(src.rgba.subarray(0, w * BAND * 4));
    const known = new Uint8Array(w * h);
    known.fill(1, 0, w * BAND);
    let target = new Uint8Array(w * h);
    if (which === 'A') target = lib.blob(w, h, 1300, BAND + 480, 750, 600, 21);
    else if (which === 'B') target = lib.blob(w, h, 1300, BAND + 200 + 720, 750, 600, 22);
    else target.fill(1, w * BAND);
    const top = which === 'B' ? BAND + 200 : BAND;
    target.fill(0, 0, w * top);
    return { w, h, truth: src.rgba, rgba, target, known, noTruth: true };
  };
}

function procedural(kind) {
  return () => {
    const w = 640;
    const h = 480;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const r = lib.rng(4242);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (kind === 'flat') {
          const left = x < 300 + (y - 240) * 0.25;
          rgba[o] = left ? 244 : 31;
          rgba[o + 1] = left ? 208 : 58;
          rgba[o + 2] = left ? 63 : 147;
        } else {
          const n = kind === 'noisy' ? (r() - 0.5) * 36 : 0;
          rgba[o] = 60 + (150 * x) / w + n;
          rgba[o + 1] = 190 - (120 * y) / h + n;
          rgba[o + 2] = 40 + (90 * (x + y)) / (w + h) + n;
        }
        rgba[o + 3] = 255;
      }
    }
    const target = kind === 'flat' ? lib.blob(w, h, 300, 240, 80, 70, 31) : lib.blob(w, h, 330, 230, 90, 75, 32);
    const known = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) known[i] = target[i] ? 0 : 1;
    return { w, h, truth: rgba, rgba: holed(rgba, target), target, known };
  };
}

const right = (w, h) => lib.rect(w, h, Math.round(w * 0.7), 0, w, h);

const CASES = [
  { id: 'm-brick', make: photo('brick', at(0.5, 0.5, 0.1, 1)) },
  { id: 'm-paving', make: photo('paving', at(0.45, 0.55, 0.1, 0)) },
  { id: 'm-planks', make: photo('planks', at(0.55, 0.45, 0.1, 2)) },
  { id: 'm-grass', make: photo('grass', at(0.5, 0.5, 0.1, 0)) },
  { id: 'm-leaves', make: photo('leaves', at(0.4, 0.6, 0.1, 3)) },
  { id: 'm-gravel', make: photo('gravel', at(0.6, 0.4, 0.1, 0)) },
  { id: 'm-lake', make: photo('lake', at(0.62, 0.3, 0.1, 4, 0.7)) },
  { id: 'm-house', make: photo('house', at(0.2, 0.75, 0.1, 5, 0.6)) },
  { id: 'm-beach', make: photo('beach', at(0.6, 0.45, 0.1, 6, 0.7)) },
  { id: 'm-room', make: photo('room', at(0.62, 0.25, 0.1, 0, 0.7)) },
  { id: 'm-tree', make: photo('tree', at(0.75, 0.62, 0.1, 7, 0.6)) },
  { id: 'm-sunset', make: photo('sunset', at(0.3, 0.3, 0.1, 8, 0.7)) },
  { id: 'm-sofa', make: photo('sofa', at(0.5, 0.2, 0.1, 0, 0.6)) },
  { id: 's-brick', make: photo('brick', at(0.3, 0.3, 0.04, 9)) },
  { id: 's-grass', make: photo('grass', at(0.7, 0.3, 0.04, 0)) },
  { id: 's-lake', make: photo('lake', at(0.36, 0.69, 0.045, 10, 0.6)) },
  { id: 's-sunset', make: photo('sunset', at(0.5, 0.51, 0.04, 0)) },
  { id: 'l-brick', make: photo('brick', at(0.5, 0.5, 0.2, 15)) },
  { id: 'l-leaves', make: photo('leaves', at(0.5, 0.5, 0.2, 0)) },
  { id: 'l-lake', make: photo('lake', at(0.5, 0.45, 0.2, 16, 0.6)) },
  { id: 'l-house', make: photo('house', at(0.5, 0.5, 0.2, 17, 0.6)) },
  { id: 'l-sofa', make: photo('sofa', at(0.5, 0.6, 0.2, 18, 0.5)) },
  { id: 'edge-paving', make: photo('paving', at(0, 0.5, 0.12, 19)) },
  { id: 'edge-beach', make: photo('beach', at(0.5, 1, 0.12, 20, 0.7)) },
  { id: 'corner-gravel', make: photo('gravel', at(1, 1, 0.16, 0)) },
  { id: 'corner-room', make: photo('room', at(0, 0, 0.14, 23)) },
  { id: 'ext-brick', make: photo('brick', right) },
  { id: 'ext-planks', make: photo('planks', right) },
  { id: 'ext-grass', make: photo('grass', right) },
  { id: 'ext-beach', make: photo('beach', right) },
  { id: 'ext-sunset', make: photo('sunset', right) },
  { id: 'multi-house', make: photo('house', multi) },
  { id: 'multi-leaves', make: photo('leaves', multi) },
  { id: 'proc-flat', make: procedural('flat') },
  { id: 'proc-grad', make: procedural('grad') },
  { id: 'proc-noisy', make: procedural('noisy') },
  { id: 'page-A', make: page('A'), big: true },
  { id: 'page-B', make: page('B'), big: true },
  { id: 'page-C', make: page('C'), big: true }
];

const QUICK = ['m-brick', 'm-grass', 'm-lake', 's-sunset', 'ext-planks', 'proc-flat', 'proc-grad'];
const V1 = ['m-brick', 'm-paving', 'm-grass', 'm-leaves', 'm-lake', 'm-house', 'm-beach', 'm-room', 'm-sunset', 'm-sofa', 's-lake', 'l-brick', 'l-lake', 'l-sofa'];

module.exports = { CASES, QUICK, V1, procedural, photo, at, holed, PAGE_W, PAGE_H, BAND };
