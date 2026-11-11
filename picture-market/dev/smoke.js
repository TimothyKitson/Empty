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
  const settle = () => page.waitForTimeout(120);
  const drag = async (pts, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    const a = await cli(pts[0][0], pts[0][1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      const p = await cli(pts[i][0], pts[i][1]);
      await page.mouse.move(p.x, p.y, { steps: 6 });
    }
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await settle();
  };
  const click = async (x, y, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    const a = await cli(x, y);
    await page.mouse.click(a.x, a.y);
    for (const m of mods) await page.keyboard.up(m);
    await settle();
  };
  const near = (a, b, tol = 6) => a && b.every((v, i) => Math.abs(a[i] - v) <= tol);
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });

  await ev(() => window.app.api.newDoc({ w: 800, h: 600, dpi: 72, bg: 'white', name: 'Smoke' }));
  await settle();
  check('white background', near(await px(100, 100), [255, 255, 255, 255]), await px(100, 100));

  await ev(() => { window.app.fg = { r: 255, g: 0, b: 0 }; window.app.api.emit('color'); });
  await run('newLayer');
  await tool('brush');
  await ev(() => { Object.assign(window.app.opts.brush, { size: 40, hardness: 100 }); });
  await drag([[100, 100], [400, 100]]);
  check('brush paints red', near(await px(250, 100), [255, 0, 0, 255]), await px(250, 100));
  check('brush leaves rest white', near(await px(250, 200), [255, 255, 255, 255]), await px(250, 200));
  await page.keyboard.press('Control+z');
  await settle();
  check('undo removes stroke', near(await px(250, 100), [255, 255, 255, 255]), await px(250, 100));
  await page.keyboard.press('Control+Shift+z');
  await settle();
  check('redo restores stroke', near(await px(250, 100), [255, 0, 0, 255]), await px(250, 100));

  await ev(() => { window.app.opts.brush.opacity = 50; });
  await drag([[100, 300], [400, 300], [100, 300]]);
  const half = await px(250, 300);
  check('50% opacity stroke does not build up', near(half, [255, 128, 128, 255], 8), half);
  await ev(() => { window.app.opts.brush.opacity = 100; });

  await tool('eraser');
  await ev(() => { Object.assign(window.app.opts.eraser, { size: 30, hardness: 100 }); });
  await drag([[250, 60], [250, 140]]);
  check('eraser clears layer pixels', near(await px(250, 100), [255, 255, 255, 255]), await px(250, 100));

  await tool('marquee');
  await drag([[500, 100], [700, 300]]);
  const sel = await ev(() => window.app.doc.sel && window.app.doc.sel.b);
  check('marquee makes selection', sel && Math.abs(sel.w - 200) < 3 && Math.abs(sel.h - 200) < 3, sel);
  await ev(() => { window.app.fg = { r: 0, g: 0, b: 255 }; });
  await page.keyboard.press('Alt+Backspace');
  await settle();
  check('fill inside selection', near(await px(600, 200), [0, 0, 255, 255]), await px(600, 200));
  check('fill stays inside selection', near(await px(450, 200), [255, 255, 255, 255]), await px(450, 200));
  await tool('brush');
  await ev(() => { window.app.fg = { r: 0, g: 255, b: 0 }; Object.assign(window.app.opts.brush, { size: 30, hardness: 100 }); });
  await drag([[450, 200], [750, 200]]);
  check('brush clipped by selection (inside)', near(await px(600, 200), [0, 255, 0, 255]), await px(600, 200));
  check('brush clipped by selection (outside)', near(await px(470, 200), [255, 255, 255, 255]), await px(470, 200));
  await page.keyboard.press('Control+d');
  await settle();
  check('deselect', (await ev(() => window.app.doc.sel)) === null, null);

  await tool('wand');
  await click(600, 150);
  const ws = await ev(() => window.app.doc.sel && window.app.doc.sel.b);
  check('magic wand selects blue area', ws && ws.w > 150 && ws.w <= 201, ws);
  await page.keyboard.press('Control+j');
  await settle();
  const names = await ev(() => window.app.doc.layers.map((l) => l.name));
  check('layer via copy', names.length === 3, names);

  await tool('move');
  await ev(() => { window.app.opts.move.auto = false; });
  await drag([[600, 150], [600, 450]]);
  check('move tool moves layer', near(await px(600, 400), [0, 0, 255, 255]), await px(600, 400));

  await page.keyboard.press('Control+Alt+t');
  await settle();
  check('free transform starts', (await ev(() => window.app.modal && window.app.modal.id)) === 'transform', null);
  await ev(() => { window.app.modal.setField(0, 50); window.app.modal.setField(1, 50); });
  await page.keyboard.press('Enter');
  await settle();
  const lw = await ev(() => window.app.doc.al.w);
  check('free transform scales layer', lw > 90 && lw < 110, lw);

  await tool('text');
  await click(120, 450);
  await page.keyboard.type('Class of 2027');
  await page.keyboard.press('Control+Enter');
  await settle();
  const tl = await ev(() => { const l = window.app.doc.al; return { type: l.type, name: l.name, w: l.w, h: l.h }; });
  check('type tool makes a text layer', tl.type === 'text' && tl.name === 'Class of 2027' && tl.w > 80, tl);

  await ev(() => { const d = window.app.doc; d.active = d.layers[0].id; window.app.api.emit('layers'); });
  await run('selAll');
  const before = await px(20, 20);
  await ev(() => window.app.api.run('lastFilter'));
  await ev(() => { window.__p = window.app.api.run; });
  await page.keyboard.press('Control+i');
  await page.waitForTimeout(400);
  check('invert adjustment', near(await px(20, 20), [0, 0, 0, 255]), [before, await px(20, 20)]);
  await page.keyboard.press('Control+z');
  await settle();
  await page.keyboard.press('Control+d');

  const hist = await ev(() => window.app.doc.hist.map((e) => e.name));
  console.log('history: ' + hist.join(' | '));
  await shot('smoke');

  const dl = page.waitForEvent('download', { timeout: 15000 });
  await run('quickPng');
  const d = await dl;
  const file = path.join(__dirname, 'shots', 'export.png');
  await d.saveAs(file);
  const bytes = require('fs').readFileSync(file);
  check('png export has pHYs', bytes.includes(Buffer.from('pHYs')) && bytes.length > 1000, bytes.length);

  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
