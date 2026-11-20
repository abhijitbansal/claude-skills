// The music bed: a beat grid fitted to the film's cuts (fitBeatGrid), a synthesised backing texture laid on that grid
// (renderBed: pulse, drift or tape), and a user's own music file checked and probed under the same rules as a user's
// recording (musicInput, reusing spec.mjs recordingFile and voice/master.mjs probeRecording, recordingProblem and
// recordingInput). The bed's samples come only from engine/seeded.mjs and arithmetic: the same grid, length and seed give
// the same bytes. No clock, no Math.random; child processes take argument arrays.
import { execFile } from 'node:child_process';
import { mulberry32 } from '../../../engine/seeded.mjs';
import { writeWav, WAV_RATE } from './wav.mjs';
import { findFfmpeg, findFfprobe, parseLoudness } from '../../lib/ffmpeg.mjs';
import { pinkNoise } from './cue-synth.mjs';
import { detectBeats, SAMPLE_RATE as BEAT_RATE, MAX_ANALYSIS_SECONDS } from '../../lib/beats.mjs';
import { SpecError, recordingFile } from '../spec.mjs';
import { MUSIC_FADE_SECONDS, probeRecording, recordingProblem, recordingInput } from '../voice/master.mjs';

const RATE = WAV_RATE; // the bed is synthesised at the rate wav.mjs writes
const TWO_PI = 2 * Math.PI;
const DT = 1 / RATE;
const PEAK = 0.5; // the bed is scaled to this peak before its fades
const FADE_IN = 0.5; // seconds
const FADE_OUT = 1; // seconds
const DEFAULT_TOLERANCE = 0.04;
const MAX_TOLERANCE = 0.5;
const SEARCH_BPM = Object.freeze([84, 132]); // the tempos searched when the film names none
const BPM_STEP = 0.01; // tempo resolution of the search
const DEFAULT_FPS = 30;
export const LAND_EPSILON = 1e-9; // so a cut exactly one frame from a beat lands (run.mjs counts a file's beats with it too)
const ROUNDING = 1e6; // bpm and offset are reported to 1e-6
const BEATS_PER_BAR = 4;
const MUSIC_PATH = 'music.src';
/** detectBeats' confidence a user's music must reach for its beats to be used (version 1 beats.mjs's own default gate). */
export const BEAT_MIN_CONFIDENCE = 0.5;
/** Seconds of fade at the end of a user's music, where it ends or where the film does. */
export const MUSIC_FADE_OUT = MUSIC_FADE_SECONDS; // the mix's fade (voice/master.mjs): one value, so where it starts and how long it runs agree
const DECODE_SLACK_BYTES = 1 << 20;
const FLOAT_BYTES = 4;
// ffmpeg's runs over a user's music (the beat decode, the loudness): longer than either takes on a long file, measured
// at under 2 s for a 5 minute track on the development Mac; past it the run is machine trouble, not the film's.
const MUSIC_TOOL_TIMEOUT_MS = 120000;
// ebur128's summary on stderr. Its per-frame log (a line every 100 ms of audio, about 1.7 KB a second) is off through the
// filter's framelog=quiet, so the stderr stays a few KB however long the file; -nostats only stops ffmpeg's progress line.
const MEASURE_MAX_BUFFER = 1 << 20;
const GATE_FLOOR_LUFS = -70; // ebur128's absolute gate: an integrated value at or under it measured nothing
const SECONDS_STEPS = 100; // a length in a message, to 0.01 s
const FFPROBE_HINT = 'install ffmpeg with its ffprobe (they come together), or set FFPROBE_PATH to an ffprobe you trust';

/** The synthesised beds a film may name. */
export const BEDS = Object.freeze(['pulse', 'drift', 'tape']);

const isPositive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0;
const mod = (x, m) => ((x % m) + m) % m;
const rounded = (x) => Math.round(x * ROUNDING) / ROUNDING;

// ---- the beat grid ----

function checkFit(cutTimes, { bpm, tolerance, seconds, fps }) {
  if (!Array.isArray(cutTimes)) throw new TypeError('fitBeatGrid: cutTimes must be an array of seconds');
  cutTimes.forEach((t, i) => { if (typeof t !== 'number' || !Number.isFinite(t)) throw new RangeError(`fitBeatGrid: cutTimes[${i}] must be a finite number, got ${String(t)}`); });
  if (!isPositive(seconds)) throw new RangeError(`fitBeatGrid: seconds must be a positive number, got ${String(seconds)}`);
  if (bpm !== undefined && !isPositive(bpm)) throw new RangeError(`fitBeatGrid: bpm must be a positive number, got ${String(bpm)}`);
  if (typeof tolerance !== 'number' || !(tolerance >= 0 && tolerance <= MAX_TOLERANCE)) {
    throw new RangeError(`fitBeatGrid: tolerance must be a number from 0 to ${MAX_TOLERANCE}, got ${String(tolerance)}`);
  }
  if (!isPositive(fps)) throw new RangeError(`fitBeatGrid: fps must be a positive number, got ${String(fps)}`);
}

// The tempos to try, nearest the centre first: so on equal counts the first one tried (the nearest) is kept.
function tempos(bpm, tolerance) {
  const [lo, hi] = bpm === undefined ? SEARCH_BPM : [bpm * (1 - tolerance), bpm * (1 + tolerance)];
  const centre = bpm ?? (lo + hi) / 2;
  const steps = Math.floor((Math.min(centre - lo, hi - centre) + LAND_EPSILON) / BPM_STEP);
  const list = [centre];
  for (let k = 1; k <= steps; k++) list.push(centre + k * BPM_STEP, centre - k * BPM_STEP);
  return list;
}

// The best phase for beats `period` apart: the most cuts within `frame` of a beat, then the least total distance. Tried
// phases put a cut on a beat, or one frame either side of it (so two cuts up to two frames apart can both land).
function bestPhase(cuts, period, frame) {
  let best = { offset: 0, landed: 0, error: Infinity };
  for (const cut of cuts) {
    for (const shift of [0, -frame, frame]) {
      const offset = mod(cut + shift, period);
      let landed = 0;
      let error = 0;
      for (const c of cuts) {
        const d = mod(c - offset, period);
        const distance = Math.min(d, period - d);
        if (distance <= frame + LAND_EPSILON) { landed += 1; error += distance; }
      }
      if (landed > best.landed || (landed === best.landed && error < best.error)) best = { offset, landed, error };
    }
  }
  return best;
}

/**
 * The beat grid that puts the most of `cutTimes` (film seconds; those outside 0 to `seconds` are not counted) within one
 * frame (1 / fps) of a beat: tempo searched within bpm x (1 +- tolerance) in BPM_STEP steps, or SEARCH_BPM when the film
 * names no bpm, ties going to the tempo nearest the requested one (the middle of SEARCH_BPM with none). -> { bpm, offset,
 * landed, cuts }: offset the first beat (0 up to one beat), landed and cuts the counts the report gives.
 */
export function fitBeatGrid(cutTimes, { bpm, tolerance = DEFAULT_TOLERANCE, seconds, fps = DEFAULT_FPS } = {}) {
  checkFit(cutTimes, { bpm, tolerance, seconds, fps });
  const cuts = cutTimes.filter((t) => t >= 0 && t <= seconds);
  const frame = 1 / fps;
  const order = tempos(bpm, tolerance);
  let best = { bpm: order[0], offset: 0, landed: 0 };
  for (const tempo of order) {
    const fit = bestPhase(cuts, 60 / tempo, frame);
    if (fit.landed > best.landed) best = { bpm: tempo, offset: fit.offset, landed: fit.landed };
  }
  const period = 60 / best.bpm;
  const offset = period - best.offset < 1 / ROUNDING ? 0 : rounded(best.offset);
  return { bpm: rounded(best.bpm), offset, landed: best.landed, cuts: cuts.length };
}

// ---- the beds ----

// The beats of `grid` from 0 up to `seconds`, in seconds.
function beatsOf(grid, seconds) {
  const period = 60 / grid.bpm;
  const beats = [];
  for (let t = mod(grid.offset, period); t < seconds; t += period) beats.push(t);
  return beats;
}

// Adds `voice(i)` (i samples from its start, `length` long) into `xs` from second `t`.
function addAt(xs, t, length, voice) {
  const start = Math.round(t * RATE);
  for (let i = 0; i < length && start + i < xs.length; i++) xs[start + i] += voice(i);
}

// pulse: a soft kick on each beat (a sine gliding from 110 Hz to 45 Hz with a 0.5 ms attack) and a short seeded noise
// tick on each off-beat; mono, the same in both channels.
const KICK = Object.freeze({ seconds: 0.25, beatShare: 0.8, from: 110, to: 45, glide: 0.03, decay: 9, attack: 0.0005 });
const TICK = Object.freeze({ seconds: 0.02, tau: 0.004, level: 0.25 });

function pulse({ grid, length, seconds, seed }) {
  const xs = new Float64Array(length);
  const period = 60 / grid.bpm;
  const kickLength = Math.round(Math.min(KICK.seconds, KICK.beatShare * period) * RATE);
  const noise = mulberry32(seed);
  for (const beat of beatsOf(grid, seconds)) {
    let phase = 0;
    addAt(xs, beat, kickLength, (i) => {
      const t = i * DT;
      phase += TWO_PI * (KICK.to + (KICK.from - KICK.to) * Math.exp(-t / KICK.glide)) * DT;
      return Math.sin(phase) * Math.min(1, t / KICK.attack) * Math.exp(-t * KICK.decay) * (1 - i / kickLength);
    });
    let last = 0;
    addAt(xs, beat + period / 2, Math.round(TICK.seconds * RATE), (i) => {
      const n = noise() * 2 - 1;
      const edge = n - last; // differenced: bright
      last = n;
      return TICK.level * edge * Math.exp(-(i * DT) / TICK.tau);
    });
  }
  return { left: xs, right: xs };
}

// drift: a two-note pad, the pair changing on every bar of BEATS_PER_BAR beats (never the same pair twice running),
// each bar crossfading into the next over PAD.crossfade seconds; the right channel is detuned a little from the left.
const PAD_PAIRS = Object.freeze([[220, 329.63], [174.61, 261.63], [261.63, 392], [196, 293.66], [146.83, 220], [164.81, 246.94]]);
const PAD = Object.freeze({ crossfade: 0.08, detune: 0.004, partials: [[1, 1], [2, 0.3], [3, 0.12]] });

/** The drift pad's bars: [{ start, notes: [hz, hz] }], start the bar's downbeat in seconds; the pair is seeded. */
export function padNotes({ grid, seconds, seed }) {
  const barLength = (BEATS_PER_BAR * 60) / grid.bpm;
  const first = mod(grid.offset, 60 / grid.bpm);
  const rng = mulberry32(seed);
  const bars = [];
  let index = Math.floor(rng() * PAD_PAIRS.length);
  for (let start = first; bars.length === 0 || start < seconds; start += barLength) {
    if (bars.length > 0) index = (index + 1 + Math.floor(rng() * (PAD_PAIRS.length - 1))) % PAD_PAIRS.length;
    bars.push(Object.freeze({ start, notes: PAD_PAIRS[index] }));
  }
  return Object.freeze(bars);
}

const padTone = (notes, t, detune) => notes.reduce((sum, hz) => sum
  + PAD.partials.reduce((s, [ratio, level]) => s + level * Math.sin(TWO_PI * hz * ratio * (1 + detune) * t), 0), 0);

function drift({ grid, length, seconds, seed }) {
  const bars = padNotes({ grid, seconds, seed });
  const left = new Float64Array(length);
  const right = new Float64Array(length);
  const xf = PAD.crossfade;
  bars.forEach((bar, k) => {
    const from = k === 0 ? 0 : bar.start;
    const to = Math.min(seconds, k + 1 < bars.length ? bars[k + 1].start + xf : seconds);
    for (let i = Math.round(from * RATE); i < Math.min(length, Math.round(to * RATE)); i++) {
      const t = i * DT;
      const gain = Math.min(1, k === 0 ? 1 : (t - from) / xf, k + 1 < bars.length ? (to - t) / xf : 1);
      left[i] += gain * padTone(bar.notes, t, 0);
      right[i] += gain * padTone(bar.notes, t, PAD.detune);
    }
  });
  return { left, right };
}

// tape: seeded pink noise in each channel through a one-pole low-pass, under a tremolo whose peaks fall on the beats.
const TAPE = Object.freeze({ lowPassHz: 900, depth: 0.3 });

function tapeChannel(noise, length, grid) {
  const a = 1 - Math.exp((-TWO_PI * TAPE.lowPassHz) / RATE);
  const period = 60 / grid.bpm;
  let low = 0;
  return Float64Array.from({ length }, (_, i) => {
    low += a * (noise() - low);
    const tremolo = 1 - TAPE.depth + TAPE.depth * (0.5 + 0.5 * Math.cos((TWO_PI * (i * DT - grid.offset)) / period));
    return low * tremolo;
  });
}

function tape({ grid, length, seed }) {
  const rng = mulberry32(seed);
  return { left: tapeChannel(pinkNoise(rng), length, grid), right: tapeChannel(pinkNoise(rng), length, grid) };
}

const BED_VOICES = Object.freeze({ pulse, drift, tape });

// Both channels scaled together to PEAK, then faded in over FADE_IN and out over FADE_OUT (linear, to exactly 0).
function finished({ left, right }) {
  const top = Math.max(...[left, right].map((xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0)));
  const scale = top === 0 ? 0 : PEAK / top;
  const n = left.length;
  const gain = (i) => scale * Math.max(0, Math.min(1, i / (FADE_IN * RATE), (n - 1 - i) / (FADE_OUT * RATE)));
  return { left: left.map((x, i) => x * gain(i)), right: right.map((x, i) => x * gain(i)) };
}

function checkBed({ bed, grid, seconds, seed }) {
  if (!BEDS.includes(bed)) throw new RangeError(`renderBed: unknown bed ${JSON.stringify(bed)}; beds: ${BEDS.join(', ')}`);
  if (!isPositive(grid?.bpm)) throw new RangeError(`renderBed: grid.bpm must be a positive number, got ${String(grid?.bpm)}`);
  if (typeof grid.offset !== 'number' || !Number.isFinite(grid.offset)) throw new RangeError(`renderBed: grid.offset must be a finite number, got ${String(grid.offset)}`);
  if (!isPositive(seconds)) throw new RangeError(`renderBed: seconds must be a positive number, got ${String(seconds)}`);
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new RangeError(`renderBed: seed must be a finite number, got ${String(seed)}`);
}

/**
 * Writes `out`: a 48 kHz stereo 16-bit WAV `seconds` long of `bed` on `grid` ({ bpm, offset }, fitBeatGrid's), seeded
 * by `seed` (the film seed): peak PEAK, a FADE_IN fade in and a FADE_OUT fade out. -> Promise<out>.
 */
export async function renderBed({ bed, grid, seconds, seed, out }) {
  checkBed({ bed, grid, seconds, seed });
  const { left, right } = finished(BED_VOICES[bed]({ grid, seconds, seed, length: Math.round(seconds * RATE) }));
  return writeWav(out, left, right);
}

// ---- a user's own music ----

/**
 * The ffmpeg arguments that decode the music `file` for beat detection: mono 22050 Hz float on stdout, as
 * scripts/lib/beats.mjs decodePcm decodes, but opened through recordingInput (the file protocol and the accepted audio
 * demuxers only), which decodePcm cannot take.
 */
export const musicDecodeArgs = (file) => ['-v', 'error', '-nostdin', ...recordingInput(file), '-map', '0:a:0',
  '-t', String(MAX_ANALYSIS_SECONDS), '-ac', '1', '-ar', String(BEAT_RATE), '-f', 'f32le', 'pipe:1'];

// ffmpeg over the music file -> { stdout, stderr }. ffmpeg itself refusing the file (a non-zero exit) is the film's
// problem, a SpecError at music.src; ffmpeg not starting, killed (the timeout) or overflowing is machine trouble, as is a
// stop (the signal's reason).
function musicTool(ffmpeg, args, { src, what, maxBuffer, encoding, signal }) {
  const options = { encoding, maxBuffer, signal, timeout: MUSIC_TOOL_TIMEOUT_MS };
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, args, options, (err, stdout, stderr) => {
      if (err?.name === 'AbortError') return reject(err);
      if (err && (typeof err.code !== 'number' || err.killed)) return reject(new Error(`ffmpeg could not ${what} ${JSON.stringify(src)}: ${err.message}`, { cause: err }));
      if (err) {
        const why = String(stderr ?? '').split('\n').find((line) => line.trim())?.trim() ?? err.message;
        return reject(new SpecError([{ path: MUSIC_PATH, message: `${JSON.stringify(src)} cannot be decoded: ${why}` }]));
      }
      return resolve({ stdout, stderr: String(stderr ?? '') });
    });
  });
}

// The music decoded (musicDecodeArgs) as samples.
async function decodeMusic(ffmpeg, file, src, signal) {
  const maxBuffer = MAX_ANALYSIS_SECONDS * BEAT_RATE * FLOAT_BYTES + DECODE_SLACK_BYTES;
  const { stdout } = await musicTool(ffmpeg, musicDecodeArgs(file), { src, what: 'decode', maxBuffer, encoding: 'buffer', signal });
  const count = Math.floor(stdout.length / FLOAT_BYTES);
  return Float32Array.from({ length: count }, (_, i) => {
    const v = stdout.readFloatLE(i * FLOAT_BYTES);
    return Number.isFinite(v) ? v : 0;
  });
}

/** The ffmpeg arguments that measure the music `file`'s loudness (ebur128) over its first `seconds` (all of it without). */
export const musicLoudnessArgs = (file, seconds) => ['-hide_banner', '-nostats', '-nostdin', ...recordingInput(file), '-map', '0:a:0',
  ...(seconds === undefined ? [] : ['-t', String(seconds)]), '-map_metadata', '-1', '-af', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'];

// The music's integrated loudness over the part the film plays (LUFS). Nothing over the measurement gate there is the
// film's mistake: a silent file under the voice would be mixed and reported as music (final review I4).
async function musicLoudness(ffmpeg, file, src, seconds, signal) {
  const { stderr } = await musicTool(ffmpeg, musicLoudnessArgs(file, seconds), { src, what: 'measure', maxBuffer: MEASURE_MAX_BUFFER, encoding: 'utf8', signal });
  const lufs = parseLoudness(stderr)?.lufs;
  if (!Number.isFinite(lufs) || lufs <= GATE_FLOOR_LUFS) {
    const span = seconds === undefined ? '' : ` in its first ${Math.round(seconds * SECONDS_STEPS) / SECONDS_STEPS} s, the film's length`;
    throw new SpecError([{ path: MUSIC_PATH, message: `${JSON.stringify(src)} has no sound${span}: nothing in it reaches the ${GATE_FLOOR_LUFS} LUFS measurement gate; name a file with music in it` }]);
  }
  return lufs;
}

// The detected beats, or null when there is no steady beat (no sound, too short, or confidence under the gate).
function detected(pcm) {
  const found = detectBeats(pcm);
  return found.beats.length >= 2 && found.confidence >= BEAT_MIN_CONFIDENCE ? found.beats : null;
}

async function toolsFor({ ffmpeg, ffprobe }) {
  const found = ffmpeg ?? await findFfmpeg();
  const probe = ffprobe ?? findFfprobe({ ffmpeg: found });
  if (probe === null) throw Object.assign(new Error('ffprobe not found: it is needed to check a music file of your own'), { hint: FFPROBE_HINT });
  return { ffmpeg: found, ffprobe: probe };
}

/**
 * A film's own music, `music: { src }` relative to `dir` (the film's folder): checked as a user's recording is (a regular,
 * readable file whose real path is inside the folder: spec.mjs recordingFile), probed by ffprobe before anything decodes
 * it (plain audio of an accepted format, one audio stream: voice/master.mjs probeRecording, recordingProblem), its
 * loudness measured over its first `seconds` (the film's length; all of it without), then decoded through the same
 * whitelists for beat detection (scripts/lib/beats.mjs detectBeats). -> { file: its real path (the only path that may
 * reach ffmpeg), seconds: its length, lufs: its loudness, beats: seconds, or null with no steady beat }. A problem with
 * the file, a silent one among them, is a SpecError at music.src. `ffmpeg`, `ffprobe` default to the ones found on
 * this machine. `beats`: the grid of the film's music.beats file, used as given (nothing is decoded for detection);
 * `detect`: the detector, pcm -> beats or null (default: detectBeats behind the confidence gate).
 */
export async function musicInput(film, dir, { ffmpeg, ffprobe, signal, seconds, beats, detect = detected } = {}) {
  const src = film?.music?.src;
  if (typeof src !== 'string' || src === '') throw new TypeError('musicInput: the film\'s music has no src');
  const read = recordingFile(src, MUSIC_PATH, dir);
  if (read.error) throw new SpecError([read.error]);
  const tools = await toolsFor({ ffmpeg, ffprobe });
  const probe = await probeRecording({ ffprobe: tools.ffprobe, file: read.real, signal });
  const problem = recordingProblem(probe, 0, { what: 'music file' });
  if (problem !== null) throw new SpecError([{ path: MUSIC_PATH, message: `${JSON.stringify(src)} ${problem}` }]);
  const lufs = await musicLoudness(tools.ffmpeg, read.real, src, seconds, signal);
  if (Array.isArray(beats)) return { file: read.real, seconds: probe.duration, lufs, beats: [...beats] };
  const pcm = await decodeMusic(tools.ffmpeg, read.real, src, signal);
  return { file: read.real, seconds: probe.duration, lufs, beats: detect(pcm) };
}

/**
 * Where a user's music of `musicSeconds` ends in a film of `filmSeconds`: at its own end when it is shorter (`short`, for
 * the report), else at the film's end; either way with a MUSIC_FADE_OUT fade from `fadeFrom`. -> { end, fadeFrom, short }.
 */
export function musicEnd(musicSeconds, filmSeconds) {
  if (!isPositive(musicSeconds) || !isPositive(filmSeconds)) {
    throw new RangeError(`musicEnd: both lengths must be positive numbers, got ${String(musicSeconds)} and ${String(filmSeconds)}`);
  }
  const end = Math.min(musicSeconds, filmSeconds);
  return { end, fadeFrom: Math.max(0, end - MUSIC_FADE_OUT), short: musicSeconds < filmSeconds };
}
