// Writes a tiny mono 16-bit PCM WAV (sine tone) so tests never commit a binary fixture.
import { writeFileSync } from 'node:fs';

const SAMPLE_RATE = 8000;
const HEADER_BYTES = 44;
const TONE_HZ = 440;
const AMPLITUDE = 0.5;

export function wavBuffer({ seconds = 0.5 } = {}) {
  const frames = Math.round(seconds * SAMPLE_RATE);
  const data = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * TONE_HZ * i) / SAMPLE_RATE) * AMPLITUDE * 32767), i * 2);
  }
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function writeWav(file, opts) {
  writeFileSync(file, wavBuffer(opts));
}
