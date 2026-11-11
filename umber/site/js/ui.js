import { h, on, emit, clamp, hex, parseHex, rgb2hsv, hsv2rgb, mk, cx, rgba, isMac } from './util.js';
import { BLENDS, thumb, maskThumb } from './doc.js';
import { app, view, setZoom, invalidate } from './view.js';
import { TOOLS, setTool, endModal, loadFont } from './tools.js';

const NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  marquee: '~M4 5h16v14H4z',
  ellipse: '~M12 5c5 0 8 3 8 7s-3 7-8 7-8-3-8-7 3-7 8-7z',
  lasso: 'M5 11c0-3 3-6 8-6s7 2 7 5-3 5-7 5c-2 0-4-.4-5-1.2M8 14.5c-1.5.3-2.5 1.2-2.5 2.3 0 1 .8 1.7 1.8 1.7 1.2 0 1.7-1 1.2-2.2',
  polylasso: 'M5 8l8-4 6 6-4 8-8-2zM7 16l-2 4',
  wand: 'M4 20L15 9M17 3v3M21 7h-3M19.6 4.4l-1.4 1.4M13 4l1 1.6M20 11l-1.6-1',
  crop: 'M7 3v14h14M3 7h14v14',
  eyedropper: 'M14 6l4 4M12 8l4 4-8 8H4v-4zM16 4l1-1c1-1 3-1 4 0s1 3 0 4l-1 1',
  brush: 'M4 20c0-3 2-4 4-4s3 1 3 3-2 3-4 3c-1.5 0-3-1-3-2zM10 15L19 4c.8-1 2.2.2 1.4 1.2L12 16',
  pencil: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4',
  eraser: 'M4 15l9-9 7 7-6 6H8zM9 20h11M9 10l6 6',
  stamp: 'M9 4h6v3l-1 4h4v4H6v-4h4L9 7zM5 19h14',
  heal: 'M5 13l8-8a3 3 0 014 4l-8 8a3 3 0 01-4-4zM9.5 8.5l6 6M12 11v2M11 12h2',
  blur: 'M12 3c3 4 6 7 6 11a6 6 0 01-12 0c0-4 3-7 6-11z',
  dodge: 'M12 4a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM12 15v6',
  burn: 'M12 3c1 3 5 5 5 10a5 5 0 01-10 0c0-2 1-3 2-4 .5 1.5 1 2 2 2 0-3 0-5 1-8z',
  gradient: 'M4 5h16v14H4zM8 5v14M11 5v14M15 5v14',
  bucket: 'M5 12l7-7 7 7-6 6a2 2 0 01-2.8 0L5 13zM12 5V3M19 15c1 1.5 1.5 2.3 1.5 3a1.5 1.5 0 01-3 0c0-.7.5-1.5 1.5-3z',
  text: 'M5 7V4h14v3M12 4v16M9 20h6',
  rect: 'M4 6h16v12H4z',
  oval: 'M12 6c4.4 0 8 2.7 8 6s-3.6 6-8 6-8-2.7-8-6 3.6-6 8-6z',
  line: 'M5 19L19 5',
  hand: 'M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v6M17 9.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-2a6 6 0 01-5-3l-3-5a1.5 1.5 0 012.5-1.5L8 13',
  zoom: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM15.5 15.5L20 20M8 10.5h5M10.5 8v5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  mask: 'M4 5h16v14H4zM12 9a3 3 0 100 6 3 3 0 000-6z',
  adjust: 'M12 4a8 8 0 100 16 8 8 0 000-16zM12 4v16M12 8h6.9M12 12h8M12 16h6.9',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z',
  swap: 'M8 4L4 8l4 4M4 8h11a5 5 0 015 5v1',
  check: 'M5 12l5 5 9-10',
  x: 'M6 6l12 12M18 6L6 18',
  clip: 'M8 5v9h8M8 14l-3-3M8 14l3-3',
  dup: 'M8 8h11v11H8zM5 16V5h11',
  fx: 'M5 19c2 0 3-1 3.5-4l1-7c.4-2.4 1.5-3 3-3M6 11h6M13 19l6-8M13 11l6 8',
  menu: 'M4 7h16M4 12h16M4 17h16',
  panel: 'M4 5h16v14H4zM14 5v14'
};
export function icon(name, size = 18) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.6');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  let d = ICONS[name] || 'M5 5h14v14H5z';
  const p = document.createElementNS(NS, 'path');
  if (d[0] === '~') {
    d = d.slice(1);
    p.setAttribute('stroke-dasharray', '3 2.4');
  }
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

const els = {};
let cmdRun = () => {};
let menus = [];
let keyText = (k) => k;

export function toast(msg) {
  const t = h('div.toast', { text: msg });
  els.toasts.append(t);
  setTimeout(() => t.classList.add('out'), 3200);
  setTimeout(() => t.remove(), 3700);
}

let openMenu = null;
function closeMenu() {
  if (openMenu) {
    openMenu.els.forEach((e) => e.remove());
    if (openMenu.title) openMenu.title.classList.remove('open');
    openMenu = null;
  }
}
function menuEl(items, x, y, parent) {
  const box = h('div.menu');
  for (const it of items) {
    if (it === '-') {
      box.append(h('div.sep'));
      continue;
    }
    const enabled = it.on ? it.on() : true;
    const row = h('div.item' + (enabled ? '' : '.off'),
      null,
      h('span.chk', { text: it.check && it.check() ? '✓' : '' }),
      h('span.lbl', { text: it.label }),
      h('span.key', { text: it.sub ? '▸' : it.key ? keyText(it.key) : '' }));
    if (it.sub) {
      let subEl = null;
      row.addEventListener('pointerenter', () => {
        box.querySelectorAll('.item.hot').forEach((e) => e.classList.remove('hot'));
        if (parent.sub) parent.sub.remove();
        const r = row.getBoundingClientRect();
        subEl = menuEl(it.sub, r.right - 2, r.top - 4, {});
        parent.sub = subEl;
        row.classList.add('hot');
        openMenu.els.push(subEl);
      });
    } else {
      row.addEventListener('pointerenter', () => {
        if (parent.sub) {
          parent.sub.remove();
          parent.sub = null;
        }
        box.querySelectorAll('.item.hot').forEach((e) => e.classList.remove('hot'));
      });
      row.addEventListener('click', () => {
        if (!enabled) return;
        closeMenu();
        if (it.run) it.run();
        else if (it.cmd) cmdRun(it.cmd);
      });
    }
    box.append(row);
  }
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  return box;
}
export function popup(items, x, y, title) {
  closeMenu();
  openMenu = { els: [], title };
  const state = {};
  openMenu.els.push(menuEl(items, x, y, state));
  if (title) title.classList.add('open');
}

export function dialog(title, body, buttons = [['OK', true], ['Cancel', null]], opts = {}) {
  return new Promise((resolve) => {
    const back = h('div.backdrop' + (opts.clear ? '.clear' : ''));
    const box = h('div.dialog', { style: opts.width ? { width: opts.width + 'px' } : null });
    const head = h('div.dhead', { text: title });
    const foot = h('div.dfoot');
    const close = (v) => {
      back.remove();
      document.removeEventListener('keydown', key, true);
      resolve(v);
    };
    buttons.forEach(([label, value], i) => foot.append(h('button.btn' + (i === 0 ? '.primary' : ''), { text: label, onclick: () => close(value) })));
    const key = (ev) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        close(null);
      } else if (ev.key === 'Enter' && ev.target.tagName !== 'TEXTAREA' && ev.target.tagName !== 'BUTTON') {
        ev.preventDefault();
        ev.stopPropagation();
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        close(buttons[0][1]);
      }
    };
    document.addEventListener('keydown', key, true);
    box.append(head, h('div.dbody', null, body), foot);
    back.append(box);
    document.body.append(back);
    let drag = null;
    head.addEventListener('pointerdown', (ev) => {
      const r = box.getBoundingClientRect();
      drag = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      head.setPointerCapture(ev.pointerId);
      box.style.position = 'fixed';
      box.style.margin = '0';
      box.style.left = r.left + 'px';
      box.style.top = r.top + 'px';
    });
    head.addEventListener('pointermove', (ev) => {
      if (!drag) return;
      box.style.left = clamp(ev.clientX - drag.x, 0, innerWidth - 80) + 'px';
      box.style.top = clamp(ev.clientY - drag.y, 0, innerHeight - 40) + 'px';
    });
    head.addEventListener('pointerup', () => { drag = null; });
    const first = box.querySelector('input, select');
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 0);
  });
}

export function numField(value, min, max, step, onChange) {
  const input = h('input.num', { type: 'number', value, min, max, step: step || 1 });
  input.addEventListener('change', () => {
    let v = parseFloat(input.value);
    if (Number.isNaN(v)) v = value;
    v = clamp(v, min, max);
    input.value = v;
    onChange(v);
  });
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') input.blur();
  });
  return input;
}

export function form(specs, values, onChange) {
  const box = h('div.form');
  for (const s of specs) {
    if (s.type === 'range') {
      const num = numField(values[s.k], s.min, s.max, s.step, (v) => {
        values[s.k] = v;
        slider.value = v;
        onChange(s.k, v);
      });
      const slider = h('input.slider', { type: 'range', min: s.min, max: s.max, step: s.step || 1, value: values[s.k] });
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        values[s.k] = v;
        num.value = v;
        onChange(s.k, v);
      });
      box.append(h('label.row', null, h('span.lab', { text: s.label }), num, slider));
    } else if (s.type === 'check') {
      const c = h('input', { type: 'checkbox', checked: !!values[s.k] });
      c.addEventListener('change', () => {
        values[s.k] = c.checked;
        onChange(s.k, c.checked);
      });
      box.append(h('label.row.chkrow', null, c, h('span', { text: s.label })));
    } else if (s.type === 'select') {
      const sel = h('select', null, s.options.map(([v, t]) => h('option', { value: v, text: t })));
      sel.value = values[s.k];
      sel.addEventListener('change', () => {
        values[s.k] = sel.value;
        onChange(s.k, sel.value);
      });
      box.append(h('label.row', null, h('span.lab', { text: s.label }), sel));
    } else if (s.type === 'color') {
      const b = h('button.swatchbtn', { style: { background: hex(values[s.k]) } });
      b.addEventListener('click', async () => {
        const c = await pickColor(values[s.k]);
        if (!c) return;
        values[s.k] = c;
        b.style.background = hex(c);
        onChange(s.k, c);
      });
      box.append(h('label.row', null, h('span.lab', { text: s.label }), b));
    } else if (s.type === 'text') {
      const t = h('input.txt', { type: 'text', value: values[s.k] });
      t.addEventListener('input', () => {
        values[s.k] = t.value;
        onChange(s.k, t.value);
      });
      t.addEventListener('keydown', (ev) => ev.stopPropagation());
      box.append(h('label.row', null, h('span.lab', { text: s.label }), t));
    }
  }
  return box;
}

function colorWidget(start, onChange) {
  let hsv = rgb2hsv(start.r, start.g, start.b);
  const sv = h('canvas.sv', { width: 200, height: 140 });
  const hue = h('canvas.hue', { width: 200, height: 14 });
  const hexIn = h('input.txt.hexin', { type: 'text', maxLength: 7 });
  const rIn = numField(start.r, 0, 255, 1, () => fromRgb());
  const gIn = numField(start.g, 0, 255, 1, () => fromRgb());
  const bIn = numField(start.b, 0, 255, 1, () => fromRgb());
  const cur = () => hsv2rgb(hsv.h, hsv.s, hsv.v);
  const paint = () => {
    const g = cx(sv);
    const base = hsv2rgb(hsv.h, 1, 1);
    g.fillStyle = hex(base);
    g.fillRect(0, 0, 200, 140);
    const gw = g.createLinearGradient(0, 0, 200, 0);
    gw.addColorStop(0, '#fff');
    gw.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gw;
    g.fillRect(0, 0, 200, 140);
    const gb = g.createLinearGradient(0, 0, 0, 140);
    gb.addColorStop(0, 'rgba(0,0,0,0)');
    gb.addColorStop(1, '#000');
    g.fillStyle = gb;
    g.fillRect(0, 0, 200, 140);
    const x = hsv.s * 200;
    const y = (1 - hsv.v) * 140;
    g.strokeStyle = hsv.v > 0.5 ? '#000' : '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(x, y, 5, 0, Math.PI * 2);
    g.stroke();
    const hg = cx(hue);
    const gr = hg.createLinearGradient(0, 0, 200, 0);
    for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, hex(hsv2rgb(Math.min(359.9, i * 60), 1, 1)));
    hg.fillStyle = gr;
    hg.fillRect(0, 0, 200, 14);
    hg.fillStyle = '#fff';
    hg.strokeStyle = '#000';
    const hx = (hsv.h / 360) * 200;
    hg.fillRect(hx - 2, 0, 4, 14);
    hg.strokeRect(hx - 2.5, 0.5, 5, 13);
  };
  const fields = () => {
    const c = cur();
    hexIn.value = hex(c);
    rIn.value = c.r;
    gIn.value = c.g;
    bIn.value = c.b;
  };
  const changed = () => {
    paint();
    fields();
    onChange(cur());
  };
  const fromRgb = () => {
    const c = { r: Number(rIn.value) || 0, g: Number(gIn.value) || 0, b: Number(bIn.value) || 0 };
    const keep = hsv.h;
    hsv = rgb2hsv(c.r, c.g, c.b);
    if (hsv.s === 0) hsv.h = keep;
    changed();
  };
  const dragOn = (el, fn) => {
    let down = false;
    const go = (ev) => {
      const r = el.getBoundingClientRect();
      fn(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
      changed();
    };
    el.addEventListener('pointerdown', (ev) => {
      down = true;
      el.setPointerCapture(ev.pointerId);
      go(ev);
    });
    el.addEventListener('pointermove', (ev) => down && go(ev));
    el.addEventListener('pointerup', () => { down = false; });
  };
  dragOn(sv, (x, y) => {
    hsv.s = x;
    hsv.v = 1 - y;
  });
  dragOn(hue, (x) => {
    hsv.h = Math.min(359.9, x * 360);
  });
  hexIn.addEventListener('change', () => {
    const c = parseHex(hexIn.value);
    if (c) {
      hsv = rgb2hsv(c.r, c.g, c.b);
      changed();
    } else fields();
  });
  hexIn.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') hexIn.blur();
  });
  const el = h('div.cw', null, sv, hue, h('div.cfields', null, h('span', { text: '#' }), hexIn, h('span', { text: 'R' }), rIn, h('span', { text: 'G' }), gIn, h('span', { text: 'B' }), bIn));
  paint();
  fields();
  return {
    el,
    set(c) {
      const keep = hsv.h;
      hsv = rgb2hsv(c.r, c.g, c.b);
      if (hsv.s === 0) hsv.h = keep;
      paint();
      fields();
    },
    get: cur
  };
}

export async function pickColor(color, title = 'Color Picker') {
  let c = { ...color };
  const now = h('div.cnow', { style: { background: hex(c) } });
  const w = colorWidget(c, (v) => {
    c = v;
    now.style.background = hex(v);
  });
  const body = h('div.cpick', null, w.el, h('div.ccompare', null, h('span', { text: 'new' }), now, h('div.cnow', { style: { background: hex(color) } }), h('span', { text: 'current' })));
  const ok = await dialog(title, body);
  return ok ? c : null;
}

function buildMenubar() {
  const bar = els.menubar;
  bar.replaceChildren(h('div.brand', null, h('span.mark'), h('span', { text: 'Umber' })));
  const mobile = h('button.mobmenu', { title: 'Menu', onclick: (ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    popup(menus.map((m) => ({ label: m.label, sub: m.items() })), r.left, r.bottom);
    ev.stopPropagation();
  } }, icon('menu'));
  bar.append(mobile);
  for (const m of menus) {
    const t = h('div.mtitle', { text: m.label });
    const open = () => {
      const r = t.getBoundingClientRect();
      popup(m.items(), r.left, r.bottom, t);
    };
    t.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (openMenu && openMenu.title === t) closeMenu();
      else open();
    });
    t.addEventListener('pointerenter', () => {
      if (openMenu && openMenu.title && openMenu.title !== t) open();
    });
    bar.append(t);
  }
  bar.append(h('div.grow'), els.title = h('div.doctitle'), h('button.dockbtn', { title: 'Panels', onclick: () => els.dock.classList.toggle('show') }, icon('panel')));
}

function buildToolbar() {
  const bar = els.toolbar;
  bar.replaceChildren();
  const grid = h('div.tgrid');
  for (const t of TOOLS) {
    const b = h('button.tool', { title: t.name + (t.k ? ' (' + t.k + ')' : ''), data: { id: t.id }, onclick: () => setTool(t.id) }, icon(t.id));
    grid.append(b);
  }
  els.fg = h('button.sw.fg', { title: 'Foreground color', onclick: async () => {
    const c = await pickColor(app.fg, 'Color Picker (Foreground Color)');
    if (c) {
      app.fg = c;
      emit('color');
    }
  } });
  els.bg = h('button.sw.bg', { title: 'Background color', onclick: async () => {
    const c = await pickColor(app.bg, 'Color Picker (Background Color)');
    if (c) {
      app.bg = c;
      emit('color');
    }
  } });
  const sw = h('div.swatches', null, els.bg, els.fg,
    h('button.mini.swap', { title: 'Switch colors (X)', onclick: () => cmdRun('swap') }, icon('swap', 12)),
    h('button.mini.reset', { title: 'Default colors (D)', onclick: () => cmdRun('defaultColors') }));
  bar.append(grid, sw);
}

function optControl(spec, get, set) {
  if (spec.type === 'range') {
    const num = numField(get(), spec.min, spec.max, 1, (v) => {
      set(v);
      slider.value = v;
    });
    const slider = h('input.slider.slim', { type: 'range', min: spec.min, max: spec.max, value: get() });
    slider.addEventListener('input', () => {
      num.value = slider.value;
      set(Number(slider.value));
    });
    return h('label.opt', null, h('span', { text: spec.label }), num, spec.unit ? h('span.unit', { text: spec.unit }) : null, slider);
  }
  if (spec.type === 'check') {
    const c = h('input', { type: 'checkbox', checked: !!get() });
    c.addEventListener('change', () => {
      set(c.checked);
      c.blur();
    });
    return h('label.opt', null, c, h('span', { text: spec.label }));
  }
  if (spec.type === 'select') {
    const s = h('select', null, spec.options.map(([v, t]) => h('option', { value: v, text: t })));
    s.value = get();
    s.addEventListener('change', () => {
      set(s.value);
      s.blur();
    });
    return h('label.opt', null, h('span', { text: spec.label }), s);
  }
  if (spec.type === 'color') {
    const c = get() || app.fg;
    const b = h('button.swatchbtn', { style: { background: hex(c) }, onclick: async () => {
      const v = await pickColor(get() || app.fg);
      if (v) {
        set(v);
        b.style.background = hex(v);
      }
    } });
    return h('label.opt', null, h('span', { text: spec.label }), b);
  }
  if (spec.type === 'btn') return h('button.btn.small', { text: spec.label, onclick: (ev) => { ev.currentTarget.blur(); spec.run(); } });
  return h('span');
}

function buildOptions() {
  const bar = els.optbar;
  bar.replaceChildren();
  const m = app.modal;
  const t = app.tool;
  if (!t) return;
  if (m && m.id === 'transform') {
    bar.append(h('div.oname', null, h('span', { text: 'Free Transform' })));
    m.fields().forEach(([label, value, unit], i) => {
      const num = numField(value, -100000, 100000, 0.1, (v) => m.setField(i, v));
      num.dataset.tf = i;
      bar.append(h('label.opt', null, h('span', { text: label }), num, h('span.unit', { text: unit })));
    });
  } else {
    const tool = m && m.id === 'text' ? TOOLS.find((x) => x.id === 'text') : t;
    bar.append(h('div.oname', null, icon(tool.id, 16), h('span', { text: tool.name })));
    for (const spec of tool.opts || []) {
      const get = () => app.opts[tool.id][spec.k];
      const set = (v) => {
        app.opts[tool.id][spec.k] = v;
        if (tool.id === 'text') emit('textopt', { key: spec.k, value: v });
        emit('optchange');
      };
      bar.append(optControl(spec, get, set));
    }
  }
  if (m) {
    bar.append(h('div.grow'),
      h('button.btn.small', { title: 'Cancel (Esc)', onclick: () => endModal(false) }, icon('x', 14), 'Cancel'),
      h('button.btn.small.primary', { title: 'Commit (Enter)', onclick: () => endModal(true) }, icon('check', 14), 'Done'));
  }
}

function buildTabs() {
  els.tabs.replaceChildren();
  for (const d of app.docs) {
    const tab = h('div.tab' + (d === app.doc ? '.on' : ''), { onclick: () => cmdRun('activate', d) },
      h('span', { text: d.name + (d.dirty ? ' *' : '') }),
      h('button.tclose', { title: 'Close', onclick: (ev) => { ev.stopPropagation(); cmdRun('close', d); } }, icon('x', 11)));
    els.tabs.append(tab);
  }
  els.welcome.hidden = app.docs.length > 0;
  els.title.textContent = app.doc ? app.doc.name : '';
}

function buildStatus() {
  const d = app.doc;
  if (!d) {
    els.status.replaceChildren(h('span', { text: 'No document' }));
    return;
  }
  const zoom = h('input.zoomin', { type: 'text', value: (Math.round(view.zoom * 1000) / 10) + '%' });
  zoom.addEventListener('change', () => {
    const v = parseFloat(zoom.value);
    if (v > 0) setZoom(v / 100);
    zoom.blur();
  });
  zoom.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') zoom.blur();
  });
  const inch = (n) => (Math.round((n / d.dpi) * 100) / 100);
  els.status.replaceChildren(zoom, h('span', { text: d.w + ' × ' + d.h + ' px' }), h('span.dim', { text: inch(d.w) + ' × ' + inch(d.h) + ' in @ ' + d.dpi + ' ppi' }), els.hint = h('span.hint'));
}

let colorW = null;
let colorTarget = 'fg';
const SWATCHES = ['#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7', '#1b2a49', '#8a1c1c', '#c9a227', '#2e5339'];
function buildColorPanel() {
  const body = els.colorBody;
  colorW = colorWidget(app.fg, (c) => {
    if (colorTarget === 'fg') app.fg = c;
    else app.bg = c;
    emit('color', 'panel');
  });
  const tgl = h('div.ctarget', null,
    h('button.on', { text: 'Foreground', onclick: (ev) => setT('fg', ev.currentTarget) }),
    h('button', { text: 'Background', onclick: (ev) => setT('bg', ev.currentTarget) }));
  const setT = (t, btn) => {
    colorTarget = t;
    tgl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
    colorW.set(app[t]);
  };
  const grid = h('div.swgrid', null, SWATCHES.map((s) => h('button', { style: { background: s }, title: s, onclick: () => {
    const c = parseHex(s);
    if (colorTarget === 'fg') app.fg = c;
    else app.bg = c;
    emit('color');
  } })));
  body.append(tgl, colorW.el, grid);
}

let dragLayer = null;
function buildLayers() {
  const d = app.doc;
  const body = els.layersBody;
  body.replaceChildren();
  if (!d) {
    body.append(h('div.empty', { text: 'No document open' }));
    return;
  }
  const l = d.al;
  const blend = h('select.blend', { disabled: !l }, BLENDS.map((b) => (b ? h('option', { value: b[0], text: b[1] }) : h('option', { disabled: true, text: '──────────' }))));
  if (l) blend.value = l.blend;
  blend.addEventListener('change', () => {
    cmdRun('layerProp', { blend: blend.value });
    blend.blur();
  });
  const op = numField(l ? Math.round(l.opacity * 100) : 100, 0, 100, 1, (v) => cmdRun('layerProp', { opacity: v / 100 }));
  op.disabled = !l;
  const opS = h('input.slider.slim', { type: 'range', min: 0, max: 100, value: l ? Math.round(l.opacity * 100) : 100, disabled: !l });
  opS.addEventListener('input', () => {
    op.value = opS.value;
    if (l) {
      l.opacity = opS.value / 100;
      d.touch();
    }
  });
  opS.addEventListener('pointerdown', () => { opS.dataset.start = l ? l.opacity : 1; });
  opS.addEventListener('change', () => {
    if (!l) return;
    const v = opS.value / 100;
    l.opacity = Number(opS.dataset.start);
    cmdRun('layerProp', { opacity: v });
  });
  const lock = h('button.lbtn' + (l && l.lock ? '.on' : ''), { title: 'Lock layer', disabled: !l, onclick: () => cmdRun('layerProp', { lock: !l.lock }) }, icon('lock', 14));
  body.append(h('div.lhead', null, blend, h('span.dim', { text: 'Opacity' }), op, h('span.dim', { text: '%' })), h('div.lhead', null, h('span.dim', { text: 'Lock' }), lock, opS));
  const list = h('div.llist');
  for (let i = d.layers.length - 1; i >= 0; i--) {
    const ly = d.layers[i];
    const row = h('div.lrow' + (ly.id === d.active ? '.on' : ''), { draggable: true, data: { id: ly.id } });
    const eye = h('button.eye' + (ly.visible ? '.on' : ''), { title: 'Show/hide layer', onclick: (ev) => {
      ev.stopPropagation();
      cmdRun('layerVis', ly);
    } }, ly.visible ? icon('eye', 15) : null);
    const th = h('div.thumb' + (ly.id === d.active && d.target === 'layer' ? '.sel' : ''));
    if (ly.type === 'adjust') th.append(icon('adjust', 20));
    else if (ly.type === 'text') th.append(h('span.tT', { text: 'T' }));
    else {
      const c = thumb(d, ly, 36);
      th.append(c);
    }
    th.addEventListener('click', () => {
      d.target = 'layer';
    });
    row.append(eye);
    if (ly.clip) row.append(h('span.clipmark', null, icon('clip', 12)));
    row.append(th);
    if (ly.mask) {
      const mt = h('div.thumb.maskthumb' + (ly.id === d.active && d.target === 'mask' ? '.sel' : '') + (ly.mask.on ? '' : '.offm'), { title: 'Layer mask (click to paint on it, Shift-click to disable)' }, maskThumb(d, ly, 36));
      mt.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (ev.shiftKey) {
          cmdRun('maskToggle', ly);
          return;
        }
        d.active = ly.id;
        d.target = 'mask';
        emit('layers');
      });
      row.append(mt);
    }
    const name = h('span.lname', { text: ly.name });
    name.addEventListener('dblclick', (ev) => {
      ev.stopPropagation();
      cmdRun('rename', ly);
    });
    row.append(name);
    if (ly.fx) row.append(h('span.badge', { text: 'fx', title: 'Layer style', onclick: (ev) => { ev.stopPropagation(); d.active = ly.id; cmdRun('layerStyle'); } }));
    if (ly.lock) row.append(icon('lock', 12));
    row.addEventListener('click', () => {
      if (app.modal) endModal(true);
      const was = d.active;
      d.active = ly.id;
      if (was !== ly.id) d.target = 'layer';
      emit('layers');
    });
    row.addEventListener('dblclick', () => cmdRun('layerDbl', ly));
    row.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      d.active = ly.id;
      emit('layers');
      popup(menus.find((m) => m.id === 'layer').items(), ev.clientX, ev.clientY);
    });
    row.addEventListener('dragstart', (ev) => {
      dragLayer = ly;
      ev.dataTransfer.effectAllowed = 'move';
      try {
        ev.dataTransfer.setData('text/plain', ly.id);
      } catch (e) {
        console.warn(e);
      }
    });
    row.addEventListener('dragover', (ev) => {
      if (!dragLayer || dragLayer === ly) return;
      ev.preventDefault();
      const r = row.getBoundingClientRect();
      const top = ev.clientY < r.top + r.height / 2;
      row.classList.toggle('dtop', top);
      row.classList.toggle('dbot', !top);
    });
    row.addEventListener('dragleave', () => row.classList.remove('dtop', 'dbot'));
    row.addEventListener('drop', (ev) => {
      ev.preventDefault();
      const r = row.getBoundingClientRect();
      const top = ev.clientY < r.top + r.height / 2;
      row.classList.remove('dtop', 'dbot');
      if (dragLayer && dragLayer !== ly) cmdRun('reorder', { layer: dragLayer, target: ly, above: top });
      dragLayer = null;
    });
    list.append(row);
  }
  body.append(list);
  body.append(h('div.lfoot', null,
    h('button.lbtn', { title: 'Layer style (stroke, shadow)', onclick: () => cmdRun('layerStyle') }, icon('fx', 16)),
    h('button.lbtn', { title: 'Add layer mask', onclick: () => cmdRun('addMask') }, icon('mask', 16)),
    h('button.lbtn', { title: 'New adjustment layer', onclick: (ev) => {
      const r = ev.currentTarget.getBoundingClientRect();
      popup(menus.find((m) => m.id === 'layer').adjustItems(), r.left, r.top - 8);
      ev.stopPropagation();
    } }, icon('adjust', 16)),
    h('button.lbtn', { title: 'Duplicate layer', onclick: () => cmdRun('dupLayer') }, icon('dup', 16)),
    h('button.lbtn', { title: 'New layer', onclick: () => cmdRun('newLayer') }, icon('plus', 16)),
    h('button.lbtn', { title: 'Delete layer', onclick: () => cmdRun('delLayer') }, icon('trash', 16))));
}

function buildHistory() {
  const d = app.doc;
  const body = els.histBody;
  body.replaceChildren();
  if (!d) return;
  body.append(h('div.hrow' + (d.hi === -1 ? '.on' : ''), { text: 'Open', onclick: () => d.goto(-1) }));
  d.hist.forEach((e, i) => {
    body.append(h('div.hrow' + (i === d.hi ? '.on' : i > d.hi ? '.future' : ''), { text: e.name, onclick: () => d.goto(i) }));
  });
  const on = body.querySelector('.on');
  if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
}

let layerTimer = 0;
function layersSoon() {
  clearTimeout(layerTimer);
  layerTimer = setTimeout(buildLayers, 180);
}

export function buildUI(root, opts) {
  cmdRun = opts.run;
  menus = opts.menus;
  keyText = opts.keyText;
  els.menubar = h('div.menubar');
  els.optbar = h('div.optbar');
  els.toolbar = h('div.toolbar');
  els.tabs = h('div.tabs');
  els.stage = h('div.stage');
  els.welcome = h('div.welcome');
  els.status = h('div.status');
  els.colorBody = h('div.pbody');
  els.layersBody = h('div.pbody.layers');
  els.histBody = h('div.pbody.hist');
  els.toasts = h('div.toasts');
  const tabBtn = (label, show, hide, on) => {
    const b = h('button.ptab' + (on ? '.on' : ''), { text: label });
    b.addEventListener('click', () => {
      b.parentNode.querySelectorAll('.ptab').forEach((x) => x.classList.toggle('on', x === b));
      show.hidden = false;
      hide.hidden = true;
    });
    return b;
  };
  els.histBody.hidden = true;
  els.dock = h('div.dock', null,
    h('div.panel.pcolor', null, h('div.phead', null, h('span.ptab.on', { text: 'Color' })), els.colorBody),
    h('div.panel.players', null, h('div.phead', null, tabBtn('Layers', els.layersBody, els.histBody, true), tabBtn('History', els.histBody, els.layersBody, false)), els.layersBody, els.histBody));
  root.replaceChildren(els.menubar, els.optbar,
    h('div.main', null, els.toolbar, h('div.center', null, els.tabs, h('div.stagewrap', null, els.stage, els.welcome), els.status), els.dock), els.toasts);
  buildMenubar();
  buildToolbar();
  buildColorPanel();
  buildWelcome(opts);
  document.addEventListener('pointerdown', (ev) => {
    if (openMenu && !ev.target.closest('.menu')) closeMenu();
  });
  window.addEventListener('blur', closeMenu);

  const syncTool = () => {
    els.toolbar.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', app.tool && b.dataset.id === app.tool.id));
    buildOptions();
  };
  const syncColor = (src) => {
    els.fg.style.background = hex(app.fg);
    els.bg.style.background = hex(app.bg);
    if (src !== 'panel' && colorW) colorW.set(app[colorTarget]);
  };
  on('tool', syncTool);
  on('modal', buildOptions);
  on('opts', buildOptions);
  on('modalopts', () => {
    const m = app.modal;
    if (!m || m.id !== 'transform') return;
    m.fields().forEach(([, value], i) => {
      const el = els.optbar.querySelector('[data-tf="' + i + '"]');
      if (el && document.activeElement !== el) el.value = value;
    });
  });
  on('color', syncColor);
  on('docs', () => {
    buildTabs();
    buildStatus();
    buildLayers();
    buildHistory();
  });
  on('layers', () => {
    buildLayers();
    invalidate();
  });
  on('doc', (e) => {
    if (e && e.what === 'all') buildLayers();
    else layersSoon();
    if (e && e.doc && els.tabs.dataset.dirty !== String(e.doc.dirty)) {
      els.tabs.dataset.dirty = String(e.doc.dirty);
      buildTabs();
    }
  });
  on('hist', () => {
    buildHistory();
    buildTabs();
  });
  on('view', buildStatus);
  on('toast', toast);
  on('hint', (t) => {
    if (els.hint) els.hint.textContent = t || '';
  });
  syncTool();
  syncColor();
  buildTabs();
  buildStatus();
  buildLayers();
  return els;
}

function buildWelcome(opts) {
  const presets = opts.presets;
  els.welcome.append(h('div.wbox', null,
    h('div.wtitle', null, h('span.mark.big'), h('span', { text: 'Umber' })),
    h('div.wsub', { text: 'Photo editor with layers, selections, type and print-ready export.' }),
    h('div.wbtns', null,
      h('button.btn.primary.big', { text: 'New Document…', onclick: () => cmdRun('new') }),
      h('button.btn.big', { text: 'Open…', onclick: () => cmdRun('open') })),
    h('div.wlabel', { text: 'Start from a size' }),
    h('div.wpresets', null, presets.map((p) => h('button.preset', { onclick: () => cmdRun('newPreset', p) }, h('b', { text: p.name }), h('span', { text: p.w + ' × ' + p.h + ' px · ' + p.dpi + ' ppi' })))),
    h('div.wtip', { text: 'Tip: drop photos anywhere on this window to open them.' })));
}

export { els, closeMenu, rgba, mk, loadFont };
