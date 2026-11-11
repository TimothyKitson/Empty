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
  const cli = (x, y) => ev(([x, y]) => window.app.api.toClient(x, y), [x, y]);
  const px = (x, y) => ev(([x, y]) => window.app.api.pixel(x, y), [x, y]);
  const run = (c, a) => ev(([c, a]) => { window.app.api.run(c, a); }, [c, a]);
  const tool = (id) => ev((id) => window.app.api.setTool(id), id);
  const settle = (ms = 120) => page.waitForTimeout(ms);
  const drag = async (pts, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    const a = await cli(pts[0][0], pts[0][1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      const p = await cli(pts[i][0], pts[i][1]);
      await page.mouse.move(p.x, p.y, { steps: 5 });
    }
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await settle();
  };
  const near = (a, b, tol = 10) => a && b.every((v, i) => Math.abs(a[i] - v) <= tol);
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const last = () => ev(() => { const d = window.app.doc; return d.hi >= 0 ? d.hist[d.hi].name : null; });
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
    await settle(350);
  };

  await ev(() => {
    const api = window.app.api;
    const d = api.newDoc({ w: 400, h: 300, dpi: 72, bg: 'white', name: 'Sweep' });
    const c = d.layers[0].canvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 400, 300);
    g.addColorStop(0, '#d33');
    g.addColorStop(0.5, '#3a6');
    g.addColorStop(1, '#24c');
    c.fillStyle = g;
    c.fillRect(0, 0, 400, 300);
    c.fillStyle = '#fff';
    c.fillRect(150, 100, 100, 100);
    d.layers[0].ver++;
    d.touch('all');
  });
  await settle();

  const filters = await ev(() => {
    window.app.api.emit('x');
    return null;
  });
  const groups = { Blur: ['Gaussian Blur…', 'Motion Blur…'], Sharpen: ['Unsharp Mask…', 'Sharpen', 'Sharpen More'], Noise: ['Add Noise…', 'Despeckle'], Pixelate: ['Mosaic…'], Distort: ['Twirl…', 'Pinch…', 'Ripple…'], Stylize: ['Emboss…', 'Find Edges', 'Solarize', 'Vignette…'], Other: ['High Pass…'], Render: ['Clouds'] };
  for (const g of Object.keys(groups)) {
    for (const f of groups[g]) {
      const before = await px(60, 60);
      await menu(['Filter', g, f]);
      await okDialog();
      const name = await last();
      const after = await px(60, 60);
      check('filter ' + f, name === f.replace('…', '') && after[3] === 255, [name, before, after]);
      await page.keyboard.press('Control+z');
      await settle(100);
    }
  }
  await menu(['Filter', 'Blur', 'Gaussian Blur…']);
  await okDialog();
  await page.keyboard.press('Control+Alt+f');
  await settle(400);
  check('last filter repeats', (await ev(() => window.app.doc.hist.filter((e) => e.name === 'Gaussian Blur').length)) === 2, null);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await settle();

  const adj = ['Brightness/Contrast…', 'Levels…', 'Curves…', 'Exposure…', 'Vibrance…', 'Hue/Saturation…', 'Color Balance…', 'Temperature & Tint…', 'Black & White…', 'Photo Filter…', 'Shadows/Highlights…', 'Invert', 'Posterize…', 'Threshold…', 'Desaturate'];
  for (const a of adj) {
    await menu(['Image', 'Adjustments', a]);
    if (await page.locator('.dialog .slider').count()) {
      await ev(() => { const s = document.querySelector('.dialog .slider'); s.value = Number(s.max) * 0.8; s.dispatchEvent(new Event('input')); });
      await settle(200);
    }
    await okDialog();
    const name = await last();
    check('adjustment ' + a, name === a.replace('…', ''), name);
    await page.keyboard.press('Control+z');
    await settle(100);
  }
  for (const a of ['Levels…', 'Black & White…', 'Hue/Saturation…']) {
    await menu(['Layer', 'New Adjustment Layer', a]);
    await okDialog();
  }
  check('three adjustment layers stack', (await ev(() => window.app.doc.layers.filter((l) => l.type === 'adjust').length)) === 3, null);
  const gray = await px(60, 60);
  check('black & white adjustment layer makes grey', Math.abs(gray[0] - gray[1]) < 4 && Math.abs(gray[1] - gray[2]) < 4, gray);
  for (let i = 0; i < 3; i++) await run('delLayer');
  await settle();

  await ev(() => { const d = window.app.doc; d.active = d.layers[0].id; window.app.api.emit('layers'); window.app.fg = { r: 0, g: 0, b: 0 }; });
  for (const t of ['pencil', 'blur', 'dodge', 'burn']) {
    await tool(t);
    await drag([[40, 40], [120, 60]]);
    check('tool ' + t, (await last()).toLowerCase().includes(t === 'pencil' ? 'pencil' : t), await last());
  }
  await tool('ellipse');
  await drag([[20, 200], [120, 280]]);
  check('elliptical marquee', !!(await ev(() => window.app.doc.sel)), null);
  await tool('move');
  const before = await px(70, 240);
  await drag([[70, 240], [300, 240]]);
  check('move tool carries selected pixels', near(await px(300, 240), before, 14) && (await px(70, 240))[3] === 0, [before, await px(300, 240), await px(70, 240)]);
  await page.keyboard.press('Control+Alt+t');
  await settle();
  await ev(() => { window.app.modal.setField(0, 60); window.app.modal.setField(1, 60); });
  await page.keyboard.press('Enter');
  await settle(300);
  check('free transform on a selection keeps one layer', (await ev(() => window.app.doc.layers.length)) === 1 && (await last()) === 'Free Transform', await last());
  await run('stroke');
  await okDialog();
  check('edit stroke', (await last()) === 'Stroke', await last());
  await run('fill');
  await okDialog();
  check('edit fill dialog', (await last()) === 'Fill', await last());
  await run('viaCut');
  await settle();
  check('layer via cut', (await ev(() => window.app.doc.layers.length)) === 2, null);
  await run('maskHide');
  await settle();
  check('hide-all mask hides the layer', (await ev(() => !!window.app.doc.al.mask)), null);
  await run('delMask');
  await run('mergeVisible');
  await settle();
  check('merge visible', (await ev(() => window.app.doc.layers.length)) === 1, null);
  for (const t of ['oval', 'line']) {
    await tool(t);
    await drag([[200, 30], [330, 90]]);
  }
  check('ellipse and line shapes', (await ev(() => window.app.doc.layers.length)) === 3, null);
  await run('canvasSize');
  await settle(200);
  await ev(() => { const t = document.querySelectorAll('.dialog input.txt'); t[0].value = '500'; t[0].dispatchEvent(new Event('input')); t[1].value = '400'; t[1].dispatchEvent(new Event('input')); });
  await okDialog();
  const d = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h }));
  check('canvas size', d.w === 500 && d.h === 400, d);
  await run('canvasFlipH');
  await run('canvas180');
  await run('flipV');
  await run('rotCw');
  await run('trim');
  await settle(300);
  check('flips, rotations and trim run', (await last()) === 'Trim', await last());
  const steps = await ev(() => window.app.doc.hist.length);
  for (let i = 0; i < steps; i++) await page.keyboard.press('Control+z');
  await settle(400);
  const back = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h, n: window.app.doc.layers.length }));
  check('undo all the way back', back.w === 400 && back.h === 300 && back.n === 1 && near(await px(200, 150), [255, 255, 255, 255]), [back, await px(200, 150)]);
  for (let i = 0; i < steps; i++) await page.keyboard.press('Control+Shift+z');
  await settle(400);
  check('redo all the way forward', (await last()) === 'Trim', await last());
  void filters;

  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
