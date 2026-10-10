// Writes a tiny 16-bit PCM WAV (sine tone) so tests never commit a binary fixture.
import { writeFileSync } from 'node:fs';

const DEFAULT_SAMPLE_RATE = 8000;
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const TONE_HZ = 440;
const AMPLITUDE = 0.5;

// `channels` 1 or 2; with `leftOnly` the right channel is digital silence (a stereo-collapse detector).
export function wavBuffer({ seconds = 0.5, sampleRate = DEFAULT_SAMPLE_RATE, channels = 1, leftOnly = false, toneHz = TONE_HZ } = {}) {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * BYTES_PER_SAMPLE);
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin((2 * Math.PI * toneHz * i) / sampleRate) * AMPLITUDE * 32767);
    for (let c = 0; c < channels; c++) {
      data.writeInt16LE(leftOnly && c > 0 ? 0 : sample, (i * channels + c) * BYTES_PER_SAMPLE);
    }
  }
  const blockAlign = channels * BYTES_PER_SAMPLE;
  const header = Buffer.alloc(HEADER_BYTES);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

export function writeWav(file, opts) {
  writeFileSync(file, wavBuffer(opts));
}
