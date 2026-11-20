// The beats file: the beat grid scripts/beats.mjs writes for a user's music ({ source, bpm, confidence, beats }), and
// that a film's music.beats names so a corrected tempo is used instead of detecting one. Replaced version 1's
// scripts/lib/beats-file.mjs (deleted at cut-over). A beats file is data from outside: its path stays inside the film's folder after links are
// followed (as a picture's src: spec-common.mjs srcProblem), its size is capped, and its shape is checked (a bounded,
// rising list of finite seconds). It is never executed.
import { closeSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { quote, srcProblem } from '../spec-common.mjs';

export const MAX_BEATS = 10000; // about 50 minutes at 200 BPM; beats.mjs analyses five
export const MAX_BEATS_FILE_BYTES = 1024 * 1024;
// A film reads its tempo from the gaps between beats (run.mjs fileSummary), so a grid it uses needs two; the command
// writes whatever it found (one beat at the least: it stops before writing none), as version 1 did.
const MIN_BEATS_READ = 2;
const MIN_BEATS_WRITE = 1;
const DECIMALS = 100;
const round2 = (n) => Math.round(n * DECIMALS) / DECIMALS;

/** A beats file that cannot be used: its message starts with the path as the film wrote it. */
export class BeatsFileError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BeatsFileError';
  }
}

const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const shown = (v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : JSON.stringify(v));

// The first problem with the parsed contents `data`, or null.
function shapeProblem(data, minBeats) {
  if (!isPlain(data)) return 'must be an object like { "bpm": 120, "beats": [0.5, 1, 1.5] }';
  const { beats, bpm, confidence } = data;
  if (!Array.isArray(beats)) return '"beats" must be an array of seconds like [0.5, 1, 1.5]';
  if (beats.length < minBeats) return `"beats" lists ${beats.length} ${beats.length === 1 ? 'beat' : 'beats'}; a grid needs at least ${minBeats}`;
  if (beats.length > MAX_BEATS) return `"beats" lists ${beats.length} beats; at most ${MAX_BEATS}`;
  const bad = beats.findIndex((b) => !isNumber(b) || b < 0);
  if (bad >= 0) return `beats[${bad}] is ${shown(beats[bad])}; every beat is a number of seconds, 0 or more`;
  const unordered = beats.findIndex((b, i) => i > 0 && b <= beats[i - 1]);
  if (unordered > 0) return `beats[${unordered}] (${beats[unordered]}) does not come after beats[${unordered - 1}] (${beats[unordered - 1]}); list the beats in rising order`;
  if (bpm !== undefined && !(isNumber(bpm) && bpm > 0)) return `"bpm" must be a number above 0 (got ${shown(bpm)})`;
  if (confidence !== undefined && !(isNumber(confidence) && confidence >= 0 && confidence <= 1)) return `"confidence" must be a number from 0 to 1 (got ${shown(confidence)})`;
  return null;
}

// The file's real path, inside `specDir`, a .json regular file of at most MAX_BEATS_FILE_BYTES; else a BeatsFileError.
function containedFile(src, specDir) {
  const refuse = (why) => new BeatsFileError(`${quote(src)} ${why}`);
  if (typeof src !== 'string' || src === '') throw new BeatsFileError(`${quote(src)} must be the path of a beats file, like "music.beats.json"`);
  const problem = srcProblem(src, specDir);
  if (problem) throw new BeatsFileError(problem.startsWith(quote(src)) ? problem : `${quote(src)}: ${problem}`);
  if (path.extname(src).toLowerCase() !== '.json') throw refuse('must be a .json file (scripts/beats.mjs writes <music>.beats.json)');
  const real = realpathSync(path.resolve(specDir, src));
  const stat = statSync(real);
  if (!stat.isFile()) throw refuse('is not a regular file; name the beats file itself');
  if (stat.size > MAX_BEATS_FILE_BYTES) throw refuse(`is ${stat.size} bytes; a beats file is at most ${MAX_BEATS_FILE_BYTES} bytes`);
  return real;
}

/**
 * The beat grid of the beats file `src` (relative to the film's folder `specDir`): { bpm, beats, confidence }, bpm and
 * confidence null when the file does not give them. Throws a BeatsFileError naming `src` for a path outside the folder,
 * a missing, special or oversized file, a name that is not .json, text that is not JSON, or a malformed grid.
 */
export function readBeatsFile(src, specDir) {
  const real = containedFile(src, specDir);
  let data;
  try {
    data = JSON.parse(readFileSync(real, 'utf8'));
  } catch (err) {
    throw new BeatsFileError(`${quote(src)} is not valid JSON: ${err.message}`);
  }
  const problem = shapeProblem(data, MIN_BEATS_READ);
  if (problem) throw new BeatsFileError(`${quote(src)}: ${problem}`);
  return { bpm: data.bpm ?? null, beats: [...data.beats], confidence: data.confidence ?? null };
}

/** Whether `file` may be replaced by a new beats file: empty (an interrupted write), or a JSON object with a beats array. */
export function isBeatsFile(file) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return false;
  }
  if (size === 0) return true;
  if (size > MAX_BEATS_FILE_BYTES) return false;
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return isPlain(data) && Array.isArray(data.beats);
  } catch {
    return false; // not JSON: not a beats file, so never replaced
  }
}

// One object, the beats on a single line: a long list stays readable in a diff and in a prompt.
function beatsText({ source, bpm, confidence, beats }) {
  const head = JSON.stringify({ source, bpm: round2(bpm), confidence: round2(confidence) }, null, 2).slice(0, -2);
  return `${head},\n  "beats": ${JSON.stringify(beats)}\n}\n`;
}

/** Writes the grid to `out`, whole or not at all: to a partial file beside it, then renamed onto it. */
export function writeBeatsFile(out, grid) {
  const problem = shapeProblem(grid, MIN_BEATS_WRITE);
  if (problem) throw new BeatsFileError(`writeBeatsFile: ${problem}`);
  mkdirSync(path.dirname(out), { recursive: true });
  const partial = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.partial`);
  rmSync(partial, { force: true });
  closeSync(openSync(partial, 'wx'));
  try {
    writeFileSync(partial, beatsText(grid));
    renameSync(partial, out);
  } finally {
    rmSync(partial, { force: true });
  }
}
