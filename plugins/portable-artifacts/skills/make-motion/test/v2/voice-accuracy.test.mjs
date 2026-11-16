// The pairing, statistics, self-check and verdict of scripts/v2/voice/accuracy.mjs, on synthetic numbers. The real
// measurement needs the optional voice package, the model and ffmpeg; it is run by hand
// (node scripts/v2/voice/accuracy.mjs --json), not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELD_MEDIAN_LIMIT_MS,
  MIN_HELD_PAIRS,
  MUTATIONS,
  classifyOnsets,
  errorStats,
  formatReport,
  joinWords,
  median,
  pairMutual,
  parseArgs,
  percentile90,
  summarise,
  verdictOf,
} from '../../scripts/v2/voice/accuracy.mjs';

// ---- synthetic shots ----

// One sidecar token: its index t, its predicted start (s), its context and flags.
const tok = (t, start, context, extra = {}) => ({ t, text: `w${t}`, start, context, emphasis: false, isCandidate: false, ...extra });

// A measured shot as summarise reads it. Every token is a real word here, so tokenStarts are the words' starts.
function shot({ group = 'fixture', index = 1, id = `${group}-${index}`, words, kept = [], burst = [], eof = [], high = [] }) {
  const detected = [...kept, ...burst, ...eof].sort((a, b) => a - b);
  return {
    line: { group, id, index },
    seconds: 10,
    tokens: words.length,
    tokenStarts: words.map((w) => w.start),
    words,
    silence: { detected, eof, burst, kept },
    high: { detected: high, eof: [], kept: high },
  };
}

// A held line laid out like a real one: the shot's first word at 75 ms, mid-phrase words that follow it without a
// pause, and two words after punctuation. Onsets sit 10 ms after the silence-adjacent words only.
function heldLine(index, offset = 0.01) {
  const words = [
    tok(0, 0.075, 'callStart'), tok(1, 0.3, 'midPhrase'), tok(2, 0.55, 'midPhrase'), tok(3, 1.0, 'afterPunctuation'),
    tok(4, 1.25, 'midPhrase'), tok(5, 1.8, 'afterPunctuation'), tok(6, 2.0, 'midPhrase'),
  ];
  return shot({ index, words, kept: [0.075 + offset, 1.0 + offset, 1.8 + offset] });
}

const HELD_INDICES = [1, 3, 5, 7, 9, 11, 13, 15];
const heldLines = (offset) => HELD_INDICES.map((i) => heldLine(i, offset));

// ---- statistics ----

test('pairMutual pairs each onset with the prediction that is nearest to it and to which it is nearest', () => {
  const pairs = pairMutual([0.1, 1.02, 2.05], [0.12, 1.0, 2.0]);
  assert.deepEqual(pairs, [{ mi: 0, pi: 0 }, { mi: 1, pi: 1 }, { mi: 2, pi: 2 }]);
});

test('pairMutual never counts one prediction twice: of two onsets near one word, only the nearer is paired', () => {
  // Onsets 1.0 and 1.3 both have 1.05 as their nearest prediction; 1.05's nearest onset is 1.0, so 1.3 is not paired.
  const pairs = pairMutual([1.0, 1.3], [1.05, 3.0]);
  assert.deepEqual(pairs, [{ mi: 0, pi: 0 }]);
  assert.equal(new Set(pairs.map((p) => p.pi)).size, pairs.length, 'each prediction appears at most once');
});

test('pairMutual drops an onset that has no prediction of its own (a burst far from every word)', () => {
  const pairs = pairMutual([0.5, 1.0, 4.8], [0.52, 1.01]);
  assert.deepEqual(pairs, [{ mi: 0, pi: 0 }, { mi: 1, pi: 1 }]);
});

test('pairMutual leaves a word with no onset unpaired, and pairs nothing when either side is empty', () => {
  assert.deepEqual(pairMutual([1.0], [0.2, 1.01, 2.5]), [{ mi: 0, pi: 1 }]);
  assert.deepEqual(pairMutual([], [1.0]), []);
  assert.deepEqual(pairMutual([1.0], []), []);
});

test('median is the middle value, or the mean of the two middle values, of an unsorted list', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([7]), 7);
});

test('percentile90 is the value at rank ceil(0.9 n) of the sorted list (nearest rank)', () => {
  assert.equal(percentile90([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]), 9);
  assert.equal(percentile90(Array.from({ length: 20 }, (_, i) => i + 1)), 18);
  assert.equal(percentile90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 10);
  assert.equal(percentile90([42]), 42);
});

test('median and percentile90 of an empty list are null, not a number', () => {
  assert.equal(median([]), null);
  assert.equal(percentile90([]), null);
});

test('median and percentile90 do not reorder the list they are given', () => {
  const values = [3, 1, 2];
  median(values);
  percentile90(values);
  assert.deepEqual(values, [3, 1, 2]);
});

test('errorStats reports the median, 90th percentile and maximum of absolute errors and the median signed error, in whole ms', () => {
  // Signed errors in seconds (prediction minus measurement).
  const stats = errorStats([0.01, -0.02, 0.03, -0.04, 0.05]);
  assert.deepEqual(stats, { n: 5, medianMs: 30, p90Ms: 50, maxMs: 50, biasMs: 10 });
});

test('errorStats of no errors is n 0 with null figures', () => {
  assert.deepEqual(errorStats([]), { n: 0, medianMs: null, p90Ms: null, maxMs: null, biasMs: null });
});

// ---- onsets ----

test('classifyOnsets keeps an onset with 100 ms of sound, and names the end-of-file and burst onsets it removes', () => {
  // 0.5: sound to 0.9 (kept); 1.2: sound to 1.25 (a 50 ms burst); 2.995: the end of the 3 s file.
  const got = classifyOnsets({ onsets: [0.5, 1.2, 2.995], offsets: [0.9, 1.25] }, 3, 0.1);
  assert.deepEqual(got, { detected: [0.5, 1.2, 2.995], eof: [2.995], burst: [1.2], kept: [0.5] });
});

// ---- pairing: which words a silence onset may belong to ----

test('silence onsets pair only with words that start a call or follow punctuation, never a mid-phrase word', () => {
  // The mid-phrase word at 1.0 sits right on the onset; the after-punctuation word at 1.3 is the only eligible one.
  const words = [tok(0, 0.075, 'callStart'), tok(1, 1.0, 'midPhrase'), tok(2, 1.3, 'afterPunctuation')];
  const report = summarise([shot({ words, kept: [0.08, 1.01] })], {});
  const words2 = report.rows.silence.map((r) => r.word);
  assert.deepEqual(words2, ['w0', 'w2']);
  assert.ok(report.rows.silence.every((r) => r.context !== 'midPhrase'));
});

test('the held-out headline leaves out each shot\'s first word, which is reported apart, after pairing with it', () => {
  // The first word's onset (0.09) pairs with the first word, not with the next eligible word.
  const words = [tok(0, 0.075, 'callStart'), tok(1, 0.6, 'afterPunctuation')];
  const report = summarise([shot({ words, kept: [0.09, 0.62] })], {});
  assert.equal(report.held.n, 1);
  assert.equal(report.held.medianMs, 20);
  assert.equal(report.shotFirst.held.n, 1);
  assert.equal(report.shotFirst.held.medianMs, 15);
  assert.equal(report.n, 1, 'the all-fixtures figure leaves out shot-first words too');
});

test('extra lines are split the same way: their shot-first words are not in the extra figure', () => {
  const words = [tok(0, 0.075, 'callStart'), tok(1, 0.6, 'afterPunctuation')];
  const report = summarise([shot({ group: 'review', index: 0, words, kept: [0.09, 0.62] })], {});
  assert.equal(report.extra.n, 1);
  assert.equal(report.shotFirst.extra.n, 1);
});

// ---- the self-check ----

test('the mutations act on the token starts: +100 ms, -100 ms except the shot\'s first word, and one-word label shifts', () => {
  const starts = [0.075, 0.3, 0.55];
  const round = (xs) => xs.map((x) => Math.round(x * 1000));
  assert.deepEqual(round(MUTATIONS.plus100(starts, 0)), [175, 400, 650]);
  assert.deepEqual(round(MUTATIONS.minus100ExceptFirst(starts, 0)), [75, 200, 450]);
  assert.deepEqual(round(MUTATIONS.labelPrevious(starts, 0)), [75, 75, 300]);
  assert.deepEqual(round(MUTATIONS.labelNext(starts, 0)), [300, 550, 550]);
});

test('the self-check sees all four errors on a realistic layout, including the one-word shift that every-word pairing missed', () => {
  const report = summarise(heldLines(0.01), {});
  assert.equal(report.held.medianMs, 10);
  for (const [name, figure] of Object.entries(report.selfCheck.medians)) {
    assert.ok(figure.medianMs > HELD_MEDIAN_LIMIT_MS, `${name}: median ${figure.medianMs} ms must be over the limit`);
  }
  assert.deepEqual(report.selfCheck.blind, []);
  assert.equal(report.verdict, 'ok');
});

test('the self-check names a mutation the instrument cannot see, and the verdict is blind (exit 2)', () => {
  // Eligible words and onsets on a 100 ms grid: a 100 ms shift lands each prediction on the next onset at 0 ms error.
  const words = Array.from({ length: 20 }, (_, k) => tok(k, 0.1 * (k + 1), 'afterPunctuation'));
  const shots = HELD_INDICES.map((index) => shot({ index, words, kept: words.map((w) => w.start) }));
  const report = summarise(shots, {});
  assert.ok(report.selfCheck.blind.includes('plus100'), `blind: ${report.selfCheck.blind}`);
  assert.equal(report.verdict, 'blind');
  assert.equal(verdictOf(report.held, report.selfCheck).exitCode, 2);
});

// ---- the verdict ----

test('verdictOf: too few held-out pairs is exit 2 before anything else; blind is 2; over the limit is 1; else 0', () => {
  const seeing = { blind: [] };
  const few = verdictOf({ n: MIN_HELD_PAIRS - 1, medianMs: 5 }, { blind: ['plus100'] });
  assert.deepEqual([few.verdict, few.exitCode], ['too-few', 2]);
  assert.match(few.message, /not enough measured words/);
  const blind = verdictOf({ n: MIN_HELD_PAIRS, medianMs: 5 }, { blind: ['labelNext'] });
  assert.deepEqual([blind.verdict, blind.exitCode], ['blind', 2]);
  assert.match(blind.message, /cannot see.*labelNext/);
  const over = verdictOf({ n: MIN_HELD_PAIRS, medianMs: HELD_MEDIAN_LIMIT_MS + 1 }, seeing);
  assert.deepEqual([over.verdict, over.exitCode], ['over', 1]);
  const ok = verdictOf({ n: MIN_HELD_PAIRS, medianMs: HELD_MEDIAN_LIMIT_MS }, seeing);
  assert.deepEqual([ok.verdict, ok.exitCode], ['ok', 0]);
});

test('summarise gives the too-few verdict when the headline has fewer than the minimum held-out pairs', () => {
  const report = summarise(heldLines(0.01).slice(0, 5), {});
  assert.equal(report.held.n, 10);
  assert.equal(report.verdict, 'too-few');
  assert.equal(report.ok, false);
});

// ---- the mid-phrase chance floor ----

test('mid-phrase figures carry a chance floor at -150 and +200 ms and are weak when a shifted median is within 3x', () => {
  const cand = (t, start) => tok(t, start, 'midPhrase', { isCandidate: true, emphasis: true });
  const lone = shot({ index: 2, words: [tok(0, 0.075, 'callStart'), cand(1, 1.0)], high: [0.99] });
  const strong = summarise([lone], {}).midPhrase;
  assert.equal(strong.medianMs, 10);
  assert.deepEqual([strong.chance.minus150.medianMs, strong.chance.plus200.medianMs], [140, 210]);
  assert.equal(strong.weak, false);
  assert.equal(strong.emphasised.weak, false);
  // Fricatives 150 ms either side: the -150 ms prediction lands on one, so chance reads as well as the real thing.
  const crowded = shot({ index: 2, words: [tok(0, 0.075, 'callStart'), cand(1, 1.0)], high: [0.85, 0.99, 1.2] });
  const weak = summarise([crowded], {}).midPhrase;
  assert.equal(weak.chance.minus150.medianMs, 0);
  assert.equal(weak.weak, true);
  assert.equal(weak.emphasised.weak, true);
});

test('the mid-phrase and chance figures never change the verdict', () => {
  const cand = tok(7, 1.5, 'midPhrase', { isCandidate: true });
  const shots = heldLines(0.01).map((s) => ({ ...s, words: [...s.words, cand], tokenStarts: [...s.tokenStarts, 1.5], high: { detected: [1.9], eof: [], kept: [1.9] } }));
  const report = summarise(shots, {});
  assert.equal(report.midPhrase.medianMs, 400);
  assert.equal(report.verdict, 'ok');
});

// ---- counts and drops ----

test('each figure prints its onsets detected, removed by each filter, paired and unpaired, and its words', () => {
  const words = [tok(0, 0.075, 'callStart'), tok(1, 0.4, 'midPhrase'), tok(2, 1.0, 'afterPunctuation')];
  const s = shot({ words, kept: [0.08, 1.01, 2.5], burst: [0.6], eof: [9.995] });
  const { counts } = summarise([s], {});
  assert.deepEqual(counts.held, {
    lines: 1, tokens: 3, words: 3, eligibleWords: 2, measured: 1, measuredShotFirst: 1,
    onsets: { detected: 5, removedEof: 1, removedBurst: 1, kept: 3, paired: 2, unpaired: 1 },
  });
});

test('the held-out words the burst filter removed are listed by the nearest word, with unpaired words and onsets', () => {
  const words = [tok(0, 0.075, 'callStart'), tok(1, 0.4, 'midPhrase'), tok(2, 1.0, 'afterPunctuation'), tok(3, 1.6, 'afterPunctuation')];
  const s = shot({ words, kept: [0.08, 1.01, 2.5], burst: [0.6] });
  const { heldDrops } = summarise([s], {});
  assert.deepEqual(heldDrops.burst, [{ shot: 'fixture-1', onsetMs: 600, nearestWord: 'w1' }]);
  assert.deepEqual(heldDrops.unpairedWords, [{ shot: 'fixture-1', word: 'w3', predictedMs: 1600 }]);
  assert.deepEqual(heldDrops.unpairedOnsets, [{ shot: 'fixture-1', onsetMs: 2500 }]);
});

test('each shot\'s trim margin is its first detected onset, before the burst filter, and the smallest is printed', () => {
  const a = shot({ index: 1, words: [tok(0, 0.075, 'callStart')], kept: [0.27], burst: [0.05] });
  const b = shot({ index: 3, words: [tok(0, 0.075, 'callStart')], kept: [0.09] });
  const { trimMargins } = summarise([a, b], {});
  assert.deepEqual(trimMargins.shots.map((m) => m.marginMs), [50, 90]);
  assert.deepEqual(trimMargins.smallest, { shot: 'fixture-1', word: 'w0', marginMs: 50 });
});

// ---- joining and options ----

test('joinWords joins the sidecar words to the planned words by index and refuses a text mismatch', () => {
  const entry = { sentences: [{ words: [{ text: 'Hi', start: 0.075 }, { text: 'there.', start: 0.3 }] }] };
  const described = new Map([[0, { token: 'Hi', context: 'callStart' }], [1, { token: 'there.', context: 'midPhrase' }]]);
  assert.deepEqual(joinWords(entry, described).map((w) => [w.t, w.text, w.context]), [[0, 'Hi', 'callStart'], [1, 'there.', 'midPhrase']]);
  const wrong = new Map([[0, { token: 'Hi', context: 'callStart' }], [1, { token: 'here.', context: 'midPhrase' }]]);
  assert.throws(() => joinWords(entry, wrong), /"there\." .*"here\."/);
});

test('--speed picks the registered mode with that voice speed: 1 is pro (the default), 1.1 is viral, others refused', () => {
  assert.deepEqual([parseArgs([], {}).mode, parseArgs([], {}).speed], ['pro', 1]);
  assert.deepEqual([parseArgs(['--speed', '1.1'], {}).mode, parseArgs(['--speed', '1.1'], {}).speed], ['viral', 1.1]);
  assert.throws(() => parseArgs(['--speed', '0.9'], {}), /accepted.*1.*1\.1/);
});

test('the text report labels p90 as the maximum below 10 pairs and prints the self-check medians and weak labels', () => {
  const text = formatReport(summarise(heldLines(0.01), {}));
  assert.match(text, /self-check/);
  assert.match(text, /plus100/);
  assert.match(text, /labelPrevious/);
  assert.match(text, /shot-first/);
  assert.match(text, /max \d+ ms/);
  // These lines hold no mid-phrase candidate, so the real median is null and the figure is labelled weak.
  assert.match(text, /WEAK EVIDENCE/);
});
