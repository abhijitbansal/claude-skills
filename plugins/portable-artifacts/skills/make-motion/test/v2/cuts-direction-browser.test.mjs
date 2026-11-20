// Directions as the viewer sees them, read off the picture (lead ruling 1; engine/cuts/edges.mjs): early in a cube
// down the incoming face shows along the top of the frame, in a cube up along the bottom. Flat red into flat blue,
// grain 0, read from the visible canvas. One browser at a time: run with --test-concurrency=1; skips without a browser
// or without WebGL2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const EARLY = 0.3;
// The space around the turning box is the incoming ground, flat #0000ff; the incoming face is the same blue in shade
// (cube.mjs uShadeTo is under 0.5 early in the turn), so only a shaded blue is the face itself.
const flat = (id, background, cut) => ({ id, show: 'free', hold: 1, background, nodes: [], ...(cut ? { cut } : {}) });
const film = (cut) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [flat('a', '#ff0000'), flat('b', '#0000ff', cut)] });
const SHADED = [40, 220]; // blue levels of the face in shade, under the ground's 255

// How many of `points` read as the incoming green face after seeking the window's first frame at progress EARLY.
const faceAt = (s, points) => s.page.evaluate(([i, list, p, [lo, hi]]) => {
  window.__seek(i, { progress: p });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  return list.filter(([x, y]) => {
    const [r, , b] = ctx.getImageData(x, y, 1, 1).data;
    return b > lo && b < hi && r < 40;
  }).map(([, y, along]) => along ?? y); // a point's third value, when given, is what to report instead of its y
}, [START, points, EARLY, SHADED]);

const column = (x) => Array.from({ length: 27 }, (_, k) => [x, 20 + k * 40]);
const row = (y) => Array.from({ length: 47 }, (_, k) => [20 + k * 40, y]);
const MIDDLE_Y = 540;
const MIDDLE_X = 960;

// A direction is the way the incoming face moves (round 2 ruling 1): down enters at the top, left at the right.
for (const [direction, entry] of [['down', 'top'], ['up', 'bottom'], ['left', 'right'], ['right', 'left']]) {
  test(`cube ${direction}: the incoming face first shows along the ${entry} of the frame`, async (t) => {
    const session = await sessionOrNull(film({ type: 'cube', direction }));
    if (!session) return t.skip('no browser');
    t.after(() => session.close());
    if (session.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
    await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
    // the shaded incoming face, down the middle column (vertical turns) or along the middle row (horizontal ones)
    const vertical = entry === 'top' || entry === 'bottom';
    const places = await faceAt(session, vertical ? column(MIDDLE_X) : row(MIDDLE_Y).map(([x, y]) => [x, y, x]));
    const before = places.filter((v) => v < (vertical ? MIDDLE_Y : MIDDLE_X)).length, after = places.length - before;
    const [near, far] = entry === 'top' || entry === 'left' ? [before, after] : [after, before];
    assert.ok(near > 2 && far === 0, `${direction}: incoming face at ${JSON.stringify(places)}`);
  });
}
