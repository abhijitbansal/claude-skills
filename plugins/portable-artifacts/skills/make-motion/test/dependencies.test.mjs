import { test } from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const SKILL = fileURLToPath(new URL('..', import.meta.url));
const json = (f) => JSON.parse(fs.readFileSync(path.join(SKILL, f), 'utf8'));
test('make-motion declares no unused font package in package.json or its lockfile', () => {
  for (const name of ['@fontsource/inter', '@fontsource/jetbrains-mono']) {
    assert.equal(json('package.json').dependencies[name], undefined, name);
    assert.equal(json('package-lock.json').packages[`node_modules/${name}`], undefined, name);
  }
});

// The packages version 1 alone imported (deleted at cut-over): none may be a dependency, or sit in a lockfile, any more.
const REMOVED = ['animejs', 'lottie-web', 'vega', 'vega-lite', 'vega-interpreter', 'vega-util'];
const REMOVED_VOICE = ['kokoro-js', '@huggingface/transformers', 'sharp'];
const lockHas = (lock, name) => Object.keys(lock.packages).some((k) => k === `node_modules/${name}` || k.endsWith(`/node_modules/${name}`));

test('the skill manifest declares exactly the packages version 2 imports, at their pinned versions', () => {
  assert.deepEqual(json('package.json').dependencies, {
    ajv: '8.20.0', 'd3-geo': '3.1.1', playwright: '1.64.0', shiki: '4.5.0', 'topojson-client': '3.1.0', 'us-atlas': '3.0.1', 'world-atlas': '2.0.2',
  });
});
test('none of the six version 1 packages is in the skill manifest or its lockfile', () => {
  const lock = json('package-lock.json');
  for (const name of REMOVED) {
    assert.equal(json('package.json').dependencies[name], undefined, `${name} in package.json`);
    assert.equal(lockHas(lock, name), false, `${name} in package-lock.json`);
  }
  assert.deepEqual(Object.keys(lock.packages['']?.dependencies ?? {}).sort(), Object.keys(json('package.json').dependencies).sort());
});
test('none of the version 1 voice packages is in optional/voice, its manifest or its lockfile', () => {
  const lock = json('optional/voice/package-lock.json');
  for (const name of REMOVED_VOICE) {
    assert.equal(json('optional/voice/package.json').dependencies[name], undefined, `${name} in package.json`);
    assert.equal(json('optional/voice/package.json').overrides?.[name], undefined, `${name} in overrides`);
    assert.equal(lockHas(lock, name), false, `${name} in package-lock.json`);
  }
});

// A package in a manifest is imported by kept code: `from 'pkg'`, `import('pkg')` or `require('pkg')`, with or without a subpath.
// us-atlas and world-atlas are read by file path through createRequire (scripts/v2/prepare/atlases.mjs), which counts as a use.
const KEPT_FOLDERS = ['scripts', 'engine', 'optional', 'shared'];
const walkSources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules' || e.name === '.cache') return [];
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walkSources(full) : /\.(mjs|js)$/.test(e.name) ? [full] : [];
});
const packageName = (spec) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
export function importedPackages(sources) {
  const names = new Set();
  for (const source of sources) {
    for (const m of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|\brequire\.resolve\s*\(\s*)['"]([^'".\/][^'"]*)['"]/g)) names.add(packageName(m[1]));
    for (const m of source.matchAll(/\bfile:\s*'([^'./][^']*)'/g)) names.add(packageName(m[1])); // atlases.mjs: { file: 'world-atlas/countries-110m.json' }
  }
  return names;
}
const keptSources = () => KEPT_FOLDERS.flatMap((f) => walkSources(path.join(SKILL, f))).map((f) => fs.readFileSync(f, 'utf8'));
test('every package in a manifest is imported by kept code, so an unused one cannot return unnoticed', () => {
  const used = importedPackages(keptSources());
  for (const file of ['package.json', 'optional/voice/package.json', 'optional/cutout/package.json']) {
    for (const name of Object.keys(json(file).dependencies)) assert.ok(used.has(name), `${name} (${file}) is imported by no kept file`);
  }
});
test('guardrail proof: the import scan sees a use, and misses a package nothing imports', () => {
  const used = importedPackages(["import Ajv from 'ajv';", "export { default } from 'onnxruntime-node';", "await import('shiki/core')", "{ file: 'world-atlas/c.json' }", "import x from './local.mjs'; import fs from 'node:fs';"]);
  assert.deepEqual([...used].sort(), ['ajv', 'node:fs', 'onnxruntime-node', 'shiki', 'world-atlas']);
  assert.equal(used.has('vega'), false);
});

const OPTIONAL = { voice: { deps: ['onnxruntime-node', 'phonemizer'], overrides: { 'global-agent': '4.1.3' } },
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
test('the entry files re-export from their own folder, and optional/voice exports only ort and phonemize', () => {
  const read = (f) => fs.readFileSync(path.join(SKILL, f), 'utf8');
  const voice = read('optional/voice/index.mjs');
  const exportLines = voice.split('\n').filter((line) => /^export\b/.test(line));
  assert.deepEqual(exportLines, ["export * as ort from 'onnxruntime-node';", "export { phonemize } from 'phonemizer';"]);
  assert.doesNotMatch(voice, /kokoro-js|@huggingface\/transformers|KokoroTTS|RawAudio/);
  assert.match(read('optional/cutout/index.mjs'), /export \{ default \} from 'onnxruntime-node';/);
});
test('the skill manifest keeps only its own override', () => assert.deepEqual(json('package.json').overrides, { 'fast-uri': '3.1.9' }));
