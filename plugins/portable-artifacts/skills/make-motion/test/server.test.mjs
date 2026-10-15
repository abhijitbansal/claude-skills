import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../scripts/lib/server.mjs';
import { writeWav } from './helpers/wav.mjs';

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

test('/assets serves audio named in spec.audio with its MIME; unreferenced audio is 404, images still work', () => withServer(async (srv, f) => {
  writeWav(path.join(f.dir, 'voice.wav'), { seconds: 0.1 });
  writeWav(path.join(f.dir, 'unused.wav'), { seconds: 0.1 });
  writeFileSync(f.specPath, JSON.stringify({ ...spec('a'), audio: [{ src: 'voice.wav' }] }));
  const ok = await get(srv.url, '/assets/voice.wav');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'audio/wav');
  assert.equal((await get(srv.url, '/assets/unused.wav')).status, 404);
  assert.equal((await get(srv.url, '/assets/pic.png')).body, 'public');
}));

test('/assets honours a byte Range request so the browser can seek audio', () => withServer(async (srv, f) => {
  writeFileSync(path.join(f.dir, 'r.wav'), '0123456789');
  writeFileSync(f.specPath, JSON.stringify({ ...spec('a'), audio: [{ src: 'r.wav' }] }));
  const whole = await get(srv.url, '/assets/r.wav');
  assert.equal(whole.headers['accept-ranges'], 'bytes');
  const part = await get(srv.url, '/assets/r.wav', { range: 'bytes=2-5' });
  assert.equal(part.status, 206);
  assert.equal(part.body, '2345');
  assert.equal(part.headers['content-range'], 'bytes 2-5/10');
  const tail = await get(srv.url, '/assets/r.wav', { range: 'bytes=7-' });
  assert.equal(tail.body, '789');
  const unsatisfiable = await get(srv.url, '/assets/r.wav', { range: 'bytes=50-60' });
  assert.equal(unsatisfiable.status, 416);
  assert.equal(unsatisfiable.headers['cache-control'], 'no-store');
  const page = await get(srv.url, '/template/styles.css');
  assert.equal(page.headers['accept-ranges'], undefined, 'only /assets advertises byte ranges');
}));

test('/assets maps every audio extension to an audio MIME', () => withServer(async (srv, f) => {
  const mimes = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac' };
  for (const ext of Object.keys(mimes)) writeFileSync(path.join(f.dir, `t.${ext}`), 'x');
  writeFileSync(f.specPath, JSON.stringify({ ...spec('a'), audio: Object.keys(mimes).map((ext) => ({ src: `t.${ext}` })) }));
  for (const [ext, mime] of Object.entries(mimes)) {
    assert.equal((await get(srv.url, `/assets/t.${ext}`)).headers['content-type'], mime, ext);
  }
}));

test('/assets answers 404, not 500, while the spec is temporarily invalid JSON', () => withServer(async (srv, f) => {
  writeFileSync(f.specPath, '{not json');
  assert.equal((await get(srv.url, '/assets/pic.png')).status, 404);
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
  assert.equal((await get(srv.url, '/template/../scripts/lib/spec.mjs')).status, 404);
  assert.equal((await get(srv.url, '/template/..%2fscripts%2flib%2fspec.mjs')).status, 404);
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

const openFds = () => readdirSync('/dev/fd').length;
const BIG_FILE_BYTES = 1 << 20; // past the 64 KiB read-stream buffer
const ABORTED_REQUESTS = 20;
const FD_SLACK = 3;

function abortedRangeGet(url, rawPath) {
  const u = new URL(url);
  return new Promise((resolve) => {
    const req = http.get({ host: u.hostname, port: u.port, path: rawPath, headers: { range: 'bytes=0-' } }, (res) => {
      res.once('data', () => { req.destroy(); resolve(); });
    });
    req.on('error', () => resolve());
  });
}

test('an aborted /assets range request does not leak the file descriptor', { skip: !existsSync('/dev/fd') && 'no /dev/fd' }, () => withServer(async (srv, f) => {
  writeFileSync(path.join(f.dir, 'big.wav'), Buffer.alloc(BIG_FILE_BYTES, 1));
  writeFileSync(f.specPath, JSON.stringify({ ...spec('a'), audio: [{ src: 'big.wav' }] }));
  await abortedRangeGet(srv.url, '/assets/big.wav');
  await new Promise((r) => setTimeout(r, 50));
  const before = openFds();
  for (let i = 0; i < ABORTED_REQUESTS; i++) await abortedRangeGet(srv.url, '/assets/big.wav');
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(openFds() - before <= FD_SLACK, `fds grew from ${before} to ${openFds()}`);
}));

test('/events emits reload when a referenced audio file changes, even in a subfolder', () => withServer(async (srv, f) => {
  mkdirSync(path.join(f.dir, 'voice'));
  writeFileSync(path.join(f.dir, 'voice', 'intro.wav'), 'v1');
  writeFileSync(f.specPath, JSON.stringify({ ...spec('a'), audio: [{ src: 'voice/intro.wav' }] }));
  await new Promise((r) => setTimeout(r, 300)); // let the spec write's own reload drain first
  const seen = await new Promise((resolve, reject) => {
    const u = new URL(srv.url);
    const req = http.get({ host: u.hostname, port: u.port, path: '/events' }, (res) => {
      let buf = '';
      res.on('data', (c) => { buf += c; if (buf.includes('data: reload')) { req.destroy(); resolve(buf); } });
      setTimeout(() => writeFileSync(path.join(f.dir, 'voice', 'intro.wav'), 'v2 longer'), 150);
    });
    req.on('error', reject);
    setTimeout(() => reject(new Error('no reload event within 3 s')), 3000);
  });
  assert.match(seen, /data: reload/);
}));

// ---- theme ---------------------------------------------------------------------------------

test('/theme/<name>.json and .css serve a shared theme, fonts come from the synced shared/fonts', () => withServer(async (srv) => {
  const json = await get(srv.url, '/theme/ink.json');
  assert.equal(json.status, 200);
  assert.match(json.headers['content-type'], /application\/json/);
  const theme = JSON.parse(json.body);
  assert.equal(theme.name, 'ink');
  assert.equal(theme.fonts.body.family, 'IBM Plex Sans');
  assert.match(theme.dark.page, /^#[0-9a-f]{6}$/i);
  const css = await get(srv.url, '/theme/ink.css');
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);
  assert.match(css.body, /@font-face\{font-family:"IBM Plex Sans";font-style:normal;font-weight:600;font-display:block;src:url\(\/theme\/fonts\/ibm-plex-sans-latin-600-normal\.woff2\) format\("woff2"\)\}/);
  assert.match(css.body, /@font-face\{font-family:"JetBrains Mono"/);
  assert.match(css.body, /#stage\{--sans:"IBM Plex Sans", -apple-system, 'Segoe UI', sans-serif;--mono:"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace\}/);
  assert.ok(!css.body.includes('data:'), 'the page CSP allows fonts from self only');
  assert.ok(!css.body.includes('Bricolage'), 'the display role is not used, so its font is not offered');
  const font = await get(srv.url, '/theme/fonts/ibm-plex-sans-latin-600-normal.woff2');
  assert.equal(font.status, 200);
  assert.equal(font.headers['content-type'], 'font/woff2');
}));

test('theme routes refuse unknown names, traversal and anything but a woff2', () => withServer(async (srv) => {
  for (const p of ['/theme/nope.json', '/theme/nope.css', '/theme/..%2Fserver.json', '/theme/fonts/metrics.json',
    '/theme/fonts/LICENSES/ibm-plex-sans.txt', '/theme/fonts/..%2Fthemes%2Fink.json', '/theme/fonts/%2e%2e/theme.mjs', '/theme/ink.js',
    // encoded twice: one decode must not leave a slash or a dot-segment for a second decode to find
    '/theme/fonts/%252e%252e%252fthemes%252fink.json', '/theme/fonts/sub%252Fibm-plex-sans-latin-600-normal.woff2',
    '/theme/fonts/%2e%2e', '/theme/fonts/%2e%2e%2fibm-plex-sans-latin-600-normal.woff2', '/theme/fonts/%2fibm-plex-sans-latin-600-normal.woff2',
    '/theme/fonts/ibm-plex-sans-latin-600-normal.woff2%00', '/theme/fonts/.woff2', '/theme/fonts/%5cibm-plex-sans-latin-600-normal.woff2']) {
    assert.equal((await get(srv.url, p)).status, 404, p);
  }
}));

test('/spec.json gets the render theme only when the server was given one and the spec has none', async () => {
  const f = fixture();
  const read = async (opts, doc) => {
    writeFileSync(f.specPath, doc);
    const srv = await startServer({ specPath: f.specPath, mode: 'render', ...opts });
    try { return (await get(srv.url, '/spec.json')).body; } finally { await srv.close(); }
  };
  const plain = JSON.stringify(spec('a'));
  assert.equal(await read({}, plain), plain, 'no theme given: the file is served as it is, byte for byte');
  assert.equal(JSON.parse(await read({ theme: 'ink' }, plain)).theme, 'ink');
  assert.equal(JSON.parse(await read({ theme: 'ink' }, JSON.stringify({ ...spec('a'), theme: 'paper' }))).theme, 'paper');
  assert.equal(await read({ theme: 'ink' }, '{ not json'), '{ not json', 'an unreadable spec is passed through for the page to report');
});

test('GET / carries the skill favicon and provenance footer, CSP unchanged', () => withServer(async (srv, f) => {
  writeFileSync(f.specPath, JSON.stringify({ ...spec('one'), generatedBy: { model: 'Claude Opus 5', agent: 'Claude Code' } }));
  const r = await get(srv.url, '/');
  assert.match(r.body, /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,/);
  assert.match(r.body, /<p class="pa-provenance" title="[^"]*">make-motion · Claude Opus 5 · effort not reported · Claude Code · /);
  assert.ok(!r.body.includes('{{'), 'no unfilled placeholder');
  const hash = createHash('sha256').update(/<script type="importmap">([\s\S]*?)<\/script>/.exec(r.body)[1]).digest('base64');
  assert.equal(r.headers['content-security-policy'], ["default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline'",
    "font-src 'self'", "connect-src 'self'", `script-src 'self' 'sha256-${hash}'`, "object-src 'none'", "base-uri 'none'"].join('; '));
}));

test('GET / keeps a valid generatedBy when the spec has an unrelated error, and follows a changed theme', () => withServer(async (srv, f) => {
  writeFileSync(f.specPath, JSON.stringify({ ...spec('one'), fps: 7, generatedBy: { model: 'Claude Opus 5', agent: 'Claude Code' } }));
  const bad = await get(srv.url, '/');
  assert.match(bad.body, /make-motion · Claude Opus 5 · effort not reported · Claude Code · /);
  writeFileSync(f.specPath, JSON.stringify({ ...spec('one'), theme: 'ink', generatedBy: { model: 'Claude Sonnet 5' } }));
  const next = await get(srv.url, '/');
  assert.match(next.body, /make-motion · Claude Sonnet 5 · effort not reported · agent not reported · /);
  assert.notEqual(next.body.match(/rel="icon"[^>]*/)[0], bad.body.match(/rel="icon"[^>]*/)[0]);
}));

test('GET / falls back to "not reported" provenance when the spec is unreadable', () => withServer(async (srv, f) => {
  writeFileSync(f.specPath, '{ not json');
  const r = await get(srv.url, '/');
  assert.match(r.body, /<p class="pa-provenance" title="[^"]*">make-motion · model not reported · effort not reported · agent not reported · /);
  assert.match(r.body, /<link rel="icon"/);
}));

test('GET / never injects hostile generatedBy values', () => withServer(async (srv, f) => {
  writeFileSync(f.specPath, JSON.stringify({ ...spec('one'), generatedBy: { model: '<script>x</script>' } }));
  const r = await get(srv.url, '/');
  assert.ok(!r.body.includes('<script>x'));
  assert.match(r.body, /model not reported/);
}));

test('footer CSS: hidden by default (render mode), shown only under body.preview', () => {
  const css = readFileSync(new URL('../template/styles.css', import.meta.url), 'utf8');
  assert.match(css, /^\.pa-footer \{ display: none; \}$/m);
  assert.ok(css.includes('body.preview .pa-footer { display: block;'), 'preview rule');
  assert.equal((css.match(/\.pa-footer[^{]*\{[^}]*display:\s*(block|flex)/g) ?? []).length, 1, 'only one rule may show the footer');
});

test('render mode serves the footer markup but the page never shows it', () => withServer(async (srv) => {
  const r = await get(srv.url, '/');
  assert.match(r.body, /<footer class="pa-footer">/);
}, 'render'));
