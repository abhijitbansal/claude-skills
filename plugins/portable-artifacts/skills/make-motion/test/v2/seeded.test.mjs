// The engine's own mulberry32 must draw exactly what the version 1 one draws, so nothing already rendered changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../engine/seeded.mjs';
import { mulberry32 as v1 } from '../../template/seeded.mjs';

const firstTen = (make, seed) => {
  const rng = make(seed);
  return Array.from({ length: 10 }, () => rng());
};

test('the engine mulberry32 matches the version 1 one for seeds 1, 7 and 7918', () => {
  for (const seed of [1, 7, 7918]) assert.deepEqual(firstTen(mulberry32, seed), firstTen(v1, seed), `seed ${seed}`);
});

test('a different seed draws a different stream', () => {
  assert.notDeepEqual(firstTen(mulberry32, 1), firstTen(mulberry32, 2));
});
