// The preview's server mode (scripts/v2/viewer.mjs over server.mjs), no browser: loopback only, its own Host headers,
// fixed routes, the policy on every response, the audio route with ranges, and preview files with no remote URL.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { startViewer } from '../../scripts/v2/viewer.mjs';
import { parseMakeArgs } from '../../scripts/v2/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = path.resolve(HERE, '../../engine/page');
const FILM = { version: 2, fps: 30, shots: [{ id: 'a', show: 'free', hold: 1, background: '#f3eee3', nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } }] }] };
const AUDIO = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));

let dir, viewer, port;
before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-viewer-'));
  writeFileSync(path.join(dir, 'film.json'), JSON.stringify(FILM));
  writeFileSync(path.join(dir, 'sound.m4a'), AUDIO);
  viewer = await startViewer({ loaded: loadFilm(path.join(dir, 'film.json')), audio: path.join(dir, 'sound.m4a'), provenance: 'make-motion · model m1' });
  port = viewer.server.address().port;
});
after(async () => {
  await viewer.close();
  rmSync(dir, { recursive: true, force: true });
});

// A raw request (no client-side path normalisation), resolving { status, headers, body }.
function get(rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('the preview server binds 127.0.0.1 only and prints a /preview URL on it', () => {
  assert.equal(viewer.server.address().address, '127.0.0.1');
  assert.equal(viewer.url, `http://127.0.0.1:${port}/preview`);
});

test('a request with another Host header is refused', async () => {
  assert.equal((await get('/preview', { host: 'evil.example' })).status, 403);
  assert.equal((await get('/preview/state', { host: `attacker.test:${port}` })).status, 403);
});

test('traversal, an encoded separator and a backslash are refused', async () => {
  for (const p of ['/preview/../film.json', '/preview/%2e%2e/x', '/preview%2fstate', '/preview\\state', '/preview/./state']) {
    assert.equal((await get(p)).status, 400, p);
  }
});

test('every response, the audio included, carries the policy, with no remote source and no unsafe-eval', async () => {
  for (const p of ['/preview', '/preview/state', '/preview/audio', '/preview/nope', '/engine/page/viewer.mjs']) {
    const csp = (await get(p)).headers['content-security-policy'];
    assert.ok(csp, p);
    assert.doesNotMatch(csp, /https?:|\*|unsafe-eval|data:|blob:/, p);
  }
});

test('/preview serves the page and /preview/state the version, errors, provenance and whether there is audio', async () => {
  const page = await get('/preview');
  assert.equal(page.status, 200);
  assert.match(page.body.toString(), /viewer\.mjs/);
  const state = JSON.parse((await get('/preview/state')).body);
  assert.deepEqual(state, { version: 1, errors: [], provenance: 'make-motion · model m1', audio: true, notice: null });
});

test('/preview/audio serves exactly the run\'s file and honours a range', async () => {
  const whole = await get('/preview/audio');
  assert.equal(whole.status, 200);
  assert.ok(whole.body.equals(AUDIO));
  const part = await get('/preview/audio', { range: 'bytes=100-199' });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], 'bytes 100-199/1000');
  assert.ok(part.body.equals(AUDIO.subarray(100, 200)));
  const tail = await get('/preview/audio', { range: 'bytes=-10' });
  assert.ok(tail.body.equals(AUDIO.subarray(990)));
  assert.equal((await get('/preview/audio', { range: 'bytes=5000-' })).status, 416);
});

test('an unknown /preview/x is 404', async () => {
  assert.equal((await get('/preview/x')).status, 404);
  assert.equal((await get('/preview/audio2')).status, 404);
});

test('an invalid edit bumps the version and carries the validator\'s lines; a valid one clears them', async () => {
  viewer.fail(['shots[0].hold: must be > 0']);
  assert.deepEqual(JSON.parse((await get('/preview/state')).body).errors, ['shots[0].hold: must be > 0']);
  viewer.update({ loaded: loadFilm(path.join(dir, 'film.json')), audio: null });
  const state = JSON.parse((await get('/preview/state')).body);
  assert.equal(state.version, 3);
  assert.deepEqual(state.errors, []);
  assert.equal(state.audio, false);
  assert.equal((await get('/preview/audio')).status, 404);
});

test('--preview goes with no other mode flag, and --open needs --preview', () => {
  assert.deepEqual([parseMakeArgs(['f.json', '--preview']).preview, parseMakeArgs(['f.json', '--preview', '--open']).open], [true, true]);
  assert.equal(parseMakeArgs(['f.json']).open, false);
  assert.throws(() => parseMakeArgs(['f.json', '--open']), /--open needs --preview/);
  for (const other of [['--out', 'x.mp4'], ['--poster', '1'], ['--batch', 'r.json'], ['--outline'], ['--sheets-only'], ['--workers', '2']]) {
    assert.throws(() => parseMakeArgs(['f.json', '--preview', ...other]), /--preview does not go with/, other.join(' '));
  }
});

test('the preview files hold no http:// or https:// URL', () => {
  const files = readdirSync(PAGE_DIR).filter((f) => /^viewer\./.test(f));
  assert.ok(files.length >= 2, `viewer.html and viewer.mjs: ${files}`);
  for (const f of files) assert.doesNotMatch(readFileSync(path.join(PAGE_DIR, f), 'utf8'), /https?:\/\//, f);
});
