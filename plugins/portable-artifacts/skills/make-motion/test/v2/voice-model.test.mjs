// The pinned timestamped Kokoro model: its table, its verified download, and the two runtime packages version 2 calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOICE_MODEL, ensureVoiceModel, voiceModelDir } from '../../scripts/v2/voice/model.mjs';

const SKILL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const COMMIT = 'dd4401a9add81ac692d20e240d22ec9dda82cc29';
const EXPECTED_FILES = [
  { path: 'config.json', bytes: 44, sha256: 'df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f' },
  { path: 'tokenizer.json', bytes: 3497, sha256: '77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34' },
  { path: 'tokenizer_config.json', bytes: 113, sha256: 'be1cb066d6ef6b074b3f15e6a6dd21ac88ff3cdaedf325f0aaed686c70f75d20' },
  { path: 'onnx/model_quantized.onnx', bytes: 92361055, sha256: 'c0c02b3299fd97c34ea92a98e6d41eaa1a739c8f77bf685aac34bd7b34c1132c' },
  { path: 'voices/af_heart.bin', bytes: 522240, sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b' },
];

const sha256Of = (bytes) => createHash('sha256').update(bytes).digest('hex');
const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'voice-model-'));

// A small stand-in model: two files whose bytes and hashes are real for the stand-in.
const GOOD = { 'a.json': Buffer.from('{"a":1}'), 'sub/m.bin': Buffer.from('model bytes') };
const BASE = `https://example.invalid/resolve/${COMMIT}/`;
const standIn = Object.freeze({
  id: 'test/model',
  commit: COMMIT,
  base: BASE,
  files: Object.freeze(Object.entries(GOOD).map(([p, b]) => Object.freeze({ path: p, bytes: b.length, sha256: sha256Of(b) }))),
});

// A fetch that serves `bodies[url]` (a Buffer) and records every URL it was asked for.
function fakeFetch(bodies) {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    const body = bodies[url];
    if (body === undefined) return { ok: false, status: 404, body: null };
    return { ok: true, status: 200, body: (async function* chunks() { yield body; })() };
  };
  return { fetchImpl, asked };
}

const servedFor = (model, overrides = {}) => Object.fromEntries(model.files.map((f) => [`${model.base}${f.path}`, overrides[f.path] ?? GOOD[f.path]]));

function placeFiles(dir, files) {
  for (const [p, bytes] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), bytes);
  }
}

const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name)) : []);

test('VOICE_MODEL is the timestamped Kokoro at one commit, with the five files, byte counts and hashes', () => {
  assert.equal(VOICE_MODEL.id, 'onnx-community/Kokoro-82M-v1.0-ONNX-timestamped');
  assert.equal(VOICE_MODEL.commit, COMMIT);
  assert.deepEqual(VOICE_MODEL.files.map((f) => ({ ...f })), EXPECTED_FILES);
});

test('VOICE_MODEL.base is the Hugging Face resolve URL of the model, ending with the commit and a slash', () => {
  assert.equal(VOICE_MODEL.base, `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped/resolve/${COMMIT}/`);
  assert.ok(VOICE_MODEL.base.endsWith(`${COMMIT}/`));
});

test('VOICE_MODEL is frozen all the way down', () => {
  assert.ok(Object.isFrozen(VOICE_MODEL));
  assert.ok(Object.isFrozen(VOICE_MODEL.files));
  for (const file of VOICE_MODEL.files) assert.ok(Object.isFrozen(file), file.path);
});

test('voiceModelDir keeps the model in its own cache folder, apart from the version 1 model', () => {
  const dir = voiceModelDir('/skill');
  assert.equal(dir, path.join('/skill', '.cache', 'models', VOICE_MODEL.id));
  assert.notEqual(dir, path.join('/skill', '.cache', 'models', 'onnx-community/Kokoro-82M-v1.0-ONNX'));
  assert.equal(voiceModelDir(), path.join(SKILL_ROOT, '.cache', 'models', VOICE_MODEL.id));
});

test('ensureVoiceModel downloads every missing file, verifies it and returns the folder', async () => {
  const dir = scratch();
  try {
    const { fetchImpl, asked } = fakeFetch(servedFor(standIn));
    const lines = [];
    const got = await ensureVoiceModel({ dir, model: standIn, fetchImpl, log: (l) => lines.push(l) });
    assert.equal(got, dir);
    assert.deepEqual(asked, standIn.files.map((f) => `${BASE}${f.path}`));
    for (const [p, bytes] of Object.entries(GOOD)) assert.deepEqual(readFileSync(path.join(dir, p)), bytes);
    assert.equal(lines.length, standIn.files.length, 'one log line per download');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ensureVoiceModel with every file present and correct never calls fetchImpl', async () => {
  const dir = scratch();
  try {
    placeFiles(dir, GOOD);
    const { fetchImpl, asked } = fakeFetch({});
    assert.equal(await ensureVoiceModel({ dir, model: standIn, fetchImpl }), dir);
    assert.deepEqual(asked, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ensureVoiceModel fetches only the file that is missing or wrong', async () => {
  const dir = scratch();
  try {
    placeFiles(dir, { 'a.json': GOOD['a.json'], 'sub/m.bin': Buffer.from('tampered') });
    const { fetchImpl, asked } = fakeFetch(servedFor(standIn));
    await ensureVoiceModel({ dir, model: standIn, fetchImpl });
    assert.deepEqual(asked, [`${BASE}sub/m.bin`]);
    assert.deepEqual(readFileSync(path.join(dir, 'sub/m.bin')), GOOD['sub/m.bin']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrong bytes for one file: ensureVoiceModel rejects naming that file and leaves nothing at its path', async () => {
  const dir = scratch();
  try {
    const { fetchImpl } = fakeFetch(servedFor(standIn, { 'sub/m.bin': Buffer.from('not the model') }));
    await assert.rejects(ensureVoiceModel({ dir, model: standIn, fetchImpl }), (e) => {
      assert.match(e.message, /sub\/m\.bin/);
      assert.match(e.message, /sha256 mismatch/);
      return true;
    });
    assert.equal(existsSync(path.join(dir, 'sub/m.bin')), false);
    assert.deepEqual(filesUnder(dir).filter((f) => f.includes('m.bin')), [], 'no partial file is left either');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real table: wrong bytes for its first file are refused by name and nothing is kept', async () => {
  const dir = scratch();
  try {
    const wrong = Object.fromEntries(VOICE_MODEL.files.map((f) => [`${VOICE_MODEL.base}${f.path}`, Buffer.from('wrong bytes')]));
    const { fetchImpl, asked } = fakeFetch(wrong);
    await assert.rejects(ensureVoiceModel({ dir, fetchImpl }), /config\.json/);
    assert.deepEqual(asked, [`${VOICE_MODEL.base}config.json`], 'it stops at the first bad file');
    assert.deepEqual(filesUnder(dir), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('optional/voice lists onnxruntime-node and phonemizer as direct dependencies at exactly the locked versions', () => {
  const voiceDir = path.join(SKILL_ROOT, 'optional', 'voice');
  const manifest = JSON.parse(readFileSync(path.join(voiceDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(readFileSync(path.join(voiceDir, 'package-lock.json'), 'utf8'));
  assert.equal(manifest.dependencies['onnxruntime-node'], '1.21.0');
  assert.equal(manifest.dependencies.phonemizer, '1.2.1');
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies, 'the lockfile root agrees with the manifest');
  assert.equal(lock.packages['node_modules/onnxruntime-node'].version, '1.21.0');
  assert.equal(lock.packages['node_modules/phonemizer'].version, '1.2.1');
});

test('optional/voice/index.mjs exports ort and phonemize beside the version 1 exports', () => {
  const source = readFileSync(path.join(SKILL_ROOT, 'optional', 'voice', 'index.mjs'), 'utf8');
  assert.match(source, /export \* as ort from 'onnxruntime-node';/);
  assert.match(source, /export \{ phonemize \} from 'phonemizer';/);
  assert.match(source, /export \{ KokoroTTS, TextSplitterStream \} from 'kokoro-js';/);
  assert.match(source, /export \{ env, RawAudio \} from '@huggingface\/transformers';/);
});
