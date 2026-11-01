// Synthetic drum-like PCM for the beat detector's tests (mono, 22050 Hz, in memory: no ffmpeg, no files). Events are
// { t, amp, kind } hits on silence: a 1 kHz click of 2, 5 or 20 ms, a pitched kick, or a decaying noise burst (noise, hat, open hat, snare). The noise
// bursts use a generator seeded per call, so a case is the same samples every run.
import { mulberry32 } from '../../template/seeded.mjs';

export const SR = 22050;
const HIT_SECONDS = 0.06; // how long a hit is rendered (the longest, the kick, has decayed by then)
const NOISE_SEED = 42;
const LONG_HITS = { ohat: 0.3, snare: 0.15 }; // seconds rendered for the hits that ring longer than HIT_SECONDS

const KINDS = {
  click2: (i) => (i < 0.002 * SR ? Math.sin((2 * Math.PI * 1000 * i) / SR) : 0),
  click5: (i) => (i < 0.005 * SR ? Math.sin((2 * Math.PI * 1000 * i) / SR) : 0),
  click20: (i) => (i < 0.02 * SR ? Math.sin((2 * Math.PI * 1000 * i) / SR) : 0),
  kick: (i) => Math.sin((2 * Math.PI * (60 + 100 * Math.exp(-i / (0.01 * SR))) * i) / SR) * Math.exp(-i / (0.03 * SR)),
};

/** `seconds` of audio holding `events` (kind: click2, click5 (default), click20, kick, noise, hat, ohat or snare). `tone`: a 220 Hz sine under all of it, from `toneFrom`. */
export function synth(seconds, events, { tone = 0, toneFrom = 0 } = {}) {
  const pcm = new Float32Array(Math.round(seconds * SR));
  const next = mulberry32(NOISE_SEED);
  const kinds = {
    ...KINDS,
    noise: (i) => (next() * 2 - 1) * Math.exp(-i / (0.005 * SR)),
    hat: (i) => (next() * 2 - 1) * Math.exp(-i / (0.008 * SR)), // a closed hat: broadband, 8 ms
    ohat: (i) => (next() * 2 - 1) * Math.exp(-i / (0.07 * SR)), // an open hat: broadband, 70 ms
    snare: (i) => ((next() * 2 - 1) * 0.7 + 0.3 * Math.sin((2 * Math.PI * 190 * i) / SR)) * Math.exp(-i / (0.04 * SR)),
  };
  if (tone) for (let i = Math.round(toneFrom * SR); i < pcm.length; i++) pcm[i] += tone * Math.sin((2 * Math.PI * 220 * i) / SR);
  for (const { t, amp = 0.8, kind = 'click5' } of events) {
    const start = Math.round(t * SR);
    const length = Math.round((LONG_HITS[kind] ?? HIT_SECONDS) * SR);
    for (let i = 0; i < length && start + i < pcm.length; i++) pcm[start + i] += amp * kinds[kind](i);
  }
  return pcm;
}

/**
 * Hit times of a steady pulse at `bpm` from `from`, one every `every` beats, `offset` seconds late, each as a hit with
 * `amp` (or `ampAt(t)`) and `kind`; none in the last HIT_SECONDS of the clip.
 */
export function grid(bpm, seconds, { from = 0, every = 1, offset = 0, amp, kind, ampAt } = {}) {
  const hits = [];
  const period = 60 / bpm;
  for (let k = 0; from + k * period * every + offset < seconds - HIT_SECONDS; k++) {
    const t = from + k * period * every + offset;
    hits.push({ t, amp: ampAt ? ampAt(t) : amp, kind });
  }
  return hits;
}

/**
 * Hit times of a bar pattern: `notes` are [beat position, kind, amp] repeated every `beatsPerBar` beats at `bpm`; none in
 * the last HIT_SECONDS of the clip.
 */
export function bar(bpm, seconds, beatsPerBar, notes) {
  const hits = [];
  const beat = 60 / bpm;
  for (let b = 0; b * beatsPerBar * beat < seconds; b++) {
    for (const [pos, kind, amp] of notes) {
      const t = (b * beatsPerBar + pos) * beat;
      if (t < seconds - HIT_SECONDS) hits.push({ t, kind, amp });
    }
  }
  return hits;
}

/** `pcm` (mono floats, SR Hz) as the bytes of a 16-bit WAV file, for tests that run the CLI on it. */
export function pcmWav(pcm) {
  const data = Buffer.alloc(pcm.length * 2);
  pcm.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** The distance in seconds from `time` to the nearest of `hits` (`Infinity` for none). */
export const nearestHit = (time, hits) => hits.reduce((least, h) => Math.min(least, Math.abs(h.t - time)), Infinity);
