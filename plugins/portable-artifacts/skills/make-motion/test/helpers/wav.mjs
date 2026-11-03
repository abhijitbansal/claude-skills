// Writes a tiny 16-bit PCM WAV (sine tone) so tests never commit a binary fixture.
import { writeFileSync } from 'node:fs';

const DEFAULT_SAMPLE_RATE = 8000;
const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const TONE_HZ = 440;
const AMPLITUDE = 0.5;
const CLICK_HZ = 1000;
const CLICK_BURST_SECONDS = 0.02;

// `channels` 1 or 2; with `leftOnly` the right channel is digital silence (a stereo-collapse detector).
// `clickBpm` swaps the steady tone for a click track: a 20 ms `clickHz` burst at the start of every beat on
// exact silence (a steady tone has no onsets, and beat detection needs some). Off by default; `toneHz` is then unused.
export function wavBuffer({ seconds = 0.5, sampleRate = DEFAULT_SAMPLE_RATE, channels = 1, leftOnly = false, toneHz = TONE_HZ, clickBpm = 0, clickHz = CLICK_HZ } = {}) {
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(frames * channels * BYTES_PER_SAMPLE);
  const beatFrames = clickBpm > 0 ? Math.round((60 / clickBpm) * sampleRate) : 0;
  const burstFrames = Math.round(CLICK_BURST_SECONDS * sampleRate);
  const sampleAt = (i) => {
    if (clickBpm <= 0) return Math.sin((2 * Math.PI * toneHz * i) / sampleRate);
    const inBeat = i % beatFrames;
    return inBeat < burstFrames ? Math.sin((2 * Math.PI * clickHz * inBeat) / sampleRate) : 0;
  };
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(sampleAt(i) * AMPLITUDE * 32767);
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
