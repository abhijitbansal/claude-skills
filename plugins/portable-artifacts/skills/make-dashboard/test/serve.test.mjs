import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve, stopChild, until } from './helpers/live-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'scripts/serve.mjs');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-serve-')));
fs.mkdirSync(path.join(root, 'dist'));
fs.writeFileSync(path.join(root, 'dist/index.html'), '<h1>hi</h1>');
fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');
fs.symlinkSync(path.join(root, 'secret.txt'), path.join(root, 'dist/link.txt'));

const SPAWN_MS = 30000;
const start = (t, args) => serve(t, SERVE, args);

// Raw request so the path is sent exactly as given (fetch would normalise it).
const raw = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p, agent: false, signal: AbortSignal.timeout(20000) }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('serves index.html on 127.0.0.1', async (t) => {
  const { port } = await start(t, [path.join(root, 'dist')]);
  assert.equal(await raw(port, '/'), 200);
  assert.equal(await raw(port, '/index.html'), 200);
  assert.equal(await raw(port, '/missing.html'), 404);
});

test('malformed URLs and NUL bytes give 400, not a crash', async (t) => {
  const { port, child } = await start(t, [path.join(root, 'dist')]);
  assert.equal(await raw(port, '/%E0%A4%A'), 400);
  assert.equal(await raw(port, '/%00'), 400);
  assert.equal(await raw(port, '/a%00b'), 400);
  assert.equal(await raw(port, '/'), 200, 'server still alive');
  assert.equal(child.exitCode, null);
});

test('traversal and symlinks out of the served folder are refused', async (t) => {
  const { port } = await start(t, [path.join(root, 'dist')]);
  for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/link.txt']) {
    const code = await raw(port, p);
    assert.ok(code === 403 || code === 404, `${p} -> ${code}`);
  }
});

// Raw request with an explicit Host header (DNS rebinding).
const withHost = (port, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/', headers: { host }, agent: false, signal: AbortSignal.timeout(20000) }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('a foreign Host header is refused (DNS rebinding) but localhost is served', async (t) => {
  const { port } = await start(t, [path.join(root, 'dist')]);
  assert.equal(await withHost(port, 'evil.test'), 403);
  assert.equal(await withHost(port, `evil.test:${port}`), 403);
  assert.equal(await withHost(port, `127.0.0.1:${port}`), 200);
  assert.equal(await withHost(port, `localhost:${port}`), 200);
});

test('unknown flag, missing index.html and a busy port exit 2 with one line', async (t) => {
  let r = spawnSync(process.execPath, [SERVE, path.join(root, 'dist'), '--bogus'], { encoding: 'utf8', timeout: SPAWN_MS });
  assert.equal(r.status, 2);
  r = spawnSync(process.execPath, [SERVE, root], { encoding: 'utf8', timeout: SPAWN_MS });
  assert.equal(r.status, 2);
  const { port } = await start(t, [path.join(root, 'dist')]);
  r = spawnSync(process.execPath, [SERVE, path.join(root, 'dist'), '--port', String(port)], { encoding: 'utf8', timeout: SPAWN_MS });
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /EADDRINUSE/);
});

// ---- PA-32 --------------------------------------------------------------------

const FIXTURE_DATA = path.join(ROOT, 'test/fixtures/data');
function watchProject() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-serve-watch-')));
  fs.cpSync(FIXTURE_DATA, path.join(dir, 'data'), { recursive: true });
  const spec = { title: 'T', sources: { sales: { type: 'csv', path: 'data/sales.csv' } }, queries: { total: 'SELECT SUM(amount) AS revenue FROM sales' }, kpis: [{ id: 'k', title: 'Revenue', query: 'total', field: 'revenue' }] };
  fs.writeFileSync(path.join(dir, 'dashboard.json'), JSON.stringify(spec));
  return dir;
}

test('--open without an opener on PATH keeps serving instead of crashing', async (t) => {
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-nobin-'));
  const child = spawn(process.execPath, [SERVE, path.join(root, 'dist'), '--open'], { env: { ...process.env, PATH: emptyBin }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => stopChild(child));
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  await until(() => /http:\/\/127\.0\.0\.1:(\d+)\//.test(out) || child.exitCode !== null, { label: 'the serve URL' });
  const port = Number(out.match(/http:\/\/127\.0\.0\.1:(\d+)\//)[1]);
  await until(() => /could not open a browser/.test(err) || child.exitCode !== null, { label: 'the opener warning' });
  assert.equal(child.exitCode, null, `serve exited: ${err}`);
  assert.equal(await raw(port, '/'), 200);
});

test('--watch honours --out and a malformed URL gets 400 from the live server', async (t) => {
  const dir = watchProject();
  const out = path.join(dir, 'site');
  const { port } = await start(t, ['--watch', path.join(dir, 'dashboard.json'), '--out', out]);
  assert.ok(fs.existsSync(path.join(out, 'index.html')), 'the page is written under --out');
  assert.ok(!fs.existsSync(path.join(dir, 'dist')), 'not under the default dist');
  assert.equal(await raw(port, '//'), 400);
  assert.equal(await raw(port, '/'), 200);
});

test('--out without --watch is a usage error', () => {
  const r = spawnSync(process.execPath, [SERVE, path.join(root, 'dist'), '--out', root], { encoding: 'utf8', timeout: SPAWN_MS });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /need --watch/);
});
