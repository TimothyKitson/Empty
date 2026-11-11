import { zipSync, unzipSync, strToU8, strFromU8 } from '../vendor/fflate.js';
import { mk, cx, clone, download, loadImage, toBlob, emit } from './util.js';
import { Doc, Layer, flatten, renderText } from './doc.js';
import { app } from './view.js';
import { addDoc, docFromCanvas, busy } from './docs.js';
import { loadFont } from './tools.js';

const toast = (m) => emit('toast', m);
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
const stem = (n) => String(n || 'Untitled').replace(/\.[a-z0-9]+$/i, '');

let crcTable = null;
function crc32(buf, start, end) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function setPngDpi(bytes, dpi) {
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50) return bytes;
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const v = new DataView(chunk.buffer);
  v.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4);
  v.setUint32(8, ppm);
  v.setUint32(12, ppm);
  chunk[16] = 1;
  v.setUint32(17, crc32(chunk, 4, 17));
  const out = new Uint8Array(bytes.length + 21);
  out.set(bytes.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(bytes.subarray(33), 54);
  return out;
}

export function setJpegDpi(bytes, dpi) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[3] === 0xe0 && bytes[6] === 0x4a && bytes[7] === 0x46) {
    bytes[13] = 1;
    bytes[14] = (dpi >> 8) & 255;
    bytes[15] = dpi & 255;
    bytes[16] = (dpi >> 8) & 255;
    bytes[17] = dpi & 255;
  }
  return bytes;
}

function buildPdf(jpeg, w, hh, dpi) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let size = 0;
  const push = (x) => {
    const b = typeof x === 'string' ? enc.encode(x) : x;
    parts.push(b);
    size += b.length;
  };
  const obj = (n, body) => {
    offsets[n] = size;
    push(n + ' 0 obj\n' + body + '\nendobj\n');
  };
  const W = ((w / dpi) * 72).toFixed(2);
  const H = ((hh / dpi) * 72).toFixed(2);
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>');
  offsets[4] = size;
  push('4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + hh + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpeg.length + ' >>\nstream\n');
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = 'q ' + W + ' 0 0 ' + H + ' 0 0 cm /Im0 Do Q';
  obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  const xref = size;
  let table = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(table + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export async function exportImage(d, o) {
  await busy('Exporting', async () => {
    let c = flatten(d);
    const scale = (o.scale || 100) / 100;
    if (scale !== 1) {
      const s = mk(c.width * scale, c.height * scale);
      const g = cx(s);
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, 0, 0, s.width, s.height);
      c = s;
    }
    const dpi = Math.round(d.dpi * scale) || d.dpi;
    const name = stem(o.name || d.name);
    if (o.type === 'pdf' || o.type === 'jpg') {
      const f = mk(c.width, c.height);
      const g = cx(f);
      g.fillStyle = '#fff';
      g.fillRect(0, 0, f.width, f.height);
      g.drawImage(c, 0, 0);
      const jpg = setJpegDpi(await bytesOf(await toBlob(f, 'image/jpeg', (o.quality || 92) / 100)), d.dpi);
      if (o.type === 'pdf') download(new Blob([buildPdf(jpg, f.width, f.height, d.dpi)], { type: 'application/pdf' }), name + '.pdf');
      else download(new Blob([jpg], { type: 'image/jpeg' }), name + '.jpg');
    } else if (o.type === 'webp') {
      download(await toBlob(c, 'image/webp', (o.quality || 92) / 100), name + '.webp');
    } else {
      const png = setPngDpi(await bytesOf(await toBlob(c, 'image/png')), dpi);
      download(new Blob([png], { type: 'image/png' }), name + '.png');
    }
  });
  toast('Exported ' + o.type.toUpperCase());
}

export async function saveProject(d) {
  await busy('Saving', async () => {
    const files = {};
    const layers = [];
    let n = 0;
    for (const l of d.layers) {
      const e = {
        id: l.id, name: l.name, type: l.type, visible: l.visible, opacity: l.opacity, blend: l.blend, x: l.x, y: l.y,
        clip: l.clip, lock: l.lock, text: l.text, fx: l.fx, adj: l.adj
      };
      if (l.type !== 'adjust') {
        e.file = 'layer' + n + '.png';
        files[e.file] = await bytesOf(await toBlob(l.canvas));
      }
      if (l.mask) {
        e.mask = { x: l.mask.x, y: l.mask.y, on: l.mask.on, file: 'mask' + n + '.png' };
        files[e.mask.file] = await bytesOf(await toBlob(l.mask.canvas));
      }
      layers.push(e);
      n++;
    }
    files['document.json'] = strToU8(JSON.stringify({ app: 'umber', version: 1, name: d.name, w: d.w, h: d.h, dpi: d.dpi, active: d.active, guides: d.guides, layers }));
    files['preview.png'] = await bytesOf(await toBlob(flatten(d)));
    const zip = zipSync(files, { level: 0 });
    download(new Blob([zip], { type: 'application/zip' }), stem(d.name) + '.umber');
    d.dirty = false;
    emit('docs');
  });
  toast('Project saved. Open the .umber file later to keep editing with layers.');
}

async function loadProject(bytes, name) {
  const files = unzipSync(bytes);
  if (!files['document.json']) throw new Error('This file is not an Umber project.');
  const m = JSON.parse(strFromU8(files['document.json']));
  const d = new Doc(m.w, m.h, m.dpi, stem(name || m.name));
  d.guides = m.guides || [];
  for (const e of m.layers) {
    const l = new Layer({ ...e, mask: null });
    if (e.file && files[e.file]) l.canvas = await loadImage(new Blob([files[e.file]], { type: 'image/png' }));
    if (e.mask && files[e.mask.file]) l.mask = { x: e.mask.x, y: e.mask.y, on: e.mask.on, canvas: await loadImage(new Blob([files[e.mask.file]], { type: 'image/png' })) };
    d.layers.push(l);
    if (l.type === 'text') loadFont(l.text.font);
  }
  d.active = d.layers.some((l) => l.id === m.active) ? m.active : d.layers.length ? d.layers[d.layers.length - 1].id : null;
  addDoc(d);
}

async function agPsd() {
  if (window.agPsd) return window.agPsd;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    const el = document.querySelector('script[data-lib="ag-psd"]');
    if (el) {
      const bin = atob(el.textContent.trim());
      const u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      s.src = URL.createObjectURL(new Blob([u], { type: 'text/javascript' }));
    } else s.src = 'vendor/ag-psd.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('The PSD library could not be loaded.'));
    document.head.append(s);
  });
  return window.agPsd;
}
const PSD_BLEND = { 'color-burn': 'color burn', 'color-dodge': 'color dodge', lighter: 'linear dodge', 'soft-light': 'soft light', 'hard-light': 'hard light' };
const BLEND_PSD = Object.fromEntries(Object.entries(PSD_BLEND).map(([a, b]) => [b, a]));
const KNOWN = new Set(['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'color-dodge', 'lighter', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);

export async function exportPsd(d) {
  await busy('Writing PSD', async () => {
    const lib = await agPsd();
    const children = d.layers.filter((l) => l.type !== 'adjust').map((l) => {
      let c = l.canvas;
      let x = l.x;
      let y = l.y;
      if (l.mask && l.mask.on) {
        c = clone(l.canvas);
        const g = cx(c);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(l.mask.canvas, l.mask.x - l.x, l.mask.y - l.y);
      }
      return { name: l.name, left: x, top: y, canvas: c, opacity: l.opacity, hidden: !l.visible, clipping: l.clip, blendMode: PSD_BLEND[l.blend] || l.blend };
    });
    const buf = lib.writePsd({ width: d.w, height: d.h, children, canvas: flatten(d), imageResources: { resolutionInfo: { horizontalResolution: d.dpi, horizontalResolutionUnit: 'PPI', widthUnit: 'Inches', verticalResolution: d.dpi, verticalResolutionUnit: 'PPI', heightUnit: 'Inches' } } });
    download(new Blob([buf], { type: 'application/octet-stream' }), stem(d.name) + '.psd');
  });
  toast('PSD exported. Type and adjustment layers are saved as pixels.');
}

async function importPsd(buf, name) {
  const lib = await agPsd();
  const psd = lib.readPsd(buf);
  const res = psd.imageResources && psd.imageResources.resolutionInfo;
  const d = new Doc(psd.width, psd.height, res ? Math.round(res.horizontalResolution) : 300, stem(name));
  const walk = (list, hidden) => {
    for (const n of list || []) {
      if (n.children) {
        walk(n.children, hidden || n.hidden);
        continue;
      }
      if (!n.canvas) continue;
      const b = BLEND_PSD[n.blendMode] || n.blendMode || 'normal';
      d.layers.push(new Layer({ name: n.name || 'Layer', canvas: n.canvas, x: n.left || 0, y: n.top || 0, opacity: n.opacity == null ? 1 : n.opacity, visible: !(hidden || n.hidden), clip: !!n.clipping, blend: KNOWN.has(b) ? b : 'normal' }));
    }
  };
  walk(psd.children, false);
  if (!d.layers.length && psd.canvas) d.layers.push(new Layer({ name: 'Background', canvas: psd.canvas }));
  if (!d.layers.length) throw new Error('This PSD has no readable layers.');
  d.active = d.layers[d.layers.length - 1].id;
  addDoc(d);
}

export function placeCanvas(c, name) {
  const d = app.doc;
  if (!d) return docFromCanvas(c, stem(name));
  let w = c.width;
  let hh = c.height;
  const k = Math.min(1, d.w / w, d.h / hh);
  if (k < 1) {
    w = Math.round(w * k);
    hh = Math.round(hh * k);
    const s = mk(w, hh);
    const g = cx(s);
    g.imageSmoothingQuality = 'high';
    g.drawImage(c, 0, 0, w, hh);
    c = s;
  }
  d.act('Place', () => d.add(new Layer({ name: stem(name) || d.newName(), canvas: c, x: Math.round((d.w - w) / 2), y: Math.round((d.h - hh) / 2) })));
  emit('layers');
  return d;
}

export async function openFiles(files, asLayer) {
  for (const f of files) {
    try {
      await busy('Opening ' + f.name, async () => {
        const head = new Uint8Array(await f.slice(0, 8).arrayBuffer());
        const isZip = head[0] === 0x50 && head[1] === 0x4b;
        const isPsd = head[0] === 0x38 && head[1] === 0x42 && head[2] === 0x50 && head[3] === 0x53;
        if (isZip || /\.umber$/i.test(f.name)) await loadProject(new Uint8Array(await f.arrayBuffer()), f.name);
        else if (isPsd) await importPsd(await f.arrayBuffer(), f.name);
        else {
          const c = await loadImage(f);
          if (asLayer && app.doc) placeCanvas(c, f.name);
          else docFromCanvas(c, stem(f.name), 300);
        }
      });
    } catch (e) {
      console.error(e);
      toast('Could not open ' + f.name + '. ' + (e.message || ''));
    }
  }
}

export function printDoc(d) {
  const c = flatten(d);
  c.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.append(frame);
    const w = (d.w / d.dpi).toFixed(3);
    const hh = (d.h / d.dpi).toFixed(3);
    const fd = frame.contentDocument;
    fd.open();
    fd.write('<!doctype html><html><head><style>@page{size:' + w + 'in ' + hh + 'in;margin:0}html,body{margin:0}img{width:' + w + 'in;height:' + hh + 'in;display:block}</style></head><body></body></html>');
    fd.close();
    const img = fd.createElement('img');
    img.onload = () => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60000);
    };
    img.src = url;
    fd.body.append(img);
  }, 'image/png');
}

export function initIO(onPaste) {
  window.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) ev.preventDefault();
  });
  window.addEventListener('drop', (ev) => {
    if (!ev.dataTransfer || !ev.dataTransfer.files.length) return;
    ev.preventDefault();
    openFiles([...ev.dataTransfer.files], !!app.doc && ev.dataTransfer.files.length === 1 && /^image\//.test(ev.dataTransfer.files[0].type));
  });
  window.addEventListener('paste', (ev) => {
    const t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const files = ev.clipboardData ? [...ev.clipboardData.files].filter((f) => /^image\//.test(f.type)) : [];
    ev.preventDefault();
    onPaste(files[0] || null);
  });
}

export async function autosave() {
  return null;
}
export { renderText };
