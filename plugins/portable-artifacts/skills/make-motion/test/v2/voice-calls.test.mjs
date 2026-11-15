// Task 4: a shot's parsed narration as synthesis calls and silences. planCalls works on narration tokens only; the
// 512-id limit is checked through an injected estimator (the real one phonemises, which needs the optional package).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSay } from '../../engine/script/say.mjs';
import { VOICE_SPEED_MAX, VOICE_SPEED_MIN } from '../../engine/modes/index.mjs';
import { planCalls, ASIDE_SPEED_FACTOR, MAX_IDS, ABBREVIATIONS } from '../../scripts/v2/voice/calls.mjs';
import { normalize } from '../../scripts/v2/voice/phonemes.mjs';
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

test('emphasisPause: a run of emphasised words splits once; the very first word and a word after a pause mark add no silence', () => {
  const run = plan('It *really very* works.', { emphasisPause: 0.2 });
  assert.deepEqual(run.map((c) => c.tokens ?? c.seconds), [[0], 0.2, [1, 2, 3]]);
  const first = plan('*Really* works.', { emphasisPause: 0.2 });
  assert.deepEqual(kinds(first), ['speech'], 'nothing before it to separate from');
  const afterPause = plan('Wait (0.4) *now*.', { emphasisPause: 0.2 });
  assert.deepEqual(kinds(afterPause), ['speech', 'silence', 'speech'], 'the pause mark is the only silence');
  assert.equal(afterPause[1].seconds, 0.4);
});

test('emphasisPause: the silence is also put before an emphasised word after a sentence end or an aside edge', () => {
  const sentence = plan('One. *Two* three.', { emphasisPause: 0.2 });
  assert.deepEqual(sentence.map((c) => c.tokens ?? c.seconds), [[0], 0.2, [1, 2]]);
  const aside = plan('_a_ *b* c.', { emphasisPause: 0.2 });
  assert.deepEqual(aside.map((c) => c.tokens ?? c.seconds), [[0], 0.2, [1, 2]]);
  assert.deepEqual(aside.filter((c) => c.kind === 'speech').map((c) => c.level), ['aside', 'normal']);
  const none = plan('One. *Two* three.', { emphasisPause: 0 });
  assert.deepEqual(kinds(none), ['speech', 'speech'], 'emphasisPause 0 adds nothing');
});

test('calls and silences are plain data: speech and skip items cover every word exactly once, in order', () => {
  const say = 'One *two* (0.3) three, _four five_. Six - seven... Dr. Eight.';
  const tokens = tokensOf(say);
  const calls = plan(say, { emphasisPause: 0.1 });
  const covered = calls.filter((c) => c.kind !== 'silence').flatMap((c) => c.tokens);
  assert.deepEqual(covered, tokens.map((_, i) => i));
});

test('the result and every array in it are frozen', () => {
  const calls = plan('One. Wait (0.4) -');
  assert.ok(Object.isFrozen(calls));
  assert.ok(calls.every((c) => Object.isFrozen(c) && (c.tokens === undefined || Object.isFrozen(c.tokens))));
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

test('a clause over 512 ids with no clause boundary throws VoiceTextError naming the shot and saying there is none', () => {
  assert.throws(
    () => plan(clause(700), { shotId: 'intro' }),
    (err) => err instanceof VoiceTextError && /shot "intro"/.test(err.message) && /512/.test(err.message) && /has no comma/.test(err.message),
  );
});

test('a comma whose prefix is still over 512 throws and says a boundary exists but does not help', () => {
  assert.throws(
    () => plan(clause(700, { commaAt: [599] }), { shotId: 'intro' }),
    (err) => err instanceof VoiceTextError && /even the part up to the first one is over the limit/.test(err.message) && !/has no comma/.test(err.message),
  );
});

test('a single token over the limit says it is one word that cannot be split', () => {
  assert.throws(
    () => plan('Antidisestablishmentarianism', { countIds: () => MAX_IDS + 1, shotId: 'long' }),
    (err) => err instanceof VoiceTextError && /single word "Antidisestablishmentarianism"/.test(err.message) && /shot "long"/.test(err.message),
  );
});

test('the scan stops at the first clause end that no longer fits: later prefixes are not counted', () => {
  const asked = [];
  const commas = Array.from({ length: 14 }, (_, k) => 99 + 50 * k); // a comma every 50 tokens from token 100
  const say = clause(700, { commaAt: commas });
  planCalls(tokensOf(say), { speed: SPEED, emphasisPause: 0, countIds: (i) => { asked.push(i.length); return i.length + 2; } });
  assert.ok(asked.every((n) => n <= 550 || n === 700), `asked about prefixes of ${asked.join(', ')} tokens`);
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
  assert.throws(() => planCalls(tokensOf('Hi.'), { speed: SPEED, emphasisPause: -1, countIds }), /emphasisPause/);
});

test('a speed outside 0.8 to 1.25 is a RangeError, at both ends', () => {
  for (const speed of [0, VOICE_SPEED_MIN - 0.01, VOICE_SPEED_MAX + 0.01, 2, NaN, Infinity, undefined]) {
    assert.throws(() => planCalls(tokensOf('Hi.'), { speed, emphasisPause: 0, countIds }), RangeError, String(speed));
  }
  for (const speed of [VOICE_SPEED_MIN, VOICE_SPEED_MAX]) {
    assert.doesNotThrow(() => planCalls(tokensOf('Hi.'), { speed, emphasisPause: 0, countIds }), String(speed));
  }
});

test('countIds must return a finite number synchronously, else a TypeError that says so', () => {
  const bad = [undefined, null, NaN, Infinity, -1, '5', Promise.resolve(5)];
  for (const value of bad) {
    assert.throws(() => plan('Hi there.', { countIds: () => value }), (err) => err instanceof TypeError && /synchronously/.test(err.message), String(value));
  }
  assert.throws(() => plan('Hi.', { countIds: async () => 5 }), /a Promise/);
});

// ---- sentence ends that are not sentence ends ----

const callTexts = (say, extra = {}) => plan(say, extra).filter((c) => c.kind === 'speech').map((c) => c.tokens.map((i) => tokensOf(say)[i].text).join(' '));

test('titles and a dotted acronym inside a sentence do not end a call', () => {
  assert.deepEqual(callTexts('Dr. Smith met Mr. Jones in the U.S. today.'), ['Dr. Smith met Mr. Jones in the U.S. today.']);
  assert.deepEqual(callTexts('Mrs. Ng and Ms. Li said so.'), ['Mrs. Ng and Ms. Li said so.']);
});

test('a dotted acronym followed by a capitalised word does end the call', () => {
  assert.deepEqual(callTexts('It works in the U.S. Then it stops.'), ['It works in the U.S.', 'Then it stops.']);
  assert.deepEqual(callTexts('Use e.g. apples.'), ['Use e.g. apples.']);
});

test('a single initial does not end a call; etc. ends it only before a capitalised word', () => {
  assert.deepEqual(callTexts('Ask J. Smith now.'), ['Ask J. Smith now.']);
  assert.deepEqual(callTexts('Apples, pears etc. are fruit.'), ['Apples, pears etc. are fruit.']);
  assert.deepEqual(callTexts('Apples, pears etc. Then plums.'), ['Apples, pears etc.', 'Then plums.']);
});

test('a real sentence end still ends a call, also inside closing quotes, after ? and !, and for a word that only looks like an abbreviation', () => {
  assert.deepEqual(callTexts('He said "stop." Then left.'), ['He said "stop."', 'Then left.']);
  assert.deepEqual(callTexts('Why? Because! Done.'), ['Why?', 'Because!', 'Done.']);
  assert.deepEqual(callTexts('Meet Mister. Smith.'), ['Meet Mister.', 'Smith.'], 'only the listed abbreviations are exempt');
  assert.deepEqual(callTexts('Dr. Who? Yes.'), ['Dr. Who?', 'Yes.']);
});

test('every abbreviation the voice text normalisation handles is in the list', () => {
  const candidates = ['Dr', 'Mr', 'Ms', 'Mrs', 'etc', 'Prof', 'Jr', 'Sr', 'St', 'Inc', 'vs', 'Mt', 'Gen', 'Capt', 'Lt', 'Col', 'Rev', 'Sgt', 'Esq', 'No'];
  const handled = candidates.filter((c) => [`${c}. Smith`, `${c}.`].some((text) => !normalize(text).includes(`${c}.`)));
  assert.deepEqual(handled, ['Dr', 'Mr', 'Ms', 'Mrs', 'etc'], 'the probe finds the abbreviations normalize handles: update the list if this changes');
  for (const abbreviation of handled) assert.ok(ABBREVIATIONS.includes(abbreviation.toLowerCase()), abbreviation);
  for (const abbreviation of ABBREVIATIONS) assert.ok(handled.map((h) => h.toLowerCase()).includes(abbreviation), `${abbreviation} is handled by normalize`);
});

// ---- tokens with nothing speakable ----

test('a run of tokens with nothing speakable is a skip, not a speech call', () => {
  const calls = plan('Wait (0.4) - (0.4) now.');
  assert.deepEqual(calls.map((c) => c.kind), ['speech', 'silence', 'skip', 'silence', 'speech']);
  assert.deepEqual(calls[2].tokens, [1]);
  assert.deepEqual(plan('(0.4) .').map((c) => [c.kind, c.tokens ?? c.seconds]), [['silence', 0.4], ['skip', [0]]]);
});

test('a call with a dash among words stays one speech call', () => {
  assert.deepEqual(plan('Fast - slow.').map((c) => [c.kind, c.tokens]), [['speech', [0, 1, 2]]]);
});

test('the embedded vocab equals the pinned tokenizer.json vocab, id for id', () => {
  const file = JSON.parse(readFileSync(new URL('./fixtures/voice/tokenizer.json', import.meta.url), 'utf8'));
  assert.deepEqual([...EMBEDDED_VOCAB], [...loadVocab(file)]);
});
