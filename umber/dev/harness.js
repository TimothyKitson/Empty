const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { serve } = require('./serve');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.UMBER_SHOTS || path.join(ROOT, 'dev', 'shots');

async function launch(opts = {}) {
  const target = opts.target || process.env.UMBER_TARGET || 'site';
  const srv = await serve(ROOT);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    deviceScaleFactor: opts.dpr || 1,
    acceptDownloads: true,
    ...(opts.context || {})
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const rel = opts.page || (target === 'dist' ? 'dist/umber.html' : 'site/index.html');
  const query = opts.query === undefined ? '?test=1' : opts.query;
  await page.goto(srv.url + rel + query);
  const timeout = opts.timeout || 45000;
  if (opts.page) {
    await page.waitForFunction(() => window.ready === true, null, { timeout });
  } else {
    await page.waitForFunction(() => window.app && window.app.ready === true, null, { timeout });
  }

  const h = {
    page,
    browser,
    context,
    errors,
    url: srv.url,
    eval: (fn, arg) => page.evaluate(fn, arg),
    newDoc: (width = 800, height = 600, background = 'white', name = 'Test') => page.evaluate(
      (o) => window.app.newDocument({ width: o.width, height: o.height, background: o.background, name: o.name, dpi: 72 }).id,
      { width, height, background, name }
    ),
    cmd: (id, args) => page.evaluate((o) => window.app.commands.run(o.id, o.args), { id, args }),
    tool: (id) => page.evaluate((t) => window.app.tools.activate(t), id),
    setOption: (tool, key, value) => page.evaluate((o) => window.app.tools.setOption(o.tool, o.key, o.value), { tool, key, value }),
    setColors: (fg, bg) => page.evaluate((o) => {
      if (o.fg) window.app.colors.setFg(o.fg);
      if (o.bg) window.app.colors.setBg(o.bg);
    }, { fg, bg }),
    pixel: (x, y) => page.evaluate((o) => window.app.debug.pixel(o.x, o.y), { x, y }),
    layerPixel: (x, y, layerId) => page.evaluate((o) => window.app.debug.layerPixel(o.x, o.y, o.layerId), { x, y, layerId }),
    state: () => page.evaluate(() => window.app.debug.state()),
    settle: () => page.evaluate(() => window.app.debug.settle()),
    toClient: (x, y) => page.evaluate((o) => window.app.debug.docToClient(o.x, o.y), { x, y }),
    async move(x, y) {
      const p = await h.toClient(x, y);
      await page.mouse.move(p.x, p.y);
    },
    async click(x, y, o = {}) {
      const p = await h.toClient(x, y);
      for (const m of o.modifiers || []) await page.keyboard.down(m);
      await page.mouse.click(p.x, p.y, { button: o.button || 'left', clickCount: o.clickCount || 1 });
      for (const m of (o.modifiers || []).slice().reverse()) await page.keyboard.up(m);
      await h.settle();
    },
    async drag(points, o = {}) {
      const steps = o.steps || 8;
      for (const m of o.modifiers || []) await page.keyboard.down(m);
      const first = await h.toClient(points[0][0], points[0][1]);
      await page.mouse.move(first.x, first.y);
      await page.mouse.down({ button: o.button || 'left' });
      for (let i = 1; i < points.length; i++) {
        const p = await h.toClient(points[i][0], points[i][1]);
        await page.mouse.move(p.x, p.y, { steps });
      }
      await page.mouse.up({ button: o.button || 'left' });
      for (const m of (o.modifiers || []).slice().reverse()) await page.keyboard.up(m);
      await h.settle();
    },
    async key(combo) {
      await page.keyboard.press(combo);
      await h.settle();
    },
    async shot(name, o = {}) {
      fs.mkdirSync(SHOTS, { recursive: true });
      const file = path.join(SHOTS, name + '.png');
      await page.screenshot({ path: file, ...o });
      return file;
    },
    async close() {
      await browser.close();
      await srv.close();
    }
  };
  return h;
}

function fail(msg) {
  throw new Error(msg);
}

const t = {
  ok(v, msg) {
    if (!v) fail('expected truthy: ' + (msg || ''));
  },
  eq(a, b, msg) {
    const x = JSON.stringify(a);
    const y = JSON.stringify(b);
    if (x !== y) fail((msg || 'eq') + ': got ' + x + ' expected ' + y);
  },
  near(a, b, tol = 1, msg) {
    if (typeof a !== 'number' || Math.abs(a - b) > tol) fail((msg || 'near') + ': got ' + a + ' expected ' + b + ' ±' + tol);
  },
  pixel(actual, expected, tol = 2, msg) {
    const bad = !actual || expected.some((v, i) => Math.abs(actual[i] - v) > tol);
    if (bad) fail((msg || 'pixel') + ': got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected) + ' ±' + tol);
  }
};

async function run(name, fn, opts = {}) {
  const started = Date.now();
  let h = null;
  let passed = false;
  try {
    h = await launch(opts);
    await fn(h, t);
    if (h.errors.length && !opts.allowErrors) fail('page errors:\n' + h.errors.join('\n'));
    passed = true;
  } catch (e) {
    console.log('FAIL ' + name + '\n' + ((e && e.stack) || e));
    if (h) {
      try {
        const file = await h.shot('fail-' + name.replace(/[^a-z0-9]+/gi, '-'));
        console.log('screenshot: ' + file);
      } catch (shotError) {
        console.log('no screenshot: ' + shotError.message);
      }
    }
    process.exitCode = 1;
  } finally {
    if (h) await h.close().catch(() => {});
  }
  if (passed) console.log('PASS ' + name + ' (' + (Date.now() - started) + 'ms)');
  return passed;
}

module.exports = { launch, run, t, ROOT, SHOTS };
