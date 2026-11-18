// optional.mjs: the voice and cutout stacks are loaded from their own locked folders, never from the skill's node_modules.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { quoteArg } from '../shared/doctor.mjs';
import { importOptional, optionalEntryUrl } from '../scripts/lib/optional.mjs';
import { loadKokoro, INSTALL_HINT } from '../scripts/lib/voice.mjs';
import { UsageError } from '../shared/cli.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_VOICE_ENTRY = path.join(SKILL, 'optional/voice/index.mjs');
const made = [];
const tmp = (prefix) => { const d = mkdtempSync(path.join(tmpdir(), prefix)); made.push(d); return d; };
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

// <dir>/node_modules/<name>/{package.json,index.mjs}: a package that exports what `src` says.
function stubPkg(dir, name, src) {
  const pkgDir = path.join(dir, 'node_modules', name);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name, type: 'module', exports: './index.mjs' }));
  writeFileSync(path.join(pkgDir, 'index.mjs'), src);
}
const stubVoiceStack = (voiceDir) => {
  stubPkg(voiceDir, 'kokoro-js', 'export class KokoroTTS {} export class TextSplitterStream {}');
  stubPkg(voiceDir, '@huggingface/transformers', 'export const env = {}; export class RawAudio {}');
};
const VOICE_DEPS = { 'kokoro-js': '1.2.1', '@huggingface/transformers': '3.8.1' };
const writeManifest = (dir, dependencies) => writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'make-motion-voice', dependencies }));
const lockOf = (packages) => JSON.stringify({ lockfileVersion: 3, packages: { '': {}, ...packages } });
const writeLock = (dir, packages) => writeFileSync(path.join(dir, 'package-lock.json'), lockOf(packages));
const VOICE_LOCK = { 'node_modules/kokoro-js': { version: '1.2.1' }, 'node_modules/@huggingface/transformers': { version: '3.8.1' } };
// readFile for injected tests: the folder's package.json lists `dependencies`, its package-lock.json lists `lockPackages`.
const manifestOf = (dependencies, lockPackages = {}) => (file) => (file.endsWith('package-lock.json') ? lockOf(lockPackages) : JSON.stringify({ dependencies }));
const notFound = (pkg) => Object.assign(new Error(`Cannot find package '${pkg}' imported from x`), { code: 'ERR_MODULE_NOT_FOUND' });

test('loads through a file URL when the path has a space and a #', async () => {
  const root = path.join(tmp('optional-url-'), 'a b#c', 'optional');
  const voiceDir = path.join(root, 'voice');
  mkdirSync(voiceDir, { recursive: true });
  cpSync(REAL_VOICE_ENTRY, path.join(voiceDir, 'index.mjs'));
  // The real index.mjs also re-exports the version 2 runtime, so this folder carries all four of its imports.
  writeManifest(voiceDir, { ...VOICE_DEPS, 'onnxruntime-node': '1.21.0', phonemizer: '1.2.1' });
  writeLock(voiceDir, { ...VOICE_LOCK, 'node_modules/onnxruntime-node': { version: '1.21.0' }, 'node_modules/phonemizer': { version: '1.2.1' } });
  stubVoiceStack(voiceDir);
  stubPkg(voiceDir, 'onnxruntime-node', 'export class InferenceSession {} export class Tensor {}');
  stubPkg(voiceDir, 'phonemizer', 'export function phonemize() { return []; }');
  const mod = await loadKokoro({ root });
  assert.equal(typeof mod.KokoroTTS, 'function');
  assert.equal(typeof mod.RawAudio, 'function');
  assert.equal(typeof mod.ort.InferenceSession, 'function');
  assert.equal(typeof mod.phonemize, 'function');
  assert.equal(optionalEntryUrl('voice', root), pathToFileURL(path.join(root, 'voice', 'index.mjs')).href);
});

test('the loader never falls back to the skill\'s own node_modules', async () => {
  const skill = path.join(tmp('optional-old-'), 'make-motion');
  const voiceDir = path.join(skill, 'optional', 'voice');
  mkdirSync(voiceDir, { recursive: true });
  cpSync(REAL_VOICE_ENTRY, path.join(voiceDir, 'index.mjs'));
  stubVoiceStack(skill); // a complete old `npm install --no-save` tree one level up: without the guard it would load
  await assert.rejects(() => loadKokoro({ root: path.join(skill, 'optional') }), (e) => e instanceof UsageError && e.message === INSTALL_HINT);
});

test('a direct dependency that would load from outside the optional folder is refused, naming the stray path', async () => {
  const skill = path.join(tmp('optional-stray-'), 'make-motion');
  const voiceDir = path.join(skill, 'optional', 'voice');
  mkdirSync(voiceDir, { recursive: true });
  cpSync(REAL_VOICE_ENTRY, path.join(voiceDir, 'index.mjs'));
  writeManifest(voiceDir, VOICE_DEPS);
  stubPkg(voiceDir, 'kokoro-js', 'export class KokoroTTS {} export class TextSplitterStream {}'); // a partial install: transformers is missing here
  stubPkg(skill, '@huggingface/transformers', 'export const env = {}; export class RawAudio {}'); // ...but an old unlocked copy sits above
  const stray = path.join(skill, 'node_modules', '@huggingface', 'transformers');
  await assert.rejects(() => loadKokoro({ root: path.join(skill, 'optional') }), (e) => e instanceof UsageError && e.message.includes(stray) && e.message.includes('@huggingface/transformers'));
});

test('a transitive package listed in the lockfile but missing from the folder is refused, even when an old copy sits above it', async () => {
  const skill = path.join(tmp('optional-transitive-'), 'make-motion');
  const voiceDir = path.join(skill, 'optional', 'voice');
  mkdirSync(voiceDir, { recursive: true });
  cpSync(REAL_VOICE_ENTRY, path.join(voiceDir, 'index.mjs'));
  writeManifest(voiceDir, VOICE_DEPS);
  writeLock(voiceDir, { ...VOICE_LOCK, 'node_modules/phonemizer': { version: '1.2.1' } }); // an interrupted install: phonemizer never arrived
  stubVoiceStack(voiceDir);
  stubPkg(skill, 'phonemizer', 'export default 1;'); // ...but an old unlocked tree has one
  const missing = path.join(voiceDir, 'node_modules', 'phonemizer');
  await assert.rejects(() => loadKokoro({ root: path.join(skill, 'optional') }), (e) => e instanceof UsageError && e.message.includes(missing) && /re-run|rerun/i.test(e.message) && e.message.includes(INSTALL_HINT));
});

test('importOptional walks the lockfile: it names the first missing package and skips what this platform or the install may leave out', async () => {
  const folder = path.join('/r', 'voice');
  const importer = async () => { throw new Error('must not import'); };
  const here = { os: 'linux', cpu: 'x64' };
  const lock = {
    'node_modules/a': { version: '1.0.0' },
    'node_modules/a/node_modules/c': { version: '2.0.0' },
    'node_modules/@s/win': { version: '1.0.0', os: ['win32'], optional: true },
    'node_modules/mac-only': { version: '1.0.0', os: ['darwin'] },
    'node_modules/not-linux': { version: '1.0.0', os: ['!linux'] },
    'node_modules/arm-only': { version: '1.0.0', cpu: ['arm64'] },
    'node_modules/maybe': { version: '1.0.0', optional: true },
    'node_modules/d': { version: '3.0.0' },
    'node_modules/e': { version: '3.0.0' },
  };
  const readFile = manifestOf({ a: '1.0.0' }, lock);
  const present = new Set(['a', 'a/node_modules/c']);
  const exists = (p) => [...present].some((k) => p === path.join(folder, 'node_modules', k, 'package.json'));
  const run = (extra = {}) => importOptional({ name: 'voice', pkg: 'a', hint: 'HINT', root: '/r', importer, readFile, exists, platform: here, ...extra });
  await assert.rejects(run, (e) => e instanceof UsageError && e.message.includes(path.join(folder, 'node_modules', 'd')) && !e.message.includes('node_modules/e') && !e.message.includes('mac-only') && e.message.includes('HINT'));
  present.add('d');
  await assert.rejects(run, (e) => e.message.includes(path.join(folder, 'node_modules', 'e')));
  present.add('e');
  const ok = await run({ importer: async () => ({ ok: 1 }) });
  assert.deepEqual(ok, { ok: 1 }, 'the other-platform, other-arch, negated-os and optional entries were not required');
  await assert.rejects(() => run({ platform: { os: 'darwin', cpu: 'x64' }, importer }), (e) => e.message.includes('not-linux') === false && e.message.includes(path.join(folder, 'node_modules', 'mac-only')), 'mac-only is required on darwin');
});

test('importOptional: a lockfile with no packages map, or an unreadable one, is an error that names the file', async () => {
  const importer = async () => ({});
  const lockFile = path.join('/r', 'voice', 'package-lock.json');
  const noPackages = (file) => (file.endsWith('package-lock.json') ? JSON.stringify({ lockfileVersion: 1, dependencies: {} }) : JSON.stringify({ dependencies: {} }));
  await assert.rejects(() => importOptional({ name: 'voice', pkg: 'a', hint: 'HINT', root: '/r', importer, exists: () => true, readFile: noPackages }), (e) => e.message.includes(lockFile) && /packages/.test(e.message));
  const unreadable = (file) => { if (file.endsWith('package-lock.json')) throw new Error('ENOENT'); return JSON.stringify({ dependencies: {} }); };
  await assert.rejects(() => importOptional({ name: 'voice', pkg: 'a', hint: 'HINT', root: '/r', importer, exists: () => true, readFile: unreadable }), (e) => e.message.includes(lockFile));
});

test('the voice install hint is npm ci into optional/voice and names doctor id kokoro', () => {
  assert.ok(INSTALL_HINT.includes(`npm ci --ignore-scripts --prefix ${quoteArg(path.join(SKILL, 'optional', 'voice'))}`), INSTALL_HINT);
  assert.doesNotMatch(INSTALL_HINT, /npm install/);
  assert.match(INSTALL_HINT, /--for voiceover, id kokoro\)/);
});

test('importOptional: a missing package folder is the hint, and nothing is imported', async () => {
  const importer = async () => { throw new Error('must not import'); };
  await assert.rejects(() => importOptional({ name: 'voice', pkg: 'kokoro-js', hint: 'HINT', root: '/r', importer, exists: () => false }), (e) => e instanceof UsageError && e.message === 'HINT');
});

test('importOptional probes <root>/<name>/node_modules/<pkg>/package.json and imports the folder\'s index.mjs by URL', async () => {
  const probed = [];
  const urls = [];
  const exists = (p) => { probed.push(p); return true; };
  const readFile = manifestOf({ 'onnxruntime-node': '1.31.1' });
  const mod = await importOptional({ name: 'cutout', pkg: 'onnxruntime-node', hint: 'HINT', root: '/r', importer: async (u) => { urls.push(u); return { ok: 1 }; }, exists, readFile });
  assert.deepEqual(mod, { ok: 1 });
  assert.ok(probed.includes(path.join('/r', 'cutout', 'node_modules', 'onnxruntime-node', 'package.json')));
  assert.deepEqual(urls, [optionalEntryUrl('cutout', '/r')]);
});

test('importOptional checks every direct dependency of the folder: one found only above it is refused with its path, one found nowhere is the hint', async () => {
  const folder = path.join('/r', 'voice');
  const importer = async () => { throw new Error('must not import'); };
  const readFile = manifestOf({ a: '1.0.0', b: '1.0.0' });
  const inside = (dep) => path.join(folder, 'node_modules', dep, 'package.json');
  const above = path.join('/r', 'node_modules', 'b', 'package.json');
  const stray = importOptional({ name: 'voice', pkg: 'a', hint: 'HINT', root: '/r', importer, readFile, exists: (p) => p === inside('a') || p === above });
  await assert.rejects(() => stray, (e) => e instanceof UsageError && e.message.includes(path.dirname(above)) && /b is missing from/.test(e.message));
  const nowhere = importOptional({ name: 'voice', pkg: 'a', hint: 'HINT', root: '/r', importer, readFile, exists: (p) => p === inside('a') });
  await assert.rejects(() => nowhere, (e) => e instanceof UsageError && e.message === 'HINT');
});

test('importOptional: an unreadable package.json is an error that names the file, not a silent skip of the check', async () => {
  const readFile = () => { throw new Error('ENOENT: no such file'); };
  await assert.rejects(
    () => importOptional({ name: 'voice', pkg: 'kokoro-js', hint: 'HINT', root: '/r', importer: async () => ({}), exists: () => true, readFile }),
    (e) => !(e instanceof UsageError) && e.message.includes(path.join('/r', 'voice', 'package.json')),
  );
});

test('importOptional: ERR_MODULE_NOT_FOUND naming the package is the hint; any other failure passes through', async () => {
  const readFile = manifestOf({ 'kokoro-js': '1.2.1' });
  const call = (importer) => importOptional({ name: 'voice', pkg: 'kokoro-js', hint: 'HINT', root: '/r', importer, exists: () => true, readFile });
  await assert.rejects(() => call(async () => { throw notFound('kokoro-js'); }), (e) => e instanceof UsageError && e.message === 'HINT');
  await assert.rejects(() => call(async () => { throw notFound('sharp'); }), (e) => !(e instanceof UsageError) && /sharp/.test(e.message));
  await assert.rejects(() => call(async () => { throw new Error('boom'); }), /boom/);
});
