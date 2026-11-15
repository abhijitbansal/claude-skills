// Task 4: a shot's parsed narration as synthesis calls and silences. planCalls works on narration tokens only; the
// 512-id limit is checked through an injected estimator (the real one phonemises, which needs the optional package).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSay } from '../../engine/script/say.mjs';
import { VOICE_SPEED_MAX } from '../../engine/modes/index.mjs';
import { planCalls, ASIDE_SPEED_FACTOR, MAX_IDS } from '../../scripts/v2/voice/calls.mjs';
import { EMBEDDED_VOCAB, loadVocab, VoiceTextError } from '../../scripts/v2/voice/tokens.mjs';

const SPEED = 1.0;
const tokensOf = (say) => parseSay(say).tokens;
// One id per token plus the two pads: enough for every test that is not about the limit.
const countIds = (indexes) => indexes.length + 2;
const plan = (say, extra = {}) => planCalls(tokensOf(say), { speed: SPEED, emphasisPause: 0, countIds, ...extra });
const kinds = (calls) => calls.map((c) => c.kind);

test('two sentences are two speech calls, each at the mode speed', () => {
  const calls = plan('One. Two.');
  assert.deepEqual(kinds(calls), ['speech', 'speech']);
  assert.deepEqual(calls.map((c) => c.tokens), [[0], [1]]);
  assert.deepEqual(calls.map((c) => [c.speed, c.level]), [[SPEED, 'normal'], [SPEED, 'normal']]);
});

test('a pause mark becomes a silence between two speech calls', () => {
  const calls = plan('Wait (0.4) now.');
  assert.deepEqual(kinds(calls), ['speech', 'silence', 'speech']);
  assert.equal(calls[1].seconds, 0.4);
  assert.deepEqual([calls[0].tokens, calls[2].tokens], [[0], [1]]);
});

test('a pause before the first word is a leading silence; an ellipsis is a pause of its own length', () => {
  assert.deepEqual(kinds(plan('(0.5) Go.')), ['silence', 'speech']);
  const dots = plan('Well... maybe.');
  assert.deepEqual(kinds(dots), ['speech', 'silence', 'speech']);
  assert.equal(dots[1].seconds, 0.35);
});

test('an aside is its own call at speed * ASIDE_SPEED_FACTOR with level aside', () => {
  const calls = plan('Fast, _quietly_, done.');
  assert.deepEqual(kinds(calls), ['speech', 'speech', 'speech']);
  assert.deepEqual(calls.map((c) => c.level), ['normal', 'aside', 'normal']);
  assert.equal(calls[1].speed, SPEED * ASIDE_SPEED_FACTOR);
  assert.equal(calls[0].speed, SPEED);
  assert.equal(ASIDE_SPEED_FACTOR, 1 / 0.85);
});

test('the aside speed is clamped to 1.25', () => {
  const calls = plan('Fast, _quietly_, done.', { speed: 1.2 });
  assert.equal(calls[1].speed, VOICE_SPEED_MAX);
  assert.equal(calls[0].speed, 1.2);
});

test('with emphasisPause 0 an emphasised word never ends a call', () => {
  const calls = plan('It *really* works.');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tokens, [0, 1, 2], 'the token indexes stay, so the synthesiser knows which word is emphasised');
});

test('with emphasisPause above 0 the call ends before the emphasised word and a silence of that length follows', () => {
  const calls = plan('It *really* works.', { emphasisPause: 0.15 });
  assert.deepEqual(kinds(calls), ['speech', 'silence', 'speech']);
  assert.deepEqual([calls[0].tokens, calls[2].tokens], [[0], [1, 2]]);
  assert.equal(calls[1].seconds, 0.15);
});

test('emphasisPause: a run of emphasised words splits once; an emphasised first word or one after a pause adds no silence', () => {
  const run = plan('It *really very* works.', { emphasisPause: 0.2 });
  assert.deepEqual(run.map((c) => c.tokens ?? c.seconds), [[0], 0.2, [1, 2, 3]]);
  const first = plan('*Really* works.', { emphasisPause: 0.2 });
  assert.deepEqual(kinds(first), ['speech'], 'nothing before it to separate from');
  const afterPause = plan('Wait (0.4) *now*.', { emphasisPause: 0.2 });
  assert.deepEqual(kinds(afterPause), ['speech', 'silence', 'speech'], 'the pause mark is the only silence');
  assert.equal(afterPause[1].seconds, 0.4);
});

test('calls and silences are plain data: tokens cover every word exactly once, in order', () => {
  const say = 'One *two* (0.3) three, _four five_. Six...';
  const calls = plan(say, { emphasisPause: 0.1 });
  const covered = calls.filter((c) => c.kind === 'speech').flatMap((c) => c.tokens);
  assert.deepEqual(covered, tokensOf(say).map((_, i) => i));
});

test('a shot with no tokens plans no calls', () => {
  assert.deepEqual(planCalls([], { speed: SPEED, emphasisPause: 0, countIds }), []);
});

// ---- the 512-id limit ----

const clause = (n, { commaAt = [] } = {}) => Array.from({ length: n }, (_, k) => (commaAt.includes(k) ? 'w,' : 'w')).join(' ');
// a countIds that charges one id per narration token plus the two pads, as the real one does per phoneme character
// (so a 700-token clause is over MAX_IDS).

test('a 700-token clause with a comma splits at the comma, the first call as long as fits', () => {
  const say = clause(700, { commaAt: [399] });
  const calls = plan(say);
  assert.deepEqual(calls.map((c) => c.tokens.length), [400, 300]);
  assert.ok(calls.every((c) => countIds(c.tokens) <= MAX_IDS));
  assert.deepEqual(calls.flatMap((c) => c.tokens), tokensOf(say).map((_, i) => i));
});

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

test('a semicolon, a colon, an en or em dash (glued or spaced) and a spaced hyphen each count as a clause boundary', () => {
  for (const mark of [';', ':', EM_DASH, EN_DASH, ',"']) {
    const glued = Array.from({ length: 700 }, (_, k) => (k === 399 ? `w${mark}` : 'w')).join(' ');
    assert.deepEqual(plan(glued).map((c) => c.tokens.length), [400, 300], `glued ${mark}`);
  }
  for (const mark of [EM_DASH, EN_DASH, '-']) {
    const spaced = Array.from({ length: 700 }, (_, k) => (k === 399 ? mark : 'w')).join(' ');
    assert.deepEqual(plan(spaced).map((c) => c.tokens.length), [400, 300], `spaced ${mark}`);
  }
  const hyphenated = Array.from({ length: 700 }, (_, k) => (k === 399 ? 'well-known' : 'w')).join(' ');
  assert.throws(() => plan(hyphenated, { shotId: 'h' }), VoiceTextError, 'a hyphen inside a word is no boundary');
});

test('a split takes the last clause boundary that still fits, so a later piece is not split needlessly', () => {
  const say = Array.from({ length: 800 }, (_, k) => (k === 99 || k === 449 ? 'w,' : 'w')).join(' ');
  assert.deepEqual(plan(say).map((c) => c.tokens.length), [450, 350]);
});

test('a clause over 512 ids with no clause boundary throws VoiceTextError naming the shot', () => {
  assert.throws(
    () => plan(clause(700), { shotId: 'intro' }),
    (err) => err instanceof VoiceTextError && /shot "intro"/.test(err.message) && /512/.test(err.message),
  );
});

test('a comma that does not help (its prefix is still over 512) still throws', () => {
  assert.throws(() => plan(clause(700, { commaAt: [599] }), { shotId: 'intro' }), VoiceTextError);
});

test('the limit is asked of the injected estimator, not of the token count', () => {
  const seen = [];
  const calls = plan('Short. Words.', { countIds: (i) => { seen.push(i.length); return 3; } });
  assert.equal(calls.length, 2);
  assert.ok(seen.length >= 2);
  assert.throws(
    () => plan('one two three.', { countIds: () => MAX_IDS + 1, shotId: 'x' }),
    VoiceTextError,
    'a big id count on a short clause is over the limit however few tokens it has',
  );
});

test('bad arguments are errors that say what to pass', () => {
  assert.throws(() => planCalls(tokensOf('Hi.'), { speed: SPEED, emphasisPause: 0 }), /countIds/);
  assert.throws(() => planCalls(tokensOf('Hi.'), { speed: 0, emphasisPause: 0, countIds }), /speed/);
  assert.throws(() => planCalls(tokensOf('Hi.'), { speed: SPEED, emphasisPause: -1, countIds }), /emphasisPause/);
});

test('the embedded vocab equals the pinned tokenizer.json vocab, id for id', () => {
  const file = JSON.parse(readFileSync(new URL('./fixtures/voice/tokenizer.json', import.meta.url), 'utf8'));
  assert.deepEqual([...EMBEDDED_VOCAB], [...loadVocab(file)]);
});
