// Procedural sound cues: ten small synthesisers, each a pure function of its parameters, written as 16-bit stereo
// WAV with Buffer. No dependencies; noise comes from a seeded generator, so the same cue is the same bytes.
// Every cue is built in layers: a short transient (a click), a body (a pitched tone or a filtered noise sweep), an
// optional short reverb tail, then optional stereo width above 120 Hz (mono below, so the low end stays centred).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCues } from '../../template/audio.mjs';
import { mulberry32 } from '../../template/seeded.mjs';
import { TYPING_SECONDS_PER_CHAR } from '../../template/defaults.mjs';

export const SAMPLE_RATE = 48000; // the mix's rate: no resampling
const PEAK = 0.5; // every cue is scaled to this peak (-6 dBFS), so a cue's `volume` is a literal gain on a known level
const TAIL_SECONDS = 0.005; // linear fade to silence at the end, so a cue never ends on a click
const GAIN_STEPS = 1e9;
const NOISE_SEED = 0x5eed;
const A4_HZ = 440;
const A4_MIDI = 69;
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_NOTE = { pop: 'E5', chime: 'A5', impact: 'F2', drop: 'C2', ding: 'E6' };
const TWO_PI = 2 * Math.PI;

/** "A4" -> 440, "C#5", "Bb3": equal temperament, A4 = 440 Hz. */
export function noteHz(note) {
  const parts = /^([A-G])([#b]?)(\d)$/.exec(note ?? '');
  if (!parts) throw new Error(`not a note name: ${JSON.stringify(note)} (use A-G, an optional # or b, and an octave 0-8, such as A4 or C#5)`);
  const [, letter, accidental = '', octave] = parts;
  const semitone = SEMITONES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return A4_HZ * 2 ** ((semitone + 12 * (Number(octave) + 1) - A4_MIDI) / 12);
}

// `t` is seconds, DT = 1/rate; envelopes are exponential decays unless named otherwise.
const frames = (seconds) => Math.round(seconds * SAMPLE_RATE);
const DT = 1 / SAMPLE_RATE;
const attack = (t, seconds) => Math.min(1, t / seconds);
const swell = (u) => Math.sin(Math.PI * u) ** 2; // 0 -> 1 at the middle -> 0: a pass-by
const sweep = (lo, hi, amount) => lo * (hi / lo) ** amount; // exponential, so equal steps of `amount` are equal intervals

// ---- building blocks ---------------------------------------------------------------------------

/** Pink-ish noise from a white source in 0..1: Paul Kellet's three-pole economy filter (about -3 dB per octave). */
export function pinkNoise(white) {
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  return () => {
    const w = white() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    return b0 + b1 + b2 + w * 0.1848;
  };
}

// A band-pass whose centre follows `hzAt(u)` (u = 0..1 through the sound): a topology-preserving state-variable
// filter, which stays stable while its frequency moves every sample. Unity gain at the centre.
function sweptBandPass(source, length, hzAt, q) {
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

// Pink noise through a band-pass sweeping from `lo` to `hi` (exponentially, by `shape(u)` 0..1), under `envelope(u)`.
function noiseSweep(seconds, noise, { lo, hi, q, shape, envelope }) {
  const length = frames(seconds);
  const filtered = sweptBandPass(pinkNoise(noise), length, (u) => sweep(lo, hi, shape(u)), q);
  return filtered.map((x, i) => x * envelope(i / length));
}

// A burst of differenced (so bright) white noise dying away with time constant `tau`, faded to zero by `seconds`.
function noiseClick(seconds, tau, noise) {
  let last = 0;
  return Float64Array.from({ length: frames(seconds) }, (_, i) => {
    const t = i * DT;
    const n = noise() * 2 - 1;
    const edge = n - last;
    last = n;
    return edge * Math.exp(-t / tau) * (1 - t / seconds);
  });
}

// The highest frequency a cue may make: above it a high note would fold back (alias) into audible junk.
export const MAX_HZ = 0.4 * SAMPLE_RATE;

// An FM click: a sine at `hz` whose phase is pushed by a fast-falling modulation index, the attack of a struck object.
const FM_RATIO = 1.41; // inharmonic, so the click has no pitch of its own
const FM_INDEX = 5;
const FM_MIN_INDEX = 1; // a click needs at least this much modulation to stay a click and not a beep
const FM_CARRIER_MAX_HZ = MAX_HZ / (1 + (FM_MIN_INDEX + 1) * FM_RATIO); // the highest carrier that still has room for it
/**
 * The FM click actually made for `hz`: { carrier, modulator, index, topHz }. The carrier is held low enough to leave
 * room for an index of 1 (about 5 kHz), and the peak index is lowered until the highest strong sideband (Carson's
 * rule: carrier + (index + 1) × modulator) stays at or below MAX_HZ.
 */
export function fmBand(hz) {
  const carrier = Math.min(hz, FM_CARRIER_MAX_HZ);
  const modulator = FM_RATIO * carrier;
  const index = Math.max(0, Math.min(FM_INDEX, (MAX_HZ - carrier) / modulator - 1));
  return { carrier, modulator, index, topHz: index > 0 ? carrier + (index + 1) * modulator : carrier };
}
// The FM click of each cue that has one sits at this multiple of the cue's f0.
export const FM_CLICK_RATIO = Object.freeze({ pop: 6, drop: 16, ding: 2 });
function fmClick(seconds, hz) {
  const { carrier, modulator, index: peak } = fmBand(hz);
  return Float64Array.from({ length: frames(seconds) }, (_, i) => {
    const t = i * DT;
    const index = peak * Math.exp(-t / 0.0015);
    return Math.sin(TWO_PI * carrier * t + index * Math.sin(TWO_PI * modulator * t)) * attack(t, 0.0003) * (1 - t / seconds) ** 3;
  });
}

// A sine gliding from `from` Hz down to `to` Hz (most of the way within `glide` seconds), dying at `decay` per second.
// `drive` > 0 soft-clips it, adding the harmonics that let a low note be heard on small speakers; it is dropped when
// those harmonics (up to the 3rd) would pass MAX_HZ, where a high note needs no help anyway.
const DRIVE_HARMONIC = 3;
function pitchDrop(seconds, { from: rawFrom, to: rawTo, glide, decay, attackSeconds = 0.001, drive = 0 }) {
  const [from, to] = [Math.min(rawFrom, MAX_HZ), Math.min(rawTo, MAX_HZ)]; // a very high note glides from MAX_HZ at most
  let phase = 0;
  const tau = glide / 4;
  const shape = drive > 0 && DRIVE_HARMONIC * from <= MAX_HZ ? (x) => Math.tanh(drive * x) / Math.tanh(drive) : (x) => x;
  return Float64Array.from({ length: frames(seconds) }, (_, i) => {
    const t = i * DT;
    phase += TWO_PI * (to + (from - to) * Math.exp(-t / tau)) * DT;
    return shape(Math.sin(phase)) * Math.exp(-t * decay) * attack(t, attackSeconds);
  });
}

// Partials [ratio, level, decay per second] of `f0` under a short attack: a struck bell or glass.
// A partial above MAX_HZ (a high note's upper partials) is left out rather than aliased.
function partials(seconds, f0, list, attackSeconds) {
  const audible = list.filter(([ratio]) => ratio * f0 <= MAX_HZ);
  return Float64Array.from({ length: frames(seconds) }, (_, i) => {
    const t = i * DT;
    return audible.reduce((sum, [ratio, level, decay]) => sum + level * Math.sin(TWO_PI * ratio * f0 * t) * Math.exp(-t * decay), 0) * attack(t, attackSeconds);
  });
}

const scaled = (xs, level) => xs.map((x) => x * level);

// ---- layers ------------------------------------------------------------------------------------

const COMB_SECONDS = [0.0297, 0.0371, 0.0411, 0.0437];
const COMB_DAMPING = 0.25; // a one-pole low-pass inside each comb's loop: the tail darkens as it dies, as a room does
/**
 * `dry + wet × tail`: four parallel feedback combs (29.7, 37.1, 41.1 and 43.7 ms), each fed back so it has fallen
 * 60 dB at `seconds`, averaged. The result is as long as the input.
 */
export function reverbTail(mono, { seconds, wet }) {
  const out = Float64Array.from(mono);
  for (const delaySeconds of COMB_SECONDS) {
    const d = frames(delaySeconds);
    const feedback = 10 ** ((-3 * delaySeconds) / seconds);
    const comb = new Float64Array(mono.length);
    let lowPassed = 0;
    for (let i = d; i < mono.length; i++) {
      lowPassed = comb[i - d] * (1 - COMB_DAMPING) + lowPassed * COMB_DAMPING;
      comb[i] = mono[i - d] + feedback * lowPassed;
      out[i] += (wet * comb[i]) / COMB_SECONDS.length;
    }
  }
  return out;
}

/**
 * Stereo from mono: a one-pole split at `crossoverHz`; the part above it reaches the right channel `delaySeconds`
 * later, the part below is the same in both channels.
 */
export function widen(mono, { crossoverHz, delaySeconds }) {
  const a = 1 - Math.exp((-TWO_PI * crossoverHz) / SAMPLE_RATE);
  const d = frames(delaySeconds);
  let low = 0;
  const lows = mono.map((x) => (low += a * (x - low)));
  const right = mono.map((_, i) => lows[i] + (i >= d ? mono[i - d] - lows[i - d] : 0));
  return { left: Float64Array.from(mono), right };
}
const WIDTH = { crossoverHz: 120, delaySeconds: 0.0007 };

/** One cue's layers summed: transient + body, then the reverb tail, then stereo width. */
export function layerCue(def, f0, noise) {
  const length = frames(def.seconds);
  const mono = new Float64Array(length);
  for (const layer of [def.transient, def.body]) {
    if (!layer) continue;
    layer(f0, noise).forEach((x, i) => { if (i < length) mono[i] += x; });
  }
  const wet = def.tail ? reverbTail(mono, def.tail) : mono;
  return def.stereo ? widen(wet, WIDTH) : { left: wet, right: wet };
}

// ---- the cues ----------------------------------------------------------------------------------

// The dry tick of `click` (and each key of `typing`): differenced noise plus a short ping at `hz`.
function tick(seconds, hz, noise, { noiseTau = 1 / 180, ping = 0.6 } = {}) {
  const burst = noiseClick(seconds, noiseTau, noise);
  return burst.map((x, i) => x + ping * Math.sin(TWO_PI * hz * i * DT) * Math.exp(-i * DT * 250));
}

// The layer definition of every cue but typing (which is built per text): exported so a test can render a cue without
// one of its layers.
export const CUE_LAYERS = Object.freeze({
  // A rounded blip: a bright FM tick, then a sine whose pitch drops about 12 % in its first 40 ms as it dies away,
  // in a small room.
  pop: {
    seconds: 0.16,
    transient: (f0) => scaled(fmClick(0.003, FM_CLICK_RATIO.pop * f0), 0.4),
    body: (f0) => pitchDrop(0.16, { from: 1.12 * f0, to: f0, glide: 0.04, decay: 30 }),
    tail: { seconds: 0.15, wet: 0.12 },
  },
  // A dry UI tick: a 2 ms burst of very short noise, then a tiny body of noise band-passed around 3.2 kHz, gone in
  // about 15 ms.
  click: {
    seconds: 0.04,
    transient: (f0, noise) => scaled(noiseClick(0.002, 0.0004, noise), 0.8),
    body: (f0, noise) => sweptBandPass(() => noise() * 2 - 1, frames(0.04), () => 3200, 3).map((x, i) => x * Math.exp(-i * DT / 0.005)),
  },
  // Air going past: pink noise through a band-pass that opens from 200 Hz to 10 kHz and back, under the same swell,
  // so it is brightest where it is loudest (0.4 s in).
  whoosh: {
    seconds: 0.8,
    body: (f0, noise) => noiseSweep(0.8, noise, { lo: 200, hi: 10000, q: 1.4, shape: swell, envelope: swell }),
    stereo: true,
  },
  // A soft bell: three harmonics that fade at different rates, in a little room.
  chime: {
    seconds: 1.4,
    body: (f0) => partials(1.4, f0, [[1, 1, 3], [2, 0.4, 4.5], [3, 0.2, 6]], 0.003),
    tail: { seconds: 0.4, wet: 0.2 },
  },
  // A low thud: a noise burst, then a sine falling two octaves (4 × f0 -> f0) in 100 ms and dying away.
  impact: {
    seconds: 0.9,
    transient: (f0, noise) => {
      let y = 0;
      return Float64Array.from({ length: frames(0.008) }, (_, i) => {
        y += 0.35 * (noise() * 2 - 1 - y); // low-passed: a thump, not a hiss
        return 1.2 * y * (1 - i / frames(0.008));
      });
    },
    body: (f0) => pitchDrop(0.9, { from: 4 * f0, to: f0, glide: 0.1, decay: 4.5, drive: 1.5 }),
    tail: { seconds: 0.3, wet: 0.15 },
  },
  // Tension building: pink noise through a band-pass climbing 200 Hz -> 6 kHz, swelling from 0.05 to full level.
  riser: {
    seconds: 1.6,
    body: (f0, noise) => noiseSweep(1.6, noise, { lo: 200, hi: 6000, q: 2, shape: (u) => u ** 1.5, envelope: (u) => 0.05 * 20 ** u }),
    stereo: true,
  },
  // A short whoosh for a transition: a 5 ms click, then pink noise opening 400 Hz -> 8 kHz and back.
  swoosh: {
    seconds: 0.3,
    transient: (f0, noise) => scaled(noiseClick(0.005, 0.0015, noise), 0.25),
    body: (f0, noise) => noiseSweep(0.3, noise, { lo: 400, hi: 8000, q: 1.4, shape: swell, envelope: swell }),
    stereo: true,
  },
  // A sub hit: an FM click, then a sine falling an octave (2 × f0 -> f0) in 80 ms; dry.
  drop: {
    seconds: 0.6,
    transient: (f0) => scaled(fmClick(0.005, FM_CLICK_RATIO.drop * f0), 0.35),
    body: (f0) => pitchDrop(0.6, { from: 2 * f0, to: f0, glide: 0.08, decay: 6, drive: 2 }),
  },
  // A notification: an FM click, then a bright glassy pair of partials (f0 and 2.76 × f0) in a little room.
  ding: {
    seconds: 0.5,
    transient: (f0) => scaled(fmClick(0.004, FM_CLICK_RATIO.ding * f0), 0.3),
    body: (f0) => partials(0.5, f0, [[1, 1, 7], [2.76, 0.35, 14]], 0.001),
    tail: { seconds: 0.25, wet: 0.2 },
  },
});

const TYPING_JITTER = 0.08; // each key's ping is up to 8 % off 3 kHz, so a run of keys is not one tick repeated
const TYPING_RING_SECONDS = 0.05; // room after the last key for its tick to die away
// `chars` key ticks, the k-th at (k + 1) × spacing: each lands as its character appears on screen.
function typingLayers(chars, spacing) {
  const keys = Math.max(1, chars);
  const seconds = keys * spacing + TYPING_RING_SECONDS;
  return {
    seconds,
    transient: (f0, noise) => {
      const out = new Float64Array(frames(seconds));
      for (let k = 0; k < keys; k++) {
        const hz = 3000 * (1 + TYPING_JITTER * (noise() * 2 - 1));
        const at = frames((k + 1) * spacing);
        tick(0.04, hz, noise, { noiseTau: 0.0015, ping: 0.35 }).forEach((x, i) => { if (at + i < out.length) out[at + i] += x; });
      }
      return out;
    },
  };
}

function layersOf(cue, chars, spacing) {
  if (cue === 'typing') return typingLayers(chars, spacing);
  const def = Object.hasOwn(CUE_LAYERS, cue) ? CUE_LAYERS[cue] : undefined;
  if (!def) throw new Error(`unknown cue ${JSON.stringify(cue)}; cues: ${Object.keys(CUE_LAYERS).join(', ')}, typing`);
  return def;
}

// A 44-byte PCM header, then interleaved little-endian 16-bit frames.
function wavBuffer(left, right) {
  const data = Buffer.alloc(left.length * 4);
  left.forEach((l, i) => {
    data.writeInt16LE(Math.round(l * 32767), i * 4);
    data.writeInt16LE(Math.round(right[i] * 32767), i * 4 + 2);
  });
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

// Scaled so its peak is PEAK, with the linear fade over the last TAIL_SECONDS. Silence stays silence (no 0/0).
export function levelled(xs) {
  const tail = frames(TAIL_SECONDS);
  const top = xs.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  if (top === 0) return Array.from(xs, () => 0);
  return Array.from(xs, (x, i) => x * (PEAK / top) * Math.min(1, (xs.length - 1 - i) / tail));
}

/**
 * One cue as a WAV Buffer. `note` tunes pop, chime, impact, drop and ding; `pan` (-1 left .. 1 right) is equal-power
 * with the centre at unity. `chars` and `spacing` (seconds between keys) shape `typing` only. Each channel peaks at
 * 0.5 before pan, whatever the cue (a widened cue's channels are levelled one by one).
 */
export function cueWav({ cue, note, pan = 0, chars = 1, spacing = TYPING_SECONDS_PER_CHAR }) {
  const def = layersOf(cue, chars, spacing);
  const { left, right } = layerCue(def, noteHz(note ?? DEFAULT_NOTE[cue] ?? 'A4'), mulberry32(NOISE_SEED));
  const levelLeft = levelled(left);
  const levelRight = right === left ? levelLeft : levelled(right);
  const angle = ((pan + 1) * Math.PI) / 4;
  const gain = (x) => Math.round(Math.SQRT2 * x * GAIN_STEPS) / GAIN_STEPS; // so a centred cue is exactly the same in both channels
  const [gl, gr] = [gain(Math.cos(angle)), gain(Math.sin(angle))];
  return wavBuffer(levelLeft.map((x) => x * gl), levelRight.map((x) => x * gr));
}

/**
 * Writes one WAV per cue of `spec` into `dir` and returns the mix tracks for them ({ file, start, end, volume,
 * fadeIn, fadeOut }, the shape resolveAudio gives): timed like audio tracks, `end` clamped to the video end, and a
 * 5 ms fade-out on every cue so one the video ends in the middle of still falls to silence.
 */
export function writeCueTracks(spec, dir) {
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  return resolveCues(spec).map(({ cue, note, pan, start, volume, chars, spacing }, i) => {
    const wav = cueWav({ cue, note, pan, chars, spacing });
    const file = path.join(dir, `cue-${i}-${cue}.wav`);
    writeFileSync(file, wav);
    const seconds = (wav.length - 44) / 4 / SAMPLE_RATE;
    return { file, start, end: Math.min(total, start + seconds), volume, fadeIn: 0, fadeOut: TAIL_SECONDS }; // the mix trims a cue at the video end: this fade keeps that cut from clicking
  });
}

/**
 * The cue tracks of `spec` written into a new folder under `parent`: { dir, tracks }, or { dir: null, tracks: [] }
 * when the spec has no cues. If writing fails the folder is removed before the error propagates, so only a
 * successful call leaves a folder for the caller to clean up.
 */
export function synthesiseCues(spec, parent) {
  if (!spec.cues?.length) return { dir: null, tracks: [] };
  const dir = mkdtempSync(path.join(parent, 'motion-cues-'));
  try {
    return { dir, tracks: writeCueTracks(spec, dir) };
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
