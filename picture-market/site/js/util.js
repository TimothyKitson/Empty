export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

let seq = 0;
export const uid = () => 'L' + Date.now().toString(36) + (++seq).toString(36);

const listeners = {};
export function on(type, fn) {
  (listeners[type] = listeners[type] || []).push(fn);
}
export function emit(type, detail) {
  for (const fn of listeners[type] || []) {
    try {
      fn(detail);
    } catch (e) {
      console.error(e);
    }
  }
}

export function h(tag, props, ...kids) {
  const m = tag.split('.');
  const el = document.createElement(m[0] || 'div');
  if (m.length > 1) el.className = m.slice(1).join(' ');
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'text') el.textContent = v;
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  };
  kids.forEach(add);
  return el;
}

export function mk(w, hh) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(hh));
  return c;
}
export const cx = (c, o) => c.getContext('2d', o);
export function clone(c) {
  const n = mk(c.width, c.height);
  cx(n).drawImage(c, 0, 0);
  return n;
}
export function crop(c, x, y, w, hh) {
  const n = mk(w, hh);
  cx(n).drawImage(c, -x, -y);
  return n;
}

export const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function parseHex(s) {
  let t = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(t)) t = t.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/i.test(t)) return null;
  return { r: parseInt(t.slice(0, 2), 16), g: parseInt(t.slice(2, 4), 16), b: parseInt(t.slice(4, 6), 16) };
}
export const rgba = (c, a = 1) => 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';

export function rgb2hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
    if (hh < 0) hh += 360;
  }
  return { h: hh, s: mx ? d / mx : 0, v: mx };
}
export function hsv2rgb(hh, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
export function rgb2hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let hh = 0;
  let s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
    if (hh < 0) hh += 360;
  }
  return [hh, s, l];
}
export function hsl2rgb(hh, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name, style: { display: 'none' } });
  document.body.append(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

export function pickFiles(accept, multiple) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple: !!multiple, style: { display: 'none' } });
    document.body.append(input);
    let done = false;
    const finish = (files) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish([...input.files]));
    input.addEventListener('cancel', () => finish([]));
    input.click();
  });
}

export async function loadImage(blob) {
  let bmp = null;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (e) {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That file could not be read as an image.'));
      };
      img.src = url;
    });
  }
  const c = mk(bmp.width || bmp.naturalWidth, bmp.height || bmp.naturalHeight);
  cx(c).drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return c;
}

export const toBlob = (c, type = 'image/png', q) => new Promise((resolve) => c.toBlob(resolve, type, q));

export function bounds(c) {
  const w = c.width;
  const hh = c.height;
  const d = new Uint32Array(cx(c).getImageData(0, 0, w, hh).data.buffer);
  let x0 = w, y0 = hh, x1 = -1, y1 = -1;
  for (let y = 0; y < hh; y++) {
    const row = y * w;
    let any = false;
    for (let x = 0; x < w; x++) {
      if (d[row + x] >>> 24) {
        any = true;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
    if (any) {
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
