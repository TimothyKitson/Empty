import { mk, cx, clamp, emit, on, h } from './util.js';
import { render, selPath } from './doc.js';

export const app = {
  docs: [],
  doc: null,
  fg: { r: 0, g: 0, b: 0 },
  bg: { r: 255, g: 255, b: 255 },
  tool: null,
  tools: {},
  opts: {},
  modal: null,
  clip: null,
  lastFilter: null
};

export const view = {
  stage: null, cv: null, ov: null, comp: null, zoom: 1, px: 0, py: 0, dpr: 1, w: 0, h: 0,
  dirty: true, odirty: true, space: false, pointer: { x: 0, y: 0, sx: 0, sy: 0, inside: false }, ants: 0, cursor: null
};

const ZOOMS = [0.01, 0.02, 0.03, 0.05, 0.0625, 0.0833, 0.125, 0.1667, 0.25, 0.3333, 0.5, 0.6667, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 32, 64];
let pattern = null;
let checker = null;

export function invalidate() {
  view.dirty = true;
  view.odirty = true;
}
export function overlay() {
  view.odirty = true;
}

export function toDoc(clientX, clientY) {
  const r = view.stage.getBoundingClientRect();
  return { x: (clientX - r.left - view.px) / view.zoom, y: (clientY - r.top - view.py) / view.zoom };
}
export const toScreen = (x, y) => ({ x: x * view.zoom + view.px, y: y * view.zoom + view.py });

export function setZoom(z, sx, sy) {
  z = clamp(z, 0.01, 64);
  if (sx == null) {
    sx = view.w / 2;
    sy = view.h / 2;
  }
  const dx = (sx - view.px) / view.zoom;
  const dy = (sy - view.py) / view.zoom;
  view.zoom = z;
  view.px = sx - dx * z;
  view.py = sy - dy * z;
  clampPan();
  invalidate();
  emit('view');
}
export function zoomStep(dir, sx, sy) {
  let z = view.zoom;
  if (dir > 0) z = ZOOMS.find((v) => v > view.zoom * 1.001) || 64;
  else z = [...ZOOMS].reverse().find((v) => v < view.zoom * 0.999) || 0.01;
  setZoom(z, sx, sy);
}
export function fit() {
  const d = app.doc;
  if (!d || !view.w) return;
  const z = Math.min((view.w - 48) / d.w, (view.h - 48) / d.h);
  view.zoom = clamp(z, 0.01, 32);
  view.px = Math.round((view.w - d.w * view.zoom) / 2);
  view.py = Math.round((view.h - d.h * view.zoom) / 2);
  invalidate();
  emit('view');
}
function clampPan() {
  const d = app.doc;
  if (!d) return;
  const m = 60;
  view.px = clamp(view.px, m - d.w * view.zoom, view.w - m);
  view.py = clamp(view.py, m - d.h * view.zoom, view.h - m);
}
export function panBy(dx, dy) {
  view.px += dx;
  view.py += dy;
  clampPan();
  invalidate();
  emit('view');
}

function resize() {
  const r = view.stage.getBoundingClientRect();
  view.dpr = Math.min(2, window.devicePixelRatio || 1);
  view.w = Math.max(1, Math.round(r.width));
  view.h = Math.max(1, Math.round(r.height));
  for (const c of [view.cv, view.ov, view.comp]) {
    c.width = Math.round(view.w * view.dpr);
    c.height = Math.round(view.h * view.dpr);
  }
  for (const c of [view.cv, view.ov]) {
    c.style.width = view.w + 'px';
    c.style.height = view.h + 'px';
  }
  invalidate();
}

function drawMain() {
  const g = cx(view.cv);
  const W = view.cv.width;
  const H = view.cv.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--stage').trim() || '#1c1b1a';
  g.fillRect(0, 0, W, H);
  const d = app.doc;
  if (!d) return;
  const s = view.zoom * view.dpr;
  const tx = Math.round(view.px * view.dpr);
  const ty = Math.round(view.py * view.dpr);
  const dw = d.w * s;
  const dh = d.h * s;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(tx - 1, ty - 1, dw + 2, dh + 2);
  if (!checker) {
    const c = mk(16, 16);
    const cg = cx(c);
    cg.fillStyle = '#fff';
    cg.fillRect(0, 0, 16, 16);
    cg.fillStyle = '#cfcfcf';
    cg.fillRect(0, 0, 8, 8);
    cg.fillRect(8, 8, 8, 8);
    checker = g.createPattern(c, 'repeat');
  }
  g.fillStyle = checker;
  g.fillRect(tx, ty, dw, dh);
  const cg = cx(view.comp);
  cg.setTransform(1, 0, 0, 1, 0, 0);
  cg.clearRect(0, 0, W, H);
  render(d, cg, s, tx, ty);
  g.drawImage(view.comp, 0, 0);
  if (view.zoom >= 8) {
    g.strokeStyle = 'rgba(128,128,128,0.35)';
    g.lineWidth = 1;
    g.beginPath();
    const x0 = Math.max(0, Math.floor(-view.px / view.zoom));
    const x1 = Math.min(d.w, Math.ceil((view.w - view.px) / view.zoom));
    const y0 = Math.max(0, Math.floor(-view.py / view.zoom));
    const y1 = Math.min(d.h, Math.ceil((view.h - view.py) / view.zoom));
    for (let x = x0; x <= x1; x++) {
      g.moveTo(Math.round(tx + x * s) + 0.5, ty + y0 * s);
      g.lineTo(Math.round(tx + x * s) + 0.5, ty + y1 * s);
    }
    for (let y = y0; y <= y1; y++) {
      g.moveTo(tx + x0 * s, Math.round(ty + y * s) + 0.5);
      g.lineTo(tx + x1 * s, Math.round(ty + y * s) + 0.5);
    }
    g.stroke();
  }
}

function drawOverlay() {
  const g = cx(view.ov);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, view.ov.width, view.ov.height);
  g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const d = app.doc;
  if (!d) return;
  if (d.guides.length) {
    g.strokeStyle = '#3fd5ff';
    g.lineWidth = 1;
    g.beginPath();
    for (const gd of d.guides) {
      if (gd.v) {
        const x = Math.round(gd.pos * view.zoom + view.px) + 0.5;
        g.moveTo(x, 0);
        g.lineTo(x, view.h);
      } else {
        const y = Math.round(gd.pos * view.zoom + view.py) + 0.5;
        g.moveTo(0, y);
        g.lineTo(view.w, y);
      }
    }
    g.stroke();
  }
  if (d.sel && !view.hideAnts) {
    if (!pattern) {
      const c = mk(8, 8);
      const pg = cx(c);
      pg.fillStyle = '#fff';
      pg.fillRect(0, 0, 8, 8);
      pg.fillStyle = '#000';
      pg.beginPath();
      pg.moveTo(0, 0); pg.lineTo(4, 0); pg.lineTo(0, 4); pg.closePath();
      pg.moveTo(8, 0); pg.lineTo(8, 4); pg.lineTo(4, 8); pg.lineTo(0, 8); pg.closePath();
      pg.fill();
      pattern = g.createPattern(c, 'repeat');
    }
    const p = new Path2D();
    p.addPath(selPath(d.sel), new DOMMatrix([view.zoom, 0, 0, view.zoom, view.px, view.py]));
    pattern.setTransform(new DOMMatrix().translate(view.ants, 0));
    g.strokeStyle = pattern;
    g.lineWidth = 1;
    g.stroke(p);
  }
  const t = app.modal || app.tool;
  if (t && t.overlay) {
    g.save();
    try {
      t.overlay(g);
    } catch (e) {
      console.error(e);
    }
    g.restore();
  }
}

function frame() {
  if (view.dirty) {
    view.dirty = false;
    drawMain();
  }
  if (view.odirty) {
    view.odirty = false;
    drawOverlay();
  }
  requestAnimationFrame(frame);
}

export function handle(g, x, y, active) {
  g.fillStyle = active ? '#e8a33d' : '#fff';
  g.strokeStyle = '#222';
  g.lineWidth = 1;
  g.fillRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
  g.strokeRect(Math.round(x) - 3.5, Math.round(y) - 3.5, 7, 7);
}
export function dualStroke(g, draw) {
  g.lineWidth = 1;
  g.setLineDash([]);
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  draw(g);
  g.stroke();
  g.setLineDash([4, 4]);
  g.strokeStyle = 'rgba(0,0,0,0.9)';
  g.beginPath();
  draw(g);
  g.stroke();
  g.setLineDash([]);
}

function evt(ev, type) {
  const p = toDoc(ev.clientX, ev.clientY);
  const r = view.stage.getBoundingClientRect();
  return {
    type, x: p.x, y: p.y, sx: ev.clientX - r.left, sy: ev.clientY - r.top,
    shift: ev.shiftKey, alt: ev.altKey, ctrl: ev.ctrlKey || ev.metaKey, button: ev.button,
    pressure: ev.pointerType === 'pen' ? ev.pressure || 0.5 : 1, ev
  };
}

export function initView(stage) {
  view.stage = stage;
  view.cv = h('canvas.cv');
  view.ov = h('canvas.ov');
  view.comp = mk(1, 1);
  stage.append(view.cv, view.ov);
  new ResizeObserver(resize).observe(stage);
  resize();
  requestAnimationFrame(frame);
  setInterval(() => {
    if (app.doc && app.doc.sel && !document.hidden) {
      view.ants = (view.ants + 1) % 8;
      view.odirty = true;
    }
  }, 120);

  let drag = null;
  const pointers = new Map();
  let pinch = null;

  const target = () => app.modal || app.tool;
  const call = (name, e) => {
    const t = target();
    if (!t || !t[name] || !app.doc) return;
    try {
      t[name](e);
    } catch (err) {
      console.error(err);
    }
    view.odirty = true;
  };

  stage.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.text-edit')) return;
    if (document.activeElement && document.activeElement !== document.body && !ev.target.closest('.text-edit')) document.activeElement.blur();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    try {
      stage.setPointerCapture(ev.pointerId);
    } catch (e) {
      console.warn(e);
    }
    if (pointers.size === 2) {
      if (drag && drag.kind === 'tool') call('cancel', evt(ev, 'cancel'));
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: view.zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag = null;
      return;
    }
    if (!app.doc) return;
    ev.preventDefault();
    const hand = view.space || ev.button === 1 || (app.tool && app.tool.id === 'hand' && !app.modal);
    if (hand) {
      drag = { kind: 'pan', x: ev.clientX, y: ev.clientY };
      stage.style.cursor = 'grabbing';
      return;
    }
    if (ev.button === 2) return;
    drag = { kind: 'tool' };
    call('down', evt(ev, 'down'));
  });
  stage.addEventListener('pointermove', (ev) => {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const r = stage.getBoundingClientRect();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      view.px += mx - pinch.cx;
      view.py += my - pinch.cy;
      pinch.cx = mx;
      pinch.cy = my;
      setZoom(pinch.z * (dist / pinch.d), mx - r.left, my - r.top);
      return;
    }
    const e = evt(ev, 'move');
    view.pointer = { x: e.x, y: e.y, sx: e.sx, sy: e.sy, inside: true };
    emit('pointer', view.pointer);
    if (drag && drag.kind === 'pan') {
      panBy(ev.clientX - drag.x, ev.clientY - drag.y);
      drag.x = ev.clientX;
      drag.y = ev.clientY;
      return;
    }
    if (drag && drag.kind === 'tool') {
      const list = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
      if (list.length > 1 && target() && target().coalesce) {
        for (const c of list) call('move', evt(c, 'move'));
      } else call('move', e);
    } else {
      call('hover', e);
      view.odirty = true;
    }
  });
  const up = (ev) => {
    pointers.delete(ev.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      return;
    }
    if (drag && drag.kind === 'pan') stage.style.cursor = view.cursor || '';
    else if (drag && drag.kind === 'tool') call(ev.type === 'pointercancel' ? 'cancel' : 'up', evt(ev, 'up'));
    drag = null;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('pointerleave', () => {
    view.pointer.inside = false;
    view.odirty = true;
  });
  stage.addEventListener('dblclick', (ev) => call('dbl', evt(ev, 'dbl')));
  stage.addEventListener('contextmenu', (ev) => ev.preventDefault());
  stage.addEventListener('wheel', (ev) => {
    if (!app.doc) return;
    ev.preventDefault();
    const r = stage.getBoundingClientRect();
    if (ev.ctrlKey || ev.metaKey || ev.altKey) {
      const f = Math.exp(-ev.deltaY * (ev.deltaMode ? 0.05 : 0.0022));
      setZoom(view.zoom * f, ev.clientX - r.left, ev.clientY - r.top);
    } else if (ev.shiftKey) panBy(-ev.deltaY - ev.deltaX, 0);
    else panBy(-ev.deltaX, -ev.deltaY);
  }, { passive: false });

  on('doc', invalidate);
  on('sel', overlay);
  on('docs', () => {
    invalidate();
  });
}

export function setCursor(c) {
  view.cursor = c;
  if (view.stage) view.stage.style.cursor = c || '';
}
