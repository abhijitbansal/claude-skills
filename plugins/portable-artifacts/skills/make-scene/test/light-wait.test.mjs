// lightArrives(page): wait for the tour light to arrive by what it does, not by a wall-clock budget. The light's clock
// advances at most 0.1 s per frame (runtime/index.js MAX_DT) and it needs 1.8 s (travel.js TRAVEL_SECONDS), so on a slow
// runner it takes frames x frame time: CI's software WebGL turned a fixed 5 s wait into a coin toss (lift-browser:62,
// run 44480211485). Pure: a fake page that answers with scripted frames, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lightArrives } from './helpers/light.mjs';

const frame = (at, done = false) => ({ id: 'edge-0', at, done, position: [at, 0, 0] });

// A page whose light is `frames[k]` at the k-th poll, then stays on the last one.
const pageOf = (frames) => {
  let k = 0;
  return { evaluate: async () => frames[Math.min(k++, frames.length - 1)] };
};

test('a light that arrives is returned, however many polls it took', async () => {
  const frames = Array.from({ length: 60 }, (_, k) => frame(k / 60)).concat(frame(1, true));
  const end = await lightArrives(pageOf(frames), { pollMs: 2, stallMs: 50, capMs: 5000 });
  assert.equal(end.done, true);
  assert.equal(end.at, 1);
});

test('a slow light that keeps moving passes even when it takes far longer than the stall window', async () => {
  const frames = Array.from({ length: 80 }, (_, k) => frame(k / 80)).concat(frame(1, true));
  const started = Date.now();
  const end = await lightArrives(pageOf(frames), { pollMs: 5, stallMs: 60, capMs: 5000 });
  assert.equal(end.done, true);
  assert.ok(Date.now() - started > 60, 'the run really was longer than the stall window (what a fixed budget of that size would have failed)');
});

test('a light that stops moving fails after the stall window, naming where it stopped', async () => {
  const frames = [frame(0), frame(0.2), frame(0.3)];
  await assert.rejects(lightArrives(pageOf(frames), { pollMs: 5, stallMs: 40, capMs: 5000 }), /stopped at 0\.3 .*40 ms/);
});

test('a light that never arrives but keeps creeping fails at the cap', async () => {
  let at = 0;
  const page = { evaluate: async () => frame((at += 1e-6)) };
  await assert.rejects(lightArrives(page, { pollMs: 5, stallMs: 1000, capMs: 80 }), /did not arrive within 80 ms/);
});

test('no light at all (the tour was never started) fails at once, not after the cap', async () => {
  const started = Date.now();
  await assert.rejects(lightArrives({ evaluate: async () => null }, { pollMs: 5, stallMs: 1000, capMs: 5000 }), /no light/);
  assert.ok(Date.now() - started < 500);
});
