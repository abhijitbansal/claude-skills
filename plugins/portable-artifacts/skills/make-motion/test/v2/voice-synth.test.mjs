// Narration synthesis: the model call (kokoro.mjs), the worker's shot assembly (worker.mjs) and the cache
// (synth.mjs), all through fakes, without the optional voice install or the model. No test downloads. The worker as a
// child process and the real-model integration tests are in voice-worker.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { parseSay } from '../../engine/script/say.mjs';
import { ACCEPTED_VOICES, STYLE_DIM, editCall, openKokoro, planShotCalls, prepareCall } from '../../scripts/v2/voice/kokoro.mjs';
import {
  ERROR_MARKER, FADE_SAMPLES, INSTALL_HINT, LEAD_KEEP_MS, SILENCE_QUANTUM_SAMPLES, TRIM, encodeWav, sidecarShot,
  synthesiseShot, trimPads,
} from '../../scripts/v2/voice/worker.mjs';
import {
  CODE_FILES, HASH_CONSTANTS, MODEL_PIN, WORKER_PATH, sourceHash, synthesiseFilm, voiceHash,
} from '../../scripts/v2/voice/synth.mjs';
import { readSidecar, sentencesOf, writeSidecar } from '../../scripts/v2/voice/sidecar.mjs';
import { EMBEDDED_VOCAB } from '../../scripts/v2/voice/tokens.mjs';
import { LEAD, SAMPLE_RATE } from '../../scripts/v2/voice/words.mjs';
import { MAX_IDS, planCalls } from '../../scripts/v2/voice/calls.mjs';
import { VOICE_MODEL } from '../../scripts/v2/voice/model.mjs';

const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'voice-synth-'));
const withScratch = async (fn) => {
  const dir = scratch();
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const FILM = Object.freeze({
  version: 2,
  mode: 'pro',
  look: 'desk',
  shots: [
    { id: 'open', say: 'Every frame *counts*. Then it moves.' },
    { id: 'hold', hold: 1.5 },
    { id: 'close', say: 'Done, _quietly_.' },
  ],
});
const withShot = (film, index, changes) => ({ ...film, shots: film.shots.map((s, i) => (i === index ? { ...s, ...changes } : s)) });
const LOCK = 'a'.repeat(64);
const hashOf = (film, overrides = {}) => voiceHash(film, { voice: 'af_heart', runtimeLock: LOCK, ...overrides });
const withConstant = (changes) => ({ constants: { ...HASH_CONSTANTS, ...changes } });

// ---------- voiceHash ----------

test('voiceHash is 64 hex characters and the same for the same input', () => {
  assert.match(hashOf(FILM), /^[0-9a-f]{64}$/);
  assert.equal(hashOf(FILM), hashOf(structuredClone(FILM)));
});

test('voiceHash changes with a say, a shot id, the voice, the mode, a lead constant, a trim setting or a speed limit', () => {
  const base = hashOf(FILM);
  assert.notEqual(hashOf(withShot(FILM, 0, { say: 'Every frame *counts*. Then it stops.' })), base);
  assert.notEqual(hashOf(withShot(FILM, 2, { id: 'end' })), base);
  assert.notEqual(hashOf(FILM, { voice: 'af_bella' }), base);
  assert.notEqual(hashOf({ ...FILM, mode: 'viral' }), base);
  assert.notEqual(hashOf(FILM, withConstant({ lead: { ...LEAD, midPhraseMs: LEAD.midPhraseMs + 1 } })), base);
  assert.notEqual(hashOf(FILM, withConstant({ trim: { ...TRIM, leadKeepSamples: TRIM.leadKeepSamples + 24 } })), base);
  assert.notEqual(hashOf(FILM, withConstant({ voiceSpeedMax: HASH_CONSTANTS.voiceSpeedMax + 0.05 })), base);
  assert.notEqual(hashOf(FILM, withConstant({ voiceSpeedMin: HASH_CONSTANTS.voiceSpeedMin - 0.05 })), base);
});

test('voiceHash changes with the runtime lockfile, any pinned model file (the voice file too) and the code', () => {
  const base = hashOf(FILM);
  assert.notEqual(hashOf(FILM, { runtimeLock: 'b'.repeat(64) }), base);
  const files = MODEL_PIN.files.map((f) => (f.path === 'voices/af_heart.bin' ? { ...f, sha256: '0'.repeat(64) } : f));
  assert.notEqual(hashOf(FILM, { model: { ...MODEL_PIN, files } }), base);
  assert.notEqual(hashOf(FILM, { code: 'c'.repeat(64) }), base);
  assert.deepEqual(MODEL_PIN.files.map((f) => f.path), VOICE_MODEL.files.map((f) => f.path), 'every pinned file is in the key');
});

test('sourceHash changes when one byte of one source changes, and the code key covers the worker\'s modules and say.mjs', async () => {
  await withScratch(async (dir) => {
    const a = path.join(dir, 'a.mjs');
    const b = path.join(dir, 'b.mjs');
    writeFileSync(a, 'export const x = 1;\n');
    writeFileSync(b, 'export const y = 2;\n');
    const before = sourceHash([a, b]);
    assert.equal(sourceHash([a, b]), before);
    writeFileSync(b, 'export const y = 3;\n');
    assert.notEqual(sourceHash([a, b]), before);
  });
  const names = CODE_FILES.map((f) => path.basename(f)).sort();
  assert.deepEqual(names, ['calls.mjs', 'kokoro.mjs', 'phonemes.mjs', 'say.mjs', 'sidecar.mjs', 'tokens.mjs', 'words.mjs', 'worker.mjs']);
  assert.ok(CODE_FILES.every((f) => existsSync(f)), 'every hashed source exists');
});

test('voiceHash does not change when an unrelated field changes (look, hold, a shot field other than id and say)', () => {
  const base = hashOf(FILM);
  assert.equal(hashOf({ ...FILM, look: 'pop' }), base);
  assert.equal(hashOf(withShot(FILM, 1, { hold: 3 })), base);
  assert.equal(hashOf(withShot(FILM, 0, { kicker: 'New kicker', look: 'pop' })), base);
});

// ---------- synthesiseFilm with a fake spawn ----------

// A child_process.spawn stand-in: an emitter with stdout and stderr streams. `finish` ends both streams, then emits
// 'close' with the exit code and signal, as a real child does.
function fakeChild() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kills: [] });
  child.kill = (signal) => child.kills.push(signal);
  child.finish = (code, signal = null) => {
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', code, signal));
  };
  return child;
}

// What the worker writes on success: a WAV per narrated shot and the sidecar, into the job's folder.
function writeWorkerOutput(job) {
  const shots = job.shots.map((shot, index) => {
    if (shot.say === null) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
    const { tokens } = parseSay(shot.say);
    const words = tokens.map((t, k) => ({ text: t.text, start: k * 0.5, end: k * 0.5 + 0.4, emphasis: t.emphasis, aside: t.aside }));
    writeFileSync(path.join(job.dir, `shot-${index}.wav`), encodeWav(new Float32Array(tokens.length * 12000), SAMPLE_RATE));
    return { id: shot.id, wav: `shot-${index}.wav`, seconds: tokens.length * 0.5, sentences: sentencesOf(tokens, words) };
  });
  writeSidecar(path.join(job.dir, 'voice.json'), { version: 1, model: { id: 'm', commit: 'c', file: 'f', sha256: 's' }, voice: job.voice, sampleRate: 24000, shots });
}

// A spawn that behaves like the worker: one progress line, then (after `beforeExit`) either the output files and exit
// 0, or `stderr` and `exitCode`.
function fakeSpawn({ exitCode = 0, stderr = '', signal = null, beforeExit = async () => {} } = {}) {
  const calls = [];
  const spawn = (file, args, options) => {
    const child = fakeChild();
    const job = JSON.parse(readFileSync(args[1], 'utf8'));
    calls.push({ file, args, options, job, child });
    setImmediate(async () => {
      child.stdout.write('voice: progress\n');
      await beforeExit(child);
      if (exitCode === 0 && signal === null) writeWorkerOutput(job);
      child.stderr.write(stderr);
      child.finish(exitCode, signal);
    });
    return child;
  };
  return { spawn, calls };
}

const noModel = async () => {};
const opts = (outDir, more = {}) => ({ outDir, voice: 'af_heart', ensureModel: noModel, ...more });
const voiceFolder = (outDir) => readdirSync(path.join(outDir, '.voice'));
const marker = (error) => `${ERROR_MARKER}${JSON.stringify(error)}\n`;

test('a cache miss spawns node worker.mjs <job.json> once with no shell; a second call is a cache hit with zero spawns', async () => {
  await withScratch(async (outDir) => {
    const hostile = withShot(FILM, 0, { say: 'Every $(touch pwned) frame; `id` | cat. Then it moves.' });
    const fake = fakeSpawn();
    const first = await synthesiseFilm(hostile, opts(outDir, { spawn: fake.spawn }));
    assert.equal(fake.calls.length, 1);
    const [{ file, args, options }] = fake.calls;
    assert.equal(file, process.execPath);
    assert.deepEqual([args.length, args[0]], [2, WORKER_PATH]);
    assert.ok(args.every((a) => !a.includes('$(') && !a.includes('`') && !a.includes('|')), 'film text never reaches argv');
    assert.notEqual(options?.shell, true);
    assert.equal(first.cached, false);
    assert.equal(path.dirname(first.dir), path.join(outDir, '.voice'));
    assert.equal(first.sidecar.shots.length, 3);
    assert.deepEqual(voiceFolder(outDir), [path.basename(first.dir)], 'the job file and the staging folder are gone');
    assert.deepEqual(readdirSync(first.dir).sort(), ['shot-0.wav', 'shot-2.wav', 'voice.json']);

    const second = await synthesiseFilm(hostile, opts(outDir, { spawn: fake.spawn }));
    assert.equal(fake.calls.length, 1, 'a cache hit spawns nothing');
    assert.equal(second.cached, true);
    assert.deepEqual(second.sidecar, first.sidecar);
  });
});

test('the job carries the shots, the pace, the voice and the two locations, in a staging folder of its own', async () => {
  await withScratch(async (outDir) => {
    const runtime = path.join(outDir, 'rt', 'voice');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(path.join(runtime, 'package-lock.json'), '{}');
    const fake = fakeSpawn();
    const { dir } = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, runtime, modelDir: '/x/model' }));
    const { job, args } = fake.calls[0];
    assert.deepEqual(job.shots, [
      { id: 'open', say: 'Every frame *counts*. Then it moves.' }, { id: 'hold', say: null }, { id: 'close', say: 'Done, _quietly_.' },
    ]);
    assert.deepEqual([job.speed, job.emphasisPause, job.voice, job.runtime, job.modelDir], [1, 0, 'af_heart', runtime, '/x/model']);
    assert.equal(job.offline, undefined, 'the worker is always offline: the parent fetched the model');
    assert.notEqual(job.dir, dir, 'the worker writes into a staging folder, renamed into place on success');
    assert.equal(path.dirname(args[1]), job.dir);
    assert.match(path.basename(job.dir), /\.partial-\d+-[0-9a-f-]{36}$/);
  });
});

test('the model is ensured in the parent before the worker starts, refusing downloads when offline', async () => {
  await withScratch(async (outDir) => {
    const order = [];
    let fetchRefusal = null;
    const ensureModel = async ({ dir, fetchImpl }) => {
      order.push(`ensure ${dir}`);
      fetchRefusal = fetchImpl ? await fetchImpl('https://example.invalid/x').catch((e) => e.message) : 'none';
    };
    const fake = fakeSpawn();
    const spawn = (...a) => { order.push('spawn'); return fake.spawn(...a); };
    await synthesiseFilm(FILM, opts(outDir, { spawn, ensureModel, modelDir: '/m', offline: true }));
    assert.deepEqual(order, ['ensure /m', 'spawn']);
    assert.match(fetchRefusal, /offline/);
  });
});

test('a model that cannot be ensured is machine trouble with a hint, and no worker starts', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    const ensureModel = async () => { throw new Error('voice model file config.json failed its pinned hash'); };
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, ensureModel })), (err) => {
      assert.deepEqual([err.name, err.kind], ['VoiceSynthError', 'machine']);
      assert.match(err.message, /config\.json failed its pinned hash/);
      assert.ok(err.hint.length > 0);
      return true;
    });
    assert.equal(fake.calls.length, 0);
  });
});

test('a real offline run with no model files refuses the download, writes no model file and is machine trouble', async () => {
  await withScratch(async (outDir) => {
    const modelDir = path.join(outDir, 'no-model');
    await assert.rejects(synthesiseFilm(FILM, { outDir, voice: 'af_heart', modelDir, offline: true, spawn: fakeSpawn().spawn }), (err) => {
      assert.equal(err.kind, 'machine');
      assert.match(err.message, /config\.json.*offline/);
      return true;
    });
    assert.equal(existsSync(path.join(modelDir, 'config.json')), false);
  });
});

test('a film error from the worker rejects with kind film, its message, hint and shot, exit code 1, and leaves no entry', async () => {
  await withScratch(async (outDir) => {
    const error = { kind: 'film', message: 'shot "open": a stretch of narration is 600 model ids', hint: 'add a comma', shot: 'open' };
    const fake = fakeSpawn({ exitCode: 1, stderr: `loading\n${marker(error)}` });
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn })), (err) => {
      assert.deepEqual([err.kind, err.message, err.hint, err.shot, err.exitCode], ['film', error.message, 'add a comma', 'open', 1]);
      return true;
    });
    assert.deepEqual(voiceFolder(outDir), [], 'no cache entry, no staging folder, no job file');
  });
});

test('machine trouble from the worker carries no shot, even if its line names one', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn({ exitCode: 2, stderr: marker({ kind: 'machine', message: 'disk full', hint: 'free space', shot: 'open' }) });
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn })), (err) => {
      assert.deepEqual([err.kind, err.shot, err.exitCode], ['machine', undefined, 2]);
      return true;
    });
  });
});

test('a worker that dies without a classified error (a crash or a signal) is machine trouble naming the signal', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn({ exitCode: null, signal: 'SIGABRT', stderr: 'libc++abi: terminating\n' });
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn })), (err) => {
      assert.deepEqual([err.kind, err.signal, err.exitCode], ['machine', 'SIGABRT', null]);
      assert.match(err.message, /SIGABRT.*libc\+\+abi: terminating/);
      assert.ok(err.hint.length > 0);
      return true;
    });
    assert.deepEqual(voiceFolder(outDir), []);
  });
});

test('a worker that never exits is killed after the timeout: machine trouble, and its staging folder is removed', async () => {
  await withScratch(async (outDir) => {
    let child = null;
    const spawn = () => { child = fakeChild(); return child; };
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn, timeoutSeconds: 0.05 })), (err) => {
      assert.match(err.message, /voice worker did not finish within 0\.05 s and was killed/);
      assert.deepEqual([err.kind, err.timedOut, err.exitCode], ['machine', true, null]);
      assert.match(err.hint, /timeoutSeconds/);
      return true;
    });
    assert.deepEqual(child.kills, ['SIGKILL']);
    assert.deepEqual(voiceFolder(outDir), []);
    child.finish(null, 'SIGKILL');
  });
});

test('the worker\'s progress lines reach log while it runs, not after it exits', async () => {
  await withScratch(async (outDir) => {
    let heard;
    const heardProgress = new Promise((resolve) => { heard = resolve; });
    const lines = [];
    const log = (line) => { lines.push(line); if (line === 'voice: progress') heard(); };
    const fake = fakeSpawn({ beforeExit: () => heardProgress });
    await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, log }));
    assert.ok(lines.includes('voice: progress'), 'the line was logged before the fake worker was allowed to exit');
  });
});

test('a corrupt or incomplete cache entry is a miss: one log line, the entry removed, synthesised again', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    const lines = [];
    const run = () => synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, log: (l) => lines.push(l) }));
    const { dir } = await run();
    writeFileSync(path.join(dir, 'voice.json'), '{ "version": 1, "sha');
    const again = await run();
    assert.deepEqual([again.cached, fake.calls.length], [false, 2]);
    assert.equal(lines.filter((l) => l.includes('incomplete') && l.includes(dir)).length, 1);
    rmSync(path.join(dir, 'shot-2.wav'));
    const third = await run();
    assert.deepEqual([third.cached, fake.calls.length], [false, 3]);
    writeFileSync(path.join(dir, 'shot-0.wav'), encodeWav(new Float32Array(10), SAMPLE_RATE));
    const fourth = await run();
    assert.deepEqual([fourth.cached, fake.calls.length], [false, 4], 'a WAV of the wrong length is incomplete too');
  });
});

test('a runtime folder without a lockfile is machine trouble with the install hint, and nothing starts', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, runtime: path.join(outDir, 'none') })), (err) => {
      assert.deepEqual([err.kind, err.hint], ['machine', INSTALL_HINT]);
      return true;
    });
    assert.equal(fake.calls.length, 0);
  });
});

test('synthesiseFilm refuses a timeout that is not a positive number of seconds, and a voice other than af_heart', async () => {
  const fake = fakeSpawn();
  await assert.rejects(synthesiseFilm(FILM, opts(os.tmpdir(), { spawn: fake.spawn, timeoutSeconds: 0 })), /timeoutSeconds/);
  await assert.rejects(
    synthesiseFilm(FILM, opts(os.tmpdir(), { spawn: fake.spawn, voice: 'af_bella' })),
    (err) => err.message.includes('af_bella') && err.message.includes('af_heart'),
  );
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(ACCEPTED_VOICES, ['af_heart']);
});

// ---------- openKokoro with a fake onnxruntime ----------

const VOICE_ROWS = 510;

function fakeOrt() {
  const runs = [];
  class Tensor {
    constructor(type, data, dims) {
      Object.assign(this, { type, data, dims });
    }
  }
  const session = {
    released: false,
    async run(feeds) {
      runs.push(feeds);
      const t = feeds.input_ids.dims[1];
      return {
        waveform: { data: new Float32Array(600 * (t + 10)) },
        durations: { data: Float32Array.from({ length: t }, (_, k) => (k === 0 ? 11 : 1)) },
      };
    },
    async release() {
      this.released = true;
    },
  };
  const created = [];
  const InferenceSession = { create: async (file, options) => { created.push({ file, options }); return session; } };
  return { ort: { Tensor, InferenceSession }, runs, created, session };
}

// A voice file whose row r is filled with the value r, so the chosen style row is visible.
function writeFakeModel(dir) {
  mkdirSync(path.join(dir, 'voices'), { recursive: true });
  const rows = new Float32Array(VOICE_ROWS * STYLE_DIM);
  for (let r = 0; r < VOICE_ROWS; r++) rows.fill(r, r * STYLE_DIM, (r + 1) * STYLE_DIM);
  writeFileSync(path.join(dir, 'voices', 'af_heart.bin'), Buffer.from(rows.buffer));
}

test('openKokoro opens the quantized model on the CPU and speak feeds int64 ids, the style row of the call length and the speed', async () => {
  await withScratch(async (modelDir) => {
    writeFakeModel(modelDir);
    const fake = fakeOrt();
    const kokoro = await openKokoro({ ort: fake.ort, modelDir, voice: 'af_heart' });
    assert.equal(fake.created[0].file, path.join(modelDir, 'onnx', 'model_quantized.onnx'));
    const ids = [0, 50, 156, 72, 0];
    const out = await kokoro.speak({ ids, speed: 1.1 });
    const feeds = fake.runs[0];
    assert.equal(feeds.input_ids.type, 'int64');
    assert.deepEqual(feeds.input_ids.dims, [1, 5]);
    assert.deepEqual(Array.from(feeds.input_ids.data), ids.map(BigInt));
    assert.equal(feeds.style.type, 'float32');
    assert.deepEqual(feeds.style.dims, [1, STYLE_DIM]);
    assert.ok(feeds.style.data.every((v) => v === 3), 'row clamp(T - 2, 0, 509) = 3');
    assert.equal(feeds.speed.type, 'float32');
    assert.deepEqual(feeds.speed.dims, [1]);
    assert.equal(Math.fround(1.1), feeds.speed.data[0]);
    assert.ok(out.waveform instanceof Float32Array);
    assert.ok(out.durations instanceof Float32Array);
    await kokoro.close();
    assert.equal(fake.session.released, true);
  });
});

test('speak clamps the style row to 509 for the longest call and refuses more than MAX_IDS ids', async () => {
  await withScratch(async (modelDir) => {
    writeFakeModel(modelDir);
    const fake = fakeOrt();
    const kokoro = await openKokoro({ ort: fake.ort, modelDir, voice: 'af_heart' });
    await kokoro.speak({ ids: new Array(MAX_IDS).fill(16), speed: 1 });
    assert.ok(fake.runs[0].style.data.every((v) => v === 509));
    await assert.rejects(kokoro.speak({ ids: new Array(MAX_IDS + 1).fill(16), speed: 1 }), /513 ids.*512/);
    await assert.rejects(kokoro.speak({ ids: [0, 50, 0], speed: 0 }), /speed/);
  });
});

test('openKokoro refuses a voice other than af_heart and a voice file of the wrong size', async () => {
  await withScratch(async (modelDir) => {
    const fake = fakeOrt();
    await assert.rejects(openKokoro({ ort: fake.ort, modelDir, voice: 'af_bella' }), /af_bella.*af_heart/);
    mkdirSync(path.join(modelDir, 'voices'), { recursive: true });
    writeFileSync(path.join(modelDir, 'voices', 'af_heart.bin'), Buffer.alloc(1000));
    await assert.rejects(openKokoro({ ort: fake.ort, modelDir, voice: 'af_heart' }), /af_heart\.bin.*1000 bytes/);
  });
});

// ---------- model input: phonemes, emphasis, ids ----------

// A stand-in phonemizer: each word's letters, lower case, with g (not in the vocab) spelt k.
const fakePhonemize = async (text) => [text.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase().replace(/[^a-z]/g, '').replace(/g/g, 'k')).join(' ')];
const PRIMARY_ID = EMBEDDED_VOCAB.get('ˈ');

test('prepareCall promotes stress on an emphasised word only, and its spans cover the edited phonemes', async () => {
  const { tokens } = parseSay('it *is* done.');
  const call = await prepareCall(tokens, [0, 1, 2], { phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB });
  assert.equal(call.kept, 'it ˈis done.');
  assert.deepEqual(call.ids, [0, ...[...'it ˈis done.'].map((c) => EMBEDDED_VOCAB.get(c)), 0]);
  assert.equal(call.ids.filter((id) => id === PRIMARY_ID).length, 1);
  assert.deepEqual(call.spans, [{ first: 1, last: 2 }, { first: 4, last: 6 }, { first: 8, last: 11 }]);
  assert.deepEqual(call.dropped, []);
});

test('prepareCall puts an IPA hint in place of the word\'s phonemes', async () => {
  const { tokens } = parseSay('a [GIF](/dʒˈɪf/) loop.');
  const call = await prepareCall(tokens, [0, 1, 2], { phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB });
  assert.equal(call.kept, 'a dʒˈɪf loop.');
  assert.deepEqual(call.spans[1], { first: 3, last: 7 });
});

test('prepareCall takes an IPA hint through hintPhonemes: a refused character is an error, never silently dropped', async () => {
  const { tokens } = parseSay('a [GIF](/xˈɪf/) loop.');
  await assert.rejects(
    prepareCall(tokens, [0, 1, 2], { phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB }),
    (err) => err.name === 'VoiceTextError' && err.message.includes('U+0078'),
  );
});

test('prepareCall speaks an IPA hint in NFC, as the validator checks it: c + U+0327 is spoken as ç', async () => {
  const { tokens } = parseSay('a [ca](/ça/) b.');
  const call = await prepareCall(tokens, [0, 1, 2], { phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB });
  assert.equal(call.kept, 'a ça b.');
  assert.deepEqual(call.ids, [0, ...[...'a ça b.'].map((c) => EMBEDDED_VOCAB.get(c)), 0]);
});

test('editCall edits a merged run once: one shared span, stress promoted when any token of the run is emphasised', () => {
  // "$5 million" is spoken "5 million dollars": both say tokens share the union span with merged: true.
  const chars = [...'faiv milion dolaɹs.'];
  const merged = { first: 1, last: 18, merged: true };
  const tokens = [{ text: '$5', emphasis: false }, { text: 'million.', emphasis: true }];
  const { kept, spans } = editCall(chars, [merged, { ...merged }], tokens);
  assert.equal(kept, 'fˈaiv mˈilion dˈolaɹs.');
  assert.deepEqual(spans, [{ first: 1, last: 21, merged: true }, { first: 1, last: 21, merged: true }]);
});

test('editCall refuses an IPA hint on a token the voice reorders, naming it', () => {
  const chars = [...'faiv milion dolaɹs.'];
  const merged = { first: 1, last: 18, merged: true };
  const tokens = [{ text: '$5', emphasis: false, ipa: 'faɪv' }, { text: 'million.', emphasis: false }];
  assert.throws(() => editCall(chars, [merged, { ...merged }], tokens), /\$5.*pronunciation hint/);
});

test('planShotCalls splits a stretch over MAX_IDS at its comma, every call fits, and countIds always returns a finite number', async () => {
  const { tokens } = parseSay(`${'ba '.repeat(100)}ba, ${'ba '.repeat(99)}ba.`);
  const seen = [];
  // A planner that checks what countIds returns, then defers to the real planCalls.
  const planner = (sayTokens, opts) => planCalls(sayTokens, {
    ...opts,
    countIds: (indexes) => {
      const n = opts.countIds(indexes);
      seen.push(n);
      assert.ok(Number.isFinite(n), `countIds returned ${String(n)}`);
      return n;
    },
  });
  const plan = await planShotCalls(tokens, { speed: 1, emphasisPause: 0, shotId: 'long', phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB, planner });
  const speech = plan.filter((c) => c.kind === 'speech');
  assert.ok(seen.length > 0);
  assert.deepEqual(speech.map((c) => c.tokens.length), [101, 100]);
  assert.deepEqual(speech.flatMap((c) => c.tokens), tokens.map((_, i) => i));
  assert.ok(speech.every((c) => c.input.ids.length <= MAX_IDS));
});

test('planShotCalls passes a skip item through without model input', async () => {
  const { tokens } = parseSay('Wait - now.');
  const planner = (sayTokens, opts) => {
    opts.countIds([0]);
    opts.countIds([2]);
    return [
      { kind: 'speech', tokens: [0], speed: 1, level: 'normal' },
      { kind: 'skip', tokens: [1] },
      { kind: 'speech', tokens: [2], speed: 1, level: 'normal' },
    ];
  };
  const plan = await planShotCalls(tokens, { speed: 1, emphasisPause: 0, shotId: 's', phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB, planner });
  assert.deepEqual(plan[1], { kind: 'skip', tokens: [1] });
  assert.equal(plan[0].input.kept, 'wait');
  assert.equal(plan[2].input.kept, 'now.');
});

// ---------- the worker's shot assembly, with a fake model ----------

// A stand-in model: 12 frames for the lead pad, 2 for every other token; the waveform is exactly that long.
const fakeSpeak = async ({ ids }) => {
  const durations = Float32Array.from(ids, (_, k) => (k === 0 ? 12 : 2));
  const frames = durations.reduce((a, b) => a + b, 0);
  return { waveform: new Float32Array(frames * 600).fill(0.1), durations };
};
const shotDeps = { speak: fakeSpeak, phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB, speed: 1, emphasisPause: 0 };

test('a pause inserts its silence and advances the next call\'s word times (hand-computed)', async () => {
  // "Wait (0.4) now.": speech [Wait], silence 0.4 s, speech [now.].
  // Call 1 ids [0 w a i t 0]: frames 12+2*5 = 22 = 13200 samples untrimmed. Call 2 [0 n o w . 0]: 13200 untrimmed.
  // Untrimmed first-word start: raw 12 * 600 = 7200, lead -119 + 12 * 12 = 25 ms = 600 samples -> 6600.
  // Lead pad cut: 6600 - 75 ms (1800) = 4800, inside the 12-frame (7200-sample) pad. The tail pad is left.
  // So each call is 13200 - 4800 = 8400 samples and its times move 4800 earlier.
  // Wait: start 6600 - 4800 = 1800 = 0.075 s; last in its call: end (cum 18 + 2) * 600 = 12000 - 4800 = 7200 = 0.3 s.
  // Silence 0.4 s = 9600. now.: offset 8400 + 9600 = 18000; start 1800 + 18000 = 19800 = 0.825 s;
  //       followed by punctuation: end (cum 16 + 2) * 600 = 10800 - 4800 = 6000, + 18000 = 24000 = 1 s.
  const shot = await synthesiseShot({ id: 's', say: 'Wait (0.4) now.' }, shotDeps);
  assert.equal(shot.samples.length, 8400 + 9600 + 8400);
  assert.equal(shot.entry.seconds, 1.1);
  assert.deepEqual(shot.entry.sentences, [{
    start: 0.075,
    end: 1,
    words: [
      { text: 'Wait', start: 0.075, end: 0.3, emphasis: false, aside: false },
      { text: 'now.', start: 0.825, end: 1, emphasis: false, aside: false },
    ],
  }]);
  assert.ok(shot.samples.slice(8400, 8400 + 9600).every((v) => v === 0), 'the written pause is exactly 0.4 s of zeros');
});

test('emphasis and aside are recorded per word, the aside call runs faster, and sentences split at sentence ends', async () => {
  const speeds = [];
  const speak = async (call) => {
    speeds.push(call.speed);
    return fakeSpeak(call);
  };
  const shot = await synthesiseShot({ id: 's', say: 'It *is* here. Done, _quietly_.' }, { ...shotDeps, speak });
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.deepEqual(words.map((w) => [w.text, w.emphasis, w.aside]), [
    ['It', false, false], ['is', true, false], ['here.', false, false], ['Done,', false, false], ['quietly.', false, true],
  ]);
  assert.equal(shot.entry.sentences.length, 2);
  assert.deepEqual(speeds, [1, 1, 1 / 0.85]);
  for (const w of words) assert.ok(w.end > w.start && w.start >= 0 && w.end <= shot.entry.seconds, JSON.stringify(w));
});

// A stand-in model with a 20-frame lead pad and a 15-frame tail pad, 2 frames per phoneme token, and a waveform whose
// every sample is 0.5, so the cut lengths and the fades are visible.
const padSpeak = async ({ ids }) => {
  const durations = Float32Array.from(ids, (_, k) => (k === 0 ? 20 : k === ids.length - 1 ? 15 : 2));
  const frames = durations.reduce((a, b) => a + b, 0);
  return { waveform: new Float32Array(frames * 600).fill(0.5), durations };
};

test('trimPads cuts the lead pad up to LEAD_KEEP_MS before the first word, fades the cut in, and leaves the tail pad whole', () => {
  // Frames [20, 2, 2, 2, 2, 15] = 43 frames = 25800 samples. First word start (untrimmed) 9096 (raw 12000 minus the
  // call-start lead max(0, -119 + 12 * 20) = 121 ms = 2904 samples). Cut: 9096 - 75 ms (1800) = 7296, inside the
  // 20-frame (12000-sample) pad. The tail pad is not cut.
  assert.equal(LEAD_KEEP_MS, 75);
  const frames = [20, 2, 2, 2, 2, 15];
  const waveform = new Float32Array(43 * 600).fill(0.5);
  const { samples, cutFront } = trimPads(waveform, frames, 9096);
  assert.equal(cutFront, 7296);
  assert.equal(samples.length, 25800 - 7296);
  assert.equal(9096 - cutFront, 1800, 'the first word starts 75 ms into the trimmed call');
  assert.equal(samples[0], 0, 'fade in starts at silence');
  assert.equal(samples[FADE_SAMPLES], 0.5, 'full level after the 5 ms fade');
  assert.ok(samples[FADE_SAMPLES / 2] > 0 && samples[FADE_SAMPLES / 2] < 0.5, 'the fade is a ramp');
  assert.equal(samples.at(-1), 0.5, 'the tail is not cut, so it is not faded');
  assert.equal(waveform[0], 0.5, 'the model output is not changed in place');
});

test('trimPads never cuts past the pad\'s end, and does not cut (or fade) when the first word is within LEAD_KEEP_MS of the start', () => {
  const frames = [3, 2, 2, 2];
  const waveform = new Float32Array(9 * 600).fill(0.5);
  const late = trimPads(waveform, frames, 5000);
  assert.equal(late.cutFront, 1800, 'at most the whole 3-frame pad, never into the first phoneme');
  const early = trimPads(waveform, frames, 1000);
  assert.equal(early.cutFront, 0, 'a pad shorter than the keep is not cut');
  assert.equal(early.samples.length, 9 * 600);
  assert.equal(early.samples[0], 0.5, 'no cut in front, so no fade there');
});

test('a 20-frame lead and 15-frame tail pad call is trimmed in front only and its word times shift by the samples cut', async () => {
  // "Wait." ids [0 w a i t . 0], frames [20, 2, 2, 2, 2, 2, 15] = 45 frames = 27000 samples.
  // Untrimmed: Wait raw 12000, lead 121 ms = 2904 -> 9096; followed by punctuation: end (cum[t] = 20 + 2 + 2 + 2 = 26,
  // plus 2) * 600 = 16800. Cut front 9096 - 1800 = 7296; the tail pad is kept.
  // Call = 27000 - 7296 = 19704 samples. Wait: 9096 - 7296 = 1800 = 0.075 s to 16800 - 7296 = 9504 = 0.396 s.
  const shot = await synthesiseShot({ id: 's', say: 'Wait.' }, { ...shotDeps, speak: padSpeak });
  assert.equal(shot.samples.length, 19704);
  assert.deepEqual(shot.entry.sentences[0].words, [{ text: 'Wait.', start: 0.075, end: 0.396, emphasis: false, aside: false }]);
});

test('a skip planned by the real planCalls adds no samples and sits at the end of the call before it', async () => {
  // "One. - . Two." -> tokens "One.", "-." (the lone "." joins the dash), "Two."; "-." ends a sentence and has nothing
  // speakable, so planCalls makes it a skip. Each call [0 . . . . 0] is 22 frames = 13200 samples untrimmed, minus the
  // 4800-sample lead cut (6600 - 1800) = 8400. The skip sits at 8400 = 0.35 s; total 16800.
  const { tokens } = parseSay('One. - . Two.');
  assert.deepEqual(tokens.map((t) => t.text), ['One.', '-.', 'Two.']);
  const items = planCalls(tokens, { speed: 1, emphasisPause: 0, countIds: () => 6 });
  assert.deepEqual(items.map((i) => i.kind), ['speech', 'skip', 'speech']);
  const shot = await synthesiseShot({ id: 's', say: 'One. - . Two.' }, shotDeps);
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.equal(shot.samples.length, 16800);
  assert.deepEqual(words[1], { text: '-.', start: 0.35, end: 0.35, emphasis: false, aside: false });
});

test('a dash inside a call (the real planner) is a zero-length word at the next word\'s start, and the call is still trimmed', async () => {
  // "Wait. - now." plans as speech [Wait.] then speech [-, now.]. Call 1 [0 w a i t . 0] = 24 frames = 14400 samples,
  // lead cut 6600 - 1800 = 4800 -> 9600. Call 2 phonemes "now." (the dash has none) [0 n o w . 0] = 22 frames = 13200,
  // cut 4800 -> 8400, from 9600: now. 9600 + 1800 = 11400 = 0.475 s to 9600 + (16 + 2) * 600 - 4800 = 15600 = 0.65 s;
  // the dash sits at now.'s start. Total 9600 + 8400 = 18000 (the review's probe 3 gave the same values).
  const shot = await synthesiseShot({ id: 's', say: 'Wait. - now.' }, shotDeps);
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.equal(shot.samples.length, 18000);
  assert.deepEqual(words.map((w) => [w.text, w.start, w.end]), [['Wait.', 0.075, 0.3], ['-', 0.475, 0.475], ['now.', 0.475, 0.65]]);
});

test('a shot without say, or whose say has nothing speakable, gets no WAV: wav null, 0 s', async () => {
  const silent = await synthesiseShot({ id: 'hold', say: null }, shotDeps);
  assert.deepEqual([silent.samples, silent.entry], [null, { id: 'hold', seconds: 0, sentences: [] }]);
  assert.deepEqual(sidecarShot(1, silent), { shot: { id: 'hold', wav: null, seconds: 0, sentences: [] }, wav: null });
  const shot = await synthesiseShot({ id: 'dash', say: '-' }, shotDeps);
  assert.equal(shot.samples.length, 0);
  const { shot: entry, wav } = sidecarShot(4, shot);
  assert.equal(wav, null, 'no file is written');
  assert.deepEqual(entry, { id: 'dash', wav: null, seconds: 0, sentences: [{ start: 0, end: 0, words: [{ text: '-', start: 0, end: 0, emphasis: false, aside: false }] }] });
  const spoken = sidecarShot(4, await synthesiseShot({ id: 'one', say: 'One.' }, shotDeps));
  assert.equal(spoken.shot.wav, 'shot-4.wav');
  assert.equal(spoken.wav.toString('ascii', 0, 4), 'RIFF');
});

test('model output with a sample that is not a finite number, or frames that miss its length, is an error', async () => {
  const withNaN = async (call) => {
    const out = await fakeSpeak(call);
    const waveform = Float32Array.from(out.waveform);
    waveform[700] = Number.NaN;
    return { ...out, waveform };
  };
  await assert.rejects(synthesiseShot({ id: 'open', say: 'Wait now.' }, { ...shotDeps, speak: withNaN }), /shot "open".*not a finite number/);
  const short = async (call) => {
    const out = await fakeSpeak(call);
    return { ...out, waveform: out.waveform.subarray(0, out.waveform.length - 600) };
  };
  await assert.rejects(synthesiseShot({ id: 'open', say: 'Wait now.' }, { ...shotDeps, speak: short }), /shot "open".*frames/);
});

test('every word lies inside its shot\'s WAV after trimming, across calls, silences and asides', async () => {
  const shot = await synthesiseShot({ id: 's', say: 'One more time. Then, (0.4) _quietly_, we go on and on.' }, { ...shotDeps, speak: padSpeak });
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.equal(words.length, 10);
  for (const w of words) assert.ok(w.start >= 0 && w.end >= w.start && w.end <= shot.entry.seconds, JSON.stringify(w));
  assert.equal(Math.round(shot.entry.seconds * SAMPLE_RATE), shot.samples.length);
});

test('a silence is rounded to whole milliseconds, so seconds times 24000 is the sample count', async () => {
  assert.equal(SILENCE_QUANTUM_SAMPLES, 24);
  // 0.0513 s is 1231.2 samples; whole milliseconds make it 51 ms = 1224 samples.
  const shot = await synthesiseShot({ id: 's', say: 'Wait (0.0513) now.' }, shotDeps);
  assert.equal(shot.samples.length, 8400 + 1224 + 8400);
  assert.equal(Math.round(shot.entry.seconds * SAMPLE_RATE), shot.samples.length);
});

test('encodeWav writes a 24 kHz mono 16-bit PCM WAV with clamped samples', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5, 2]), SAMPLE_RATE);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), 10);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => wav.readInt16LE(44 + i * 2)), [0, 32767, -32767, 16384, 32767]);
});
