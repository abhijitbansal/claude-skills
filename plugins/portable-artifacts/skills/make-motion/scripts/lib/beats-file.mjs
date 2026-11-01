// The beats file a spec names in its root `beats`, and the one entry point that turns a spec's "beat:<n>" references into
// seconds (pipeline step 1b: after vars, before viral mode, blocks, presets and auto cues). Every consumer of a spec
// calls resolveSpecBeats: validateSpec, render (single, --batch and --contact-sheet), check, and the preview server.
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveSpecPath } from './paths.mjs';
import { resolveBeats, BeatRefError } from './beat-refs.mjs';

export const MAX_BEATS = 10000; // about 50 minutes at 200 BPM; beats.mjs analyses five
export const MAX_BEATS_FILE_BYTES = 1024 * 1024;
const NO_FILE = 'must be a path to a beats file, like "data/music.beats.json"';

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const shown = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v));

/** Whether `spec` names a beats file (an own `beats` key on a plain-object spec). */
export const declaresBeats = (spec) => isPlain(spec) && Object.hasOwn(spec, 'beats');

// The first problem with the parsed contents of beats file `name`, as a message that names it, or null. The file is
// untrusted: `beats` must be a bounded, ascending list of finite seconds, and `bpm` and `confidence` numbers when given.
function problemWith(data, name) {
  if (!isPlain(data)) return `${name}: must be an object like { "bpm": 120, "beats": [0.5, 1, 1.5] }`;
  const { beats, bpm, confidence } = data;
  if (!Array.isArray(beats)) return `${name}: "beats" must be an array of seconds like [0.5, 1, 1.5]`;
  if (beats.length === 0) return `${name}: "beats" has no beats; list at least one`;
  if (beats.length > MAX_BEATS) return `${name}: "beats" lists ${beats.length} beats; at most ${MAX_BEATS}`;
  const bad = beats.findIndex((b) => !isNumber(b) || b < 0);
  if (bad >= 0) return `${name}: beats[${bad}] is ${shown(beats[bad])}; every beat is a number of seconds, 0 or more`;
  const unordered = beats.findIndex((b, i) => i > 0 && b < beats[i - 1]);
  if (unordered > 0) return `${name}: beats[${unordered}] (${beats[unordered]}) comes before beats[${unordered - 1}] (${beats[unordered - 1]}); list the beats in ascending order`;
  if (bpm !== undefined && !(isNumber(bpm) && bpm > 0)) return `${name}: "bpm" must be a number above 0 (got ${shown(bpm)})`;
  if (confidence !== undefined && !(isNumber(confidence) && confidence >= 0 && confidence <= 1)) return `${name}: "confidence" must be a number from 0 to 1 (got ${shown(confidence)})`;
  return null;
}

/**
 * The beat times of the file `src` names (as the spec writes it, relative to the spec folder `dir`): `{ beats }`, or
 * `{ error }` with a message that says what to fix. The path follows the same containment as every asset: inside the
 * folder, no symbolic link out of it, no hidden file; and it must be a .json file of at most MAX_BEATS_FILE_BYTES.
 */
export function readBeatsFile(src, dir) {
  if (typeof src !== 'string' || src === '') return { error: NO_FILE };
  const { file, error } = resolveSpecPath(dir, src);
  if (error) return { error };
  if (path.extname(src).toLowerCase() !== '.json') return { error: `${src} must be a .json file` };
  const { size } = statSync(file);
  if (size > MAX_BEATS_FILE_BYTES) return { error: `${src} is ${size} bytes; a beats file is at most ${MAX_BEATS_FILE_BYTES} bytes` };
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return { error: `${src} is not valid JSON: ${e.message}` };
  }
  const problem = problemWith(data, src);
  return problem ? { error: problem } : { beats: data.beats };
}

/**
 * `{ spec }` with every "beat:<n>" of `spec` (its vars already substituted) replaced by seconds, or `{ errors }`
 * ([{ path, message }], the validator's shape): the beats file's own problems at `beats`, each bad reference at its field.
 * The root `beats` stays on the resolved spec (the preview server watches the file and render guards it); the page
 * ignores it. A spec with no `beats` and no reference is returned as the same object; resolving a resolved spec changes
 * nothing.
 */
export function resolveSpecBeats(spec, dir) {
  if (!isPlain(spec)) return { spec };
  let beats;
  if (declaresBeats(spec)) {
    const loaded = readBeatsFile(spec.beats, dir);
    if (loaded.error) return { errors: [{ path: 'beats', message: loaded.error }] };
    beats = loaded.beats;
  }
  try {
    return { spec: resolveBeats(spec, beats) };
  } catch (e) {
    if (e instanceof BeatRefError) return { errors: e.errors };
    throw e;
  }
}
