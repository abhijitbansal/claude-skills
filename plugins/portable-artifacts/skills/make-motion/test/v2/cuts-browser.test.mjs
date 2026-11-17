// The two-picture cuts in the page (transitions plan Tasks 3 and 4): a layer cut composes the outgoing picture (drawn
// once per shot and kept) and the incoming one in canvas 2D before the post pass. Flat red into flat blue, grain 0, read
// from window.__source (the frame before the post pass). One browser at a time: run with --test-concurrency=1; skips
// without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOrNull } from './helpers/session.mjs';
import { sessionFindings } from '../../scripts/v2/review.mjs';

const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const MID = START + 6; // p 0.5 of a 0.4 s window (12 frames)
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const PALETTE = { paper: '#f3eee3', accent: '#ffe14a', accent2: '#d63a2f', ink: '#15130f', ink2: '#5b554a', rule: '#cfc7b6' };

const flat = (id, background, cut, nodes = []) => ({ id, show: 'free', hold: 1, background, nodes, ...(cut ? { cut } : {}) });
const film = (cut, nodes) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [flat('a', '#ff0000', undefined, nodes), flat('b', '#0000ff', cut, nodes)] });
// an animated field (mesh: its blobs sway with the time), drawn in both shots
const MESH = [{ type: 'field', id: 'mesh', props: { field: 'mesh', params: {}, w: 1920, h: 1080, unit: 1, seed: 1, palette: PALETTE } }];

async function open(t, f) {
  const session = await sessionOrNull(f);
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
  return session;
}

// [r, g, b] of the 2D frame at each point after seeking `frame`.
const pixelsAt = (s, frame, points) => s.page.evaluate(([i, list]) => {
  window.__seek(i);
  const ctx = window.__source.getContext('2d');
  return list.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, [frame, points]);

// A hash of the whole 2D frame after seeking `frame` (FNV-1a over its bytes).
const frameHash = (s, frame) => s.page.evaluate((i) => {
  window.__seek(i);
  const { data } = window.__source.getContext('2d').getImageData(0, 0, window.__source.width, window.__source.height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return h;
}, frame);

const near = (actual, expected, levels, label) => {
  actual.forEach((v, k) => assert.ok(Math.abs(v - expected[k]) <= levels, `${label}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`));
};

test('wipe from the left at mid-window: the left half is the incoming blue, the right half the outgoing red', async (t) => {
  const s = await open(t, film({ type: 'wipe', direction: 'left' })); if (!s) return;
  const left = [[100, 200], [400, 800], [700, 200], [900, 800]];
  const right = [[1020, 200], [1300, 800], [1600, 200], [1850, 800]];
  const got = await pixelsAt(s, MID, [...left, ...right]);
  got.slice(0, 4).forEach((px, k) => near(px, BLUE, 1, `left ${left[k]}`));
  got.slice(4).forEach((px, k) => near(px, RED, 1, `right ${right[k]}`));
  assert.deepEqual(s.errors, []);
});

test('crossfade at mid-window is the mean of the two colours', async (t) => {
  const s = await open(t, film('crossfade')); if (!s) return;
  const [px] = await pixelsAt(s, MID, [[960, 540]]);
  near(px, [127.5, 0, 127.5], 2, 'centre');
});

test('iris at mid-window: the centre is the incoming colour, a corner the outgoing one', async (t) => {
  const s = await open(t, film('iris')); if (!s) return;
  const [centre, corner] = await pixelsAt(s, MID, [[960, 540], [4, 4]]);
  near(centre, BLUE, 1, 'centre');
  near(corner, RED, 1, 'corner');
});

test('a layer window\'s first frame is the outgoing picture and the frame after it the incoming one', async (t) => {
  const s = await open(t, film({ type: 'wipe', direction: 'right' })); if (!s) return;
  const [first] = await pixelsAt(s, START, [[1900, 540]]);
  const [after] = await pixelsAt(s, START + 12, [[10, 540]]);
  near(first, RED, 0, 'p 0');
  near(after, BLUE, 0, 'after the window');
});

test('held frames: a crossfade between two still shots is never held, the stills on either side are', async (t) => {
  const s = await open(t, film('crossfade')); if (!s) return;
  const flags = (from, to) => s.page.evaluate(([a, b]) => window.__heldFlags(a, b), [from, to]);
  assert.deepEqual(await flags(START + 1, START + 11), Array(11).fill(false), 'inside the window');
  assert.deepEqual(await flags(20, START - 1), Array(10).fill(true), 'before the window');
  assert.deepEqual(await flags(START + 13, 55), Array(55 - START - 12).fill(true), 'after the window');
});

test('seek order: the frames of a window read forwards, then backwards, and backwards in a fresh page, hash the same (an animated field included)', async (t) => {
  const s = await open(t, film('crossfade', MESH)); if (!s) return;
  const frames = Array.from({ length: 12 }, (_, k) => START + k);
  const forwards = [];
  for (const i of frames) forwards.push(await frameHash(s, i));
  const backwards = [];
  for (const i of [...frames].reverse()) backwards.unshift(await frameHash(s, i));
  assert.deepEqual(backwards, forwards);
  await frameHash(s, 50);
  assert.equal(await frameHash(s, START + 5), forwards[5], 'after a seek outside the window');
  await s.close();
  // a fresh page draws its outgoing picture on the window's last frame first: it must be the same picture
  const fresh = await open(t, film('crossfade', MESH));
  const reversed = [];
  for (const i of [...frames].reverse()) reversed.unshift(await frameHash(fresh, i));
  assert.deepEqual(reversed, forwards);
});

test('a film with no layer or shader cut makes no second picture; a film with one does', async (t) => {
  const plain = await open(t, film('slide')); if (!plain) return;
  for (const i of [START, MID, START + 11]) await plain.page.evaluate((f) => window.__seek(f), i);
  assert.equal(await plain.page.evaluate(() => window.__cutCanvases()), 0);
  const layered = await open(t, film('fade'));
  await layered.page.evaluate((f) => window.__seek(f), MID);
  assert.ok(await layered.page.evaluate(() => window.__cutCanvases()) > 0);
});

// ---- shader cuts (Task 4): read from the visible canvas, where the post pass draws them ----

const SHADER_FRAMES = 18; // a 0.6 s window at 30 fps
const SHADER_MID = START + SHADER_FRAMES / 2;
const NO_GL = "const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : get.call(this, kind, ...rest); };";
// Breaks only the cut shaders (their source holds getFromColor), not the post pass's own program.
const BREAK_CUTS = "const real = WebGL2RenderingContext.prototype.shaderSource; WebGL2RenderingContext.prototype.shaderSource = function (shader, source) { return real.call(this, shader, source.includes('getFromColor') ? `${source}\\nthis is not glsl;` : source); };";
const WHITE = [255, 255, 255];
const square = (id, d) => ({ type: 'path', id, props: { d, fill: '#ffffff' } });
// shot a: red with a white square in its top-left corner; shot b: blue with one in its bottom-right corner, so a picture
// drawn upside down or mirrored cannot pass for the right one
const marked = (cut, extra = []) => ({
  version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [
    flat('a', '#ff0000', undefined, [square('ma', 'M0 0H200V200H0Z')]),
    flat('b', '#0000ff', cut, [square('mb', 'M1720 880H1920V1080H1720Z')]),
    ...extra,
  ],
});

async function openWith(t, f, options) {
  const session = await sessionOrNull(f, options);
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
  return session;
}

// [r, g, b] of the visible canvas at each point after seeking `frame` (with the cut's progress set to `progress` when given).
const shownAt = (s, frame, points, progress = null) => s.page.evaluate(([i, list, p]) => {
  window.__seek(i, p === null ? {} : { progress: p });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  return list.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)]);
}, [frame, points, progress]);

// A hash of the whole visible canvas after seeking `frame` (FNV-1a over its bytes).
const shownHash = (s, frame, progress = null) => s.page.evaluate(([i, p]) => {
  window.__seek(i, p === null ? {} : { progress: p });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data } = ctx.getImageData(0, 0, stage.width, stage.height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return h;
}, [frame, progress]);

// Sixteen points: the two corner marks and fourteen spread over the frame.
const SIXTEEN = [[100, 100], [1820, 980], [960, 540], [100, 980], [1820, 100], [480, 270], [1440, 270], [480, 810], [1440, 810], [960, 60], [960, 1020], [60, 540], [1860, 540], [300, 700], [1600, 400], [1200, 900]];
const outgoingAt = ([x, y]) => (x < 200 && y < 200 ? WHITE : RED);
const incomingAt = ([x, y]) => (x >= 1720 && y >= 880 ? WHITE : BLUE);

test('ripple: at p 0 the frame is the outgoing picture and at p 1 the incoming one, the right way up, within one level', async (t) => {
  const s = await openWith(t, marked('ripple')); if (!s) return;
  if (s.info.post === 'webgl2') assert.deepEqual(s.info.cuts, { ran: ['ripple'], replaced: [], reason: null });
  const first = await shownAt(s, START, SIXTEEN);
  first.forEach((px, k) => near(px, outgoingAt(SIXTEEN[k]), 1, `p 0 at ${SIXTEEN[k]}`));
  const last = await shownAt(s, SHADER_MID, SIXTEEN, 1);
  last.forEach((px, k) => near(px, incomingAt(SIXTEEN[k]), 1, `p 1 at ${SIXTEEN[k]}`));
  assert.deepEqual(s.errors, []);
});

test('cube from the left at mid-window shows both shots; up and down are different pictures', async (t) => {
  const s = await openWith(t, marked({ type: 'cube', direction: 'left' })); if (!s) return;
  if (s.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
  const row = Array.from({ length: 48 }, (_, k) => [20 + k * 40, 540]);
  const px = await shownAt(s, SHADER_MID, row);
  const reddish = px.filter(([r, , b]) => r > 60 && b < 20).length, bluish = px.filter(([r, , b]) => b > 60 && r < 20).length;
  assert.ok(reddish > 4 && bluish > 4, `both faces on the row: ${reddish} red, ${bluish} blue`);
  const up = await openWith(t, marked({ type: 'cube', direction: 'up' }));
  const down = await openWith(t, marked({ type: 'cube', direction: 'down' }));
  assert.notEqual(await shownHash(up, SHADER_MID), await shownHash(down, SHADER_MID));
});

test('a shader window leaves the post pass as it found it: a plain frame hashes the same before and after one', async (t) => {
  const s = await openWith(t, marked('ripple')); if (!s) return;
  const before = [await shownHash(s, 10), await shownHash(s, START + SHADER_FRAMES + 3)];
  await shownHash(s, SHADER_MID);
  assert.deepEqual([await shownHash(s, 10), await shownHash(s, START + SHADER_FRAMES + 3)], before);
});

test('held frames and seek order: a shader window between still shots is never held, and reads the same forwards and backwards', async (t) => {
  const s = await openWith(t, marked('ripple')); if (!s) return;
  const flags = await s.page.evaluate(([a, b]) => window.__heldFlags(a, b), [START + 1, START + SHADER_FRAMES - 1]);
  assert.deepEqual(flags, Array(SHADER_FRAMES - 1).fill(false));
  const frames = Array.from({ length: SHADER_FRAMES }, (_, k) => START + k);
  const forwards = [];
  for (const i of frames) forwards.push(await shownHash(s, i));
  const backwards = [];
  for (const i of [...frames].reverse()) backwards.unshift(await shownHash(s, i));
  assert.deepEqual(backwards, forwards);
});

// The film with every shader cut replaced by its stand-in written out: ripple as a 0.6 s crossfade, cube up as a wipe up.
const standIns = () => marked({ type: 'crossfade', duration: 0.6 }, [flat('c', '#00ff00', { type: 'wipe', direction: 'up', duration: 0.6 }, [])]);
const shaders = () => marked('ripple', [flat('c', '#00ff00', { type: 'cube', direction: 'up' }, [])]);
const C_MID = 60 + SHADER_FRAMES / 2; // shot c starts at 2 s

async function assertStandIns(t, s, reason) {
  assert.deepEqual(s.info.cuts.ran, []);
  assert.deepEqual(s.info.cuts.replaced, ['ripple', 'cube']);
  assert.match(s.info.cuts.reason, reason);
  const plain = await openWith(t, standIns());
  for (const frame of [START, SHADER_MID, C_MID]) assert.equal(await shownHash(s, frame), await shownHash(plain, frame), `frame ${frame} is the stand-in's`);
  const found = sessionFindings(s).filter((f) => /shader cuts replaced/.test(f.message));
  assert.deepEqual(found.map((f) => f.kind), ['creative']);
  assert.match(found[0].message, /^post: shader cuts replaced: ripple \(drawn as crossfade\), cube \(drawn as wipe\), because /);
}

test('a cut shader that does not compile: every shader cut of the film is replaced, with the compiler\'s message, and draws its stand-in', async (t) => {
  const s = await openWith(t, shaders(), { initScript: BREAK_CUTS }); if (!s) return;
  if (s.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
  await assertStandIns(t, s, /did not compile/);
});

test('without WebGL2 every shader cut is replaced and draws its stand-in', async (t) => {
  const s = await openWith(t, shaders(), { initScript: NO_GL }); if (!s) return;
  assert.equal(s.info.post, '2d');
  await assertStandIns(t, s, /^this browser has no WebGL2$/);
});

test('a lost WebGL context makes a seek inside a shader window throw the post pass\'s message', async (t) => {
  const s = await openWith(t, marked('ripple')); if (!s) return;
  if (s.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
  await s.page.evaluate(() => document.getElementById('stage').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  const message = await s.page.evaluate((i) => { try { window.__seek(i); return ''; } catch (e) { return e.message; } }, SHADER_MID);
  assert.match(message, /WebGL context was lost/);
});

// The ten shaders ported from gl-transitions (Task 5): each compiles, is the outgoing picture at p 0 and the incoming one
// at p 1 within one level at sixteen points, the right way up, and draws the same pixels on a second seek.
const PORTED = ['page-curl', 'directional-warp', 'cross-warp', 'cross-zoom', 'wind', 'window-slices', 'polka-dots', 'glitch-memories', 'pixelize', 'water-drop'];

for (const name of PORTED) {
  test(`${name}: compiles, p 0 is the outgoing picture and p 1 the incoming one, and a second seek draws the same pixels`, async (t) => {
    const s = await openWith(t, marked(name)); if (!s) return;
    if (s.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
    assert.deepEqual(s.info.cuts, { ran: [name], replaced: [], reason: null });
    const first = await shownAt(s, SHADER_MID, SIXTEEN, 0);
    first.forEach((px, k) => near(px, outgoingAt(SIXTEEN[k]), 1, `${name} p 0 at ${SIXTEEN[k]}`));
    const last = await shownAt(s, SHADER_MID, SIXTEEN, 1);
    last.forEach((px, k) => near(px, incomingAt(SIXTEEN[k]), 1, `${name} p 1 at ${SIXTEEN[k]}`));
    const once = await shownHash(s, SHADER_MID);
    await shownHash(s, START + 2);
    assert.equal(await shownHash(s, SHADER_MID), once, `${name}: the same frame twice`);
    assert.deepEqual(s.errors, []);
  });
}

test('a film with no shader cut reports none ran and none was replaced', async (t) => {
  const s = await openWith(t, film('crossfade')); if (!s) return;
  assert.deepEqual(s.info.cuts, { ran: [], replaced: [], reason: null });
});
