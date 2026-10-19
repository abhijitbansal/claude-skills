import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../scripts/lib/csv.mjs';

test('parses plain rows', () => {
  assert.deepEqual(parseCsv('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('quoted fields keep commas and newlines', () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","l1\nl2"\n'), [['a', 'b'], ['x, y', 'l1\nl2']]);
});

test('escaped quotes inside a quoted field', () => {
  assert.deepEqual(parseCsv('a\n"say ""hi"""\n'), [['a'], ['say "hi"']]);
});

test('CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2\r\n3,4'), [['a', 'b'], ['1', '2'], ['3', '4']]);
});

test('leading BOM is dropped', () => {
  assert.deepEqual(parseCsv('﻿a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('trailing newline adds no empty row, blank lines are skipped', () => {
  assert.deepEqual(parseCsv('a\n1\n\n2\n\n'), [['a'], ['1'], ['2']]);
});

test('empty cells are kept as empty strings', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,,3\n'), [['a', 'b', 'c'], ['1', '', '3']]);
});

test('empty input is no rows', () => {
  assert.deepEqual(parseCsv(''), []);
});

test('unterminated quote throws', () => {
  assert.throws(() => parseCsv('a\n"oops\n'), /unterminated quote/);
});
