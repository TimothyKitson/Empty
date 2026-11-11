import { h, emit, mk, cx } from './util.js';
import { Doc, Layer } from './doc.js';
import { app, view, fit, invalidate } from './view.js';
import { endModal } from './tools.js';

export const PRESETS = [
  { name: 'Yearbook Page 8.5 × 11 in', w: 2550, h: 3300, dpi: 300 },
  { name: 'Yearbook Page 9 × 12 in', w: 2700, h: 3600, dpi: 300 },
  { name: 'Yearbook Page 7.75 × 10.5 in', w: 2325, h: 3150, dpi: 300 },
  { name: 'Yearbook Spread 17 × 11 in', w: 5100, h: 3300, dpi: 300 },
  { name: 'Photo 4 × 6 in', w: 1200, h: 1800, dpi: 300 },
  { name: 'Photo 5 × 7 in', w: 1500, h: 2100, dpi: 300 },
  { name: 'Photo 8 × 10 in', w: 2400, h: 3000, dpi: 300 },
  { name: 'Square 1080', w: 1080, h: 1080, dpi: 72 },
  { name: 'HD 1920 × 1080', w: 1920, h: 1080, dpi: 72 }
];

export function activate(d) {
  if (app.modal) endModal(true);
  const cur = app.doc;
  if (cur) {
    cur.zoom = view.zoom;
    cur.px = view.px;
    cur.py = view.py;
  }
  app.doc = d || null;
  if (d) {
    if (d.zoom) {
      view.zoom = d.zoom;
      view.px = d.px;
      view.py = d.py;
      invalidate();
      emit('view');
    } else {
      fit();
      requestAnimationFrame(() => {
        if (app.doc === d && !d.fitted) {
          d.fitted = true;
          fit();
        }
      });
    }
  }
  emit('docs');
  emit('sel', d);
  emit('hist', d);
}

export function addDoc(d) {
  app.docs.push(d);
  activate(d);
  return d;
}

export function removeDoc(d) {
  const i = app.docs.indexOf(d);
  if (i < 0) return;
  app.docs.splice(i, 1);
  if (app.doc === d) {
    app.doc = null;
    activate(app.docs[Math.min(i, app.docs.length - 1)] || null);
  } else emit('docs');
}

let untitled = 0;
export function newDoc(o = {}) {
  const d = new Doc(o.w || 2550, o.h || 3300, o.dpi || 300, o.name || 'Untitled-' + (++untitled));
  const bg = o.bg === undefined ? 'white' : o.bg;
  if (bg === 'transparent') {
    d.add(new Layer({ name: 'Layer 1' }));
  } else {
    const c = mk(d.w, d.h);
    const g = cx(c);
    g.fillStyle = bg === 'white' ? '#fff' : bg === 'black' ? '#000' : bg;
    g.fillRect(0, 0, d.w, d.h);
    d.add(new Layer({ name: 'Background', canvas: c }));
  }
  return addDoc(d);
}

export function docFromCanvas(c, name, dpi) {
  const d = new Doc(c.width, c.height, dpi || 300, name || 'Untitled');
  d.add(new Layer({ name: 'Background', canvas: c }));
  return addDoc(d);
}

export async function busy(label, fn) {
  const el = h('div.busy', null, h('div', { text: label + '…' }));
  document.body.append(el);
  await new Promise((r) => setTimeout(r, 40));
  try {
    return await fn();
  } finally {
    el.remove();
  }
}
