const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');

(async () => {
  const target = process.argv[2] || 'site/index.html';
  const srv = await serve(path.resolve(__dirname, '..'));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const fails = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(srv.url + target + '?test=1');
  await page.waitForFunction(() => window.app && window.app.ready, null, { timeout: 15000 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const settle = (ms = 150) => page.waitForTimeout(ms);
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const menu = async (labels) => {
    await page.locator('.mtitle', { hasText: new RegExp('^' + labels[0] + '$') }).click();
    for (let i = 1; i < labels.length; i++) {
      const it = page.locator('.menu .item .lbl', { hasText: new RegExp('^' + esc(labels[i]) + '$') }).last();
      if (i < labels.length - 1) await it.hover();
      else await it.click();
      await settle(60);
    }
  };
  const okDialog = async () => {
    if (await page.locator('.dialog').count()) {
      await settle(150);
      await page.locator('.dialog .btn.primary').click();
    }
    await settle(400);
  };
  const stats = () => ev(() => {
    const l = window.app.doc.layers[0];
    const d = l.canvas.getContext('2d').getImageData(0, 0, l.canvas.width, l.canvas.height).data;
    let r = 0, g = 0, b = 0, lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]; g += d[i + 1]; b += d[i + 2];
      lo = Math.min(lo, d[i], d[i + 1], d[i + 2]);
      hi = Math.max(hi, d[i], d[i + 1], d[i + 2]);
    }
    const n = d.length / 4;
    return { r: r / n, g: g / n, b: b / n, lo, hi, first: [d[0], d[1], d[2]], w: l.canvas.width, h: l.canvas.height };
  });
  const flat = () => ev(() => {
    const d = window.app.api.newDoc({ w: 200, h: 150, dpi: 72, bg: 'white', name: 'Flat' });
    const g = d.layers[0].canvas.getContext('2d');
    g.fillStyle = 'rgb(180,197,140)';
    g.fillRect(0, 0, 200, 150);
    d.layers[0].ver++;
    d.touch('all');
  });
  const same = (s) => s.lo === 140 && s.hi === 197 && Math.abs(s.r - 180) < 0.01 && Math.abs(s.g - 197) < 0.01 && Math.abs(s.b - 140) < 0.01;

  await flat();
  await menu(['Filter', 'Blur', 'Gaussian Blur…']);
  await okDialog();
  let s = await stats();
  check('gaussian blur leaves a flat colour untouched', same(s), s);
  await menu(['Filter', 'Sharpen', 'Unsharp Mask…']);
  await okDialog();
  s = await stats();
  check('unsharp mask leaves a flat colour untouched', same(s), s);
  await menu(['Filter', 'Other', 'High Pass…']);
  await okDialog();
  s = await stats();
  check('high pass of a flat colour is mid grey', s.lo === 128 && s.hi === 128, s);

  await ev(() => {
    const d = window.app.api.newDoc({ w: 240, h: 180, dpi: 72, bg: 'white', name: 'Noise' });
    const c = d.layers[0].canvas;
    const g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height);
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < img.data.length; i += 4) {
      const x = (i / 4) % c.width;
      img.data[i] = 40 + (x / c.width) * 150 + rnd() * 40;
      img.data[i + 1] = 90 + rnd() * 100;
      img.data[i + 2] = 200 - (x / c.width) * 120 + rnd() * 30;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    d.layers[0].ver++;
    d.touch('all');
  });
  const before = await stats();
  await menu(['Filter', 'Blur', 'Gaussian Blur…']);
  await okDialog();
  const after = await stats();
  check('gaussian blur keeps the average brightness', Math.abs(after.r - before.r) < 0.6 && Math.abs(after.g - before.g) < 0.6 && Math.abs(after.b - before.b) < 0.6, [before, after]);
  check('gaussian blur actually smooths', after.hi - after.lo < before.hi - before.lo, [before.lo, before.hi, after.lo, after.hi]);

  await ev(() => {
    const d = window.app.api.newDoc({ w: 300, h: 200, dpi: 72, bg: 'white', name: 'Lift' });
    const g = d.layers[0].canvas.getContext('2d');
    g.fillStyle = '#b4c58c';
    g.fillRect(0, 0, 150, 200);
    g.fillStyle = '#000';
    g.fillRect(150, 0, 150, 200);
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(75, 100, 40, 0, Math.PI * 2);
    g.fill();
    d.layers[0].ver++;
    d.touch('all');
    window.app.api.setTool('wand');
  });
  await settle(300);
  const p = await ev(() => window.app.api.toClient(75, 100));
  await page.mouse.click(p.x, p.y);
  await settle(400);
  check('wand selection carries edge colour estimates', await ev(() => !!(window.app.doc.sel && window.app.doc.sel.decon)), null);
  await page.keyboard.press('Control+Alt+t');
  await settle(300);
  check('free transform starts on the wand selection', (await ev(() => window.app.modal && window.app.modal.id)) === 'transform', null);
  for (let i = 0; i < 15; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await settle(400);
  const lift = await ev(() => {
    const c = window.app.api.flatten(window.app.doc);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const at = (x, y) => { const q = (Math.round(y) * c.width + Math.round(x)) * 4; return [d[q], d[q + 1], d[q + 2], d[q + 3]]; };
    let hole = 0;
    let fringe = 0;
    for (let a = 0; a < 360; a += 3) {
      for (const rad of [37.5, 38.5, 39.5, 40.5, 41.5, 42.5]) {
        const cs = Math.cos((a * Math.PI) / 180);
        const sn = Math.sin((a * Math.PI) / 180);
        const h1 = at(75 + cs * rad, 100 + sn * rad);
        if (h1[3] >= 64) hole = Math.max(hole, Math.abs(h1[0] - 180), Math.abs(h1[1] - 197), Math.abs(h1[2] - 140));
        const f1 = at(225 + cs * rad, 100 + sn * rad);
        fringe = Math.max(fringe, Math.abs(f1[0] - f1[1]), Math.abs(f1[1] - f1[2]));
      }
    }
    return { hole, fringe, centre: at(225, 100), old: at(75, 100), layers: window.app.doc.layers.length };
  });
  check('free transform moved the disc and left a transparent hole', lift.centre[0] > 250 && lift.old[3] === 0 && lift.layers === 1, lift);
  check('free transform leaves no whitish ring around the hole', lift.hole <= 6, lift);
  check('free transform piece has no green fringe', lift.fringe <= 4, lift);
  await page.keyboard.press('Control+z');
  await settle(300);
  const undone = await ev(() => window.app.api.pixel(75, 100));
  check('undo puts the disc back', undone[0] > 250 && undone[1] > 250, undone);

  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
