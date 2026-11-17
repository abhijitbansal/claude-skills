// Transitions Task 8: a frame is a function of the film, its seed and the frame number. Every frame of every cut window
// (a layer cut, a shader cut, a smeared node cut and a second layer cut with another outgoing shot) is read off the
// visible canvas after the post pass, with the look's grain on, in a forward pass, a backward pass, and a shuffled pass in
// a second, fresh page; the three hashes of each frame must be equal. The comparison is a render against itself on one
// machine, never against stored pictures. On a mismatch the two PNGs are kept and their paths printed. Run with
// --test-concurrency=1; skips without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sessionOrNull } from './helpers/session.mjs';

const FPS = 30;
const SHOT_FRAMES = 30; // each shot holds 1 s
const box = (id, x, fill) => ({ type: 'path', id, props: { d: `M${x} 200H${x + 500}V880H${x}Z`, fill } });
const shot = (id, background, x, fill, cut) => ({ id, show: 'free', hold: 1, background, nodes: [box(`${id}.box`, x, fill)], ...(cut ? { cut } : {}) });

// desk: grain 0.02 and smear on for slide (look data). Five shots, four windows: b wipe (from a), c ripple (from b),
// d slide (smeared, from c), e crossfade (from d). Two layer windows with different outgoing shots, so a cache that
// kept the wrong outgoing picture shows on the backward pass.
const FILM = Object.freeze({ version: 2, mode: 'pro', look: 'desk', fps: FPS, seed: 5, shots: [
  shot('a', '#f3eee3', 200, '#15130f'),
  shot('b', '#d63a2f', 700, '#ffe14a', { type: 'wipe', direction: 'left' }),
  shot('c', '#1b4f72', 1200, '#f3eee3', 'ripple'),
  shot('d', '#15130f', 400, '#d63a2f', 'slide'),
  shot('e', '#ffe14a', 900, '#1b4f72', 'crossfade'),
] });
const WINDOWS = [[1, 12], [2, 18], [3, 12], [4, 12]]; // [shot index, frames in its window]
const FRAMES = WINDOWS.flatMap(([index, n]) => Array.from({ length: n }, (_, k) => index * SHOT_FRAMES + k));

// The frames in a fixed shuffled order (a small LCG: the order is part of the test, not chance).
function shuffled(list, seed = 7) {
  const out = [...list];
  let s = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function open(t) {
  const session = await sessionOrNull(FILM);
  if (!session) { t.skip('no browser'); return null; }
  t.after(() => session.close());
  return session;
}

// Seeks `frame` and reads the visible canvas: an FNV-1a hash of its bytes, and the PNG as a data URL when asked.
const capture = (s, frame, png = false) => s.page.evaluate(([i, withPng]) => {
  window.__seek(i);
  const stage = document.getElementById('stage');
  const copy = document.createElement('canvas');
  copy.width = stage.width;
  copy.height = stage.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(stage, 0, 0);
  const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
  let h = 0x811c9dc5;
  for (let k = 0; k < data.length; k += 1) h = Math.imul(h ^ data[k], 0x01000193) >>> 0;
  return { hash: h, png: withPng ? copy.toDataURL('image/png') : null };
}, [frame, png]);

async function hashes(s, order) {
  const out = new Map();
  for (const frame of order) out.set(frame, (await capture(s, frame)).hash);
  return out;
}

// Writes the PNGs of `frame` from two sessions into the kept folder `dir` and returns their paths.
async function keepPair(dir, a, b, frame, labels) {
  const paths = [];
  for (const [s, label] of [[a, labels[0]], [b, labels[1]]]) {
    const { png } = await capture(s, frame, true);
    const file = path.join(dir, `frame-${frame}-${label}.png`);
    writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    paths.push(file);
  }
  return paths;
}

test('every frame of every cut window hashes the same forwards, backwards and shuffled in a fresh page, grain on', async (t) => {
  const s = await open(t); if (!s) return;
  assert.ok(FRAMES.length === 54, 'the four windows hold 54 frames');
  assert.match(await s.page.evaluate(() => window.__stateKey(96)), /\|smear:slide:/, 'the slide window is smeared (desk look data)');
  const forwards = await hashes(s, FRAMES);
  const backwards = await hashes(s, [...FRAMES].reverse());
  // the fresh page starts with nothing cached and reads the last window first, then the frames shuffled: a page that
  // kept what it drew first (an outgoing picture, a smear plan, a shader's uniforms) cannot pass both orders
  const fresh = await open(t);
  const freshBackwards = await hashes(fresh, [...FRAMES].reverse());
  const shuffledPass = await hashes(fresh, shuffled(FRAMES));
  const problems = FRAMES.flatMap((frame) => [
    ...(backwards.get(frame) === forwards.get(frame) ? [] : [`${frame} backward`]),
    ...(freshBackwards.get(frame) === forwards.get(frame) ? [] : [`${frame} fresh backward`]),
    ...(shuffledPass.get(frame) === forwards.get(frame) ? [] : [`${frame} fresh shuffled`]),
  ]);
  // the first mismatched frames, read once more from each page (each page now holds its own cached state)
  const kept = [];
  const mismatched = [...new Set(problems.map((p) => Number(p.split(' ')[0])))].slice(0, 3);
  const dir = mismatched.length > 0 ? mkdtempSync(path.join(tmpdir(), 'mm-cuts-determinism-')) : null;
  for (const frame of mismatched) kept.push(...await keepPair(dir, s, fresh, frame, ['first-page', 'fresh-page']));
  assert.deepEqual(problems, [], `PNGs kept: ${kept.join(', ')}`);
  assert.deepEqual([...s.errors, ...fresh.errors], []);
  if (s.info.post === 'webgl2') assert.deepEqual(s.info.cuts.ran, ['ripple']);
});
