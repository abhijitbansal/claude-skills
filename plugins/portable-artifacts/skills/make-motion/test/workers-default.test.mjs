// The default for render --workers is "auto" (PA-40). No browser: the count is decided by parseWorkers alone; the byte
// parity of the default render against --workers 1 is in workers.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkers } from '../scripts/lib/workers.mjs';

test('parseWorkers: no --workers means auto, so a long film is not captured on one page', () => {
  assert.equal(parseWorkers(undefined, 10), 8, 'auto caps at 8');
  assert.equal(parseWorkers(undefined, 4), 3, 'auto leaves one core free');
  assert.equal(parseWorkers(undefined, 1), 1, 'auto never goes below 1');
  assert.equal(parseWorkers(undefined, 6), parseWorkers('auto', 6), 'the default is the word auto');
});

test('parseWorkers: an explicit count still wins over the default', () => {
  assert.equal(parseWorkers('1', 10), 1);
  assert.equal(parseWorkers('4', 2), 4);
});
