// The guarantees of the security table (cut-over plan, Task 1 step 5) that had a proof only in a version 1 test, or none
// that fails when the guard is broken. Each guard here was shown failing against a deliberately broken copy first; the
// mutation rows are in .superpowers/sdd/2026-11-16-pa2-run2/co1-report.md. Run with --test-concurrency=1.
//   1. the render server binds loopback only
//   2. the browser aborts any request off the loopback origin (guardNetwork), and reports it
//   3. no film field names a remote URL
//   4. every ffmpeg input that opens a user file goes through a whitelisting builder
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTimeline } from '../../engine/script/timing.mjs';
import '../../engine/kinds/index.mjs';
import '../../scripts/v2/list.mjs';
import { startV2Server } from '../../scripts/v2/server.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { clipInput, CLIP_DEMUXERS } from '../../scripts/v2/clips.mjs';
import { launchBrowser, guardNetwork } from '../../scripts/lib/browser.mjs';
import { browserAvailable } from './helpers/session.mjs';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILM = { version: 2, fps: 30, shots: [{ id: 'a', show: 'statement', say: 'Hello there.' }] };
const dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-security-'));
writeFileSync(path.join(dir, 'a.png'), 'x');
after(() => rmSync(dir, { recursive: true, force: true }));

const renderServer = () => startV2Server({ film: FILM, timeline: buildTimeline(FILM, { fps: 30 }), specDir: dir });

// ---- 1. the render server binds loopback only ----

test('the render server listens on 127.0.0.1 and not on any other interface of this machine', async (t) => {
  const s = await renderServer();
  t.after(() => s.close());
  assert.equal(s.server.address().address, '127.0.0.1');
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const { port } = s.server.address();
  const others = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal);
  for (const { address } of others.slice(0, 2)) {
    const outcome = await new Promise((resolve) => {
      const socket = net.connect({ host: address, port, timeout: 2000 });
      socket.on('connect', () => { socket.destroy(); resolve('connected'); });
      socket.on('error', (e) => resolve(e.code));
      socket.on('timeout', () => { socket.destroy(); resolve('timeout'); });
    });
    assert.notEqual(outcome, 'connected', `the server answered on ${address}:${port}`);
  }
});

// ---- 2. the browser aborts any request off the loopback origin ----

test('guardNetwork aborts a request to another origin, reports its URL, and lets the loopback origin through', async (t) => {
  if (!await browserAvailable()) return t.skip('no browser');
  const serve = (body) => new Promise((resolve) => {
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/html' }); res.end(body); });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
  const home = await serve('<!doctype html><title>home</title>');
  const other = await serve('foreign');
  const homeOrigin = `http://127.0.0.1:${home.address().port}`;
  const foreignUrl = `http://127.0.0.1:${other.address().port}/x`;
  const browser = await launchBrowser({ quiet: true });
  t.after(async () => { await browser.close(); home.close(); other.close(); });
  const page = await browser.newPage();
  const blocked = [];
  await guardNetwork(page, homeOrigin, (url) => blocked.push(url));
  const tryFetch = (url) => page.evaluate((u) => fetch(u).then((r) => r.text(), () => 'blocked'), url);
  await page.goto(`${homeOrigin}/`); // a page with no CSP of its own, so only the route guard can stop the request
  assert.equal(await tryFetch(foreignUrl), 'blocked');
  assert.deepEqual(blocked, [foreignUrl]);
  assert.equal(await tryFetch(`${homeOrigin}/`), '<!doctype html><title>home</title>', 'the origin itself is served');
  assert.deepEqual(blocked, [foreignUrl], 'and not reported');
});

// ---- 3. no film field names a remote URL ----

test('every field of a film that names a file refuses a URL, whatever the scheme', () => {
  const shots = [{ id: 'a', show: 'statement', say: 'Hello there.' }];
  const URL_TEXT = 'https://example.com/x.mp3';
  const fields = {
    'music.src': (src) => ({ version: 2, music: { src }, shots }),
    'audio[0].src': (src) => ({ version: 2, audio: [{ src }], shots }),
    'voice.src': (src) => ({ version: 2, voice: { src, words: 'w.json' }, shots }),
    'voice.words': (src) => ({ version: 2, voice: { src: 'a.png', words: src }, shots }),
    'shots[0].src (media)': (src) => ({ version: 2, shots: [{ id: 'm', show: 'media', src, hold: 1 }] }),
    'shots[0].src (screen)': (src) => ({ version: 2, shots: [{ id: 's', show: 'screen', src, say: 'Look.' }] }),
  };
  for (const [field, film] of Object.entries(fields)) {
    for (const src of [URL_TEXT, 'http://127.0.0.1/x.mp3', 'file:///etc/passwd', 'data:audio/wav;base64,AAAA', 'blob:abc']) {
      const errors = validateFilm(film(src), { specDir: dir }).errors;
      assert.ok(errors.some((e) => e.path === field.replace(/ \(.*\)$/, '') && /URL/.test(e.message)), `${field} accepted ${src}: ${JSON.stringify(errors)}`);
    }
  }
});

// ---- 4. every ffmpeg input that opens a user file goes through a whitelisting builder ----

test('clipInput opens a clip through the file protocol only and the plain clip containers only', () => {
  const args = clipInput('/film/c.mp4');
  assert.deepEqual(args.slice(0, 2), ['-protocol_whitelist', 'file'], 'no pipe, no http, no concat protocol');
  assert.deepEqual(args.slice(2, 4), ['-format_whitelist', CLIP_DEMUXERS.join(',')]);
  assert.deepEqual(args.slice(4), ['-i', '/film/c.mp4'], 'the file comes last, behind both whitelists');
  assert.deepEqual([...CLIP_DEMUXERS], ['mov', 'mp4', 'm4a', 'matroska', 'webm']);
  for (const refused of ['hls', 'dash', 'concat', 'image2', 'lavfi', 'rtsp', 'sdp', 'tcp']) assert.ok(!CLIP_DEMUXERS.includes(refused), refused);
});

// Every place version 2 and the kept tools put a literal '-i' in an ffmpeg argument list, by file: a new one fails here
// until it is added with the reason it is safe. The list may only shrink.
const INPUT_SITES = Object.freeze({
  'scripts/lib/ffmpeg.mjs': 1, // fileInput, the whitelisting builder (version 1's frame pipe, preflight source and measureLoudness went at cut-over)
  'scripts/v2/clips.mjs': 1, // clipInput, the whitelisting builder
  'scripts/v2/render.mjs': 1, // the frame pipe (-i -)
  'scripts/v2/voice/master.mjs': 3, // recordingInput, ownWavInput, ownMp4Input: the whitelisting builders
  'scripts/v2/voice/accuracy.mjs': 1, // the accuracy tool's own synthesised WAV, never a user file
});

function sourcesUnder(folder) {
  return readdirSync(path.join(SKILL_DIR, folder), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${folder}/${entry.name}`;
    if (entry.isDirectory()) return sourcesUnder(rel);
    return entry.name.endsWith('.mjs') ? [rel] : [];
  });
}

test('a literal -i appears in an ffmpeg argument list only at the sites reviewed for a whitelist', () => {
  const found = {};
  for (const rel of [...sourcesUnder('scripts/v2'), ...sourcesUnder('scripts/lib'), 'scripts/make.mjs', 'scripts/beats.mjs', 'scripts/storyboard.mjs', 'scripts/cutout.mjs']) {
    const count = readFileSync(path.join(SKILL_DIR, rel), 'utf8').split('\n').filter((line) => /'-i'/.test(line) && !/^\s*\/\//.test(line)).length;
    if (count > 0) found[rel] = count;
  }
  assert.deepEqual(found, INPUT_SITES);
});
