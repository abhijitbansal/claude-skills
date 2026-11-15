// The narration put into the film: each narrated shot's WAV placed at its shot's narration start on the timeline (the
// timeline owns time: nothing else decides where a sound falls), emphasis and asides shaped in film time, the track
// mastered to the mode's loudness in two loudnorm passes, and muxed into the finished MP4 without touching its video.
//
// The argument builders are pure and take numbers only: no film string (a word's text, a shot id) reaches an ffmpeg
// argument, and ffmpeg is always run with an argument array and no shell. Times are formatted here, to 1e-4 s.
//
// Shaping: one `volume` filter per stage, its gain an expression of `t` evaluated once per audio frame, after
// `asetnsamples` cuts the audio into 1 ms frames. Each stage is a trapezoid in decibels: 0 dB until RAMP_SECONDS
// before the word, a straight ramp up to its level at the word's start, held to its end, and a ramp back down over the
// next RAMP_SECONDS. `enable='between(t,a,b)'` was not used: it switches the gain on in one step, with no ramp.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { narrationStart } from '../../../engine/script/timing.mjs';
import { fileInput, parseLoudness } from '../../lib/ffmpeg.mjs';
import { ceilingFor, parseLoudnormJson } from '../../lib/loudness.mjs';
import { SAMPLE_RATE } from './words.mjs';

export const LEVELS = Object.freeze({ emphasisDb: 2, asideDb: -3 });
export const RAMP_SECONDS = 0.02;
export const VOICE_RATE = SAMPLE_RATE; // the sidecar's WAVs, and the voice track until it is mastered
export const MASTER_RATE = 48000;
// The voice in the MP4: AAC at 48 kHz, 160 kbit/s, two channels. Stereo (the mono voice on both) because players and
// platforms expect it and a later music bed is stereo; the master is made stereo before loudnorm measures it, so the
// loudness it reaches is the loudness of the file (a mono master copied to two channels would measure 3 LU louder).
export const AAC_AUDIO = Object.freeze(['-c:a', 'aac', '-b:a', '160k', '-ar', String(MASTER_RATE), '-ac', '2']);

const SHAPING_FRAME_SAMPLES = 24; // 1 ms at 24 kHz: the gain expression steps once a frame
const HIGHPASS_HZ = 80;
// A gentle compressor: 2:1 above -18 dBFS, slow enough to leave the consonants alone.
const COMPRESSOR = Object.freeze({ thresholdDb: -18, ratio: 2, attackMs: 20, releaseMs: 250 });
// The de-esser: moderate intensity, its default reduction limit and split frequency.
const DEESSER = Object.freeze({ intensity: 0.3, maxReduction: 0.5, frequency: 0.5 });
const TIME_DECIMALS = 4;
const DB_DECIMALS = 2;
const LINEAR_DECIMALS = 6;
const STDERR_KEEP = 200000; // loudnorm's JSON comes last; a long log keeps its tail
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const QUIET = Object.freeze(['-hide_banner', '-loglevel', 'error']);
const MEASURE = Object.freeze(['-hide_banner', '-nostats']); // loudnorm and ebur128 print at info level
export const AUDIO_HINT = 'ffmpeg could not mix, master or mux the narration; the words after "ffmpeg failed" are its own. '
  + 'Check the disk space and that this ffmpeg has the highpass, acompressor, deesser and loudnorm filters, then run again';

const fixed = (decimals) => (n) => {
  if (!Number.isFinite(n)) throw new RangeError(`master: ${n} is not a finite number`);
  return n.toFixed(decimals);
};
const time = fixed(TIME_DECIMALS);
const decibels = fixed(DB_DECIMALS);
const samplesOf = (seconds) => Math.round(seconds * VOICE_RATE);

class AudioError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AudioError';
    this.hint = AUDIO_HINT;
  }
}

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
 * The ffmpeg arguments that build the film's voice track at 24 kHz mono: each shot of `shots` (one per timeline shot,
 * `{ wav }` an absolute path or null) with a WAV is delayed to its shot's narration start in whole samples, the inputs
 * are mixed without normalisation, and the track is padded and cut to the film's length exactly.
 */
export function voiceTrackArgs({ shots, timeline, out }) {
  const placed = shots.map((s, i) => ({ wav: s.wav, delay: samplesOf(narrationStart(timeline.shots[i])) })).filter((s) => s.wav !== null);
  if (placed.length === 0) throw new RangeError('voiceTrackArgs: no shot has a narration WAV');
  const length = samplesOf(timeline.duration);
  const chains = placed.map((s, k) => `[${k}:a]aformat=sample_rates=${VOICE_RATE}:channel_layouts=mono,adelay=delays=${s.delay}S:all=1[v${k}]`);
  const labels = placed.map((_, k) => `[v${k}]`).join('');
  const graph = `${chains.join(';')};${labels}amix=inputs=${placed.length}:duration=longest:normalize=0,apad=whole_len=${length},atrim=end_sample=${length}[voice]`;
  return [...QUIET, '-y', ...placed.flatMap((s) => fileInput(s.wav)), '-filter_complex', graph, '-map', '[voice]',
    '-ar', String(VOICE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', out];
}

// ---- mastering ---------------------------------------------------------------------------------------------------------

const dbToLinear = (db) => (10 ** (db / 20)).toFixed(LINEAR_DECIMALS);

function loudnormFilter(loudness, measured) {
  const target = `loudnorm=I=${loudness.lufs}:TP=${ceilingFor(loudness.truePeakDb)}:LRA=${loudness.lra}`;
  if (measured === undefined) return `${target}:print_format=json`;
  return `${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}`
    + `:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
}

// The same chain on both passes, so the measured values apply: shaping, high-pass, compressor, de-esser, then stereo at
// 48 kHz, then loudnorm, then 48 kHz again (loudnorm itself puts out 192 kHz).
function masterChain({ filter, loudness, measured }) {
  const compressor = `acompressor=threshold=${dbToLinear(COMPRESSOR.thresholdDb)}:ratio=${COMPRESSOR.ratio}:attack=${COMPRESSOR.attackMs}:release=${COMPRESSOR.releaseMs}`;
  const deesser = `deesser=i=${DEESSER.intensity}:m=${DEESSER.maxReduction}:f=${DEESSER.frequency}`;
  const stereo = `aresample=${MASTER_RATE},aformat=channel_layouts=stereo`;
  return [filter, `highpass=f=${HIGHPASS_HZ}`, compressor, deesser, stereo, loudnormFilter(loudness, measured), `aresample=${MASTER_RATE}`]
    .filter(Boolean).join(',');
}

/**
 * The ffmpeg arguments of a mastering pass over the voice track `wav`. Without `measured`: pass 1, which only measures
 * (loudnorm prints its JSON on stderr). With `measured` (pass 1's values): pass 2, which applies them in linear mode and
 * writes `out`, a 48 kHz stereo WAV. `filter` is the shaping chain; `loudness` the mode's { lufs, truePeakDb, lra }, the
 * true peak aimed 0.5 dB under the target for the AAC encode (scripts/lib/loudness.mjs ceilingFor).
 */
export function masterArgs({ wav, out, filter, loudness, measured }) {
  const af = masterChain({ filter, loudness, measured });
  if (measured === undefined) return [...MEASURE, ...fileInput(wav), '-af', af, '-f', 'null', '-'];
  return [...QUIET, '-y', ...fileInput(wav), '-af', af, '-ar', String(MASTER_RATE), '-c:a', 'pcm_s16le', out];
}

const lastLine = (text) => text.trim().split('\n').filter((l) => l.trim()).at(-1) ?? 'no output';

// Runs one ffmpeg step through `run` and fails with ffmpeg's last line and the audio hint when it does not exit 0.
async function step(run, args, what) {
  const { code, stderr } = await run(args);
  if (code !== 0) throw new AudioError(`${what}: ffmpeg failed (exit ${code}): ${lastLine(stderr)}`);
  return stderr;
}

// pass 1's values, each a plain number (they come from another program's output and go back into an argument).
function checkedMeasurement(stderr) {
  const measured = parseLoudnormJson(stderr);
  if (measured === null) throw new AudioError(`voice master: ffmpeg printed no loudness measurement (its last line: ${lastLine(stderr)})`);
  if (!Number.isFinite(Number(measured.input_i))) throw new AudioError('voice master: the narration is silent, so there is nothing to master');
  const bad = Object.entries(measured).find(([, value]) => !PLAIN_NUMBER.test(value));
  if (bad) throw new AudioError(`voice master: loudnorm measured ${bad[0]} as ${JSON.stringify(bad[1])}, not a number`);
  return measured;
}

/**
 * The two loudnorm passes over the voice track `wav` into `out`, through `run(args) -> Promise<{ code, stderr }>`
 * (ffmpegRunner). Resolves pass 1's measurement; rejects with ffmpeg's words and a hint when a pass fails.
 */
export async function masterVoice({ run, wav, out, filter, loudness }) {
  const measured = checkedMeasurement(await step(run, masterArgs({ wav, out, filter, loudness }), 'voice master'));
  await step(run, masterArgs({ wav, out, filter, loudness, measured }), 'voice master');
  return measured;
}

// ---- the film's voice, end to end --------------------------------------------------------------------------------------

// The shot WAVs of a sidecar as absolute paths beside it (null for a shot without narration). A sidecar names its WAVs
// by bare file names only (sidecar.mjs wavName); anything else is refused, never opened.
function shotWavs({ dir, sidecar }) {
  return sidecar.shots.map((shot) => {
    if (shot.wav === null) return { wav: null };
    if (typeof shot.wav !== 'string' || path.basename(shot.wav) !== shot.wav) throw new AudioError(`voice: the sidecar names the WAV ${JSON.stringify(shot.wav)}, not a file beside it`);
    return { wav: path.join(dir, shot.wav) };
  });
}

/**
 * Builds the film's voice track from `voice` ({ dir, sidecar }: what the voice stage made) on `timeline`, shapes and
 * masters it to `loudness` in `workDir`, and resolves the mastered WAV's path, or null when no shot has narration (then
 * there is no voice to put in the film).
 */
export async function masterTrack({ run, voice, timeline, loudness, workDir }) {
  const shots = shotWavs(voice);
  if (shots.every((s) => s.wav === null)) return null;
  const track = path.join(workDir, 'voice-track.wav');
  const master = path.join(workDir, 'voice-master.wav');
  await step(run, voiceTrackArgs({ shots, timeline, out: track }), 'voice mix');
  await masterVoice({ run, wav: track, out: master, filter: shapingFilter(voice.sidecar, timeline), loudness });
  return master;
}

/** The ffmpeg arguments of the mux: the video copied as it is, the mastered voice as AAC_AUDIO, `duration` seconds long. */
export function muxArgs({ video, audio, out, duration }) {
  return [...QUIET, '-y', ...fileInput(video), ...fileInput(audio), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', ...AAC_AUDIO,
    '-t', time(duration), '-movflags', '+faststart', out];
}

const loudnessArgs = (file) => [...MEASURE, ...fileInput(file), '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-'];

/**
 * Muxes the mastered voice `audio` into `video` as `out`, then measures the finished file: resolves
 * `{ lufs, truePeakDb }` as ebur128 reads them from `out`, never the targets echoed back.
 */
export async function muxVoice({ run, video, audio, out, duration }) {
  await step(run, muxArgs({ video, audio, out, duration }), 'voice mux');
  const level = parseLoudness(await step(run, loudnessArgs(out), 'voice loudness'));
  if (level === null) throw new AudioError('voice loudness: ffmpeg printed no ebur128 summary for the finished film');
  return { lufs: level.lufs, truePeakDb: level.truePeak };
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
