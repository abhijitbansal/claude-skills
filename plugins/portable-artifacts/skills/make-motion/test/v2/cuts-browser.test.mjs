// The two-picture cuts in the page (transitions plan Tasks 3 and 4): a layer cut composes the outgoing picture (drawn
// once per shot and kept) and the incoming one in canvas 2D before the post pass. Flat red into flat blue, grain 0, read
// from window.__source (the frame before the post pass). One browser at a time: run with --test-concurrency=1; skips
// without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOrNull } from './helpers/session.mjs';

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
