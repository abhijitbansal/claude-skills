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

test('bundle is safe to inline: no script terminator and no HTML comment opener', () => {
  const text = readBundle();
  // page.mjs also escapes these (inlineCode), but an escaped bundle is a changed bundle: keep the source clean.
  assert.ok(!/<\/script/i.test(text), 'bundle contains "</script", which would end the inline <script>');
  assert.ok(!text.includes('<!--'), 'bundle contains "<!--", which opens an HTML comment inside the inline <script>');
  // Guardrail proof: the same check fires on bad input.
  assert.ok(/<\/script/i.test(`${text}\n"</SCRIPT>"`));
  assert.ok(`${text}"<!--"`.includes('<!--'));
});

test('bundle defines PAScene.mount, mountScene and initAll', (t) => {
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
  for (const name of ['mount', 'mountScene', 'initAll']) assert.equal(typeof window.PAScene?.[name], 'function', name);
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

test('bundle carries three.js licence notice (MIT requires it in every copy)', () => {
  const text = readBundle();
  assert.match(text, /@license[\s\S]{0,40}Copyright[^\n]*Three\.js Authors/, 'three copyright line missing from the bundle');
  assert.match(text, /SPDX-License-Identifier: MIT/, 'three SPDX identifier missing from the bundle');
});

test('a built page inlines the licence notice with the bundle', async (t) => {
  const { buildWorldPage } = await import('./helpers/browser.mjs');
  const { file } = await buildWorldPage(t, 'city');
  const page = fs.readFileSync(file, 'utf8');
  assert.match(page, /@license[\s\S]{0,40}Copyright[^\n]*Three\.js Authors/, 'built page has no three copyright line');
  assert.match(page, /SPDX-License-Identifier: MIT/, 'built page has no SPDX identifier');
});

// MIT: "The above copyright notice and this permission notice shall be included in all copies": the copyright line
// alone is not enough, the permission paragraph travels too (verbatim from three's LICENSE).
const THREE_LICENSE = fs.readFileSync(new URL('../node_modules/three/LICENSE', import.meta.url), 'utf8').trim();
const noticeProblems = (text) => [
  [/Copyright[^\n]*three\.js authors/i, 'the three.js copyright line'],
  [/Permission is hereby granted/, 'the permission paragraph'],
].filter(([re]) => !re.test(text)).map(([, what]) => what).concat(text.includes(THREE_LICENSE) ? [] : ['three\'s LICENSE verbatim']);

test('bundle carries three.js full MIT notice: copyright line and permission paragraph, verbatim', () => {
  assert.deepEqual(noticeProblems(readBundle()), []);
  assert.match(readBundle(), /THE SOFTWARE\.\s*\*\/\s*$/, 'the notice is in a comment at the end of the bundle');
});

test('a built page carries three.js full MIT notice: copyright line and permission paragraph, verbatim', async (t) => {
  const { buildWorldPage } = await import('./helpers/browser.mjs');
  const { file } = await buildWorldPage(t, 'city');
  assert.deepEqual(noticeProblems(fs.readFileSync(file, 'utf8')), []);
});
