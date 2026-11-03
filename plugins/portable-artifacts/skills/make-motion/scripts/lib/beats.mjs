// Beat detection, Node side: decode an audio file with ffmpeg, turn it into an onset envelope (spectral flux over our own
// radix-2 FFT), read the tempo off the envelope's autocorrelation and lay a steady beat grid over it. Pure functions on
// plain arrays, so a test can feed them a click track. No dependency beyond ffmpeg.
import { spawnSync } from 'node:child_process';
import { fileInput } from './ffmpeg.mjs';
import { UsageError } from '../../shared/cli.mjs';

export const SAMPLE_RATE = 22050;
export const FRAME = 1024; // samples per analysis window (a power of two)
export const HOP = 512; // samples between windows: 23 ms
export const MIN_BPM = 60;
export const MAX_BPM = 200;
export const MAX_ANALYSIS_SECONDS = 300; // the first five minutes of a longer track; a video is at most two
const BYTES_PER_SAMPLE = 4;
const DECODE_SLACK_BYTES = 1 << 20;
const BEAT_DECIMALS = 1e3; // a beat is written to the millisecond
const PHASE_STEPS_PER_FRAME = 4;
const REFINE_SPAN = 0.06; // the grid search looks this far (a share of the tempo) either side of the autocorrelation's pick
const REFINE_STEP_SHARE = 0.25; // candidate tempos are this share of the score's peak width apart (peak width is about 1 / frames)
const REFINE_START_FRAMES = 600; // about 14 s: the first stretch the tempo is searched over
const REFINE_GROWTH = 4;
const REFINE_NEIGHBOURS = 4; // each longer stretch searches this many of the previous stretch's steps either side
const SMOOTHING = [0.25, 0.5, 1, 0.5, 0.25];
// The onset envelope sums the rise of each frequency's magnitude, each bin weighted 1 / (1 + (f / BAND_CORNER_HZ)^2): a
// broadband hat raises hundreds of high bins and a kick a few low ones, so unweighted the hats outweigh the kick and the
// grid locks onto the off-beat. (Log-compressing the magnitudes instead was measured and made ghost notes and timbres worse.)
const BAND_CORNER_HZ = 850;
// A lag's salience is the mean of the autocorrelation at 1 to COMB_TERMS times the lag (a pulse train, as Ellis and Klapuri
// score tempi): a lag of 1.5 beats then loses to the beat, since 3 beats is the only multiple of it that is a beat.
const COMB_TERMS = 4;
const PEAK_SHARE = 0.25; // a lag is a candidate only where its own autocorrelation is at least this share of the range's largest
// Two tempo priors, both log-normal bumps. The first picks which pulse family a peak belongs to (wide, so a 1.5-beat
// peak near 120 does not beat the beat at 170); the second picks the octave within the family (centred, narrower on
// the fast side: above about 150 BPM a pulse is rarely the felt beat unless it is steady).
const PRIOR_BPM = 120;
const PRIOR_OCTAVES = 1;
const OCTAVE_BPM = 120;
const OCTAVE_SPREAD_SLOW = 0.6; // octaves
const OCTAVE_SPREAD_FAST = 0.35;
// Grid drift: the span is read in thirds, and the grid's best phase in each third may differ from the others by this
// share of a beat before the grid is called drifting (a wrong tempo, a tempo change); the confidence is then cut below the gate.
export const DRIFT_LIMIT = 0.125;
const DRIFT_CONFIDENCE = 0.4;
const DRIFT_MIN_BEATS = 4; // beats a third needs for its phase to count
const STEADY = 0.9; // an even pulse: the weaker half of its beats is at least this share of the stronger
const OCTAVE_SHARE = 0.3; // an octave candidate is at least this share as periodic as the strongest of them
// The sound's extent, from the frame level: a frame is sound above a floor that is a few times the quiet 5th percentile
// (the room tone, 0 for digital silence) but never above a tenth of the loud 95th, and never below -66 dBFS.
const ABSOLUTE_FLOOR = 0.0005;
const NOISE_MARGIN = 3;
const QUIET_SHARE = 0.1;
const LOW_PERCENTILE = 0.05;
const HIGH_PERCENTILE = 0.95;
// A forced tempo's fit (gridFit): its grid is compared, in each third of the sound, with the same grid moved off the beat
// by more than FIT_OFF_BEAT of a beat. On the plain flux the chance level is the mean of the moved grids; the weighted
// envelope rests on a few low bins, so noise moves it more and its chance level is the FIT_CHANCE_WEIGHTED quantile.
const FIT_OFF_BEAT = 1 / 8;
const FIT_PARTS = 3;
const FIT_CHANCE_WEIGHTED = 0.75;
/** The tempo limits a caller may ask for (`--bpm`, `--min-bpm`, `--max-bpm`); the search defaults to MIN_BPM to MAX_BPM. */
export const BPM_LIMITS = Object.freeze([30, 300]);

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * ffmpeg arguments that decode `file` to mono 22050 Hz little-endian float samples on stdout. The file is read through
 * the file and pipe protocols only (ffmpeg sniffs content, so a playlist renamed to .mp3 must not make it fetch a URL).
 */
export const decodeArgs = (file) => ['-v', 'error', '-nostdin', ...fileInput(file), '-map', '0:a:0', '-t', String(MAX_ANALYSIS_SECONDS), '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'];

const firstLine = (text) => String(text ?? '').split('\n').find((l) => l.trim())?.trim();

/** Throws a UsageError for an audio path that is empty or starts with "-": ffmpeg and the shell could read it as an option. */
export function checkAudioPath(file) {
  if (typeof file !== 'string' || file === '' || file.startsWith('-')) {
    throw new UsageError(`the audio path ${JSON.stringify(file)} starts with "-" (or is empty); write it as ./name or give an absolute path`);
  }
}

/** The samples of `file`'s first audio stream as a Float32Array (mono, 22050 Hz). */
export function decodePcm(ffmpeg, file) {
  checkAudioPath(file);
  const r = spawnSync(ffmpeg, decodeArgs(file), { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_ANALYSIS_SECONDS * SAMPLE_RATE * BYTES_PER_SAMPLE + DECODE_SLACK_BYTES });
  if (r.status !== 0) throw new Error(`ffmpeg cannot decode ${file}: ${firstLine(r.stderr?.toString()) ?? r.error?.message ?? `exit ${r.status}`}`);
  const count = Math.floor(r.stdout.length / BYTES_PER_SAMPLE);
  if (count === 0) throw new Error(`ffmpeg decoded no audio from ${file}`);
  const pcm = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const v = r.stdout.readFloatLE(i * BYTES_PER_SAMPLE); // explicit little endian: the same samples on every machine
    pcm[i] = Number.isFinite(v) ? v : 0;
  }
  return pcm;
}

// An in-place complex FFT of `size` points (a power of two): iterative radix-2, twiddles and bit order computed once.
function makeFft(size) {
  if (!Number.isInteger(Math.log2(size)) || size < 2) throw new RangeError(`FFT size must be a power of two (got ${size})`);
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / size);
    sin[i] = -Math.sin((2 * Math.PI * i) / size);
  }
  const bits = Math.log2(size);
  const order = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let reversed = 0;
    for (let b = 0; b < bits; b++) reversed |= ((i >> b) & 1) << (bits - 1 - b);
    order[i] = reversed;
  }
  return (re, im) => {
    for (let i = 0; i < size; i++) {
      const j = order[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let span = 2; span <= size; span *= 2) {
      const half = span / 2;
      const step = size / span;
      for (let start = 0; start < size; start += span) {
        for (let k = 0; k < half; k++) {
          const a = start + k;
          const b = a + half;
          const wr = cos[k * step];
          const wi = sin[k * step];
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  };
}

/**
 * The onset envelope of `pcm`: one value per hop, the spectral flux (the rise of each frequency's magnitude since the
 * window before, half-wave rectified: a fall counts for nothing) summed over the frequencies with a weight that falls
 * above BAND_CORNER_HZ, normalised so the largest value is 1. A clip shorter than one frame has no values; silence is
 * all zeros. `weighted: false` sums every frequency alike (the plain flux, which a forced tempo's fit also reads).
 */
export function onsetEnvelope(pcm, { frame = FRAME, hop = HOP, weighted = true } = {}) {
  const fft = makeFft(frame);
  const frames = pcm.length >= frame ? Math.floor((pcm.length - frame) / hop) + 1 : 0;
  const window = Float64Array.from({ length: frame }, (_, n) => 0.5 * (1 - Math.cos((2 * Math.PI * n) / frame)));
  const bins = frame / 2 + 1;
  const weight = Float64Array.from({ length: bins }, (_, k) => (weighted ? 1 / (1 + ((k * SAMPLE_RATE) / frame / BAND_CORNER_HZ) ** 2) : 1));
  const env = new Float32Array(frames);
  const re = new Float64Array(frame);
  const im = new Float64Array(frame);
  let previous = new Float64Array(bins);
  let current = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    for (let n = 0; n < frame; n++) {
      re[n] = pcm[f * hop + n] * window[n];
      im[n] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 0; k < bins; k++) {
      current[k] = Math.hypot(re[k], im[k]);
      if (f > 0 && current[k] > previous[k]) flux += weight[k] * (current[k] - previous[k]);
    }
    env[f] = flux;
    [previous, current] = [current, previous];
  }
  const peak = env.reduce((m, v) => Math.max(m, v), 0);
  if (peak > 0) for (let f = 0; f < frames; f++) env[f] /= peak;
  return env;
}

// What rises above the envelope's own average: the onsets, with the steady background taken away.
function onsetsOf(env) {
  const mean = env.reduce((a, v) => a + v, 0) / (env.length || 1);
  return Float32Array.from(env, (v) => Math.max(0, v - mean));
}

// `values` smoothed with a five-tap triangle (a quarter, a half, 1, a half, a quarter, as shares of the centre). A sharp
// transient lands inside one frame and its repeats fall on whole frames only by luck, so the autocorrelation at whole
// lags misses a pulse whose period is not a whole number of frames; spread over five frames it does not.
function smoothed(values) {
  return Float32Array.from(values, (_, i) => SMOOTHING.reduce((sum, weight, k) => sum + weight * (values[i + k - 2] ?? 0), 0));
}

// The envelope at a fractional frame, read by linear interpolation; outside it, 0.
function valueAt(values, index) {
  const i = Math.floor(index);
  if (i < 0 || i >= values.length) return 0;
  const next = i + 1 < values.length ? values[i + 1] : 0;
  return values[i] + (index - i) * (next - values[i]);
}

// The phase (in frames, 0 up to one period) whose beats, a `period` frames apart, sit on the most envelope on average.
function bestPhase(values, period) {
  let best = { phase: 0, score: -1 };
  const steps = Math.max(1, Math.ceil(period * PHASE_STEPS_PER_FRAME));
  for (let s = 0; s < steps; s++) {
    const phase = s / PHASE_STEPS_PER_FRAME;
    let sum = 0;
    let beats = 0;
    for (let at = phase; at <= values.length - 1; at += period) {
      sum += valueAt(values, at);
      beats++;
    }
    const score = beats ? sum / beats : 0;
    if (score > best.score) best = { phase, score };
  }
  return best;
}

// Autocorrelation of `values` at lags `from` to `to` (inclusive), each averaged over the pairs it has.
function autocorrelation(values, from, to) {
  const ac = new Float64Array(to + 1);
  for (let lag = from; lag <= to; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < values.length; i++) sum += values[i] * values[i + lag];
    ac[lag] = sum / (values.length - lag);
  }
  return ac;
}

const priorWeight = (bpm) => Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2);

// Parabolic peak position (in frames, fractional) of the autocorrelation around integer lag `lag`.
function peakLag(ac, lag) {
  const [a, b, c] = [ac[lag - 1], ac[lag], ac[lag + 1]];
  const bend = a - 2 * b + c;
  return lag + (bend < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / bend)) : 0);
}

// The best autocorrelation lag within one lag of the (fractional) `centre`, inside the range.
function nearestPeak(ac, centre, minLag, maxLag) {
  let best = Math.max(minLag, Math.floor(centre) - 1);
  for (let lag = best; lag <= Math.min(maxLag, Math.ceil(centre) + 1); lag++) if (ac[lag] > ac[best]) best = lag;
  return best;
}

// The tempo near `bpm` whose beat grid sits on the most onset: the autocorrelation's pick is good to about half a frame,
// which is several BPM; the grid pins it to a fraction of one. A tempo error shows as drift that adds up over the track,
// so the grid's score peaks more narrowly the longer the stretch it is read over (about 1 / frames). The search therefore
// grows its stretch in steps: a short start of the track with a wide span, then 4 times longer with a span of a few steps
// of the last, down to the whole track. Stays in [minBpm, maxBpm].
function refineTempo(values, bpm, hopSeconds, [minBpm, maxBpm]) {
  let best = bpm;
  let span = REFINE_SPAN;
  for (let length = Math.min(values.length, REFINE_START_FRAMES); ; length = Math.min(values.length, length * REFINE_GROWTH)) {
    const part = values.subarray(0, length);
    const step = REFINE_STEP_SHARE / length;
    let top = -1;
    let centre = best;
    for (let ratio = 1 - span; ratio <= 1 + span + 1e-12; ratio += step) {
      const candidate = best * ratio;
      if (candidate < minBpm || candidate > maxBpm) continue;
      const { score } = bestPhase(part, 60 / candidate / hopSeconds);
      if (score > top + 1e-12) { top = score; centre = candidate; }
    }
    best = centre;
    if (length >= values.length) return best;
    span = (REFINE_NEIGHBOURS * REFINE_STEP_SHARE) / length;
  }
}

// How even the pulse at `bpm` is: the grid's beats (at its best phase, inside `span` when given) alternate even and odd;
// the weaker parity's mean strength over the stronger's. 1 for a steady pulse, low for a pulse that is really half as
// fast with weaker hits between its beats, 0 when it cannot be told.
function evenness(smooth, values, bpm, hopSeconds, span) {
  const period = 60 / bpm / hopSeconds;
  const { phase } = bestPhase(values, period);
  const sum = [0, 0];
  const count = [0, 0];
  let k = 0;
  for (let frame = phase; frame <= smooth.length - 1; frame += period, k++) {
    if (span && (frame < span.first - period / 2 || frame > span.last + period / 2)) continue;
    const at = Math.round(frame);
    sum[k % 2] += Math.max(smooth[at - 1] ?? 0, smooth[at] ?? 0, smooth[at + 1] ?? 0);
    count[k % 2]++;
  }
  if (!count[0] || !count[1]) return 0;
  const [a, b] = [sum[0] / count[0], sum[1] / count[1]];
  return Math.max(a, b) > 0 ? Math.min(a, b) / Math.max(a, b) : 0;
}

// How far the grid at `bpm` drifts across the sound, as a share of a beat: the best phase of the grid is found again in
// each third of `span` (the beats of that third only, within a quarter beat of the whole grid's) and the largest difference between the
// thirds is the drift. 0 for a clip too short to give each third DRIFT_MIN_BEATS beats. A grid at the right tempo has no
// drift; one a few percent off, or across a tempo change, slides by a good part of a beat.
function gridDrift(smooth, values, bpm, hopSeconds, span) {
  const period = 60 / bpm / hopSeconds;
  const { phase } = bestPhase(values, period);
  const first = span ? Math.max(0, span.first) : 0;
  const last = span ? Math.min(smooth.length - 1, span.last) : smooth.length - 1;
  const third = (last - first) / 3;
  if (!(third / period >= DRIFT_MIN_BEATS)) return 0;
  const shifts = [];
  for (let part = 0; part < 3; part++) {
    const from = first + part * third;
    const beats = [];
    for (let frame = phase + Math.ceil((from - phase) / period) * period; frame < from + third; frame += period) beats.push(frame);
    let best = { shift: 0, score: -1 };
    for (let shift = -period / 4; shift <= period / 4; shift += 1 / PHASE_STEPS_PER_FRAME) { // a quarter beat either way: a slide, not a jump to the off-beat
      const score = beats.reduce((sum, frame) => sum + valueAt(smooth, frame + shift), 0);
      if (score > best.score) best = { shift, score };
    }
    shifts.push(best.shift);
  }
  return (Math.max(...shifts) - Math.min(...shifts)) / period;
}

// A tempo and its confidence, cut when the grid drifts: capped below the default gate, and lower the more it drifts.
// `confidenceBeforeDrift` keeps the uncut value, so a message can tell a drifting grid from one that never fitted.
const judged = (bpm, confidence, drift) => ({
  bpm,
  confidence: drift > DRIFT_LIMIT ? Math.min(confidence, (DRIFT_CONFIDENCE * DRIFT_LIMIT) / drift) : confidence,
  confidenceBeforeDrift: confidence,
  drift,
});
const NO_TEMPO = Object.freeze({ bpm: 0, confidence: 0, confidenceBeforeDrift: 0, drift: 0 });

// `{ bpm, confidence }`-style helper: how far the autocorrelation peak at `lag` (the best of the lag and its neighbours)
// stands above the average over the whole lag range, as a share of the peak (1 - mean / peak, 0 to 1).
function peakConfidence(ac, lag, minLag, maxLag) {
  let mean = 0;
  for (let l = minLag; l <= maxLag; l++) mean += ac[l];
  mean /= maxLag - minLag + 1;
  const at = Math.round(lag);
  const peak = Math.max(ac[at - 1] ?? 0, ac[at] ?? 0, ac[at + 1] ?? 0);
  return peak > 0 ? clamp01(1 - mean / peak) : 0;
}

/**
 * `{ bpm, confidence }` of an onset envelope sampled every `hopSeconds`, searching `minBpm` to `maxBpm` (default MIN_BPM
 * to MAX_BPM). The tempo is the strongest peak of the autocorrelation of the (lightly smoothed) onsets, weighted by the
 * tempo prior and the autocorrelation at its multiples (a pulse train), refined against the beat grid. A peak and its
 * half or double often correlate alike, so the octave is then chosen (chooseOctave): a steady faster pulse is the tempo;
 * otherwise the narrower octave prior decides. confidence is how far the peak
 * stands above the autocorrelation's average over the range, as a share of the peak (1 - mean / peak, 0 to 1), measured
 * on the unsmoothed onsets: near 0 for noise, high for any steady pulse however busy its hats. `span` (frames) limits what
 * the evenness test reads to the sound. `drift` is the grid's drift (gridDrift), which cuts the confidence; `confidenceBeforeDrift`
 * is the confidence before that cut. An envelope too short to hold two beats at the slowest tempo gives { bpm: 0, confidence: 0 }.
 */
export function estimateTempo(env, hopSeconds, { minBpm = MIN_BPM, maxBpm = MAX_BPM, span } = {}) {
  const minLag = Math.max(2, Math.floor(60 / maxBpm / hopSeconds));
  const maxLag = Math.ceil(60 / minBpm / hopSeconds);
  if (env.length < 2 * maxLag + 2) return { ...NO_TEMPO };
  const values = onsetsOf(env);
  const smooth = smoothed(values);
  const combMax = Math.min(COMB_TERMS * maxLag + 1, Math.floor(env.length / 2));
  const ac = autocorrelation(smooth, minLag - 1, Math.max(combMax, maxLag + 1));
  const largest = Math.max(...Array.from({ length: maxLag - minLag + 1 }, (_, i) => ac[minLag + i]));
  const salience = (lag) => {
    if (Math.max(ac[Math.floor(lag)], ac[Math.ceil(lag)]) < PEAK_SHARE * largest) return 0; // half of a real period has no peak of its own
    let sum = 0;
    let terms = 0;
    for (let m = 1; m <= COMB_TERMS && m * lag <= combMax; m++, terms++) sum += Math.max(ac[Math.floor(m * lag)], ac[Math.ceil(m * lag)]);
    return (sum / terms) * priorWeight(60 / (lag * hopSeconds));
  };
  let base = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) if (salience(lag) > salience(base)) base = lag;
  if (!(ac[base] > 0)) return { ...NO_TEMPO };
  const bounds = [minBpm, maxBpm];
  const refined = new Map();
  const tempoOf = (lag) => {
    if (!refined.has(lag)) refined.set(lag, refineTempo(values, 60 / (peakLag(ac, lag) * hopSeconds), hopSeconds, bounds));
    return refined.get(lag);
  };
  const lag = chooseOctave({ ac, base, minLag, maxLag, hopSeconds, evenAt: (l) => evenness(smooth, values, tempoOf(l), hopSeconds, span) });
  const bpm = Math.min(maxBpm, Math.max(minBpm, tempoOf(lag))); // a lag at the edge of the range can round just outside it
  const rawAc = autocorrelation(values, minLag - 1, maxLag + 1);
  const drift = gridDrift(smooth, values, bpm, hopSeconds, span);
  return judged(bpm, peakConfidence(rawAc, 60 / bpm / hopSeconds, minLag, maxLag), drift);
}

// The octave decision. `base` is the prior-weighted peak; its half and its double (a peak near each, in range) are the
// candidates when they are at least OCTAVE_SHARE as periodic as the strongest. The fastest candidate that is steady (its
// beats alternate no weaker than STEADY of each other) wins: a clicking pulse such as 180 BPM is the beat, where ghost
// notes between the beats of 90 BPM (uneven) are not. Otherwise the candidate with the most periodicity under the octave
// prior wins. Returns the lag.
function chooseOctave({ ac, base, minLag, maxLag, hopSeconds, evenAt }) {
  const found = [base];
  if (base / 2 >= minLag) found.push(nearestPeak(ac, base / 2, minLag, maxLag));
  if (base * 2 <= maxLag) found.push(nearestPeak(ac, base * 2, minLag, maxLag));
  const strongest = Math.max(...found.map((lag) => ac[lag]));
  const candidates = found.filter((lag) => ac[lag] >= OCTAVE_SHARE * strongest).sort((x, y) => x - y);
  const fastSteady = candidates.find((lag, i) => i < candidates.length - 1 && evenAt(lag) >= STEADY);
  if (fastSteady !== undefined) return fastSteady;
  const octavePrior = (lag) => {
    const octaves = Math.log2(60 / (lag * hopSeconds) / OCTAVE_BPM);
    return Math.exp(-0.5 * (octaves / (octaves < 0 ? OCTAVE_SPREAD_SLOW : OCTAVE_SPREAD_FAST)) ** 2);
  };
  return candidates.reduce((best, lag) => (ac[lag] * octavePrior(lag) > ac[best] * octavePrior(best) ? lag : best));
}

/**
 * The frames of `pcm` that carry sound as `{ first, last }` (indices of the per-hop level envelope), or null for none.
 * The level is the RMS of each analysis window; a frame is sound above a floor of NOISE_MARGIN times the quiet 5th
 * percentile (room tone, or 0 for digital silence), but never above QUIET_SHARE of the loud 95th and never below
 * -66 dBFS, so a quiet intro, a fade-in or a fade-out is sound while a silent or hissing one is not, whatever the loudest
 * hit is.
 */
export function soundSpan(pcm, { frame = FRAME, hop = HOP } = {}) {
  const frames = pcm.length >= frame ? Math.floor((pcm.length - frame) / hop) + 1 : 0;
  if (frames === 0) return null;
  const squares = new Float64Array(pcm.length + 1);
  for (let i = 0; i < pcm.length; i++) squares[i + 1] = squares[i] + pcm[i] * pcm[i];
  const level = Float64Array.from({ length: frames }, (_, f) => Math.sqrt((squares[f * hop + frame] - squares[f * hop]) / frame));
  const sorted = Float64Array.from(level).sort();
  const quiet = sorted[Math.floor(LOW_PERCENTILE * (frames - 1))];
  const loud = sorted[Math.floor(HIGH_PERCENTILE * (frames - 1))];
  const floor = Math.max(ABSOLUTE_FLOOR, Math.min(NOISE_MARGIN * quiet, QUIET_SHARE * loud));
  const first = level.findIndex((v) => v > floor);
  if (first < 0) return null;
  return { first, last: level.findLastIndex((v) => v > floor) };
}

/**
 * The beats, in seconds, of a steady grid at `bpm` over the envelope: every beat the same distance apart, on the phase
 * that puts them on the most onset. `offset` is added to every time (the middle of an analysis window, from detectBeats).
 * `span` ({ first, last } frames, from soundSpan) trims the grid to the sound: a beat more than half a period before the
 * first sound frame or after the last is left out, so an intro or an outro of silence has no beats. A beat within half a hop
 * before the start is kept, at 0.
 */
export function beatGrid(env, bpm, hopSeconds, { offset = 0, span } = {}) {
  if (!(bpm > 0) || env.length === 0) return [];
  const values = onsetsOf(env);
  const period = 60 / bpm / hopSeconds;
  const { phase } = bestPhase(values, period);
  const first = Math.ceil(((-0.5 * hopSeconds - offset) / hopSeconds - phase) / period);
  const beats = [];
  for (let k = first; ; k++) {
    const frame = phase + k * period;
    if (frame > env.length - 1) break;
    if (span && (frame < span.first - period / 2 || frame > span.last + period / 2)) continue;
    beats.push(Math.max(0, frame * hopSeconds + offset));
  }
  return beats;
}

/** The shortest clip (seconds) with an envelope long enough to hold two beats at the slowest tempo `minBpm`; estimateTempo gives nothing for less. */
export const minSeconds = (minBpm = MIN_BPM) => ((2 * Math.ceil(60 / minBpm / (HOP / SAMPLE_RATE)) + 2) * HOP + FRAME) / SAMPLE_RATE;
export const MIN_SECONDS = minSeconds();

/**
 * `{ bpm, confidence, confidenceBeforeDrift, drift, beats }` of the samples `pcm` (mono, 22050 Hz): beats in seconds to
 * the millisecond, over the sound only. `minBpm` and `maxBpm` narrow the tempo search; `bpm` forces the grid at that
 * tempo (the confidence is then how well that grid fits the onsets: forcedTempo). A clip with no sound, or too short,
 * gives no beats.
 */
export function detectBeats(pcm, { bpm: forced, minBpm = MIN_BPM, maxBpm = MAX_BPM } = {}) {
  const hopSeconds = HOP / SAMPLE_RATE;
  const env = onsetEnvelope(pcm);
  const span = soundSpan(pcm);
  if (!span) return { ...NO_TEMPO, beats: [] };
  const found = forced === undefined ? estimateTempo(env, hopSeconds, { minBpm, maxBpm, span }) : forcedTempo(pcm, env, hopSeconds, forced, span);
  const beats = beatGrid(env, found.bpm, hopSeconds, { offset: FRAME / 2 / SAMPLE_RATE, span }).map((t) => Math.round(t * BEAT_DECIMALS) / BEAT_DECIMALS);
  return { ...found, beats };
}

// The tempo a caller asked for. Its confidence is how well its grid (on the phase beatGrid writes) fits the onsets, the
// better of the detector's envelope (it hears a kick under off-beat hats) and the plain flux (it hears a rim click or a
// syncopated pattern over low noise), cut when the grid drifts. The autocorrelation is not asked: it judges how
// self-similar the track is one beat apart, which a syncopated pattern is not, even at its right tempo.
function forcedTempo(pcm, env, hopSeconds, bpm, span) {
  const values = onsetsOf(env);
  const smooth = smoothed(values);
  const period = 60 / bpm / hopSeconds;
  const { phase } = bestPhase(values, period);
  const plain = smoothed(onsetsOf(onsetEnvelope(pcm, { weighted: false })));
  const fit = Math.max(gridFit(smooth, period, phase, span, FIT_CHANCE_WEIGHTED), gridFit(plain, period, phase, span));
  return judged(bpm, fit, gridDrift(smooth, values, bpm, hopSeconds, span));
}

// The onset level at least half of `levels` reach (the median; of an even count, the upper of the middle two).
function typical(levels) {
  const sorted = Float64Array.from(levels).sort();
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

// How well the grid of `period` frames from `phase` fits the onsets `smooth`, 0 to 1. Its beats inside the sound are cut
// into thirds; in each, the onset level the typical beat reaches is set against chance: the same beats moved off the beat
// by every quarter frame from FIT_OFF_BEAT of a beat to 1 - FIT_OFF_BEAT, each move's typical level, averaged (or, with
// `chanceQuantile`, that quantile of them). A third fits by 1 - chance / level; the worst third is the fit, so the grid
// must sit on the onsets all through the track. A grid at the wrong tempo puts most beats between the onsets (0), and one
// a few percent off fits only where it crosses them. Fewer than three beats: 0.
function gridFit(smooth, period, phase, span, chanceQuantile) {
  const frames = [];
  for (let f = phase; f <= smooth.length - 1; f += period) if (f >= span.first - period / 2 && f <= span.last + period / 2) frames.push(f);
  if (frames.length < FIT_PARTS) return 0;
  let worst = 1;
  for (let part = 0; part < FIT_PARTS; part++) {
    const beats = frames.slice(Math.floor((part * frames.length) / FIT_PARTS), Math.floor(((part + 1) * frames.length) / FIT_PARTS));
    const level = typical(beats.map((f) => valueAt(smooth, f)));
    const moved = [];
    for (let shift = period * FIT_OFF_BEAT; shift <= period * (1 - FIT_OFF_BEAT); shift += 1 / PHASE_STEPS_PER_FRAME) moved.push(typical(beats.map((f) => valueAt(smooth, f + shift))));
    const chance = chanceQuantile === undefined ? moved.reduce((sum, v) => sum + v, 0) / moved.length : Float64Array.from(moved).sort()[Math.floor(chanceQuantile * (moved.length - 1))];
    worst = Math.min(worst, level > 0 ? clamp01(1 - chance / level) : 0);
  }
  return worst;
}
