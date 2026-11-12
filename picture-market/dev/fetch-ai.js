const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'site', 'ai');
const ORT_DIST = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const RUNTIME = ['ort.wasm.bundle.min.mjs', 'ort-wasm-simd-threaded.wasm'];
const MODEL = 'migan_pipeline_v2.onnx';
const MODEL_BYTES = 28079181;
const MODEL_URL = 'https://huggingface.co/andraniksargsyan/migan/resolve/main/migan_pipeline_v2.onnx';
const FILES = [...RUNTIME, MODEL];

const sizeOf = (f) => (fs.existsSync(f) ? fs.statSync(f).size : -1);

function agent() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (!proxy) return undefined;
  const p = new URL(proxy);
  const http = require('http');
  const tls = require('tls');
  const a = new https.Agent({ keepAlive: false });
  a.createConnection = (opts, done) => {
    const req = http.request({ host: p.hostname, port: p.port, method: 'CONNECT', path: opts.host + ':' + (opts.port || 443) });
    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        done(new Error('proxy answered ' + res.statusCode));
        return;
      }
      done(null, tls.connect({ socket, servername: opts.servername || opts.host }));
    });
    req.on('error', done);
    req.end();
  };
  return a;
}

function download(url, file, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) {
      reject(new Error('too many redirects'));
      return;
    }
    https.get(url, { agent: agent(), headers: { 'User-Agent': 'node' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        download(new URL(res.headers.location, url).href, file, hops + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('download answered ' + res.statusCode));
        return;
      }
      const tmp = file + '.part';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        fs.renameSync(tmp, file);
        resolve();
      });
      out.on('error', reject);
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function fetchAi(log = () => {}) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of RUNTIME) {
    const src = path.join(ORT_DIST, f);
    const dst = path.join(OUT, f);
    if (!fs.existsSync(src)) throw new Error('missing ' + src + ' — run npm install first');
    if (sizeOf(dst) !== sizeOf(src)) {
      fs.copyFileSync(src, dst);
      log('copied ' + f);
    }
  }
  const model = path.join(OUT, MODEL);
  if (sizeOf(model) !== MODEL_BYTES) {
    const local = process.env.PM_AI_MODEL;
    if (local && sizeOf(local) === MODEL_BYTES) {
      fs.copyFileSync(local, model);
      log('copied ' + MODEL);
    } else {
      log('downloading ' + MODEL);
      await download(MODEL_URL, model);
    }
  }
  if (sizeOf(model) !== MODEL_BYTES) {
    fs.rmSync(model, { force: true });
    throw new Error(MODEL + ' is not ' + MODEL_BYTES + ' bytes');
  }
  return FILES.map((f) => ({ name: f, file: path.join(OUT, f), size: sizeOf(path.join(OUT, f)) }));
}

module.exports = { fetchAi, OUT, FILES, MODEL, MODEL_BYTES };

if (require.main === module) {
  fetchAi((m) => console.log(m)).then((list) => {
    for (const e of list) console.log('site/ai/' + e.name + ' ' + (e.size / 1048576).toFixed(1) + ' MB');
  }).catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
