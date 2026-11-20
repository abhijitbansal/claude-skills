// The transitions revision, round 2 (lead ruling 3; look review gate-cuts-1 D12): window slices open as a set of blinds,
// evenly, each slat whole: read along one row of the visible canvas, every column of a slat shows the same picture
// (no hairline seam at a slat's edge) and no column shows the bare ground (no lighter band). Red paper going out, blue
// coming in, both full frame on white. One browser at a time: run with --test-concurrency=1; skips without a browser
// or without WebGL2.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const W = 1920, H = 1080, SLATS = 10;
const SLIVER = 6; // px: an old part this narrow reads as a hairline seam
const MAX_SLIVERS = 3; // slat-frames of 350 sampled (10 slats, 35 frames) that may pass through one
const sheet = (id, fill) => ({ type: 'path', id, props: { d: `M0 0h${W}v${H}h-${W}Z`, fill } });
const shot = (id, fill, cut) => ({ id, show: 'free', hold: 1, background: '#ffffff', nodes: [sheet(`${id}.ink`, fill)], ...(cut ? { cut } : {}) });
const film = { version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [shot('a', '#ff0000'), shot('b', '#0000ff', 'window-slices')] };

// Each column of the middle row as 'r' (outgoing), 'b' (incoming) or '?' (anything else: ground, a blend).
const rowAt = (s, p) => s.page.evaluate(([i, q, w, h]) => {
  window.__seek(i, { progress: q });
  const stage = document.getElementById('stage');
  const copy = new OffscreenCanvas(stage.width, stage.height);
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data } = ctx.getImageData(0, Math.floor(h / 2), w, 1);
  let out = '';
  for (let k = 0; k < data.length; k += 4) out += data[k] > 200 && data[k + 2] < 60 ? 'r' : data[k + 2] > 200 && data[k] < 60 ? 'b' : '?';
  return out;
}, [START, p, W, H]);

// ---- cross warp never blows the incoming picture up into blobs (gate-cuts-1 D14; round 2 ruling 3) ----

// thin blue bars across the incoming shot's left half, where the warp's sweep stretched the picture most (its scale
// changes across the frame, so a stretch there is local: "Old shot" read as blobs)
const BAR = [0, 20]; // x step origin, width
const BAR_XS = Array.from({ length: 24 }, (_, k) => 40 + k * 40);
const MAX_ZOOM = 1.5; // the most the warp may magnify the incoming picture by
const barShot = { id: 'b', show: 'free', hold: 1, background: '#ffffff', cut: 'cross-warp', nodes: BAR_XS.map((x, k) => ({ type: 'path', id: `b.bar${k}`, props: { d: `M${x} 0h${BAR[1]}v${H}h-${BAR[1]}Z`, fill: '#0000ff' } })) };
const warpFilm = { version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [{ id: 'a', show: 'free', hold: 1, background: '#ffffff', nodes: [] }, barShot] };

test('cross warp: the incoming picture is never magnified more than 1.5 times on its way in', async (t) => {
  const session = await sessionOrNull(warpFilm);
  if (!session) return t.skip('no browser');
  t.after(() => session.close());
  if (session.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
  await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
  for (const p of [0.6, 0.65, 0.7, 0.8, 0.9]) {
    const runs = (await rowAt(session, p)).match(/b+/g) ?? [];
    const widest = Math.max(0, ...runs.map((run) => run.length));
    assert.ok(widest <= BAR[1] * MAX_ZOOM + 2, `p ${p}: the ${BAR[1]} px bar shows ${widest} px wide`);
  }
});

test('window slices: every slat is one picture, whole, at every sampled frame, and none shows the ground', async (t) => {
  const session = await sessionOrNull(film);
  if (!session) return t.skip('no browser');
  t.after(() => session.close());
  if (session.info.post !== 'webgl2') return t.skip('this browser has no WebGL2');
  await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
  const slat = W / SLATS;
  for (const p of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95]) {
    const row = await rowAt(session, p);
    assert.ok(!row.includes('?'), `p ${p}: a column that is neither picture at x ${row.indexOf('?')}`);
    for (let k = 0; k < SLATS; k++) {
      const part = row.slice(k * slat, (k + 1) * slat);
      const seen = new Set(part);
      // a slat in flight opens from its right side in one piece: old picture, then new, one change at most
      assert.match(part, /^r*b*$/, `p ${p}, slat ${k}: not one piece of each (${[...seen].join('')})`);
    }
  }
  // the seams the review saw are slivers: a slat's old part a few pixels wide, left standing frame after frame while
  // the trailing edge of a soft band crawls past. Each slat now opens whole on its own time, so across every frame of
  // the window a sliver shows at most on a frame or two
  const FRAMES = 36;
  let slivers = 0;
  for (let f = 1; f < FRAMES; f++) {
    const row = await rowAt(session, f / FRAMES);
    for (let k = 0; k < SLATS; k++) {
      const old = (row.slice(k * slat, (k + 1) * slat).match(/^r*/) ?? [''])[0].length;
      if (old > 0 && old <= SLIVER) slivers += 1;
    }
  }
  assert.ok(slivers <= MAX_SLIVERS, `${slivers} slat-frames show a sliver of the old picture ${SLIVER} px or narrower`);
  // by p 0.97 every slat has opened all the way (the last, centred at 0.95 of the width, is done by about 0.96): no
  // column of the old picture is left at a slat's edge (the seam the old body left until the end)
  assert.equal(await rowAt(session, 0.97), 'b'.repeat(W), 'p 0.97: every column shows the incoming picture');
});
