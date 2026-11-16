// The cue voices of version 2 and the cue track. The version 1 synthesisers (scripts/lib/cues.mjs, read-only) voice
// the cues they already have; sub, paper, marker and the riser are new, pure sample generators seeded from the film
// seed through engine/seeded.mjs. renderCues lays a cue list (cues.mjs planCues) into one stereo track of the film's
// length. Nothing here reads a clock or Math.random: the same cues and seed give the same bytes.
import { CUE_LAYERS, SAMPLE_RATE, cueWav, pinkNoise } from '../../lib/cues.mjs';
import { mulberry32 } from '../../../engine/seeded.mjs';
import { writeWav } from './wav.mjs';

const PEAK = 0.5; // every voice peaks here (-6 dBFS), as version 1 levels its cues, so a cue's gain is a literal gain
const LIMIT = 0.98; // the cue track is hard-limited here
const TAIL_SECONDS = 0.005; // linear fade to silence at the end of a voice, so it never ends on a click
const TWO_PI = 2 * Math.PI;
const DT = 1 / SAMPLE_RATE;
const WAV_HEADER_BYTES = 44; // of the version 1 cue WAVs cueWav returns
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const SEED_LIMIT = 0xffffffff; // the largest seed the 32-bit generator tells apart
const ONSET_SECONDS = 0.0005; // every voice rises from 0 over its first 0.5 ms, so it never starts on a step
const EDGE_FADE_SECONDS = 0.004; // a voice cut by the film's start or end fades in or out over this, never a step
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// A sine gliding (exponentially) from `from` to `to` Hz over the whole sound, with a short attack and a decay per second.
const SUB = Object.freeze({ seconds: 0.35, from: 90, to: 40, attack: 0.004, decay: 6 });
// White noise band-passed at `hz`, a fast attack and a decay with time constant `tau`: a sheet of paper moved.
const PAPER = Object.freeze({ seconds: 0.12, hz: 2500, q: 0.7, attack: 0.002, tau: 0.035 });
// White noise through a narrow band rising from `from` to `to` Hz, in over `attack` and out over `release`: a squeak.
const MARKER = Object.freeze({ seconds: 0.18, from: 1800, to: 4200, q: 8, attack: 0.015, release: 0.04 });
// Pink noise through a band climbing 200 Hz to 6 kHz (as the version 1 riser), turning into a tone gliding to 2 kHz in
// its last moments (weight u^toneShape), under a rising envelope 0.05 x 20^u; its last sample is its peak.
const RISER = Object.freeze({ seconds: 1.6, lo: 200, hi: 6000, toneLo: 200, toneHi: 2000, q: 2, curve: 1.5, toneShape: 8, floor: 0.05, rise: 20 });
const RISER_CUE = 'riser';
/** Seconds of release after a riser's peak, so it never ends on a full-height step. */
export const RISER_RELEASE_SECONDS = 0.004;

const frames = (seconds) => Math.round(seconds * SAMPLE_RATE);
const sweep = (lo, hi, amount) => lo * (hi / lo) ** amount;
const peakOf = (xs) => xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);

// ---- building blocks ----

// A band-pass whose centre follows `hzAt(u)` (u = 0..1 through the sound): a topology-preserving state-variable filter,
// stable while its frequency moves every sample, unity gain at the centre.
function bandPass(source, length, hzAt, q) {
  const k = 1 / q;
  let ic1 = 0;
  let ic2 = 0;
  return Float64Array.from({ length }, (_, i) => {
    const g = Math.tan((Math.PI * hzAt(i / length)) / SAMPLE_RATE);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = source() - ic2;
    const v1 = a1 * ic1 + a2 * v3;
    const v2 = ic2 + a2 * ic1 + a3 * v3;
    ic1 = 2 * v1 - ic1;
    ic2 = 2 * v2 - ic2;
    return k * v1;
  });
}

// Scaled so its peak is PEAK, faded to silence over its last TAIL_SECONDS.
function levelled(xs) {
  const top = peakOf(xs);
  const tail = frames(TAIL_SECONDS);
  return Float32Array.from(xs, (x, i) => (top === 0 ? 0 : x * (PEAK / top) * Math.min(1, (xs.length - 1 - i) / tail)));
}

// The film seed (spec.mjs: an integer 0 to SEED_MAX): anything else is a TypeError, never a silent seed 0 or a seed
// truncated into another one.
function checkSeed(seed, who) {
  if (!Number.isInteger(seed) || seed < 0 || seed > SEED_LIMIT) {
    throw new TypeError(`${who}: seed must be an integer from 0 to ${SEED_LIMIT} (the film seed), got ${String(seed)}`);
  }
}

// A seed of its own for each cue, from the film seed and the cue name (FNV-1a), so two noise cues never share noise.
function cueSeed(seed, cue) {
  let hash = FNV_OFFSET;
  for (const ch of cue) hash = Math.imul(hash ^ ch.charCodeAt(0), FNV_PRIME);
  return (hash ^ seed) >>> 0;
}

// ---- the new voices ----

function sub() {
  let phase = 0;
  const length = frames(SUB.seconds);
  return levelled(Float64Array.from({ length }, (_, i) => {
    const t = i * DT;
    phase += TWO_PI * sweep(SUB.from, SUB.to, i / length) * DT;
    return Math.sin(phase) * Math.min(1, t / SUB.attack) * Math.exp(-t * SUB.decay);
  }));
}

function paper(noise) {
  const length = frames(PAPER.seconds);
  const filtered = bandPass(() => noise() * 2 - 1, length, () => PAPER.hz, PAPER.q);
  return levelled(filtered.map((x, i) => x * Math.min(1, (i * DT) / PAPER.attack) * Math.exp(-(i * DT) / PAPER.tau)));
}

function marker(noise) {
  const length = frames(MARKER.seconds);
  const filtered = bandPass(() => noise() * 2 - 1, length, (u) => sweep(MARKER.from, MARKER.to, u), MARKER.q);
  return levelled(filtered.map((x, i) => {
    const t = i * DT;
    return x * Math.min(1, t / MARKER.attack, (MARKER.seconds - t) / MARKER.release);
  }));
}

// A chirp from `lo` to `hi` Hz whose phase is shifted so its last sample is exactly sin(pi / 2) = 1.
function chirpToPeak(length, lo, hi, curve) {
  const phases = new Float64Array(length);
  let phase = 0;
  for (let i = 0; i < length; i++) {
    phase += TWO_PI * sweep(lo, hi, (i / length) ** curve) * DT;
    phases[i] = phase;
  }
  const last = phases[length - 1];
  return phases.map((p) => Math.sin(p - last + Math.PI / 2));
}

/**
 * A riser `seconds` long whose peak is its last sample, so it can be placed to end on an anchor: a mix of noise (scaled
 * to at most 1) and a tone ending on 1, always at most 1, under an envelope that rises to the last sample.
 */
export function riserTo(seconds, { seed } = {}) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`riserTo: seconds must be a positive number, got ${String(seconds)}`);
  }
  checkSeed(seed, 'riserTo');
  const length = Math.max(2, frames(seconds));
  const release = frames(RISER_RELEASE_SECONDS);
  const pink = pinkNoise(mulberry32(cueSeed(seed, RISER_CUE)));
  const noisy = bandPass(pink, length, (u) => sweep(RISER.lo, RISER.hi, u ** RISER.curve), RISER.q);
  const noiseTop = peakOf(noisy) || 1;
  const tone = chirpToPeak(length, RISER.toneLo, RISER.toneHi, RISER.curve);
  return Float32Array.from({ length: length + release }, (_, i) => {
    if (i >= length) {
      // the release: the tone carried on at its last frequency (cos, as it peaked on sin(pi / 2)), falling linearly to 0
      const k = i - length + 1;
      return PEAK * Math.cos(TWO_PI * RISER.toneHi * k * DT) * (1 - k / release);
    }
    const u = i / (length - 1);
    const w = u ** RISER.toneShape;
    const carrier = (1 - w) * (noisy[i] / noiseTop) + w * tone[i];
    return PEAK * RISER.floor * RISER.rise ** u * carrier;
  });
}

// The index of a riser's peak in its samples (riserTo): just before its release.
const riserPeakIndex = (xs) => xs.length - 1 - frames(RISER_RELEASE_SECONDS);

const NEW_VOICES = Object.freeze({ sub, paper, marker });

/** Every cue name a synth here can voice: the version 1 cues, then the new ones. */
export const KNOWN_CUES = Object.freeze([...Object.keys(CUE_LAYERS), ...Object.keys(NEW_VOICES)]);

// The left channel of a version 1 cue WAV (centred, so it is the cue's own mono signal) as samples in -1..1.
function versionOneMono(cue) {
  const wav = cueWav({ cue });
  const count = (wav.length - WAV_HEADER_BYTES) / (CHANNELS * BYTES_PER_SAMPLE);
  return Float32Array.from({ length: count }, (_, i) => wav.readInt16LE(WAV_HEADER_BYTES + i * CHANNELS * BYTES_PER_SAMPLE) / 32768);
}

// `xs` rising linearly from 0 over its first ONSET_SECONDS (version 1's click and impact start on their transient's
// full height otherwise), as a new array.
function withOnset(xs) {
  const ramp = frames(ONSET_SECONDS);
  return Float32Array.from(xs, (x, i) => (i < ramp ? (x * i) / ramp : x));
}

function rawSamples(cue, seed) {
  if (cue === RISER_CUE) return riserTo(RISER.seconds, { seed });
  if (Object.hasOwn(NEW_VOICES, cue)) return NEW_VOICES[cue](mulberry32(cueSeed(seed, cue)));
  return versionOneMono(cue);
}

/**
 * The mono 48 kHz samples of `cue`, peaking at PEAK (at most 0.9), starting and ending at 0 (an ONSET_SECONDS rise; the
 * voices' own fades and the riser's release at the end). `seed` (the film seed, an integer 0 to 2^32 - 1, required)
 * seeds the noise of the new voices; the version 1 cues use version 1's own fixed noise, so the seed does not change
 * them. `riser` is riserTo(1.6 s): the version 1 riser fades out its last 5 ms, so its peak is not its end.
 */
export function cueSamples(cue, { seed } = {}) {
  if (!KNOWN_CUES.includes(cue)) throw new RangeError(`unknown cue ${JSON.stringify(cue)}; known cues: ${KNOWN_CUES.join(', ')}`);
  checkSeed(seed, 'cueSamples');
  return withOnset(rawSamples(cue, seed));
}

// ---- the track ----

function checkCue(entry, i) {
  const where = `cues[${i}]`;
  if (entry === null || typeof entry !== 'object') throw new TypeError(`${where} must be { t, cue, gainDb, pan }`);
  const { t, cue, gainDb, pan } = entry;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) throw new RangeError(`${where}.t must be a number of seconds, 0 or more, got ${String(t)}`);
  if (!KNOWN_CUES.includes(cue)) throw new RangeError(`${where}: unknown cue ${JSON.stringify(cue)}; known cues: ${KNOWN_CUES.join(', ')}`);
  if (typeof gainDb !== 'number' || !Number.isFinite(gainDb)) throw new RangeError(`${where}.gainDb must be a finite number, got ${String(gainDb)}`);
  if (typeof pan !== 'number' || !(pan >= -1 && pan <= 1)) throw new RangeError(`${where}.pan must be a number from -1 to 1, got ${String(pan)}`);
}

// The gain at sample `i` of a voice kept from `from` to `to`: a linear fade in after a cut head and out before a cut
// tail, over EDGE_FADE_SECONDS (1 elsewhere).
function edgeGain(i, { from, to, cutHead, cutTail }) {
  const fade = frames(EDGE_FADE_SECONDS);
  const inGain = cutHead ? (i - from) / fade : 1;
  const outGain = cutTail ? (to - 1 - i) / fade : 1;
  return Math.max(0, Math.min(1, inGain, outGain));
}

// Adds `xs` into both channels from frame `start` (a riser's start may be before 0: its head is cut), at `gain`, panned
// equal-power with the centre at unity in both channels (as version 1 pans). A head or tail cut by the track's edge fades
// there (edgeGain), so the track never starts or ends on a step.
function addInto(left, right, xs, start, gain, pan) {
  const angle = ((pan + 1) * Math.PI) / 4;
  const gl = gain * Math.SQRT2 * Math.cos(angle);
  const gr = gain * Math.SQRT2 * Math.sin(angle);
  const from = Math.max(0, -start);
  const to = Math.min(xs.length, left.length - start);
  const kept = { from, to, cutHead: from > 0, cutTail: to < xs.length };
  for (let i = from; i < to; i++) {
    const x = xs[i] * edgeGain(i, kept);
    left[start + i] += x * gl;
    right[start + i] += x * gr;
  }
}

/**
 * Writes `out` (through a temporary name, renamed into place): a stereo 48 kHz 16-bit WAV `seconds` long with each
 * cue's samples added from round(t x 48000) (a riser so its peak falls there, its 4 ms release after), scaled by its
 * gainDb and pan, hard-limited (clipped) at 0.98. A cue that would start at or past the film's end (a riser: whose
 * anchor would) is dropped; one that starts inside it is cut at the end. `seed` is required (cueSamples).
 * -> Promise<{ file: out, dropped: number of cues dropped }>.
 */
export async function renderCues(cues, { seconds, seed, out }) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
    throw new RangeError(`renderCues: seconds must be a positive number, got ${String(seconds)}`);
  }
  if (!Array.isArray(cues)) throw new TypeError('renderCues: cues must be an array of { t, cue, gainDb, pan }');
  cues.forEach(checkCue);
  checkSeed(seed, 'renderCues');
  const length = frames(seconds);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const voices = new Map();
  let dropped = 0;
  for (const { t, cue, gainDb, pan } of cues) {
    const anchor = Math.round(t * SAMPLE_RATE);
    if (anchor >= length) {
      dropped += 1;
      continue;
    }
    if (!voices.has(cue)) voices.set(cue, cueSamples(cue, { seed }));
    const xs = voices.get(cue);
    addInto(left, right, xs, cue === RISER_CUE ? anchor - riserPeakIndex(xs) : anchor, 10 ** (gainDb / 20), pan);
  }
  await writeWav(out, left, right, { limit: LIMIT });
  return { file: out, dropped };
}

