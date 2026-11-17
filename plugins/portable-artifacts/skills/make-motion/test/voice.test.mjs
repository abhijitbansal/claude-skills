import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  parseVoiceArgs, chunkText, sentenceTimes, sidecarPath, synthesize, phonemeLines, DEFAULT_VOICE, MODEL_ID, MODEL_CACHE_DIR, MAX_CHUNK_CHARS,
  KOKORO_BASE_URL, KOKORO_FILES, KOKORO_DIR, ensureKokoroModel, loadModel,
} from '../scripts/lib/voice.mjs';
import { runVoiceCli } from '../scripts/lib/voice-cli.mjs';
import { voiceListText } from '../scripts/lib/voice-list.mjs';
import { modelsDir } from '../scripts/lib/model-cache.mjs';
import { writeFileSync } from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'scripts/voice.mjs');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('parseVoiceArgs: text plus --out, defaults for voice and speed', () => {
  assert.deepEqual(parseVoiceArgs(['Hello there', '--out', 'v.wav']), {
    text: 'Hello there', out: 'v.wav', voice: DEFAULT_VOICE, speed: 1, listVoices: false, phonemes: false,
  });
});

test('parseVoiceArgs: --phonemes sets the flag', () => {
  assert.equal(parseVoiceArgs(['Hi', '--out', 'v.wav', '--phonemes']).phonemes, true);
});

test('voice CLI: --phonemes with an unknown extra flag exits 2 and lists the accepted flags', () => {
  const r = run(['Hi', '--out', 'v.wav', '--phonemes', '--bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --bogus/);
  assert.match(r.stderr, /usage: .*\[--phonemes\]/);
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
  constructor() { this.text = ''; this.closed = false; }
  push(t) { this.text += t; }
  close() { this.closed = true; }
  [Symbol.iterator]() { return this.text.split(/(?<=[.!?])\s+/)[Symbol.iterator](); }
}
class StubRawAudio {
  constructor(audio, rate) { this.audio = audio; this.rate = rate; }
  async save(file) { writeFileSync(file, `wav:${this.audio.length}@${this.rate}`); }
}
// stream() takes the closed splitter and yields one { text, phonemes, audio } per sentence it finds,
// as kokoro-js does. `spec[chunk]` is a list of [phonemes, samples] results for that chunk.
// The real stream() waits forever on an open splitter, so the stub throws instead of hanging.
const stubTts = (spec) => ({
  stream: async function* (splitter) {
    if (!splitter.closed) throw new Error('stream() was given a splitter that is not closed: the real one would hang');
    for (const chunk of splitter) {
      for (const [phonemes, samples] of spec[chunk]) {
        yield { text: chunk, phonemes, audio: { audio: new Float32Array(samples) } };
      }
    }
  },
});

test('synthesize: returns seconds and sentences, writes the wav and the timing sidecar', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'intro.wav');
  const tts = stubTts({ 'Hello there.': [['həlˈoʊ ðˈɛɹ.', 24000]], 'Second one.': [['sˈɛkənd wˈʌn.', 12000]] });
  const result = await synthesize(
    tts, { TextSplitterStream: StubSplitterStream },
    { text: 'Hello there. Second one.', voice: 'af_heart', speed: 1, out },
    { RawAudio: StubRawAudio },
  );
  const sentences = [
    { text: 'Hello there.', start: 0, end: 1, phonemes: 'həlˈoʊ ðˈɛɹ.' },
    { text: 'Second one.', start: 1, end: 1.5, phonemes: 'sˈɛkənd wˈʌn.' },
  ];
  assert.deepEqual(result, { seconds: 1.5, sentences });
  assert.equal(readFileSync(out, 'utf8'), 'wav:36000@24000');
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'intro.json'), 'utf8')), {
    sampleRate: 24000, voice: 'af_heart', sentences,
  });
});

test('synthesize: sidecar sentences carry phonemes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'p.wav');
  await synthesize(
    stubTts({ 'Send your résumé.': [['sˈɛnd jʊɹ ɹˈɛzuːmˌeɪ.', 100]] }), { TextSplitterStream: StubSplitterStream },
    { text: 'Send your résumé.', voice: 'af_heart', speed: 1, out }, { RawAudio: StubRawAudio },
  );
  const [first] = JSON.parse(readFileSync(path.join(dir, 'p.json'), 'utf8')).sentences;
  assert.equal(first.phonemes, 'sˈɛnd jʊɹ ɹˈɛzuːmˌeɪ.');
});

test('synthesize: a chunk yielding two results joins audio and phonemes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'two.wav');
  const result = await synthesize(
    stubTts({ 'One part. Two part.': [['wˈʌn pˈɑɹt.', 24000], ['tˈuː pˈɑɹt.', 12000]] }), { TextSplitterStream: class extends StubSplitterStream {
      [Symbol.iterator]() { return [this.text][Symbol.iterator](); }
    } },
    { text: 'One part. Two part.', voice: 'af_heart', speed: 1, out }, { RawAudio: StubRawAudio },
  );
  assert.equal(readFileSync(out, 'utf8'), 'wav:36000@24000');
  assert.deepEqual(result.sentences, [{ text: 'One part. Two part.', start: 0, end: 1.5, phonemes: 'wˈʌn pˈɑɹt. tˈuː pˈɑɹt.' }]);
});

test('phonemeLines: one tab-separated line per sentence, whitespace inside a field collapsed', () => {
  assert.equal(
    phonemeLines([{ text: 'Hello\tthere.', phonemes: 'həlˈoʊ\nðˈɛɹ.' }, { text: 'Bye.', phonemes: 'bˈaɪ.' }]),
    'Hello there.\thəlˈoʊ ðˈɛɹ.\nBye.\tbˈaɪ.\n',
  );
  assert.equal(phonemeLines([]), '');
});

test('voice CLI: usage error exits 2 with the usage line', () => {
  const r = run([]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/voice\.mjs/);
});

const haveModel = () => existsSync(path.join(KOKORO_DIR, 'onnx/model_quantized.onnx')) && existsSync(path.join(root, 'optional/voice/node_modules/kokoro-js')) && process.env.VOICE_TEST === '1';

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

test('voice CLI: --phonemes prints one tab-separated line per sentence after the three contract lines (needs cached model + VOICE_TEST=1)', { skip: !haveModel() && 'model not cached or VOICE_TEST unset' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'p.wav');
  const r = run(['Send your résumé. I will resume later.', '--out', out, '--phonemes']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 5);
  assert.equal(lines[0], out);
  assert.match(lines[1], /^[\d.]+ s, af_heart$/);
  assert.equal(lines[2], path.join(dir, 'p.json'));
  assert.deepEqual(lines.slice(3).map((l) => l.split('\t')[0]), ['Send your résumé.', 'I will resume later.']);
  const quiet = run(['Hi there.', '--out', path.join(dir, 'q.wav')]);
  assert.equal(quiet.stdout.trimEnd().split('\n').length, 3, 'no phoneme lines without the flag');
});

test('the résumé spelling reads ɹˈɛzuːmˌeɪ (needs cached model + VOICE_TEST=1)', { skip: !haveModel() && 'model not cached or VOICE_TEST unset' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const out = path.join(dir, 'r.wav');
  const r = run(['Send your résumé. I will resume later.', '--out', out]);
  assert.equal(r.status, 0, r.stderr);
  const [sendIt, resumeIt] = JSON.parse(readFileSync(path.join(dir, 'r.json'), 'utf8')).sentences;
  assert.ok(sendIt.phonemes.includes('ɹˈɛzuːmˌeɪ'), sendIt.phonemes);
  assert.ok(!resumeIt.phonemes.includes('ɹˈɛzuːmˌeɪ'), `resume must read differently: ${resumeIt.phonemes}`);
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

// ---- the Kokoro model is pinned to one commit and checked file by file ----------------------------------------------------

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const FILES = [{ file: 'config.json', body: Buffer.from('{}') }, { file: 'onnx/model_quantized.onnx', body: Buffer.from('onnx') }];
const pinned = FILES.map(({ file, body }) => ({ file, sha256: sha256(body), bytes: body.length }));
const BASE = 'https://example.invalid/r/';
const tmpDir = () => mkdtempSync(path.join(tmpdir(), 'kokoro-pin-'));
// A fetch that records each URL and answers the file's body, or override[file].
const serve = (calls, override = {}) => async (url) => {
  calls.push(url);
  const file = url.slice(BASE.length);
  return new Response(override[file] ?? FILES.find((f) => f.file === file).body);
};

test('the Kokoro pin: a commit-pinned base URL and four files, each with a sha256 and a size', () => {
  assert.match(KOKORO_BASE_URL, /^https:\/\/huggingface\.co\/onnx-community\/Kokoro-82M-v1\.0-ONNX\/resolve\/[0-9a-f]{40}\/$/);
  assert.deepEqual(KOKORO_FILES.map((f) => f.file), ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx']);
  for (const { sha256: hash, bytes } of KOKORO_FILES) {
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(Number.isInteger(bytes) && bytes > 0);
  }
  assert.equal(Object.isFrozen(KOKORO_FILES), true);
  // Merge: the folder is main's stable per-user model cache (model-cache.mjs, cache-dir.test.mjs), not <skill>/.cache/models.
  assert.equal(MODEL_CACHE_DIR, modelsDir());
  assert.equal(KOKORO_DIR, path.join(MODEL_CACHE_DIR, MODEL_ID));
});

test('ensureKokoroModel reuses a cached file only when its hash matches', async () => {
  const dir = tmpDir();
  writeFileSync(path.join(dir, 'config.json'), '{}');
  const calls = [];
  const opts = (fetchImpl) => ({ dir, base: BASE, files: pinned, fetchImpl });
  assert.equal(await ensureKokoroModel(opts(serve(calls))), dir);
  assert.deepEqual(calls, [`${BASE}onnx/model_quantized.onnx`]);
  writeFileSync(path.join(dir, 'config.json'), '{"old":true}');
  await ensureKokoroModel(opts(serve(calls)));
  assert.equal(readFileSync(path.join(dir, 'config.json'), 'utf8'), '{}');
});

test('one bad file fails the load, names it, and keeps no copy of it', async () => {
  const dir = tmpDir();
  await assert.rejects(
    () => ensureKokoroModel({ dir, base: BASE, files: pinned, fetchImpl: serve([], { 'onnx/model_quantized.onnx': 'evil' }) }),
    /sha256 mismatch for the Kokoro voice model file onnx\/model_quantized\.onnx/,
  );
  assert.equal(existsSync(path.join(dir, 'onnx', 'model_quantized.onnx')), false);
});

test('offline first use names the URL and keeps nothing', async () => {
  const dir = tmpDir();
  await assert.rejects(
    () => ensureKokoroModel({ dir, base: BASE, files: pinned, fetchImpl: async () => { throw new TypeError('fetch failed'); } }),
    /Kokoro voice model file config\.json download failed: fetch failed \(https:\/\/example\.invalid\/r\/config\.json\)/,
  );
  assert.equal(existsSync(path.join(dir, 'config.json')), false);
});

// A kokoro stub whose from_pretrained records its arguments and the env it saw.
function stubKokoro(seen = {}) {
  const env = { allowRemoteModels: true, useFSCache: true };
  return { env, KokoroTTS: { from_pretrained: async (...args) => { seen.args = args; seen.env = { ...env }; return 'tts'; } } };
}

test('loadModel verifies the files, then points transformers at the verified folder with remote loading and its file cache off', async () => {
  const root = tmpDir();
  const calls = [];
  const seen = {};
  const stub = stubKokoro(seen);
  assert.equal(await loadModel(stub, { root, base: BASE, files: pinned, fetchImpl: serve(calls) }), 'tts');
  assert.deepEqual(calls, pinned.map((f) => `${BASE}${f.file}`), 'every pinned file was fetched and checked once');
  assert.deepEqual(stub.env, { allowRemoteModels: false, useFSCache: false, allowLocalModels: true, localModelPath: root });
  assert.deepEqual(seen.args, [MODEL_ID, { dtype: 'q8', device: 'cpu' }]);
  assert.equal(readFileSync(path.join(root, MODEL_ID, 'config.json'), 'utf8'), '{}');
});

test('loadModel cannot reach transformers with a file that fails its hash: it rejects first, and the model is never loaded', async () => {
  const root = tmpDir();
  const seen = {};
  const stub = stubKokoro(seen);
  await assert.rejects(
    () => loadModel(stub, { root, base: BASE, files: pinned, fetchImpl: serve([], { 'onnx/model_quantized.onnx': 'evil' }) }),
    /sha256 mismatch for the Kokoro voice model file onnx\/model_quantized\.onnx/,
  );
  assert.equal(seen.args, undefined, 'from_pretrained was never called');
  assert.equal(stub.env.allowRemoteModels, true, 'env was left alone');
});

test('loadModel verifies the same folder it loads from: a caller-supplied dir cannot split the two', async () => {
  const root = tmpDir();
  const elsewhere = tmpDir();
  const stub = stubKokoro();
  await loadModel(stub, { root, dir: elsewhere, base: BASE, files: pinned, fetchImpl: serve([]) });
  assert.equal(stub.env.localModelPath, root);
  assert.equal(readFileSync(path.join(root, MODEL_ID, 'config.json'), 'utf8'), '{}', 'the files were verified where transformers will read them');
  assert.equal(existsSync(path.join(elsewhere, 'config.json')), false, 'and not in the folder the caller named');
});

test('loadModel fetches nothing when every file is cached and good', async () => {
  const root = tmpDir();
  const dir = path.join(root, MODEL_ID);
  for (const { file, body } of FILES) { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), body); }
  const calls = [];
  await loadModel(stubKokoro(), { root, base: BASE, files: pinned, fetchImpl: serve(calls) });
  assert.deepEqual(calls, []);
});

// ---- the CLI body: --list-voices never needs the model ---------------------------------------------------------------------

const VOICES = { af_heart: { language: 'en-us', gender: 'Female', overallGrade: 'A' }, bm_george: { language: 'en-gb', gender: 'Male', overallGrade: 'C' } };
class StubTts { get voices() { return VOICES; } }

test('--list-voices prints the voices without loading or downloading the model', async () => {
  // Merge: main made the list a static table (voice-list.mjs), so the voice stack does not load either.
  const out = [];
  const deps = {
    loadKokoro: async () => { throw new Error('the voice stack must not load for --list-voices'); },
    loadModel: async () => { throw new Error('the model must not load for --list-voices'); },
    write: (s) => out.push(s),
  };
  await runVoiceCli(['--list-voices'], deps);
  assert.deepEqual(out, [voiceListText()]);
  assert.match(out[0], /^af_heart\t/m);
});

test('a synthesis run loads the model once, with the log line going to the caller, then disposes it', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-cli-'));
  const out = path.join(dir, 'a.wav');
  const loaded = [];
  let disposed = 0;
  const tts = { voices: VOICES, model: { dispose: async () => { disposed++; } }, stream: async function* () { yield { text: 'Hi.', phonemes: 'h', audio: { audio: new Float32Array(24000) } }; } };
  const deps = {
    loadKokoro: async () => ({ KokoroTTS: StubTts, TextSplitterStream: StubSplitterStream, RawAudio: StubRawAudio }),
    loadModel: async (kokoro, opts) => { loaded.push(opts); return tts; },
    write: () => {},
  };
  await runVoiceCli(['Hi.', '--out', out], deps);
  assert.equal(loaded.length, 1);
  assert.equal(typeof loaded[0].log, 'function');
  assert.equal(disposed, 1);
});

test('synthesises with fetch disabled once the pinned files are cached (needs optional/voice + VOICE_TEST=1)', { skip: !haveModel() && 'model, optional/voice or VOICE_TEST missing' }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'voice-'));
  const noFetch = path.join(dir, 'no-fetch.mjs');
  writeFileSync(noFetch, "globalThis.fetch = () => { throw new Error('network used'); };\n");
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(noFetch).href, CLI, 'Hello.', '--out', path.join(dir, 'nf.wav')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stderr, /network used/);
});
