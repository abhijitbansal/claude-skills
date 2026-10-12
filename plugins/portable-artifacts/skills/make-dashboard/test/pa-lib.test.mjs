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
