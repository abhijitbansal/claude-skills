// The child process that synthesises a film's narration: `node worker.mjs <job.json>`.
// It runs apart from make.mjs because the phonemizer (an Emscripten build of eSpeak NG) installs a process-wide
// uncaughtException hook (spike report, open risk 9); here that hook can only affect this process.
//
// It loads the optional voice package through importOptional (INSTALL_HINT: version 2 wording, version 1's install
// command), re-checks the pinned model offline (make.mjs fetched and checked it before starting the worker), then for
// each narrated shot plans the calls, runs them, concatenates the waveforms and the silences, maps the model's
// durations to word times, and writes one 24 kHz mono 16-bit WAV per shot that has sound. The job's folder is a
// staging folder of this run alone; the sidecar is written last, and make.mjs renames the folder into the cache.
// No silence is added between shots.
//
// Progress goes to stdout, line by line. On failure the last stderr line is ERROR_MARKER followed by JSON
// { kind, message, hint }: kind 'film' (exit 1: the narration cannot be spoken as written; the author fixes the say)
// or 'machine' (exit 2: the package, the runtime, the model, the job or this machine; the hint says what to do).
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SayError, parseSay } from '../../../engine/script/say.mjs';
import { importOptional } from '../../lib/optional.mjs';
import { optionalInstall } from '../../lib/doctor-hint.mjs';
import { UsageError } from '../../lib/spec.mjs';
import { MODEL_INFO, checkVoice, openKokoro, planShotCalls } from './kokoro.mjs';
import { ensureVoiceModel } from './model.mjs';
import { SIDECAR_FILE, SIDECAR_VERSION, roundTime, sentencesOf, wavName, writeSidecar } from './sidecar.mjs';
import { VoiceTextError, loadVocab } from './tokens.mjs';
import { FRAME_SAMPLES, SAMPLE_RATE, framesOf, wordTimes } from './words.mjs';

/** Silences are whole milliseconds, so a shot's length is exact at the sidecar's 1e-4 s (model audio is 600-sample frames). */
export const SILENCE_QUANTUM_SAMPLES = SAMPLE_RATE / 1000;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
/**
 * The lead pad is cut up to this long before the call's first word start (by the start rule). Measured onsets run at
 * most 31 ms before that start (.scratch/voice/pad-onset.mjs, 18 calls), so 75 ms keeps every onset.
 */
export const LEAD_KEEP_MS = 75;
const LEAD_KEEP_SAMPLES = LEAD_KEEP_MS * SAMPLES_PER_MS;
/** Linear fade in at the cut (5 ms), so a trim cannot click. */
export const FADE_SAMPLES = 5 * SAMPLES_PER_MS;
/** The pad-trim settings as one value: part of the cache hash (synth.mjs voiceHash), since they shape every WAV and time. */
export const TRIM = Object.freeze({ leadKeepSamples: LEAD_KEEP_SAMPLES, fadeSamples: FADE_SAMPLES });
export const JOB_VERSION = 1;
/** What is missing, in version 2 terms, then the same install command as version 1 (scripts/lib/voice.mjs). */
export const INSTALL_HINT = `the optional voice package is not installed. Run: ${optionalInstall('kokoro')}`;
/** The prefix of the worker's last stderr line on failure; JSON { kind, message, hint } follows it. */
export const ERROR_MARKER = 'voice-error ';
const RUNTIME_PACKAGE = 'onnxruntime-node';
const EXIT_FILM = 1;
const EXIT_MACHINE = 2;
const WAV_HEADER_BYTES = 44;
const PCM_MAX = 32767;
const PCM_MIN = -32768;
const REINSTALL = `reinstall the voice package: ${optionalInstall('kokoro')}`;
const FILM_HINT = 'change the narration of that shot and run again';
// A one-line hint for machine trouble by the stage the worker was in when it failed.
const STAGE_HINTS = Object.freeze({
  job: 'make.mjs and its voice worker disagree about the job: they come from different versions of the skill; update it',
  runtime: `the voice runtime failed to load; ${REINSTALL}`,
  model: 'the voice model changed on disk after make.mjs checked it; run again',
  session: `onnxruntime could not open the voice model; ${REINSTALL}, or delete the model folder so it is fetched again`,
  synth: `voice synthesis failed on this machine; run again, and if it repeats, ${REINSTALL}`,
});

const silenceSamples = (seconds) => Math.round((seconds * SAMPLE_RATE) / SILENCE_QUANTUM_SAMPLES) * SILENCE_QUANTUM_SAMPLES;
const oneLine = (err) => String(err?.message ?? err).replace(/\s*\n\s*/g, ' ').trim();

/**
 * { kind, message, hint, shot? } for an error the worker stops on. A VoiceTextError or SayError is the film's
 * ('film'): the narration cannot be spoken as written; it carries `shot`, the id of the shot being made, when there
 * was one. Anything else is 'machine' (never at a shot): a UsageError (the package missing) carries the install hint,
 * and the rest a hint by `stage` (job, runtime, model, session, synth).
 */
export function classifyError(err, stage, shot) {
  if (err instanceof VoiceTextError || err instanceof SayError) {
    const film = { kind: 'film', message: oneLine(err), hint: FILM_HINT };
    return typeof shot === 'string' ? { ...film, shot } : film;
  }
  if (err instanceof UsageError) return { kind: 'machine', message: oneLine(err), hint: INSTALL_HINT };
  return { kind: 'machine', message: oneLine(err), hint: STAGE_HINTS[stage] ?? STAGE_HINTS.synth };
}

/** `samples` (floats in -1..1, clamped) as a mono 16-bit PCM WAV at `sampleRate`. */
export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buf = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(WAV_HEADER_BYTES - 8 + dataBytes, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // bytes per second
  buf.writeUInt16LE(2, 32); // bytes per frame
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  samples.forEach((s, i) => buf.writeInt16LE(Math.max(PCM_MIN, Math.min(PCM_MAX, Math.round(s * PCM_MAX))), WAV_HEADER_BYTES + i * 2));
  return buf;
}

// The model's output is trusted only when its frames add up to its waveform and every sample is a finite number (a
// NaN would otherwise be written as silence).
function checkOutput(shotId, frames, waveform) {
  const total = frames.reduce((a, b) => a + b, 0);
  if (total * FRAME_SAMPLES !== waveform.length) {
    throw new Error(`shot "${shotId}": the model's frames (${total} x ${FRAME_SAMPLES} samples) do not add up to its waveform (${waveform.length} samples), so its word times cannot be trusted`);
  }
  const bad = waveform.findIndex((s) => !Number.isFinite(s));
  if (bad >= 0) throw new Error(`shot "${shotId}": the model's waveform sample ${bad} is not a finite number`);
}

// A copy of `samples` with a linear fade in over FADE_SAMPLES.
function fadedIn(samples) {
  const out = Float32Array.from(samples);
  const n = Math.min(FADE_SAMPLES, out.length);
  for (let i = 0; i < n; i++) out[i] *= i / FADE_SAMPLES;
  return out;
}

/**
 * One call's waveform with its lead pad trimmed (team-lead ruling on Task 5, measured rule). Only the lead pad token
 * (id 0 at the front) is cut: up to LEAD_KEEP_MS before `firstStart` (the call's first word start by the start rule,
 * in untrimmed samples), never past the pad's end and never negative, with a FADE_SAMPLES fade in when anything is
 * cut. The voice starts up to 145 ms inside the lead pad (measured), so the cut follows the word, not a fixed length.
 * The tail pad, and every space and punctuation token (the model's own pause at a comma or full stop), are left as
 * they are. -> { samples, cutFront } (the samples removed in front, to shift word times by).
 */
export function trimPads(waveform, frames, firstStart) {
  const padSamples = frames[0] * FRAME_SAMPLES;
  const cutFront = Math.max(0, Math.min(firstStart - LEAD_KEEP_SAMPLES, padSamples));
  const kept = waveform.subarray(cutFront);
  return { samples: cutFront > 0 ? fadedIn(kept) : Float32Array.from(kept), cutFront };
}

// One speech call: the trimmed waveform and its say tokens' { start, end } in samples from the trimmed call's first
// sample. Times are computed on the untrimmed frames (the start rule reads the real pad length), then shifted.
async function speakCall(item, { shotId, speak, log }) {
  if (item.input.dropped.length > 0) log(`shot "${shotId}": dropped phoneme characters outside the model's vocab: ${item.input.dropped.map((d) => d.char).join(' ')}`);
  const { waveform, durations } = await speak({ ids: item.input.ids, speed: item.speed });
  const frames = framesOf(durations);
  checkOutput(shotId, frames, waveform);
  const untrimmed = wordTimes({ kept: item.input.kept, frames, spans: item.input.spans })
    .map((w) => ({ start: Math.round(w.start * SAMPLE_RATE), end: Math.round(w.end * SAMPLE_RATE) }));
  const { samples, cutFront } = trimPads(waveform, frames, Math.min(...untrimmed.map((w) => w.start)));
  return { waveform: samples, local: untrimmed.map((w) => ({ start: w.start - cutFront, end: w.end - cutFront })) };
}

// Runs the planned items in order: a silence becomes zeros, a skip adds nothing and gives its tokens zero-length times
// at the current offset, a speech call goes to the model. -> { chunks, length, times } where times[t] is say token t's
// { start, end } in samples from the shot's first sample.
async function speakItems(items, deps) {
  const chunks = [];
  const times = [];
  let offset = 0;
  for (const item of items) {
    const at = offset;
    if (item.kind === 'silence') {
      chunks.push(new Float32Array(silenceSamples(item.seconds)));
    } else if (item.kind === 'skip') {
      item.tokens.forEach((t) => { times[t] = { start: at, end: at }; });
    } else if (item.kind === 'speech') {
      const { waveform, local } = await speakCall(item, deps);
      item.tokens.forEach((t, k) => { times[t] = { start: at + local[k].start, end: at + local[k].end }; });
      chunks.push(waveform);
    } else {
      throw new TypeError(`shot "${deps.shotId}": unknown planned item kind ${JSON.stringify(item.kind)}`);
    }
    offset = chunks.reduce((n, c) => n + c.length, 0);
  }
  return { chunks, length: offset, times };
}

function concat(chunks, length) {
  const out = new Float32Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function tokensOf(shot) {
  try {
    return parseSay(shot.say).tokens;
  } catch (err) {
    if (err instanceof SayError) throw new SayError(`shot "${shot.id}": ${err.message}`, { cause: err });
    throw err;
  }
}

/**
 * One shot's narration. -> { samples: Float32Array | null, entry: { id, seconds, sentences } }: null samples and an
 * empty sentences list for a shot without say. `speak` is openKokoro's, `phonemize` the phonemizer's, `vocab` the
 * model's; `speed` and `emphasisPause` are the mode's. Word times are seconds from the shot's first sample, rounded;
 * a word may end where it starts (a zero-length or skipped token) and starts are non-decreasing, not strictly
 * increasing.
 */
export async function synthesiseShot(shot, { speak, phonemize, vocab, speed, emphasisPause, log = () => {} }) {
  if (shot.say === undefined || shot.say === null) return { samples: null, entry: { id: shot.id, seconds: 0, sentences: [] } };
  const tokens = tokensOf(shot);
  const items = await planShotCalls(tokens, { speed, emphasisPause, shotId: shot.id, phonemize, vocab });
  const { chunks, length, times } = await speakItems(items, { shotId: shot.id, speak, log });
  const words = tokens.map((t, i) => ({
    text: t.text,
    start: roundTime(times[i].start / SAMPLE_RATE),
    end: roundTime(times[i].end / SAMPLE_RATE),
    emphasis: t.emphasis,
    aside: t.aside,
  }));
  return { samples: concat(chunks, length), entry: { id: shot.id, seconds: roundTime(length / SAMPLE_RATE), sentences: sentencesOf(tokens, words) } };
}

/**
 * A synthesised shot as the sidecar records it, and the WAV bytes to write. A shot with sound gets `shot-<index>.wav`;
 * a shot without say, or whose say has nothing speakable (zero samples), gets `wav: null` and no file.
 */
export function sidecarShot(index, { samples, entry }) {
  const hasSound = samples !== null && samples.length > 0;
  const shot = { id: entry.id, wav: hasSound ? wavName(index) : null, seconds: entry.seconds, sentences: entry.sentences };
  return { shot, wav: hasSound ? encodeWav(samples, SAMPLE_RATE) : null };
}

const JOB_FIELDS = Object.freeze(['version', 'dir', 'shots', 'speed', 'emphasisPause', 'voice', 'runtime', 'modelDir']);
const isText = (v) => typeof v === 'string' && v !== '';

/** Throws naming the first problem with a job; unknown fields are refused with the accepted ones. -> job. */
export function checkJob(job) {
  const unknown = Object.keys(job ?? {}).filter((key) => !JOB_FIELDS.includes(key));
  if (unknown.length > 0) throw new TypeError(`job: unknown field ${unknown.join(', ')} (accepted: ${JOB_FIELDS.join(', ')})`);
  if (job.version !== JOB_VERSION) throw new TypeError(`job.version: expected ${JOB_VERSION}, got ${JSON.stringify(job.version)}`);
  for (const key of ['dir', 'runtime', 'modelDir']) if (!isText(job[key])) throw new TypeError(`job.${key}: must be a path`);
  if (!Array.isArray(job.shots)) throw new TypeError('job.shots: must be an array');
  job.shots.forEach((s, i) => {
    if (!isText(s?.id) || !(s.say === null || typeof s.say === 'string')) throw new TypeError(`job.shots[${i}]: must be { id, say } with say a string or null`);
  });
  if (!Number.isFinite(job.speed) || !Number.isFinite(job.emphasisPause)) throw new TypeError('job.speed and job.emphasisPause: must be numbers');
  checkVoice(job.voice);
  return job;
}

/** { ort, phonemize } from the optional package folder `runtime` (default: <skill>/optional/voice), or a UsageError with the install hint. */
export async function loadRuntime(runtime) {
  const mod = await importOptional({ name: path.basename(runtime), root: path.dirname(runtime), pkg: RUNTIME_PACKAGE, hint: INSTALL_HINT });
  if (typeof mod.ort?.InferenceSession?.create !== 'function' || typeof mod.phonemize !== 'function') {
    throw new UsageError(`${path.join(runtime, 'index.mjs')} does not export ort and phonemize (an install from before version 2 voice). ${INSTALL_HINT}`);
  }
  return { ort: mod.ort, phonemize: mod.phonemize };
}

/**
 * Synthesises every shot of `job` with the loaded runtime and writes the WAVs (each created exclusively in the job's
 * own staging folder), then the sidecar. `at.stage` and `at.shot` (the id of the shot being made) record where the
 * work is, for classifyError. -> the sidecar.
 */
export async function runJob(job, { ort, phonemize, log, at = {} }) {
  at.stage = 'session';
  const vocab = loadVocab(JSON.parse(readFileSync(path.join(job.modelDir, 'tokenizer.json'), 'utf8')));
  const kokoro = await openKokoro({ ort, modelDir: job.modelDir, voice: job.voice });
  at.stage = 'synth';
  try {
    const shots = [];
    for (const [index, shot] of job.shots.entries()) {
      at.shot = shot.id;
      const made = await synthesiseShot(shot, { speak: kokoro.speak, phonemize, vocab, speed: job.speed, emphasisPause: job.emphasisPause, log });
      const { shot: entry, wav } = sidecarShot(index, made);
      if (wav !== null) writeFileSync(path.join(job.dir, entry.wav), wav, { flag: 'wx' });
      shots.push(entry);
      log(`voice: shot "${shot.id}" ${wav === null ? 'has no sound' : `${entry.seconds} s`}`);
    }
    at.shot = undefined;
    const sidecar = { version: SIDECAR_VERSION, model: { ...MODEL_INFO }, voice: job.voice, sampleRate: SAMPLE_RATE, shots };
    writeSidecar(path.join(job.dir, SIDECAR_FILE), sidecar);
    return sidecar;
  } finally {
    await kokoro.close();
  }
}

// make.mjs fetched and checked the model before starting this process; here it is only checked again, never fetched.
const refuseDownload = () => Promise.reject(new Error('the voice worker never downloads: the model should have been fetched before it started'));
const log = (line) => process.stdout.write(`${line}\n`);

// `at.stage` follows the work so a failure can be classified by where it happened.
async function main(argv, at) {
  at.stage = 'job';
  if (argv.length !== 1) throw new TypeError('usage: node worker.mjs <job.json>');
  const job = checkJob(JSON.parse(readFileSync(argv[0], 'utf8')));
  at.stage = 'runtime';
  const { ort, phonemize } = await loadRuntime(job.runtime);
  at.stage = 'model';
  await ensureVoiceModel({ dir: job.modelDir, log, fetchImpl: refuseDownload });
  await runJob(job, { ort, phonemize, log, at });
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

// The process ends by itself: exitCode is set and the event loop is left to drain, never process.exit. Reason:
// onnxruntime-node 1.21.0 aborts the process (SIGABRT, "libc++abi: ... mutex lock failed: Invalid argument") when
// process.exit runs while its thread pool is alive; seen on macOS with Node 24.7.0 in this task's integration test.
// A signal death would lose the exit code and turn the last stderr line into the C++ abort message. Ending naturally
// still flushes stdout and stderr, so the last stderr line stays the reason.
if (isMain) {
  const at = { stage: 'job' };
  main(process.argv.slice(2), at).then(
    () => {
      process.exitCode = 0;
    },
    (err) => {
      const error = classifyError(err, at.stage, at.shot);
      process.exitCode = error.kind === 'film' ? EXIT_FILM : EXIT_MACHINE;
      process.stderr.write(`${ERROR_MARKER}${JSON.stringify(error)}\n`);
    },
  );
}
