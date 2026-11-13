const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const http = require('http');
const https = require('https');
const tls = require('tls');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');
const SHOTS = path.join(__dirname, 'shots', 'synth');

const FIXTURES = [
  { name: 'brick', kind: 'pattern', ph: 'red_brick_03', w: 1024, h: 1024 },
  { name: 'paving', kind: 'pattern', ph: 'patterned_paving', w: 1024, h: 1024 },
  { name: 'planks', kind: 'pattern', ph: 'wood_planks', w: 1024, h: 1024 },
  { name: 'grass', kind: 'texture', ph: 'leafy_grass', w: 1024, h: 1024 },
  { name: 'leaves', kind: 'texture', ph: 'forest_leaves_02', w: 1024, h: 1024 },
  { name: 'gravel', kind: 'texture', ph: 'gravel_floor', w: 1024, h: 1024 },
  { name: 'lake', kind: 'scene', us: '1501785888041-af3ef285b470', w: 1600 },
  { name: 'house', kind: 'scene', us: '1480074568708-e7b720bb3f09', w: 1600 },
  { name: 'beach', kind: 'scene', us: '1507525428034-b723cf961d3e', w: 1600 },
  { name: 'room', kind: 'scene', us: '1513694203232-719a280e022f', w: 1600 },
  { name: 'tree', kind: 'scene', us: '1528183429752-a97d0bf99b5a', w: 1600 },
  { name: 'sunset', kind: 'gradient', us: '1500382017468-9049fed747ef', w: 1600 },
  { name: 'sofa', kind: 'gradient', us: '1555041469-a586c61ea9bc', w: 1600 },
  { name: 'ferns', kind: 'page', us: '1497250681960-ef046c08a56e', w: 2625 }
];

function crcTable() {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    t[i] = c;
  }
  return t;
}

const CRC = crcTable();

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.slice(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

function encodePng(w, h, rgba, level = 3) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    let o = y * (w * 3 + 1) + 1;
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4, o += 3) {
      raw[o] = rgba[i];
      raw[o + 1] = rgba[i + 1];
      raw[o + 2] = rgba[i + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level })), chunk('IEND', Buffer.alloc(0))]);
}

function decodePng(buf) {
  let p = 8;
  let w = 0;
  let h = 0;
  let type = 0;
  const parts = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const name = buf.toString('latin1', p + 4, p + 8);
    const data = buf.slice(p + 8, p + 8 + len);
    if (name === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      type = data[9];
      if (data[8] !== 8 || (type !== 2 && type !== 6) || data[12] !== 0) throw new Error('unsupported png');
    } else if (name === 'IDAT') parts.push(data);
    else if (name === 'IEND') break;
    p += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = w * bpp;
  const rgba = new Uint8ClampedArray(w * h * 4);
  const cur = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.slice(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = row[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    let o = y * w * 4;
    for (let x = 0; x < w; x++, o += 4) {
      rgba[o] = cur[x * bpp];
      rgba[o + 1] = cur[x * bpp + 1];
      rgba[o + 2] = cur[x * bpp + 2];
      rgba[o + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    cur.copy(prev);
  }
  return { w, h, rgba };
}

function agent() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return undefined;
  const p = new URL(proxy);
  const a = new https.Agent({ keepAlive: false });
  a.createConnection = (opts, cb) => {
    const req = http.request({ host: p.hostname, port: p.port, method: 'CONNECT', path: opts.host + ':' + (opts.port || 443) });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        cb(new Error('proxy answered ' + res.statusCode));
        return;
      }
      cb(null, tls.connect({ socket, servername: opts.servername || opts.host }));
    });
    req.on('error', cb);
    req.end();
  };
  return a;
}

function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) {
      reject(new Error('too many redirects'));
      return;
    }
    const req = https.get(url, { agent: agent(), headers: { 'User-Agent': 'node' }, timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        get(new URL(res.headers.location, url).href, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(url + ' answered ' + res.statusCode));
        return;
      }
      const bufs = [];
      res.on('data', (d) => bufs.push(d));
      res.on('end', () => resolve(Buffer.concat(bufs)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout ' + url)));
    req.on('error', reject);
  });
}

async function sourceUrl(f) {
  if (f.us) return 'https://images.unsplash.com/photo-' + f.us + '?w=' + f.w + '&q=85&fm=jpg';
  const meta = JSON.parse((await get('https://api.polyhaven.com/files/' + f.ph)).toString('utf8'));
  const d = meta.Diffuse || meta.diffuse;
  return d['2k'].jpg.url;
}

async function fetchFixtures(log = () => {}) {
  fs.mkdirSync(FIX, { recursive: true });
  const missing = [];
  for (const f of FIXTURES) {
    const jpg = path.join(FIX, f.name + '.jpg');
    if (fs.existsSync(jpg) && fs.statSync(jpg).size > 20000) continue;
    try {
      const url = await sourceUrl(f);
      const data = await get(url);
      fs.writeFileSync(jpg, data);
      log('fetched ' + f.name + ' (' + data.length + ' bytes)');
    } catch (e) {
      missing.push(f.name + ': ' + e.message);
    }
  }
  return missing;
}

async function decodeFixtures(browser, base) {
  const page = await browser.newPage();
  await page.goto(base + 'dev/serve.js');
  for (const f of FIXTURES) {
    const jpg = path.join(FIX, f.name + '.jpg');
    const png = path.join(FIX, f.name + '.png');
    if (!fs.existsSync(jpg) || fs.existsSync(png)) continue;
    const url = await page.evaluate(async ({ src, w, h }) => {
      const blob = await (await fetch(src)).blob();
      const bmp = await createImageBitmap(blob);
      const tw = w || bmp.width;
      const th = h || Math.round((bmp.height * tw) / bmp.width);
      const c = document.createElement('canvas');
      c.width = tw;
      c.height = th;
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, tw, th);
      return c.toDataURL('image/png');
    }, { src: base + 'dev/fixtures/' + f.name + '.jpg', w: f.w, h: f.h });
    fs.writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'));
  }
  await page.close();
}

function loadFixture(name) {
  const png = path.join(FIX, name + '.png');
  if (!fs.existsSync(png)) return null;
  return decodePng(fs.readFileSync(png));
}

function loadCore() {
  const text = fs.readFileSync(path.join(ROOT, 'site', 'js', 'synth.js'), 'utf8');
  if (!text.startsWith('export function synthCore()')) throw new Error('synth.js must start with the synthCore export');
  return new Function(text.replace('export function synthCore', 'function synthCore') + '\nreturn synthCore;')();
}

function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function blob(w, h, cx, cy, rx, ry, seed, mask) {
  const r = rng(seed);
  const p1 = r() * 6.283;
  const p2 = r() * 6.283;
  const p3 = r() * 6.283;
  const a1 = seed ? 0.22 : 0;
  const a2 = seed ? 0.13 : 0;
  const a3 = seed ? 0.07 : 0;
  const m = mask || new Uint8Array(w * h);
  const y0 = Math.max(0, Math.floor(cy - ry * 1.5));
  const y1 = Math.min(h - 1, Math.ceil(cy + ry * 1.5));
  const x0 = Math.max(0, Math.floor(cx - rx * 1.5));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx * 1.5));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const t = Math.atan2(dy, dx);
      const k = 1 + a1 * Math.sin(2 * t + p1) + a2 * Math.sin(3 * t + p2) + a3 * Math.sin(5 * t + p3);
      if (dx * dx + dy * dy <= k * k) m[y * w + x] = 1;
    }
  }
  return m;
}

function rect(w, h, x0, y0, rw, rh, mask) {
  const m = mask || new Uint8Array(w * h);
  for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) m[y * w + x] = 1;
  return m;
}

function boundsOf(mask, w, h) {
  let x0 = w;
  let x1 = -1;
  let y0 = h;
  let y1 = -1;
  let c = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        c++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, count: c };
}

function crop(img, x0, y0, cw, ch) {
  const o = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = y + y0;
    if (sy < 0 || sy >= img.h) continue;
    for (let x = 0; x < cw; x++) {
      const sx = x + x0;
      if (sx < 0 || sx >= img.w) continue;
      const s = (sy * img.w + sx) * 4;
      const d = (y * cw + x) * 4;
      o[d] = img.rgba[s];
      o[d + 1] = img.rgba[s + 1];
      o[d + 2] = img.rgba[s + 2];
      o[d + 3] = img.rgba[s + 3];
    }
  }
  return { w: cw, h: ch, rgba: o };
}

function resize(img, tw, th) {
  const o = new Uint8ClampedArray(tw * th * 4);
  const fx = img.w / tw;
  const fy = img.h / th;
  for (let y = 0; y < th; y++) {
    const ya = Math.floor(y * fy);
    const yb = Math.max(ya + 1, Math.min(img.h, Math.ceil((y + 1) * fy)));
    for (let x = 0; x < tw; x++) {
      const xa = Math.floor(x * fx);
      const xb = Math.max(xa + 1, Math.min(img.w, Math.ceil((x + 1) * fx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let m = 0;
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          const s = (yy * img.w + xx) * 4;
          r += img.rgba[s];
          g += img.rgba[s + 1];
          b += img.rgba[s + 2];
          a += img.rgba[s + 3];
          m++;
        }
      }
      const d = (y * tw + x) * 4;
      o[d] = r / m;
      o[d + 1] = g / m;
      o[d + 2] = b / m;
      o[d + 3] = a / m;
    }
  }
  return { w: tw, h: th, rgba: o };
}

function fit(img, mw, mh) {
  const s = Math.min(1, mw / img.w, mh / img.h);
  if (s === 1) return img;
  return resize(img, Math.max(1, Math.round(img.w * s)), Math.max(1, Math.round(img.h * s)));
}

function marked(img, target, known) {
  const o = new Uint8ClampedArray(img.rgba);
  for (let i = 0; i < img.w * img.h; i++) {
    const x = i % img.w;
    const y = (i / img.w) | 0;
    if (target[i]) {
      const c = ((x >> 3) + (y >> 3)) & 1;
      o[i * 4] = c ? 255 : 225;
      o[i * 4 + 1] = c ? 60 : 30;
      o[i * 4 + 2] = c ? 200 : 170;
    } else if (known && !known[i]) {
      const c = ((x >> 4) + (y >> 4)) & 1 ? 235 : 205;
      o[i * 4] = c;
      o[i * 4 + 1] = c;
      o[i * 4 + 2] = c;
    }
    o[i * 4 + 3] = 255;
  }
  return { w: img.w, h: img.h, rgba: o };
}

function fieldImage(w, h, field) {
  const o = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    o[i * 4] = 40;
    o[i * 4 + 1] = 40;
    o[i * 4 + 2] = 40;
    o[i * 4 + 3] = 255;
  }
  if (!field) return { w, h, rgba: o };
  for (let y = 0; y < field.h; y++) {
    for (let x = 0; x < field.w; x++) {
      const q = field.map[y * field.w + x];
      if (q < 0) continue;
      const px = x + field.x;
      const py = y + field.y;
      const dx = (q % field.rw) - px;
      const dy = ((q / field.rw) | 0) - py;
      let hsh = Math.imul(dx * 73856093 ^ dy * 19349663, 2654435761) >>> 0;
      const d = ((py + field.ry) * w + px + field.rx) * 4;
      o[d] = 60 + (hsh & 127);
      hsh >>>= 8;
      o[d + 1] = 60 + (hsh & 127);
      hsh >>>= 8;
      o[d + 2] = 60 + (hsh & 127);
    }
  }
  return { w, h, rgba: o };
}

function sheet(rows, gap = 6, bg = 24) {
  const widths = rows.map((r) => r.reduce((s, p) => s + p.w, 0) + gap * (r.length + 1));
  const heights = rows.map((r) => Math.max(...r.map((p) => p.h)) + gap);
  const W = Math.max(...widths);
  const H = heights.reduce((a, b) => a + b, 0) + gap;
  const o = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    o[i * 4] = bg;
    o[i * 4 + 1] = bg;
    o[i * 4 + 2] = bg;
    o[i * 4 + 3] = 255;
  }
  let y0 = gap;
  rows.forEach((r, ri) => {
    let x0 = gap;
    for (const p of r) {
      for (let y = 0; y < p.h; y++) {
        const s = y * p.w * 4;
        o.set(p.rgba.subarray(s, s + p.w * 4), ((y0 + y) * W + x0) * 4);
      }
      x0 += p.w + gap;
    }
    y0 += heights[ri];
  });
  return { w: W, h: H, rgba: o };
}

function savePng(file, img) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, encodePng(img.w, img.h, img.rgba));
}

function lumaPlane(rgba, n) {
  const l = new Float32Array(n);
  for (let i = 0; i < n; i++) l[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return l;
}

function boxBlur(src, w, h, r, valid) {
  const tmp = new Float32Array(w * h);
  const wt = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    let c = 0;
    for (let x = -r; x < w; x++) {
      const a = x + r;
      if (a < w && (!valid || valid[y * w + a])) {
        s += src[y * w + a];
        c++;
      }
      const b = x - r - 1;
      if (b >= 0 && (!valid || valid[y * w + b])) {
        s -= src[y * w + b];
        c--;
      }
      if (x >= 0) {
        tmp[y * w + x] = s;
        wt[y * w + x] = c;
      }
    }
  }
  const cs = new Float32Array(w);
  const cc = new Float32Array(w);
  for (let y = -r; y < h; y++) {
    const a = y + r;
    const b = y - r - 1;
    for (let x = 0; x < w; x++) {
      if (a < h) {
        cs[x] += tmp[a * w + x];
        cc[x] += wt[a * w + x];
      }
      if (b >= 0) {
        cs[x] -= tmp[b * w + x];
        cc[x] -= wt[b * w + x];
      }
      if (y >= 0) out[y * w + x] = cc[x] > 0 ? cs[x] / cc[x] : 0;
    }
  }
  return out;
}

function blur3(src, w, h, r, valid) {
  let a = boxBlur(src, w, h, r, valid);
  a = boxBlur(a, w, h, r);
  return boxBlur(a, w, h, r);
}

function metrics(truth, res, target, known, w, h) {
  const b = boundsOf(target, w, h);
  const size = Math.sqrt(b.count);
  const pad = Math.round(Math.max(24, size * 0.35));
  const x0 = Math.max(0, b.x - pad);
  const y0 = Math.max(0, b.y - pad);
  const x1 = Math.min(w - 1, b.x + b.w - 1 + pad);
  const y1 = Math.min(h - 1, b.y + b.h - 1 + pad);
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;
  const tr = crop({ w, h, rgba: truth }, x0, y0, cw, ch).rgba;
  const rr = crop({ w, h, rgba: res }, x0, y0, cw, ch).rgba;
  const tg = new Uint8Array(cw * ch);
  const kn = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      tg[y * cw + x] = target[(y + y0) * w + x + x0];
      kn[y * cw + x] = known[(y + y0) * w + x + x0];
    }
  }
  let mae = 0;
  for (let i = 0; i < cw * ch; i++) if (tg[i]) mae += Math.abs(tr[i * 4] - rr[i * 4]) + Math.abs(tr[i * 4 + 1] - rr[i * 4 + 1]) + Math.abs(tr[i * 4 + 2] - rr[i * 4 + 2]);
  mae /= b.count * 3;
  const def = new Uint8Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) def[i] = tg[i] || kn[i] ? 1 : 0;
  const rad = Math.max(1, Math.round(size / 20 / 2));
  let low = 0;
  for (let k = 0; k < 3; k++) {
    const pt = new Float32Array(cw * ch);
    const pr = new Float32Array(cw * ch);
    for (let i = 0; i < cw * ch; i++) {
      pt[i] = tr[i * 4 + k];
      pr[i] = rr[i * 4 + k];
    }
    const bt = blur3(pt, cw, ch, rad, def);
    const br = blur3(pr, cw, ch, rad, def);
    for (let i = 0; i < cw * ch; i++) if (tg[i]) low += Math.abs(bt[i] - br[i]);
  }
  low /= b.count * 3;
  const lr = lumaPlane(rr, cw * ch);
  const lt = lumaPlane(tr, cw * ch);
  const hr = blur3(lr, cw, ch, 1, def);
  const ht = blur3(lt, cw, ch, 1, def);
  const ringW = Math.round(Math.max(8, Math.min(40, size * 0.15)));
  const near = boxBlur(Float32Array.from(tg), cw, ch, ringW);
  let eIn = 0;
  let nIn = 0;
  let eRing = 0;
  let nRing = 0;
  let eTruth = 0;
  let stepRing = 0;
  let nStep = 0;
  let eKnown = 0;
  let nKnown = 0;
  for (let y = 1; y < ch - 1; y++) {
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x;
      if (kn[i] && !tg[i]) {
        eKnown += Math.abs(lr[i] - hr[i]);
        nKnown++;
      }
      if (tg[i]) {
        eIn += Math.abs(lr[i] - hr[i]);
        eTruth += Math.abs(lt[i] - ht[i]);
        nIn++;
      } else if (kn[i] && near[i] > 0) {
        eRing += Math.abs(lr[i] - hr[i]);
        nRing++;
        if (kn[i + 1] && !tg[i + 1]) {
          stepRing += Math.abs(lr[i] - lr[i + 1]);
          nStep++;
        }
        if (kn[i + cw] && !tg[i + cw]) {
          stepRing += Math.abs(lr[i] - lr[i + cw]);
          nStep++;
        }
      }
    }
  }
  let seam = 0;
  let nSeam = 0;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (!tg[i]) continue;
      if (x + 1 < cw && kn[i + 1] && !tg[i + 1]) {
        seam += Math.abs(lr[i] - lr[i + 1]);
        nSeam++;
      }
      if (x > 0 && kn[i - 1] && !tg[i - 1]) {
        seam += Math.abs(lr[i] - lr[i - 1]);
        nSeam++;
      }
      if (y + 1 < ch && kn[i + cw] && !tg[i + cw]) {
        seam += Math.abs(lr[i] - lr[i + cw]);
        nSeam++;
      }
      if (y > 0 && kn[i - cw] && !tg[i - cw]) {
        seam += Math.abs(lr[i] - lr[i - cw]);
        nSeam++;
      }
    }
  }
  const dIn = nIn ? eIn / nIn : 0;
  const dRing = nRing ? eRing / nRing : 0;
  const dTruth = nIn ? eTruth / nIn : 0;
  const typ = nStep ? stepRing / nStep : 0;
  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    mae: r2(mae), low: r2(low), detail: dRing > 0.05 ? r2(dIn / dRing) : dIn < 0.05 ? 1 : 99,
    detailTruth: dTruth > 0.05 ? r2(dIn / dTruth) : dIn < 0.05 ? 1 : 99,
    detailKnown: nKnown && eKnown / nKnown > 0.05 ? r2(dIn / (eKnown / nKnown)) : dIn < 0.05 ? 1 : 99,
    seam: nSeam ? (typ > 0.05 ? r2(seam / nSeam / typ) : seam / nSeam < 0.05 ? 1 : 99) : 0
  };
}

function hash(arr) {
  let a = 2166136261;
  for (let i = 0; i < arr.length; i++) a = Math.imul(a ^ arr[i], 16777619);
  return (a >>> 0).toString(16);
}

function runJob(synthCore, job, slice = 0) {
  const core = synthCore();
  const t0 = performance.now();
  const run = core.start(job);
  let worst = 0;
  let last = 0;
  let mono = true;
  if (slice > 0) {
    for (;;) {
      const a = performance.now();
      const fin = run.step(slice);
      const d = performance.now() - a;
      if (d > worst) worst = d;
      const p = run.progress();
      if (p < last) mono = false;
      last = p;
      if (fin) break;
    }
  }
  const res = run.result();
  return { rgba: res.rgba, stats: res.stats, field: res.field, ms: Math.round(performance.now() - t0), worst: Math.round(worst * 10) / 10, mono, end: run.progress() };
}

module.exports = {
  ROOT, FIX, SHOTS, FIXTURES, encodePng, decodePng, fetchFixtures, decodeFixtures, loadFixture, loadCore, rng, blob, rect, boundsOf,
  crop, resize, fit, marked, fieldImage, sheet, savePng, metrics, hash, runJob, blur3, lumaPlane
};
