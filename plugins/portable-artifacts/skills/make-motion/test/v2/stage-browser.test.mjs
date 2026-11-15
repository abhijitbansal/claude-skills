// The v2 render page: the `free` kind, the loopback server, and frames that repeat. Run with --test-concurrency=1.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { node, isNode } from '../../engine/graph/node.mjs';
import { sample } from '../../engine/time/track.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import '../../engine/kinds/free.mjs';
import { startV2Server } from '../../scripts/v2/server.mjs';
import { openStage } from './helpers/stage.mjs';

const FPS = 30;
const FRAME = 40;
const LAST_FRAME = 60; // hold: 2 at 30 fps; the last shot also owns t === duration
const keys = (...pairs) => ({ keys: pairs.map(([t, v, ease]) => (ease ? { t, v, ease } : { t, v })) });

// One free shot that exercises every drawing path: fill, stroked draw-on, text with word tracks (two lines, tracking),
// a rotated group with a child, a stepped node, reveal, rough, blur, opacity and a camera move.
const FILM = {
  fps: FPS,
  shots: [{
    id: 'all',
    show: 'free',
    hold: 2,
    background: '#101820',
    camera: { x: keys([0, 0], [2, 80]), zoom: keys([0, 1], [2, 1.1]) },
    nodes: [
      { type: 'path', id: 'tri', props: { d: 'M100 100L400 100L250 350Z', fill: '#e2574c' } },
      {
        type: 'path', id: 'curve',
        props: { d: 'M600 500C800 200 1000 800 1200 500', stroke: '#4cc9f0', strokeWidth: 12 },
        tracks: { draw: keys([0, 0], [1.5, 1, 'inOutCubic']) },
      },
      {
        type: 'text', id: 'headline',
        props: { x: 120, y: 560, text: 'Frames repeat every single time', font: { family: 'Geist', weight: 600, size: 96, tracking: 0.02 }, maxWidth: 700, fill: '#ffffff' },
        wordTracks: [
          { opacity: keys([0, 0], [0.5, 1]) },
          { opacity: keys([0.2, 0], [0.7, 1]), y: keys([0.2, 30], [0.7, 0, 'outCubic']) },
          { opacity: keys([0.4, 0], [0.9, 1]) },
          { fill: keys([0, '#ffffff'], [2, '#ffcc00']) },
          { scale: keys([0, 1], [1, 1.1]) },
        ],
      },
      {
        type: 'group', id: 'spin', props: { x: 1500, y: 300 }, tracks: { rotate: keys([0, 0], [2, 90]) },
        children: [{ type: 'path', id: 'spin-box', props: { d: 'M-60 -40H60V40H-60Z', fill: '#8e44ad', stroke: '#ffffff', strokeWidth: 6 } }],
      },
      { type: 'path', id: 'stepped', props: { d: 'M0 0H80V80H0Z', fill: '#f1c40f', y: 900 }, step: 12, tracks: { x: keys([0, 100], [2, 1200]) } },
      { type: 'path', id: 'wipe', props: { d: 'M900 100H1300V250H900Z', fill: '#2ecc71' }, tracks: { reveal: keys([0, 0.2], [2, 1]) } },
      { type: 'path', id: 'sketch', props: { d: 'M100 700H500V820H100Z', stroke: '#ecf0f1', strokeWidth: 4, rough: 6 } },
      { type: 'path', id: 'haze', props: { d: 'M1300 750H1500V900H1300Z', fill: '#3498db', blur: 8, opacity: 0.7 } },
    ],
  }],
};
const TL = buildTimeline(FILM, { fps: FPS });

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-stage-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'pic.png'), Buffer.from('not really a png'));
  writeFileSync(path.join(specDir, 'secret.txt'), 'outside the asset list');
  registries.kinds.add('pic', { schema: { properties: { src: { type: 'string' } } }, srcFields: ['src'], targets: () => [] });
});
after(() => rmSync(specDir, { recursive: true, force: true }));

// ---- brief tests ----

test('frame 40 hashes the same after seeking 40, 3, 40, and in a second browser', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  const h1 = await a.hashFrame(FRAME); await a.hashFrame(3); const h2 = await a.hashFrame(FRAME); await a.close();
  const b = await openStage(FILM); const h3 = await b.hashFrame(FRAME); await b.close();
  assert.equal(h1, h2); assert.equal(h1, h3);
});

test('the page makes no request off the loopback server', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  await a.hashFrame(0);
  assert.deepEqual(a.blocked, []); assert.deepEqual(a.errors, []); await a.close();
});

test('a request with a foreign Host header is refused', async () => {
  const s = await startV2Server({ film: FILM, timeline: TL, specDir });
  try {
    // fetch() drops a Host override (it is a forbidden header name), so it would reach the server with the right Host
    // and prove nothing; http.request sends what it is given.
    const refused = await get(s, '/', { host: 'evil.example' }).catch((e) => e);
    assert.ok(refused.status === 403 || refused instanceof Error, `got ${refused.status}`);
    assert.equal((await get(s, '/')).status, 200); // the same request with the right Host is served
  } finally { await s.close(); }
});

// ---- the page ----

test('the page reports its size, frame count and 2d post pass', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  assert.deepEqual(a.info, { frameCount: LAST_FRAME, fps: FPS, size: [1920, 1080], post: '2d' });
  await a.close();
});

test('frames differ over time and the frame is not blank', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  const first = await a.hashFrame(0); const middle = await a.hashFrame(FRAME); const last = await a.hashFrame(LAST_FRAME);
  assert.equal(new Set([first, middle, last]).size, 3); await a.close();
});

test('seeking a frame outside 0..frameCount throws', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  for (const bad of [-1, LAST_FRAME + 1, 1.5, Number.NaN]) {
    const message = await a.page.evaluate((i) => { try { window.__seek(i); return ''; } catch (e) { return e.message; } }, bad);
    assert.match(message, /frame/, `seek(${bad})`);
  }
  await a.close();
});

test('__snapshot gives each node a canvas-pixel bbox after camera and transforms', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  const byId = (nodes) => Object.fromEntries(nodes.map((n) => [n.id, n]));
  const at0 = byId(await a.page.evaluate(() => window.__snapshot(0)));
  assert.deepEqual(at0.tri.bbox, [100, 100, 300, 250]);
  const box = at0.spin.children[0];
  assert.deepEqual(box.bbox, [1437, 257, 126, 86]); // the 120x80 rect plus half its 6 px stroke
  assert.deepEqual(at0.spin.bbox, box.bbox);
  // camera at t = 2: pan 80, zoom 1.1 about the canvas centre; the node origin (0, 0) moves to (-176, -54)
  const end = byId(await a.page.evaluate((i) => window.__snapshot(i), LAST_FRAME));
  const [x, y, w, h] = end.tri.bbox;
  for (const [got, want] of [[x, -66], [y, 56], [w, 330], [h, 275]]) assert.ok(Math.abs(got - want) < 1e-6, `${got} vs ${want}`);
  const turned = byId(await a.page.evaluate((i) => window.__snapshot(i), FRAME));
  assert.deepEqual(turned.spin.bbox, turned.spin.children[0].bbox);
  assert.notDeepEqual(turned.spin.children[0].bbox.slice(2), box.bbox.slice(2)); // rotating a rectangle changes its box
  await a.close();
});

test('a text node carries its layout and the page measure agrees with the drawing', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  const [headline] = (await a.page.evaluate(() => window.__snapshot(0))).filter((n) => n.id === 'headline');
  assert.ok(headline.layout.lines.length >= 2, 'maxWidth 700 wraps the headline');
  assert.equal(headline.layout.lines.flatMap((l) => l.words).length, 5);
  const word = headline.layout.lines[0].words[0];
  const drawn = await a.page.evaluate((text) => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = '600 96px "Geist"'; ctx.letterSpacing = `${0.02 * 96}px`;
    return ctx.measureText(text).width;
  }, word.text);
  assert.ok(Math.abs(drawn - word.width) < 0.5, `layout width ${word.width} vs canvas ${drawn}`);
  await a.close();
});

test('__stateKey is stable for a frame and differs across frames', async (t) => {
  const a = await openStage(FILM); if (!a) return t.skip('no browser');
  const keysAt = await a.page.evaluate(() => [window.__stateKey(0), window.__stateKey(0), window.__stateKey(40)]);
  assert.equal(keysAt[0], keysAt[1]); assert.notEqual(keysAt[0], keysAt[2]); await a.close();
});

// ---- the free kind ----

const fakeMeasure = (text) => ({ width: [...text].length * 10, ascent: 8, descent: 2 });
const ctxFor = (extra = {}) => ({ canvas: { w: 1920, h: 1080 }, unit: 10.8, timing: TL.shots[0], measure: fakeMeasure, seed: 1, asset: () => { throw new Error('no assets'); }, ...extra });
const expandFree = (shot, extra) => registries.kinds.get('free').expand({ id: 's', show: 'free', ...shot }, ctxFor(extra));

test('free builds real nodes through node() and track()', () => {
  const { nodes } = expandFree({ nodes: [{ type: 'group', id: 'g', props: { x: 5 }, tracks: { x: keys([0, 0], [1, 10]) }, children: [{ type: 'path', id: 'p', props: { d: 'M0 0H1' } }] }] });
  assert.ok(isNode(nodes[0])); assert.ok(isNode(nodes[0].children[0]));
  assert.equal(sample(nodes[0].tracks.x, 0.5), 5);
});

test('free lays a text description out with the page measure when no layout is given', () => {
  const { nodes } = expandFree({ nodes: [{ type: 'text', id: 't', props: { text: 'aaa bbb ccc', font: { family: 'Geist', size: 20 }, maxWidth: 70 } }] });
  const { layout } = nodes[0].props;
  assert.equal(layout.lines.length, 2); assert.equal(layout.size, 20);
});

test('free keeps a ready layout and leaves a plain text node alone', () => {
  const layout = { size: 20, width: 10, height: 10, lines: [], overflow: false };
  const { nodes } = expandFree({ nodes: [{ type: 'text', id: 't', props: { layout, font: { family: 'Geist', size: 20 } } }] });
  assert.deepEqual(nodes[0].props.layout, layout);
});

test('free returns camera tracks and a background that defaults to black', () => {
  const plain = expandFree({ nodes: [] });
  assert.equal(plain.background, '#000000'); assert.equal(plain.camera, undefined);
  const moved = expandFree({ background: '#112233', camera: { zoom: keys([0, 1], [1, 2]) }, nodes: [] });
  assert.equal(moved.background, '#112233'); assert.equal(sample(moved.camera.zoom, 0.5), 1.5);
});

test('free names the node when its description is wrong', () => {
  assert.throws(() => expandFree({ nodes: [{ type: 'path', id: 'bad', props: { d: 'M0 0' }, tracks: { draw: { keys: [] } } }] }), /node "bad"/);
  assert.throws(() => expandFree({ nodes: [{ type: 'blob', id: 'x', props: {} }] }), /node "x".*unknown node type/);
  assert.throws(() => expandFree({ nodes: 'nope' }), /nodes/);
  assert.throws(() => expandFree({ nodes: [{ type: 'text', id: 't', props: { text: 'hi', maxWidth: 100 } }] }), /node "t".*font/);
});

test('node() is what free calls: a description and node() agree', () => {
  const built = node('group', 'g', { x: 1 });
  const { nodes } = expandFree({ nodes: [{ type: 'group', id: 'g', props: { x: 1 } }] });
  assert.deepEqual({ ...nodes[0] }, { ...built });
});

// ---- the loopback server ----

const get = (s, urlPath, headers = {}) => new Promise((resolve, reject) => {
  const { port } = new URL(s.url);
  http.get({ host: '127.0.0.1', port, path: urlPath, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  }).on('error', reject);
});

test('the server serves the page, engine modules, the two v1 modules and film.json under a CSP', async () => {
  const s = await startV2Server({ film: FILM, timeline: TL, specDir });
  try {
    const page = await get(s, '/');
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-security-policy'], "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'");
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    for (const ok of ['/engine/registry.mjs', '/engine/page/stage.mjs', '/shared/errors.mjs', '/v1/seeded.mjs', '/v1/formats.mjs', '/engine/fonts/shared/geist-sans-latin-600-normal.woff2']) {
      assert.equal((await get(s, ok)).status, 200, ok);
    }
    const film = JSON.parse((await get(s, '/film.json')).body.toString('utf8'));
    assert.equal(film.film.shots[0].id, 'all'); assert.equal(film.timeline.frameCount, LAST_FRAME);
  } finally { await s.close(); }
});

test('the server refuses everything outside its allow-list', async () => {
  const s = await startV2Server({ film: FILM, timeline: TL, specDir });
  try {
    for (const bad of ['/engine/../package.json', '/engine/%2e%2e/package.json', '/engine/..%2fpackage.json', '/engine/page%2fstage.mjs', '/engine/page\\stage.mjs', '/template/formats.mjs', '/v1/vars.mjs', '/engine/fonts/shared/../../package.json', '/package.json', '/node_modules/playwright/package.json', '/asset/../secret.txt']) {
      const { status } = await get(s, bad);
      assert.ok(status === 400 || status === 404, `${bad} -> ${status}`);
    }
    assert.equal((await get(s, '/engine/page/index.html')).status, 200);
    assert.equal((await get(s, '/engine/README.md')).status, 404); // extension not allow-listed
    assert.equal((await get(s, '/engine/fonts/shared/metrics.json')).status, 404);
    assert.equal((await get(s, '/engine/fonts/shared/geist-sans-latin-600-normal.woff2', { host: 'localhost' })).status, 403);
    const post = await new Promise((resolve) => {
      const { port } = new URL(s.url);
      const req = http.request({ host: '127.0.0.1', port, path: '/film.json', method: 'POST' }, (res) => { res.resume(); resolve(res.statusCode); });
      req.end();
    });
    assert.equal(post, 405);
  } finally { await s.close(); }
});

test('the server serves each src the film names by index and nothing else', async () => {
  const film ={ fps: FPS, shots: [{ id: 'p', show: 'pic', src: 'assets/pic.png', hold: 1 }] };
  const s = await startV2Server({ film, timeline: buildTimeline(film, { fps: FPS }), specDir });
  try {
    const hit = await get(s, '/asset/0');
    assert.equal(hit.status, 200); assert.equal(hit.headers['content-type'], 'image/png'); assert.equal(hit.body.toString(), 'not really a png');
    assert.equal((await get(s, '/asset/1')).status, 404);
    assert.equal((await get(s, '/asset/assets/pic.png')).status, 404);
    assert.equal((await get(s, '/asset/%30')).status, 400);
  } finally { await s.close(); }
});

test('the server refuses a film whose src leaves the spec directory', async () => {
  const outside = { fps: FPS, shots: [{ id: 'p', show: 'pic', src: '../secret.txt', hold: 1 }] };
  await assert.rejects(() => startV2Server({ film: outside, timeline: buildTimeline(outside, { fps: FPS }), specDir }), /src/);
  const missing = { fps: FPS, shots: [{ id: 'p', show: 'pic', src: 'assets/none.png', hold: 1 }] };
  await assert.rejects(() => startV2Server({ film: missing, timeline: buildTimeline(missing, { fps: FPS }), specDir }), /none\.png/);
});
