import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../scripts/lib/server.mjs';

const spec = (title, src = 'pic.png') => ({ scenes: [{ id: 's', duration: 1, elements: [
  { id: 't', type: 'text', text: title, x: 1, y: 1 },
  { id: 'im', type: 'image', src, x: 1, y: 1, width: 4, height: 4 },
] }] });

function fixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'srv-'));
  const dir = path.join(parent, 'proj');
  mkdirSync(dir);
  writeFileSync(path.join(parent, 'secret.png'), 'TOP SECRET');
  writeFileSync(path.join(dir, 'pic.png'), 'public');
  writeFileSync(path.join(dir, 'other.txt'), 'unreferenced');
  writeFileSync(path.join(dir, '.env'), 'DOTFILE');
  symlinkSync(path.join(parent, 'secret.png'), path.join(dir, 'link.png'));
  writeFileSync(path.join(dir, 'm.json'), JSON.stringify(spec('one')));
  return { parent, dir, specPath: path.join(dir, 'm.json') };
}

// raw request so the path and headers are sent exactly as written
function get(url, rawPath, headers = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

async function withServer(fn, mode = 'preview') {
  const f = fixture();
  const srv = await startServer({ specPath: f.specPath, mode });
  try { await fn(srv, f); } finally { await srv.close(); }
}

test('binds 127.0.0.1 and serves index with mode', () => withServer(async (srv) => {
  assert.match(srv.url, /^http:\/\/127\.0\.0\.1:\d+\/?$/);
  const r = await get(srv.url, '/');
  assert.equal(r.status, 200);
  assert.match(r.body, /name="motion-mode" content="render"/);
}, 'render'));

test('HTML responses carry a CSP whose script hash matches the inline importmap', () => withServer(async (srv) => {
  const r = await get(srv.url, '/');
  const csp = r.headers['content-security-policy'];
  assert.ok(csp, 'CSP header missing');
  for (const part of ["default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "connect-src 'self'"]) assert.ok(csp.includes(part), `${part} in ${csp}`);
  const importmap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(r.body)[1];
  const hash = createHash('sha256').update(importmap).digest('base64');
  assert.ok(csp.includes(`script-src 'self' 'sha256-${hash}'`), csp);
  assert.ok(!csp.includes('unsafe-eval'));
}));

test('/spec.json is re-read on every request', () => withServer(async (srv, f) => {
  assert.equal(JSON.parse((await get(srv.url, '/spec.json')).body).scenes[0].elements[0].text, 'one');
  writeFileSync(f.specPath, JSON.stringify(spec('two')));
  assert.equal(JSON.parse((await get(srv.url, '/spec.json')).body).scenes[0].elements[0].text, 'two');
}));

test('rejects a foreign Host header (DNS rebinding) but accepts localhost', () => withServer(async (srv) => {
  const port = new URL(srv.url).port;
  assert.equal((await get(srv.url, '/spec.json', { host: 'evil.test' })).status, 403);
  assert.equal((await get(srv.url, '/spec.json', { host: `evil.test:${port}` })).status, 403);
  assert.equal((await get(srv.url, '/spec.json', { host: `localhost:${port}` })).status, 200);
  assert.equal((await get(srv.url, '/spec.json', { host: `127.0.0.1:${port}` })).status, 200);
}));

test('/assets serves only image srcs named in the spec; blocks traversal, symlinks, dotfiles', () => withServer(async (srv, f) => {
  assert.equal((await get(srv.url, '/assets/pic.png')).body, 'public');
  for (const p of ['/assets/other.txt', '/assets/.env', '/assets/m.json', '/assets/../secret.png',
    '/assets/%2e%2e/secret.png', '/assets/..%2fsecret.png', '/assets/%2e%2e%2fsecret.png',
    '/assets/pic.png%00', '/assets//etc/passwd', '/assets/link.png']) {
    const r = await get(srv.url, p);
    assert.ok(r.status === 403 || r.status === 404, `${p} -> ${r.status}`);
    assert.ok(!/TOP SECRET|unreferenced|DOTFILE/.test(r.body), p);
  }
  // even when the spec names the symlink or the dotfile, they stay blocked
  writeFileSync(f.specPath, JSON.stringify(spec('x', 'link.png')));
  assert.equal((await get(srv.url, '/assets/link.png')).status, 404);
  writeFileSync(f.specPath, JSON.stringify(spec('x', '.env')));
  assert.equal((await get(srv.url, '/assets/.env')).status, 404);
}));

test('vendor routes and template serve 200', () => withServer(async (srv) => {
  for (const p of ['/vendor/animejs/anime.esm.js', '/vendor/vega/vega.min.js', '/vendor/vega-lite/vega-lite.min.js',
    '/vendor/vega-util/index.js', '/vendor/vega-interpreter/vega-interpreter.js',
    '/vendor/fonts/inter-latin-700-normal.woff2', '/vendor/fonts/inter-cyrillic-400-normal.woff2',
    '/vendor/fonts/jetbrains-mono-latin-400-normal.woff2', '/vendor/fonts/jetbrains-mono-greek-400-normal.woff2',
    '/template/renderer.mjs', '/template/timeline.mjs', '/template/defaults.mjs', '/template/styles.css']) {
    assert.equal((await get(srv.url, p)).status, 200, p);
  }
  assert.equal((await get(srv.url, '/vendor/fonts/..%2f..%2fpackage.json')).status, 404);
  assert.equal((await get(srv.url, '/template/../scripts/lib/errors.mjs')).status, 404);
  assert.equal((await get(srv.url, '/nope')).status, 404);
}));

function sseUntil(srv, trigger, match) {
  const u = new URL(srv.url);
  return new Promise((resolve, reject) => {
    let buf = '';
    const req = http.get({ host: u.hostname, port: u.port, path: '/events' }, (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      res.on('data', (c) => {
        buf += c;
        if (match.test(buf)) { req.destroy(); resolve(buf); }
      });
      setTimeout(trigger, 150);
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? resolve(buf) : reject(e)));
    setTimeout(() => reject(new Error(`no matching event; got: ${buf}`)), 4000);
  });
}

test('/events emits reload when the spec changes', () => withServer(async (srv, f) => {
  const got = await sseUntil(srv, () => writeFileSync(f.specPath, JSON.stringify(spec('changed'))), /data: reload/);
  assert.match(got, /data: reload/);
}));

test('/events emits spec-error with formatted errors when the changed spec is invalid', () => withServer(async (srv, f) => {
  const got = await sseUntil(srv, () => writeFileSync(f.specPath, JSON.stringify({ ...spec('x'), fsp: 30 })), /event: spec-error\ndata: .*\n\n/);
  const data = JSON.parse(/event: spec-error\ndata: (.*)\n/.exec(got)[1]);
  assert.deepEqual(data[0], { path: 'fsp', message: 'unknown property; did you mean "fps"?' });
  const got2 = await sseUntil(srv, () => writeFileSync(f.specPath, '{not json'), /event: spec-error\ndata: .*\n\n/);
  assert.match(JSON.parse(/event: spec-error\ndata: (.*)\n/.exec(got2)[1])[0].message, /not valid JSON/);
}));
