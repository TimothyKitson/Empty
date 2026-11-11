const path = require('path');
const { chromium } = require('playwright');
const { serve } = require('./serve');

(async () => {
  const target = process.argv[2] || 'site/index.html';
  const srv = await serve(path.resolve(__dirname, '..'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  const fails = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const cli = (x, y) => ev(([x, y]) => window.app.api.toClient(x, y), [x, y]);
  const px = (x, y) => ev(([x, y]) => window.app.api.pixel(x, y), [x, y]);
  const run = (c, a) => ev(([c, a]) => { window.app.api.run(c, a); }, [c, a]);
  const tool = (id) => ev((id) => window.app.api.setTool(id), id);
  const settle = (ms = 200) => page.waitForTimeout(ms);
  const drag = async (pts, steps = 8) => {
    const a = await cli(pts[0][0], pts[0][1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      const p = await cli(pts[i][0], pts[i][1]);
      await page.mouse.move(p.x, p.y, { steps });
    }
    await page.mouse.up();
    await settle();
  };
  const click = async (x, y) => { const a = await cli(x, y); await page.mouse.click(a.x, a.y); await settle(); };
  const near = (a, b, tol = 8) => a && b.every((v, i) => Math.abs(a[i] - v) <= tol);
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });
  const boot = async () => {
    await page.goto(srv.url + target);
    await page.waitForFunction(() => window.app && window.app.ready, null, { timeout: 15000 });
    await settle(400);
  };

  await boot();
  await shot('welcome');
  check('welcome screen shows', await page.locator('.welcome').isVisible(), null);
  await page.locator('.preset').first().click();
  await settle(600);
  const d = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h, dpi: window.app.doc.dpi, zoom: window.app.api.view.zoom }));
  check('yearbook preset makes a 2550x3300 page at 300 ppi', d.w === 2550 && d.h === 3300 && d.dpi === 300 && d.zoom < 0.4, d);

  await ev(() => { window.app.fg = { r: 200, g: 30, b: 30 }; window.app.api.emit('color'); });
  await run('newLayer');
  await tool('brush');
  await ev(() => Object.assign(window.app.opts.brush, { size: 120, hardness: 60, opacity: 100 }));
  let t0 = Date.now();
  await drag([[300, 400], [2200, 400], [2200, 2800], [300, 2800]], 12);
  const strokeMs = Date.now() - t0;
  check('brush works on a full page', near(await px(1200, 400), [200, 30, 30, 255], 12), await px(1200, 400));
  console.log('    full-page stroke took ' + strokeMs + ' ms (software rendering)');

  await tool('text');
  await click(400, 1200);
  await page.keyboard.type('Class of');
  await page.keyboard.press('Control+Enter');
  await settle();
  const t1 = await ev(() => ({ str: window.app.doc.al.text.str, size: window.app.doc.al.text.size }));
  check('text at 36 pt is 150 px on a 300 ppi page', t1.str === 'Class of' && t1.size === 150, t1);
  const tb = await ev(() => { const l = window.app.doc.al; return { x: l.x + l.w / 2, y: l.y + l.h / 2 }; });
  await click(tb.x, tb.y);
  check('clicking a text layer with the type tool edits it', (await ev(() => window.app.modal && window.app.modal.id)) === 'text', null);
  await page.keyboard.press('End');
  await page.keyboard.type(' 2027');
  await page.keyboard.press('Control+Enter');
  await settle();
  check('re-edited text is kept', (await ev(() => window.app.doc.al.text.str)) === 'Class of 2027', await ev(() => window.app.doc.al.text.str));

  await tool('move');
  const c0 = await ev(() => { const l = window.app.doc.al; return { x: l.x + l.w / 2, y: l.y + l.h / 2 }; });
  await drag([[c0.x, c0.y], [1275 + 9, 1650 + 7]], 10);
  const c1 = await ev(() => { const l = window.app.doc.al; return { x: l.x + l.w / 2, y: l.y + l.h / 2 }; });
  check('moving near the page centre snaps to it', Math.abs(c1.x - 1275) <= 3 && Math.abs(c1.y - 1650) <= 3, c1);

  await run('align', 'left');
  await settle();
  const left = await ev(() => { const l = window.app.doc.al; return l.text.x; });
  check('align left edges', left < 80, left);
  await run('marginGuides');
  await settle(300);
  await page.locator('.dialog .btn.primary').click();
  await settle();
  check('margin guides added', (await ev(() => window.app.doc.guides.length)) === 4, null);
  await shot('page');

  t0 = Date.now();
  await ev(() => { const d = window.app.doc; d.active = d.layers[1].id; window.app.api.emit('layers'); });
  await tool('wand');
  await click(1200, 1700);
  check('magic wand on a full page', !!(await ev(() => window.app.doc.sel)), null);
  console.log('    full-page magic wand took ' + (Date.now() - t0) + ' ms');
  await page.keyboard.press('Control+d');

  await ev(() => window.app.api.autosave());
  await settle(1500);
  await boot();
  await settle(600);
  check('recover dialog appears after reload', await page.locator('.dialog').count() === 1, null);
  await page.locator('.dialog .btn.primary').click();
  await settle(2500);
  const rec = await ev(() => window.app.doc && { w: window.app.doc.w, n: window.app.doc.layers.length, text: window.app.doc.layers.filter((l) => l.type === 'text').map((l) => l.text.str) });
  check('recovered document has its layers and text', rec && rec.w === 2550 && rec.n === 3 && rec.text[0] === 'Class of 2027', rec);
  check('recovered pixels', near(await px(1200, 400), [200, 30, 30, 255], 12), await px(1200, 400));
  await shot('recovered');

  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
