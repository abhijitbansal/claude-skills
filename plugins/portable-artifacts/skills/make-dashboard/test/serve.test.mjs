import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVE = path.join(ROOT, 'scripts/serve.mjs');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-serve-')));
fs.mkdirSync(path.join(root, 'dist'));
fs.writeFileSync(path.join(root, 'dist/index.html'), '<h1>hi</h1>');
fs.writeFileSync(path.join(root, 'secret.txt'), 'secret');
fs.symlinkSync(path.join(root, 'secret.txt'), path.join(root, 'dist/link.txt'));

const children = [];
after(() => children.forEach((c) => c.kill()));

function start(args) {
  const child = spawn(process.execPath, [SERVE, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve) => {
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) resolve({ child, port: Number(m[1]) });
    });
  });
}

// Raw request so the path is sent exactly as given (fetch would normalise it).
const raw = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('serves index.html on 127.0.0.1', async () => {
  const { port } = await start([path.join(root, 'dist')]);
  assert.equal(await raw(port, '/'), 200);
  assert.equal(await raw(port, '/index.html'), 200);
  assert.equal(await raw(port, '/missing.html'), 404);
});

test('malformed URLs and NUL bytes give 400, not a crash', async () => {
  const { port, child } = await start([path.join(root, 'dist')]);
  assert.equal(await raw(port, '/%E0%A4%A'), 400);
  assert.equal(await raw(port, '/%00'), 400);
  assert.equal(await raw(port, '/a%00b'), 400);
  assert.equal(await raw(port, '/'), 200, 'server still alive');
  assert.equal(child.exitCode, null);
});

test('traversal and symlinks out of the served folder are refused', async () => {
  const { port } = await start([path.join(root, 'dist')]);
  for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/link.txt']) {
    const code = await raw(port, p);
    assert.ok(code === 403 || code === 404, `${p} -> ${code}`);
  }
});

// Raw request with an explicit Host header (DNS rebinding).
const withHost = (port, host) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: '/', headers: { host } }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  }).on('error', reject);
});

test('a foreign Host header is refused (DNS rebinding) but localhost is served', async () => {
  const { port } = await start([path.join(root, 'dist')]);
  assert.equal(await withHost(port, 'evil.test'), 403);
  assert.equal(await withHost(port, `evil.test:${port}`), 403);
  assert.equal(await withHost(port, `127.0.0.1:${port}`), 200);
  assert.equal(await withHost(port, `localhost:${port}`), 200);
});

test('unknown flag, missing index.html and a busy port exit 2 with one line', async () => {
  let r = spawnSync(process.execPath, [SERVE, path.join(root, 'dist'), '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  r = spawnSync(process.execPath, [SERVE, root], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  const { port } = await start([path.join(root, 'dist')]);
  r = spawnSync(process.execPath, [SERVE, path.join(root, 'dist'), '--port', String(port)], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split('\n').length, 1);
  assert.match(r.stderr, /EADDRINUSE/);
});
