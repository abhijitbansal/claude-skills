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
import { UsageError } from '../scripts/lib/spec.mjs';

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
const notFound = (pkg) => Object.assign(new Error(`Cannot find package '${pkg}' imported from x`), { code: 'ERR_MODULE_NOT_FOUND' });

test('loads through a file URL when the path has a space and a #', async () => {
  const root = path.join(tmp('optional-url-'), 'a b#c', 'optional');
  const voiceDir = path.join(root, 'voice');
  mkdirSync(voiceDir, { recursive: true });
  cpSync(REAL_VOICE_ENTRY, path.join(voiceDir, 'index.mjs'));
  stubVoiceStack(voiceDir);
  const mod = await loadKokoro({ root });
  assert.equal(typeof mod.KokoroTTS, 'function');
  assert.equal(typeof mod.RawAudio, 'function');
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

test('the voice install hint is npm ci into optional/voice and names doctor id kokoro', () => {
  assert.ok(INSTALL_HINT.includes(`npm ci --prefix ${quoteArg(path.join(SKILL, 'optional', 'voice'))}`), INSTALL_HINT);
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
  const mod = await importOptional({ name: 'cutout', pkg: 'onnxruntime-node', hint: 'HINT', root: '/r', importer: async (u) => { urls.push(u); return { ok: 1 }; }, exists });
  assert.deepEqual(mod, { ok: 1 });
  assert.deepEqual(probed, [path.join('/r', 'cutout', 'node_modules', 'onnxruntime-node', 'package.json')]);
  assert.deepEqual(urls, [optionalEntryUrl('cutout', '/r')]);
});

test('importOptional: ERR_MODULE_NOT_FOUND naming the package is the hint; any other failure passes through', async () => {
  const call = (importer) => importOptional({ name: 'voice', pkg: 'kokoro-js', hint: 'HINT', root: '/r', importer, exists: () => true });
  await assert.rejects(() => call(async () => { throw notFound('kokoro-js'); }), (e) => e instanceof UsageError && e.message === 'HINT');
  await assert.rejects(() => call(async () => { throw notFound('sharp'); }), (e) => !(e instanceof UsageError) && /sharp/.test(e.message));
  await assert.rejects(() => call(async () => { throw new Error('boom'); }), /boom/);
});
