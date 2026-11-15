// Narration synthesis: the model call (kokoro.mjs), the child-process worker (worker.mjs) and the cache (synth.mjs).
// Every test but the last runs without the optional voice install and without the model, through fakes. The last one
// synthesises a fixture film for real and is skipped unless the runtime and all five pinned model files are present
// locally; it never downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSay } from '../../engine/script/say.mjs';
import { ACCEPTED_VOICES, STYLE_DIM, editCall, openKokoro, planShotCalls, prepareCall } from '../../scripts/v2/voice/kokoro.mjs';
import {
  FADE_SAMPLES, INSTALL_HINT, PAD_KEEP_FRAMES, SILENCE_QUANTUM_SAMPLES, TRIM, encodeWav, synthesiseShot, trimPads,
} from '../../scripts/v2/voice/worker.mjs';
import { WORKER_PATH, synthesiseFilm, voiceHash } from '../../scripts/v2/voice/synth.mjs';
import { readSidecar, sentencesOf, writeSidecar } from '../../scripts/v2/voice/sidecar.mjs';
import { EMBEDDED_VOCAB } from '../../scripts/v2/voice/tokens.mjs';
import { LEAD, SAMPLE_RATE } from '../../scripts/v2/voice/words.mjs';
import { MAX_IDS, planCalls } from '../../scripts/v2/voice/calls.mjs';
import { VOICE_MODEL, voiceModelDir } from '../../scripts/v2/voice/model.mjs';
import { OPTIONAL_ROOT } from '../../scripts/lib/optional.mjs';
import { optionalInstall } from '../../scripts/lib/doctor-hint.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILM = path.join(HERE, 'fixtures/voice/film-three-shots.json');
const MODEL_SHA = VOICE_MODEL.files.find((f) => f.path === 'onnx/model_quantized.onnx').sha256;
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
const hashOf = (film, overrides = {}) => voiceHash(film, { voice: 'af_heart', modelSha256: MODEL_SHA, lead: LEAD, ...overrides });

// ---------- voiceHash ----------

test('voiceHash is 64 hex characters and the same for the same input', () => {
  assert.match(hashOf(FILM), /^[0-9a-f]{64}$/);
  assert.equal(hashOf(FILM), hashOf(structuredClone(FILM)));
});

test('voiceHash changes when a say, a shot id, the voice, the model hash, a lead constant or the mode changes', () => {
  const base = hashOf(FILM);
  assert.notEqual(hashOf(withShot(FILM, 0, { say: 'Every frame *counts*. Then it stops.' })), base);
  assert.notEqual(hashOf(withShot(FILM, 2, { id: 'end' })), base);
  assert.notEqual(hashOf(FILM, { voice: 'af_bella' }), base);
  assert.notEqual(hashOf(FILM, { modelSha256: '0'.repeat(64) }), base);
  assert.notEqual(hashOf(FILM, { lead: { ...LEAD, midPhraseMs: LEAD.midPhraseMs + 1 } }), base);
  assert.notEqual(hashOf({ ...FILM, mode: 'viral' }), base);
});

test('voiceHash changes when a pad-trim setting changes, so a sidecar made before a trim change is never re-used', () => {
  const base = hashOf(FILM);
  assert.equal(hashOf(FILM, { trim: { ...TRIM } }), base, 'the default trim is the module constants');
  assert.notEqual(hashOf(FILM, { trim: { ...TRIM, padKeepFrames: TRIM.padKeepFrames + 1 } }), base);
  assert.notEqual(hashOf(FILM, { trim: { ...TRIM, onsetMarginSamples: TRIM.onsetMarginSamples + 24 } }), base);
  assert.notEqual(hashOf(FILM, { trim: { ...TRIM, fadeSamples: TRIM.fadeSamples + 24 } }), base);
});

test('voiceHash does not change when an unrelated field changes (look, hold, a shot field other than id and say)', () => {
  const base = hashOf(FILM);
  assert.equal(hashOf({ ...FILM, look: 'pop' }), base);
  assert.equal(hashOf(withShot(FILM, 1, { hold: 3 })), base);
  assert.equal(hashOf(withShot(FILM, 0, { kicker: 'New kicker', look: 'pop' })), base);
});

// ---------- synthesiseFilm with a fake spawn ----------

// An execFile stand-in that does what the worker does on success: writes the sidecar the job asks for.
function fakeSpawn({ exitCode = 0, stderr = '' } = {}) {
  const calls = [];
  const spawn = (file, args, options, callback) => {
    calls.push({ file, args, options });
    if (exitCode !== 0) {
      const err = Object.assign(new Error(`Command failed: ${file}`), { code: exitCode });
      setImmediate(() => callback(err, '', stderr));
      return;
    }
    const job = JSON.parse(readFileSync(args[1], 'utf8'));
    const shots = job.shots.map((shot, index) => {
      if (shot.say === null) return { id: shot.id, wav: null, seconds: 0, sentences: [] };
      const { tokens } = parseSay(shot.say);
      const words = tokens.map((t, k) => ({ text: t.text, start: k * 0.5, end: k * 0.5 + 0.4, emphasis: t.emphasis, aside: t.aside }));
      writeFileSync(path.join(job.dir, `shot-${index}.wav`), encodeWav(new Float32Array(tokens.length * 12000), SAMPLE_RATE));
      return { id: shot.id, wav: `shot-${index}.wav`, seconds: tokens.length * 0.5, sentences: sentencesOf(tokens, words) };
    });
    writeSidecar(path.join(job.dir, 'voice.json'), { version: 1, model: { id: 'm', commit: 'c', file: 'f', sha256: 's' }, voice: job.voice, sampleRate: 24000, shots });
    setImmediate(() => callback(null, 'voice: done\n', ''));
  };
  return { spawn, calls };
}

test('a cache miss spawns node worker.mjs <job.json> once, execFile-style with no shell; a second call is a cache hit with zero spawns', async () => {
  await withScratch(async (outDir) => {
    const hostile = withShot(FILM, 0, { say: 'Every $(touch pwned) frame; `id` | cat. Then it moves.' });
    const fake = fakeSpawn();
    const first = await synthesiseFilm(hostile, { outDir, voice: 'af_heart', spawn: fake.spawn });
    assert.equal(fake.calls.length, 1);
    const [{ file, args, options }] = fake.calls;
    assert.equal(file, process.execPath);
    assert.equal(args.length, 2);
    assert.equal(args[0], WORKER_PATH);
    assert.ok(args[1].endsWith('.json'), args[1]);
    assert.ok(args.every((a) => !a.includes('$(') && !a.includes('`') && !a.includes('|')), 'film text never reaches argv');
    assert.notEqual(options?.shell, true);
    assert.equal(first.cached, false);
    assert.equal(first.dir, path.join(outDir, '.voice', hashOf(hostile)));
    assert.equal(first.sidecar.shots.length, 3);
    assert.equal(existsSync(args[1]), false, 'the job file is removed after a successful run');

    const second = await synthesiseFilm(hostile, { outDir, voice: 'af_heart', spawn: fake.spawn });
    assert.equal(fake.calls.length, 1, 'a cache hit spawns nothing');
    assert.equal(second.cached, true);
    assert.deepEqual(second.sidecar, first.sidecar);
  });
});

test('the job file carries the shots (id and say, null for none), the pace, the voice and the two locations', async () => {
  await withScratch(async (outDir) => {
    let job;
    const fake = fakeSpawn();
    const spawn = (file, args, options, callback) => {
      job = JSON.parse(readFileSync(args[1], 'utf8'));
      fake.spawn(file, args, options, callback);
    };
    await synthesiseFilm(FILM, { outDir, voice: 'af_heart', spawn, runtime: '/x/voice', modelDir: '/x/model', offline: true });
    assert.deepEqual(job.shots, [
      { id: 'open', say: 'Every frame *counts*. Then it moves.' }, { id: 'hold', say: null }, { id: 'close', say: 'Done, _quietly_.' },
    ]);
    assert.equal(job.speed, 1);
    assert.equal(job.emphasisPause, 0);
    assert.equal(job.voice, 'af_heart');
    assert.equal(job.runtime, '/x/voice');
    assert.equal(job.modelDir, '/x/model');
    assert.equal(job.offline, true);
    assert.equal(job.dir, path.join(outDir, '.voice', hashOf(FILM)));
  });
});

test('a worker exit code 1 rejects with the last line of its stderr and leaves no sidecar', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn({ exitCode: 1, stderr: 'loading model\nsome detail\nshot "open": the model failed: bad input\n\n' });
    await assert.rejects(
      synthesiseFilm(FILM, { outDir, voice: 'af_heart', spawn: fake.spawn }),
      (err) => {
        assert.equal(err.message, 'shot "open": the model failed: bad input');
        assert.equal(err.exitCode, 1);
        return true;
      },
    );
    assert.equal(existsSync(path.join(outDir, '.voice', hashOf(FILM), 'voice.json')), false);
  });
});

test('a worker that never exits is killed after the timeout and the error says so', async () => {
  await withScratch(async (outDir) => {
    const kills = [];
    let callback = null;
    const spawn = (file, args, options, cb) => {
      callback = cb;
      return { kill: (signal) => { kills.push(signal); return true; } };
    };
    await assert.rejects(
      synthesiseFilm(FILM, { outDir, voice: 'af_heart', spawn, timeoutSeconds: 0.05 }),
      (err) => {
        assert.match(err.message, /voice worker did not finish within 0\.05 s and was killed/);
        assert.equal(err.timedOut, true);
        assert.equal(err.exitCode, null);
        return true;
      },
    );
    assert.deepEqual(kills, ['SIGKILL']);
    callback(Object.assign(new Error('killed'), { code: null, signal: 'SIGKILL' }), '', '');
  });
});

test('synthesiseFilm refuses a timeout that is not a positive number of seconds', async () => {
  const fake = fakeSpawn();
  await assert.rejects(synthesiseFilm(FILM, { outDir: os.tmpdir(), voice: 'af_heart', spawn: fake.spawn, timeoutSeconds: 0 }), /timeoutSeconds/);
  assert.equal(fake.calls.length, 0);
});

test('synthesiseFilm refuses a voice other than af_heart, listing the accepted one, and spawns nothing', async () => {
  const fake = fakeSpawn();
  await assert.rejects(
    synthesiseFilm(FILM, { outDir: os.tmpdir(), voice: 'af_bella', spawn: fake.spawn }),
    (err) => err.message.includes('af_bella') && err.message.includes('af_heart'),
  );
  assert.equal(fake.calls.length, 0);
  assert.deepEqual(ACCEPTED_VOICES, ['af_heart']);
});

test('a cached sidecar that no longer matches the film is an error naming the folder, not a silent re-use', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    const { dir } = await synthesiseFilm(FILM, { outDir, voice: 'af_heart', spawn: fake.spawn });
    const file = path.join(dir, 'voice.json');
    const data = readSidecar(file);
    data.shots[0].sentences[0].words[0].text = 'Evry';
    writeSidecar(file, data);
    await assert.rejects(
      synthesiseFilm(FILM, { outDir, voice: 'af_heart', spawn: fake.spawn }),
      (err) => err.message.includes(dir) && err.message.includes('shots[0].sentences[0].words[0].text'),
    );
    assert.equal(fake.calls.length, 1);
  });
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

test('planShotCalls splits a stretch over MAX_IDS at its comma and every call it returns fits', async () => {
  const say = `${'ba '.repeat(100)}ba, ${'ba '.repeat(99)}ba.`;
  const { tokens } = parseSay(say);
  const plan = await planShotCalls(tokens, { speed: 1, emphasisPause: 0, shotId: 'long', phonemize: fakePhonemize, vocab: EMBEDDED_VOCAB });
  const speech = plan.filter((c) => c.kind === 'speech');
  assert.equal(speech.length, 2);
  assert.equal(speech[0].tokens.length, 101);
  assert.deepEqual([...speech[0].tokens, ...speech[1].tokens], tokens.map((_, i) => i));
  assert.ok(speech.every((c) => c.input.ids.length <= MAX_IDS));
});

test('planShotCalls gives planCalls a countIds that always returns a finite number synchronously, and converges on exact counts', async () => {
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
  assert.ok(seen.length > 0);
  assert.deepEqual(plan.filter((c) => c.kind === 'speech').map((c) => c.tokens.length), [101, 100]);
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

test('a shot without say has no samples, no wav and an empty sentences list', async () => {
  const shot = await synthesiseShot({ id: 'hold', say: null }, shotDeps);
  assert.equal(shot.samples, null);
  assert.deepEqual(shot.entry, { id: 'hold', seconds: 0, sentences: [] });
});

test('a pause inserts its silence and advances the next call\'s word times (hand-computed)', async () => {
  // "Wait (0.4) now.": speech [Wait], silence 0.4 s, speech [now.].
  // Call 1 ids [0 w a i t 0]: frames 12+2*5 = 22 = 13200 samples untrimmed. Call 2 [0 n o w . 0]: 13200 untrimmed.
  // Untrimmed first-word start: raw 12 * 600 = 7200, lead -119 + 12 * 12 = 25 ms = 600 samples -> 6600.
  // Lead pad cut: min(6600 - 75 ms (1800), (12 - 2) * 600 = 6000) = 4800. Tail pad is 2 frames: nothing cut.
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

test('a skip item adds no samples and gives its tokens zero-length words at the current offset', async () => {
  // "Wait. - now." planned as speech [Wait.], skip [-], speech [now.] (the shape calls.mjs returns).
  // Call 1 ids [0 w a i t . 0]: 12 + 2 * 6 = 24 frames = 14400 samples, minus the 4800-sample lead cut = 9600, so the
  // skip sits at 9600 = 0.4 s. Call 2 [0 n o w . 0]: 13200 - 4800 = 8400 samples, starting at 9600.
  const plan = async (tokens, opts) => {
    const [first, second] = await planShotCalls([tokens[0], tokens[2]], opts);
    return [first, { kind: 'skip', tokens: [1] }, { ...second, tokens: [2] }];
  };
  const shot = await synthesiseShot({ id: 's', say: 'Wait. - now.' }, { ...shotDeps, plan });
  const words = shot.entry.sentences.flatMap((s) => s.words);
  assert.equal(shot.samples.length, 9600 + 8400);
  assert.deepEqual(words[1], { text: '-', start: 0.4, end: 0.4, emphasis: false, aside: false });
  assert.ok(words[2].start >= words[1].end);
});

// A stand-in model with a 20-frame lead pad and a 15-frame tail pad, 2 frames per phoneme token, and a waveform whose
// every sample is 0.5, so the cut lengths and the fades are visible.
const padSpeak = async ({ ids }) => {
  const durations = Float32Array.from(ids, (_, k) => (k === 0 ? 20 : k === ids.length - 1 ? 15 : 2));
  const frames = durations.reduce((a, b) => a + b, 0);
  return { waveform: new Float32Array(frames * 600).fill(0.5), durations };
};

test('trimPads keeps the lead pad from 75 ms before the first word, keeps 2 frames of the tail pad, and fades both cuts', () => {
  // Frames [20, 2, 2, 2, 2, 15] = 43 frames = 25800 samples. First word start (untrimmed) 9096 (raw 12000 minus the
  // call-start lead max(0, -119 + 12 * 20) = 121 ms = 2904 samples).
  // Lead cut: min(9096 - 1800, (20 - 2) * 600 = 10800) = 7296. Tail cut: (15 - 2) * 600 = 7800.
  const frames = [20, 2, 2, 2, 2, 15];
  const waveform = new Float32Array(43 * 600).fill(0.5);
  const { samples, cutFront } = trimPads(waveform, frames, 9096);
  assert.equal(cutFront, 7296);
  assert.equal(samples.length, 25800 - 7296 - 7800);
  assert.equal(samples[0], 0, 'fade in starts at silence');
  assert.equal(samples.at(-1), 0, 'fade out ends at silence');
  assert.equal(samples[FADE_SAMPLES], 0.5, 'full level after the 5 ms fade');
  assert.equal(samples.at(-1 - FADE_SAMPLES), 0.5);
  assert.ok(samples[FADE_SAMPLES / 2] > 0 && samples[FADE_SAMPLES / 2] < 0.5, 'the fade is a ramp');
  assert.equal(waveform[0], 0.5, 'the model output is not changed in place');
});

test('trimPads never cuts more than the pad minus PAD_KEEP_FRAMES, never into the 75 ms before the first word, and leaves an uncut edge unfaded', () => {
  assert.equal(PAD_KEEP_FRAMES, 2);
  const frames = [3, 2, 2, 2];
  const waveform = new Float32Array(9 * 600).fill(0.5);
  const late = trimPads(waveform, frames, 5000);
  assert.equal(late.cutFront, 600, 'a 3-frame pad gives up at most 1 frame');
  assert.equal(late.samples.length, 8 * 600, 'a 2-frame tail pad is kept whole');
  assert.equal(late.samples.at(-1), 0.5, 'no cut at the tail, so no fade there');
  const early = trimPads(waveform, frames, 1800);
  assert.equal(early.cutFront, 0, 'a word 75 ms from the start: nothing in front is cut');
  assert.equal(early.samples[0], 0.5, 'no cut in front, so no fade there');
});

test('a 20-frame lead and 15-frame tail pad call is trimmed and its word times shift by the samples cut in front', async () => {
  // "Wait." ids [0 w a i t . 0], frames [20, 2, 2, 2, 2, 2, 15] = 45 frames = 27000 samples.
  // Untrimmed: Wait raw 12000, lead 121 ms = 2904 -> 9096; followed by punctuation: end (cum[t] = 20 + 2 + 2 + 2 = 26,
  // plus 2) * 600 = 16800. Cut front min(9096 - 1800, 10800) = 7296; cut back 13 * 600 = 7800.
  // Call = 27000 - 7296 - 7800 = 11904 samples. Wait: 9096 - 7296 = 1800 = 0.075 s to 16800 - 7296 = 9504 = 0.396 s.
  const shot = await synthesiseShot({ id: 's', say: 'Wait.' }, { ...shotDeps, speak: padSpeak });
  assert.equal(shot.samples.length, 11904);
  assert.deepEqual(shot.entry.sentences[0].words, [{ text: 'Wait.', start: 0.075, end: 0.396, emphasis: false, aside: false }]);
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

test('a model whose frames do not add up to its waveform is an error, not drifting word times', async () => {
  const speak = async (call) => {
    const out = await fakeSpeak(call);
    return { ...out, waveform: out.waveform.subarray(0, out.waveform.length - 600) };
  };
  await assert.rejects(synthesiseShot({ id: 'open', say: 'Wait now.' }, { ...shotDeps, speak }), /shot "open".*frames/);
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

// ---------- the worker as a child process (no model needed: it fails before loading one) ----------

function runWorker(job, dir) {
  const jobFile = path.join(dir, 'job.json');
  writeFileSync(jobFile, JSON.stringify(job));
  return new Promise((resolve) => {
    execFile(process.execPath, [WORKER_PATH, jobFile], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
const lastLine = (text) => text.split('\n').filter((l) => l.trim() !== '').at(-1);

test('the worker exits 2 with the version 2 install hint (version 1 install command) as its last stderr line when the runtime is not installed', async () => {
  await withScratch(async (dir) => {
    const job = { version: 1, dir, shots: [{ id: 'a', say: 'Hi.' }], speed: 1, emphasisPause: 0, voice: 'af_heart', runtime: path.join(dir, 'missing', 'voice'), modelDir: path.join(dir, 'model'), offline: true };
    const { code, stderr } = await runWorker(job, dir);
    assert.equal(code, 2);
    assert.equal(lastLine(stderr), INSTALL_HINT);
    assert.ok(INSTALL_HINT.startsWith('the optional voice package is not installed. Run: '), INSTALL_HINT);
    assert.ok(INSTALL_HINT.includes(optionalInstall('kokoro')), 'the same install command as version 1');
  });
});

test('the worker refuses an unknown job field, listing the accepted ones', async () => {
  await withScratch(async (dir) => {
    const job = { version: 1, dir, shots: [], speed: 1, emphasisPause: 0, voice: 'af_heart', runtime: dir, modelDir: dir, offline: true, spead: 2 };
    const { code, stderr } = await runWorker(job, dir);
    assert.equal(code, 1);
    assert.match(lastLine(stderr), /unknown field spead.*accepted: .*speed/);
  });
});

// ---------- integration: the real model (skipped without it) ----------

function runtimeDir() {
  const dir = process.env.MAKE_MOTION_VOICE_RUNTIME ? path.resolve(process.env.MAKE_MOTION_VOICE_RUNTIME) : path.join(OPTIONAL_ROOT, 'voice');
  const ok = ['index.mjs', 'node_modules/onnxruntime-node/package.json', 'node_modules/phonemizer/package.json'].every((f) => existsSync(path.join(dir, f)));
  return ok ? dir : null;
}

function modelDir() {
  const dir = process.env.MAKE_MOTION_VOICE_MODEL ? path.resolve(process.env.MAKE_MOTION_VOICE_MODEL) : voiceModelDir();
  const ok = VOICE_MODEL.files.every((f) => existsSync(path.join(dir, f.path)) && statSync(path.join(dir, f.path)).size === f.bytes);
  return ok ? dir : null;
}

function skipReason() {
  if (runtimeDir() === null) return `the optional voice runtime is not installed (install: ${optionalInstall('kokoro')}, or set MAKE_MOTION_VOICE_RUNTIME)`;
  if (modelDir() === null) return 'the pinned voice model is not present locally (a test never downloads it; set MAKE_MOTION_VOICE_MODEL to a folder holding all five files)';
  return false;
}

const wavSamples = (file) => {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  return bytes.readUInt32LE(40) / 2;
};

test('integration: the three-shot fixture film synthesises one WAV per narrated shot with words inside it', { skip: skipReason(), timeout: 300000 }, async () => {
  const film = JSON.parse(readFileSync(FIXTURE_FILM, 'utf8'));
  await withScratch(async (outDir) => {
    const opts = { outDir, voice: 'af_heart', runtime: runtimeDir(), modelDir: modelDir(), offline: true };
    const result = await synthesiseFilm(film, opts);
    assert.equal(result.cached, false);
    const { shots } = result.sidecar;
    assert.equal(shots.length, 3);
    assert.equal(shots[1].wav, null);
    assert.deepEqual(shots[1].sentences, []);
    for (const shot of [shots[0], shots[2]]) {
      assert.equal(wavSamples(path.join(result.dir, shot.wav)), Math.round(shot.seconds * SAMPLE_RATE), shot.id);
      // end >= start, not >: a zero-length span (a spaced dash) or a clamped start is a word with end === start.
      for (const w of shot.sentences.flatMap((s) => s.words)) {
        assert.ok(w.end >= w.start, `${shot.id} "${w.text}": end ${w.end} >= start ${w.start}`);
        assert.ok(w.start >= 0 && w.end <= shot.seconds, `${shot.id} "${w.text}" lies inside its WAV of ${shot.seconds} s`);
      }
    }
    const again = await synthesiseFilm(film, opts);
    assert.equal(again.cached, true);
  });
});

const runtimeSkip = () => (runtimeDir() === null ? skipReason() : false);

test('integration: an offline job with a model file missing downloads nothing and fails naming the file', { skip: runtimeSkip(), timeout: 120000 }, async () => {
  await withScratch(async (outDir) => {
    const emptyModel = path.join(outDir, 'no-model');
    mkdirSync(emptyModel);
    await assert.rejects(
      synthesiseFilm(FILM, { outDir, voice: 'af_heart', runtime: runtimeDir(), modelDir: emptyModel, offline: true }),
      (err) => {
        assert.equal(err.exitCode, 1);
        assert.match(err.message, /config\.json/);
        assert.match(err.message, /offline/);
        return true;
      },
    );
    assert.equal(existsSync(path.join(emptyModel, 'config.json')), false);
  });
});

test('integration: a failure after the runtime has loaded exits 1 (not a signal) with the reason as the last stderr line', { skip: skipReason(), timeout: 300000 }, async () => {
  // Over 512 ids with no comma, semicolon, colon or dash to split at: planCalls throws after the phonemizer has run,
  // so the phonemizer's process-wide hook is installed when the error happens.
  const film = { mode: 'pro', shots: [{ id: 'long', say: `${'ba '.repeat(200)}ba.` }] };
  await withScratch(async (outDir) => {
    await assert.rejects(
      synthesiseFilm(film, { outDir, voice: 'af_heart', runtime: runtimeDir(), modelDir: modelDir(), offline: true }),
      (err) => {
        assert.equal(err.exitCode, 1);
        assert.match(err.message, /^shot "long": a stretch of narration is \d+ model ids, over the limit of 512/);
        return true;
      },
    );
  });
});
