// Narration synthesis: the model call (kokoro.mjs), the worker's shot assembly (worker.mjs) and the cache
// (synth.mjs), all through fakes, without the optional voice install or the model. No test downloads. The worker as a
// child process and the real-model integration tests are in voice-worker.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { parseSay } from '../../engine/script/say.mjs';
import { ACCEPTED_VOICES, MODEL_INFO, editCall, planShotCalls, prepareCall } from '../../scripts/v2/voice/kokoro.mjs';
import { ERROR_MARKER, INSTALL_HINT, TRIM, encodeWav } from '../../scripts/v2/voice/worker.mjs';
import {
  CODE_FILES, HASH_CONSTANTS, MODEL_PIN, WORKER_PATH, sourceHash, synthesiseFilm, voiceHash,
} from '../../scripts/v2/voice/synth.mjs';
import { SIDECAR_MAX_BYTES, SidecarError, readSidecar, sentencesOf, writeSidecar } from '../../scripts/v2/voice/sidecar.mjs';
import { EMBEDDED_VOCAB } from '../../scripts/v2/voice/tokens.mjs';
import { LEAD, SAMPLE_RATE } from '../../scripts/v2/voice/words.mjs';
import { MAX_IDS, planCalls } from '../../scripts/v2/voice/calls.mjs';
import { VOICE_MODEL } from '../../scripts/v2/voice/model.mjs';
import { OPTIONAL_ROOT } from '../../scripts/lib/optional.mjs';

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
  assert.deepEqual(names, ['calls.mjs', 'kokoro.mjs', 'phonemes.mjs', 'say.mjs', 'sidecar.mjs', 'spoken.mjs', 'tokens.mjs', 'words.mjs', 'worker.mjs']);
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
// 'close' with the exit code and signal, as a real child does. A kill closes it, as a real SIGKILL does, unless
// `closeOnKill` is false (then the test decides when it has exited).
function fakeChild({ closeOnKill = true } = {}) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kills: [], finished: false });
  child.finish = (code, signal = null) => {
    if (child.finished) return;
    child.finished = true;
    child.stdout.end();
    child.stderr.end();
    setImmediate(() => child.emit('close', code, signal));
  };
  child.kill = (signal) => {
    child.kills.push(signal);
    if (closeOnKill) child.finish(null, signal);
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
  writeSidecar(path.join(job.dir, 'voice.json'), { version: 1, model: { ...MODEL_INFO }, voice: job.voice, sampleRate: 24000, shots });
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
const lockOfDefaultRuntime = () => createHash('sha256').update(readFileSync(path.join(OPTIONAL_ROOT, 'voice', 'package-lock.json'))).digest('hex');
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

test('after a timeout kill the call waits for the worker to exit before removing its staging folder and rejecting', async () => {
  await withScratch(async (outDir) => {
    let child = null;
    const spawn = () => { child = fakeChild({ closeOnKill: false }); return child; };
    let settled = false;
    const run = synthesiseFilm(FILM, opts(outDir, { spawn, timeoutSeconds: 0.05 })).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.deepEqual(child.kills, ['SIGKILL']);
    assert.equal(settled, false, 'still waiting for the killed worker to exit');
    assert.equal(voiceFolder(outDir).filter((n) => n.includes('.partial-')).length, 1, 'its staging folder is still there');
    child.finish(null, 'SIGKILL');
    await assert.rejects(run, (err) => err.timedOut === true && err.kind === 'machine');
    assert.deepEqual(voiceFolder(outDir), []);
  });
});

test('a film error stays a film error when other stderr lines follow the worker\'s error line', async () => {
  await withScratch(async (outDir) => {
    const error = { kind: 'film', message: 'shot "open": too long', hint: 'add a comma', shot: 'open' };
    const fake = fakeSpawn({ exitCode: 1, stderr: `${marker(error)}onnxruntime: teardown warning\n(node) a late notice\n` });
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn })), (err) => {
      assert.deepEqual([err.kind, err.message, err.shot], ['film', 'shot "open": too long', 'open']);
      return true;
    });
  });
});

test('staging folders older than an hour (left by a run that died) are removed when a run starts; fresh ones are kept', async () => {
  await withScratch(async (outDir) => {
    const cache = path.join(outDir, '.voice');
    const old = path.join(cache, `${'0'.repeat(64)}.partial-1-00000000-0000-0000-0000-000000000000`);
    const fresh = path.join(cache, `${'1'.repeat(64)}.partial-2-11111111-1111-1111-1111-111111111111`);
    const other = path.join(cache, 'not-a-staging-folder');
    for (const dir of [old, fresh, other]) mkdirSync(dir, { recursive: true });
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    utimesSync(other, twoHoursAgo, twoHoursAgo);
    await synthesiseFilm(FILM, opts(outDir, { spawn: fakeSpawn().spawn }));
    assert.deepEqual([existsSync(old), existsSync(fresh), existsSync(other)], [false, true, true]);
  });
});

test('a concurrent run that published the same entry first is kept, and this run returns it', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn({
      beforeExit: async () => {
        const winner = path.join(outDir, '.voice', hashOf(FILM, { runtimeLock: lockOfDefaultRuntime() }));
        mkdirSync(winner);
        writeWorkerOutput({ dir: winner, voice: 'af_heart', shots: FILM.shots.map((s) => ({ id: s.id, say: s.say ?? null })) });
      },
    });
    const made = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn }));
    assert.equal(made.cached, false);
    assert.equal(made.sidecar.shots.length, 3);
    assert.deepEqual(voiceFolder(outDir), [path.basename(made.dir)], 'the loser\'s staging folder is removed');
  });
});

test('a file-system failure in the parent (no .voice folder can be made) is machine trouble with a hint', async () => {
  await withScratch(async (dir) => {
    const outDir = path.join(dir, 'a-file');
    writeFileSync(outDir, 'not a folder');
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fakeSpawn().spawn })), (err) => {
      assert.equal(err.kind, 'machine');
      assert.match(err.hint, /writable/);
      return true;
    });
  });
});

test('an entry that cannot be read for a reason other than being incomplete is machine trouble, and is not removed', async (t) => {
  if (process.platform === 'win32' || process.getuid?.() === 0) { t.skip('needs POSIX permissions and a user other than root'); return; }
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    const { dir } = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn }));
    chmodSync(path.join(dir, 'voice.json'), 0o000);
    try {
      await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn })), (err) => err.kind === 'machine' && /EACCES/.test(err.message));
      assert.equal(existsSync(path.join(dir, 'shot-0.wav')), true, 'the entry was left for a person to look at');
      assert.equal(fake.calls.length, 1);
    } finally {
      chmodSync(path.join(dir, 'voice.json'), 0o644);
    }
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
    const wav = path.join(dir, 'shot-0.wav');
    writeFileSync(wav, readFileSync(wav).subarray(0, 1000));
    const fifth = await run();
    assert.deepEqual([fifth.cached, fake.calls.length], [false, 5], 'a truncated body under a full header is incomplete too');
  });
});

// ---------- a cache entry is trusted only after it is checked (review I1) ----------

// FILM's shot 0 has 6 words, so the fake worker gives it 3 s: 72000 samples.
const SHOT0_SAMPLES = 72000;
const TRUST_MISS = 'cannot be trusted';

// A real entry made through the fake worker, then `tamper(dir)`; the next run must be a miss: one log line naming the
// entry, a second spawn and a fresh entry. -> the second run's result.
async function missAfter(outDir, tamper) {
  const fake = fakeSpawn();
  const lines = [];
  const run = () => synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, log: (l) => lines.push(l) }));
  const { dir } = await run();
  tamper(dir);
  lines.length = 0;
  const again = await run();
  assert.deepEqual([again.cached, fake.calls.length], [false, 2], 'a miss: synthesised again');
  assert.equal(lines.filter((l) => l.includes(TRUST_MISS) && l.includes(dir)).length, 1, lines.join('\n'));
  assert.equal(lstatSync(path.join(again.dir, 'shot-0.wav')).isFile(), true, 'the fresh entry has a regular WAV');
  return again;
}

// An ffconcat script under a shot WAV's name, padded to the length the sidecar implies, with "data" and that size at
// bytes 36 to 43, where a 44-byte WAV header keeps them (the review's planted file).
function concatPosingAsWav(samples) {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(samples * 2);
  const head = 'ffconcat version 1.0\n';
  const start = Buffer.concat([Buffer.from(head + '#'.padEnd(36 - head.length, 'x')), Buffer.from('data'), size, Buffer.from("\nfile 'seg.wav'\n#")]);
  return Buffer.concat([start, Buffer.alloc(44 + samples * 2 - start.length, 0x78)]);
}

test('a cached sidecar whose model is not the pinned one, or whose voice is not the one asked for, is a miss', async () => {
  const edits = [
    (s) => ({ ...s, model: null }),
    (s) => ({ ...s, model: { ...s.model, sha256: '0'.repeat(64) } }),
    (s) => ({ ...s, model: { ...s.model, commit: 'main' } }),
    (s) => ({ ...s, model: { ...s.model, extra: true } }),
    (s) => ({ ...s, voice: 'af_bella' }),
  ];
  for (const edit of edits) {
    await withScratch((outDir) => missAfter(outDir, (dir) => {
      const file = path.join(dir, 'voice.json');
      writeFileSync(file, JSON.stringify(edit(readSidecar(file))));
    }));
  }
});

test('a shot WAV that is an ffconcat script padded to look like the WAV the sidecar names is a miss (review I1 probe)', async () => {
  await withScratch(async (outDir) => {
    const outside = path.join(outDir, 'outside.wav');
    writeFileSync(outside, encodeWav(new Float32Array(2400).fill(0.5), SAMPLE_RATE));
    await missAfter(outDir, (dir) => {
      writeFileSync(path.join(dir, 'shot-0.wav'), concatPosingAsWav(SHOT0_SAMPLES));
      symlinkSync(outside, path.join(dir, 'seg.wav'));
    });
  });
});

test('a shot WAV that is a symlink, even to a valid WAV of the right length, is a miss, and the link\'s target is untouched', async () => {
  await withScratch(async (outDir) => {
    const outside = path.join(outDir, 'outside.wav');
    await missAfter(outDir, (dir) => {
      renameSync(path.join(dir, 'shot-0.wav'), outside);
      symlinkSync(outside, path.join(dir, 'shot-0.wav'));
    });
    assert.equal(readFileSync(outside).length, 44 + SHOT0_SAMPLES * 2);
  });
});

test('a WAV header glued in front of other content is a miss: the data size must match the file\'s length', async () => {
  await withScratch((outDir) => missAfter(outDir, (dir) => {
    const header = encodeWav(new Float32Array(SHOT0_SAMPLES), SAMPLE_RATE).subarray(0, 44);
    writeFileSync(path.join(dir, 'shot-0.wav'), Buffer.concat([header, Buffer.from("ffconcat version 1.0\nfile 'seg.wav'\n")]));
  }));
});

test('a shot WAV whose header is not RIFF/WAVE PCM, 24000 Hz, mono, 16-bit (the length still right) is a miss', async () => {
  const valid = () => encodeWav(new Float32Array(SHOT0_SAMPLES), SAMPLE_RATE);
  const variants = {
    'another rate': () => encodeWav(new Float32Array(SHOT0_SAMPLES), 44100),
    'not RIFF': () => { const b = valid(); b.write('RIFX', 0, 'ascii'); return b; },
    'a RIFF size off by one': () => { const b = valid(); b.writeUInt32LE(b.readUInt32LE(4) + 1, 4); return b; },
    'float, not PCM': () => { const b = valid(); b.writeUInt16LE(3, 20); return b; },
    'stereo': () => { const b = valid(); b.writeUInt16LE(2, 22); b.writeUInt32LE(96000, 28); b.writeUInt16LE(4, 32); return b; },
    '8-bit': () => { const b = valid(); b.writeUInt16LE(8, 34); return b; },
  };
  for (const [name, make] of Object.entries(variants)) {
    await withScratch((outDir) => missAfter(outDir, (dir) => writeFileSync(path.join(dir, 'shot-0.wav'), make())))
      .catch((err) => { throw new Error(`${name}: ${err.message}`, { cause: err }); });
  }
});

test('a sidecar that is a symlink, even to a valid sidecar, is a miss', async () => {
  await withScratch(async (outDir) => {
    const outside = path.join(outDir, 'outside.json');
    await missAfter(outDir, (dir) => {
      renameSync(path.join(dir, 'voice.json'), outside);
      symlinkSync(outside, path.join(dir, 'voice.json'));
    });
    assert.equal(existsSync(outside), true);
  });
});

test('an entry folder that is a symlink, even to a valid entry, is a miss: the link is removed, its target untouched', async () => {
  await withScratch(async (outDir) => {
    const elsewhere = path.join(outDir, 'elsewhere');
    const again = await missAfter(outDir, (dir) => {
      renameSync(dir, elsewhere);
      symlinkSync(elsewhere, dir);
    });
    assert.deepEqual(readdirSync(elsewhere).sort(), ['shot-0.wav', 'shot-2.wav', 'voice.json'], 'the target was not emptied');
    assert.equal(lstatSync(again.dir).isDirectory(), true);
  });
});

test('a .voice that is a symlink is never used or written through: the link is removed and a real folder made', async () => {
  await withScratch(async (outDir) => {
    const elsewhere = path.join(outDir, 'elsewhere');
    mkdirSync(elsewhere);
    symlinkSync(elsewhere, path.join(outDir, '.voice'));
    const fake = fakeSpawn();
    const lines = [];
    const made = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, log: (l) => lines.push(l) }));
    assert.deepEqual(readdirSync(elsewhere), [], 'nothing was staged or published through the link');
    assert.equal(lstatSync(path.join(outDir, '.voice')).isSymbolicLink(), false);
    assert.equal(path.dirname(made.dir), path.join(outDir, '.voice'));
    assert.equal(lines.filter((l) => l.includes(TRUST_MISS) && l.includes('.voice')).length, 1, lines.join('\n'));

    const planted = path.join(outDir, 'planted');
    renameSync(path.join(outDir, '.voice'), planted);
    symlinkSync(planted, path.join(outDir, '.voice'));
    const again = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn }));
    assert.deepEqual([again.cached, fake.calls.length], [false, 2], 'a valid entry behind a linked .voice is not a hit');
    assert.deepEqual(readdirSync(planted), [path.basename(made.dir)], 'the link\'s target is untouched');
  });
});

test('a .voice that is a regular file is removed and a real folder made: a miss, not machine trouble (final review V2)', async () => {
  await withScratch(async (outDir) => {
    writeFileSync(path.join(outDir, '.voice'), 'not a folder');
    const fake = fakeSpawn();
    const lines = [];
    const made = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, log: (l) => lines.push(l) }));
    assert.equal(lstatSync(path.join(outDir, '.voice')).isDirectory(), true);
    assert.equal(path.dirname(made.dir), path.join(outDir, '.voice'));
    assert.equal(lines.filter((l) => l.includes(TRUST_MISS) && l.includes('.voice')).length, 1, lines.join('\n'));
  });
});

test('a voice.json over the size cap is a miss, never read whole (final review V1)', async () => {
  assert.equal(SIDECAR_MAX_BYTES, 4 * 1024 * 1024);
  await withScratch((outDir) => missAfter(outDir, (dir) => {
    const file = path.join(dir, 'voice.json');
    writeFileSync(file, `${readFileSync(file, 'utf8')}${' '.repeat(SIDECAR_MAX_BYTES)}`); // still a valid sidecar, padded past the cap
  }));
});

test('readSidecar refuses a FIFO without waiting on it, and a symlink without following it (final review V1, V4)', { timeout: 10000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('no FIFOs'); return; }
  await withScratch(async (outDir) => {
    const fifo = path.join(outDir, 'voice.json');
    assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
    assert.throws(() => readSidecar(fifo), (err) => err instanceof SidecarError && /not a regular file/.test(err.message));
    const real = path.join(outDir, 'real.json');
    writeFileSync(real, '{}');
    const link = path.join(outDir, 'link.json');
    symlinkSync(real, link);
    assert.throws(() => readSidecar(link), (err) => err instanceof SidecarError);
    assert.deepEqual(readSidecar(real), {});
  });
});

test('a shot WAV that is a FIFO is a miss, found without opening it', { timeout: 10000 }, async (t) => {
  if (process.platform === 'win32') { t.skip('no FIFOs'); return; }
  await withScratch((outDir) => missAfter(outDir, (dir) => {
    rmSync(path.join(dir, 'shot-0.wav'));
    assert.equal(spawnSync('mkfifo', [path.join(dir, 'shot-0.wav')]).status, 0);
  }));
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

// ---------- interruption (an AbortSignal) ----------

const aborted = () => {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
};
const isInterruption = (err) => {
  assert.deepEqual([err.name, err.kind], ['AbortError', undefined], 'an interruption, never film or machine trouble');
  return true;
};

test('an already aborted signal: nothing is checked, downloaded or spawned, and the call rejects with an AbortError', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    let ensured = 0;
    const ensureModel = async () => { ensured += 1; };
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, ensureModel, signal: aborted() })), isInterruption);
    assert.deepEqual([fake.calls.length, ensured], [0, 0]);
    assert.equal(existsSync(path.join(outDir, '.voice')), false, 'not even a staging folder');
  });
});

test('a cache hit is unaffected by an aborted signal', async () => {
  await withScratch(async (outDir) => {
    const fake = fakeSpawn();
    const first = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn }));
    const again = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, signal: aborted() }));
    assert.deepEqual([again.cached, again.sidecar, fake.calls.length], [true, first.sidecar, 1]);
  });
});

test('an abort during the model check rejects at once with an AbortError, and no worker starts', async () => {
  await withScratch(async (outDir) => {
    const controller = new AbortController();
    const fake = fakeSpawn();
    const ensureModel = () => {
      setImmediate(() => controller.abort());
      return new Promise(() => {});
    };
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, ensureModel, signal: controller.signal })), isInterruption);
    assert.equal(fake.calls.length, 0);
  });
});

test('an abort while the worker runs kills it once, removes the staging folder and rejects with an AbortError', async () => {
  await withScratch(async (outDir) => {
    const controller = new AbortController();
    let child = null;
    const spawn = () => {
      child = fakeChild();
      setImmediate(() => controller.abort());
      return child;
    };
    await assert.rejects(synthesiseFilm(FILM, opts(outDir, { spawn, signal: controller.signal })), isInterruption);
    assert.deepEqual(child.kills, ['SIGKILL']);
    assert.deepEqual(voiceFolder(outDir), [], 'no staging folder, no job file, no entry');
    child.finish(null, 'SIGKILL');
  });
});

test('an abort after a successful run has no effect: the entry stays and the next call is a cache hit', async () => {
  await withScratch(async (outDir) => {
    const controller = new AbortController();
    const fake = fakeSpawn();
    const made = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn, signal: controller.signal }));
    controller.abort();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(fake.calls[0].child.kills, [], 'a finished worker is not killed');
    const again = await synthesiseFilm(FILM, opts(outDir, { spawn: fake.spawn }));
    assert.deepEqual([made.cached, again.cached, fake.calls.length], [false, true, 1]);
  });
});

test('synthesiseFilm refuses a signal that is not an AbortSignal', async () => {
  await assert.rejects(synthesiseFilm(FILM, opts(os.tmpdir(), { signal: { aborted: false } })), /signal/);
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
