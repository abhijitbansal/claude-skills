// Version 1's sound cues: the recorded samples and the spec-level functions that turn a spec's `cues` into mix tracks.
// The synthesis itself (ten procedural cues, the building blocks, the WAV writer) moved to scripts/v2/sound/cue-synth.mjs,
// which version 2 loads; this file re-exports it under the old names and adds what only version 1 uses.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCues, KENNEY_NAMES, KENNEY_PREFIX, isSampleCue } from '../../template/audio.mjs';
import { TYPING_SECONDS_PER_CHAR } from '../../template/defaults.mjs';
import { SAMPLE_RATE, cueWav as synthesisedCueWav, channelsWav } from '../v2/sound/cue-synth.mjs';

export { SAMPLE_RATE, noteHz, pinkNoise, MAX_HZ, fmBand, FM_CLICK_RATIO, reverbTail, widen, layerCue, CUE_LAYERS, levelled } from '../v2/sound/cue-synth.mjs';

const TAIL_SECONDS = 0.005; // the fade-out of every cue track, so one the video ends in the middle of still falls to silence

// ---- recorded samples --------------------------------------------------------------------------

const KENNEY_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/sfx/kenney');
const SAMPLE_HEADER_BYTES = 44;
const SAMPLE_CHANNELS = 1;
const SAMPLE_BITS = 16;

/**
 * A bundled recording as samples in -1..1. `alias` is looked up in KENNEY_NAMES and only then joined into the path, so no
 * value from a spec can reach the file system. The file must be a 44-byte-header 48 kHz mono 16-bit PCM WAV.
 */
export function loadSample(alias) {
  if (!KENNEY_NAMES.includes(alias)) {
    throw new Error(`unknown sample ${JSON.stringify(`${KENNEY_PREFIX}${alias}`)}; samples: ${KENNEY_NAMES.map((n) => `${KENNEY_PREFIX}${n}`).join(', ')}`);
  }
  const buf = readFileSync(path.join(KENNEY_DIR, `${alias}.wav`));
  const format = [buf.readUInt16LE(20), buf.readUInt16LE(22), buf.readUInt32LE(24), buf.readUInt16LE(34)];
  const riff = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE' && buf.toString('ascii', 36, 40) === 'data';
  if (!riff || format.join() !== [1, SAMPLE_CHANNELS, SAMPLE_RATE, SAMPLE_BITS].join()) {
    throw new Error(`sample ${alias}.wav must be 48 kHz mono 16-bit PCM with a 44-byte header`);
  }
  const count = Math.min(buf.readUInt32LE(40), buf.length - SAMPLE_HEADER_BYTES) >> 1;
  return Float64Array.from({ length: count }, (_, i) => buf.readInt16LE(SAMPLE_HEADER_BYTES + i * 2) / 32768);
}

/**
 * One cue as a WAV Buffer: a synthesised one (cue-synth.mjs), or a recording (`kenney:<alias>`, see loadSample) that goes
 * through the same peak, pan and fade. A recorded cue is mono, so both channels are the same samples.
 */
export function cueWav({ cue, note, pan = 0, chars = 1, spacing = TYPING_SECONDS_PER_CHAR }) {
  if (!isSampleCue(cue)) return synthesisedCueWav({ cue, note, pan, chars, spacing });
  const mono = loadSample(cue.slice(KENNEY_PREFIX.length));
  return channelsWav({ left: mono, right: mono, pan });
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
    const file = path.join(dir, `cue-${i}-${cue.replace(':', '-')}.wav`); // no colon in a file name (Windows)
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
