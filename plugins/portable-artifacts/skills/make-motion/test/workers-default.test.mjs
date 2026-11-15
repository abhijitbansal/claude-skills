// The default for render --workers is "auto" (PA-40). No browser: the count is decided by parseWorkers alone; the byte
// parity of the default render against --workers 1 is in workers.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkers } from '../scripts/lib/workers.mjs';
import { withTestWorkers } from './helpers/workers-arg.mjs';

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

// W2P-M11: the render default is auto (up to 8 pages), but `npm test` runs files in parallel, so a render test that
// names no --workers would open up to 8 pages each. The test helper pins one page unless a test asks for more.
test('withTestWorkers: a render test with no --workers gets --workers 1', () => {
  assert.deepEqual(withTestWorkers(['--fps', '10']), ['--fps', '10', '--workers', '1']);
  assert.deepEqual(withTestWorkers([]), ['--workers', '1']);
  assert.deepEqual(withTestWorkers(undefined), ['--workers', '1']);
});

test('withTestWorkers: a test that names --workers (either spelling) keeps its own count', () => {
  assert.deepEqual(withTestWorkers(['--workers', '3']), ['--workers', '3']);
  assert.deepEqual(withTestWorkers(['--workers=auto', '--fps', '10']), ['--workers=auto', '--fps', '10']);
});

test('withTestWorkers: a mode that refuses --workers (contact sheet, poster, batch) gets none', () => {
  for (const flag of ['--contact-sheet', '--poster', '--batch']) assert.deepEqual(withTestWorkers([flag, '1']), [flag, '1'], flag);
});

test('withTestWorkers: leaves the caller\'s array alone', () => {
  const args = ['--fps', '10'];
  withTestWorkers(args);
  assert.deepEqual(args, ['--fps', '10']);
});
