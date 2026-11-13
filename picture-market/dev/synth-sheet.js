const lib = require('./synth-lib');

function zoomAt(c, b, which) {
  const { w, target } = c;
  let px = Math.min(c.w - 1, b.x + (b.w >> 1));
  let py = Math.min(c.h - 1, b.y + (b.h >> 1));
  if (which === 0) while (px < w - 1 && target[py * w + px]) px++;
  else while (py > 0 && target[py * w + px]) py--;
  return { x: px, y: py };
}

function makeSheet(c, res, v1, file) {
  const { w, h } = c;
  const b = lib.boundsOf(c.target, w, h);
  const m = Math.round(Math.max(60, Math.max(b.w, b.h) * 0.35));
  const x0 = Math.max(0, b.x - m);
  const y0 = Math.max(0, b.y - m);
  const cw = Math.min(w, b.x + b.w + m) - x0;
  const ch = Math.min(h, b.y + b.h + m) - y0;
  const full = (rgba) => ({ w, h, rgba });
  const PW = v1 ? 392 : 520;
  const over = (img) => lib.fit(lib.crop(img, x0, y0, cw, ch), PW, 440);
  const input = lib.marked(full(c.rgba), c.target, c.known);
  const fld = lib.fieldImage(w, h, res.field);
  const row1 = [over(full(c.truth)), over(input), over(full(res.rgba))];
  if (v1) row1.push(over(full(v1)));
  const rows = [row1];
  for (let k = 0; k < 2; k++) {
    const z = zoomAt(c, b, k);
    const zx = Math.max(0, Math.min(w - PW, z.x - (PW >> 1)));
    const zy = Math.max(0, Math.min(h - 360, z.y - 180));
    const zc = (img) => lib.crop(img, zx, zy, Math.min(PW, w), Math.min(360, h));
    const row = [zc(full(c.truth)), zc(full(res.rgba))];
    if (v1) row.push(zc(full(v1)));
    row.push(k === 0 ? zc(fld) : over(fld));
    rows.push(row);
  }
  lib.savePng(file, lib.sheet(rows));
}

module.exports = { makeSheet };
