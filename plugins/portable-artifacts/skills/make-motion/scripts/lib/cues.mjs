// Procedural sound cues: five small synthesisers, each a pure function of its parameters, written as 16-bit
// stereo WAV with Buffer. No dependencies; noise comes from a seeded generator, so the same cue is the same bytes.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveCues } from '../../template/audio.mjs';

export const SAMPLE_RATE = 48000; // the mix's rate: no resampling
const PEAK = 0.5; // every cue is scaled to this peak (-6 dBFS), so a cue's `volume` is a literal gain on a known level
const TAIL_SECONDS = 0.005; // linear fade to silence at the end, so a cue never ends on a click
const GAIN_STEPS = 1e9;
const NOISE_SEED = 0x5eed;
const A4_HZ = 440;
const A4_MIDI = 69;
const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_NOTE = { pop: 'E5', chime: 'A5', impact: 'F2' };

// The same 32-bit generator shared/art.mjs seeds its art with (that copy is not exported).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "A4" -> 440, "C#5", "Bb3": equal temperament, A4 = 440 Hz. */
export function noteHz(note) {
  const parts = /^([A-G])([#b]?)(\d)$/.exec(note ?? '');
  if (!parts) throw new Error(`not a note name: ${JSON.stringify(note)} (use A-G, an optional # or b, and an octave 0-8, such as A4 or C#5)`);
  const [, letter, accidental = '', octave] = parts;
  const semitone = SEMITONES[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
  return A4_HZ * 2 ** ((semitone + 12 * (Number(octave) + 1) - A4_MIDI) / 12);
}

// Each synth: (f0, noise) -> mono samples. `t` is seconds, `dt` = 1/rate; envelopes are exponential decays.
const frames = (seconds) => Math.round(seconds * SAMPLE_RATE);
const DT = 1 / SAMPLE_RATE;
const attack = (t, seconds) => Math.min(1, t / seconds);

const SYNTHS = {
  // A rounded blip: a sine that falls an octave while it dies away.
  pop(f0) {
    let phase = 0;
    return Float64Array.from({ length: frames(0.12) }, (_, i) => {
      const t = i * DT;
      phase += 2 * Math.PI * f0 * (0.5 + 0.5 * Math.exp(-t * 40)) * DT;
      return Math.sin(phase) * Math.exp(-t * 35) * attack(t, 0.002);
    });
  },
  // A dry tick: a burst of differenced noise plus a short 3 kHz ping.
  click(f0, noise) {
    let last = 0;
    return Float64Array.from({ length: frames(0.04) }, (_, i) => {
      const t = i * DT;
      const n = noise() * 2 - 1;
      const edge = n - last;
      last = n;
      return edge * Math.exp(-t * 180) + 0.6 * Math.sin(2 * Math.PI * 3000 * t) * Math.exp(-t * 250);
    });
  },
  // A swell of noise: a low-pass opens and closes under a raised-sine envelope.
  whoosh(f0, noise) {
    const length = frames(0.8);
    let y = 0;
    return Float64Array.from({ length }, (_, i) => {
      const swell = Math.sin((Math.PI * i) / length) ** 2;
      y += (0.02 + 0.3 * swell) * (noise() * 2 - 1 - y);
      return y * swell;
    });
  },
  // A soft bell: three harmonics that fade at different rates.
  chime(f0) {
    return Float64Array.from({ length: frames(1.4) }, (_, i) => {
      const t = i * DT;
      return (Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t * 3)
        + 0.4 * Math.sin(2 * Math.PI * 2 * f0 * t) * Math.exp(-t * 4.5)
        + 0.2 * Math.sin(2 * Math.PI * 3 * f0 * t) * Math.exp(-t * 6)) * attack(t, 0.003);
    });
  },
  // A low thud: a sine falling an octave plus a short burst of low-passed noise.
  impact(f0, noise) {
    let phase = 0;
    let y = 0;
    return Float64Array.from({ length: frames(0.9) }, (_, i) => {
      const t = i * DT;
      phase += 2 * Math.PI * f0 * (0.5 + 0.5 * Math.exp(-t * 12)) * DT;
      y += 0.15 * (noise() * 2 - 1 - y);
      return Math.sin(phase) * Math.exp(-t * 5) + 0.7 * y * Math.exp(-t * 40);
    });
  },
};

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

/**
 * One cue as a WAV Buffer. `note` tunes pop, chime and impact; `pan` (-1 left .. 1 right) is equal-power with the
 * centre at unity. The result peaks at 0.5 before pan, whatever the cue.
 */
export function cueWav({ cue, note, pan = 0 }) {
  const mono = SYNTHS[cue](noteHz(note ?? DEFAULT_NOTE[cue] ?? 'A4'), mulberry32(NOISE_SEED));
  const tail = frames(TAIL_SECONDS);
  const top = mono.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
  const level = Array.from(mono, (x, i) => x * (PEAK / top) * Math.min(1, (mono.length - 1 - i) / tail));
  const angle = ((pan + 1) * Math.PI) / 4;
  const gain = (x) => Math.round(Math.SQRT2 * x * GAIN_STEPS) / GAIN_STEPS; // so a centred cue is exactly the same in both channels
  const [gl, gr] = [gain(Math.cos(angle)), gain(Math.sin(angle))];
  return wavBuffer(level.map((x) => x * gl), level.map((x) => x * gr));
}

/**
 * Writes one WAV per cue of `spec` into `dir` and returns the mix tracks for them ({ file, start, end, volume,
 * fadeIn, fadeOut }, the shape resolveAudio gives): timed like audio tracks, `end` clamped to the video end, and a
 * 5 ms fade-out on every cue so one the video ends in the middle of still falls to silence.
 */
export function writeCueTracks(spec, dir) {
  const total = spec.scenes.reduce((a, s) => a + s.duration, 0);
  return resolveCues(spec).map(({ cue, note, pan, start, volume }, i) => {
    const wav = cueWav({ cue, note, pan });
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
