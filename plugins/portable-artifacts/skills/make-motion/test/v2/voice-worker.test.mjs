// The narration worker as a child process, its error classification, and real-model integration.
// The child-process tests need no model: the worker fails before loading one. The integration tests synthesise for
// real: they are skipped when neither MAKE_MOTION_VOICE_RUNTIME nor MAKE_MOTION_VOICE_MODEL is set and the default
// install or model is absent; when either variable is set they run, and a missing or incomplete folder fails them (a
// typo never turns into a green skip). No test downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SayError } from '../../engine/script/say.mjs';
import { ERROR_MARKER, INSTALL_HINT, classifyError } from '../../scripts/v2/voice/worker.mjs';
import { WORKER_PATH, synthesiseFilm } from '../../scripts/v2/voice/synth.mjs';
import { VoiceTextError } from '../../scripts/v2/voice/tokens.mjs';
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
});

// ---------- the worker as a child process (no model needed: it fails before loading one) ----------

function runWorker(job, dir) {
  const jobFile = path.join(dir, 'job.json');
  writeFileSync(jobFile, JSON.stringify(job));
  return new Promise((resolve) => {
    execFile(process.execPath, [WORKER_PATH, jobFile], (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
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
