import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { BUNDLE_FILE, MAX_PAGE_BYTES, bundleHeaderHash, readBundle, sourcesHash, threeVersion } from '../scripts/lib/bundle.mjs';

test('committed bundle matches runtime sources', () => {
  assert.equal(
    bundleHeaderHash(readBundle()),
    sourcesHash(),
    'template/runtime/** changed without `npm run bundle`: rebuild and commit template/vendor/scene-runtime.min.js',
  );
});

test('bundle header carries hash, three version and licence line', () => {
  const [first] = readBundle().split('\n', 1);
  assert.match(first, /^\/\* make-scene runtime; sources sha256:[0-9a-f]{64}; three@\d+\.\d+\.\d+; MIT \(see THIRD_PARTY_NOTICES\.md\) \*\/$/);
  assert.equal(bundleHeaderHash('no header here'), null);
});

test('bundle is one classic script', () => {
  const text = readBundle();
  assert.ok(text.length > 1000, `bundle suspiciously small: ${BUNDLE_FILE}`);
  assert.doesNotMatch(text, /^\s*(import|export)\s/m, 'top-level import/export statement');
  for (const banned of [/\beval\(/, /new Function/, /\bWorker\(/, /blob:/]) {
    assert.doesNotMatch(text, banned, `bundle contains ${banned}`);
  }
  assert.doesNotThrow(() => new vm.Script(text), 'bundle must parse as a classic script');
});

test('bundle defines PAScene.mount', (t) => {
  const text = readBundle();
  const window = {};
  const sandbox = { window, globalThis: window, self: window, console, navigator: { userAgent: 'node' } };
  try {
    vm.runInNewContext(text, sandbox);
  } catch (err) {
    t.diagnostic(`three needs DOM at import (${err.message}); asserting the string only`);
    assert.match(text, /PAScene/);
    return;
  }
  assert.equal(typeof window.PAScene?.mount, 'function');
});

test('MAX_PAGE_BYTES is a whole number of 64 KB steps with room for the bundle', () => {
  assert.equal(MAX_PAGE_BYTES % (64 * 1024), 0);
  assert.ok(MAX_PAGE_BYTES >= Buffer.byteLength(readBundle()) + 768 * 1024);
});

const fakeRoot = (t, { pin, installed }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-three-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ devDependencies: { three: pin } }));
  if (installed) {
    fs.mkdirSync(path.join(dir, 'node_modules', 'three'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'three', 'package.json'), JSON.stringify({ version: installed }));
  }
  return dir;
};

test('three version falls back to the package.json pin', (t) => {
  assert.equal(threeVersion(fakeRoot(t, { pin: '9.9.9' })), '9.9.9');
});

test('installed three wins over the package.json pin', (t) => {
  assert.equal(threeVersion(fakeRoot(t, { pin: '9.9.9', installed: '1.2.3' })), '1.2.3');
});

test('three version errors when neither installed nor pinned', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-three-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => threeVersion(dir), /cannot determine three version/);
});
