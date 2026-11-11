const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');
const DIST = path.join(ROOT, 'dist');

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = zlib.deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

async function build() {
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
  const result = await esbuild.build({
    entryPoints: [path.join(SITE, 'js', 'main.js')],
    bundle: true,
    format: 'esm',
    minify: true,
    write: false,
    target: ['es2022'],
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'warning'
  });
  const js = result.outputFiles[0].text;
  if (/<\/script/i.test(js) || js.includes('<!--')) throw new Error('bundle contains a sequence that would break an inline script');

  let out = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (m, href) => '<style>\n' + fs.readFileSync(path.join(SITE, href), 'utf8') + '\n</style>');
  out = out.replace(/<link rel="icon" href="([^"]+)"([^>]*)>/, (m, href, rest) => {
    const file = path.join(SITE, href);
    if (!fs.existsSync(file)) return '';
    return '<link rel="icon" href="data:image/svg+xml;base64,' + fs.readFileSync(file).toString('base64') + '"' + rest + '>';
  });
  const libs = fs.readdirSync(path.join(SITE, 'vendor')).filter((f) => f.endsWith('.min.js'));
  const blobs = libs.map((f) => '<script type="text/plain" data-lib="' + f.replace(/\.min\.js$/, '') + '">' + fs.readFileSync(path.join(SITE, 'vendor', f)).toString('base64') + '</script>').join('\n');
  const tag = '<script type="module" src="js/main.js"></script>';
  if (!out.includes(tag)) throw new Error('index.html is missing ' + tag);
  out = out.replace(tag, () => blobs + '\n<script type="module">\n' + js + '\n</script>');
  if (/<(link|script)[^>]*(href|src)="(css|js|vendor)\//.test(out)) throw new Error('unresolved local reference left in the single-file build');

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(path.join(DIST, 'umber.html'), out);
  const licenses = fs.readFileSync(path.join(SITE, 'vendor', 'LICENSES.txt'));
  fs.writeFileSync(path.join(DIST, 'umber-netlify.zip'), zip([
    { name: 'index.html', data: Buffer.from(out, 'utf8') },
    { name: 'LICENSES.txt', data: licenses }
  ]));
  const size = (f) => (fs.statSync(path.join(DIST, f)).size / 1024).toFixed(0) + ' KB';
  console.log('dist/umber.html ' + size('umber.html'));
  console.log('dist/umber-netlify.zip ' + size('umber-netlify.zip'));
}

build().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
