// The post pass (WebGL2 with a 2D fallback): grain, halftone and bloom come from the look, the frame is the same
// pixels every time, and the grain changes 12 times a second. Run with --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sessionOrNull } from './helpers/session.mjs';
import { grainPhase } from '../../engine/page/post.mjs';

const box = (id, fill, extra = {}) => ({ type: 'path', id, props: { d: 'M300 200H1300V800H300Z', fill, ...extra } });
// A still shot: nothing moves, so any change between two frames is the post pass.
const stillFilm = (extra = {}) => ({ version: 2, mode: 'pro', look: 'desk', seed: 7, shots: [{ id: 's', show: 'free', hold: 2, background: '#808080', nodes: [box('b', '#d0d0d0')] }], ...extra });
const ZERO = { grain: 0, halftone: 0, bloom: 0 };

async function open(t, film, options) {
  const session = await sessionOrNull(film, options);
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const shoot = async (s, frame) => { await s.page.evaluate((i) => window.__seek(i), frame); return sha(await s.page.screenshot({ type: 'png' })); };
const strengths = (s, next) => s.page.evaluate((n) => window.__setPost(n), next);

// The largest per-channel difference between the 2D frame and what the visible canvas shows.
const maxDifference = (s) => s.page.evaluate(() => {
  const source = window.__source;
  const copy = document.createElement('canvas');
  copy.width = source.width; copy.height = source.height;
  const copyCtx = copy.getContext('2d');
  copyCtx.drawImage(document.getElementById('stage'), 0, 0);
  const a = source.getContext('2d').getImageData(0, 0, source.width, source.height).data;
  const b = copyCtx.getImageData(0, 0, source.width, source.height).data;
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[i + k] - b[i + k]));
  return worst;
});

test('the grain phase of a frame is exact: floor(t * 12) equals integer arithmetic at every frame of every fps, up to 30 minutes', () => {
  for (const fps of [24, 25, 30, 60]) {
    for (let frame = 0; frame <= fps * 1800; frame++) {
      if (grainPhase(frame / fps) !== Math.floor((frame * 12) / fps)) assert.fail(`fps ${fps}, frame ${frame}`);
    }
  }
});

test('the look sets the strengths: a frame with the post pass on differs from the same frame with every strength 0', async (t) => {
  const s = await open(t, stillFilm()); if (!s) return;
  assert.match(s.info.post, /^(webgl2|2d)$/);
  const on = await shoot(s, 10);
  await strengths(s, ZERO);
  assert.notEqual(await shoot(s, 10), on);
  assert.deepEqual(s.errors, []);
});

test('with every strength 0 the visible canvas is the 2D frame, pixel for pixel', async (t) => {
  const s = await open(t, stillFilm()); if (!s) return;
  await strengths(s, ZERO);
  await s.page.evaluate(() => window.__seek(10));
  assert.equal(await maxDifference(s), 0);
});

test('with grain on, the visible canvas is the 2D frame plus noise within the grain strength', async (t) => {
  const s = await open(t, stillFilm()); if (!s) return;
  await s.page.evaluate(() => window.__seek(10));
  const worst = await maxDifference(s);
  assert.ok(worst > 0, 'grain changes some pixel');
  // desk grain 0.05 swings +-0.05 around the picture: +-12.75 of 255, plus rounding
  assert.ok(worst <= 14, `largest difference ${worst}`);
});

test('frame 40 hashes the same after seeking 40, 3, 40 and in a second browser, with the post pass on', async (t) => {
  const a = await open(t, stillFilm()); if (!a) return;
  const first = await shoot(a, 40); await shoot(a, 3); const again = await shoot(a, 40);
  await a.close();
  const b = await open(t, stillFilm());
  const other = await shoot(b, 40);
  assert.equal(first, again);
  assert.equal(first, other);
});

test('the grain changes 12 times a second: frames in one twelfth of a second are identical, the next differs', async (t) => {
  const s = await open(t, stillFilm()); if (!s) return;
  // at 30 fps frames 0, 1, 2 are at 0, 0.033 and 0.067 s (grain 0); frame 3 is at 0.1 s (grain 1)
  const [f0, f1, f2, f3] = [await shoot(s, 0), await shoot(s, 1), await shoot(s, 2), await shoot(s, 3)];
  assert.equal(f0, f1); assert.equal(f1, f2);
  assert.notEqual(f2, f3);
  assert.deepEqual([0, 1, 2, 3, 5, 6].map((i) => grainPhase(i / 30)), [0, 0, 0, 1, 2, 2]);
});

test('the grain seed comes from the film seed: another seed gives another frame', async (t) => {
  const a = await open(t, stillFilm({ seed: 7 })); if (!a) return;
  const seven = await shoot(a, 5);
  await a.close();
  const b = await open(t, stillFilm({ seed: 8 }));
  assert.notEqual(await shoot(b, 5), seven);
});

test('__stateKey includes the grain pattern, so a held frame under changing grain is not reused', async (t) => {
  const s = await open(t, stillFilm()); if (!s) return;
  const key = (i) => s.page.evaluate((n) => window.__stateKey(n), i);
  assert.equal(await key(0), await key(1));
  assert.equal(await key(1), await key(2));
  assert.notEqual(await key(2), await key(3));
  await strengths(s, { grain: 0 });
  assert.equal(await key(2), await key(3), 'no grain: the 2D state alone decides');
});

test('__heldFlags says which frames equal their predecessor, by capture key or by 2D state', async (t) => {
  const s = await open(t, stillFilm()); if (!s) return;
  const flags = (withGrain) => s.page.evaluate((g) => window.__heldFlags(0, 8, g), withGrain);
  // the grain phase of frames 0..8 at 30 fps is 0 0 0 1 1 2 2 2 3
  assert.deepEqual(await flags(true), [false, true, true, false, true, false, true, true, false]);
  assert.deepEqual(await flags(false), [false, true, true, true, true, true, true, true, true]);
});

test('a mesh field is painted from the time, so its frames are never held; a paper field is', async (t) => {
  const palette = { paper: '#f3eee3', ink: '#15130f', ink2: '#5b554a', accent: '#ffe14a', accent2: '#d63a2f', rule: '#cfc7b6' };
  const field = (name) => ({ type: 'field', id: 'f', props: { field: name, params: {}, w: 1920, h: 1080, unit: 1, seed: 1, palette } });
  const filmWith = (name) => stillFilm({ shots: [{ id: 's', show: 'free', hold: 2, background: '#000000', nodes: [field(name)] }] });
  const flags = (s) => s.page.evaluate(() => window.__heldFlags(0, 6, false));
  const mesh = await open(t, filmWith('mesh')); if (!mesh) return;
  assert.deepEqual(await flags(mesh), Array(7).fill(false), 'every frame of a mesh differs');
  await strengths(mesh, ZERO);
  assert.notEqual(await shoot(mesh, 0), await shoot(mesh, 3), 'and the pictures really do differ');
  const paper = await open(t, filmWith('paper'));
  assert.deepEqual(await flags(paper), [false, true, true, true, true, true, true]);
});

test('halftone and bloom each change the frame on their own', async (t) => {
  const s = await open(t, stillFilm({ mode: 'viral', look: 'pop', format: '9:16' })); if (!s) return;
  await strengths(s, ZERO);
  const flat = await shoot(s, 5);
  await strengths(s, { halftone: 0.5 });
  const halftone = await shoot(s, 5);
  await strengths(s, { halftone: 0, bloom: 1 });
  const bloom = await shoot(s, 5);
  assert.equal(new Set([flat, halftone, bloom]).size, 3);
});

test('without WebGL2 the 2D post pass is used: it reports 2d, draws grain and repeats', async (t) => {
  const noGl = "const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === 'webgl2' ? null : get.call(this, kind, ...rest); };";
  const s = await open(t, stillFilm(), { initScript: noGl }); if (!s) return;
  assert.equal(s.info.post, '2d');
  const on = await shoot(s, 10);
  assert.equal(await shoot(s, 10), on, 'the same frame twice');
  assert.ok(await maxDifference(s) > 0, 'grain is on the frame');
  const f = [await shoot(s, 0), await shoot(s, 1), await shoot(s, 3)];
  assert.equal(f[0], f[1]); assert.notEqual(f[1], f[2]);
  await strengths(s, ZERO);
  assert.notEqual(await shoot(s, 10), on);
});
