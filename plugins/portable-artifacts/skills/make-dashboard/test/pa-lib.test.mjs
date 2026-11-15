import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadPaLib() {
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'template/pa-lib.js'), 'utf8'), ctx);
  return ctx.PA;
}

test('storage helpers survive storage that throws (private mode)', () => {
  const PA = loadPaLib();
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(PA.readStore(broken, 'k'), null);
  assert.doesNotThrow(() => PA.writeStore(broken, 'k', 'v'));
  assert.equal(PA.readStore(undefined, 'k'), null);
});

test('sortRows: numbers numerically, text by locale, NULLs last both ways, input untouched', () => {
  const PA = loadPaLib();
  const rows = [{ v: 10 }, { v: null }, { v: 9 }, { v: 100 }];
  assert.deepEqual(PA.sortRows(rows, 'v', 'asc').map((r) => r.v), [9, 10, 100, null]);
  assert.deepEqual(PA.sortRows(rows, 'v', 'desc').map((r) => r.v), [100, 10, 9, null]);
  assert.deepEqual(rows.map((r) => r.v), [10, null, 9, 100]);
  assert.deepEqual(PA.sortRows([{ s: 'b' }, { s: 'a' }, { s: 'B' }], 's', 'asc').map((r) => r.s), ['a', 'b', 'B']);
  assert.equal(PA.TABLE_LIMIT, 500);
});

test('toCsv quotes per RFC 4180, writes NULL as empty, guards formula-like text', () => {
  const PA = loadPaLib();
  const csv = PA.toCsv(['name', 'note', 'n'], [
    { name: 'a,b', note: 'say "hi"', n: 1 },
    { name: '=HYPERLINK("x")', note: null, n: -5 },
    { name: '+1', note: '@sum', n: 2.5 },
    { name: 'line\nbreak', note: '-x', n: null },
  ]);
  assert.equal(csv, [
    'name,note,n',
    '"a,b","say ""hi""",1',
    `"'=HYPERLINK(""x"")",,-5`,
    "'+1,'@sum,2.5",
    '"line\nbreak",\'-x,',
    '',
  ].join('\r\n'));
});

test('fileStem makes a safe download name', () => {
  const PA = loadPaLib();
  assert.equal(PA.fileStem('Revenue by Region (2025)'), 'revenue-by-region-2025');
  assert.equal(PA.fileStem('***'), 'chart');
  assert.equal(PA.fileStem('a'.repeat(80)).length, 60);
});

test('numericColumns: a column is numeric when every non-NULL value is a number', () => {
  const PA = loadPaLib();
  const rows = [{ region: 'North', revenue: 1234.5, units: 3, note: null }, { region: 'South', revenue: null, units: 12, note: 'x' }];
  assert.deepEqual([...PA.numericColumns(['region', 'revenue', 'units', 'note'], rows)], ['revenue', 'units']);
  assert.deepEqual([...PA.numericColumns(['n'], [{ n: null }])], [], 'an all-NULL column is not numeric');
});

test('cellText groups digits and caps decimals in numeric cells; text and NULLs as before', () => {
  const PA = loadPaLib();
  assert.equal(PA.cellText(1234567.891, 'revenue', true), '1,234,567.89');
  assert.equal(PA.cellText(-0.5, 'delta', true), '-0.5');
  assert.equal(PA.cellText(2025, 'year', true), '2025', 'a year column is not grouped');
  assert.equal(PA.cellText('North', 'region', false), 'North');
  assert.equal(PA.cellText(null, 'revenue', true), '');
  assert.equal(PA.cellText(12, 'id_text', false), '12', 'a number in a text column stays as written');
});
