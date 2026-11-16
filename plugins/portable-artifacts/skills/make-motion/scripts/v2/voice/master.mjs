// The narration put into the film: each narrated shot's WAV placed at its shot's narration start on the timeline (the
// timeline owns time: nothing else decides where a sound falls), emphasis and asides shaped in film time, the track
// mastered to the mode's loudness, and muxed into the finished MP4 without touching its video.
//
// The argument builders are pure and take numbers only: no film string (a word's text, a shot id) reaches an ffmpeg
// argument, and ffmpeg is always run with an argument array and no shell. Times are formatted here, to 1e-4 s.
//
// The track is built at 48 kHz (each shot's WAV resampled once), so a recording at a higher rate than Kokoro's 24 kHz
// keeps its top octave. The master chain: high-pass, compressor, de-esser, then the shaping (after the compressor, so it
// cannot take back the lift or the cut), then stereo, then loudnorm in linear mode (one gain, so the shaping's relative
// levels survive). A pass 2 in which loudnorm falls back to dynamic mode is refused. A track whose peaks the gain to the
// target would push over the ceiling goes through version 1's limiter stage first (scripts/lib/loudness.mjs).
//
// Shaping: one `volume` filter per stage, its gain an expression of `t` evaluated once per audio frame, after
// `asetnsamples` cuts the audio into 1 ms frames. Each stage is a trapezoid in decibels: 0 dB until RAMP_SECONDS
// before the word, a straight ramp up to its level at the word's start, held to its end, and a ramp back down over the
// next RAMP_SECONDS. `enable='between(t,a,b)'` was not used: it switches the gain on in one step, with no ramp.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { narrationStart } from '../../../engine/script/timing.mjs';
import { fileInput, parseLoudness } from '../../lib/ffmpeg.mjs';
import { ceilingFor, limiterChain, parseLoudnormJson } from '../../lib/loudness.mjs';
import { SAMPLE_RATE } from './words.mjs';

export const LEVELS = Object.freeze({ emphasisDb: 2, asideDb: -3 });
export const RAMP_SECONDS = 0.02;
export const VOICE_RATE = SAMPLE_RATE; // Kokoro's WAVs, as the sidecar names them
export const MASTER_RATE = 48000;
export const TRACK_RATE = MASTER_RATE; // the voice track, from the first mix to the master
// The voice in the MP4: AAC at 48 kHz, 160 kbit/s, two channels. Stereo (the mono voice on both) because players and
// platforms expect it and a later music bed is stereo; the master is made stereo before loudnorm measures it, so the
// loudness it reaches is the loudness of the file (a mono master copied to two channels would measure 3 LU louder).
export const AAC_AUDIO = Object.freeze(['-c:a', 'aac', '-b:a', '160k', '-ar', String(MASTER_RATE), '-ac', '2']);
/** The finished film's integrated loudness may miss the mode's target by this many LU; more is machine trouble. */
export const LOUDNESS_TOLERANCE_LU = 1;
export const UNMEASURED_NOTE = 'the narration is too short or too quiet for its loudness to be measured, so it was not normalised';

const SHAPING_FRAME_SAMPLES = 48; // 1 ms at 48 kHz: the gain expression steps once a frame
const HIGHPASS_HZ = 80;
// A gentle compressor: 2:1 above -18 dBFS, slow enough to leave the consonants alone.
const COMPRESSOR = Object.freeze({ thresholdDb: -18, ratio: 2, attackMs: 20, releaseMs: 250 });
// The de-esser: moderate intensity, its default reduction limit and split frequency.
const DEESSER = Object.freeze({ intensity: 0.3, maxReduction: 0.5, frequency: 0.5 });
const LOUDNORM_LRA_MAX = 50; // loudnorm's largest loudness range
const LIMITER_ROUNDS = 3; // at most this many limiter measurements before pass 2 (a very peaky track needs more than one)
const GATE_FLOOR_LUFS = -70; // ebur128's absolute gate: an integrated value at or under it measured nothing
const TIME_DECIMALS = 4;
const DB_DECIMALS = 2;
const LINEAR_DECIMALS = 6;
const STDERR_KEEP = 200000; // loudnorm's JSON comes last; a long log keeps its tail
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const NORMALIZATION_RE = /"normalization_type"\s*:\s*"(\w+)"/g;
const QUIET = Object.freeze(['-hide_banner', '-loglevel', 'error']);
const MEASURE = Object.freeze(['-hide_banner', '-nostats']); // loudnorm and ebur128 print at info level
const NO_METADATA = Object.freeze(['-map_metadata', '-1']); // an input's tags never reach the log a measurement is read from
export const AUDIO_HINT = 'ffmpeg could not mix, master or mux the narration; the words after "ffmpeg failed" are its own. '
  + 'Check the disk space and that this ffmpeg has the highpass, acompressor, deesser, alimiter and loudnorm filters, then run again';

const fixed = (decimals) => (n) => {
  if (!Number.isFinite(n)) throw new RangeError(`master: ${n} is not a finite number`);
  return n.toFixed(decimals);
};
const time = fixed(TIME_DECIMALS);
const decibels = fixed(DB_DECIMALS);
const samplesOf = (seconds) => Math.round(seconds * TRACK_RATE);

class AudioError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'AudioError';
    this.hint = AUDIO_HINT;
  }
}

// Any failure inside the voice steps as an AudioError, so it carries the audio hint; a stop passes through as it is.
const asAudioError = (err) => (err instanceof AudioError || err?.name === 'AbortError' ? err : new AudioError(`voice: ${err?.message ?? err}`, { cause: err }));

// ---- shaping -----------------------------------------------------------------------------------------------------------

const wordsOf = (shot) => (Array.isArray(shot?.sentences) ? shot.sentences.flatMap((s) => s.words) : []);

// The emphasised words of one shot and its runs of contiguous aside words, as { db, start, end } in film seconds. A word
// of no length gets no stage.
function shotStages(shot, offset) {
  const stages = [];
  let run = null;
  for (const w of wordsOf(shot)) {
    if (w.emphasis && w.end > w.start) stages.push({ db: LEVELS.emphasisDb, start: offset + w.start, end: offset + w.end });
    if (w.aside) run = run === null ? { first: w, last: w } : { ...run, last: w };
    if (!w.aside && run !== null) { stages.push(asideStage(run, offset)); run = null; }
  }
  if (run !== null) stages.push(asideStage(run, offset));
  return stages.filter((s) => s.end > s.start);
}
const asideStage = ({ first, last }, offset) => ({ db: LEVELS.asideDb, start: offset + first.start, end: offset + last.end });

// Stages of one level whose ramps would meet (closer than two ramps) become one, so the gain never doubles in between.
function merged(stages) {
  const out = [];
  for (const s of [...stages].sort((a, b) => a.start - b.start)) {
    const prev = out.at(-1);
    if (prev && s.start - prev.end < 2 * RAMP_SECONDS) out[out.length - 1] = { ...prev, end: Math.max(prev.end, s.end) };
    else out.push(s);
  }
  return out;
}

/**
 * The gain stages of a sidecar on `timeline`, in film seconds: each emphasised word (LEVELS.emphasisDb) and each run of
 * contiguous aside words (LEVELS.asideDb), at the sidecar's word times plus narrationStart of the word's shot.
 */
export function gainStages(sidecar, timeline) {
  const all = sidecar.shots.flatMap((shot, i) => shotStages(shot, narrationStart(timeline.shots[i])));
  const of = (db) => merged(all.filter((s) => s.db === db));
  return [...of(LEVELS.emphasisDb), ...of(LEVELS.asideDb)].sort((a, b) => a.start - b.start);
}

// One stage as a volume filter: pow(10, dB * envelope / 20), the envelope 0 to 1 over the ramps (see the header).
function stageFilter({ db, start, end }) {
  const ramp = time(RAMP_SECONDS);
  const envelope = `clip(min((t-(${time(start - RAMP_SECONDS)}))/${ramp},(${time(end + RAMP_SECONDS)}-t)/${ramp}),0,1)`;
  return `volume='pow(10,${decibels(db)}*${envelope}/20)':eval=frame`;
}

/** The shaping filter chain of a sidecar on `timeline` (film times), or '' when nothing is emphasised or aside. */
export function shapingFilter(sidecar, timeline) {
  const stages = gainStages(sidecar, timeline);
  if (stages.length === 0) return '';
  return [`asetnsamples=n=${SHAPING_FRAME_SAMPLES}:p=0`, ...stages.map(stageFilter)].join(',');
}

// ---- the voice track ---------------------------------------------------------------------------------------------------

/**
 * The ffmpeg arguments that build the film's voice track at 48 kHz mono: each shot of `shots` (one per timeline shot,
 * `{ wav }` an absolute path or null) with a WAV is resampled once to 48 kHz and delayed to its shot's narration start in
 * whole samples, the inputs are mixed without normalisation, and the track is padded and cut to the film's length.
 */
export function voiceTrackArgs({ shots, timeline, out }) {
  const placed = shots.map((s, i) => ({ wav: s.wav, delay: samplesOf(narrationStart(timeline.shots[i])) })).filter((s) => s.wav !== null);
  if (placed.length === 0) throw new RangeError('voiceTrackArgs: no shot has a narration WAV');
  const length = samplesOf(timeline.duration);
  const chains = placed.map((s, k) => `[${k}:a]aformat=sample_rates=${TRACK_RATE}:channel_layouts=mono,adelay=delays=${s.delay}S:all=1[v${k}]`);
  const labels = placed.map((_, k) => `[v${k}]`).join('');
  const graph = `${chains.join(';')};${labels}amix=inputs=${placed.length}:duration=longest:normalize=0,apad=whole_len=${length},atrim=end_sample=${length}[voice]`;
  return [...QUIET, '-y', ...placed.flatMap((s) => fileInput(s.wav)), '-filter_complex', graph, '-map', '[voice]', ...NO_METADATA,
    '-ar', String(TRACK_RATE), '-ac', '1', '-c:a', 'pcm_s16le', out];
}

// ---- mastering ---------------------------------------------------------------------------------------------------------

const dbToLinear = (db) => (10 ** (db / 20)).toFixed(LINEAR_DECIMALS);

// The loudness range pass 2 is given: the mode's, or the measured range when it is wider (up to loudnorm's largest), so
// a wide range alone never sends loudnorm to dynamic mode.
const rangeFor = (loudness, measured) => Math.min(LOUDNORM_LRA_MAX, Math.max(loudness.lra, Math.ceil(Number(measured.input_lra))));

function loudnormFilter(loudness, measured) {
  const target = `loudnorm=I=${loudness.lufs}:TP=${ceilingFor(loudness.truePeakDb)}`;
  if (measured === undefined) return `${target}:LRA=${loudness.lra}:print_format=json`;
  return `${target}:LRA=${rangeFor(loudness, measured)}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}`
    + `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
}

// The same chain on every pass, so the measured values apply: high-pass, compressor, de-esser, the shaping, stereo at
// 48 kHz, the limiter stage when there is one (`pre`), loudnorm (none for a track it cannot measure: `measured` null),
// then 48 kHz again (loudnorm itself puts out 192 kHz).
function masterChain({ filter, loudness, measured, pre }) {
  const compressor = `acompressor=threshold=${dbToLinear(COMPRESSOR.thresholdDb)}:ratio=${COMPRESSOR.ratio}:attack=${COMPRESSOR.attackMs}:release=${COMPRESSOR.releaseMs}`;
  const deesser = `deesser=i=${DEESSER.intensity}:m=${DEESSER.maxReduction}:f=${DEESSER.frequency}`;
  const stereo = `aresample=${MASTER_RATE},aformat=channel_layouts=stereo`;
  const normalise = measured === null ? [] : [pre, loudnormFilter(loudness, measured)];
  return [`highpass=f=${HIGHPASS_HZ}`, compressor, deesser, filter, stereo, ...normalise, `aresample=${MASTER_RATE}`]
    .filter(Boolean).join(',');
}

/**
 * The ffmpeg arguments of a mastering pass over the voice track `wav`. `measured` undefined: a measuring pass (loudnorm
 * prints its JSON on stderr). `measured` pass 1's values: pass 2, which applies them in linear mode, prints the mode it
 * used, and writes `out`, a 48 kHz stereo WAV. `measured` null: a track loudnorm could not measure, written through the
 * chain without loudnorm. `filter` is the shaping chain; `pre` the limiter stage or undefined; `loudness` the mode's
 * { lufs, truePeakDb, lra }, the true peak aimed 0.5 dB under the target for the AAC encode (loudness.mjs ceilingFor).
 */
export function masterArgs({ wav, out, filter, loudness, measured, pre }) {
  const af = masterChain({ filter, loudness, measured, pre });
  if (measured === undefined) return [...MEASURE, ...fileInput(wav), ...NO_METADATA, '-af', af, '-f', 'null', '-'];
  const log = measured === null ? QUIET : MEASURE;
  return [...log, '-y', ...fileInput(wav), ...NO_METADATA, '-af', af, '-ar', String(MASTER_RATE), '-c:a', 'pcm_s16le', out];
}

const lastLine = (text) => text.trim().split('\n').filter((l) => l.trim()).at(-1) ?? 'no output';

// Runs one ffmpeg step through `run` and fails with ffmpeg's last line and the audio hint when it does not exit 0.
async function step(run, args, what) {
  const { code, stderr } = await run(args);
  if (code !== 0) throw new AudioError(`${what}: ffmpeg failed (exit ${code}): ${lastLine(stderr)}`);
  return stderr;
}

// A measuring pass's values, each a plain number (they come from another program's output and go back into an
// argument), or null when loudnorm measured nothing (a track too short or too quiet for it).
function checkedMeasurement(stderr) {
  const measured = parseLoudnormJson(stderr);
  if (measured === null) throw new AudioError(`voice master: ffmpeg printed no loudness measurement (its last line: ${lastLine(stderr)})`);
  if (!Number.isFinite(Number(measured.input_i))) return null;
  const bad = Object.entries(measured).find(([, value]) => !PLAIN_NUMBER.test(value));
  if (bad) throw new AudioError(`voice master: loudnorm measured ${bad[0]} as ${JSON.stringify(bad[1])}, not a number`);
  return measured;
}

// True when the gain to the target would push the measured peak over the ceiling: linear loudnorm cannot apply it.
const overCeiling = (measured, loudness) => Number(measured.input_tp) + (loudness.lufs - Number(measured.input_i)) > ceilingFor(loudness.truePeakDb);

// Pass 2 must have run linear; dynamic mode would compress the shaping's lift and cut away.
function checkLinear(stderr) {
  const used = [...stderr.matchAll(NORMALIZATION_RE)].at(-1)?.[1];
  if (used !== 'linear') {
    throw new AudioError(`voice master: loudnorm normalised the narration in ${used ?? 'an unknown'} mode, not linear (dynamic mode would flatten the emphasis and aside levels)`);
  }
}

/**
 * Masters the voice track `wav` into `out` through `run(args) -> Promise<{ code, stderr }>` (ffmpegRunner): pass 1
 * measures; a track whose peaks the gain would push over the ceiling gets the limiter stage and is measured again
 * through it; pass 2 applies the measurement in linear mode, checked. A track loudnorm cannot measure is written without
 * it. Resolves `{ measured, limited }` (measured null for that track); rejects with ffmpeg's words and a hint.
 */
export async function masterVoice({ run, wav, out, filter, loudness }) {
  const base = { wav, out, filter, loudness };
  let measured = checkedMeasurement(await step(run, masterArgs(base), 'voice master'));
  if (measured === null) {
    await step(run, masterArgs({ ...base, measured: null }), 'voice master');
    return { measured: null, limited: false };
  }
  let pre;
  let gain = 0;
  for (let round = 0; round < LIMITER_ROUNDS && overCeiling(measured, loudness); round++) {
    gain += loudness.lufs - Number(measured.input_i); // limiting lowers the loudness, so each round adds what is still missing
    pre = limiterChain({ gain, truePeak: loudness.truePeakDb });
    measured = checkedMeasurement(await step(run, masterArgs({ ...base, pre }), 'voice master'));
    if (measured === null) throw new AudioError('voice master: loudnorm could not measure the narration through the limiter');
  }
  checkLinear(await step(run, masterArgs({ ...base, measured, pre }), 'voice master'));
  return { measured, limited: pre !== undefined };
}

// ---- the film's voice, end to end --------------------------------------------------------------------------------------

const isBareName = (name) => typeof name === 'string' && name !== '' && name !== '.' && name !== '..' && path.basename(name) === name;

// The shot WAVs of a sidecar as absolute paths beside it (null for a shot without narration). A sidecar names its WAVs
// by bare file names only (sidecar.mjs wavName); anything else (a path, ".", "..", empty) is refused, never opened.
function shotWavs({ dir, sidecar }) {
  return sidecar.shots.map((shot) => {
    if (shot.wav === null) return { wav: null };
    if (!isBareName(shot.wav)) throw new AudioError(`voice: the sidecar names the WAV ${JSON.stringify(shot.wav)}, not a file beside it`);
    return { wav: path.join(dir, shot.wav) };
  });
}

/**
 * Builds the film's voice track from `voice` ({ dir, sidecar }: what the voice stage made) on `timeline`, shapes and
 * masters it to `loudness` in `workDir`, and resolves the mastered WAV's path, or null when no shot has narration (then
 * there is no voice to put in the film). Every failure is an AudioError with the audio hint.
 */
export async function masterTrack({ run, voice, timeline, loudness, workDir }) {
  try {
    const shots = shotWavs(voice);
    if (shots.every((s) => s.wav === null)) return null;
    const track = path.join(workDir, 'voice-track.wav');
    const master = path.join(workDir, 'voice-master.wav');
    await step(run, voiceTrackArgs({ shots, timeline, out: track }), 'voice mix');
    await masterVoice({ run, wav: track, out: master, filter: shapingFilter(voice.sidecar, timeline), loudness });
    return master;
  } catch (err) {
    throw asAudioError(err);
  }
}

/** The ffmpeg arguments of the mux: the video copied as it is, the mastered voice as AAC_AUDIO, `duration` seconds long. */
export function muxArgs({ video, audio, out, duration }) {
  return [...QUIET, '-y', ...fileInput(video), ...fileInput(audio), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...AAC_AUDIO,
    '-t', time(duration), '-movflags', '+faststart', out];
}

const loudnessArgs = (file) => [...MEASURE, ...fileInput(file), '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'];

// ebur128's reading as the report's audio: an integrated value at the gate floor (or none) measured nothing.
function levelOf({ lufs, truePeak }) {
  const measured = Number.isFinite(lufs) && lufs > GATE_FLOOR_LUFS ? lufs : null;
  return { lufs: measured, truePeakDb: Number.isFinite(truePeak) ? truePeak : null, note: measured === null ? UNMEASURED_NOTE : null };
}

/**
 * Muxes the mastered voice `audio` into `video` as `out`, then measures the finished file: resolves
 * `{ lufs, truePeakDb, note }` as ebur128 reads them from `out`, never the targets echoed back (lufs null, with a note,
 * for a narration too short or too quiet to measure).
 */
export async function muxVoice({ run, video, audio, out, duration }) {
  try {
    await step(run, muxArgs({ video, audio, out, duration }), 'voice mux');
    const level = parseLoudness(await step(run, loudnessArgs(out), 'voice loudness'));
    if (level === null) throw new AudioError('voice loudness: ffmpeg printed no ebur128 summary for the finished film');
    return levelOf(level);
  } catch (err) {
    throw asAudioError(err);
  }
}

/**
 * The finished film's voice level against the mode's `loudness`: more than LOUDNESS_TOLERANCE_LU from the integrated
 * target, or a true peak over the ceiling, is machine trouble (an AudioError with the hint); an unmeasured loudness
 * (lufs null) is not judged. Returns `audio`.
 */
export function judgeLevel(audio, loudness) {
  if (audio.lufs !== null && Math.abs(audio.lufs - loudness.lufs) > LOUDNESS_TOLERANCE_LU) {
    throw new AudioError(`voice loudness: the finished film measures ${audio.lufs} LUFS, more than ${LOUDNESS_TOLERANCE_LU} LU from the mode's target of ${loudness.lufs} LUFS`);
  }
  if (audio.truePeakDb !== null && audio.truePeakDb > loudness.truePeakDb) {
    throw new AudioError(`voice loudness: the finished film has a true peak of ${audio.truePeakDb} dBTP, over the mode's ceiling of ${loudness.truePeakDb} dBTP`);
  }
  return audio;
}

/**
 * A runner for the steps above: `ffmpeg` with an argument array and no shell, resolving `{ code, stderr }` when it ends.
 * When `signal` aborts, the process is killed and the run rejects with the signal's reason.
 */
export function ffmpegRunner(ffmpeg, signal) {
  return (args) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const kill = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', kill, { once: true });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-STDERR_KEEP); });
    const settle = (code) => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) reject(signal.reason);
      else resolve({ code, stderr });
    };
    child.on('error', (err) => { stderr ||= err.message; settle(-1); });
    child.on('close', settle);
  });
}
