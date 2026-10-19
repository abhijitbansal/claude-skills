// Line-of-sight helpers behind the focus bookmarks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxOfInstance, clearPosition, ringCandidates, segmentHitsBox } from '../scripts/lib/views.mjs';

const BOX = { min: [-1, 0, -1], max: [1, 4, 1] };

test('a segment through a box hits it, one that passes beside or over it does not', () => {
  assert.equal(segmentHitsBox([-5, 2, 0], [5, 2, 0], BOX), true);
  assert.equal(segmentHitsBox([-5, 6, 0], [5, 6, 0], BOX), false, 'over');
  assert.equal(segmentHitsBox([-5, 2, 3], [5, 2, 3], BOX), false, 'beside');
  assert.equal(segmentHitsBox([-5, 2, 0], [-2, 2, 0], BOX), false, 'stops short');
});

test('a segment that only touches a face or ends on it is not blocked', () => {
  assert.equal(segmentHitsBox([-5, 2, 1], [5, 2, 1], BOX), false, 'grazing the side');
  assert.equal(segmentHitsBox([-5, 2, 0], [-1, 2, 0], BOX), false, 'ending on the face');
  assert.equal(segmentHitsBox([0, 6, 0], [0, 4, 0], BOX), false, 'ending on the roof');
});

test('an axis-parallel segment outside the slab on that axis misses', () => {
  assert.equal(segmentHitsBox([3, 0, 0], [3, 9, 0], BOX), false);
  assert.equal(segmentHitsBox([0, -2, 0], [0, 9, 0], BOX), true, 'straight through');
});

test('boxOfInstance reads the centre and scale of a graph instance', () => {
  assert.deepEqual(boxOfInstance([1, 2, 3, 2, 4, 6, 0]), { min: [0, 0, 0], max: [2, 4, 6] });
});

test('clearPosition takes the first unobstructed candidate, else the least obstructed', () => {
  const target = [0, 2, 0];
  const front = [0, 3, -10];
  const above = [0, 12, -1];
  const wall = { min: [-3, 0, -6], max: [3, 5, -5] };
  assert.deepEqual(clearPosition(target, [front, above], [wall]), above, 'the first is blocked by the wall, the second clears it');
  assert.deepEqual(clearPosition(target, [above, front], [wall]), above, 'order is preference');
  const second = { min: [-3, 0, -9], max: [3, 5, -8] };
  assert.deepEqual(clearPosition(target, [front, [0, 3, -7]], [wall, second]), [0, 3, -7], 'fewest boxes in the way when all are blocked');
  assert.deepEqual(clearPosition(target, [front], []), front);
});

test('ringCandidates lists the lowest elevation first, every heading in order of preference at each', () => {
  const target = [1, 2, 3];
  const out = ringCandidates(target, [[0, 1], [1, 0]], [30, 60], 10);
  assert.equal(out.length, 4);
  for (const p of out) assert.ok(Math.abs(Math.hypot(p[0] - 1, p[1] - 2, p[2] - 3) - 10) < 1e-9);
  assert.ok(out[0][2] > target[2] && Math.abs(out[0][0] - 1) < 1e-9, 'the first heading is +z');
  assert.ok(out[1][0] > target[0] && Math.abs(out[1][2] - 3) < 1e-9, 'then +x, at the same elevation');
  assert.ok(Math.abs(out[0][1] - out[1][1]) < 1e-9 && out[2][1] > out[0][1], 'a higher elevation comes after every heading of the lower one');
});
