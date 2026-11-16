// The one WAV writer of the sound code (synth.mjs's cue track, bed.mjs's music bed): 48 kHz stereo 16-bit PCM with a
// 44-byte header, written through a temporary name beside the target and renamed into place.
import { rename, unlink, writeFile } from 'node:fs/promises';

export const WAV_RATE = 48000;
const INT16_MAX = 32767;
const WAV_HEADER_BYTES = 44;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const FULL_SCALE = 1;

/** The WAV bytes of two equal-length channels in -1..1, each sample hard-limited (clipped) at `limit` (default 1). */
export function wavBytes(left, right, { limit = FULL_SCALE } = {}) {
  if (left.length !== right.length) throw new RangeError(`wavBytes: the channels differ in length (${left.length} and ${right.length})`);
  const data = Buffer.alloc(left.length * CHANNELS * BYTES_PER_SAMPLE);
  const pcm = (x) => Math.round(Math.max(-limit, Math.min(limit, x)) * INT16_MAX);
  for (let i = 0; i < left.length; i++) {
    data.writeInt16LE(pcm(left[i]), i * CHANNELS * BYTES_PER_SAMPLE);
    data.writeInt16LE(pcm(right[i]), i * CHANNELS * BYTES_PER_SAMPLE + BYTES_PER_SAMPLE);
  }
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(WAV_HEADER_BYTES - 8 + data.length, 4);
  header.write('WAVEfmt ', 8, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(WAV_RATE, 24);
  header.writeUInt32LE(WAV_RATE * CHANNELS * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * Writes the two channels to `out` as a WAV (wavBytes, clipped at `limit`) through `<out>.partial`, renamed into place,
 * so `out` is never a half-written file. When writing fails the partial file is removed and the error propagates (a
 * failed removal other than "already gone" rides on it as `cleanup`). -> Promise<out>.
 */
export async function writeWav(out, left, right, { limit } = {}) {
  const partial = `${out}.partial`;
  try {
    await writeFile(partial, wavBytes(left, right, { limit }));
    await rename(partial, out);
  } catch (err) {
    await unlink(partial).catch((cleanup) => { if (cleanup.code !== 'ENOENT') err.cleanup = cleanup; });
    throw err;
  }
  return out;
}
