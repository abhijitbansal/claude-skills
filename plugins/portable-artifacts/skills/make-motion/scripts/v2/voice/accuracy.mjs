// How close the measured word starts of version 2 narration are to where the voice really starts each word.
//
//   node scripts/v2/voice/accuracy.mjs [--voice af_heart] [--json] [--runtime <dir>] [--model <dir>] [--out <dir>]
//
// It builds one film with a shot per narration line (test/v2/fixtures/voice/accuracy-fixtures.mjs) and makes its voice
// through the product path, synthesiseFilm (the worker, the lead-in trim, the cache), then reads the sidecar's word
// starts and the shot WAVs. Nothing here synthesises or maps durations itself.
//
// Two detectors read only the WAVs through ffmpeg, never a prediction:
// - silence onsets: silencedetect at -40 dB and 80 ms on each shot's WAV (one line, all its calls and pauses joined);
//   the onset at the end of the file is dropped, and so is any onset whose sound lasts under 100 ms before the next
//   silence (a word-final stop burst). This sees only word starts that follow a silence.
// - mid-phrase: highpass 5 kHz twice, then silencedetect at -35 dB and 30 ms, on words that start with s or sh after a
//   vowel or sonorant with only a space between, chosen from the phoneme string of the call the worker planned.
// Each WAV is preceded by LEAD_IN_SECONDS of digital silence before detection (and the onsets moved back by as much):
// the lead-in trim leaves only 75 ms before a shot's first word, under the 80 ms silence the detector needs.
// Onsets are paired with predicted starts by mutual nearest neighbour; an onset or a word without a partner is dropped.
//
// The runtime and the model come from --runtime and --model, else MAKE_MOTION_VOICE_RUNTIME and MAKE_MOTION_VOICE_MODEL,
// else the real locations. The model is never downloaded here. Exit 0 when the held-out median is at most 40 ms,
// 1 when it is over, 2 for a usage mistake or machine trouble.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSay } from '../../../engine/script/say.mjs';
import { registries } from '../../../engine/registry.mjs';
import { findFfmpeg } from '../../lib/ffmpeg.mjs';
import { OPTIONAL_ROOT } from '../../lib/optional.mjs';
import { FIXTURES, MIDPHRASE, REVIEW } from '../../../test/v2/fixtures/voice/accuracy-fixtures.mjs';
import { planShotCalls } from './kokoro.mjs';
import { VOICE_MODEL, voiceModelDir } from './model.mjs';
import { synthesiseFilm } from './synth.mjs';
import { loadVocab } from './tokens.mjs';
import { loadRuntime } from './worker.mjs';
import { isEmptySpan, isMergedWith } from './words.mjs';

/** The held-out median, in ms, above which the script exits 1. */
export const HELD_MEDIAN_LIMIT_MS = 40;
export const SILENCE = Object.freeze({ noise: '-40dB', minSilenceSeconds: 0.08, minRunSeconds: 0.1 });
export const HIGH_BAND = Object.freeze({ cutoffHz: 5000, passes: 2, noise: '-35dB', minSilenceSeconds: 0.03 });
export const LEAD_IN_SECONDS = 0.5;
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000;
const EOF_EPSILON_SECONDS = 0.01;
const MS_PER_SECOND = 1000;
const P90 = 0.9;
const MODE = 'pro';
const DEFAULT_VOICE = 'af_heart';
const DEFAULT_OUT = path.join(os.tmpdir(), 'make-motion-voice-accuracy');
const RUNTIME_ENV = 'MAKE_MOTION_VOICE_RUNTIME';
const MODEL_ENV = 'MAKE_MOTION_VOICE_MODEL';
const EXIT = Object.freeze({ ok: 0, over: 1, trouble: 2 });
const SPACE = ' ';
const STRESS_MARKS = new Set(['ˈ', 'ˌ']);
// The punctuation characters of the phoneme string, as words.mjs reads them.
const PUNCTUATION = new Set([...';:,.!?—…"()“”']);
const MID_ONSETS = new Set(['s', 'ʃ']);
// A vowel, a length mark or a sonorant (the spike's set): no silence and no stop closure before the next word.
const SOFT_END = new Set([...'aeiouɑɐɒæɔəɚɛɜɪʊʌᵻːlmnŋɹwj']);
const CONTEXTS = Object.freeze(['callStart', 'afterPunctuation', 'midPhrase']);

export const PAIRING = 'mutual nearest neighbour between detected onsets and the sidecar\'s predicted starts (the product rule, '
  + 'leads included), per shot; silence onsets against every word of the shot, high-band onsets against the mid-phrase '
  + 'candidates only; an onset or a word without a mutual partner is dropped';
export const NOTES = Object.freeze([
  'n, medianMs, p90Ms: silence-adjacent word starts on the 16 spike fixtures; held: the odd-indexed (0-based) fixtures only',
  'midPhrase covers only words that start with s or sh after a vowel or sonorant; other mid-phrase onsets are not measured',
  'midPhrase pairing uses the product prediction, so its precision leans on that same rule',
  'the lead constants were fitted with this same silence-onset method on the even fixtures, on one voice (af_heart), at speed 1',
  'errors are prediction minus measurement; medianMs and p90Ms are of absolute errors, biasMs the median signed error',
  'extra: silence onsets on the mid-phrase and review lines, which were never used for fitting',
  `exit 1 applies to the held-out median only (limit ${HELD_MEDIAN_LIMIT_MS} ms)`,
]);

// ---- statistics and pairing (pure) ----

const sorted = (values) => [...values].sort((a, b) => a - b);

/** The median of `values` (not reordered), or null for none. */
export function median(values) {
  if (values.length === 0) return null;
  const s = sorted(values);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The 90th percentile of `values` by nearest rank (the value at rank ceil(0.9 n)), or null for none. */
export function percentile90(values) {
  if (values.length === 0) return null;
  return sorted(values)[Math.ceil(P90 * values.length) - 1];
}

const toMs = (seconds) => (seconds === null ? null : Math.round(seconds * MS_PER_SECOND));

/** { n, medianMs, p90Ms, biasMs } of signed errors in seconds: median and p90 of the absolute errors, bias the median signed. */
export function errorStats(errors) {
  const abs = errors.map(Math.abs);
  return { n: errors.length, medianMs: toMs(median(abs)), p90Ms: toMs(percentile90(abs)), biasMs: toMs(median(errors)) };
}

// The index of the value in `values` nearest to `x` (the first on a tie).
const nearest = (x, values) => values.reduce((best, y, i) => (Math.abs(y - x) < Math.abs(values[best] - x) ? i : best), 0);

/**
 * Mutual nearest neighbours: [{ mi, pi }] where predicted[pi] is the nearest prediction to measured[mi] and
 * measured[mi] is the nearest onset to predicted[pi]. So a prediction is paired at most once, and an onset or a
 * prediction without such a partner is left out.
 */
export function pairMutual(measured, predicted) {
  if (measured.length === 0 || predicted.length === 0) return [];
  return measured.flatMap((m, mi) => {
    const pi = nearest(m, predicted);
    return nearest(predicted[pi], measured) === mi ? [{ mi, pi }] : [];
  });
}

// ---- options ----

const VALUE_OPTIONS = Object.freeze({ '--voice': 'voice', '--runtime': 'runtime', '--model': 'modelDir', '--out': 'out' });
const FLAG_OPTIONS = Object.freeze({ '--json': 'json' });
const ACCEPTED = [...Object.keys(VALUE_OPTIONS), ...Object.keys(FLAG_OPTIONS)].join(', ');

class UsageMistake extends Error {}

/** The options from `argv` and `env`; a UsageMistake naming the accepted options for anything else. */
export function parseArgs(argv, env = process.env) {
  const opts = { voice: DEFAULT_VOICE, json: false, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (Object.hasOwn(FLAG_OPTIONS, arg)) opts[FLAG_OPTIONS[arg]] = true;
    else if (Object.hasOwn(VALUE_OPTIONS, arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageMistake(`${arg} needs a value`);
      opts[VALUE_OPTIONS[arg]] = value;
    } else throw new UsageMistake(`unknown argument ${JSON.stringify(arg)} (accepted: ${ACCEPTED})`);
  }
  const runtime = opts.runtime ?? env[RUNTIME_ENV] ?? path.join(OPTIONAL_ROOT, 'voice');
  const modelDir = opts.modelDir ?? env[MODEL_ENV] ?? voiceModelDir();
  return { ...opts, runtime: path.resolve(runtime), modelDir: path.resolve(modelDir), out: path.resolve(opts.out) };
}

// ---- the film ----

const LINES = Object.freeze([
  ...FIXTURES.map((line, index) => ({ group: 'fixture', index, ...line })),
  ...MIDPHRASE.map((line, index) => ({ group: 'midphrase', index, ...line })),
  ...REVIEW.map((line, index) => ({ group: 'review', index, ...line })),
]);

/** The measurement film: one statement shot per line, in the `pro` mode, with `voice`. */
export const accuracyFilm = (voice) => ({
  version: 2,
  mode: MODE,
  voice: { name: voice },
  shots: LINES.map((line) => ({ id: `${line.group}-${line.id}`, show: 'statement', say: line.say })),
});

// ---- what each word is, from the planned calls' phoneme strings ----

// The context of the word whose span starts at token `first` (token t is kept character t - 1), read as words.mjs
// reads it: back over spaces, then punctuation means after punctuation, else mid-phrase.
function contextAt(first, chars) {
  let token = first - 1;
  while (token >= 1 && chars[token - 1] === SPACE) token--;
  return token >= 1 && PUNCTUATION.has(chars[token - 1]) ? 'afterPunctuation' : 'midPhrase';
}

const firstPhone = (span, chars) => chars.slice(span.first - 1, span.last).find((c) => !STRESS_MARKS.has(c)) ?? null;

// The words of one speech call: token index -> { context, firstPhone, isCandidate }. Empty spans and the later tokens
// of a merged run are not words of their own and are left out.
function describeCall(item) {
  const chars = [...item.input.kept];
  const { spans } = item.input;
  const out = [];
  let previous = null;
  spans.forEach((span, k) => {
    if (isEmptySpan(span) || isMergedWith(span, spans[k - 1])) return;
    const context = previous === null ? 'callStart' : contextAt(span.first, chars);
    const phone = firstPhone(span, chars);
    const isCandidate = context === 'midPhrase' && MID_ONSETS.has(phone) && SOFT_END.has(chars[previous?.last - 1]);
    out.push([item.tokens[k], { context, firstPhone: phone, isCandidate }]);
    previous = span;
  });
  return out;
}

/** Token index -> word description for a shot, from the calls planShotCalls makes for it (the worker's own plan). */
async function describeShot(say, { phonemize, vocab, pace }) {
  const { tokens } = parseSay(say);
  const items = await planShotCalls(tokens, { ...pace, shotId: 'accuracy', phonemize, vocab });
  return new Map(items.filter((item) => item.kind === 'speech').flatMap(describeCall));
}

// ---- detection ----

const silenceFilter = ({ noise, minSilenceSeconds }) => `silencedetect=noise=${noise}:d=${minSilenceSeconds}`;
const SILENCE_CHAIN = silenceFilter(SILENCE);
const HIGH_BAND_CHAIN = [...Array(HIGH_BAND.passes).fill(`highpass=f=${HIGH_BAND.cutoffHz}`), silenceFilter(HIGH_BAND)].join(',');

// silence_end (onsets) and silence_start (offsets) in seconds from the WAV's first sample, from ffmpeg's stderr.
function runDetector(ffmpeg, wav, chain) {
  const args = ['-hide_banner', '-nostats', '-i', wav, '-af', `adelay=${LEAD_IN_MS},${chain}`, '-f', 'null', '-'];
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    const tail = String(r.stderr ?? r.error?.message ?? '').trim().split('\n').slice(-2).join(' ');
    throw new Error(`ffmpeg failed on ${wav}: ${tail}`);
  }
  const times = (re) => [...r.stderr.matchAll(re)].map((m) => Number(m[1]) - LEAD_IN_SECONDS);
  return { onsets: times(/silence_end: (-?[\d.]+)/g), offsets: times(/silence_start: (-?[\d.]+)/g) };
}

/** Onsets that are not the end of the file and whose sound lasts at least `minRun` seconds before the next silence. */
export function keptOnsets({ onsets, offsets }, seconds, minRun) {
  const nextOffset = (t) => offsets.find((x) => x > t) ?? seconds;
  return onsets.filter((t) => t < seconds - EOF_EPSILON_SECONDS && nextOffset(t) - t >= minRun);
}

// ---- one shot ----

const row = (line, word, measured) => ({
  shot: `${line.group}-${line.id}`,
  group: line.group,
  index: line.index,
  word: word.text,
  context: word.context,
  emphasis: word.emphasis,
  predictedMs: toMs(word.start),
  measuredMs: toMs(measured),
  errorMs: toMs(word.start - measured),
  error: word.start - measured,
});

const pairedRows = (line, onsets, words) => pairMutual(onsets, words.map((w) => w.start))
  .map(({ mi, pi }) => row(line, words[pi], onsets[mi]));

// The sidecar's words of one shot joined to their descriptions; only real words (described) are kept.
function wordsOf(entry, described) {
  const flat = entry.sentences.flatMap((s) => s.words);
  return flat.flatMap((w, t) => (described.has(t) ? [{ ...w, ...described.get(t) }] : []));
}

async function measureShot(line, entry, { dir, ffmpeg, describe }) {
  const words = wordsOf(entry, await describe(line.say));
  if (entry.wav === null) return { words: words.length, silence: [], mid: [], candidates: 0 };
  const wav = path.join(dir, entry.wav);
  const onsets = keptOnsets(runDetector(ffmpeg, wav, SILENCE_CHAIN), entry.seconds, SILENCE.minRunSeconds);
  const candidates = words.filter((w) => w.isCandidate);
  const high = runDetector(ffmpeg, wav, HIGH_BAND_CHAIN).onsets.filter((t) => t < entry.seconds - EOF_EPSILON_SECONDS);
  return { words: words.length, silence: pairedRows(line, onsets, words), mid: pairedRows(line, high, candidates), candidates: candidates.length };
}

// ---- the summary ----

const statsOf = (rows) => errorStats(rows.map((r) => r.error));
const byContext = (rows) => Object.fromEntries(CONTEXTS.map((c) => [c, statsOf(rows.filter((r) => r.context === c))]));
const publicRow = ({ error, ...rest }) => rest;

/** The report from every shot's measurement. `ok` is the held-out median rule alone. */
export function summarise(shots, setup) {
  const silence = shots.flatMap((s) => s.silence);
  const mid = shots.flatMap((s) => s.mid);
  const fixtures = silence.filter((r) => r.group === 'fixture');
  const held = fixtures.filter((r) => r.index % 2 === 1);
  const heldStats = statsOf(held);
  const midStats = { ...statsOf(mid), candidates: shots.reduce((n, s) => n + s.candidates, 0), emphasised: statsOf(mid.filter((r) => r.emphasis)) };
  return {
    ok: heldStats.medianMs !== null && heldStats.medianMs <= HELD_MEDIAN_LIMIT_MS,
    ...statsOf(fixtures),
    held: heldStats,
    midPhrase: midStats,
    byContext: { all: byContext(fixtures), held: byContext(held) },
    extra: statsOf(silence.filter((r) => r.group !== 'fixture')),
    coverage: { words: shots.reduce((n, s) => n + s.words, 0), silencePaired: silence.length, midPhrasePaired: mid.length },
    pairing: PAIRING,
    notes: NOTES,
    setup,
    rows: { silence: silence.map(publicRow), midPhrase: mid.map(publicRow) },
  };
}

const fmt = ({ n, medianMs, p90Ms, biasMs }) => `n=${n} median ${medianMs} ms, p90 ${p90Ms} ms, bias ${biasMs} ms`;

/** The report as lines of text. */
export function formatReport(report) {
  const contexts = (which) => CONTEXTS.map((c) => `  ${which} ${c}: ${fmt(report.byContext[which][c])}`);
  return [
    `fixtures (silence onsets): ${fmt(report)}`,
    `held-out (odd fixtures):   ${fmt(report.held)}  limit ${HELD_MEDIAN_LIMIT_MS} ms: ${report.ok ? 'ok' : 'OVER'}`,
    `mid-phrase (s/sh only):    ${fmt(report.midPhrase)} of ${report.midPhrase.candidates} candidates; emphasised ${fmt(report.midPhrase.emphasised)}`,
    `extra lines:               ${fmt(report.extra)}`,
    ...contexts('all'),
    ...contexts('held'),
    `pairing: ${report.pairing}`,
    ...report.notes.map((note) => `note: ${note}`),
    `setup: ${JSON.stringify(report.setup)}`,
  ].join('\n');
}

// ---- main ----

const MODEL_HINT = `the model is never downloaded here: pass --model or set ${MODEL_ENV} to a folder with the pinned files`;

class MissingModel extends Error {}

// Every pinned file present at its byte count (synthesiseFilm then checks the hashes, offline).
function checkModelPresent(modelDir) {
  const missing = VOICE_MODEL.files.filter((f) => !existsSync(path.join(modelDir, f.path)) || statSync(path.join(modelDir, f.path)).size !== f.bytes);
  if (missing.length > 0) throw new MissingModel(`${modelDir} lacks the pinned voice model file(s) ${missing.map((f) => f.path).join(', ')}`);
}

async function measure(opts, log) {
  checkModelPresent(opts.modelDir);
  const ffmpeg = await findFfmpeg();
  const film = accuracyFilm(opts.voice);
  const made = await synthesiseFilm(film, { outDir: opts.out, voice: opts.voice, runtime: opts.runtime, modelDir: opts.modelDir, offline: true, log });
  const { phonemize } = await loadRuntime(opts.runtime);
  const vocab = loadVocab(JSON.parse(readFileSync(path.join(opts.modelDir, 'tokenizer.json'), 'utf8')));
  const { voiceSpeed, emphasisPause } = registries.modes.get(MODE);
  const describe = (say) => describeShot(say, { phonemize, vocab, pace: { speed: voiceSpeed, emphasisPause } });
  const shots = [];
  for (const [i, line] of LINES.entries()) shots.push(await measureShot(line, made.sidecar.shots[i], { dir: made.dir, ffmpeg, describe }));
  const setup = {
    voice: opts.voice, mode: MODE, voiceSpeed, emphasisPause, model: `${VOICE_MODEL.id}@${VOICE_MODEL.commit}`,
    runtime: opts.runtime, modelDir: opts.modelDir, cacheDir: made.dir, cached: made.cached, ffmpeg,
    silence: SILENCE, highBand: HIGH_BAND, leadInSeconds: LEAD_IN_SECONDS, lines: { fixtures: FIXTURES.length, midphrase: MIDPHRASE.length, review: REVIEW.length },
  };
  return summarise(shots, setup);
}

async function main(argv) {
  const opts = parseArgs(argv);
  const log = (line) => process.stderr.write(`${line}\n`);
  const report = await measure(opts, log);
  process.stdout.write(`${opts.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
  if (report.held.n === 0) {
    process.stderr.write('accuracy: no held-out word start was measured, so the rule cannot be judged\n');
    return EXIT.trouble;
  }
  return report.ok ? EXIT.ok : EXIT.over;
}

function troubleMessage(err) {
  const hint = err instanceof UsageMistake ? `usage: node accuracy.mjs [${ACCEPTED}]` : err instanceof MissingModel ? MODEL_HINT : err?.hint ?? null;
  return `accuracy: ${String(err?.message ?? err).split('\n')[0]}${hint ? `\nhint: ${hint}` : ''}\n`;
}

const isMain = process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

// The process ends by itself (exitCode, never process.exit), as worker.mjs does: onnxruntime-node is loaded here too.
if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(troubleMessage(err));
      process.exitCode = EXIT.trouble;
    },
  );
}
