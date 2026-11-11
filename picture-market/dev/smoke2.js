const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { serve } = require('./serve');

(async () => {
  const target = process.argv[2] || 'site/index.html';
  const srv = await serve(path.resolve(__dirname, '..'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
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
  const settle = (ms = 150) => page.waitForTimeout(ms);
  const fg = (r, g, b) => ev(([r, g, b]) => { window.app.fg = { r, g, b }; window.app.api.emit('color'); }, [r, g, b]);
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
  const near = (a, b, tol = 8) => a && b.every((v, i) => Math.abs(a[i] - v) <= tol);
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });
  const menu = async (labels) => {
    await page.locator('.mtitle', { hasText: new RegExp('^' + labels[0] + '$') }).click();
    for (let i = 1; i < labels.length; i++) {
      const it = page.locator('.menu .item .lbl', { hasText: new RegExp('^' + labels[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).last();
      if (i < labels.length - 1) await it.hover();
      else await it.click();
      await settle(80);
    }
  };
  const ok = async () => { await page.locator('.dialog .btn.primary').click(); await settle(500); };
  const layers = () => ev(() => window.app.doc.layers.map((l) => ({ name: l.name, type: l.type, x: l.x, y: l.y, w: l.w, h: l.h, clip: l.clip, mask: !!l.mask, fx: !!l.fx })));

  await ev(() => window.app.api.newDoc({ w: 600, h: 400, dpi: 72, bg: 'white', name: 'Two' }));
  await settle();
  await fg(255, 0, 0);
  await tool('rect');
  await drag([[100, 100], [300, 300]]);
  check('rectangle shape layer', near(await px(200, 200), [255, 0, 0, 255]) && (await layers()).length === 2, await layers());

  await menu(['Filter', 'Blur', 'Gaussian Blur…']);
  await settle(300);
  check('filter dialog opens', await page.locator('.dialog').count() === 1, null);
  await ok();
  const edge = await px(100, 200);
  check('gaussian blur softens edge', edge[3] === 255 && edge[1] > 60 && edge[1] < 200, edge);

  await page.keyboard.press('Control+u');
  await settle(300);
  await ev(() => { const s = document.querySelector('.dialog .slider'); s.value = 120; s.dispatchEvent(new Event('input')); });
  await settle(300);
  await ok();
  const hue = await px(200, 200);
  check('hue/saturation shifts red to green', hue[1] > 200 && hue[0] < 60, hue);

  await menu(['Layer', 'New Adjustment Layer', 'Invert']);
  await settle(300);
  const inv = await px(200, 200);
  check('invert adjustment layer', inv[0] > 200 && inv[1] < 60 && inv[2] > 200, inv);
  check('adjustment layer inverts background', near(await px(500, 50), [0, 0, 0, 255]), await px(500, 50));
  await run('clipToggle');
  await settle();
  check('clipped adjustment only affects base', near(await px(500, 50), [255, 255, 255, 255]), await px(500, 50));
  check('clipped adjustment still inverts shape', (await px(200, 200))[0] > 200, await px(200, 200));
  await run('delLayer');
  await settle();

  await run('layerStyle');
  await settle(300);
  await ev(() => { const c = document.querySelectorAll('.dialog input[type=checkbox]')[0]; c.click(); });
  await settle(300);
  await ok();
  const st = await px(96, 200);
  check('layer style stroke draws outside the shape', st[0] < 60 && st[1] < 60 && st[2] < 60, st);
  check('layer has fx', (await layers())[1].fx === true, null);

  await run('addMask');
  await settle();
  await fg(0, 0, 0);
  await tool('brush');
  await ev(() => Object.assign(window.app.opts.brush, { size: 60, hardness: 100, opacity: 100 }));
  await drag([[200, 150], [200, 250]]);
  check('painting black on the mask hides the layer', near(await px(200, 200), [255, 255, 255, 255]), await px(200, 200));
  await fg(255, 255, 255);
  await drag([[200, 150], [200, 250]]);
  check('painting white on the mask reveals it', (await px(200, 200))[1] > 200, await px(200, 200));
  await run('applyMask');
  await settle();

  await ev(() => { const d = window.app.doc; d.active = d.layers[0].id; d.target = 'layer'; window.app.api.emit('layers'); });
  await fg(0, 0, 255);
  await ev(() => { window.app.bg = { r: 255, g: 255, b: 0 }; });
  await tool('gradient');
  await drag([[400, 50], [580, 50]]);
  const g1 = await px(410, 350);
  const g2 = await px(570, 350);
  check('gradient runs foreground to background', g1[2] > 200 && g2[0] > 200 && g2[1] > 200, [g1, g2]);
  await page.keyboard.press('Control+z');
  await settle();

  await fg(0, 160, 0);
  await tool('bucket');
  await click(500, 350);
  check('paint bucket fills the background', near(await px(550, 380), [0, 160, 0, 255]), await px(550, 380));

  await tool('lasso');
  await drag([[420, 20], [560, 20], [560, 120], [420, 120], [420, 20]]);
  const ls = await ev(() => window.app.doc.sel && window.app.doc.sel.b);
  check('lasso selection', ls && ls.w > 120 && ls.h > 80, ls);
  await run('inverse');
  await run('feather');
  await settle(300);
  await ok();
  check('feather keeps a selection', !!(await ev(() => window.app.doc.sel)), null);
  await page.keyboard.press('Control+d');

  await tool('polylasso');
  await click(430, 250);
  await click(560, 250);
  await click(560, 330);
  await page.keyboard.press('Enter');
  await settle();
  check('polygonal lasso selection', !!(await ev(() => window.app.doc.sel)), null);
  await run('expand');
  await settle(300);
  await ok();
  await run('contract');
  await settle(300);
  await ok();
  check('expand and contract keep a selection', !!(await ev(() => window.app.doc.sel)), null);
  await page.keyboard.press('Control+d');
  await settle();

  await tool('stamp');
  await ev(() => Object.assign(window.app.opts.stamp, { size: 40, hardness: 100 }));
  await click(50, 50, ['Alt']);
  await drag([[500, 200], [540, 200]]);
  check('clone stamp runs', (await ev(() => window.app.doc.hist[window.app.doc.hi].name)) === 'Clone Stamp Tool', null);
  await tool('heal');
  await drag([[450, 300], [470, 300]]);
  check('spot healing runs', (await ev(() => window.app.doc.hist[window.app.doc.hi].name)) === 'Spot Healing Brush Tool', null);

  await run('canvasCw');
  await settle(300);
  let d = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h }));
  check('rotate canvas 90', d.w === 400 && d.h === 600, d);
  await run('canvasCcw');
  await settle(300);
  d = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h }));
  check('rotate canvas back', d.w === 600 && d.h === 400 && (await px(200, 200))[1] > 150, [d, await px(200, 200)]);

  await run('imageSize');
  await settle(300);
  await ev(() => { const t = document.querySelectorAll('.dialog input.txt')[0]; t.value = '300'; t.dispatchEvent(new Event('input')); });
  await ok();
  d = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h }));
  check('image size resamples', d.w === 300 && d.h === 200, d);
  await page.keyboard.press('Control+z');
  await settle(300);

  await tool('crop');
  await drag([[50, 50], [450, 350]]);
  await page.keyboard.press('Enter');
  await settle(300);
  d = await ev(() => ({ w: window.app.doc.w, h: window.app.doc.h }));
  check('crop tool', Math.abs(d.w - 400) < 3 && Math.abs(d.h - 300) < 3, d);
  await page.keyboard.press('Control+z');
  await settle(300);

  await tool('text');
  await click(60, 340);
  await page.keyboard.type('Go Team');
  await page.keyboard.press('Control+Enter');
  await settle();
  const before = await layers();
  const dl = async (cmd, file) => {
    const p = page.waitForEvent('download', { timeout: 20000 });
    await run(cmd);
    const x = await p;
    const f = path.join(__dirname, 'shots', file);
    await x.saveAs(f);
    await settle(400);
    return f;
  };
  const open = async (file) => {
    const p = page.waitForEvent('filechooser', { timeout: 10000 });
    await run('open');
    const ch = await p;
    await ch.setFiles(file);
    await settle(1500);
  };
  const proj = await dl('save', 'two.picproj');
  await open(proj);
  const after = await layers();
  check('project round trip keeps layers', after.length === before.length && after.map((l) => l.type).join() === before.map((l) => l.type).join(), [before.length, after.length]);
  check('project round trip keeps pixels', (await px(200, 200))[1] > 150, await px(200, 200));
  check('two documents open', (await ev(() => window.app.docs.length)) === 2, null);

  const pdf = await dl('exportPdf', 'two.pdf');
  const pb = fs.readFileSync(pdf);
  check('pdf export', pb.slice(0, 5).toString() === '%PDF-' && pb.includes(Buffer.from('/DCTDecode')) && pb.slice(-6).toString().includes('EOF'), pb.length);
  const jpg = await dl('quickJpg', 'two.jpg');
  const jb = fs.readFileSync(jpg);
  check('jpeg export carries dpi', jb[13] === 1 && jb[15] === 72, [jb[13], jb[14], jb[15]]);
  const psd = await dl('exportPsd', 'two.psd');
  check('psd export', fs.readFileSync(psd).slice(0, 4).toString() === '8BPS', null);
  await open(psd);
  const pl = await layers();
  check('psd import brings layers back', pl.length === before.length && (await ev(() => window.app.docs.length)) === 3, pl.map((l) => l.name));
  check('psd import pixels', (await px(200, 200))[1] > 150, await px(200, 200));
  check('psd layer order (background first)', pl[0].w === 600 && pl[0].h === 400, pl[0]);

  await run('mergeDown');
  await settle();
  await run('flatten');
  await settle();
  check('flatten leaves one layer', (await layers()).length === 1, null);
  await run('selAll');
  await run('copy');
  await settle(200);
  await run('paste');
  await settle();
  check('copy and paste make a layer', (await layers()).length === 2, null);
  await shot('smoke2');

  await page.setViewportSize({ width: 390, height: 780 });
  await settle(500);
  await shot('phone');
  const scroll = await ev(() => ({ w: document.documentElement.scrollWidth, iw: innerWidth }));
  check('no horizontal overflow at phone width', scroll.w <= scroll.iw, scroll);

  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
