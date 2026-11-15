// voice.mjs --dir <folder> (PA-39): every .txt in the folder becomes <name>.wav beside it, the model loads once for all of them
// and a narration whose text, voice and speed did not change is skipped. And the download progress on stderr. No model, no
// browser: stubs stand in for kokoro-js, as in voice.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseVoiceArgs, dirJobs, synthesizeDir, textHash, downloadProgress, loadModel, KOKORO_REVISION, MODEL_ID, MODEL_CACHE_DIR, USAGE } from '../scripts/lib/voice.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VOICE = path.join(root, 'scripts/voice.mjs');
const folder = (files) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vd-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
};

class StubSplitterStream {
  constructor() { this.text = ''; this.closed = false; }
  push(t) { this.text += t; }
  close() { this.closed = true; }
  [Symbol.iterator]() { return this.text.split(/(?<=[.!?])\s+/)[Symbol.iterator](); }
}
class StubRawAudio {
  constructor(audio, rate) { this.audio = audio; this.rate = rate; }
  async save(file) { writeFileSync(file, `wav:${this.audio.length}@${this.rate}`); }
}
// One 24000-sample result per sentence the stub is given.
const tts = { stream: async function* (splitter) { for (const chunk of splitter) yield { text: chunk, phonemes: 'p', audio: { audio: new Float32Array(24000) } }; } };
const session = (counter) => async () => {
  counter.loads++;
  return { kokoro: { TextSplitterStream: StubSplitterStream }, tts: { ...tts, voices: { af_heart: {} } }, dispose: async () => { counter.disposed++; } };
};

test('parseVoiceArgs: --dir needs no text and no --out, and refuses both', () => {
  const dir = folder({ 'a.txt': 'Hello.' });
  const opts = parseVoiceArgs(['--dir', dir]);
  assert.equal(opts.dir, dir);
  assert.equal(opts.voice, 'af_heart');
  assert.throws(() => parseVoiceArgs(['--dir', dir, '--out', 'x.wav']), /--dir writes <name>\.wav beside each \.txt/);
  assert.throws(() => parseVoiceArgs(['--dir', dir, 'Some text']), /--dir reads the narration from the folder/);
  assert.throws(() => parseVoiceArgs(['--dir', dir, '--text-file', 'n.txt']), /--dir reads the narration from the folder/);
  assert.throws(() => parseVoiceArgs(['--dir']), /--dir needs a value/);
});

test('the usage line names --dir', () => {
  assert.match(USAGE, /--dir <folder>/);
});

test('dirJobs: one job per .txt in name order, each writing <name>.wav beside it; other files are left alone', () => {
  const dir = folder({ 'b.txt': 'Second.', 'a.txt': 'First.', 'notes.md': 'ignored', 'c.wav': 'x' });
  const jobs = dirJobs(parseVoiceArgs(['--dir', dir]));
  assert.deepEqual(jobs.map((j) => path.basename(j.out)), ['a.wav', 'b.wav']);
  assert.deepEqual(jobs.map((j) => j.text), ['First.', 'Second.']);
  assert.deepEqual(jobs.map((j) => j.fresh), [false, false]);
});

test('dirJobs: a missing folder, a folder with no .txt and an empty .txt are usage errors that say so', () => {
  const opts = (dir) => parseVoiceArgs(['--dir', dir]);
  assert.throws(() => dirJobs(opts(path.join(tmpdir(), 'no-such-voice-dir'))), /--dir: cannot read /);
  assert.throws(() => dirJobs(opts(folder({ 'x.md': 'a' }))), /--dir: no \.txt files in /);
  assert.throws(() => dirJobs(opts(folder({ 'blank.txt': '  \n' }))), /--dir: blank\.txt is empty: nothing to say/);
});

test('synthesizeDir: the model loads once for every narration, each gets a wav and a sidecar, and the session is disposed', async () => {
  const dir = folder({ 'a.txt': 'One. Two.', 'b.txt': 'Three.' });
  const counter = { loads: 0, disposed: 0 };
  const results = await synthesizeDir(parseVoiceArgs(['--dir', dir]), { load: session(counter), deps: { RawAudio: StubRawAudio } });
  assert.equal(counter.loads, 1, 'one model load for two narrations');
  assert.equal(counter.disposed, 1);
  assert.deepEqual(results.map((r) => [path.basename(r.job.out), r.skipped === true]), [['a.wav', false], ['b.wav', false]]);
  assert.equal(results[0].seconds, 2);
  assert.equal(readFileSync(path.join(dir, 'a.wav'), 'utf8'), 'wav:48000@24000');
  const sidecar = JSON.parse(readFileSync(path.join(dir, 'a.json'), 'utf8'));
  assert.equal(sidecar.textHash, textHash({ text: 'One. Two.', voice: 'af_heart', speed: 1 }));
  assert.equal(sidecar.sentences.length, 2);
});

test('synthesizeDir: a narration whose text, voice and speed did not change is skipped, and with nothing to do the model never loads', async () => {
  const dir = folder({ 'a.txt': 'One.', 'b.txt': 'Two.' });
  const deps = { RawAudio: StubRawAudio };
  await synthesizeDir(parseVoiceArgs(['--dir', dir]), { load: session({ loads: 0, disposed: 0 }), deps });
  const again = { loads: 0, disposed: 0 };
  const results = await synthesizeDir(parseVoiceArgs(['--dir', dir]), { load: session(again), deps });
  assert.deepEqual(results.map((r) => r.skipped), [true, true]);
  assert.equal(again.loads, 0, 'nothing changed: no model load');
  assert.equal(again.disposed, 0);
  // one text edited: only that one is made again
  writeFileSync(path.join(dir, 'b.txt'), 'Two, changed.');
  const edited = { loads: 0, disposed: 0 };
  const third = await synthesizeDir(parseVoiceArgs(['--dir', dir]), { load: session(edited), deps });
  assert.deepEqual(third.map((r) => r.skipped === true), [true, false]);
  assert.equal(edited.loads, 1);
  // a different speed makes every one again
  const faster = await synthesizeDir(parseVoiceArgs(['--dir', dir, '--speed', '1.2']), { load: session({ loads: 0, disposed: 0 }), deps });
  assert.deepEqual(faster.map((r) => r.skipped === true), [false, false]);
});

test('synthesizeDir: a wav deleted by hand is made again even when the hash matches', async () => {
  const dir = folder({ 'a.txt': 'One.' });
  const deps = { RawAudio: StubRawAudio };
  await synthesizeDir(parseVoiceArgs(['--dir', dir]), { load: session({ loads: 0, disposed: 0 }), deps });
  writeFileSync(path.join(dir, 'a.wav'), 'x');
  assert.equal(dirJobs(parseVoiceArgs(['--dir', dir]))[0].fresh, true, 'the guardrail: a present wav with a matching sidecar counts as fresh');
  const { rmSync } = await import('node:fs');
  rmSync(path.join(dir, 'a.wav'));
  assert.equal(dirJobs(parseVoiceArgs(['--dir', dir]))[0].fresh, false);
});

test('synthesizeDir: an unknown --voice is a usage error after the load, and the session is still disposed', async () => {
  const dir = folder({ 'a.txt': 'One.' });
  const counter = { loads: 0, disposed: 0 };
  await assert.rejects(() => synthesizeDir(parseVoiceArgs(['--dir', dir, '--voice', 'nope']), { load: session(counter), deps: { RawAudio: StubRawAudio } }), /unknown voice "nope"; run --list-voices/);
  assert.equal(counter.disposed, 1);
  assert.equal(existsSync(path.join(dir, 'a.wav')), false);
});

test('downloadProgress: one stderr line each time a file passes into a new 10 % band, with sizes, and nothing for events without a total', () => {
  const lines = [];
  const report = downloadProgress((line) => lines.push(line));
  report({ status: 'initiate', file: 'model.onnx' });
  report({ status: 'progress', file: 'model.onnx', progress: 3, loaded: 3e6, total: 90e6 });
  report({ status: 'progress', file: 'model.onnx', progress: 12, loaded: 10.8e6, total: 90e6 });
  report({ status: 'progress', file: 'model.onnx', progress: 14, loaded: 12.6e6, total: 90e6 });
  report({ status: 'progress', file: 'model.onnx', progress: 100, loaded: 90e6, total: 90e6 });
  report({ status: 'progress', file: 'other.json', progress: 50 }); // no total
  report(undefined);
  assert.deepEqual(lines, ['downloading model.onnx: 3% (3 of 90 MB)\n', 'downloading model.onnx: 12% (11 of 90 MB)\n', 'downloading model.onnx: 100% (90 of 90 MB)\n']);
});

test('the Kokoro model is pinned to a commit, not "main"', () => {
  assert.match(KOKORO_REVISION, /^[0-9a-f]{40}$/);
});

// kokoro-js 1.2.1's KokoroTTS.from_pretrained destructures only dtype, device and progress_callback, so a `revision` passed to it
// is dropped and the pin does nothing. loadModel therefore builds the model and tokenizer itself with transformers.js, which does
// honour `revision`, and hands them to the KokoroTTS constructor. Stubs record what each loader was asked for.
test('loadModel: the model and the tokenizer are both fetched at KOKORO_REVISION, never through KokoroTTS.from_pretrained', async () => {
  const calls = [];
  const transformers = {
    env: {},
    StyleTextToSpeech2Model: { from_pretrained: async (id, opts) => { calls.push(['model', id, opts]); return { kind: 'model' }; } },
    AutoTokenizer: { from_pretrained: async (id, opts) => { calls.push(['tokenizer', id, opts]); return { kind: 'tokenizer' }; } },
  };
  class StubKokoroTTS {
    constructor(model, tokenizer) { this.model = model; this.tokenizer = tokenizer; }
    static from_pretrained() { throw new Error('from_pretrained drops revision; do not call it'); }
  }
  const progress = () => {};
  const tts = await loadModel({ KokoroTTS: StubKokoroTTS }, { onProgress: progress, transformers });
  assert.ok(tts instanceof StubKokoroTTS);
  assert.deepEqual([tts.model, tts.tokenizer], [{ kind: 'model' }, { kind: 'tokenizer' }]);
  assert.deepEqual(calls.map(([kind]) => kind).sort(), ['model', 'tokenizer']);
  for (const [, id, opts] of calls) {
    assert.equal(id, MODEL_ID);
    assert.equal(opts.revision, KOKORO_REVISION);
    assert.equal(opts.progress_callback, progress);
  }
  assert.deepEqual(calls.find(([kind]) => kind === 'model')[2].dtype, 'q8');
  assert.equal(transformers.env.cacheDir, MODEL_CACHE_DIR);
});

test('voice CLI: --dir with no .txt files exits 2 before anything is loaded', () => {
  const dir = folder({ 'x.md': 'a' });
  const r = spawnSync(process.execPath, [VOICE, '--dir', dir], { encoding: 'utf8' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /--dir: no \.txt files in /);
});
