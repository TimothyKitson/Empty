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
  const settle = (ms = 150) => page.waitForTimeout(ms);
  const fg = (r, g, b) => ev(([r, g, b]) => { window.app.fg = { r, g, b }; window.app.api.emit('color'); }, [r, g, b]);
  const opt = (id, o) => ev(([id, o]) => { Object.assign(window.app.opts[id], o); window.app.api.emit('opts'); }, [id, o]);
  const drag = async (pts) => {
    const a = await cli(pts[0][0], pts[0][1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (let i = 1; i < pts.length; i++) {
      const p = await cli(pts[i][0], pts[i][1]);
      await page.mouse.move(p.x, p.y, { steps: 6 });
    }
    await page.mouse.up();
    await settle();
  };
  const click = async (x, y, mods = [], wait = 150) => {
    for (const m of mods) await page.keyboard.down(m);
    const a = await cli(x, y);
    await page.mouse.click(a.x, a.y);
    for (const m of mods) await page.keyboard.up(m);
    await settle(wait);
  };
  const key = async (k) => { await page.keyboard.press(k); await settle(); };
  const near = (a, b, tol = 6) => a && b.every((v, i) => Math.abs(a[i] - v) <= tol);
  const check = (name, ok, info) => { if (!ok) fails.push(name + ' ' + JSON.stringify(info)); else console.log('ok  ' + name); };
  const shot = (n) => page.screenshot({ path: path.join(__dirname, 'shots', n + '.png') });
  const hist = () => ev(() => window.app.doc.hist.slice(0, window.app.doc.hi + 1).map((e) => e.name));
  const bounds = () => ev(() => (window.app.doc.sel ? window.app.doc.sel.b : null));
  const box = async () => (await bounds()) || { x: -1, y: -1, w: 0, h: 0 };
  const stats = () => ev(() => window.app.tool.stats);
  const decon = () => ev(() => {
    const k = window.app.doc.sel && window.app.doc.sel.decon;
    return k ? { n: k.idx.length, layer: k.layer, all: k.all } : null;
  });
  const lastHist = async () => (await hist()).slice(-1)[0];
  const remains = () => ev(() => {
    const d = window.app.doc;
    const l = d.al;
    const a = l.canvas.getContext('2d').getImageData(-l.x, -l.y, d.w, d.h).data;
    let soft = 0, worst = 0;
    for (let p = 0; p < a.length; p += 4) {
      const k = a[p + 3] / 255;
      if (k > 0 && k < 1) soft++;
      worst = Math.max(worst, Math.abs(a[p] - 180) * k, Math.abs(a[p + 1] - 197) * k, Math.abs(a[p + 2] - 140) * k);
    }
    return { soft, worst };
  });

  const SAGE = [180, 197, 140];
  const WHITE = [255, 255, 255];
  const MAGENTA = [255, 0, 255];
  const DISC = { x: 150.4, y: 140.7, r: 80.3 };

  const discScene = async () => {
    await ev((D) => {
      const api = window.app.api;
      api.newDoc({ w: 400, h: 300, dpi: 72, bg: 'white', name: 'Disc' });
      const d = window.app.doc;
      const g = d.layers[0].canvas.getContext('2d');
      g.fillStyle = '#b4c58c';
      g.fillRect(0, 0, d.w, d.h);
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(D.x, D.y, D.r, 0, Math.PI * 2);
      g.fill();
      const m = document.createElement('canvas');
      m.width = d.w;
      m.height = d.h;
      const mg = m.getContext('2d');
      mg.fillStyle = '#ff00ff';
      mg.fillRect(0, 0, d.w, d.h);
      d.layers.unshift(new api.Layer({ name: 'Magenta', canvas: m }));
      d.layers[1].ver++;
      d.touch('all');
      api.emit('layers');
    }, DISC);
    await settle(200);
  };
  const paintScene = async (w, h, name, draw, bg = 'white') => {
    await ev(([w, h, name, draw, bg]) => {
      const api = window.app.api;
      api.newDoc({ w, h, dpi: 72, bg, name });
      const d = window.app.doc;
      if (d.layers[0].canvas.width !== w) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        Object.assign(d.layers[0], { canvas: c, x: 0, y: 0 });
      }
      const g = d.layers[0].canvas.getContext('2d');
      new Function('g', 'd', draw)(g, d);
      d.layers[0].ver++;
      d.touch('all');
      api.emit('layers');
    }, [w, h, name, draw, bg]);
    await settle(200);
  };
  const selStats = () => ev(() => {
    const d = window.app.doc;
    if (!d.sel) return null;
    const a = d.sel.c.getContext('2d').getImageData(0, 0, d.w, d.h).data;
    let sum = 0, part = 0, half = 0, full = 0;
    for (let p = 3; p < a.length; p += 4) {
      const v = a[p];
      sum += v;
      if (v > 0 && v < 255) part++;
      if (v > 127) half++;
      if (v === 255) full++;
    }
    return { area: sum / 255, part, half, full, b: d.sel.b, w: d.sel.c.width, h: d.sel.c.height };
  });
  const selAt = (x, y) => ev(([x, y]) => {
    const d = window.app.doc;
    return d.sel ? d.sel.c.getContext('2d').getImageData(x, y, 1, 1).data[3] : 0;
  }, [x, y]);
  const band = (basis, width = 3) => ev(([D, basis, width]) => {
    const d = window.app.doc;
    const img = window.app.api.flatten(d).getContext('2d').getImageData(0, 0, d.w, d.h).data;
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const A = [0, 1, 2].map((i) => basis.map((c) => c[i]));
    const dA = det(A);
    const res = { n: 0, first: 0, sum: [9, -9], luma: 0, mid: 0, at: null };
    for (let y = 0; y < d.h; y++) {
      for (let x = 0; x < d.w; x++) {
        if (Math.abs(Math.hypot(x + 0.5 - D.x, y + 0.5 - D.y) - D.r) > width) continue;
        const o = (y * d.w + x) * 4;
        const p = [img[o], img[o + 1], img[o + 2]];
        const k = [0, 1, 2].map((j) => det(A.map((row, i) => row.map((v, c) => (c === j ? p[i] : v)))) / dA);
        res.n++;
        if (k[0] > res.first) {
          res.first = k[0];
          res.at = [x, y, p];
        }
        res.sum[0] = Math.min(res.sum[0], k[1] + k[2]);
        res.sum[1] = Math.max(res.sum[1], k[1] + k[2]);
        if (k[1] > 0.2 && k[1] < 0.8) res.mid++;
        res.luma = Math.max(res.luma, 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]);
      }
    }
    return res;
  }, [DISC, basis, width]);
  const ink = (x0 = 0, x1 = 1e9) => ev(([x0, x1]) => {
    const d = window.app.doc;
    const l = d.al;
    const a = l.canvas.getContext('2d').getImageData(-l.x, -l.y, d.w, d.h).data;
    let sum = 0;
    for (let y = 0; y < d.h; y++) for (let x = Math.max(0, x0); x < Math.min(d.w, x1); x++) sum += (a[(y * d.w + x) * 4 + 2] - 140) / 115;
    return sum;
  }, [x0, x1]);
  const pageLuma = 0.299 * SAGE[0] + 0.587 * SAGE[1] + 0.114 * SAGE[2];

  await discScene();
  await tool('wand');
  const bar = await page.locator('.opt').allTextContents();
  check('wand options show Sample Size and Anti-alias', bar.some((t) => t.includes('Sample Size')) && bar.some((t) => t.includes('Anti-alias')), bar);
  await click(150, 140);
  const on = await selStats();
  const trueArea = Math.PI * DISC.r * DISC.r;
  const drawn = await ink();
  const rArea = Math.sqrt(on.area / Math.PI);
  const rHalf = Math.sqrt(on.half / Math.PI);
  console.log('    disc radius ' + DISC.r + ': from coverage ' + rArea.toFixed(3) + ', from the 50% contour ' + rHalf.toFixed(3) + '; selected ' + on.area.toFixed(2) + ' px, white actually drawn ' + drawn.toFixed(2) + ' px, ideal circle ' + trueArea.toFixed(2) + ' px');
  check('anti-alias gives partial coverage along the edge', on.part > 300, on);
  check('selected area equals the white that is in the picture', Math.abs(on.area - drawn) < 0.5, { area: on.area, drawn });
  check('selected area matches the true disc', Math.abs(rArea - DISC.r) < 0.15, { rArea, area: on.area, trueArea });
  check('50% contour within half a pixel of the true radius', Math.abs(rHalf - DISC.r) < 0.5, rHalf);
  check('selection is clipped to the document', on.w === 400 && on.h === 300 && on.b.x >= 0 && on.b.y >= 0 && on.b.x + on.b.w <= 400, on);
  check('one undo state named Magic Wand', (await hist()).join('|') === 'Magic Wand', await hist());
  await shot('wand-disc');
  await opt('wand', { aa: false });
  await click(150, 140);
  const off = await selStats();
  check('anti-alias off gives only 0 and 255', off.part === 0 && off.full > 19000, off);
  check('anti-alias never selects less than the hard wand at 50%', on.half >= off.full, [on.half, off.full]);
  await opt('wand', { aa: true });
  await key('Control+z');
  await key('Control+z');
  check('undo clears the selection', (await bounds()) === null, await bounds());
  await key('Control+Shift+z');
  const redo = await selStats();
  check('redo restores the selection', redo && redo.part === on.part && Math.abs(redo.area - on.area) < 0.01, redo);

  await click(150, 140);
  await key('Delete');
  const del = await band([WHITE, SAGE, MAGENTA]);
  console.log('    wand + Delete: most white left in an edge pixel ' + (del.first * 100).toFixed(1) + '%, lightest edge pixel luma ' + del.luma.toFixed(1) + ' (page ' + pageLuma.toFixed(1) + ')');
  check('wand + Delete leaves no ring of the old colour', del.first < 0.04, del);
  check('wand + Delete leaves no pixel lighter than the page', del.luma <= pageLuma + 1, del.luma);
  check('wand + Delete edge is a clean green to magenta blend', del.sum[0] > 0.95 && del.sum[1] < 1.05 && del.mid > 150, del);
  check('wand + Delete clears the inside', near(await px(150, 140), [255, 0, 255, 255], 1), await px(150, 140));
  check('wand + Delete is one undo state', (await hist()).slice(-1)[0] === 'Clear', await hist());
  await shot('wand-delete');
  await key('Control+z');
  check('undo restores the deleted pixels', near(await px(150, 140), [255, 255, 255, 255], 1), await px(150, 140));
  await key('Control+Shift+z');
  check('redo deletes again', near(await px(150, 140), [255, 0, 255, 255], 1), await px(150, 140));
  await key('Control+z');
  await run('clear');
  await settle();
  const menu = await band([WHITE, SAGE, MAGENTA]);
  console.log('    Edit > Clear on the same selection: most white left ' + (menu.first * 100).toFixed(1) + '%');
  check('Edit > Clear with a wand selection is as clean as the Delete key', menu.first < 0.04 && menu.luma <= pageLuma + 1 && (await hist()).slice(-1)[0] === 'Clear', menu);

  await discScene();
  await click(150, 140);
  await fg(255, 0, 255);
  await key('Alt+Backspace');
  const fill = await band([WHITE, SAGE, MAGENTA]);
  console.log('    wand + fill: most white left in an edge pixel ' + (fill.first * 100).toFixed(1) + '%');
  check('wand + fill leaves no whitish pixels', fill.first < 0.04 && fill.luma <= pageLuma + 1, fill);
  check('wand + fill blends smoothly from magenta to green', fill.sum[0] > 0.95 && fill.sum[1] < 1.05 && fill.mid > 150, fill);
  check('wand + fill fills the inside', near(await px(150, 140), [255, 0, 255, 255], 1), await px(150, 140));
  check('wand + fill is one undo state', (await hist()).slice(-1)[0] === 'Fill', await hist());
  await key('Control+z');
  await key('Delete');
  const again = await band([WHITE, SAGE, MAGENTA]);
  check('undo then Delete on the same selection is just as clean', again.first < 0.04 && near(await px(150, 140), [255, 0, 255, 255], 1), again);
  await key('Control+z');
  await tool('brush');
  await fg(0, 0, 0);
  await opt('brush', { size: 12, hardness: 100, opacity: 100 });
  await drag([[60, 140], [100, 140]]);
  await tool('wand');
  await key('Delete');
  const edited = await band([WHITE, SAGE, MAGENTA]);
  check('Delete after the pixels changed still clears the selection', near(await px(150, 140), [255, 0, 255, 255], 1) && edited.luma <= pageLuma + 1 && (await hist()).slice(-1)[0] === 'Clear', [edited, await hist()]);
  await fg(255, 0, 255);

  await discScene();
  await click(10, 10);
  const outer = await selStats();
  check('clicking the page selects everything but the disc', Math.abs(outer.area - (400 * 300 - drawn)) < 0.5, [outer.area, 400 * 300 - drawn]);
  await key('Delete');
  const green = await band([SAGE, WHITE, MAGENTA]);
  console.log('    click the green + Delete: most green left in an edge pixel ' + (green.first * 100).toFixed(1) + '%');
  check('deleting the page colour grabs every bit of green', green.first < 0.04, green);
  check('deleting the page colour keeps the disc edge anti-aliased', green.sum[0] > 0.95 && green.sum[1] < 1.05 && green.mid > 150, green);
  check('deleting the page colour keeps the disc', near(await px(150, 140), [255, 255, 255, 255], 1) && near(await px(10, 10), [255, 0, 255, 255], 1), [await px(150, 140), await px(10, 10)]);
  await shot('wand-green');

  await discScene();
  await opt('wand', { all: true });
  await click(150, 140);
  check('Sample All Layers with two visible layers stores no estimates', (await decon()) === null && (await bounds()) !== null, await decon());
  await key('Delete');
  const mixed = await remains();
  check('Delete then falls back to plain coverage', mixed.soft > 300 && mixed.worst > 10, mixed);
  await key('Control+z');
  await ev(() => { const d = window.app.doc; d.layers[0].visible = false; d.touch('all'); window.app.api.emit('layers'); });
  await click(150, 140);
  const solo = await decon();
  check('Sample All Layers with one visible layer stores estimates', solo && solo.all === true && solo.n > 300, solo);
  await ev(() => { const d = window.app.doc; d.layers[0].visible = true; d.touch('all'); window.app.api.emit('layers'); });
  await key('Delete');
  const shown = await remains();
  check('all-layer estimates are ignored once a second layer is visible', shown.soft > 300 && shown.worst > 10, shown);
  await key('Control+z');
  await ev(() => { const d = window.app.doc; d.layers[0].visible = false; d.touch('all'); window.app.api.emit('layers'); });
  await key('Delete');
  const alone = await remains();
  check('all-layer estimates are used while the layer is the only one visible', alone.soft > 300 && alone.worst < 2.5, alone);
  await opt('wand', { all: false });

  await discScene();
  await tool('bucket');
  const bbar = await page.locator('.opt').allTextContents();
  check('paint bucket has an Anti-alias option', bbar.some((t) => t.includes('Anti-alias')), bbar);
  await fg(255, 0, 255);
  await click(150, 140);
  const bucket = await band([WHITE, SAGE, MAGENTA]);
  console.log('    paint bucket: most white left in an edge pixel ' + (bucket.first * 100).toFixed(1) + '%');
  check('paint bucket meets the anti-aliased edge', bucket.first < 0.04 && bucket.sum[0] > 0.95 && bucket.sum[1] < 1.05 && bucket.mid > 150, bucket);
  check('paint bucket fills the inside', near(await px(150, 140), [255, 0, 255, 255], 1), await px(150, 140));
  check('paint bucket leaves the page alone', near(await px(300, 250), [180, 197, 140, 255], 1), await px(300, 250));
  check('paint bucket is one undo state', (await hist()).join('|') === 'Paint Bucket', await hist());
  await key('Control+z');
  check('undo restores the bucket fill', near(await px(150, 140), [255, 255, 255, 255], 1), await px(150, 140));
  await key('Control+Shift+z');
  check('redo restores the bucket fill', near(await px(150, 140), [255, 0, 255, 255], 1), await px(150, 140));
  await key('Control+z');
  await opt('bucket', { opacity: 50 });
  await click(150, 140);
  check('paint bucket opacity', near(await px(150, 140), [255, 128, 255, 255], 2), await px(150, 140));
  await key('Control+z');
  await opt('bucket', { opacity: 100, aa: false });
  await click(150, 140);
  const hardFill = await band([WHITE, SAGE, MAGENTA]);
  check('paint bucket without anti-alias keeps the hard edge', hardFill.first > 0.5, hardFill.first);
  await key('Control+z');
  await opt('bucket', { aa: true, all: true });
  await click(150, 140);
  const allFill = await band([WHITE, SAGE, MAGENTA]);
  check('paint bucket on all layers lays colour down by coverage', near(await px(150, 140), [255, 0, 255, 255], 1) && allFill.first < 0.3 && allFill.luma <= pageLuma + 1, allFill);
  await opt('bucket', { all: false });

  await paintScene(300, 100, 'Steps', "g.fillStyle='rgb(100,100,100)';g.fillRect(0,0,100,100);g.fillStyle='rgb(132,132,132)';g.fillRect(100,0,100,100);g.fillStyle='rgb(133,133,133)';g.fillRect(200,0,100,100);");
  await tool('wand');
  await click(50, 50);
  const edge = [await selAt(150, 50), await selAt(199, 50), await selAt(200, 50), await selAt(250, 50)];
  check('tolerance 32 includes a patch 32 levels away', edge[0] === 255 && edge[1] === 255, edge);
  check('tolerance 32 excludes a patch 33 levels away', edge[2] === 0 && edge[3] === 0 && (await box()).w === 200, [edge, await bounds()]);
  await opt('wand', { tolerance: 33 });
  await click(50, 50);
  check('tolerance 33 reaches the next patch', (await box()).w === 300, await bounds());
  await opt('wand', { tolerance: 0 });
  await click(50, 50);
  check('tolerance 0 selects the exact colour only', (await box()).w === 100, await bounds());
  await opt('wand', { tolerance: 32 });

  await paintScene(400, 200, 'Two', "g.fillStyle='#b4c58c';g.fillRect(0,0,400,200);g.fillStyle='#fff';g.beginPath();g.arc(100.3,100.6,60.4,0,7);g.fill();g.beginPath();g.arc(300.7,100.2,60.4,0,7);g.fill();");
  const inkA = await ink(0, 200);
  const inkB = await ink(200, 400);
  await click(100, 100);
  check('contiguous selects one disc', (await selAt(100, 100)) === 255 && (await selAt(300, 100)) === 0 && (await box()).w < 125, await bounds());
  await opt('wand', { contiguous: false });
  await click(100, 100);
  check('not contiguous selects both discs', (await selAt(100, 100)) === 255 && (await selAt(300, 100)) === 255 && (await selAt(200, 100)) === 0, await bounds());
  const both = await selStats();
  check('not contiguous keeps the anti-aliased edges', Math.abs(both.area - inkA - inkB) < 0.5 && both.part > 400, [both, inkA, inkB]);
  await opt('wand', { contiguous: true });

  await click(100, 100);
  await click(300, 100, ['Shift']);
  const added = await selStats();
  check('Shift adds to the selection', (await selAt(100, 100)) === 255 && (await selAt(300, 100)) === 255 && Math.abs(added.area - both.area) < 0.5 && added.b.w > 320, added);
  await click(100, 100, ['Alt']);
  const sub = await selStats();
  check('Alt subtracts from the selection', (await selAt(100, 100)) === 0 && (await selAt(300, 100)) === 255 && Math.abs(sub.area - inkB) < 0.5 && sub.b.x > 230 && sub.b.w < 125, [sub, inkB]);
  await key('Control+a');
  await click(100, 100, ['Shift', 'Alt']);
  const inter = await selStats();
  check('Shift+Alt intersects with the selection', (await selAt(100, 100)) === 255 && (await selAt(300, 100)) === 0 && (await selAt(10, 10)) === 0 && Math.abs(inter.area - inkA) < 0.5 && inter.b.w < 125, [inter, inkA]);
  await click(300, 100, ['Shift', 'Alt']);
  check('intersecting with a separate area empties the selection', (await bounds()) === null, await bounds());
  await click(100, 100);
  await page.locator('.opt select').first().selectOption('add');
  await settle();
  await click(300, 100);
  check('Mode menu: add to selection', (await selAt(100, 100)) === 255 && (await selAt(300, 100)) === 255, await bounds());
  await page.locator('.opt select').first().selectOption('sub');
  await settle();
  await click(300, 100);
  check('Mode menu: subtract from selection', (await selAt(100, 100)) === 255 && (await selAt(300, 100)) === 0, await bounds());
  await page.locator('.opt select').first().selectOption('new');
  await settle();
  const before = (await hist()).length;
  const stage = await ev(() => { const r = window.app.api.view.stage.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; });
  const outside = [await cli(200, 203), await cli(200, -3)];
  check('outside test points are on the canvas area', outside.every((p) => p.x > stage[0] + 2 && p.x < stage[2] - 2 && p.y > stage[1] + 2 && p.y < stage[3] - 2), [outside, stage]);
  await click(200, 203);
  await click(200, -3);
  check('clicks outside the document do nothing', (await hist()).length === before && (await ev(() => window.app.tool.id)) === 'wand', [(await hist()).length, before]);
  await click(100, 100);
  const one = await decon();
  await click(300, 100, ['Shift']);
  const joined = await decon();
  check('Shift-click with the wand joins the estimates of both discs', one && joined && joined.n > one.n * 1.8 && joined.n < one.n * 2.2, [one, joined]);
  await key('Delete');
  const lay = await remains();
  check('Delete after Shift-clicking two discs leaves only page colour on both edges', lay.soft > 400 && lay.worst < 2.5 && (await px(100, 100))[3] === 0 && (await px(300, 100))[3] === 0, lay);
  await key('Control+z');
  await click(100, 100);
  await click(10, 10, ['Shift']);
  const seam = await ev(() => {
    const d = window.app.doc;
    const a = d.sel.c.getContext('2d').getImageData(0, 0, 200, 200).data;
    let low = 255;
    for (let p = 3; p < a.length; p += 4) low = Math.min(low, a[p]);
    return low;
  });
  check('Shift-clicking the disc and then the page leaves no seam between them', seam === 255 && (await selAt(300, 100)) === 0, seam);
  await click(100, 100, ['Alt']);
  const noDisc = await selStats();
  check('Alt-clicking the disc again takes exactly the disc back out', Math.abs(noDisc.area - (400 * 200 - inkA - inkB)) < 0.5, [noDisc.area, 400 * 200 - inkA - inkB]);

  await paintScene(400, 200, 'Layers', "g.fillStyle='#fff';g.fillRect(0,0,400,200);");
  await ev(() => {
    const api = window.app.api;
    const d = window.app.doc;
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 200;
    const g = c.getContext('2d');
    g.fillStyle = '#d02020';
    g.fillRect(200, 50, 100, 100);
    d.layers.push(new api.Layer({ name: 'Top', canvas: c }));
    api.emit('layers');
    d.touch('all');
  });
  await settle();
  await click(250, 100);
  check('sample all layers off reads the active layer only', (await box()).w === 400 && (await box()).h === 200, await bounds());
  await opt('wand', { all: true });
  await click(250, 100);
  const red = await box();
  check('sample all layers on sees the layer above', red.x === 200 && red.y === 50 && red.w === 100 && red.h === 100, red);
  await ev(() => { const d = window.app.doc; d.layers[1].visible = false; d.touch('all'); window.app.api.emit('layers'); });
  await click(250, 100);
  check('sample all layers follows layer visibility', (await box()).w === 400, await bounds());
  await opt('wand', { all: false });

  await paintScene(240, 60, 'Sample', "g.fillStyle='rgb(200,200,200)';g.fillRect(0,0,60,60);g.fillStyle='rgb(111,111,111)';g.fillRect(60,0,60,60);g.fillStyle='rgb(66,66,66)';g.fillRect(120,0,60,60);g.fillStyle='rgb(140,140,140)';g.fillRect(180,0,60,60);g.fillStyle='rgb(160,160,160)';g.fillRect(25,25,11,11);g.fillStyle='rgb(40,40,40)';g.fillRect(28,28,5,5);g.fillStyle='rgb(100,100,100)';g.fillRect(29,29,3,3);g.fillStyle='rgb(200,200,200)';g.fillRect(30,30,1,1);");
  await opt('wand', { contiguous: false, tolerance: 2 });
  const sizes = [['1', 0], ['3', 1], ['5', 2], ['11', 3]];
  for (const [size, patch] of sizes) {
    await page.locator('.opt select').nth(1).selectOption(size);
    await settle();
    await click(30.5, 30.5);
    const hit = [await selAt(10, 10), await selAt(90, 10), await selAt(150, 10), await selAt(210, 10)];
    check('sample size ' + size + ' averages the right window', hit.every((v, i) => (i === patch ? v === 255 : v === 0)), hit);
  }
  await page.locator('.opt select').nth(1).selectOption('1');
  await opt('wand', { contiguous: true, tolerance: 32, sample: '11' });
  await click(1, 1);
  check('sample window is clipped to the document', (await selAt(10, 10)) === 255 && (await selAt(90, 10)) === 0, await bounds());
  await opt('wand', { sample: '1' });

  await paintScene(300, 200, 'Clear', "g.fillStyle='#fff';g.beginPath();g.arc(150.4,100.7,60.3,0,7);g.fill();", 'transparent');
  await click(5, 5);
  const clear = await selStats();
  check('transparent pixels select together with a soft edge', Math.abs(Math.sqrt((300 * 200 - clear.area) / Math.PI) - 60.3) < 0.15 && clear.part > 250, clear);
  await click(150, 100);
  const solid = await selStats();
  check('opaque artwork on a transparent layer selects to its true edge', Math.abs(solid.area + clear.area - 300 * 200) < 0.5 && solid.part > 250, solid);


  const EX = { w: 460, h: 240, x: 120.37, y: 120.61, r: 70.3 };
  const exactScene = async (alpha) => {
    await ev(([E, alpha]) => {
      const api = window.app.api;
      api.newDoc({ w: E.w, h: E.h, dpi: 72, bg: alpha ? 'transparent' : 'white', name: 'Exact' });
      const d = window.app.doc;
      const l = d.layers[0];
      if (l.canvas.width !== E.w || l.canvas.height !== E.h) {
        const c = document.createElement('canvas');
        c.width = E.w;
        c.height = E.h;
        Object.assign(l, { canvas: c, x: 0, y: 0 });
      }
      const truth = new Float32Array(E.w * E.h);
      const img = new ImageData(E.w, E.h);
      const q = img.data;
      for (let y = 0, i = 0; y < E.h; y++) {
        for (let x = 0; x < E.w; x++, i++) {
          const far = Math.hypot(x + 0.5 - E.x, y + 0.5 - E.y) - E.r;
          let a = far < -1 ? 1 : 0;
          if (Math.abs(far) <= 1) {
            let n = 0;
            for (let sy = 0; sy < 16; sy++) for (let sx = 0; sx < 16; sx++) if (Math.hypot(x + (sx + 0.5) / 16 - E.x, y + (sy + 0.5) / 16 - E.y) < E.r) n++;
            a = n / 256;
          }
          truth[i] = a;
          if (alpha) {
            q[i * 4] = q[i * 4 + 1] = q[i * 4 + 2] = 255;
            q[i * 4 + 3] = Math.round(a * 255);
          } else {
            q[i * 4] = Math.round(255 * a + 180 * (1 - a));
            q[i * 4 + 1] = Math.round(255 * a + 197 * (1 - a));
            q[i * 4 + 2] = Math.round(255 * a + 140 * (1 - a));
            q[i * 4 + 3] = 255;
          }
        }
      }
      l.canvas.getContext('2d').putImageData(img, 0, 0);
      l.ver++;
      window.__truth = truth;
      d.touch('all');
      api.emit('layers');
    }, [EX, alpha]);
    await settle(200);
  };
  const edgeErr = (spec) => ev(([E, spec]) => {
    const d = window.app.doc;
    const l = spec.layer === 'active' ? d.al : d.layers[0];
    const t = window.__truth;
    const c = document.createElement('canvas');
    c.width = E.w;
    c.height = E.h;
    const g = c.getContext('2d');
    g.drawImage(l.canvas, l.x, l.y);
    const q = g.getImageData(0, 0, E.w, E.h).data;
    const res = { worst: 0, at: null, n: 0, soft: 0, alpha: 0 };
    const dx = spec.dx || 0;
    for (let y = 1; y < E.h - 1; y++) {
      for (let x = 1 + Math.max(0, dx); x < E.w - 1 + Math.min(0, dx); x++) {
        const i = y * E.w + x - dx;
        let band = false;
        for (let yy = -1; yy <= 1 && !band; yy++) for (let xx = -1; xx <= 1; xx++) if (t[i + yy * E.w + xx] > 0 && t[i + yy * E.w + xx] < 1) band = true;
        if (!band) continue;
        const a = t[i];
        const p = (y * E.w + x) * 4;
        const k = q[p + 3] / 255;
        res.n++;
        if (q[p + 3] > 0 && q[p + 3] < 255) res.soft++;
        res.alpha = Math.max(res.alpha, Math.abs(q[p + 3] - spec.alpha[0] * 255 * a - spec.alpha[1] * 255 * (1 - a)));
        for (let ch = 0; ch < 3; ch++) {
          const got = q[p + ch] * k + spec.back[ch] * (1 - k);
          const want = spec.inside[ch] * a + spec.outside[ch] * (1 - a);
          const e = Math.abs(got - want);
          if (e > res.worst) {
            res.worst = e;
            res.at = [x, y, ch, +got.toFixed(1), +want.toFixed(1), +a.toFixed(3)];
          }
        }
      }
    }
    return res;
  }, [EX, spec]);
  await exactScene(false);
  await tool('wand');
  await click(120, 120);
  const est = await decon();
  check('a wand selection carries colour estimates for its edge pixels', est && est.n > 300 && est.all === false, est);
  await key('Delete');
  const exDel = await edgeErr({ back: MAGENTA, inside: MAGENTA, outside: SAGE, alpha: [0, 1] });
  console.log('    exact disc, wand + Delete over magenta: worst edge pixel off the ideal blend by ' + exDel.worst.toFixed(2) + ' levels over ' + exDel.n + ' edge pixels');
  check('wand + Delete matches the ideal green to magenta edge within 2 levels on every edge pixel', exDel.worst <= 2 && exDel.n > 500 && exDel.soft > 300, exDel);
  check('wand + Delete leaves alpha equal to the uncovered share', exDel.alpha <= 2, exDel.alpha);
  check('wand + Delete is still one undo step', (await lastHist()) === 'Clear' && (await hist()).length === 2, await hist());
  await key('Control+z');
  const back = await edgeErr({ back: MAGENTA, inside: WHITE, outside: SAGE, alpha: [1, 1] });
  check('undo after Delete restores every edge pixel', back.worst <= 0.51 && back.alpha === 0, back);
  await fg(255, 0, 255);
  await key('Alt+Backspace');
  const exFill = await edgeErr({ back: MAGENTA, inside: MAGENTA, outside: SAGE, alpha: [1, 1] });
  console.log('    exact disc, wand + fill with magenta: worst edge pixel off by ' + exFill.worst.toFixed(2) + ' levels');
  check('wand + fill matches the ideal magenta to green edge within 2 levels on every edge pixel', exFill.worst <= 2 && exFill.alpha === 0, exFill);
  check('wand + fill is still one undo step', (await lastHist()) === 'Fill' && (await hist()).length === 2, await hist());
  await key('Control+z');
  await run('cut');
  await settle();
  const exCut = await edgeErr({ back: MAGENTA, inside: MAGENTA, outside: SAGE, alpha: [0, 1] });
  check('Cut leaves the same clean edge as Delete', exCut.worst <= 2 && (await lastHist()) === 'Cut', [exCut, await hist()]);
  await key('Control+z');
  await run('inverse');
  await settle();
  const inv = await decon();
  check('Select > Inverse keeps the estimates', inv && inv.n === est.n, [inv, est]);
  await key('Delete');
  const exInv = await edgeErr({ back: MAGENTA, inside: WHITE, outside: MAGENTA, alpha: [1, 0] });
  console.log('    exact disc, Inverse + Delete: worst edge pixel off by ' + exInv.worst.toFixed(2) + ' levels');
  check('Select > Inverse then Delete is ring-free within 2 levels on every edge pixel', exInv.worst <= 2 && exInv.alpha <= 2, exInv);
  await key('Control+z');
  await key('Control+z');
  check('undo steps back to the wand selection', (await hist()).join('|') === 'Magic Wand' && (await decon()) !== null, await hist());
  await run('viaCopy');
  await settle();
  const exCopy = await edgeErr({ layer: 'active', back: [0, 0, 0], inside: WHITE, outside: [0, 0, 0], alpha: [1, 0] });
  console.log('    exact disc, Layer Via Copy over black: worst edge pixel off white by ' + exCopy.worst.toFixed(2) + ' levels');
  check('Layer Via Copy over black has no green fringe', exCopy.worst <= 2 && exCopy.alpha <= 2 && (await lastHist()) === 'Layer Via Copy', exCopy);
  const kept = await edgeErr({ back: MAGENTA, inside: WHITE, outside: SAGE, alpha: [1, 1] });
  check('Layer Via Copy leaves the source layer untouched', kept.worst <= 0.51, kept);
  await key('Control+z');
  await run('viaCut');
  await settle();
  const exLift = await edgeErr({ layer: 'active', back: [0, 0, 0], inside: WHITE, outside: [0, 0, 0], alpha: [1, 0] });
  const exHole = await edgeErr({ back: MAGENTA, inside: MAGENTA, outside: SAGE, alpha: [0, 1] });
  check('Layer Via Cut lifts a clean piece and leaves a clean hole', exLift.worst <= 2 && exHole.worst <= 2 && (await lastHist()) === 'Layer Via Cut', [exLift, exHole]);
  await key('Control+z');
  await tool('move');
  await drag([[120, 120], [320, 120]]);
  const exHole2 = await edgeErr({ back: MAGENTA, inside: MAGENTA, outside: SAGE, alpha: [0, 1] });
  const exMoved = await edgeErr({ back: MAGENTA, inside: WHITE, outside: SAGE, alpha: [1, 1], dx: 200 });
  console.log('    exact disc, Move tool: hole off by ' + exHole2.worst.toFixed(2) + ' levels, moved disc off by ' + exMoved.worst.toFixed(2) + ' levels');
  check('Move tool leaves a clean hole and carries a clean disc', exHole2.worst <= 2 && exMoved.worst <= 2 && (await lastHist()) === 'Move', [exHole2, exMoved, await hist()]);
  check('dragging the selected pixels drops the estimates', (await decon()) === null, await decon());
  await key('Control+z');
  await tool('wand');
  check('undo after Move restores the layer and the estimates', (await edgeErr({ back: MAGENTA, inside: WHITE, outside: SAGE, alpha: [1, 1] })).worst <= 0.51 && (await decon()) !== null, await decon());
  await click(300, 30, ['Shift']);
  check('adding the page to the disc leaves nothing partial and no estimates', (await selStats()).full === EX.w * EX.h && (await decon()) === null, await decon());
  await click(120, 120);
  await click(120, 120, ['Alt']);
  check('subtracting drops the estimates', (await bounds()) === null || (await decon()) === null, await decon());
  await click(120, 120);
  await key('Control+a');
  check('Select All drops the estimates', (await decon()) === null, await decon());
  await click(120, 120);
  await tool('marquee');
  await drag([[300, 40], [400, 140]]);
  check('a marquee selection has no estimates', (await bounds()) !== null && (await decon()) === null, [await bounds(), await decon()]);
  await tool('wand');
  await click(120, 120);
  await ev(() => {
    const d = window.app.doc;
    const g = d.layers[0].canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(40, 110, 20, 20);
    d.layers[0].ver++;
    d.touch('all');
  });
  await key('Delete');
  const painted = await ev(() => {
    const d = window.app.doc;
    const q = d.layers[0].canvas.getContext('2d').getImageData(40, 110, 20, 20).data;
    let tint = 0, soft = 0;
    for (let p = 0; p < q.length; p += 4) {
      if (!q[p + 3]) continue;
      if (q[p + 3] < 255) soft++;
      tint = Math.max(tint, q[p], q[p + 1], q[p + 2]);
    }
    return { tint, soft };
  });
  check('estimates are not used once an edge pixel has changed: the painted colour survives', painted.tint <= 3 && painted.soft > 10 && near(await px(45, 120), [0, 0, 0, 255], 1) && (await px(120, 120))[3] === 0, [painted, await px(45, 120), await px(120, 120)]);

  await exactScene(false);
  await tool('bucket');
  await opt('bucket', { opacity: 100, aa: true, all: false, contiguous: true, tolerance: 32 });
  await fg(255, 0, 255);
  await click(120, 120);
  const exBucket = await edgeErr({ back: MAGENTA, inside: MAGENTA, outside: SAGE, alpha: [1, 1] });
  console.log('    exact disc, paint bucket: worst edge pixel off by ' + exBucket.worst.toFixed(2) + ' levels');
  check('paint bucket matches the ideal edge within 2 levels on every edge pixel', exBucket.worst <= 2 && exBucket.alpha === 0 && (await lastHist()) === 'Paint Bucket', exBucket);
  await key('Control+z');
  await opt('bucket', { opacity: 50 });
  await click(120, 120);
  const exHalf = await edgeErr({ back: MAGENTA, inside: [255, 127.5, 255], outside: SAGE, alpha: [1, 1] });
  check('paint bucket at 50% recolours only the clicked colour in an edge pixel', exHalf.worst <= 2.5, exHalf);
  await opt('bucket', { opacity: 100 });

  await exactScene(true);
  await tool('wand');
  await click(120, 120);
  await fg(255, 0, 255);
  await key('Alt+Backspace');
  const alFill = await edgeErr({ back: [0, 0, 0], inside: MAGENTA, outside: [0, 0, 0], alpha: [1, 0] });
  check('fill on a transparent layer keeps the edge alpha and leaves no white', alFill.worst <= 2 && alFill.alpha <= 2, alFill);
  await key('Control+z');
  await click(300, 30);
  await key('Delete');
  const alDel = await edgeErr({ back: [0, 0, 0], inside: WHITE, outside: [0, 0, 0], alpha: [1, 0] });
  check('deleting the transparent area leaves the artwork edge untouched', alDel.worst <= 0.51 && alDel.alpha <= 0.51, alDel);
  await ev(() => { window.app.doc.dirty = false; });

  await ev(() => {
    const api = window.app.api;
    api.newDoc({ w: 2625, h: 3375, dpi: 300, bg: 'white', name: 'Page' });
    const d = window.app.doc;
    const g = d.layers[0].canvas.getContext('2d');
    g.fillStyle = '#b4c58c';
    g.fillRect(0, 0, d.w, d.h);
    g.fillStyle = '#fff';
    for (const [x, y] of [[700, 800], [1900, 800], [700, 2500], [1900, 2500]]) {
      g.beginPath();
      g.arc(x + 0.4, y + 0.3, 400.3, 0, Math.PI * 2);
      g.fill();
    }
    d.layers[0].ver++;
    d.touch('all');
  });
  await settle(600);
  await click(700, 800, [], 500);
  const first = await stats();
  const big = await selStats();
  check('full page: the click completes with an accurate selection', Math.abs(Math.sqrt(big.area / Math.PI) - 400.3) < 0.15 && first.read === true, [big.area, first]);
  await click(1900, 800, ['Shift'], 500);
  const second = await stats();
  check('full page: a second click does not read the document again', second.read === false && second.load * 3 <= first.load, [first, second]);
  check('full page: Shift-click added the second disc', (await box()).w > 1900, await bounds());
  await click(100, 100, [], 700);
  const whole = await stats();
  check('full page: selecting the whole background reuses the pixels', whole.read === false && (await box()).w === 2625 && (await box()).h === 3375, [whole, await bounds()]);
  console.log('    full page, one layer: first click ' + first.ms.toFixed(0) + ' ms (document read ' + first.load.toFixed(0) + ' ms, selection ' + first.select.toFixed(0) + ' ms), Shift-click ' + second.ms.toFixed(0) + ' ms, whole background ' + whole.ms.toFixed(0) + ' ms (selection ' + whole.select.toFixed(0) + ' ms)');
  await key('Control+d');
  await tool('brush');
  await fg(0, 0, 0);
  await opt('brush', { size: 60, hardness: 100, opacity: 100 });
  await drag([[1700, 2500], [2100, 2500]]);
  await tool('wand');
  await click(1900, 2500, [], 500);
  const stroke = await bounds();
  const after = await stats();
  check('full page: painting invalidates the cached pixels', after.read === true && stroke && stroke.w > 380 && stroke.w < 480 && stroke.h > 50 && stroke.h < 70, [after, stroke]);
  await key('Control+d');

  await ev(() => {
    const api = window.app.api;
    const d = window.app.doc;
    const c = document.createElement('canvas');
    c.width = d.w;
    c.height = d.h;
    const g = c.getContext('2d');
    g.fillStyle = '#204080';
    g.font = '700 260px Arial';
    g.fillText('Class of 2027', 400, 1700);
    d.layers.push(new api.Layer({ name: 'Type', canvas: c }));
    d.layers.push(new api.Layer({ type: 'adjust', name: 'Brightness/Contrast', adj: { kind: 'brightness', p: { brightness: 6, contrast: 4 } } }));
    d.touch('all');
    api.emit('layers');
  });
  await settle(600);
  await opt('wand', { all: true });
  await click(700, 800, [], 600);
  const cold = await stats();
  await click(700, 800, [], 600);
  const warm1 = await stats();
  await click(700, 800, [], 600);
  const warm2 = await stats();
  const warm = Math.min(warm1.ms, warm2.ms);
  console.log('    full page, three layers with an adjustment, Sample All Layers: first click ' + cold.ms.toFixed(0) + ' ms (document read ' + cold.load.toFixed(0) + ' ms), repeat ' + warm1.ms.toFixed(0) + ' and ' + warm2.ms.toFixed(0) + ' ms');
  check('full page: a repeat click on the unchanged document is at least three times faster', cold.read === true && !warm1.read && !warm2.read && cold.ms >= 3 * warm, [cold, warm1, warm2]);
  await opt('wand', { all: false });
  await shot('wand-page');

  console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'all checks passed');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
  await browser.close();
  await srv.close();
})().catch((e) => { console.error(e); process.exit(1); });
