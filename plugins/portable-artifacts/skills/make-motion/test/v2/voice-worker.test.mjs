// The narration worker as a child process, its error classification, and real-model integration.
// The child-process tests need no model: the worker fails before loading one. The integration tests synthesise for
// real: they are skipped when neither MAKE_MOTION_VOICE_RUNTIME nor MAKE_MOTION_VOICE_MODEL is set and the default
// install or model is absent; when either variable is set they run, and a missing or incomplete folder fails them (a
// typo never turns into a green skip). No test downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SayError, parseSay } from '../../engine/script/say.mjs';
import { STYLE_DIM, openKokoro } from '../../scripts/v2/voice/kokoro.mjs';
import { MAX_IDS, planCalls } from '../../scripts/v2/voice/calls.mjs';
import {
  ERROR_MARKER, FADE_SAMPLES, INSTALL_HINT, LEAD_KEEP_MS, SILENCE_QUANTUM_SAMPLES, classifyError, encodeWav, runJob, sidecarShot,
  synthesiseShot, trimPads,
} from '../../scripts/v2/voice/worker.mjs';
import { CODE_FILES, WORKER_PATH, synthesiseFilm } from '../../scripts/v2/voice/synth.mjs';
import { EMBEDDED_VOCAB, VoiceTextError } from '../../scripts/v2/voice/tokens.mjs';
import { SAMPLE_RATE } from '../../scripts/v2/voice/words.mjs';
import { VOICE_MODEL, voiceModelDir } from '../../scripts/v2/voice/model.mjs';
import { OPTIONAL_ROOT } from '../../scripts/lib/optional.mjs';
import { UsageError } from '../../scripts/lib/spec.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILM = path.join(HERE, 'fixtures/voice/film-three-shots.json');
const withScratch = async (fn) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'voice-worker-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// ---------- error classification ----------

test('classifyError: a VoiceTextError or SayError is the film\'s and names the shot it belongs to; the rest is machine trouble', () => {
  const film = classifyError(new VoiceTextError('shot "long": too many ids'), 'synth', 'long');
  assert.deepEqual(film, { kind: 'film', message: 'shot "long": too many ids', hint: film.hint, shot: 'long' });
  assert.ok(film.hint.length > 0);
  assert.equal(classifyError(new SayError('unclosed *'), 'synth', 'open').shot, 'open');
  assert.equal(classifyError(new VoiceTextError('x'), 'synth', undefined).shot, undefined, 'no shot when none was being made');
  const usage = classifyError(new UsageError(INSTALL_HINT), 'runtime', 'open');
  assert.deepEqual(usage, { kind: 'machine', message: INSTALL_HINT, hint: INSTALL_HINT });
  const crash = classifyError(new Error('ENOSPC: no space left'), 'synth', 'open');
  assert.equal(crash.kind, 'machine');
  assert.equal(crash.shot, undefined, 'machine trouble is not reported at a shot');
  const hintAt = (stage) => classifyError(new Error('boom'), stage).hint;
  assert.match(hintAt('runtime'), /runtime failed to load/);
  assert.match(hintAt('model'), /changed on disk/);
  assert.match(hintAt('session'), /onnxruntime could not open/);
  assert.match(hintAt('job'), /different versions/);
});

// ---------- the code key: every voice module the worker loads is hashed ----------

// "Loaded" is decided by a static scan: from worker.mjs, every relative `import ... from '...'` and
// `export ... from '...'` (multi-line too), followed transitively. Bare package imports are not followed. Dynamic
// imports would be missed; the voice modules have none (importOptional loads only the optional package).
function staticallyLoaded(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    const specifiers = [...source.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/gm), ...source.matchAll(/^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm)];
    for (const [, spec] of specifiers) visit(path.resolve(path.dirname(file), spec));
  };
  visit(entry);
  return [...seen];
}

test('every scripts/v2/voice module the worker loads (static import scan), and say.mjs, is in CODE_FILES; model.mjs is keyed by MODEL_PIN', () => {
  const voiceDir = path.dirname(WORKER_PATH);
  const loaded = staticallyLoaded(WORKER_PATH);
  const shaping = loaded.filter((f) => path.dirname(f) === voiceDir || f.endsWith(path.join('engine', 'script', 'say.mjs')));
  const exempt = new Set([path.join(voiceDir, 'model.mjs')]);
  const missing = shaping.filter((f) => !exempt.has(f) && !CODE_FILES.includes(f));
  assert.deepEqual(missing, [], `loaded by the worker but not in the code key: ${missing.join(', ')}`);
  assert.deepEqual(CODE_FILES.filter((f) => !loaded.includes(f)), [], 'every keyed file is loaded by the worker');
  assert.ok(loaded.some((f) => f.endsWith('calls.mjs')) && loaded.some((f) => f.endsWith('say.mjs')), 'the scan follows imports transitively');
});

// ---------- openKokoro and runJob with a fake onnxruntime ----------

const VOICE_ROWS = 510;

function fakeOrt({ release = async () => {} } = {}) {
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
      await release();
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

test('runJob keeps a film error when closing the model also fails, and logs the close failure', async () => {
  await withScratch(async (dir) => {
    const modelDir = path.join(dir, 'model');
    writeFakeModel(modelDir);
    copyFileSync(path.join(HERE, 'fixtures/voice/tokenizer.json'), path.join(modelDir, 'tokenizer.json'));
    const fake = fakeOrt({ release: async () => { throw new Error('session release failed'); } });
    const phonemize = async (text) => [text.toLowerCase().replace(/[^a-z ]/g, '')];
    const job = { version: 1, dir, shots: [{ id: 'long', say: `${'ba '.repeat(200)}ba.` }], speed: 1, emphasisPause: 0, voice: 'af_heart', runtime: dir, modelDir };
    const lines = [];
    await assert.rejects(runJob(job, { ort: fake.ort, phonemize, log: (l) => lines.push(l) }), (err) => err.name === 'VoiceTextError');
    assert.ok(lines.some((l) => l.includes('session release failed')), lines.join('\n'));
  });
});

// ---------- the worker as a child process (no model needed: it fails before loading one) ----------

function runWorker(job, dir, env = process.env) {
  const jobFile = path.join(dir, 'job.json');
  writeFileSync(jobFile, JSON.stringify(job));
  return new Promise((resolve) => {
    execFile(process.execPath, [WORKER_PATH, jobFile], { env }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
// The worker's last stderr line: the classified error it ends with.
const lastError = (stderr) => {
  const line = stderr.split('\n').filter((l) => l.trim() !== '').at(-1);
  assert.ok(line.startsWith(ERROR_MARKER), line);
  return JSON.parse(line.slice(ERROR_MARKER.length));
};

test('the worker exits 2 (machine) with the install hint when the runtime is not installed', async () => {
  await withScratch(async (dir) => {
    const job = { version: 1, dir, shots: [{ id: 'a', say: 'Hi.' }], speed: 1, emphasisPause: 0, voice: 'af_heart', runtime: path.join(dir, 'missing', 'voice'), modelDir: path.join(dir, 'model') };
    const { code, stderr } = await runWorker(job, dir);
    assert.equal(code, 2);
    assert.deepEqual(lastError(stderr), { kind: 'machine', message: INSTALL_HINT, hint: INSTALL_HINT });
    assert.ok(INSTALL_HINT.startsWith('the optional voice package is not installed. Run: '), INSTALL_HINT);
  });
});

// A stand-in runtime folder laid out like optional/voice, so importOptional accepts it: index.mjs exports a fake ort
// and phonemize; the package and lockfile declare nothing.
function writeFakeRuntime(dir) {
  const runtime = path.join(dir, 'rt', 'voice');
  mkdirSync(path.join(runtime, 'node_modules', 'onnxruntime-node'), { recursive: true });
  writeFileSync(path.join(runtime, 'node_modules', 'onnxruntime-node', 'package.json'), '{"name":"onnxruntime-node","version":"0.0.0"}');
  writeFileSync(path.join(runtime, 'package.json'), '{"name":"fake-voice","private":true,"type":"module","dependencies":{}}');
  writeFileSync(path.join(runtime, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"":{"name":"fake-voice"}}}');
  writeFileSync(path.join(runtime, 'index.mjs'), 'export const ort = { InferenceSession: { create: async () => ({ run: async () => { throw new Error("unused"); }, release: async () => {} }) } };\nexport const phonemize = async (t) => [t];\n');
  return runtime;
}

test('the worker itself never downloads: with a model file missing it refuses (machine, exit 2) and fetch is never called', async () => {
  await withScratch(async (dir) => {
    // A preload replaces fetch in the worker process with one that leaves a flag file and fails, so a worker that
    // tried to download would be caught here without any network request.
    const flag = path.join(dir, 'fetch-called');
    const preload = path.join(dir, 'no-fetch.mjs');
    writeFileSync(preload, 'import { writeFileSync } from "node:fs";\nglobalThis.fetch = async () => { writeFileSync(process.env.VOICE_TEST_FETCH_FLAG, "called"); throw new Error("test: fetch must not be called"); };\n');
    const modelDir = path.join(dir, 'empty-model');
    mkdirSync(modelDir);
    const job = { version: 1, dir, shots: [{ id: 'a', say: 'Hi.' }], speed: 1, emphasisPause: 0, voice: 'af_heart', runtime: writeFakeRuntime(dir), modelDir };
    const env = { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, VOICE_TEST_FETCH_FLAG: flag };
    const { code, stderr } = await runWorker(job, dir, env);
    assert.equal(code, 2);
    const error = lastError(stderr);
    assert.equal(error.kind, 'machine');
    assert.match(error.message, /never downloads/);
    assert.equal(existsSync(flag), false, 'fetch was never called');
  });
});

test('the worker refuses an unknown job field (machine: make.mjs and its worker disagree), listing the accepted ones', async () => {
  await withScratch(async (dir) => {
    const job = { version: 1, dir, shots: [], speed: 1, emphasisPause: 0, voice: 'af_heart', runtime: dir, modelDir: dir, spead: 2 };
    const { code, stderr } = await runWorker(job, dir);
    assert.equal(code, 2);
    const error = lastError(stderr);
    assert.equal(error.kind, 'machine');
    assert.match(error.message, /unknown field spead.*accepted: .*speed/);
  });
});

// ---------- integration: the real model ----------

const RUNTIME_FILES = ['index.mjs', 'package-lock.json', 'node_modules/onnxruntime-node/package.json', 'node_modules/phonemizer/package.json'];
const runtimeComplete = (dir) => RUNTIME_FILES.every((f) => existsSync(path.join(dir, f)));
const modelComplete = (dir) => VOICE_MODEL.files.every((f) => existsSync(path.join(dir, f.path)) && statSync(path.join(dir, f.path)).size === f.bytes);
const located = (name, fallback, complete) => {
  const dir = process.env[name] ? path.resolve(process.env[name]) : fallback;
  return { name, dir, isSet: Boolean(process.env[name]), isComplete: complete(dir) };
};
const RUNTIME = located('MAKE_MOTION_VOICE_RUNTIME', path.join(OPTIONAL_ROOT, 'voice'), runtimeComplete);
const MODEL = located('MAKE_MOTION_VOICE_MODEL', voiceModelDir(), modelComplete);

function skipReason() {
  if (RUNTIME.isSet || MODEL.isSet) return false;
  if (!RUNTIME.isComplete) return `the optional voice runtime is not installed (${INSTALL_HINT}; or set MAKE_MOTION_VOICE_RUNTIME)`;
  if (!MODEL.isComplete) return 'the pinned voice model is not present locally (a test never downloads it; set MAKE_MOTION_VOICE_MODEL)';
  return false;
}

function realOpts(outDir) {
  for (const where of [RUNTIME, MODEL]) assert.ok(where.isComplete, `${where.name}: ${where.dir} is missing or incomplete`);
  return { outDir, voice: 'af_heart', runtime: RUNTIME.dir, modelDir: MODEL.dir, offline: true };
}

// The samples of a 16-bit mono WAV, and their RMS level.
function wavLevel(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  const count = bytes.readUInt32LE(40) / 2;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += (bytes.readInt16LE(44 + i * 2) / 32767) ** 2;
  return { count, rms: Math.sqrt(sum / Math.max(1, count)) };
}

test('integration: the three-shot fixture film gives two audible WAVs with 9 ordered words each, then a cache hit', { skip: skipReason(), timeout: 300000 }, async () => {
  const film = JSON.parse(readFileSync(FIXTURE_FILM, 'utf8'));
  await withScratch(async (outDir) => {
    const result = await synthesiseFilm(film, realOpts(outDir));
    const { shots } = result.sidecar;
    assert.deepEqual([result.cached, shots.map((s) => s.wav)], [false, ['shot-0.wav', null, 'shot-2.wav']]);
    assert.deepEqual(shots.map((s) => s.sentences.flatMap((x) => x.words).length), [9, 0, 9]);
    for (const shot of [shots[0], shots[2]]) {
      const { count, rms } = wavLevel(path.join(result.dir, shot.wav));
      assert.equal(count, Math.round(shot.seconds * SAMPLE_RATE), shot.id);
      assert.ok(shot.seconds > 3 && shot.seconds < 8, `${shot.id}: ${shot.seconds} s is a plausible length for its line`);
      assert.ok(rms > 0.01, `${shot.id}: RMS ${rms} is speech, not silence`);
      const words = shot.sentences.flatMap((s) => s.words);
      words.forEach((w, i) => {
        assert.ok(w.end > w.start, `${shot.id} "${w.text}": end ${w.end} > start ${w.start} (no dash in this fixture)`);
        assert.ok(i === 0 || w.start >= words[i - 1].start, `${shot.id} "${w.text}": starts are non-decreasing`);
      });
    }
    assert.equal((await synthesiseFilm(film, realOpts(outDir))).cached, true);
  });
});

test('integration: a film error after the runtime has loaded is kind film, exit 1 (not a signal), at its shot', { skip: skipReason(), timeout: 300000 }, async () => {
  // Over 512 ids with no comma, semicolon, colon or dash to split at: planCalls throws after the phonemizer has run,
  // so the phonemizer's process-wide hook is installed when the error happens.
  const film = { mode: 'pro', shots: [{ id: 'intro', say: 'Hello.' }, { id: 'long', say: `${'ba '.repeat(200)}ba.` }] };
  await withScratch(async (outDir) => {
    await assert.rejects(synthesiseFilm(film, realOpts(outDir)), (err) => {
      assert.deepEqual([err.kind, err.exitCode, err.shot], ['film', 1, 'long']);
      assert.match(err.message, /^shot "long": a stretch of narration is \d+ model ids, over the limit of 512/);
      return true;
    });
  });
});

// ---------- the worker's shot assembly, with a fake model ----------

// A stand-in phonemizer: each word's letters, lower case, with g (not in the vocab) spelt k.
const fakePhonemize = async (text) => [text.split(/\s+/).filter(Boolean).map((w) => w.toLowerCase().replace(/[^a-z]/g, '').replace(/g/g, 'k')).join(' ')];

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
  // Lead pad cut: 6600 - 110 ms (2640) = 3960, inside the 12-frame (7200-sample) pad. The tail pad is left.
  // So each call is 13200 - 3960 = 9240 samples and its times move 3960 earlier.
  // Wait: start 6600 - 3960 = 2640 = 0.11 s; last in its call: end (cum 18 + 2) * 600 = 12000 - 3960 = 8040 = 0.335 s.
  // Silence 0.4 s = 9600. now.: offset 9240 + 9600 = 18840; start 2640 + 18840 = 21480 = 0.895 s;
  //       followed by punctuation: end (cum 16 + 2) * 600 = 10800 - 3960 = 6840, + 18840 = 25680 = 1.07 s.
  const shot = await synthesiseShot({ id: 's', say: 'Wait (0.4) now.' }, shotDeps);
  assert.equal(shot.samples.length, 9240 + 9600 + 9240);
  assert.equal(shot.entry.seconds, 1.17);
  assert.deepEqual(shot.entry.sentences, [{
    start: 0.11,
    end: 1.07,
    words: [
      { text: 'Wait', start: 0.11, end: 0.335, emphasis: false, aside: false },
      { text: 'now.', start: 0.895, end: 1.07, emphasis: false, aside: false },
    ],
  }]);
  assert.ok(shot.samples.slice(9240, 9240 + 9600).every((v) => v === 0), 'the written pause is exactly 0.4 s of zeros');
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
  // call-start lead max(0, -119 + 12 * 20) = 121 ms = 2904 samples). Cut: 9096 - 110 ms (2640) = 6456, inside the
  // 20-frame (12000-sample) pad. The tail pad is not cut.
  assert.equal(LEAD_KEEP_MS, 110);
  const frames = [20, 2, 2, 2, 2, 15];
  const waveform = new Float32Array(43 * 600).fill(0.5);
  const { samples, cutFront } = trimPads(waveform, frames, 9096);
  assert.equal(cutFront, 6456);
  assert.equal(samples.length, 25800 - 6456);
  assert.equal(9096 - cutFront, 2640, 'the first word starts 110 ms into the trimmed call');
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
  // plus 2) * 600 = 16800. Cut front 9096 - 2640 = 6456; the tail pad is kept.
  // Call = 27000 - 6456 = 20544 samples. Wait: 9096 - 6456 = 2640 = 0.11 s to 16800 - 6456 = 10344 = 0.431 s.
  const shot = await synthesiseShot({ id: 's', say: 'Wait.' }, { ...shotDeps, speak: padSpeak });
  assert.equal(shot.samples.length, 20544);
  assert.deepEqual(shot.entry.sentences[0].words, [{ text: 'Wait.', start: 0.11, end: 0.431, emphasis: false, aside: false }]);
});

test('a skip planned by the real planCalls adds no samples and sits at the end of the call before it', async () => {
  // "One. - . Two." -> tokens "One.", "-." (the lone "." joins the dash), "Two."; "-." ends a sentence and has nothing
  // speakable, so planCalls makes it a skip. Each call [0 . . . . 0] is 22 frames = 13200 samples untrimmed, minus the
  // 3960-sample lead cut (6600 - 2640) = 9240. The skip sits at 9240 = 0.385 s; total 18480.
  const { tokens } = parseSay('One. - . Two.');
  assert.deepEqual(tokens.map((t) => t.text), ['One.', '-.', 'Two.']);
  const items = planCalls(tokens, { speed: 1, emphasisPause: 0, countIds: () => 6 });
  assert.deepEqual(items.map((i) => i.kind), ['speech', 'skip', 'speech']);
  const shot = await synthesiseShot({ id: 's', say: 'One. - . Two.' }, shotDeps);
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.equal(shot.samples.length, 18480);
  assert.deepEqual(words[1], { text: '-.', start: 0.385, end: 0.385, emphasis: false, aside: false });
});

test('a dash inside a call (the real planner) is a zero-length word at the next word\'s start, and the call is still trimmed', async () => {
  // "Wait. - now." plans as speech [Wait.] then speech [-, now.]. Call 1 [0 w a i t . 0] = 24 frames = 14400 samples,
  // lead cut 6600 - 2640 = 3960 -> 10440. Call 2 phonemes "now." (the dash has none) [0 n o w . 0] = 22 frames = 13200,
  // cut 3960 -> 9240, from 10440: now. 10440 + 2640 = 13080 = 0.545 s to 10440 + (16 + 2) * 600 - 3960 = 17280 = 0.72 s;
  // the dash sits at now.'s start. Total 10440 + 9240 = 19680. Wait. ends at 12000 - 3960 = 8040 = 0.335 s.
  const shot = await synthesiseShot({ id: 's', say: 'Wait. - now.' }, shotDeps);
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.equal(shot.samples.length, 19680);
  assert.deepEqual(words.map((w) => [w.text, w.start, w.end]), [['Wait.', 0.11, 0.335], ['-', 0.545, 0.545], ['now.', 0.545, 0.72]]);
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
  assert.equal(shot.samples.length, 9240 + 1224 + 9240);
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
