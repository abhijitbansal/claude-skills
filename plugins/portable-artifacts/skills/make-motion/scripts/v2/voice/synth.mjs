// A film's narration as WAVs and a sidecar of word times, cached by a hash of everything that shapes them.
// Files live in <outDir>/.voice/<hash>/: voice.json (the sidecar) and shot-<index>.wav per narrated shot. A hit reads
// and validates the sidecar and spawns nothing. A miss writes a job file and runs `node worker.mjs <job.json>` through
// execFile (an argument array, never a shell; the film's text is only ever inside the job file). This process never
// imports the optional voice package: only the worker does.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/modes/index.mjs';
import { OPTIONAL_ROOT } from '../../lib/optional.mjs';
import { ASIDE_SPEED_FACTOR, MAX_IDS } from './calls.mjs';
import { MODEL_INFO, checkVoice } from './kokoro.mjs';
import { voiceModelDir } from './model.mjs';
import { SIDECAR_FILE, SIDECAR_VERSION, readSidecar, validateSidecar } from './sidecar.mjs';
import { JOB_VERSION, SILENCE_QUANTUM_SAMPLES, TRIM } from './worker.mjs';
import { END_CAP_FRAMES, FRAME_SAMPLES, LEAD, SAMPLE_RATE } from './words.mjs';

export const WORKER_PATH = fileURLToPath(new URL('./worker.mjs', import.meta.url));
export const CACHE_DIR = '.voice';
const DEFAULT_MODE = 'pro';
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const DEFAULT_TIMEOUT_SECONDS = 600;
const MS_PER_SECOND = 1000;

export class VoiceSynthError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'VoiceSynthError';
  }
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

// The film's mode's voice pace, from the modes registry (its own error for an unknown mode).
function paceOf(film) {
  const { voiceSpeed, emphasisPause } = registries.modes.get(film.mode ?? DEFAULT_MODE);
  return { voiceSpeed, emphasisPause };
}

const sayOf = (shot) => shot.say ?? null;

/**
 * SHA-256 hex of a canonical JSON (keys sorted) of what shapes the sidecar: each shot's id and say in order, the mode's
 * voiceSpeed and emphasisPause, the voice name, the model hash, the lead constants, the pad-trim settings (`trim`,
 * default worker.mjs TRIM) and the other timing constants.
 */
export function voiceHash(film, { voice, modelSha256, lead = LEAD, trim = TRIM }) {
  const input = {
    sidecarVersion: SIDECAR_VERSION,
    voice,
    modelSha256,
    pace: paceOf(film),
    timing: {
      lead,
      trim,
      frameSamples: FRAME_SAMPLES,
      sampleRate: SAMPLE_RATE,
      endCapFrames: END_CAP_FRAMES,
      asideSpeedFactor: ASIDE_SPEED_FACTOR,
      maxIds: MAX_IDS,
      silenceQuantumSamples: SILENCE_QUANTUM_SAMPLES,
    },
    shots: film.shots.map((shot) => ({ id: shot.id, say: sayOf(shot) })),
  };
  return createHash('sha256').update(JSON.stringify(sortKeys(input))).digest('hex');
}

// The sidecar in `dir`, validated against the film, with every WAV it names present.
function readValid(dir, film) {
  try {
    const sidecar = validateSidecar(readSidecar(path.join(dir, SIDECAR_FILE)), film);
    const missing = sidecar.shots.find((shot) => shot.wav !== null && !existsSync(path.join(dir, shot.wav)));
    if (missing) throw new VoiceSynthError(`shots: ${missing.wav} is missing`);
    return sidecar;
  } catch (err) {
    throw new VoiceSynthError(`the voice in ${dir} does not match the film: ${err.message}; delete that folder to synthesise it again`, { cause: err });
  }
}

const lastLine = (text) => text.split('\n').map((l) => l.trim()).filter((l) => l !== '').at(-1);

function workerError(err, stderr) {
  const error = new VoiceSynthError(lastLine(String(stderr ?? '')) ?? `the voice worker failed: ${err.message}`, { cause: err });
  return Object.assign(error, { exitCode: typeof err.code === 'number' ? err.code : null, timedOut: false });
}

/**
 * Runs the worker on `jobFile` through `spawn` (execFile's signature, returning the child). -> its stdout; rejects
 * with its last stderr line, or, when it has not finished after `timeoutSeconds`, kills it (SIGKILL) and rejects with
 * an error that says so (`timedOut: true`).
 */
function runWorker(spawn, jobFile, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const child = spawn(process.execPath, [WORKER_PATH, jobFile], { maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (err, stdout, stderr) => {
      if (err) settle(reject, workerError(err, stderr));
      else settle(resolve, String(stdout ?? ''));
    });
    if (settled) return;
    timer = setTimeout(() => {
      child?.kill?.('SIGKILL');
      const error = new VoiceSynthError(`the voice worker did not finish within ${timeoutSeconds} s and was killed`);
      settle(reject, Object.assign(error, { exitCode: null, timedOut: true }));
    }, timeoutSeconds * MS_PER_SECOND);
  });
}

const OPTIONS = Object.freeze(['outDir', 'voice', 'spawn', 'log', 'runtime', 'modelDir', 'offline', 'timeoutSeconds']);

function checkOptions(options) {
  const unknown = Object.keys(options).filter((key) => !OPTIONS.includes(key));
  if (unknown.length > 0) throw new TypeError(`synthesiseFilm: unknown option ${unknown.join(', ')} (accepted: ${OPTIONS.join(', ')})`);
  if (typeof options.outDir !== 'string' || options.outDir === '') throw new TypeError('synthesiseFilm: outDir must be a folder path');
  const { timeoutSeconds } = options;
  if (timeoutSeconds !== undefined && !(Number.isFinite(timeoutSeconds) && timeoutSeconds > 0)) {
    throw new TypeError(`synthesiseFilm: timeoutSeconds must be a positive number of seconds, got ${String(timeoutSeconds)}`);
  }
  checkVoice(options.voice);
}

/**
 * The film's narration. -> Promise<{ dir, sidecar, cached }>. Options: `outDir` (the cache goes in <outDir>/.voice/),
 * `voice` ('af_heart'), `spawn` (execFile's signature; a test seam), `log(line)`, and the worker's two locations,
 * `runtime` (the optional voice package folder, default <skill>/optional/voice) and `modelDir` (default the model's
 * cache folder), `offline` (true: the worker refuses to download a missing model file) and `timeoutSeconds` (default
 * DEFAULT_TIMEOUT_SECONDS: after that the worker is killed and the call rejects with `timedOut: true`).
 */
export async function synthesiseFilm(film, options = {}) {
  checkOptions(options);
  const { outDir, voice, spawn = execFile, log = () => {}, timeoutSeconds = DEFAULT_TIMEOUT_SECONDS } = options;
  const dir = path.join(outDir, CACHE_DIR, voiceHash(film, { voice, modelSha256: MODEL_INFO.sha256, lead: LEAD }));
  if (existsSync(path.join(dir, SIDECAR_FILE))) {
    log(`voice: cached in ${dir}`);
    return { dir, sidecar: readValid(dir, film), cached: true };
  }
  mkdirSync(dir, { recursive: true });
  const { voiceSpeed, emphasisPause } = paceOf(film);
  const job = {
    version: JOB_VERSION,
    dir,
    shots: film.shots.map((shot) => ({ id: shot.id, say: sayOf(shot) })),
    speed: voiceSpeed,
    emphasisPause,
    voice,
    runtime: options.runtime ?? path.join(OPTIONAL_ROOT, 'voice'),
    modelDir: options.modelDir ?? voiceModelDir(),
    offline: options.offline ?? false,
  };
  const jobFile = path.join(dir, `job-${process.pid}.json`);
  writeFileSync(jobFile, `${JSON.stringify(job)}\n`);
  log(`voice: synthesising ${job.shots.filter((s) => s.say !== null).length} narrated shots`);
  try {
    const stdout = await runWorker(spawn, jobFile, timeoutSeconds);
    stdout.split('\n').filter((line) => line.trim() !== '').forEach((line) => log(line));
  } finally {
    rmSync(jobFile, { force: true });
  }
  return { dir, sidecar: readValid(dir, film), cached: false };
}
