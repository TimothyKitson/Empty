const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8'
};

function serve(root, port = 0) {
  const base = path.resolve(root);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = '/';
      try {
        rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      } catch (e) {
        rel = '/';
      }
      if (rel.endsWith('/')) rel += 'index.html';
      const file = path.join(base, path.normalize(rel));
      if (file !== base && !file.startsWith(base + path.sep)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      fs.readFile(file, (err, data) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('not found');
          return;
        }
        res.writeHead(200, {
          'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-store'
        });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        url: 'http://127.0.0.1:' + actual + '/',
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        })
      });
    });
  });
}

module.exports = { serve };

if (require.main === module) {
  const root = path.resolve(__dirname, '..', process.argv[2] || '');
  serve(root, Number(process.env.PORT || 8080)).then((s) => {
    console.log('serving ' + root + ' at ' + s.url + ' (app: ' + s.url + 'site/index.html)');
  });
}
