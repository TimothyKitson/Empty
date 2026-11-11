const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const dir = path.join(__dirname, 'tests');
const filter = process.argv[2] || '';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js') && f.includes(filter)).sort();
const limit = Number(process.env.UMBER_JOBS || 2);

function runFile(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, file)], { env: process.env });
    let out = '';
    const timer = setTimeout(() => {
      out += '\nFAIL ' + file + ' timed out\n';
      child.kill('SIGKILL');
    }, Number(process.env.UMBER_TIMEOUT || 240000));
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ file, code, out });
    });
  });
}

async function main() {
  const queue = files.slice();
  const results = [];
  const worker = async () => {
    while (queue.length) {
      const file = queue.shift();
      const r = await runFile(file);
      results.push(r);
      process.stdout.write('--- ' + file + (r.code === 0 ? ' ok' : ' FAILED') + '\n' + r.out + '\n');
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, files.length) || 1 }, worker));
  const failed = results.filter((r) => r.code !== 0 || /^FAIL /m.test(r.out));
  const passCount = results.reduce((n, r) => n + (r.out.match(/^PASS /gm) || []).length, 0);
  const failCount = results.reduce((n, r) => n + (r.out.match(/^FAIL /gm) || []).length, 0);
  console.log('files: ' + results.length + '  passed tests: ' + passCount + '  failed tests: ' + failCount);
  if (failed.length) {
    console.log('failing files: ' + failed.map((r) => r.file).join(', '));
    process.exitCode = 1;
  }
}

main();
