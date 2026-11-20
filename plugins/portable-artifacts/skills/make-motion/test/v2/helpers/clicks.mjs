// Test audio for the beats command and music files: a mono 16-bit WAV of 1 kHz clicks on silence at a tempo, and seeded
// white noise (no steady beat). Written here rather than imported from version 1's test helpers.
import { writeFileSync } from 'node:fs';

const RATE = 22050;
const CLICK_HZ = 1000;
const CLICK_MS = 5;
const AMPLITUDE = 0.8;
const INT16 = 32767;
const HEADER_BYTES = 44;

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * INT16), i * 2));
  const head = Buffer.alloc(HEADER_BYTES);
  head.write('RIFF', 0);
  head.writeUInt32LE(HEADER_BYTES - 8 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20); // PCM
  head.writeUInt16LE(1, 22); // mono
  head.writeUInt32LE(RATE, 24);
  head.writeUInt32LE(RATE * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

/** Writes `seconds` of clicks at `bpm` (the first at 0) to `file`. */
export function writeClicks(file, { bpm, seconds }) {
  const period = (60 / bpm) * RATE;
  const burst = Math.round((CLICK_MS / 1000) * RATE);
  const samples = Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => {
    const into = i % period;
    return into < burst ? AMPLITUDE * Math.sin((2 * Math.PI * CLICK_HZ * into) / RATE) : 0;
  });
  writeFileSync(file, wav(samples));
}

/** Writes `seconds` of seeded white noise to `file` (mulberry32, so the file is the same on every run). */
export function writeNoise(file, { seconds, seed = 3 }) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  writeFileSync(file, wav(Float32Array.from({ length: Math.round(seconds * RATE) }, () => (next() * 2 - 1) * 0.5)));
}
