import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseVoiceArgs, chunkText, sentenceTimes, sidecarPath, synthesize, DEFAULT_VOICE, MODEL_CACHE_DIR, MAX_CHUNK_CHARS,
} from '../scripts/lib/voice.mjs';
import { writeFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'scripts/voice.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('parseVoiceArgs: text plus --out, defaults for voice and speed', () => {
  assert.deepEqual(parseVoiceArgs(['Hello there', '--out', 'v.wav']), {
    text: 'Hello there', out: 'v.wav', voice: DEFAULT_VOICE, speed: 1, listVoices: false,
  });
});

test('parseVoiceArgs: --voice and --speed are honoured', () => {
  const o = parseVoiceArgs(['Hi', '--out', 'v.wav', '--voice', 'bf_emma', '--speed', '0.9']);
  assert.equal(o.voice, 'bf_emma');
  assert.equal(o.speed, 0.9);
});

test('parseVoiceArgs: --list-voices needs no text', () => {
  assert.equal(parseVoiceArgs(['--list-voices']).listVoices, true);
});

test('parseVoiceArgs: usage errors', () => {
  assert.throws(() => parseVoiceArgs([]), /usage/);
  assert.throws(() => parseVoiceArgs(['Hi']), /--out/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.wav', '--speed', 'fast']), /--speed/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.wav', '--speed', '3']), /--speed/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.txt']), /\.wav/);
  assert.throws(() => parseVoiceArgs(['Hi', '--out', 'v.wav', '--bogus']), /unknown option --bogus/);
  assert.throws(() => parseVoiceArgs(['Hi', 'there', '--out', 'v.wav']), /one text/);
  assert.throws(() => parseVoiceArgs(['', '--out', 'v.wav']), /text is empty/);
  assert.throws(() => parseVoiceArgs(['   ', '--out', 'v.wav']), /text is empty/);
});

test('parseVoiceArgs: --text-file reads the narration from a file so the shell never expands it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const file = path.join(dir, 'intro.txt');
  writeFileSync(file, 'Revenue hit $4.2M, up 18%.\n');
  const o = parseVoiceArgs(['--text-file', file, '--out', 'v.wav']);
  assert.equal(o.text, 'Revenue hit $4.2M, up 18%.');
  assert.throws(() => parseVoiceArgs(['Hi', '--text-file', file, '--out', 'v.wav']), /either/);
  assert.throws(() => parseVoiceArgs(['--text-file', path.join(dir, 'nope.txt'), '--out', 'v.wav']), /cannot read/);
});

test('chunkText splits on sentences and caps every chunk below the Kokoro token limit without losing words', () => {
  const words = Array.from({ length: 160 }, (_, i) => `word${i}`);
  const longSentence = words.join(' ');
  const chunks = chunkText(longSentence);
  assert.ok(chunks.length > 1, 'one giant sentence must be split');
  for (const c of chunks) assert.ok(c.length <= MAX_CHUNK_CHARS, `chunk too long: ${c.length}`);
  assert.deepEqual(chunks.join(' ').split(/\s+/), words);
  assert.deepEqual(chunkText('One. two. Three!'), ['One.', 'two.', 'Three!']);
  const clauses = Array.from({ length: 12 }, (_, i) => `clause number ${i} with a few more words in it`).join(', ');
  assert.ok(chunkText(clauses).every((c) => c.length <= MAX_CHUNK_CHARS));
});

test('sentenceTimes: cumulative start and end seconds per chunk', () => {
  assert.deepEqual(
    sentenceTimes([{ text: 'A.', samples: 24000 }, { text: 'B.', samples: 12000 }], 24000),
    [{ text: 'A.', start: 0, end: 1 }, { text: 'B.', start: 1, end: 1.5 }],
  );
});

test('sentenceTimes: rounds to 3 decimals from cumulative samples so rounding never drifts', () => {
  const third = Array.from({ length: 3 }, (_, i) => ({ text: `S${i}.`, samples: 8000 }));
  const times = sentenceTimes(third, 24000);
  assert.deepEqual(times.map((t) => t.start), [0, 0.333, 0.667]);
  assert.deepEqual(times.map((t) => t.end), [0.333, 0.667, 1]);
  assert.deepEqual(sentenceTimes([], 24000), []);
});

test('sidecarPath: swaps the .wav extension for .json', () => {
  assert.equal(sidecarPath('voice/intro.wav'), 'voice/intro.json');
  assert.equal(sidecarPath('voice/INTRO.WAV'), 'voice/INTRO.json');
  assert.equal(sidecarPath('/a.b/intro.wav'), '/a.b/intro.json');
});

// Stubs that stand in for kokoro-js and @huggingface/transformers so no model is needed.
class StubSplitterStream {
  constructor() { this.text = ''; }
  push(t) { this.text += t; }
  close() {}
  [Symbol.iterator]() { return this.text.split(/(?<=[.!?])\s+/)[Symbol.iterator](); }
}
class StubRawAudio {
  constructor(audio, rate) { this.audio = audio; this.rate = rate; }
  async save(file) { writeFileSync(file, `wav:${this.audio.length}@${this.rate}`); }
}
const stubTts = (samplesPerChunk) => ({
  generate: async (chunk) => ({ audio: new Float32Array(samplesPerChunk[chunk]) }),
});

test('synthesize: returns seconds and sentences, writes the wav and the timing sidecar', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'intro.wav');
  const tts = stubTts({ 'Hello there.': 24000, 'Second one.': 12000 });
  const result = await synthesize(
    tts, { TextSplitterStream: StubSplitterStream },
    { text: 'Hello there. Second one.', voice: 'af_heart', speed: 1, out },
    { RawAudio: StubRawAudio },
  );
  const sentences = [{ text: 'Hello there.', start: 0, end: 1 }, { text: 'Second one.', start: 1, end: 1.5 }];
  assert.deepEqual(result, { seconds: 1.5, sentences });
  assert.equal(readFileSync(out, 'utf8'), 'wav:36000@24000');
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'intro.json'), 'utf8')), {
    sampleRate: 24000, voice: 'af_heart', sentences,
  });
});

test('voice CLI: usage error exits 2 with the usage line', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/voice\.mjs/);
});

const haveModel = () => existsSync(MODEL_CACHE_DIR) && process.env.VOICE_TEST === '1';

test('voice CLI: synthesises a short phrase to a 24 kHz wav (needs cached model + VOICE_TEST=1)', { skip: !haveModel() && 'model not cached or VOICE_TEST unset' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'hello.wav');
  const r = run(['Hello from Kokoro.', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /hello\.wav\n[\d.]+ s/);
  const buf = readFileSync(out);
  assert.equal(buf.subarray(0, 4).toString(), 'RIFF');
  assert.equal(buf.readUInt32LE(24), 24000, 'sample rate');
  assert.ok(buf.length > 24000, 'more than half a second of audio');
});

test('voice CLI: an unknown or prototype voice name exits 2 cleanly after the model loads (needs cached model + VOICE_TEST=1)', { skip: !haveModel() && 'model not cached or VOICE_TEST unset' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  for (const name of ['nope', 'constructor']) {
    const r = run(['Hi.', '--out', path.join(dir, 'x.wav'), '--voice', name]);
    assert.equal(r.status, 2, `${name}: status ${r.status} signal ${r.signal}\n${r.stderr}`);
    assert.equal(r.signal, null);
    assert.match(r.stderr, /unknown voice/);
  }
});

test('voice CLI: an output path under a regular file exits 1 cleanly (needs cached model + VOICE_TEST=1)', { skip: !haveModel() && 'model not cached or VOICE_TEST unset' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  writeFileSync(path.join(dir, 'blocker'), 'x');
  const r = run(['Hi.', '--out', path.join(dir, 'blocker', 'x.wav')]);
  assert.equal(r.status, 1, `status ${r.status} signal ${r.signal}\n${r.stderr}`);
  assert.equal(r.signal, null);
});
