// A film's narration as WAVs and a sidecar of word times, cached by a hash of everything that shapes them.
// Files live in <outDir>/.voice/<hash>/: voice.json (the sidecar) and shot-<index>.wav per shot with sound.
// A hit reads and checks the entry and starts nothing; a corrupt or incomplete entry is removed and made again.
// A miss fetches and checks the pinned model here, then runs `node worker.mjs <job.json>` through spawn (an argument
// array, never a shell; the film's text is only ever inside the job file) in a staging folder of its own, which is
// renamed into place when the worker succeeds and removed on every other path. This process never imports the
// optional voice package: only the worker does.
//
// Failures reject with a VoiceSynthError carrying `kind` ('film': the author fixes the narration; 'machine': the
// package, the runtime, the model, a timeout or this machine) and a one-line `hint`; a film error that belongs to one
// shot also carries `shot`, that shot's id.
import { spawn as spawnChild } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { registries } from '../../../engine/registry.mjs';
import { VOICE_SPEED_MAX, VOICE_SPEED_MIN } from '../../../engine/modes/index.mjs';
import { optionalInstall } from '../../lib/doctor-hint.mjs';
import { OPTIONAL_ROOT } from '../../lib/optional.mjs';
import { ASIDE_SPEED_FACTOR, MAX_IDS } from './calls.mjs';
import { STYLE_DIM, checkVoice } from './kokoro.mjs';
import { VOICE_MODEL, ensureVoiceModel, voiceModelDir } from './model.mjs';
import { SIDECAR_FILE, SIDECAR_VERSION, readSidecar, validateSidecar } from './sidecar.mjs';
import { ERROR_MARKER, INSTALL_HINT, JOB_VERSION, SILENCE_QUANTUM_SAMPLES, TRIM } from './worker.mjs';
import { END_CAP_FRAMES, FRAME_SAMPLES, LEAD, SAMPLE_RATE } from './words.mjs';

const VOICE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKER_PATH = path.join(VOICE_DIR, 'worker.mjs');
/** The sources whose bytes shape the sidecar and the WAVs: every voice module the worker loads, and say.mjs. */
export const CODE_FILES = Object.freeze([
  ...['words', 'calls', 'phonemes', 'tokens', 'kokoro', 'worker', 'sidecar'].map((name) => path.join(VOICE_DIR, `${name}.mjs`)),
  path.resolve(VOICE_DIR, '../../../engine/script/say.mjs'),
]);
/** Every constant from outside those sources that reaches the audio or the times (theirs are in the code hash too). */
export const HASH_CONSTANTS = Object.freeze({
  lead: LEAD,
  trim: TRIM,
  frameSamples: FRAME_SAMPLES,
  sampleRate: SAMPLE_RATE,
  endCapFrames: END_CAP_FRAMES,
  asideSpeedFactor: ASIDE_SPEED_FACTOR,
  maxIds: MAX_IDS,
  silenceQuantumSamples: SILENCE_QUANTUM_SAMPLES,
  styleDim: STYLE_DIM,
  voiceSpeedMin: VOICE_SPEED_MIN,
  voiceSpeedMax: VOICE_SPEED_MAX,
});
/** The pinned model as the key sees it: the repo, the commit and every file's SHA-256. */
export const MODEL_PIN = Object.freeze({
  id: VOICE_MODEL.id,
  commit: VOICE_MODEL.commit,
  files: Object.freeze(VOICE_MODEL.files.map(({ path: file, sha256 }) => Object.freeze({ path: file, sha256 }))),
});
export const CACHE_DIR = '.voice';
export const DEFAULT_TIMEOUT_SECONDS = 600;
const DEFAULT_MODE = 'pro';
const MS_PER_SECOND = 1000;
const STDERR_TAIL_LINES = 20;
const WAV_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const RERUN_HINT = `run again; if it repeats, reinstall the voice package: ${optionalInstall('kokoro')}`;

export class VoiceSynthError extends Error {
  constructor(message, { kind, hint, shot, exitCode = null, signal = null, timedOut = false, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    Object.assign(this, { name: 'VoiceSynthError', kind, hint, exitCode, signal, timedOut });
    if (shot !== undefined) this.shot = shot;
  }
}

const machine = (message, hint, extra = {}) => new VoiceSynthError(message, { kind: 'machine', hint, ...extra });

// An interruption: name 'AbortError' and no `kind`, so a caller never takes it for film or machine trouble.
const abortError = (signal) => Object.assign(new Error('voice synthesis was interrupted'), { name: 'AbortError', cause: signal.reason });
const throwIfAborted = (signal) => {
  if (signal?.aborted) throw abortError(signal);
};

// `promise`, or an AbortError as soon as `signal` aborts (the promise's own outcome is then ignored).
function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

/** SHA-256 hex over the files' names and the SHA-256 of their bytes, in order. */
export function sourceHash(files) {
  const hash = createHash('sha256');
  for (const file of files) hash.update(`${path.basename(file)}\0${sha256Hex(readFileSync(file))}\n`);
  return hash.digest('hex');
}

let codeSha256 = null;
// The code hash of this run, computed once.
const codeHash = () => {
  codeSha256 ??= sourceHash(CODE_FILES);
  return codeSha256;
};

// The film's mode's voice pace, from the modes registry (its own error for an unknown mode).
function paceOf(film) {
  const { voiceSpeed, emphasisPause } = registries.modes.get(film.mode ?? DEFAULT_MODE);
  return { voiceSpeed, emphasisPause };
}

const sayOf = (shot) => shot.say ?? null;

/**
 * SHA-256 hex of a canonical JSON (keys sorted) of everything that shapes the sidecar: each shot's id and say in
 * order, the mode's voiceSpeed and emphasisPause, the voice name, `code` (the code hash; default the CODE_FILES of
 * this run), `runtimeLock` (the SHA-256 of the runtime's package-lock.json: phonemizer, eSpeak data, onnxruntime),
 * `model` (default MODEL_PIN, every pinned file) and `constants` (default HASH_CONSTANTS).
 */
export function voiceHash(film, { voice, runtimeLock, code = codeHash(), model = MODEL_PIN, constants = HASH_CONSTANTS }) {
  if (!SHA256_HEX.test(String(runtimeLock))) throw new TypeError('voiceHash: runtimeLock must be the SHA-256 hex of the runtime lockfile');
  const input = {
    sidecarVersion: SIDECAR_VERSION,
    voice,
    pace: paceOf(film),
    code,
    runtimeLock,
    model,
    constants,
    shots: film.shots.map((shot) => ({ id: shot.id, say: sayOf(shot) })),
  };
  return createHash('sha256').update(JSON.stringify(sortKeys(input))).digest('hex');
}

// The SHA-256 of the runtime folder's lockfile; machine trouble with the install hint when there is none.
function lockHash(runtime) {
  const file = path.join(runtime, 'package-lock.json');
  if (!existsSync(file)) throw machine(`${file} is missing, so the optional voice package cannot be used`, INSTALL_HINT);
  return sha256Hex(readFileSync(file));
}

// The sample count in a 16-bit WAV's header, or -1 when the file has no data chunk where encodeWav puts it.
function wavSamples(file) {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const fd = openSync(file, 'r');
  try {
    const read = readSync(fd, header, 0, WAV_HEADER_BYTES, 0);
    return read === WAV_HEADER_BYTES && header.toString('ascii', 36, 40) === 'data' ? header.readUInt32LE(40) / BYTES_PER_SAMPLE : -1;
  } finally {
    closeSync(fd);
  }
}

function wavProblem(dir, shot) {
  if (shot.wav === null) return null;
  const file = path.join(dir, shot.wav);
  if (!existsSync(file)) return `${shot.wav} is missing`;
  const expected = Math.round(shot.seconds * SAMPLE_RATE);
  const samples = wavSamples(file);
  return samples === expected ? null : `${shot.wav} holds ${samples} samples, the sidecar says ${expected}`;
}

// { sidecar } when the entry in `dir` is complete and matches the film, else { problem }.
function readEntry(dir, film) {
  try {
    const sidecar = validateSidecar(readSidecar(path.join(dir, SIDECAR_FILE)), film);
    const problem = sidecar.shots.map((shot) => wavProblem(dir, shot)).find((p) => p !== null);
    return problem === undefined ? { sidecar } : { problem };
  } catch (err) {
    return { problem: err.message };
  }
}

// The cached sidecar, or null on a miss. A corrupt or incomplete entry is logged once and removed: it is this
// module's own cache and can always be made again.
function cachedSidecar(dir, film, log) {
  if (!existsSync(dir)) return null;
  const { sidecar, problem } = readEntry(dir, film);
  if (sidecar) {
    log(`voice: cached in ${dir}`);
    return sidecar;
  }
  log(`voice: the cache entry ${dir} is incomplete (${problem}); removing it and synthesising again`);
  rmSync(dir, { recursive: true, force: true });
  return null;
}

const refuseDownload = () => Promise.reject(new Error('offline: no model file is downloaded'));

// Fetches (unless offline) and checks the pinned model before the worker starts, so the timeout covers synthesis only.
async function ensureModelFirst(ensureModel, dir, offline, log) {
  try {
    await ensureModel({ dir, log, ...(offline ? { fetchImpl: refuseDownload } : {}) });
  } catch (err) {
    const hint = offline
      ? `run once without offline so the pinned voice model is fetched into ${dir}`
      : `check the connection and run again; a file that keeps failing its pinned hash can be deleted from ${dir} so it is fetched again`;
    throw machine(String(err?.message ?? err).split('\n')[0], hint, { cause: err });
  }
}

const lineReader = (stream, onLine) => {
  const reader = createInterface({ input: stream });
  reader.on('line', (line) => {
    if (line.trim() !== '') onLine(line);
  });
  return once(reader, 'close');
};

// The worker's classified error from its last stderr line, or null when that line is not one. A film error keeps the
// `shot` it names; machine trouble never carries one.
function markedError(line) {
  if (!line?.startsWith(ERROR_MARKER)) return null;
  try {
    const { kind, message, hint, shot } = JSON.parse(line.slice(ERROR_MARKER.length));
    if (typeof message !== 'string') return null;
    const marked = { kind: kind === 'film' ? 'film' : 'machine', message, hint: String(hint ?? RERUN_HINT) };
    return marked.kind === 'film' && typeof shot === 'string' ? { ...marked, shot } : marked;
  } catch {
    return null;
  }
}

function workerError(code, signal, tail) {
  const last = tail.at(-1);
  const marked = markedError(last);
  if (marked) return new VoiceSynthError(marked.message, { ...marked, exitCode: code, signal });
  const what = signal ? `the voice worker was killed by ${signal}` : `the voice worker exited with code ${code}`;
  return machine(last ? `${what}: ${last}` : what, RERUN_HINT, { exitCode: code, signal });
}

/**
 * Runs the worker on `jobFile` through `spawn` (child_process.spawn's signature). Its stdout lines go to `log` as they
 * come. Resolves on exit 0; rejects with its classified error, or, when it has not finished after `timeoutSeconds`,
 * kills it (SIGKILL) and rejects with machine trouble that says so (`timedOut: true`). When `signal` aborts first, the
 * worker is killed (SIGKILL) and the call rejects with an AbortError; after the worker has finished, an abort does
 * nothing.
 */
function runWorker(spawn, jobFile, { timeoutSeconds, log, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    let child = null;
    const tail = [];
    const keepTail = (line) => {
      tail.push(line);
      if (tail.length > STDERR_TAIL_LINES) tail.shift();
    };
    const onAbort = () => {
      if (settled) return;
      child.kill('SIGKILL');
      settle(reject, abortError(signal));
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    child = spawn(process.execPath, [WORKER_PATH, jobFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    const streamsDone = Promise.all([lineReader(child.stdout, log), lineReader(child.stderr, keepTail)]);
    timer = setTimeout(() => {
      child.kill('SIGKILL');
      const hint = `run again; a long film may need a larger timeoutSeconds than ${timeoutSeconds}`;
      settle(reject, machine(`the voice worker did not finish within ${timeoutSeconds} s and was killed`, hint, { timedOut: true }));
    }, timeoutSeconds * MS_PER_SECOND);
    child.on('error', (err) => settle(reject, machine(`the voice worker could not start: ${err.message}`, RERUN_HINT, { cause: err })));
    child.on('close', (code, signal) => {
      streamsDone.then(() => (code === 0 ? settle(resolve) : settle(reject, workerError(code, signal, tail))));
    });
  });
}

// Moves the finished staging folder into place. When a concurrent run published the same entry first, its entry is
// kept (it is checked like any other).
function publish(staging, dir) {
  try {
    renameSync(staging, dir);
  } catch (err) {
    if (err.code !== 'ENOTEMPTY' && err.code !== 'EEXIST') throw err;
  }
}

// Runs the worker in a fresh staging folder (unique name, created exclusively, as is the job file in it) and
// publishes the folder as `dir`. The staging folder is removed on every path, an interruption included.
async function synthesiseInto(dir, film, { voice, runtime, modelDir, spawn, log, timeoutSeconds, signal }) {
  throwIfAborted(signal);
  mkdirSync(path.dirname(dir), { recursive: true });
  const staging = `${dir}.partial-${process.pid}-${randomUUID()}`;
  mkdirSync(staging);
  try {
    const { voiceSpeed, emphasisPause } = paceOf(film);
    const shots = film.shots.map((shot) => ({ id: shot.id, say: sayOf(shot) }));
    const job = { version: JOB_VERSION, dir: staging, shots, speed: voiceSpeed, emphasisPause, voice, runtime, modelDir };
    const jobFile = path.join(staging, 'job.json');
    writeFileSync(jobFile, `${JSON.stringify(job)}\n`, { flag: 'wx' });
    log(`voice: synthesising ${shots.filter((s) => s.say !== null).length} narrated shots`);
    await runWorker(spawn, jobFile, { timeoutSeconds, log, signal });
    rmSync(jobFile);
    publish(staging, dir);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const OPTIONS = Object.freeze(['outDir', 'voice', 'spawn', 'log', 'runtime', 'modelDir', 'offline', 'timeoutSeconds', 'ensureModel', 'signal']);
const isAbortSignal = (signal) => typeof signal?.aborted === 'boolean' && typeof signal.addEventListener === 'function'
  && typeof signal.removeEventListener === 'function';

function checkOptions(options) {
  const unknown = Object.keys(options).filter((key) => !OPTIONS.includes(key));
  if (unknown.length > 0) throw new TypeError(`synthesiseFilm: unknown option ${unknown.join(', ')} (accepted: ${OPTIONS.join(', ')})`);
  if (typeof options.outDir !== 'string' || options.outDir === '') throw new TypeError('synthesiseFilm: outDir must be a folder path');
  const { timeoutSeconds } = options;
  if (timeoutSeconds !== undefined && !(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)) {
    throw new TypeError(`synthesiseFilm: timeoutSeconds must be a positive number of seconds, got ${String(timeoutSeconds)}`);
  }
  if (options.signal !== undefined && !isAbortSignal(options.signal)) throw new TypeError('synthesiseFilm: signal must be an AbortSignal');
  checkVoice(options.voice);
}

/**
 * The film's narration. -> Promise<{ dir, sidecar, cached }>. Options: `outDir` (the cache goes in <outDir>/.voice/),
 * `voice` ('af_heart'), `log(line)`, `runtime` (the optional voice package folder, default <skill>/optional/voice) and
 * `modelDir` (default the model's cache folder), `offline` (true: a missing model file is not downloaded),
 * `timeoutSeconds` (default DEFAULT_TIMEOUT_SECONDS, synthesis only), `signal` (an AbortSignal) and two test seams:
 * `spawn` (child_process.spawn's signature) and `ensureModel` (ensureVoiceModel's). Rejects with a VoiceSynthError
 * ({ kind, hint, shot?, exitCode, signal, timedOut }); option mistakes are TypeErrors.
 * Interruption: a cache hit is returned whatever the signal. Otherwise an already aborted signal checks, downloads and
 * spawns nothing; an abort during the model check rejects at once (a download already under way may still finish into
 * the model folder: the download code takes no signal); an abort while the worker runs kills it and removes the
 * staging folder. Each rejects with an Error named 'AbortError' that has no `kind`.
 */
export async function synthesiseFilm(film, options = {}) {
  checkOptions(options);
  const { outDir, voice, log = () => {}, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS, signal } = options;
  const { spawn = spawnChild, ensureModel = ensureVoiceModel } = options;
  const runtime = options.runtime ?? path.join(OPTIONAL_ROOT, 'voice');
  const modelDir = options.modelDir ?? voiceModelDir();
  const dir = path.join(outDir, CACHE_DIR, voiceHash(film, { voice, runtimeLock: lockHash(runtime) }));
  const cached = cachedSidecar(dir, film, log);
  if (cached) return { dir, sidecar: cached, cached: true };
  throwIfAborted(signal);
  await untilAborted(ensureModelFirst(ensureModel, modelDir, options.offline ?? false, log), signal);
  await synthesiseInto(dir, film, { voice, runtime, modelDir, spawn, log, timeoutSeconds, signal });
  const made = readEntry(dir, film);
  if (!made.sidecar) throw machine(`the voice worker finished, but its output in ${dir} is incomplete: ${made.problem}`, RERUN_HINT);
  return { dir, sidecar: made.sidecar, cached: false };
}
