// How close the measured word starts of version 2 narration are to where the voice really starts each word.
//
//   node scripts/v2/voice/accuracy.mjs [--voice af_heart] [--speed 1|1.1] [--json] [--runtime <dir>] [--model <dir>] [--out <dir>]
//
// It builds one film with a shot per narration line (test/v2/fixtures/voice/accuracy-fixtures.mjs), in the mode whose
// voice speed is --speed (1: pro, 1.1: viral), and makes its voice through the product path, synthesiseFilm (the worker,
// the lead-in trim, the cache), then reads the sidecar's word starts and the shot WAVs. Nothing here synthesises or maps
// durations itself.
//
// Two detectors read only the WAVs through ffmpeg, never a prediction:
// - silence onsets: silencedetect at -40 dB and 80 ms on each shot's WAV (one line, all its calls and pauses joined);
//   the onset at the end of the file is dropped, and so is any onset whose sound lasts under 100 ms before the next
//   silence (a word-final stop burst). This sees only word starts that follow a silence.
// - mid-phrase: highpass 5 kHz twice, then silencedetect at -35 dB and 30 ms, on words that start with s or sh after a
//   vowel or sonorant with only a space between, chosen from the phoneme string of the call the worker planned.
// Each WAV is preceded by LEAD_IN_SECONDS of digital silence before detection (and the onsets moved back by as much):
// the lead-in trim leaves only 75 ms before a shot's first word, under the 80 ms silence the detector needs.
// Onsets are paired with predicted starts by mutual nearest neighbour. Silence onsets are paired only with words that
// start a speech call or follow punctuation (read from the phoneme string, never from times); each shot's first word is
// paired but kept out of the headline, since the trim places the cut from its prediction.
//
// A self-check runs on the same audio with every measurement: predictions moved +100 ms, -100 ms except each shot's
// first word, and by one word either way must each read a held-out median over the limit, or the run exits 2.
//
// The runtime and the model come from --runtime and --model, else MAKE_MOTION_VOICE_RUNTIME and MAKE_MOTION_VOICE_MODEL,
// else the real locations. The model is never downloaded here. Exit 0 when the held-out median is at most 40 ms,
// 1 when it is over, 2 for too few held-out pairs, a blind self-check, a usage mistake or machine trouble.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../../engine/modes/index.mjs';
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
/** Fewer held-out pairs than this in the headline is exit 2 (not enough measured words), never a pass. */
export const MIN_HELD_PAIRS = 12;
export const SILENCE = Object.freeze({ noise: '-40dB', minSilenceSeconds: 0.08, minRunSeconds: 0.1 });
export const HIGH_BAND = Object.freeze({ cutoffHz: 5000, passes: 2, noise: '-35dB', minSilenceSeconds: 0.03 });
export const LEAD_IN_SECONDS = 0.5;
/** The prediction shifts of the mid-phrase chance floor, in seconds. */
export const CHANCE_SHIFTS = Object.freeze({ minus150: -0.15, plus200: 0.2 });
/** A mid-phrase figure is weak evidence when a chance median is at most this many times the real median. */
export const WEAK_FACTOR = 3;
const SELF_CHECK_SHIFT_SECONDS = 0.1;
const LEAD_IN_MS = LEAD_IN_SECONDS * 1000;
const EOF_EPSILON_SECONDS = 0.01;
const FFMPEG_TIMEOUT_MS = 120000;
const MS_PER_SECOND = 1000;
const P90 = 0.9;
const SMALL_N = 10; // below this many values the nearest-rank p90 is the maximum
const DEFAULT_SPEED = '1';
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
// The contexts a silence onset may belong to: a word after a silence starts a call or follows punctuation.
const SILENCE_CONTEXTS = Object.freeze(['callStart', 'afterPunctuation']);

export const PAIRING = 'mutual nearest neighbour between detected onsets and the sidecar\'s predicted starts (the product rule, '
  + 'leads included), per shot; silence onsets only against the words that start a speech call or follow punctuation (that '
  + 'context read from the phoneme string, never from times), so an onset cannot be claimed by whichever word sits nearest; '
  + 'high-band onsets only against the mid-phrase s/sh candidates; an onset or a word without a mutual partner is left '
  + 'unpaired and counted (counts, heldDrops); no distance cap';
export const NOTES = Object.freeze([
  'held (the headline): silence-adjacent word starts on the odd-indexed (0-based) spike fixtures, not counting each shot\'s '
    + 'first word; n, medianMs, p90Ms at the top: the same on all 16 fixtures, half of which the constants were fitted on',
  'shot-first words are paired, then reported apart (shotFirst) and kept out of every headline figure: the lead-in trim '
    + 'places the cut from the prediction, so a shot\'s first word is predicted 75 ms after the cut by construction and '
    + 'its error measures the voice against the cut, not the start rule',
  'shot-first words are censored near +75 ms: a voice that starts before the cut is measured at the cut; trimMargins '
    + 'gives each shot\'s first detected onset after the cut (before the burst filter) and the smallest',
  `selfCheck: on the same audio, predictions moved +100 ms, -100 ms except each shot's first word, and by one word `
    + `either way (word k given word k-1's or k+1's start, over every sidecar token) must each read a held-out median `
    + `over ${HELD_MEDIAN_LIMIT_MS} ms; if one does not, the instrument cannot see that error and the run exits 2`,
  `exit 2 also when the headline has fewer than ${MIN_HELD_PAIRS} pairs; exit 1 only when the headline median is over `
    + `${HELD_MEDIAN_LIMIT_MS} ms`,
  'the start constants were fitted by the voice spike with this same silence-onset detector on the even fixtures, '
    + 'pooled over speeds 0.8, 1 and 1.25, on one voice (af_heart); this run measures one speed only (setup.voiceSpeed)',
  'midPhrase covers only words that start with s or sh after a vowel or sonorant; other mid-phrase onsets are not measured',
  'midPhrase and emphasised pair the product prediction with the nearest of many high-band onsets (every s, z, f, sh, t '
    + 'or k release), so they saturate: a 100 to 200 ms error can read as about 35 to 75 ms. chance is the same pairing '
    + `on predictions moved -150 and +200 ms; weak is true when either chance median is at most ${WEAK_FACTOR} times the `
    + 'real median. Whatever weak says, they show the rule is roughly right, not its precision, and never decide the exit',
  'p90 is by nearest rank, so below 10 pairs it is the maximum; maxMs is the largest absolute error',
  'errors are prediction minus measurement; medianMs, p90Ms and maxMs are of absolute errors, biasMs the median signed error',
  'extra: silence onsets on the mid-phrase and review lines (never used for fitting), not counting shot-first words; '
    + 'reviewLines names which words of the review lines were measured at all',
  'heldDrops: held-line onsets the burst filter removed (labelled with the word whose predicted start is nearest, a label '
    + 'only), and held onsets and eligible words the pairing left unpaired',
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

/** { n, medianMs, p90Ms, maxMs, biasMs } of signed errors in seconds: of the absolute errors, bias the median signed. */
export function errorStats(errors) {
  const abs = errors.map(Math.abs);
  const max = abs.length === 0 ? null : Math.max(...abs);
  return { n: errors.length, medianMs: toMs(median(abs)), p90Ms: toMs(percentile90(abs)), maxMs: toMs(max), biasMs: toMs(median(errors)) };
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

const VALUE_OPTIONS = Object.freeze({ '--voice': 'voice', '--speed': 'speedText', '--runtime': 'runtime', '--model': 'modelDir', '--out': 'out' });
const FLAG_OPTIONS = Object.freeze({ '--json': 'json' });
const ACCEPTED = [...Object.keys(VALUE_OPTIONS), ...Object.keys(FLAG_OPTIONS)].join(', ');

class UsageMistake extends Error {}

// The registered mode whose voice speed is `text`: the only product path to a speed is a film's mode.
function modeForSpeed(text) {
  const speeds = registries.modes.names().map((name) => [registries.modes.get(name).voiceSpeed, name]);
  const hit = speeds.find(([speed]) => speed === Number(text));
  if (hit === undefined) {
    const accepted = speeds.map(([speed, name]) => `${speed} (${name})`).join(', ');
    throw new UsageMistake(`--speed ${text} is not the voice speed of a mode (accepted: ${accepted})`);
  }
  return { speed: hit[0], mode: hit[1] };
}

/** The options from `argv` and `env`; a UsageMistake naming the accepted options for anything else. */
export function parseArgs(argv, env = process.env) {
  const opts = { voice: DEFAULT_VOICE, json: false, out: DEFAULT_OUT, speedText: DEFAULT_SPEED };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (Object.hasOwn(FLAG_OPTIONS, arg)) opts[FLAG_OPTIONS[arg]] = true;
    else if (Object.hasOwn(VALUE_OPTIONS, arg)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) throw new UsageMistake(`${arg} needs a value`);
      opts[VALUE_OPTIONS[arg]] = value;
    } else throw new UsageMistake(`unknown argument ${JSON.stringify(arg)} (accepted: ${ACCEPTED})`);
  }
  const { speedText, ...rest } = opts;
  const runtime = opts.runtime ?? env[RUNTIME_ENV] ?? path.join(OPTIONAL_ROOT, 'voice');
  const modelDir = opts.modelDir ?? env[MODEL_ENV] ?? voiceModelDir();
  return { ...rest, ...modeForSpeed(speedText), runtime: path.resolve(runtime), modelDir: path.resolve(modelDir), out: path.resolve(opts.out) };
}

// ---- the film ----

const LINES = Object.freeze([
  ...FIXTURES.map((line, index) => ({ group: 'fixture', index, ...line })),
  ...MIDPHRASE.map((line, index) => ({ group: 'midphrase', index, ...line })),
  ...REVIEW.map((line, index) => ({ group: 'review', index, ...line })),
]);

/** The measurement film: one statement shot per line, in `mode`, with `voice`. */
export const accuracyFilm = (voice, mode) => ({
  version: 2,
  mode,
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

/** Token index -> word description (with the say token's text) for a shot, from the calls planShotCalls makes for it. */
async function describeShot(say, { phonemize, vocab, pace }) {
  const { tokens } = parseSay(say);
  const items = await planShotCalls(tokens, { ...pace, shotId: 'accuracy', phonemize, vocab });
  const described = items.filter((item) => item.kind === 'speech').flatMap(describeCall);
  return new Map(described.map(([t, d]) => [t, { ...d, token: tokens[t].text }]));
}

/**
 * The sidecar's words of one shot joined by token index to their descriptions, in order, each with its index `t`; only
 * real (described) words are kept. A sidecar word whose text is not the planned token's is an error, not a guess.
 */
export function joinWords(entry, described) {
  return entry.sentences.flatMap((s) => s.words).flatMap((w, t) => {
    if (!described.has(t)) return [];
    const d = described.get(t);
    if (w.text !== d.token) throw new Error(`sidecar word ${t} is ${JSON.stringify(w.text)} but the planned token is ${JSON.stringify(d.token)}`);
    return [{ ...w, ...d, t }];
  });
}

// ---- detection ----

const silenceFilter = ({ noise, minSilenceSeconds }) => `silencedetect=noise=${noise}:d=${minSilenceSeconds}`;
const SILENCE_CHAIN = silenceFilter(SILENCE);
const HIGH_BAND_CHAIN = [...Array(HIGH_BAND.passes).fill(`highpass=f=${HIGH_BAND.cutoffHz}`), silenceFilter(HIGH_BAND)].join(',');

// silence_end (onsets) and silence_start (offsets) in seconds from the WAV's first sample, from ffmpeg's stderr.
function runDetector(ffmpeg, wav, chain) {
  const args = ['-hide_banner', '-nostats', '-nostdin', '-i', wav, '-af', `adelay=${LEAD_IN_MS},${chain}`, '-f', 'null', '-'];
  const r = spawnSync(ffmpeg, args, { encoding: 'utf8', timeout: FFMPEG_TIMEOUT_MS });
  if (r.error || r.status !== 0) {
    // A spawn failure or the timeout (ETIMEDOUT) is in r.error; otherwise ffmpeg's own stderr says what went wrong.
    const why = r.error ? `${r.error.message}${r.signal ? ` (signal ${r.signal})` : ''}` : String(r.stderr ?? `exit ${r.status}`);
    const tail = why.trim().split('\n').slice(-2).join(' ');
    throw new Error(`ffmpeg failed on ${wav}: ${tail}`);
  }
  const times = (re) => [...r.stderr.matchAll(re)].map((m) => Number(m[1]) - LEAD_IN_SECONDS);
  return { onsets: times(/silence_end: (-?[\d.]+)/g), offsets: times(/silence_start: (-?[\d.]+)/g) };
}

/**
 * The detected onsets split by the two filters: `eof` (the end of the file), `burst` (under `minRun` seconds of sound
 * before the next silence) and `kept` (the rest), with `detected` all of them.
 */
export function classifyOnsets({ onsets, offsets }, seconds, minRun) {
  const nextOffset = (t) => offsets.find((x) => x > t) ?? seconds;
  const isEof = (t) => t >= seconds - EOF_EPSILON_SECONDS;
  const isBurst = (t) => !isEof(t) && nextOffset(t) - t < minRun;
  return { detected: onsets, eof: onsets.filter(isEof), burst: onsets.filter(isBurst), kept: onsets.filter((t) => !isEof(t) && !isBurst(t)) };
}

// One shot as summarise reads it: its words, every sidecar token's start, and both detectors' onsets.
async function measureShot(line, entry, { dir, ffmpeg, describe }) {
  const tokens = entry.sentences.flatMap((s) => s.words);
  const base = {
    line: { group: line.group, id: `${line.group}-${line.id}`, index: line.index },
    seconds: entry.seconds,
    tokens: tokens.length,
    tokenStarts: tokens.map((w) => w.start),
    words: joinWords(entry, await describe(line.say)),
  };
  if (entry.wav === null) return { ...base, silence: classifyOnsets({ onsets: [], offsets: [] }, 0, 0), high: { detected: [], eof: [], kept: [] } };
  const wav = path.join(dir, entry.wav);
  const silence = classifyOnsets(runDetector(ffmpeg, wav, SILENCE_CHAIN), entry.seconds, SILENCE.minRunSeconds);
  const high = runDetector(ffmpeg, wav, HIGH_BAND_CHAIN).onsets;
  const isEof = (t) => t >= entry.seconds - EOF_EPSILON_SECONDS;
  return { ...base, silence, high: { detected: high, eof: high.filter(isEof), kept: high.filter((t) => !isEof(t)) } };
}

// ---- pairing one shot (pure) ----

const isEligible = (word) => SILENCE_CONTEXTS.includes(word.context);
const isFixture = (x) => x.group === 'fixture';
const isHeldLine = (x) => isFixture(x) && x.index % 2 === 1;
const unchanged = (starts) => starts;

const row = (line, word, predicted, measured, shotFirst) => ({
  shot: line.id,
  group: line.group,
  index: line.index,
  word: word.text,
  context: word.context,
  emphasis: word.emphasis,
  shotFirst,
  predictedMs: toMs(predicted),
  measuredMs: toMs(measured),
  errorMs: toMs(predicted - measured),
  error: predicted - measured,
});

// `onsets` paired with `words` predicted at `starts`: { rows, unpairedOnsets, unpairedWords }.
function pairWords(shot, onsets, words, starts) {
  const pairs = pairMutual(onsets, starts);
  const firstT = shot.words[0]?.t;
  const onsetPaired = new Set(pairs.map((p) => p.mi));
  const wordPaired = new Set(pairs.map((p) => p.pi));
  return {
    rows: pairs.map(({ mi, pi }) => row(shot.line, words[pi], starts[pi], onsets[mi], words[pi].t === firstT)),
    unpairedOnsets: onsets.filter((_, i) => !onsetPaired.has(i)),
    unpairedWords: words.filter((_, i) => !wordPaired.has(i)),
  };
}

// Silence onsets against the eligible words, their predictions taken from the (possibly mutated) token starts.
function silenceOf(shot, mutate = unchanged) {
  const starts = mutate(shot.tokenStarts, shot.words[0]?.t ?? 0);
  const eligible = shot.words.filter(isEligible);
  return pairWords(shot, shot.silence.kept, eligible, eligible.map((w) => starts[w.t]));
}

// High-band onsets against the mid-phrase candidates, their predictions moved by `shift` seconds.
function midOf(shot, shift = 0) {
  const candidates = shot.words.filter((w) => w.isCandidate);
  return pairWords(shot, shot.high.kept, candidates, candidates.map((w) => w.start + shift));
}

// ---- the self-check and the verdict (pure) ----

/** Errors the instrument must see, as mutations of one shot's token starts (`first`: the token of its first word). */
export const MUTATIONS = Object.freeze({
  plus100: (starts) => starts.map((s) => s + SELF_CHECK_SHIFT_SECONDS),
  minus100ExceptFirst: (starts, first) => starts.map((s, i) => (i === first ? s : s - SELF_CHECK_SHIFT_SECONDS)),
  labelPrevious: (starts) => starts.map((s, i) => (i === 0 ? s : starts[i - 1])),
  labelNext: (starts) => starts.map((s, i) => (i === starts.length - 1 ? s : starts[i + 1])),
});

const statsOf = (rows) => errorStats(rows.map((r) => r.error));
const notFirst = (rows) => rows.filter((r) => !r.shotFirst);
const onlyFirst = (rows) => rows.filter((r) => r.shotFirst);
const heldHeadline = (shots, mutate) => statsOf(notFirst(shots.filter((s) => isHeldLine(s.line)).flatMap((s) => silenceOf(s, mutate).rows)));

// Each mutation's headline { n, medianMs }, and the mutations whose median is not over the limit (or not measured).
function selfCheck(shots) {
  const medians = Object.fromEntries(Object.entries(MUTATIONS).map(([name, mutate]) => {
    const { n, medianMs } = heldHeadline(shots, mutate);
    return [name, { n, medianMs }];
  }));
  const blind = Object.entries(medians).filter(([, f]) => f.medianMs === null || f.medianMs <= HELD_MEDIAN_LIMIT_MS).map(([name]) => name);
  return { limitMs: HELD_MEDIAN_LIMIT_MS, medians, blind };
}

/** { verdict, exitCode, message } from the headline and the self-check: too few pairs, then blind, then the limit. */
export function verdictOf(held, check) {
  if (held.n < MIN_HELD_PAIRS) {
    return { verdict: 'too-few', exitCode: EXIT.trouble, message: `not enough measured words: ${held.n} held-out pairs, at least ${MIN_HELD_PAIRS} needed` };
  }
  if (check.blind.length > 0) {
    const message = `the instrument cannot see the error(s) ${check.blind.join(', ')}: shifted predictions read a held-out median at or under ${HELD_MEDIAN_LIMIT_MS} ms`;
    return { verdict: 'blind', exitCode: EXIT.trouble, message };
  }
  if (held.medianMs > HELD_MEDIAN_LIMIT_MS) {
    return { verdict: 'over', exitCode: EXIT.over, message: `held-out median ${held.medianMs} ms is over the ${HELD_MEDIAN_LIMIT_MS} ms limit` };
  }
  return { verdict: 'ok', exitCode: EXIT.ok, message: `held-out median ${held.medianMs} ms is within the ${HELD_MEDIAN_LIMIT_MS} ms limit` };
}

// ---- the mid-phrase chance floor (pure) ----

// The figure of the mid-phrase rows that pass `select`, with the same pairing on shifted predictions beside it.
function midFigure(shots, select) {
  const rowsAt = (shift) => shots.flatMap((s) => midOf(s, shift).rows).filter(select);
  const real = statsOf(rowsAt(0));
  const chance = Object.fromEntries(Object.entries(CHANCE_SHIFTS).map(([name, shift]) => {
    const { n, medianMs } = statsOf(rowsAt(shift));
    return [name, { n, medianMs }];
  }));
  const isNear = (c) => real.medianMs === null || c.medianMs === null || c.medianMs <= WEAK_FACTOR * real.medianMs;
  return { ...real, chance, weak: Object.values(chance).some(isNear) };
}

function midCounts(shots) {
  const entries = shots.map((s) => ({ shot: s, ...midOf(s) }));
  const len = (pick) => entries.reduce((n, e) => n + pick(e).length, 0);
  return {
    lines: entries.filter((e) => e.shot.words.some((w) => w.isCandidate)).length,
    candidates: len((e) => e.shot.words.filter((w) => w.isCandidate)),
    onsets: { detected: len((e) => e.shot.high.detected), removedEof: len((e) => e.shot.high.eof), kept: len((e) => e.shot.high.kept) },
    paired: len((e) => e.rows),
    unpairedOnsets: len((e) => e.unpairedOnsets),
    unpairedCandidates: len((e) => e.unpairedWords),
  };
}

// ---- counts, drops, margins (pure) ----

// entries: [{ shot, rows, unpairedOnsets, unpairedWords }] from silenceOf.
function countsOf(entries) {
  const sum = (pick) => entries.reduce((n, e) => n + pick(e), 0);
  const len = (pick) => sum((e) => pick(e).length);
  const rows = entries.flatMap((e) => e.rows);
  return {
    lines: entries.length,
    tokens: sum((e) => e.shot.tokens),
    words: len((e) => e.shot.words),
    eligibleWords: len((e) => e.shot.words.filter(isEligible)),
    measured: notFirst(rows).length,
    measuredShotFirst: onlyFirst(rows).length,
    onsets: {
      detected: len((e) => e.shot.silence.detected),
      removedEof: len((e) => e.shot.silence.eof),
      removedBurst: len((e) => e.shot.silence.burst),
      kept: len((e) => e.shot.silence.kept),
      paired: len((e) => e.rows),
      unpaired: len((e) => e.unpairedOnsets),
    },
  };
}

function heldDrops(entries) {
  const held = entries.filter((e) => isHeldLine(e.shot.line));
  const nearestWord = (shot, t) => shot.words[nearest(t, shot.words.map((w) => w.start))]?.text ?? null;
  return {
    eof: held.reduce((n, e) => n + e.shot.silence.eof.length, 0),
    burst: held.flatMap((e) => e.shot.silence.burst.map((t) => ({ shot: e.shot.line.id, onsetMs: toMs(t), nearestWord: nearestWord(e.shot, t) }))),
    unpairedOnsets: held.flatMap((e) => e.unpairedOnsets.map((t) => ({ shot: e.shot.line.id, onsetMs: toMs(t) }))),
    unpairedWords: held.flatMap((e) => e.unpairedWords.map((w) => ({ shot: e.shot.line.id, word: w.text, predictedMs: toMs(w.start) }))),
  };
}

// Each shot's first detected onset after the trim cut (the WAV's first sample), before any filter, and the smallest.
function trimMargins(shots) {
  const list = shots.filter((s) => s.silence.detected.length > 0)
    .map((s) => ({ shot: s.line.id, word: s.words[0]?.text ?? null, marginMs: toMs(s.silence.detected[0]) }));
  const smallest = list.reduce((a, b) => (b.marginMs < a.marginMs ? b : a), list[0] ?? null);
  return { shots: list, smallest };
}

function reviewLines(shots, rows) {
  return shots.filter((s) => s.line.group === 'review').map((s) => {
    const measured = new Set(rows.filter((r) => r.shot === s.line.id).map((r) => r.word));
    const texts = s.words.map((w) => w.text);
    return { shot: s.line.id, measured: texts.filter((t) => measured.has(t)), unmeasured: texts.filter((t) => !measured.has(t)) };
  });
}

// ---- the summary ----

const byContext = (rows) => Object.fromEntries(SILENCE_CONTEXTS.map((c) => [c, statsOf(rows.filter((r) => r.context === c))]));
const publicRow = ({ error, ...rest }) => rest;

// The silence figures: the headline, the all-fixtures and extra figures, shot-first words apart, and their counts.
function silenceFigures(entries) {
  const rows = entries.flatMap((e) => e.rows);
  const fixtures = rows.filter(isFixture);
  const held = fixtures.filter(isHeldLine);
  const extra = rows.filter((r) => !isFixture(r));
  const pick = (test) => entries.filter((e) => test(e.shot.line));
  return {
    all: statsOf(notFirst(fixtures)),
    held: statsOf(notFirst(held)),
    shotFirst: { fixtures: statsOf(onlyFirst(fixtures)), held: statsOf(onlyFirst(held)), extra: statsOf(onlyFirst(extra)) },
    byContext: { all: byContext(notFirst(fixtures)), held: byContext(notFirst(held)) },
    extra: statsOf(notFirst(extra)),
    counts: { fixtures: countsOf(pick(isFixture)), held: countsOf(pick(isHeldLine)), extra: countsOf(pick((l) => !isFixture(l))) },
    rows,
  };
}

/** The report from every shot's measurement. `ok` is true only for the ok verdict. */
export function summarise(shots, setup) {
  const entries = shots.map((shot) => ({ shot, ...silenceOf(shot) }));
  const silence = silenceFigures(entries);
  const check = selfCheck(shots);
  const { verdict, exitCode, message } = verdictOf(silence.held, check);
  const mid = shots.flatMap((s) => midOf(s).rows);
  const midPhrase = { ...midFigure(shots, () => true), candidates: midCounts(shots).candidates, emphasised: midFigure(shots, (r) => r.emphasis) };
  return {
    ok: verdict === 'ok',
    verdict,
    exitCode,
    verdictMessage: message,
    ...silence.all,
    held: silence.held,
    shotFirst: silence.shotFirst,
    selfCheck: check,
    midPhrase,
    byContext: silence.byContext,
    extra: silence.extra,
    counts: { ...silence.counts, midPhrase: midCounts(shots) },
    heldDrops: heldDrops(entries),
    trimMargins: trimMargins(shots),
    reviewLines: reviewLines(shots, [...silence.rows, ...mid]),
    pairing: PAIRING,
    notes: NOTES,
    setup,
    rows: { silence: silence.rows.map(publicRow), midPhrase: mid.map(publicRow) },
  };
}

// ---- the text report ----

const spread = ({ n, p90Ms, maxMs }) => (n < SMALL_N ? `p90 = max ${maxMs} ms` : `p90 ${p90Ms} ms, max ${maxMs} ms`);
const fmt = (f) => `n=${f.n} median ${f.medianMs} ms, ${spread(f)}, bias ${f.biasMs} ms`;
const fmtCounts = (c) => `${c.measured} of ${c.tokens} words measured (${c.measuredShotFirst} shot-first apart; `
  + `${c.eligibleWords} of ${c.words} real words eligible); onsets detected ${c.onsets.detected}, removed eof `
  + `${c.onsets.removedEof} burst ${c.onsets.removedBurst}, kept ${c.onsets.kept}, paired ${c.onsets.paired}, unpaired ${c.onsets.unpaired}`;
const fmtChance = (f) => `chance -150 ms median ${f.chance.minus150.medianMs} ms, +200 ms median ${f.chance.plus200.medianMs} ms`
  + `${f.weak ? ` -- WEAK EVIDENCE (a chance median is within ${WEAK_FACTOR}x)` : ''}`;

function selfCheckLines({ medians, blind, limitMs }) {
  const each = Object.entries(medians).map(([name, f]) => `  self-check ${name}: n=${f.n} median ${f.medianMs} ms`);
  return [`self-check (each must read over ${limitMs} ms): ${blind.length === 0 ? 'sees all four' : `BLIND to ${blind.join(', ')}`}`, ...each];
}

function dropLines({ trimMargins: tm, heldDrops: d, counts }) {
  const mid = counts.midPhrase;
  return [
    `counts mid-phrase: ${mid.paired} of ${mid.candidates} candidates paired; high-band onsets detected ${mid.onsets.detected}, `
      + `removed eof ${mid.onsets.removedEof}, kept ${mid.onsets.kept}, unpaired ${mid.unpairedOnsets}`,
    `held burst-filtered onsets: ${d.burst.map((b) => `${b.shot} ${b.onsetMs} ms (near ${b.nearestWord})`).join('; ') || 'none'}`,
    `held unpaired words: ${d.unpairedWords.map((w) => `${w.shot} ${w.word}`).join('; ') || 'none'}`,
    `held unpaired onsets: ${d.unpairedOnsets.map((o) => `${o.shot} ${o.onsetMs} ms`).join('; ') || 'none'}`,
    `trim margins (first onset after the cut): smallest ${tm.smallest?.marginMs} ms (${tm.smallest?.shot} ${tm.smallest?.word}); `
      + tm.shots.map((m) => `${m.word} ${m.marginMs}`).join(', '),
  ];
}

/** The report as lines of text. */
export function formatReport(report) {
  const contexts = (which) => SILENCE_CONTEXTS.map((c) => `  ${which} ${c}: ${fmt(report.byContext[which][c])}`);
  const { midPhrase: mid, shotFirst: first } = report;
  return [
    `held-out headline (odd fixtures, shot-first words apart): ${fmt(report.held)}  limit ${HELD_MEDIAN_LIMIT_MS} ms: ${report.verdict}`,
    `  counts held: ${fmtCounts(report.counts.held)}`,
    `fixtures, all 16 (half fitted on): ${fmt(report)}`,
    `  counts fixtures: ${fmtCounts(report.counts.fixtures)}`,
    `shot-first words (predicted 75 ms after a cut placed from that same prediction, so not in the headline): fixtures ${fmt(first.fixtures)}; held ${fmt(first.held)}; extra ${fmt(first.extra)}`,
    `extra lines: ${fmt(report.extra)}`,
    `  counts extra: ${fmtCounts(report.counts.extra)}`,
    ...selfCheckLines(report.selfCheck),
    `mid-phrase (s/sh only, saturates; not an accuracy figure): ${fmt(mid)} of ${mid.candidates} candidates; ${fmtChance(mid)}`,
    `  emphasised: ${fmt(mid.emphasised)}; ${fmtChance(mid.emphasised)}`,
    ...contexts('all'),
    ...contexts('held'),
    ...dropLines(report),
    ...report.reviewLines.map((r) => `review ${r.shot}: measured ${r.measured.join(' ') || 'none'}; not measured ${r.unmeasured.join(' ')}`),
    `verdict: ${report.verdict}: ${report.verdictMessage}`,
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

// A path as the report records it: relative to the working folder, so the JSON does not name the home folder.
const shown = (p) => path.relative(process.cwd(), p) || '.';

async function measure(opts, log) {
  checkModelPresent(opts.modelDir);
  const ffmpeg = await findFfmpeg();
  const film = accuracyFilm(opts.voice, opts.mode);
  const made = await synthesiseFilm(film, { outDir: opts.out, voice: opts.voice, runtime: opts.runtime, modelDir: opts.modelDir, offline: true, log });
  const { phonemize } = await loadRuntime(opts.runtime);
  const vocab = loadVocab(JSON.parse(readFileSync(path.join(opts.modelDir, 'tokenizer.json'), 'utf8')));
  const { voiceSpeed, emphasisPause } = registries.modes.get(opts.mode);
  const describe = (say) => describeShot(say, { phonemize, vocab, pace: { speed: voiceSpeed, emphasisPause } });
  const shots = [];
  for (const [i, line] of LINES.entries()) shots.push(await measureShot(line, made.sidecar.shots[i], { dir: made.dir, ffmpeg, describe }));
  const setup = {
    voice: opts.voice, mode: opts.mode, voiceSpeed, emphasisPause, model: `${VOICE_MODEL.id}@${VOICE_MODEL.commit}`,
    runtime: shown(opts.runtime), modelDir: shown(opts.modelDir), cacheDir: shown(made.dir), cached: made.cached, ffmpeg,
    silence: SILENCE, highBand: HIGH_BAND, leadInSeconds: LEAD_IN_SECONDS, minHeldPairs: MIN_HELD_PAIRS,
    selfCheckShiftMs: toMs(SELF_CHECK_SHIFT_SECONDS), chanceShifts: CHANCE_SHIFTS, weakFactor: WEAK_FACTOR,
    lines: { fixtures: FIXTURES.length, midphrase: MIDPHRASE.length, review: REVIEW.length },
  };
  return summarise(shots, setup);
}

async function main(argv) {
  const opts = parseArgs(argv);
  const log = (line) => process.stderr.write(`${line}\n`);
  const report = await measure(opts, log);
  process.stdout.write(`${opts.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
  if (report.exitCode !== EXIT.ok) process.stderr.write(`accuracy: ${report.verdictMessage}\n`);
  return report.exitCode;
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
