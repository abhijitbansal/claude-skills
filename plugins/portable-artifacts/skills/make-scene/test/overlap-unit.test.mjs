// The label collision pass: nearer labels win, hidden ones never hide others, touching-but-clear boxes stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiddenByOverlap } from '../template/runtime/chrome/overlap.js';

const box = (id, x, y, scale, w = 60, h = 14) => ({ id, x, y, w, h, scale });

test('separate boxes are all kept', () => {
  assert.equal(hiddenByOverlap([box(0, 50, 20, 10), box(1, 200, 20, 10), box(2, 50, 80, 10)]).size, 0);
});

test('of two overlapping boxes the farther one is hidden, whatever the order', () => {
  assert.deepEqual([...hiddenByOverlap([box(0, 100, 50, 4), box(1, 110, 52, 9)])], [0]);
  assert.deepEqual([...hiddenByOverlap([box(0, 100, 50, 9), box(1, 110, 52, 4)])], [1]);
});

test('equal depth: the earlier label wins', () => {
  assert.deepEqual([...hiddenByOverlap([box(0, 100, 50, 5), box(1, 100, 50, 5)])], [1]);
});

test('a hidden box does not hide the box behind it', () => {
  // 0 (nearest) overlaps 1; 1 would overlap 2 but is hidden, so 2 only competes with 0 and is clear of it.
  const hidden = hiddenByOverlap([box(0, 100, 50, 9), box(1, 150, 50, 6), box(2, 200, 50, 3)]);
  assert.deepEqual([...hidden], [1]);
});

test('boxes are taller than they are wide in the y direction: the box sits above its anchor', () => {
  // Same x; one anchored 30px lower sits clear of the 14px-tall box above it.
  assert.equal(hiddenByOverlap([box(0, 100, 50, 5), box(1, 100, 80, 5)]).size, 0);
  assert.equal(hiddenByOverlap([box(0, 100, 50, 5), box(1, 100, 60, 5)]).size, 1);
});

test('a gap smaller than the padding still counts as overlap, a larger one does not', () => {
  assert.equal(hiddenByOverlap([box(0, 0, 50, 5, 60), box(1, 61, 50, 5, 60)]).size, 1);
  assert.equal(hiddenByOverlap([box(0, 0, 50, 5, 60), box(1, 65, 50, 5, 60)]).size, 0);
});

test('an empty frame hides nothing', () => {
  assert.equal(hiddenByOverlap([]).size, 0);
});
