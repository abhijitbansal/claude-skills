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

test('theme cycles auto -> light -> dark -> auto; junk falls back to auto', () => {
  const PA = loadPaLib();
  assert.equal(PA.nextTheme('auto'), 'light');
  assert.equal(PA.nextTheme('light'), 'dark');
  assert.equal(PA.nextTheme('dark'), 'auto');
  assert.equal(PA.nextTheme('weird'), 'light');
});

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
