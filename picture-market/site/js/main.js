import { on, emit, isMac } from './util.js';
import { render, renderText, flatten, sample, Layer } from './doc.js';
import { app, view, initView, invalidate, overlay, setCursor, toScreen } from './view.js';
import { initTools, setTool, TOOLS, endModal, loadFont } from './tools.js';
import { buildUI } from './ui.js';
import { run, MENUS, KEYS, KEYFN, pasteExternal } from './cmds.js';
import { initIO, autosave, pendingAutosaves, restoreAutosaves, clearAutosaves, dropAutosave } from './io.js';
import { dialog } from './ui.js';
import { h } from './util.js';
import { PRESETS, newDoc } from './docs.js';
import { ai, aiFill, planFill, resetAi } from './ai.js';

function combo(ev) {
  let key = ev.key;
  const code = ev.code || '';
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (code === 'Equal') key = '=';
  else if (code === 'Minus') key = '-';
  else if (code === 'BracketLeft') key = '[';
  else if (code === 'BracketRight') key = ']';
  return (ev.altKey ? 'Alt+' : '') + (ev.shiftKey ? 'Shift+' : '') + (ev.ctrlKey || ev.metaKey ? 'Ctrl+' : '') + key;
}

function keyText(k) {
  if (!isMac) return k;
  return k.replace('Ctrl+', '⌘').replace('Alt+', '⌥').replace('Shift+', '⇧');
}

function editing(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function onKeyDown(ev) {
  if (editing(ev.target) || document.querySelector('.backdrop')) return;
  if (ev.code === 'Space') {
    ev.preventDefault();
    if (!ev.repeat) {
      view.space = true;
      view.stage.style.cursor = 'grab';
    }
    return;
  }
  const m = app.modal;
  if (m) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      endModal(true);
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      endModal(false);
      return;
    }
    if (m.key && m.key(ev)) {
      ev.preventDefault();
      return;
    }
  }
  const tool = app.tool;
  if (!m && tool && tool.key && app.doc && tool.key(ev)) {
    ev.preventDefault();
    overlay();
    return;
  }
  const k = combo(ev);
  if (k === 'Ctrl+V') return;
  if (ev.key === 'Escape' && app.doc && app.doc.sel && false) return;
  const cmd = KEYS[k];
  if (cmd) {
    ev.preventDefault();
    run(cmd);
    return;
  }
  if (KEYFN[k]) {
    ev.preventDefault();
    KEYFN[k]();
    return;
  }
  if (!ev.ctrlKey && !ev.metaKey && !ev.altKey && /^Key[A-Z]$/.test(ev.code || '')) {
    const letter = ev.code.slice(3);
    const list = TOOLS.filter((x) => x.k === letter);
    if (list.length) {
      ev.preventDefault();
      setTool(list[(list.indexOf(app.tool) + 1) % list.length].id);
    }
  }
}

function boot() {
  const root = document.getElementById('app');
  initTools();
  const els = buildUI(root, { run, menus: MENUS, keyText, presets: PRESETS });
  initView(els.stage);
  initIO(pasteExternal);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', (ev) => {
    if (ev.code === 'Space') {
      view.space = false;
      view.stage.style.cursor = view.cursor || '';
    }
  });
  window.addEventListener('blur', () => {
    view.space = false;
  });
  window.addEventListener('beforeunload', (ev) => {
    if (app.docs.some((d) => d.dirty) && !app.isTest) {
      ev.preventDefault();
      ev.returnValue = '';
    }
  });
  on('cmd', (name) => run(name));
  on('fit', () => run('fit'));
  on('view', () => {
    if (app.modal && app.modal.place) app.modal.place();
  });
  on('textopt', ({ key, value }) => {
    if (key === 'font') loadFont(value);
    const m = app.modal;
    if (m && m.id === 'text') {
      m.apply(key, value);
      return;
    }
    const d = app.doc;
    const l = d && d.al;
    if (!l || l.type !== 'text') return;
    d.act('Type Change', () => {
      const t = l.text;
      if (key === 'size') t.size = Math.round((value * d.dpi) / 72);
      else if (key === 'color') t.color = { ...value };
      else t[key] = value;
      renderText(l);
    });
    if (key === 'font') {
      loadFont(value).then(() => {
        renderText(l);
        d.touch();
      });
    }
    emit('layers');
  });
  on('layers', () => {
    const d = app.doc;
    const l = d && d.al;
    if (!l || l.type !== 'text' || !app.tool || app.tool.id !== 'text' || app.modal) return;
    const o = app.opts.text;
    const t = l.text;
    const size = Math.round((t.size * 72) / d.dpi);
    if (o.font === t.font && o.size === size && o.bold === !!t.bold && o.italic === !!t.italic && o.align === t.align) return;
    Object.assign(o, { font: t.font, size, bold: !!t.bold, italic: !!t.italic, align: t.align, color: { ...t.color } });
    emit('opts');
  });
  app.isTest = /[?&]test=1/.test(location.search);
  app.api = {
    run, newDoc, setTool, flatten, render, Layer, emit, invalidate, setCursor, view, autosave,
    ai: { state: ai, fill: aiFill, plan: planFill, reset: resetAi },
    pixel: (x, y) => { const c = sample(app.doc, x, y, true); return [c.r, c.g, c.b, c.a]; },
    toClient: (x, y) => { const r = view.stage.getBoundingClientRect(); const p = toScreen(x, y); return { x: r.left + p.x, y: r.top + p.y }; }
  };
  window.app = app;
  app.ready = true;
  on('docclosed', (d) => dropAutosave(d.id));
  if (!app.isTest) {
    setInterval(autosave, 30000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) autosave();
    });
    pendingAutosaves().then(async (list) => {
      if (!list.length) return;
      const names = list.map((e) => e.name + ' (' + new Date(e.time).toLocaleString() + ')').join(', ');
      const ok = await dialog('Recover Work', h('div.note', { text: 'Picture Market kept a copy of work that was not saved: ' + names + '. Open it again?' }), [['Recover', true], ['Discard', null]], { width: 380 });
      if (ok) restoreAutosaves(list);
      else clearAutosaves();
    });
  }
}

boot();
