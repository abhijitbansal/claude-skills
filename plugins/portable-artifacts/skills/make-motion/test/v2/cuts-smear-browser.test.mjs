// The motion blur in the page (transitions plan Task 6): the echo guard. One white bar, 40 px wide, on black, through a
// smeared slide and a smeared punch; the row of pixels through the bar at the frame of fastest travel must be one streak
// (no interior dip), as long as the bar plus the shutter's travel, and as bright in sum as the bar itself. Read from
// window.__source (the frame before the post pass). One browser at a time: run with --test-concurrency=1; skips without a
// browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionOrNull, ffmpegOrNull } from './helpers/session.mjs';
import { renderFilm } from '../../scripts/v2/render.mjs';
import { ease } from '../../engine/time/ease.mjs';

const FPS = 30;
const START = 30; // shot b's first frame: shot a holds 1 s
const ROW = 540;
const ZERO = { grain: 0, halftone: 0, bloom: 0 };
const DIP_LEVELS = 2;
const WIDTH_PX = 2;
const ENERGY = 0.01;

const bar = (x) => ({ type: 'path', id: `bar${x}`, props: { d: `M${x} 0H${x + 40}V1080H${x}Z`, fill: '#ffffff' } });
const shot = (id, nodes, cut) => ({ id, show: 'free', hold: 1, background: '#000000', nodes, ...(cut ? { cut } : {}) });
// the bar leaves on a slide (shot a), or lands on a punch (shot b)
const slideFilm = (smear) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [shot('a', [bar(1500)]), shot('b', [], { type: 'slide', smear })] });
const punchFilm = (smear) => ({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [shot('a', []), shot('b', [bar(1400)], { type: 'punch', smear })] });

async function open(t, film) {
  const session = await sessionOrNull(film);
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  await session.page.evaluate((zero) => window.__setPost(zero), ZERO);
  return session;
}

// The red channel of row ROW of the 2D frame after seeking `frame`.
const rowAt = (s, frame) => s.page.evaluate(([i, y]) => {
  window.__seek(i);
  const { data } = window.__source.getContext('2d').getImageData(0, y, window.__source.width, 1);
  return Array.from({ length: data.length / 4 }, (_, x) => data[x * 4]);
}, [frame, ROW]);

const frameHash = (s, frame) => s.page.evaluate((i) => {
  window.__seek(i);
  const { data } = window.__source.getContext('2d').getImageData(0, 0, window.__source.width, window.__source.height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return h;
}, frame);

const sum = (values) => values.reduce((a, b) => a + b, 0);
const lit = (row) => ({ first: row.findIndex((v) => v > 0), last: row.findLastIndex((v) => v > 0) });

// (a) one streak: every pixel inside the lit span is within DIP_LEVELS of the lower of the brightest pixels on its left
// and on its right, so the profile rises, holds and falls with no hole between copies.
function assertOneStreak(row, label) {
  const { first, last } = lit(row);
  assert.ok(first >= 0, `${label}: the bar is on the row`);
  const span = row.slice(first, last + 1);
  const left = span.map((_, i) => Math.max(...span.slice(0, i + 1)));
  const right = span.map((_, i) => Math.max(...span.slice(i)));
  const worst = Math.max(...span.map((v, i) => Math.min(left[i], right[i]) - v));
  assert.ok(worst <= DIP_LEVELS, `${label}: an interior dip of ${worst} levels (copies, not blur)`);
}

const cubic = ease('inOutCubic');
const expo = ease('outExpo');

test('a smeared slide at its fastest frame is one streak as long as the bar plus the shutter, as bright in sum as the bar', async (t) => {
  const s = await open(t, slideFilm(true)); if (!s) return;
  const plain = await open(t, slideFilm(false));
  const fastest = START + 6; // p 0.5 of a 0.4 s window: the steepest point of inOutCubic
  const row = await rowAt(s, fastest);
  assertOneStreak(row, 'slide');
  // the shutter spans p 0.5 -+ 1/48: 1920 x (cubic(0.5 + 1/48) - cubic(0.5 - 1/48)) = 230.14 px
  const travel = 1920 * (cubic(0.5 + 1 / 48) - cubic(0.5 - 1 / 48));
  const { first, last } = lit(row);
  assert.ok(Math.abs(last - first + 1 - (40 + travel)) <= WIDTH_PX, `width ${last - first + 1} vs ${40 + travel}`);
  const bright = sum(await rowAt(plain, fastest));
  assert.equal(bright, 40 * 255, 'the unsmeared bar: 40 white pixels');
  assert.ok(Math.abs(sum(row) - bright) <= bright * ENERGY, `energy kept: ${sum(row)} vs ${bright}`);
});

test('a smeared punch at its fastest frame is one streak along the radius, as long as the zoom moves its edges, as bright as the unsmeared bar', async (t) => {
  const s = await open(t, punchFilm(true)); if (!s) return;
  const plain = await open(t, punchFilm(false));
  const fastest = START + 1; // p 1/6 of a 0.2 s window: the first frame after p 0, where outExpo is steepest
  const row = await rowAt(s, fastest);
  assertOneStreak(row, 'punch');
  // the shutter spans p 1/6 -+ 1/24; the zoom 1.15 -> 1 by outExpo moves the bar's edges (440 and 480 px from the centre)
  const zoom = (q) => 1.15 - 0.15 * expo(q);
  const [zMax, zMin] = [zoom(1 / 6 - 1 / 24), zoom(1 / 6 + 1 / 24)];
  const width = 480 * zMax - 440 * zMin;
  const { first, last } = lit(row);
  assert.ok(Math.abs(last - first + 1 - width) <= WIDTH_PX, `width ${last - first + 1} vs ${width}`);
  const bright = sum(await rowAt(plain, fastest));
  assert.ok(Math.abs(sum(row) - bright) <= bright * ENERGY, `energy kept: ${sum(row)} vs ${bright}`);
});

test('the frames before, at the start of and after a smeared window are the unsmeared frames exactly', async (t) => {
  for (const [film, after] of [[slideFilm, START + 12], [punchFilm, START + 6]]) {
    const s = await open(t, film(true)); if (!s) return;
    const plain = await open(t, film(false));
    for (const frame of [START - 1, START, after]) assert.equal(await frameHash(s, frame), await frameHash(plain, frame), `frame ${frame}`);
  }
});

test('a smeared window is never held, and reads the same forwards and backwards', async (t) => {
  for (const [film, frames] of [[slideFilm, 11], [punchFilm, 5]]) {
    const s = await open(t, film(true)); if (!s) return;
    const flags = await s.page.evaluate(([a, b]) => window.__heldFlags(a, b), [START + 1, START + frames]);
    assert.deepEqual(flags, Array(frames).fill(false));
    const order = Array.from({ length: frames }, (_, k) => START + 1 + k);
    const forwards = [];
    for (const i of order) forwards.push(await frameHash(s, i));
    const backwards = [];
    for (const i of [...order].reverse()) backwards.unshift(await frameHash(s, i));
    assert.deepEqual(backwards, forwards);
  }
});

test('the box filter does not thin an opaque sheet where it runs off the canvas: a smeared cover is the incoming colour at the edge', async (t) => {
  const flatCover = { version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 1, shots: [
    // a node cut paints the incoming background under the frame, so the outgoing red is a node of its own
    { id: 'a', show: 'free', hold: 1, background: '#ff0000', nodes: [{ type: 'path', id: 'red', props: { d: 'M0 0H1920V1080H0Z', fill: '#ff0000' } }] },
    { id: 'b', show: 'free', hold: 1, background: '#0000ff', nodes: [], cut: { type: 'cover', smear: true } },
  ] };
  const s = await open(t, flatCover); if (!s) return;
  const px = await s.page.evaluate((i) => {
    window.__seek(i);
    const ctx = window.__source.getContext('2d');
    return [1919, 1915, 1900].map((x) => [...ctx.getImageData(x, 540, 1, 1).data.slice(0, 3)]);
  }, START + 6);
  px.forEach((p, k) => assert.ok(p[0] <= 1 && p[2] >= 254, `column ${[1919, 1915, 1900][k]}: ${p}`));
});

test('the review audits a smeared frame at its own progress, unsmeared: the punched bar is in the frame\'s snapshot', async (t) => {
  const s = await open(t, punchFilm(true)); if (!s) return;
  const plain = await open(t, punchFilm(false));
  const ids = (session) => session.page.evaluate((i) => window.__snapshot(i).map((n) => n.id), START + 2);
  assert.deepEqual(await ids(s), await ids(plain));
  assert.ok((await ids(s)).includes('bar1400'));
});

test('the video of a smeared slide captures every frame of the window', async (t) => {
  if (!await ffmpegOrNull()) return t.skip('no ffmpeg');
  const s = await open(t, slideFilm(true)); if (!s) return;
  const folder = mkdtempSync(path.join(tmpdir(), 'mm-v2-smear-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const result = await renderFilm({ out: path.join(folder, 'smear.mp4'), session: s });
  // frame 0, the 11 smeared frames (31 to 41) and the first frame of shot b alone (42); the stills either side are held
  assert.equal(result.captured, 13);
});
