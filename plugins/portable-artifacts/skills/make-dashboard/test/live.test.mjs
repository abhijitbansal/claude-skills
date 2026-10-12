import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { liveHtml, createRebuilder, watchFiles } from '../scripts/lib/live.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'scripts/serve.mjs');
const CSP = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:`;
const children = [];
after(() => children.forEach((c) => c.kill()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('liveHtml adds connect-src and the client; the original string is untouched', () => {
  const html = `<meta http-equiv="Content-Security-Policy" content="${CSP}"><body><p>x</p></body>`;
  const live = liveHtml(html, { token: 'abc"def' });
  assert.ok(live.includes(`content="${CSP}; connect-src 'self'"`));
  assert.ok(live.includes('"abc\\"def"'), 'token embedded as a JSON string');
  assert.ok(live.indexOf('EventSource') < live.indexOf('</body>'));
  assert.ok(!html.includes('connect-src'));
});

test('createRebuilder runs one build at a time and coalesces triggers into one more', async () => {
  let runs = 0;
  let release;
  const rb = createRebuilder(async () => { runs++; await new Promise((r) => { release = r; }); });
  rb.trigger(); rb.trigger(); rb.trigger();
  await sleep(10);
  assert.equal(runs, 1);
  release(); await sleep(10);
  assert.equal(runs, 2, 'exactly one follow-up');
  release(); await rb.idle();
  assert.equal(runs, 2);
});

test('watchFiles fires once per burst, including rename-and-replace saves', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-watch-'));
  const file = path.join(dir, 'data.csv');
  fs.writeFileSync(file, 'a\n1\n');
  let fired = 0;
  const w = watchFiles([file], () => { fired++; }, { debounceMs: 100 });
  fs.writeFileSync(file, 'a\n2\n'); fs.writeFileSync(file, 'a\n3\n');
  await sleep(400);
  assert.equal(fired, 1);
  fs.writeFileSync(path.join(dir, '.data.csv.tmp'), 'a\n4\n');
  fs.renameSync(path.join(dir, '.data.csv.tmp'), file);
  await sleep(400);
  assert.equal(fired, 2);
  fs.writeFileSync(path.join(dir, 'other.csv'), 'x');
  await sleep(400);
  assert.equal(fired, 2, 'unrelated files are ignored');
  w.close();
});

// ---- end to end ------------------------------------------------------------
function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-live-')));
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/k.csv'), 'v\n41\n');
  const spec = {
    title: 'Live', sources: { k: { type: 'csv', path: 'data/k.csv' } },
    queries: { total: 'SELECT SUM(v) AS v FROM k' },
    kpis: [{ id: 'k1', title: 'Total', query: 'total', field: 'v' }],
  };
  fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify(spec));
  return { dir, spec, file: path.join(dir, 'dashboard.json'), csv: path.join(dir, 'data/k.csv') };
}

function serve(args) {
  const child = spawn(process.execPath, [SERVE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      const tok = out.match(/token: (\w+)/);
      if (m && tok) resolve({ child, port: Number(m[1]), token: tok[1] });
    });
    child.on('exit', (code) => reject(new Error(`serve exited ${code}: ${out}`)));
  });
}

function events(port) {
  const seen = [];
  let buf = '';
  const req = http.get({ host: '127.0.0.1', port, path: '/events' }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const m = block.match(/^event: ([\w-]+)\ndata: (.*)$/m);
        if (m) seen.push({ event: m[1], data: JSON.parse(m[2]) });
      }
    });
  });
  return { seen, close: () => req.destroy() };
}

const until = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return; await sleep(50); }
  throw new Error('timed out');
};

const request = (port, { method = 'GET', path: p = '/', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end();
});

test('--watch: CSV edit -> rebuilt; broken spec -> error and last good page stays; good save recovers', async () => {
  const { file, csv, spec, dir } = project();
  const { port } = await serve(['--watch', file]);
  const es = events(port);
  await sleep(200);
  fs.writeFileSync(csv, 'v\n41\n1\n');
  await until(() => es.seen.some((e) => e.event === 'rebuilt'));
  assert.match((await request(port)).body, /class="kpi-value">42</);
  fs.writeFileSync(csv, 'v\n"unterminated\n');  // half-written file
  await until(() => es.seen.some((e) => e.event === 'build-error'));
  assert.match((await request(port)).body, /class="kpi-value">42</, 'last good page still served');
  fs.writeFileSync(csv, 'v\n50\n');
  await until(() => es.seen.filter((e) => e.event === 'rebuilt').length >= 2);
  assert.match((await request(port)).body, /class="kpi-value">50</);
  fs.writeFileSync(file, JSON.stringify({ ...spec, queries: { total: 'SELEC 1' } }));
  await until(() => es.seen.filter((e) => e.event === 'build-error').length >= 2);
  const disk = fs.readFileSync(path.join(dir, 'dist/index.html'), 'utf8');
  assert.ok(disk.includes(`content="${CSP}"`) && !disk.includes('connect-src'), 'disk copy keeps the strict CSP');
  assert.ok((await request(port)).body.includes("connect-src 'self'"), 'served copy allows the event stream');
  es.close();
});

test('POST /rebuild needs the token; other methods and foreign hosts are refused', async () => {
  const { file } = project();
  const { port, token } = await serve(['--watch', file]);
  const es = events(port);
  assert.equal((await request(port, { method: 'POST', path: '/rebuild' })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': 'nope' } })).status, 403);
  assert.equal((await request(port, { method: 'OPTIONS', path: '/rebuild' })).status, 405);
  assert.equal((await request(port, { headers: { host: `evil.test:${port}` } })).status, 403);
  assert.equal((await request(port, { method: 'POST', path: '/rebuild', headers: { 'x-pa-token': token } })).status, 202);
  await until(() => es.seen.some((e) => e.event === 'rebuilt'));
  es.close();
});

test('--interval rebuilds on a timer; --watch with a directory argument is a usage error', async () => {
  const { file, dir } = project();
  const { port } = await serve(['--watch', file, '--interval', '5']);
  const es = events(port);
  await until(() => es.seen.some((e) => e.event === 'rebuilt'), 9000);
  es.close();
  let r = spawnSync(process.execPath, [SERVE, path.join(dir, 'dist'), '--watch', file], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  r = spawnSync(process.execPath, [SERVE, '--watch', file, '--interval', '2'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--interval must be at least 5 seconds/);
});
