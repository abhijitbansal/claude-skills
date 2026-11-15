// The child process that synthesises a film's narration: `node worker.mjs <job.json>`.
// It runs apart from make.mjs because the phonemizer (an Emscripten build of eSpeak NG) installs a process-wide
// uncaughtException hook (spike report, open risk 9); here that hook can only affect this process.
//
// It loads the optional voice package through importOptional (INSTALL_HINT: version 2 wording, version 1's install
// command), checks the pinned model
// with ensureVoiceModel, then for each narrated shot plans the calls, runs them, concatenates the waveforms and the
// silences, maps the model's durations to word times, and writes one 24 kHz mono 16-bit WAV per narrated shot. The
// sidecar is written last, so its presence means every WAV is complete. No silence is added between shots.
//
// Progress goes to stdout. On failure the last stderr line is the reason, on one line; the exit code is 2 for machine
// trouble (the optional package missing: a UsageError carrying the install hint) and 1 for anything else.
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SayError, parseSay } from '../../../engine/script/say.mjs';
import { importOptional } from '../../lib/optional.mjs';
import { optionalInstall } from '../../lib/doctor-hint.mjs';
import { UsageError } from '../../lib/spec.mjs';
import { MODEL_INFO, checkVoice, openKokoro, planShotCalls } from './kokoro.mjs';
import { ensureVoiceModel } from './model.mjs';
import { SIDECAR_FILE, SIDECAR_VERSION, roundTime, sentencesOf, writeSidecar } from './sidecar.mjs';
import { loadVocab } from './tokens.mjs';
import { FRAME_SAMPLES, SAMPLE_RATE, framesOf, wordTimes } from './words.mjs';

/** Silences are whole milliseconds, so a shot's length is exact at the sidecar's 1e-4 s (model audio is 600-sample frames). */
export const SILENCE_QUANTUM_SAMPLES = SAMPLE_RATE / 1000;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;
/** Frames of each pad token a call keeps at least (2 frames = 50 ms). */
export const PAD_KEEP_FRAMES = 2;
/** The lead pad is never cut closer than this to the call's first word start (75 ms; measured onsets run up to 31 ms before it). */
export const ONSET_MARGIN_SAMPLES = 75 * SAMPLES_PER_MS;
/** Linear fade at a cut edge (5 ms), so a trim cannot click. */
export const FADE_SAMPLES = 5 * SAMPLES_PER_MS;
/** The pad-trim settings as one value: part of the cache hash (synth.mjs voiceHash), since they shape every WAV and time. */
export const TRIM = Object.freeze({ padKeepFrames: PAD_KEEP_FRAMES, onsetMarginSamples: ONSET_MARGIN_SAMPLES, fadeSamples: FADE_SAMPLES });
export const JOB_VERSION = 1;
/** What is missing, in version 2 terms, then the same install command as version 1 (scripts/lib/voice.mjs). */
export const INSTALL_HINT = `the optional voice package is not installed. Run: ${optionalInstall('kokoro')}`;
const RUNTIME_PACKAGE = 'onnxruntime-node';
const EXIT_FAILURE = 1;
const EXIT_MACHINE = 2;
const WAV_HEADER_BYTES = 44;
const PCM_MAX = 32767;
const PCM_MIN = -32768;

const silenceSamples = (seconds) => Math.round((seconds * SAMPLE_RATE) / SILENCE_QUANTUM_SAMPLES) * SILENCE_QUANTUM_SAMPLES;
const wavName = (index) => `shot-${index}.wav`;

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

function checkFrames(shotId, frames, waveform) {
  const total = frames.reduce((a, b) => a + b, 0);
  if (total * FRAME_SAMPLES !== waveform.length) {
    throw new Error(`shot "${shotId}": the model's frames (${total} x ${FRAME_SAMPLES} samples) do not add up to its waveform (${waveform.length} samples), so its word times cannot be trusted`);
  }
}

// A copy of `samples` with a linear fade over FADE_SAMPLES at the front and/or the back.
function faded(samples, { atFront, atBack }) {
  const out = Float32Array.from(samples);
  const n = Math.min(FADE_SAMPLES, out.length);
  for (let i = 0; i < n; i++) {
    if (atFront) out[i] *= i / FADE_SAMPLES;
    if (atBack) out[out.length - 1 - i] *= i / FADE_SAMPLES;
  }
  return out;
}

/**
 * One call's waveform with its pad tokens trimmed (team-lead ruling 1, Task 5; amended, see the report). Only the two
 * pad tokens (id 0 at each end) are cut, never a space or punctuation token, so the model's own pause at a comma or
 * full stop stays. The lead pad is cut up to ONSET_MARGIN_SAMPLES before `firstStart` (the call's first word start
 * by the start rule, in untrimmed samples), and never below PAD_KEEP_FRAMES: measured, the voice starts up to 145 ms
 * inside the lead pad, so a fixed 2-frame keep would clip onsets. The tail pad keeps PAD_KEEP_FRAMES. A cut edge gets
 * a FADE_SAMPLES linear fade. -> { samples, cutFront } (the samples removed in front, to shift word times by).
 */
export function trimPads(waveform, frames, firstStart) {
  const maxFront = Math.max(0, frames[0] - PAD_KEEP_FRAMES) * FRAME_SAMPLES;
  const cutFront = Math.max(0, Math.min(firstStart - ONSET_MARGIN_SAMPLES, maxFront));
  const cutBack = Math.max(0, frames.at(-1) - PAD_KEEP_FRAMES) * FRAME_SAMPLES;
  const kept = waveform.subarray(cutFront, waveform.length - cutBack);
  return { samples: faded(kept, { atFront: cutFront > 0, atBack: cutBack > 0 }), cutFront };
}

// One speech call: the trimmed waveform and its say tokens' { start, end } in samples from the trimmed call's first
// sample. Times are computed on the untrimmed frames (the start rule reads the real pad length), then shifted.
async function speakCall(item, { shotId, speak, log }) {
  if (item.input.dropped.length > 0) log(`shot "${shotId}": dropped phoneme characters outside the model's vocab: ${item.input.dropped.map((d) => d.char).join(' ')}`);
  const { waveform, durations } = await speak({ ids: item.input.ids, speed: item.speed });
  const frames = framesOf(durations);
  checkFrames(shotId, frames, waveform);
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
 * increasing. `plan` is planShotCalls; a test seam.
 */
export async function synthesiseShot(shot, { speak, phonemize, vocab, speed, emphasisPause, log = () => {}, plan = planShotCalls }) {
  if (shot.say === undefined || shot.say === null) return { samples: null, entry: { id: shot.id, seconds: 0, sentences: [] } };
  const tokens = tokensOf(shot);
  const items = await plan(tokens, { speed, emphasisPause, shotId: shot.id, phonemize, vocab });
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

// Writes through a temporary name renamed into place, so a half-written file never has the final name.
function writeAtomically(file, bytes) {
  const partial = `${file}.partial-${process.pid}`;
  writeFileSync(partial, bytes);
  renameSync(partial, file);
}

const JOB_FIELDS = Object.freeze(['version', 'dir', 'shots', 'speed', 'emphasisPause', 'voice', 'runtime', 'modelDir', 'offline']);
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
  if (typeof job.offline !== 'boolean') throw new TypeError('job.offline: must be true or false');
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

/** Synthesises every shot of `job` with the loaded runtime and writes the WAVs, then the sidecar. -> the sidecar. */
export async function runJob(job, { ort, phonemize, log }) {
  const vocab = loadVocab(JSON.parse(readFileSync(path.join(job.modelDir, 'tokenizer.json'), 'utf8')));
  const kokoro = await openKokoro({ ort, modelDir: job.modelDir, voice: job.voice });
  try {
    const shots = [];
    for (const [index, shot] of job.shots.entries()) {
      const { samples, entry } = await synthesiseShot(shot, { speak: kokoro.speak, phonemize, vocab, speed: job.speed, emphasisPause: job.emphasisPause, log });
      if (samples !== null) writeAtomically(path.join(job.dir, wavName(index)), encodeWav(samples, SAMPLE_RATE));
      shots.push({ id: entry.id, wav: samples === null ? null : wavName(index), seconds: entry.seconds, sentences: entry.sentences });
      log(`voice: shot "${shot.id}" ${samples === null ? 'has no narration' : `${entry.seconds} s`}`);
    }
    const sidecar = { version: SIDECAR_VERSION, model: { ...MODEL_INFO }, voice: job.voice, sampleRate: SAMPLE_RATE, shots };
    writeSidecar(path.join(job.dir, SIDECAR_FILE), sidecar);
    return sidecar;
  } finally {
    await kokoro.close();
  }
}

const refuseDownload = () => Promise.reject(new Error('this job is offline, so no model file is downloaded'));
const log = (line) => process.stdout.write(`${line}\n`);

async function main(argv) {
  if (argv.length !== 1) throw new UsageError('usage: node worker.mjs <job.json>');
  const job = checkJob(JSON.parse(readFileSync(argv[0], 'utf8')));
  const { ort, phonemize } = await loadRuntime(job.runtime);
  await ensureVoiceModel({ dir: job.modelDir, log, ...(job.offline ? { fetchImpl: refuseDownload } : {}) });
  await runJob(job, { ort, phonemize, log });
}

const oneLine = (err) => String(err?.message ?? err).replace(/\s*\n\s*/g, ' ').trim();
const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

// The process ends by itself: exitCode is set and the event loop is left to drain, never process.exit. Reason:
// onnxruntime-node 1.21.0 aborts the process (SIGABRT, "libc++abi: ... mutex lock failed: Invalid argument") when
// process.exit runs while its thread pool is alive; seen on macOS with Node 24.7.0 in this task's integration test.
// A signal death would lose the exit code and turn the last stderr line into the C++ abort message. Ending naturally
// still flushes stdout and stderr, so the last stderr line stays the reason.
if (isMain) {
  main(process.argv.slice(2)).then(
    () => {
      process.exitCode = 0;
    },
    (err) => {
      process.exitCode = err instanceof UsageError ? EXIT_MACHINE : EXIT_FAILURE;
      process.stderr.write(`${oneLine(err)}\n`);
    },
  );
}
