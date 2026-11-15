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
import {
  closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
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
import { SIDECAR_FILE, SIDECAR_VERSION, SidecarError, readSidecar, validateSidecar } from './sidecar.mjs';
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
const FS_HINT = 'check that the output folder is writable and the disk has space, then run again';
/** A staging folder older than this (by mtime) belongs to a run that died, and is removed when a run starts. */
export const STALE_STAGING_MS = 60 * 60 * 1000;
// A killed worker that has still not closed after this long is given up on (a SIGKILL ends a process at once).
const KILL_GRACE_MS = 10 * 1000;
const STAGING_RE = /^[0-9a-f]{64}\.partial-\d+-[0-9a-f-]{36}$/;

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

// The code hash, read afresh for each run (eight small files), so a long-lived process that sees a source edit never
// files new output under the old code's key.
const codeHash = () => sourceHash(CODE_FILES);

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

// Why a shot's WAV is not complete (missing, a header that disagrees with the sidecar, or a body shorter or longer
// than its header), or null.
function wavProblem(dir, shot) {
  if (shot.wav === null) return null;
  const file = path.join(dir, shot.wav);
  if (!existsSync(file)) return `${shot.wav} is missing`;
  const expected = Math.round(shot.seconds * SAMPLE_RATE);
  const samples = wavSamples(file);
  if (samples !== expected) return `${shot.wav} holds ${samples} samples, the sidecar says ${expected}`;
  const bytes = statSync(file).size;
  const wanted = WAV_HEADER_BYTES + expected * BYTES_PER_SAMPLE;
  return bytes === wanted ? null : `${shot.wav} is ${bytes} bytes, its header says ${wanted}`;
}

// Whether an error reading an entry means the entry is incomplete (a missing file, a sidecar that is not JSON or does
// not match the film) rather than trouble reading it (permissions, a folder where a file should be, a full table).
function isIncomplete(err) {
  const code = err?.cause?.code ?? err?.code;
  return err instanceof SidecarError ? code === undefined || code === 'ENOENT' : code === 'ENOENT';
}

// { sidecar } when the entry in `dir` is complete and matches the film, else { problem }. Trouble reading it is
// machine trouble, not a reason to throw the entry away.
function readEntry(dir, film) {
  try {
    const sidecar = validateSidecar(readSidecar(path.join(dir, SIDECAR_FILE)), film);
    const problem = sidecar.shots.map((shot) => wavProblem(dir, shot)).find((p) => p !== null);
    return problem === undefined ? { sidecar } : { problem };
  } catch (err) {
    if (isIncomplete(err)) return { problem: err.message };
    throw machine(`the voice cache entry ${dir} cannot be read: ${err.message}`, FS_HINT, { cause: err });
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
  fsStep(`remove the incomplete cache entry ${dir}`, () => rmSync(dir, { recursive: true, force: true }));
  return null;
}

// Runs a file-system step of the parent; a failure (no permission, a full disk, a file where a folder should be) is
// machine trouble that says which step failed.
function fsStep(what, fn) {
  try {
    return fn();
  } catch (err) {
    throw machine(`voice: could not ${what}: ${String(err?.message ?? err).split('\n')[0]}`, FS_HINT, { cause: err });
  }
}

const isStaging = (name) => STAGING_RE.test(name);

// Removes staging folders in `cacheRoot` older than STALE_STAGING_MS by their mtime: leftovers of a run whose
// make.mjs died (a crash, SIGKILL) before its own cleanup. Housekeeping only: nothing here reaches the sidecar.
function sweepStaleStaging(cacheRoot, log) {
  const now = Date.now();
  for (const name of readdirSync(cacheRoot)) {
    const folder = path.join(cacheRoot, name);
    if (!isStaging(name) || now - statSync(folder).mtimeMs <= STALE_STAGING_MS) continue;
    log(`voice: removing ${folder}, left by an earlier run that did not finish`);
    rmSync(folder, { recursive: true, force: true });
  }
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

// The worker's classified error from a stderr line, or null when that line is not one. A film error keeps the `shot`
// it names; machine trouble never carries one.
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

// The worker's error from its stderr tail: the last classified error line, wherever it is (a teardown warning or a
// late notice printed after it changes nothing); without one, machine trouble naming the exit and the last line.
function workerError(code, signal, tail) {
  const last = tail.at(-1);
  const marked = markedError([...tail].reverse().find((line) => line.startsWith(ERROR_MARKER)));
  if (marked) return new VoiceSynthError(marked.message, { ...marked, exitCode: code, signal });
  const what = signal ? `the voice worker was killed by ${signal}` : `the voice worker exited with code ${code}`;
  return machine(last ? `${what}: ${last}` : what, RERUN_HINT, { exitCode: code, signal });
}

/**
 * Runs the worker on `jobFile` through `spawn` (child_process.spawn's signature). Its stdout lines go to `log` as they
 * come. Resolves on exit 0; rejects with its classified error, or, when it has not finished after `timeoutSeconds`,
 * kills it (SIGKILL) and rejects with machine trouble that says so (`timedOut: true`). When `signal` aborts first, the
 * worker is killed (SIGKILL) and the call rejects with an AbortError; after the worker has finished, an abort does
 * nothing. After a kill the call waits for the worker to exit (at most KILL_GRACE_MS) before it rejects, so the
 * staging folder is never removed under a worker still writing into it; its later output is not logged.
 */
function runWorker(spawn, jobFile, { timeoutSeconds, log, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let killedFor = null;
    let timer = null;
    let grace = null;
    let child = null;
    const tail = [];
    const keepTail = (line) => {
      tail.push(line);
      if (tail.length > STDERR_TAIL_LINES) tail.shift();
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      fn(value);
    };
    // Kills the worker; the call rejects with `error` once it has exited.
    const killFor = (error) => {
      if (settled || killedFor) return;
      killedFor = error;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      child.kill('SIGKILL');
      grace = setTimeout(() => settle(reject, killedFor), KILL_GRACE_MS);
    };
    function onAbort() {
      killFor(abortError(signal));
    }
    child = spawn(process.execPath, [WORKER_PATH, jobFile], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    const progress = (line) => {
      if (!settled && !killedFor) log(line);
    };
    const streamsDone = Promise.all([lineReader(child.stdout, progress), lineReader(child.stderr, keepTail)]);
    timer = setTimeout(() => {
      const hint = `run again; a long film may need a larger timeoutSeconds than ${timeoutSeconds}`;
      killFor(machine(`the voice worker did not finish within ${timeoutSeconds} s and was killed`, hint, { timedOut: true }));
    }, timeoutSeconds * MS_PER_SECOND);
    child.on('error', (err) => settle(reject, machine(`the voice worker could not start: ${err.message}`, RERUN_HINT, { cause: err })));
    child.on('close', (code, exitSignal) => {
      streamsDone.then(() => {
        if (killedFor) settle(reject, killedFor);
        else if (code === 0) settle(resolve);
        else settle(reject, workerError(code, exitSignal, tail));
      });
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

// Makes a fresh staging folder (unique name, created exclusively) with the job file in it (also exclusive), after
// sweeping stale staging folders. -> { staging, jobFile }.
function stage(dir, film, { voice, runtime, modelDir, log }) {
  const cacheRoot = path.dirname(dir);
  fsStep(`create ${cacheRoot}`, () => mkdirSync(cacheRoot, { recursive: true }));
  fsStep(`clear stale staging folders in ${cacheRoot}`, () => sweepStaleStaging(cacheRoot, log));
  const staging = `${dir}.partial-${process.pid}-${randomUUID()}`;
  fsStep(`create ${staging}`, () => mkdirSync(staging));
  const { voiceSpeed, emphasisPause } = paceOf(film);
  const shots = film.shots.map((shot) => ({ id: shot.id, say: sayOf(shot) }));
  const job = { version: JOB_VERSION, dir: staging, shots, speed: voiceSpeed, emphasisPause, voice, runtime, modelDir };
  const jobFile = path.join(staging, 'job.json');
  try {
    fsStep(`write ${jobFile}`, () => writeFileSync(jobFile, `${JSON.stringify(job)}\n`, { flag: 'wx' }));
  } catch (err) {
    removeStaging(staging, log);
    throw err;
  }
  log(`voice: synthesising ${shots.filter((s) => s.say !== null).length} narrated shots`);
  return { staging, jobFile };
}

// Runs the worker in a fresh staging folder and publishes the folder as `dir`. The staging folder is removed on every
// path, an interruption included, and only once the worker has exited.
async function synthesiseInto(dir, film, { voice, runtime, modelDir, spawn, log, timeoutSeconds, signal }) {
  throwIfAborted(signal);
  const { staging, jobFile } = stage(dir, film, { voice, runtime, modelDir, log });
  try {
    await runWorker(spawn, jobFile, { timeoutSeconds, log, signal });
    fsStep(`publish ${staging} as ${dir}`, () => {
      rmSync(jobFile);
      publish(staging, dir);
    });
  } finally {
    removeStaging(staging, log);
  }
}

// Removes a staging folder. A failure is logged, not thrown, so it never replaces the error that ended the run; the
// folder is then swept by a later run once it is stale.
function removeStaging(staging, log) {
  try {
    rmSync(staging, { recursive: true, force: true });
  } catch (err) {
    log(`voice: could not remove ${staging} (${err.message}); a later run removes it once it is an hour old`);
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
