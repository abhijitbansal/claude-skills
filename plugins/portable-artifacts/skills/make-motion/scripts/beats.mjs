#!/usr/bin/env node
// node scripts/beats.mjs <audio> [--out <file>.json] [--min-confidence 0.5] [--bpm <n> | --min-bpm <n> --max-bpm <n>]
// Finds the beat grid of an audio file with ffmpeg and writes { "source", "bpm", "confidence", "beats": [seconds…] } to
// <audio-stem>.beats.json beside the audio (or --out). Name that file in a spec's root `beats`, then write a keyframe `t`
// or a cue `at` as "beat:<n>". Prints the path, then "<bpm> BPM, <count> beats". Exit 1 when no steady beat is found
// (confidence under --min-confidence) or ffmpeg cannot decode the file; exit 2 for a usage problem. --bpm forces the
// grid at that tempo (the confidence is then the fit of that tempo); --min-bpm and --max-bpm narrow the tempo search.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { UsageError } from '../shared/cli.mjs';
import { didYouMean } from '../shared/errors.mjs';
import { findFfmpeg } from './lib/ffmpeg.mjs';
import { inputClashes } from './lib/paths.mjs';
import { MAX_BEATS_FILE_BYTES } from './lib/beats-file.mjs';
import { SAMPLE_RATE, MIN_BPM, MAX_BPM, BPM_LIMITS, DRIFT_LIMIT, minSeconds, checkAudioPath, decodePcm, detectBeats } from './lib/beats.mjs';

const USAGE = 'usage: node scripts/beats.mjs <audio> [--out <file>.json] [--min-confidence 0.5] [--bpm <n> | --min-bpm <n> --max-bpm <n>]';
const VALUE_FLAGS = ['--out', '--min-confidence', '--bpm', '--min-bpm', '--max-bpm'];
const DEFAULT_MIN_CONFIDENCE = 0.5;
const DECIMALS = 100;
const round2 = (n) => Math.round(n * DECIMALS) / DECIMALS;

function takeValue(argv, i, flag) {
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`);
  return value;
}

// A tempo flag's value: a number inside BPM_LIMITS, or a usage error that says what is accepted.
function tempoFlag(flag, text) {
  const value = Number(text);
  const [low, high] = BPM_LIMITS;
  if (!/^\d+(\.\d+)?$/.test(String(text)) || value < low || value > high) { // a plain decimal: not 0x78, 1e2 or " 120 "
    throw new UsageError(`${flag} must be a number of beats per minute from ${low} to ${high} (got ${JSON.stringify(text)})`);
  }
  return value;
}

function parseArgs(argv) {
  const given = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS.includes(a)) given[a] = takeValue(argv, i++, a);
    else if (a.startsWith('--')) {
      const near = didYouMean(a, VALUE_FLAGS);
      throw new UsageError(`unknown option ${a}${near ? `; did you mean ${near}?` : ''} (accepted: ${VALUE_FLAGS.join(', ')})`);
    } else rest.push(a);
  }
  if (rest.length !== 1) throw new UsageError(USAGE);
  const text = given['--min-confidence'] ?? DEFAULT_MIN_CONFIDENCE;
  const minimum = Number(text);
  if (String(text).trim() === '' || !Number.isFinite(minimum) || minimum < 0 || minimum > 1) {
    throw new UsageError(`--min-confidence must be a number from 0 to 1 (got ${JSON.stringify(text)})`);
  }
  const opts = { audio: rest[0], out: given['--out'], minConfidence: minimum };
  if (given['--bpm'] !== undefined) {
    if (given['--min-bpm'] !== undefined || given['--max-bpm'] !== undefined) {
      throw new UsageError('--bpm forces the tempo, so it cannot be combined with --min-bpm or --max-bpm; use one or the other');
    }
    return { ...opts, bpm: tempoFlag('--bpm', given['--bpm']) };
  }
  const minBpm = given['--min-bpm'] === undefined ? MIN_BPM : tempoFlag('--min-bpm', given['--min-bpm']);
  const maxBpm = given['--max-bpm'] === undefined ? MAX_BPM : tempoFlag('--max-bpm', given['--max-bpm']);
  if (minBpm >= maxBpm) {
    if (given['--min-bpm'] === undefined) throw new UsageError(`--max-bpm (${maxBpm}) must be above --min-bpm, which defaults to ${MIN_BPM}; pass a lower --min-bpm too`);
    if (given['--max-bpm'] === undefined) throw new UsageError(`--min-bpm (${minBpm}) must be below --max-bpm, which defaults to ${MAX_BPM}; pass a higher --max-bpm too`);
    throw new UsageError(`--min-bpm (${minBpm}) must be below --max-bpm (${maxBpm}); the search defaults to ${MIN_BPM} to ${MAX_BPM}`);
  }
  return { ...opts, minBpm, maxBpm };
}

// The audio must be a readable regular file (exit 2 otherwise, before ffmpeg is asked anything).
function checkAudioFile(audio) {
  checkAudioPath(audio);
  let stat;
  try { stat = statSync(audio); } catch (e) { throw new UsageError(`cannot read ${audio}: ${e.code ?? e.message}`); }
  if (!stat.isFile()) throw new UsageError(`cannot read ${audio}: not a regular file`);
}

// An existing file may be replaced only when it is itself a beats file (a JSON object with a `beats` array): a rerun
// refreshes it, and a motion spec or any other .json is never overwritten by a mistyped --out.
function isBeatsFile(file) {
  try {
    const { size } = statSync(file);
    if (size === 0) return true; // an interrupted write left nothing worth keeping
    if (size > MAX_BEATS_FILE_BYTES) return false;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return data !== null && typeof data === 'object' && Array.isArray(data.beats);
  } catch {
    return false;
  }
}

// Where the beats go: --out, else <audio-stem>.beats.json beside the audio. Never the audio itself (or a file that
// reaches it), never a folder or a symbolic link, always a .json file, and over an existing file only a beats file.
function outputPath(opts) {
  const parsed = path.parse(path.resolve(opts.audio));
  const out = path.resolve(opts.out ?? path.join(parsed.dir, `${parsed.name}.beats.json`));
  const [clash] = inputClashes([{ index: 0, out }], [{ file: opts.audio, what: 'the audio' }], { reader: 'this command', fix: 'choose another --out' });
  if (clash) throw new UsageError(`--out: ${clash.message}`);
  if (path.extname(out).toLowerCase() !== '.json') throw new UsageError(`--out: ${path.basename(out)} is not a .json file; a beats file ends in .json`);
  let stat = null;
  try { stat = lstatSync(out); } catch { /* not there yet: fine */ }
  if (stat?.isSymbolicLink()) throw new UsageError(`--out: ${path.basename(out)} is a symbolic link; choose a regular file name`);
  if (stat?.isDirectory()) throw new UsageError(`--out: ${out} is a folder; name the .json file`);
  if (stat?.isFile() && !isBeatsFile(out)) throw new UsageError(`--out: ${path.basename(out)} exists and is not a beats file; choose another --out`);
  return out;
}

// One object, the beats on a single line: a long list stays readable in a diff and in a prompt.
function beatsText({ source, bpm, confidence, beats }) {
  const head = JSON.stringify({ source, bpm: round2(bpm), confidence: round2(confidence) }, null, 2).slice(0, -2);
  return `${head},\n  "beats": ${JSON.stringify(beats)}\n}\n`;
}

// The file appears whole or not at all: written beside the target, then renamed onto it.
function writeBeats(out, text) {
  mkdirSync(path.dirname(out), { recursive: true });
  const partial = path.join(path.dirname(out), `.${path.basename(out)}.${process.pid}.partial`);
  rmSync(partial, { force: true });
  closeSync(openSync(partial, 'wx'));
  try {
    writeFileSync(partial, text);
    renameSync(partial, out);
  } finally {
    rmSync(partial, { force: true });
  }
}

// The reason a failure gives, if there is one to give: a forced tempo whose grid drifts is a few percent off; a found
// tempo whose grid drifts (when the drift is what put it under the gate) changes or wanders; a narrowed range that found
// nothing holds no beat of the track.
function whyNoBeat(opts, { drift, confidenceBeforeDrift }, narrowed) {
  const slide = `: the grid drifts ${drift.toFixed(2)} of a beat across the track; `;
  if (opts.bpm !== undefined) return drift > DRIFT_LIMIT ? `${slide}retry without --bpm, or with a tempo closer to the track's` : '';
  if (drift > DRIFT_LIMIT && confidenceBeforeDrift >= opts.minConfidence) return `${slide}the tempo changes or wanders, so aim --min-bpm and --max-bpm at the part you need, or give --bpm for a tempo you know`;
  return narrowed ? ': no beat in that range; the track may be faster or slower' : '';
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  checkAudioFile(opts.audio);
  const out = outputPath(opts);
  const pcm = decodePcm(await findFfmpeg(), opts.audio);
  const needed = Math.ceil(minSeconds(opts.bpm === undefined ? opts.minBpm : MIN_BPM) * 10) / 10; // rounded up, so "needs" is never less than what is checked
  if (pcm.length / SAMPLE_RATE < needed) {
    process.stderr.write(`${path.basename(opts.audio)} is too short to find a beat (needs about ${needed.toFixed(1)} s of audio, this has ${(pcm.length / SAMPLE_RATE).toFixed(1)} s)\n`);
    process.exitCode = 1;
    return;
  }
  const found = detectBeats(pcm, { bpm: opts.bpm, minBpm: opts.minBpm, maxBpm: opts.maxBpm });
  const { bpm, confidence, beats } = found;
  if (beats.length === 0 || confidence < opts.minConfidence) {
    const at = opts.bpm === undefined ? '' : ` at ${opts.bpm} BPM`;
    const narrowed = opts.bpm === undefined && (opts.minBpm !== MIN_BPM || opts.maxBpm !== MAX_BPM) ? ` between ${opts.minBpm} and ${opts.maxBpm} BPM` : '';
    process.stderr.write(`no steady beat found${at}${narrowed} in ${path.basename(opts.audio)} (confidence ${confidence.toFixed(2)}; needs ${opts.minConfidence})${whyNoBeat(opts, found, narrowed !== '')}\n`);
    process.exitCode = 1;
    return;
  }
  const source = path.relative(path.dirname(out), path.resolve(opts.audio)).split(path.sep).join('/');
  writeBeats(out, beatsText({ source, bpm, confidence, beats }));
  process.stdout.write(`${out}\n${round2(bpm)} BPM, ${beats.length} beats\n`);
}

main().catch((e) => {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = e instanceof UsageError ? 2 : 1;
});
