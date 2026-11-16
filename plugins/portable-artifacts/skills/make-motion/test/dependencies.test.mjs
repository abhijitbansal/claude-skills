import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const SKILL = fileURLToPath(new URL('..', import.meta.url));
const json = (f) => JSON.parse(fs.readFileSync(path.join(SKILL, f), 'utf8'));
test('make-motion declares no unused font package in package.json or its lockfile', () => {
  for (const name of ['@fontsource/inter', '@fontsource/jetbrains-mono']) {
    assert.equal(json('package.json').dependencies[name], undefined, name);
    assert.equal(json('package-lock.json').packages[`node_modules/${name}`], undefined, name);
  }
});

// voice: kokoro-js and transformers serve version 1 (scripts/voice.mjs); onnxruntime-node and phonemizer serve version 2 (scripts/v2/voice).
const OPTIONAL = { voice: { deps: ['@huggingface/transformers', 'kokoro-js', 'onnxruntime-node', 'phonemizer'], overrides: { sharp: '0.35.5', 'global-agent': '4.1.3' } },
  cutout: { deps: ['onnxruntime-node'], overrides: { 'global-agent': '4.1.3' } } };
for (const [name, want] of Object.entries(OPTIONAL)) {
  test(`optional/${name}: exact dependencies, its overrides, and a lockfile in step with them`, () => {
    const pkg = json(`optional/${name}/package.json`); const lock = json(`optional/${name}/package-lock.json`);
    assert.deepEqual(Object.keys(pkg.dependencies).sort(), want.deps);
    assert.deepEqual(pkg.overrides, want.overrides);
    assert.equal(lock.lockfileVersion, 3);
    assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
    for (const [dep, v] of Object.entries(pkg.dependencies)) assert.equal(lock.packages[`node_modules/${dep}`].version, v);
  });
}
test('optional/voice locks one copy of @huggingface/transformers, shared by kokoro-js and index.mjs', () => {
  const keys = Object.keys(json('optional/voice/package-lock.json').packages).filter((k) => k.endsWith('node_modules/@huggingface/transformers'));
  assert.deepEqual(keys, ['node_modules/@huggingface/transformers']);
});
test('the entry files re-export from their own folder', () => {
  const read = (f) => fs.readFileSync(path.join(SKILL, f), 'utf8');
  assert.match(read('optional/voice/index.mjs'), /export \{ KokoroTTS, TextSplitterStream \} from 'kokoro-js';\nexport \{ env, RawAudio \} from '@huggingface\/transformers';/);
  assert.match(read('optional/cutout/index.mjs'), /export \{ default \} from 'onnxruntime-node';/);
});
test('the skill manifest keeps only its own override', () => assert.deepEqual(json('package.json').overrides, { 'fast-uri': '3.1.9' }));
