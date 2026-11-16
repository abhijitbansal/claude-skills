// The pairing and statistics of scripts/v2/voice/accuracy.mjs, on synthetic numbers. The real measurement needs the
// optional voice package, the model and ffmpeg; it is run by hand (node scripts/v2/voice/accuracy.mjs --json), not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { errorStats, median, pairMutual, percentile90 } from '../../scripts/v2/voice/accuracy.mjs';

test('pairMutual pairs each onset with the prediction that is nearest to it and to which it is nearest', () => {
  const pairs = pairMutual([0.1, 1.02, 2.05], [0.12, 1.0, 2.0]);
  assert.deepEqual(pairs, [{ mi: 0, pi: 0 }, { mi: 1, pi: 1 }, { mi: 2, pi: 2 }]);
});

test('pairMutual never counts one prediction twice: of two onsets near one word, only the nearer is paired', () => {
  // Onsets 1.0 and 1.3 both have 1.05 as their nearest prediction; 1.05's nearest onset is 1.0, so 1.3 is not paired.
  const pairs = pairMutual([1.0, 1.3], [1.05, 3.0]);
  assert.deepEqual(pairs, [{ mi: 0, pi: 0 }]);
  assert.equal(new Set(pairs.map((p) => p.pi)).size, pairs.length, 'each prediction appears at most once');
});

test('pairMutual drops an onset that has no prediction of its own (a burst far from every word)', () => {
  const pairs = pairMutual([0.5, 1.0, 4.8], [0.52, 1.01]);
  assert.deepEqual(pairs, [{ mi: 0, pi: 0 }, { mi: 1, pi: 1 }]);
});

test('pairMutual leaves a word with no onset unpaired, and pairs nothing when either side is empty', () => {
  assert.deepEqual(pairMutual([1.0], [0.2, 1.01, 2.5]), [{ mi: 0, pi: 1 }]);
  assert.deepEqual(pairMutual([], [1.0]), []);
  assert.deepEqual(pairMutual([1.0], []), []);
});

test('median is the middle value, or the mean of the two middle values, of an unsorted list', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

test('percentile90 is the value at rank ceil(0.9 n) of the sorted list (nearest rank)', () => {
  assert.equal(percentile90([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), 9);
  assert.equal(percentile90(Array.from({ length: 20 }, (_, i) => i + 1)), 18);
  assert.equal(percentile90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 10);
  assert.equal(percentile90([42]), 42);
});

test('median and percentile90 of an empty list are null, not a number', () => {
  assert.equal(median([]), null);
  assert.equal(percentile90([]), null);
});

test('median and percentile90 do not reorder the list they are given', () => {
  const values = [3, 1, 2];
  median(values);
  percentile90(values);
  assert.deepEqual(values, [3, 1, 2]);
});

test('errorStats reports the median and 90th percentile of absolute errors and the median signed error, in whole ms', () => {
  // Signed errors in seconds (prediction minus measurement).
  const stats = errorStats([0.01, -0.02, 0.03, -0.04, 0.05]);
  assert.deepEqual(stats, { n: 5, medianMs: 30, p90Ms: 50, biasMs: 10 });
});

test('errorStats of no errors is n 0 with null figures', () => {
  assert.deepEqual(errorStats([]), { n: 0, medianMs: null, p90Ms: null, biasMs: null });
});
