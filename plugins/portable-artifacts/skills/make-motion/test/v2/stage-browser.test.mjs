// The v2 render page: the `free` kind, the loopback server, and frames that repeat. Run with --test-concurrency=1.
// Every browser and server a test opens is released with t.after, so a failed assertion cannot leak one.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { deflateSync, crc32 } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { node, isNode } from '../../engine/graph/node.mjs';
import { sample } from '../../engine/time/track.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import '../../engine/kinds/index.mjs';
import { startV2Server, fileInside } from '../../scripts/v2/server.mjs';
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

// A solid-colour PNG, built by hand so a browser can decode it.
function solidPng(w, h, [r, g, b]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), ...Array.from({ length: w }, () => Buffer.from([r, g, b]))]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-stage-'));
  mkdirSync(path.join(specDir, 'assets'));
  writeFileSync(path.join(specDir, 'assets', 'pic.png'), solidPng(4, 4, RED));
  writeFileSync(path.join(specDir, 'assets', 'pic2.png'), solidPng(4, 4, BLUE));
  writeFileSync(path.join(specDir, 'secret.txt'), 'inside the folder but not an image');
  writeFileSync(path.join(specDir, 'assets', 'bad.png'), 'a .png name, but not a picture');
  registries.kinds.add('pic', { schema: { properties: { src: { type: 'string' } } }, srcFields: ['src'], targets: () => [] });
});
after(() => rmSync(specDir, { recursive: true, force: true }));

// A scratch folder (removed after the test) holding assets/pic.png, plus an outside folder beside it.
function scratchDir(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'mm-v2-scratch-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = path.join(base, 'film'), outside = path.join(base, 'outside');
  mkdirSync(path.join(dir, 'assets'), { recursive: true }); mkdirSync(outside);
  writeFileSync(path.join(dir, 'assets', 'pic.png'), solidPng(4, 4, RED));
  writeFileSync(path.join(outside, 'target.png'), solidPng(4, 4, BLUE));
  writeFileSync(path.join(dir, 'secret.txt'), 'not an image');
  return { dir, outside };
}

const stageFor = async (t, film, opts) => {
  const a = await openStage(film, opts);
  if (!a) { t.skip('no browser'); return null; }
  t.after(() => a.close());
  return a;
};
const serve = async (t, film, opts = {}) => {
  const s = await startV2Server({ film, timeline: buildTimeline(film, { fps: FPS }), specDir, ...opts });
  t.after(() => s.close());
  return s;
};
const picFilm = (src = 'assets/pic.png') => ({ fps: FPS, shots: [{ id: 'p', show: 'pic', src, hold: 1 }] });
// Pixels are read from window.__source, the 2D frame before the post pass: the visible canvas has grain on it.
const pixelAt = (a, x, y) => a.page.evaluate(([px, py]) => Array.from(window.__source.getContext('2d').getImageData(px, py, 1, 1).data), [x, y]);
const seekAndPixel = async (a, frame, x, y) => { await a.page.evaluate((i) => window.__seek(i), frame); return pixelAt(a, x, y); };

// ---- brief tests ----

test('frame 40 hashes the same after seeking 40, 3, 40, and in a second browser', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  const h1 = await a.hashFrame(FRAME); await a.hashFrame(3); const h2 = await a.hashFrame(FRAME); await a.close();
  const b = await stageFor(t, FILM); const h3 = await b.hashFrame(FRAME); await b.close();
  assert.equal(h1, h2); assert.equal(h1, h3);
});

test('the page makes no request off the loopback server', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  await a.hashFrame(0);
  assert.deepEqual(a.blocked, []); assert.deepEqual(a.errors, []);
});

test('a request with a foreign Host header is refused', async (t) => {
  const s = await serve(t, FILM);
  // fetch() drops a Host override (it is a forbidden header name), so it would reach the server with the right Host
  // and prove nothing; http.request sends what it is given.
  const refused = await get(s, '/', { host: 'evil.example' }).catch((e) => e);
  assert.ok(refused.status === 403 || refused instanceof Error, `got ${refused.status}`);
  assert.equal((await get(s, '/')).status, 200); // the same request with the right Host is served
});

// ---- the page ----

test('the page reports its size, frame count and which post pass it runs', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  assert.match(a.info.post, /^(webgl2|2d)$/);
  assert.deepEqual(a.info, { frameCount: LAST_FRAME, fps: FPS, size: [1920, 1080], post: a.info.post });
});

test('frames differ over time and the frame is not blank', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  const first = await a.hashFrame(0); const middle = await a.hashFrame(FRAME); const last = await a.hashFrame(LAST_FRAME - 1);
  assert.equal(new Set([first, middle, last]).size, 3);
});

test('seeking a frame outside 0..frameCount - 1 throws, and so does the frame at frameCount, which can be sampled but not drawn', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  for (const bad of [-1, LAST_FRAME, LAST_FRAME + 1, 1.5, Number.NaN]) {
    const message = await a.page.evaluate((i) => { try { window.__seek(i); return ''; } catch (e) { return e.message; } }, bad);
    assert.match(message, /frame/, `seek(${bad})`);
  }
});

test('__snapshot gives each node a canvas-pixel bbox after camera and transforms', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
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
});

test('a text node carries its layout and the page measure agrees with the drawing', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
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
});

test('measure returns font-level ascent and descent, not per-glyph ones', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  const font = { family: 'Geist', weight: 600, size: 96 };
  const [x, tall] = await a.page.evaluate((f) => [window.__measure('x', f), window.__measure('Ålg', f)], font);
  assert.ok(x.ascent > 0 && x.descent > 0);
  assert.equal(x.ascent, tall.ascent); assert.equal(x.descent, tall.descent);
  assert.ok(tall.width > x.width);
});

// A one-shot free film with the given nodes, for drawing-rule comparisons.
const filmOf = (nodes) => ({ fps: FPS, shots: [{ id: 's', show: 'free', hold: 1, nodes }] });
const hashOf = async (t, film) => {
  const a = await stageFor(t, film); if (!a) return null;
  return a.hashFrame(0);
};
const box = (id, extra = {}) => ({ type: 'path', id, props: { d: 'M100 100H500V400H100Z', fill: '#e2574c', ...extra } });

test('opacity above 1 is clamped, so a child cannot out-shine its parent', async (t) => {
  const over = await hashOf(t, filmOf([{ type: 'group', id: 'g', props: { opacity: 0.5 }, children: [box('b', { opacity: 1.5 })] }]));
  const exact = await hashOf(t, filmOf([{ type: 'group', id: 'g', props: { opacity: 0.5 }, children: [box('b', { opacity: 1 })] }]));
  if (over === null) return;
  assert.equal(over, exact);
});

test('a word beyond wordTracks draws untouched, as one with an identity entry does', async (t) => {
  const text = { text: 'one two three', font: { family: 'Geist', weight: 600, size: 96 }, maxWidth: 1600, fill: '#ffffff', x: 100, y: 100 };
  const short = await hashOf(t, filmOf([{ type: 'text', id: 'w', props: text, wordTracks: [{ opacity: keys([0, 0.5]) }] }]));
  const full = await hashOf(t, filmOf([{ type: 'text', id: 'w', props: text, wordTracks: [{ opacity: keys([0, 0.5]) }, {}, {}] }]));
  if (short === null) return;
  assert.equal(short, full);
});

test('a text node box is the union of its words after each word x, y and scale', async (t) => {
  const font = { family: 'Geist', weight: 600, size: 96 };
  const props = { x: 100, y: 100, text: 'Hi', font, maxWidth: 1000 };
  const a = await stageFor(t, filmOf([
    { type: 'text', id: 'plain', props },
    { type: 'text', id: 'moved', props, wordTracks: [{ x: keys([0, 50]), scale: keys([0, 2]) }] },
  ])); if (!a) return;
  const [plain, moved] = await a.page.evaluate(() => window.__snapshot(0));
  const { width: w } = plain.layout.lines[0].words[0], { height: H } = plain.layout, ascent = plain.layout.lines[0].y;
  const near = (got, want, what) => assert.ok(Math.abs(got - want) < 1e-6, `${what}: ${got} vs ${want}`);
  [100, 100, w, H].forEach((want, i) => near(plain.bbox[i], want, `plain[${i}]`));
  // scale 2 about the word centre (x + w/2 + 50, baseline): twice as wide and tall, left edge at 50 - w/2
  [150 - w / 2, 100 - ascent, 2 * w, 2 * H].forEach((want, i) => near(moved.bbox[i], want, `moved[${i}]`));
});

test('blur is reported as a separate spread and does not widen the box', async (t) => {
  const a = await stageFor(t, filmOf([box('sharp'), box('soft', { blur: 8 })])); if (!a) return;
  const [sharp, soft] = await a.page.evaluate(() => window.__snapshot(0));
  assert.deepEqual(soft.bbox, [100, 100, 400, 300]); assert.deepEqual(soft.bbox, sharp.bbox);
  assert.equal(sharp.spread, 0); assert.equal(soft.spread, 24);
});

test('reveal clips a node and its children: a group at 0.5 shows the left half of its subtree', async (t) => {
  const part = (id, d, fill) => ({ type: 'path', id, props: { d, fill } });
  const a = await stageFor(t, filmOf([{
    type: 'group', id: 'g', props: { reveal: 0.5 },
    children: [part('left', 'M100 100H300V300H100Z', '#ff0000'), part('right', 'M500 100H700V300H500Z', '#00ff00')],
  }])); if (!a) return;
  assert.deepEqual(await seekAndPixel(a, 0, 200, 200), [255, 0, 0, 255]);
  assert.deepEqual(await seekAndPixel(a, 0, 600, 200), [0, 0, 0, 255]); // the right child is outside the left half of 100..700
});

test('blend multiply lets the ink below show through; without blend the same rectangle covers it', async (t) => {
  const word = (id, x) => ({ type: 'text', id, props: { x, y: 100, text: 'M', font: { family: 'Geist', weight: 600, size: 400 }, maxWidth: 1000, fill: '#000000' } });
  const slab = (id, x, extra) => ({ type: 'path', id, props: { d: `M${x} 60H${x + 500}V560H${x}Z`, fill: '#ffe14a', ...extra } });
  const film = { fps: FPS, shots: [{ id: 's', show: 'free', hold: 1, background: '#ffffff', nodes: [
    word('ink-left', 100), slab('multiplied', 60, { blend: 'multiply' }),
    word('ink-right', 740), slab('plain', 700, {}),
  ] }] };
  const a = await stageFor(t, film); if (!a) return;
  await a.page.evaluate(() => window.__seek(0));
  const count = (x) => a.page.evaluate((left) => {
    const { data } = window.__source.getContext('2d').getImageData(left, 60, 500, 500);
    let dark = 0, yellow = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] + data[i + 1] + data[i + 2] < 90) dark++;
      if (data[i] > 240 && data[i + 1] > 200 && data[i + 2] < 120) yellow++;
    }
    return { dark, yellow };
  }, x);
  const left = await count(60), right = await count(700);
  assert.ok(left.dark > 2000, `multiplied: the letter stays dark (${left.dark} dark pixels)`);
  assert.ok(left.yellow > 20000, `multiplied: the paper turns yellow (${left.yellow})`);
  assert.equal(right.dark, 0, 'plain: the yellow rectangle covers the letter');
});

test('an unknown blend names the node and the accepted modes', async (t) => {
  const film = { fps: FPS, shots: [{ id: 's', show: 'free', hold: 1, nodes: [box('b', { blend: 'dodge' })] }] };
  const a = await stageFor(t, film); if (!a) return;
  await assert.rejects(a.page.evaluate(() => window.__seek(0)), /node "b": blend must be one of multiply, screen, overlay, lighter, got "dodge"/);
});

const BAD_LAYOUT = { size: 20, width: 10, height: 10, overflow: false, lines: [{ x: 0, y: 16, width: 10, words: [{ text: 'a', index: 0, x: 0, width: 10 }] }] };

test('a seek after a failed seek equals a first seek', async (t) => {
  const a = await stageFor(t, filmOf([
    { ...box('b'), tracks: { x: keys([0, 0], [1, 300]) } }, // moves, so a frame left half-drawn differs from frame 0
    { // invisible at frame 0; from frame 1 it draws and throws on its font width, after the clip and alpha are set
      type: 'text', id: 'bad', props: { x: 50, y: 50, layout: BAD_LAYOUT, font: { family: 'Geist', size: 20, width: 'bogus' }, reveal: 0.1 },
      tracks: { opacity: keys([0, 0], [1, 1]) },
    },
  ])); if (!a) return;
  const first = await a.hashFrame(0);
  const message = await a.page.evaluate(() => { try { window.__seek(15); return ''; } catch (e) { return e.message; } });
  assert.match(message, /font\.width/);
  assert.equal(await a.hashFrame(0), first);
});

const IMAGE_FILM = {
  fps: FPS,
  shots: [
    { id: 'red', show: 'free', srcs: ['assets/pic.png'], hold: 1, nodes: [{ type: 'image', id: 'r', props: { src: 'assets/pic.png', x: 100, y: 100, w: 400, h: 300 } }] },
    {
      id: 'blue', show: 'free', srcs: ['assets/pic2.png'], hold: 1, background: '#202020',
      nodes: [{ type: 'image', id: 'b', props: { src: 'assets/pic2.png', y: 100, w: 400, h: 300 }, tracks: { x: keys([0, 100], [1, 400]) } }],
    },
  ],
};

test('two shots each draw their own image through /asset/<n>, and a shot samples from its own start', async (t) => {
  const a = await stageFor(t, IMAGE_FILM, { specDir }); if (!a) return;
  assert.equal(a.info.frameCount, 60);
  assert.deepEqual(await seekAndPixel(a, 0, 200, 200), [255, 0, 0, 255]);
  assert.deepEqual(await seekAndPixel(a, 29, 200, 200), [255, 0, 0, 255]);
  assert.deepEqual(await seekAndPixel(a, 30, 200, 200), [0, 0, 255, 255]); // shot 2 owns frame 30; its own asset 0 is /asset/1
  const at = async (i) => (await a.page.evaluate((n) => window.__snapshot(n), i))[0].bbox;
  assert.deepEqual(await at(30), [100, 100, 400, 300]); // local time 0
  assert.deepEqual(await at(45), [250, 100, 400, 300]); // local time 0.5: x halfway from 100 to 400
  assert.deepEqual(await seekAndPixel(a, 45, 200, 200), [32, 32, 32, 255]); // the image has moved off this pixel
  assert.deepEqual(a.errors, []);
});

test('two shots may declare the same src, and an image takes its own size when none is given', async (t) => {
  const image = { type: 'image', id: 'i', props: { src: 'assets/pic.png', x: 100, y: 100 } };
  const a = await stageFor(t, {
    fps: FPS,
    shots: [{ id: 'one', show: 'free', srcs: ['assets/pic.png'], hold: 1, nodes: [image] }, { id: 'two', show: 'free', srcs: ['assets/pic.png'], hold: 1, nodes: [image] }],
  }, { specDir }); if (!a) return;
  assert.deepEqual(await seekAndPixel(a, 0, 101, 101), [255, 0, 0, 255]);
  assert.deepEqual(await seekAndPixel(a, 30, 101, 101), [255, 0, 0, 255]);
  assert.deepEqual((await a.page.evaluate(() => window.__snapshot(0)))[0].bbox, [100, 100, 4, 4]); // the 4x4 picture
});

test('an image whose src the shot does not declare stops the page, naming the shot and the src', async (t) => {
  const film = { fps: FPS, shots: [{ id: 'lone', show: 'free', srcs: ['assets/pic.png'], hold: 1, nodes: [{ type: 'image', id: 'i', props: { src: 'assets/pic2.png' } }] }] };
  let stage;
  try {
    stage = await openStage(film, { specDir });
  } catch (err) {
    assert.match(err.message, /shot "lone".*assets\/pic2\.png/);
    return;
  }
  if (stage === null) return t.skip('no browser');
  await stage.close();
  assert.fail('the page started although the shot does not declare the image');
});

test('the CSP stops an inline script from running', async (t) => {
  const a = await stageFor(t, FILM); if (!a) return;
  const ran = await a.page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__inlineRan = true';
    document.head.append(script);
    return window.__inlineRan === true;
  });
  assert.equal(ran, false);
});

// ---- the free kind ----

const fakeMeasure = (text) => ({ width: [...text].length * 10, ascent: 8, descent: 2 });
const ctxFor = (extra = {}) => ({ canvas: { w: 1920, h: 1080 }, unit: 1, timing: TL.shots[0], measure: fakeMeasure, seed: 1, asset: () => { throw new Error('no assets'); }, ...extra });
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

test('free asks ctx.asset(src) for an image node and defaults its size from the answer', () => {
  const asked = [];
  const asset = (src) => { asked.push(src); return { width: 40, height: 30 }; };
  const { nodes } = expandFree({ srcs: ['a.png'], nodes: [{ type: 'image', id: 'i', props: { src: 'a.png' } }, { type: 'image', id: 'j', props: { src: 'a.png', w: 5 } }] }, { asset });
  assert.deepEqual({ ...nodes[0].props }, { src: 'a.png', w: 40, h: 30 });
  assert.deepEqual({ ...nodes[1].props }, { src: 'a.png', w: 5, h: 30 });
  assert.deepEqual(asked, ['a.png', 'a.png']);
  assert.throws(() => expandFree({ nodes: [{ type: 'image', id: 'i', props: {} }] }), /node "i".*src/);
  assert.throws(() => expandFree({ nodes: [{ type: 'image', id: 'k', props: { src: 'b.png' } }] }), /node "k".*no assets/); // ctx.asset's own error passes through
});

test('free declares its srcs array as the shot field the server serves', () => {
  assert.deepEqual(registries.kinds.get('free').srcFields, ['srcs']);
});

test('node() is what free calls: a description and node() agree', () => {
  const built = node('group', 'g', { x: 1 });
  const { nodes } = expandFree({ nodes: [{ type: 'group', id: 'g', props: { x: 1 } }] });
  assert.deepEqual({ ...nodes[0] }, { ...built });
});

// ---- the loopback server ----

const request = (s, urlPath, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const { port } = new URL(s.url);
  const req = http.request({ host: '127.0.0.1', port, path: urlPath, method, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});
const get = (s, urlPath, headers = {}) => request(s, urlPath, { headers });
const rawRequest = (s, text) => new Promise((resolve, reject) => {
  const { port } = new URL(s.url);
  const socket = net.connect(port, '127.0.0.1', () => socket.write(text));
  const chunks = [];
  socket.on('data', (c) => chunks.push(c));
  socket.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
  socket.on('error', reject);
});
const portOf = (s) => new URL(s.url).port;
const CSP = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

test('the server serves the page, engine modules, the v1 formats module and film.json under a CSP', async (t) => {
  const s = await serve(t, FILM);
  const page = await get(s, '/');
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-security-policy'], CSP);
  assert.equal(page.headers['x-content-type-options'], 'nosniff');
  assert.equal(page.headers['cross-origin-resource-policy'], 'same-origin');
  for (const ok of ['/engine/registry.mjs', '/engine/page/stage.mjs', '/shared/errors.mjs', '/engine/seeded.mjs', '/v1/formats.mjs', '/engine/fonts/shared/geist-sans-latin-600-normal.woff2']) {
    const res = await get(s, ok);
    assert.equal(res.status, 200, ok);
    assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin', ok);
  }
  const film = JSON.parse((await get(s, '/film.json')).body.toString('utf8'));
  assert.equal(film.film.shots[0].id, 'all'); assert.equal(film.timeline.frameCount, LAST_FRAME);
});

test('the server refuses everything outside its allow-list', async (t) => {
  const s = await serve(t, FILM);
  for (const bad of ['/engine/../package.json', '/engine/%2e%2e/package.json', '/engine/..%2fpackage.json', '/engine/page%2fstage.mjs', '/engine/page\\stage.mjs', '/template/formats.mjs', '/template/seeded.mjs', '/v1/seeded.mjs', '/v1/vars.mjs', '/engine/fonts/shared/../../package.json', '/package.json', '/node_modules/playwright/package.json', '/asset/../secret.txt']) {
    const { status } = await get(s, bad);
    assert.ok(status === 400 || status === 404, `${bad} -> ${status}`);
  }
  assert.equal((await get(s, '/engine/page/index.html')).status, 200);
  assert.equal((await get(s, '/engine/README.md')).status, 404); // extension not allow-listed
  assert.equal((await get(s, '/engine/fonts/shared/metrics.json')).status, 404);
  const post = await request(s, '/film.json', { method: 'POST' });
  assert.equal(post.status, 405); assert.equal(post.headers.allow, 'GET, HEAD');
});

test('the server answers only the Host headers of its own port', async (t) => {
  const s = await serve(t, FILM);
  const port = portOf(s);
  assert.equal((await get(s, '/', { host: `localhost:${port}` })).status, 200);
  assert.equal((await get(s, '/', { host: `127.0.0.1:${port}` })).status, 200);
  for (const host of [`[::1]:${port}`, 'localhost', `localhost:${Number(port) + 1}`, `127.0.0.1.evil.example:${port}`]) {
    assert.equal((await get(s, '/', { host })).status, 403, `Host "${host}"`);
  }
  assert.match(await rawRequest(s, 'GET / HTTP/1.0\r\n\r\n'), /^HTTP\/1\.1 403 /); // no Host line at all
  assert.equal((await get(s, '/engine/page/stage.mjs', { host: 'evil.example' })).status, 403);
});

test('HEAD answers with the headers and no body', async (t) => {
  const s = await serve(t, FILM);
  const head = await request(s, '/engine/page/stage.mjs', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal(head.headers['content-type'], 'text/javascript; charset=utf-8'); assert.equal(head.body.length, 0);
});

test('fileInside refuses a symlink that leaves its root and a missing file, and passes a real one', (t) => {
  const { dir, outside } = scratchDir(t);
  writeFileSync(path.join(dir, 'inside.mjs'), 'export {};');
  writeFileSync(path.join(outside, 'outside.mjs'), 'export {};');
  symlinkSync(path.join(outside, 'outside.mjs'), path.join(dir, 'escape.mjs'));
  symlinkSync('inside.mjs', path.join(dir, 'alias.mjs'));
  symlinkSync('loop.mjs', path.join(dir, 'loop.mjs'));
  assert.equal(fileInside(dir, path.join(dir, 'escape.mjs')), null);
  assert.equal(fileInside(dir, path.join(dir, 'none.mjs')), null);
  assert.equal(fileInside(dir, path.join(dir, 'inside.mjs')), path.join(dir, 'inside.mjs'));
  assert.equal(fileInside(dir, path.join(dir, 'alias.mjs')), path.join(dir, 'inside.mjs')); // an inside symlink resolves
  assert.throws(() => fileInside(dir, path.join(dir, 'loop.mjs')), /ELOOP/); // a real filesystem error is not "not found"
});

test('the server serves each src the film names by index and nothing else', async (t) => {
  const s = await serve(t, picFilm());
  const hit = await get(s, '/asset/0');
  assert.equal(hit.status, 200); assert.equal(hit.headers['content-type'], 'image/png'); assert.deepEqual(hit.body, solidPng(4, 4, RED));
  assert.equal((await get(s, '/asset/1')).status, 404);
  assert.equal((await get(s, '/asset/assets/pic.png')).status, 404);
  assert.equal((await get(s, '/asset/%30')).status, 400);
});

test('the server refuses a film whose src leaves the spec directory or is not an image', async (t) => {
  await assert.rejects(() => startV2Server({ film: picFilm('../secret.txt'), timeline: buildTimeline(picFilm('../secret.txt'), { fps: FPS }), specDir }), /src/);
  await assert.rejects(() => serve(t, picFilm('assets/none.png')), /none\.png/);
  await assert.rejects(() => serve(t, picFilm('secret.txt')), /png, jpg, webp or gif/);
  const { dir, outside } = scratchDir(t);
  symlinkSync(path.join(outside, 'target.png'), path.join(dir, 'assets', 'escape.png'));
  symlinkSync(path.join(dir, 'secret.txt'), path.join(dir, 'assets', 'text.png'));
  await assert.rejects(() => serve(t, picFilm('assets/escape.png'), { specDir: dir }), /inside the film's folder/); // an image, but outside
  await assert.rejects(() => serve(t, picFilm('assets/text.png'), { specDir: dir }), /png, jpg, webp or gif/); // inside, but the real file is text
});

test('an asset swapped for a link out of the folder after start is refused when served', async (t) => {
  const { dir, outside } = scratchDir(t);
  const s = await serve(t, picFilm(), { specDir: dir });
  assert.equal((await get(s, '/asset/0')).status, 200);
  unlinkSync(path.join(dir, 'assets', 'pic.png'));
  symlinkSync(path.join(outside, 'target.png'), path.join(dir, 'assets', 'pic.png'));
  assert.equal((await get(s, '/asset/0')).status, 404);
  unlinkSync(path.join(dir, 'assets', 'pic.png'));
  symlinkSync(path.join(dir, 'secret.txt'), path.join(dir, 'assets', 'pic.png'));
  assert.equal((await get(s, '/asset/0')).status, 404); // inside the folder, but no longer an image
});

test('a 500 says only "internal error" and the detail goes to onError', async (t) => {
  const { dir } = scratchDir(t);
  const seen = [];
  const s = await serve(t, picFilm(), { specDir: dir, onError: (err) => seen.push(err) });
  unlinkSync(path.join(dir, 'assets', 'pic.png'));
  symlinkSync('pic.png', path.join(dir, 'assets', 'pic.png')); // a link loop: ELOOP, a real error rather than a miss
  const res = await get(s, '/asset/0');
  assert.equal(res.status, 500); assert.equal(res.body.toString(), 'internal error');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.ok(!res.body.toString().includes(dir));
  assert.equal(seen.length, 1); assert.match(seen[0].message, /ELOOP/);
});

test('a server error after listen is reported through onError, and close() twice is fine', async (t) => {
  const seen = [];
  const s = await startV2Server({ film: FILM, timeline: TL, specDir, onError: (err) => seen.push(err) });
  t.after(() => s.close());
  s.server.emit('error', new Error('boom'));
  assert.equal(seen.length, 1); assert.equal(seen[0].message, 'boom');
  await s.close();
  await s.close();
});

// ---- round 2: asset list, caps, decode errors, callbacks, stream errors ----

const run = promisify(execFile);
const freeFilm = (...shotSrcs) => ({ fps: FPS, shots: shotSrcs.map((srcs, i) => ({ id: `s${i}`, show: 'free', srcs, hold: 1 })) });
const filmJsonOf = async (s) => JSON.parse((await get(s, '/film.json')).body.toString('utf8'));

test('a fresh process that imports only the server has the kinds registered and serves the film images', async () => {
  const url = (file) => JSON.stringify(pathToFileURL(path.resolve(import.meta.dirname, file)).href);
  const code = `
    import { startV2Server } from ${url('../../scripts/v2/server.mjs')};
    import { buildTimeline } from ${url('../../engine/script/timing.mjs')};
    const film = { fps: 30, shots: [{ id: 's', show: 'free', srcs: ['assets/pic.png'], hold: 1 }] };
    const s = await startV2Server({ film, timeline: buildTimeline(film, { fps: 30 }), specDir: ${JSON.stringify(specDir)} });
    const meta = await (await fetch(s.url + 'film.json')).json();
    const asset = await fetch(s.url + 'asset/0');
    console.log(JSON.stringify({ assets: meta.assets, status: asset.status }));
    await s.close();`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', code]);
  assert.deepEqual(JSON.parse(stdout), { assets: ['assets/pic.png'], status: 200 });
});

test('film.json lists the distinct src strings in index order, one file per string', async (t) => {
  const s = await serve(t, freeFilm(['assets/pic.png'], ['assets/pic.png', 'assets/pic2.png']));
  assert.deepEqual((await filmJsonOf(s)).assets, ['assets/pic.png', 'assets/pic2.png']);
  assert.deepEqual((await get(s, '/asset/0')).body, solidPng(4, 4, RED));
  assert.deepEqual((await get(s, '/asset/1')).body, solidPng(4, 4, BLUE));
  assert.equal((await get(s, '/asset/2')).status, 404);
});

test('a film may name at most 64 distinct images, and free takes at most 16 per shot', async (t) => {
  const many = { fps: FPS, shots: Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, show: 'pic', src: `assets/missing-${i}.png`, hold: 1 })) };
  await assert.rejects(() => serve(t, many), /a film may use at most 64 images; this one names 65/);
  assert.equal(registries.kinds.get('free').schema.properties.srcs.maxItems, 16);
});

test('an image that cannot be decoded rejects __ready naming the src', async (t) => {
  const film = freeFilm(['assets/bad.png']);
  let stage;
  try {
    stage = await openStage(film, { specDir });
  } catch (err) {
    assert.match(err.message, /image "assets\/bad\.png" could not be loaded: /);
    return;
  }
  if (stage === null) return t.skip('no browser');
  await stage.close();
  assert.fail('the page started with an undecodable image');
});

test('a throwing onError cannot crash the server', async (t) => {
  const { dir } = scratchDir(t);
  const calls = [];
  const s = await serve(t, picFilm(), { specDir: dir, onError: (err) => { calls.push(err); throw new Error('callback failed'); } });
  unlinkSync(path.join(dir, 'assets', 'pic.png'));
  symlinkSync('pic.png', path.join(dir, 'assets', 'pic.png'));
  assert.equal((await get(s, '/asset/0')).status, 500);
  assert.doesNotThrow(() => s.server.emit('error', new Error('later')));
  assert.equal(calls.length, 2);
  assert.equal((await get(s, '/')).status, 200); // still serving
});

test('a read error after the headers are sent is reported and the response destroyed', async (t) => {
  if (process.getuid?.() === 0) return t.skip('root can read a mode 000 file');
  const { dir } = scratchDir(t);
  const seen = [];
  const s = await serve(t, picFilm(), { specDir: dir, onError: (err) => seen.push(err) });
  const file = path.join(dir, 'assets', 'pic.png');
  chmodSync(file, 0o000); // stat still works, so the headers go out; opening for read then fails (rm still removes it)
  const outcome = await get(s, '/asset/0').catch((err) => err);
  assert.ok(outcome instanceof Error || outcome.body.length === 0, 'the client must not get the file');
  assert.equal(seen.length, 1); assert.equal(seen[0].code, 'EACCES');
});

test('/asset/<n> takes only a canonical non-negative integer', async (t) => {
  const s = await serve(t, picFilm());
  assert.equal((await get(s, '/asset/0')).status, 200);
  for (const bad of ['/asset/00', '/asset/01', '/asset/1.0', '/asset/1e1', '/asset/0x0']) {
    assert.equal((await get(s, bad)).status, 404, bad);
  }
  // A leading sign or an empty segment is refused earlier still, as a bad path (400): never served.
  for (const bad of ['/asset/+1', '/asset/-1', '/asset/']) assert.ok([400, 404].includes((await get(s, bad)).status), bad);
});

test('a text node whose layout has no words has a zero box at its position, never NaN', async (t) => {
  const emptyLine = { size: 20, width: 0, height: 0, overflow: false, lines: [{ x: 0, y: 16, width: 0, words: [] }] };
  const a = await stageFor(t, filmOf([{ type: 'text', id: 'empty', props: { x: 120, y: 80, layout: emptyLine, font: { family: 'Geist', size: 20 } } }])); if (!a) return;
  const [empty] = await a.page.evaluate(() => window.__snapshot(0));
  assert.deepEqual(empty.bbox, [120, 80, 0, 0]);
});
