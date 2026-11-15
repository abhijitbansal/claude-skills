import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSay, SayError } from '../../engine/script/say.mjs';
import { estimateWords, buildTimeline, MODE_PACE } from '../../engine/script/timing.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
const WPM = 150;
const words = (say, wpm = WPM) => estimateWords(parseSay(say).tokens, { wpm });

// --- binding tests from the brief ---

test('marks are parsed and removed from plain', () => {
  const p = parseSay('Your dashboard is *lying* to you... _honestly_.');
  assert.equal(p.plain, 'Your dashboard is lying to you honestly.');
  assert.deepEqual(p.tokens.filter((t) => t.emphasis).map((t) => t.text), ['lying']);
  assert.equal(p.tokens.at(-1).aside, true); assert.equal(p.tokens.at(-1).pauseBefore, 0.35);
});
test('an unclosed mark is an error that quotes the line', () => {
  assert.throws(() => parseSay('this is *broken'), /unclosed \* in "this is \*broken"/);
});
test('numbers, symbols and emoji each get a word time', () => {
  const w = estimateWords(parseSay('$4.2M up 41% 🚀').tokens, { wpm: 150 });
  assert.equal(w.length, 4); assert.ok(w.every((x) => x.end > x.start));
});
test('emphasis is slower and preceded by a pause', () => {
  const [a] = estimateWords(parseSay('lying').tokens, { wpm: 150 });
  const [b] = estimateWords(parseSay('*lying*').tokens, { wpm: 150 });
  assert.ok(b.start - a.start >= 0.12 - 1e-9); assert.ok(b.end - b.start > a.end - a.start);
});
test('timeline durations are whole frames and shots are back to back', () => {
  const tl = buildTimeline({ mode: 'pro', shots: [{ id: 'a', show: 'statement', say: 'One file.' }, { id: 'b', show: 'statement', hold: 1.5 }] }, { fps: 30 });
  assert.equal(tl.shots[1].start, tl.shots[0].end);
  assert.ok(Number.isInteger(Math.round(tl.shots[0].duration * 30 * 1e6) / 1e6));
  assert.equal(tl.shots[1].duration, 1.5); assert.equal(tl.timed, 'estimated');
});

// --- parseSay: marks ---

test('adjacent emphasis marks stay separate and both apply', () => {
  const p = parseSay('*one* *two*');
  assert.equal(p.plain, 'one two');
  assert.deepEqual(p.tokens.map((t) => t.emphasis), [true, true]);
});

test('one emphasis mark covers every enclosed word', () => {
  const p = parseSay('a *b c* d');
  assert.deepEqual(p.tokens.map((t) => t.emphasis), [false, true, true, false]);
});

test('emphasis and aside nest independently', () => {
  const p = parseSay('*one _two_ three*');
  assert.equal(p.plain, 'one two three');
  assert.deepEqual(p.tokens.map((t) => t.emphasis), [true, true, true]);
  assert.deepEqual(p.tokens.map((t) => t.aside), [false, true, false]);
});

test('an unclosed _ is an error that quotes the line', () => {
  assert.throws(() => parseSay('this is _broken'), (e) => e instanceof SayError && /unclosed _ in "this is _broken"/.test(e.message));
});

test('underscores inside a word are literal text', () => {
  const p = parseSay('call snake_case_name now');
  assert.equal(p.plain, 'call snake_case_name now');
  assert.ok(p.tokens.every((t) => !t.aside));
});

test('SayError is an Error subclass with its own name', () => {
  assert.ok(new SayError('x') instanceof Error);
  assert.equal(new SayError('x').name, 'SayError');
});

// --- parseSay: pauses ---

test('... pauses before the next token and is removed from the previous word', () => {
  const p = parseSay('wait... what');
  assert.equal(p.plain, 'wait what');
  assert.equal(p.tokens[0].text, 'wait');
  assert.equal(p.tokens[0].sentenceEnd, false);
  assert.equal(p.tokens[1].pauseBefore, 0.35);
});

test('a spaced ... is a pause too', () => {
  const p = parseSay('wait ... what');
  assert.equal(p.plain, 'wait what');
  assert.equal(p.tokens[1].pauseBefore, 0.35);
});

test('(0.4) adds that many seconds and stacks with ...', () => {
  const p = parseSay('one (0.4) two... (0.4) three');
  assert.equal(p.plain, 'one two three');
  near(p.tokens[1].pauseBefore, 0.4);
  near(p.tokens[2].pauseBefore, 0.75);
});

test('pause values at the limits are accepted', () => {
  assert.equal(parseSay('a (0.05) b').tokens[1].pauseBefore, 0.05);
  assert.equal(parseSay('a (3.0) b').tokens[1].pauseBefore, 3);
  assert.equal(parseSay('a (1.0) b').tokens[1].pauseBefore, 1);
});

test('a pause out of range is a SayError naming the value', () => {
  assert.throws(() => parseSay('a (5.0) b'), (e) => e instanceof SayError && /\(5\.0\)/.test(e.message));
  assert.throws(() => parseSay('a (0.01) b'), (e) => e instanceof SayError && /\(0\.01\)/.test(e.message));
  assert.throws(() => parseSay('a (3.5) b'), (e) => e instanceof SayError && /\(3\.5\)/.test(e.message));
});

test('a parenthesised integer is literal text, not a pause', () => {
  const p = parseSay('Founded in (2024) by (1) person');
  assert.equal(p.plain, 'Founded in (2024) by (1) person');
  assert.ok(p.tokens.every((t) => t.pauseBefore === 0));
  assert.equal(p.trailingPause, 0);
});

test('a trailing ... or (n.n) with no word after it is returned as trailingPause', () => {
  const a = parseSay('done...');
  assert.equal(a.plain, 'done');
  assert.equal(a.tokens.length, 1);
  assert.equal(a.trailingPause, 0.35);
  near(parseSay('done... (0.4)').trailingPause, 0.75);
  assert.equal(parseSay('done (1.5)').trailingPause, 1.5);
  assert.equal(parseSay('no pause').trailingPause, 0);
  assert.equal(parseSay('a... b').trailingPause, 0);
});

test('same-type nesting is a SayError that quotes the line', () => {
  assert.throws(() => parseSay('*a *b* c*'), (e) => e instanceof SayError && /nested \* in "\*a \*b\* c\*"/.test(e.message));
  assert.throws(() => parseSay('_a _b_ c_'), (e) => e instanceof SayError && /nested _ in "_a _b_ c_"/.test(e.message));
});

test('closing marks are not mistaken for nesting', () => {
  assert.equal(parseSay('*a* *b*').tokens.length, 2);
  assert.equal(parseSay('_a_ _b_.').tokens.length, 2);
  assert.equal(parseSay('*a _b_ c*').tokens.length, 3);
});

// --- parseSay: ipa ---

test('[word](/ipa/) sets ipa and keeps the word as text', () => {
  const p = parseSay('run [kubectl](/ˈkjuːbkənˌtroʊl/) now');
  assert.equal(p.plain, 'run kubectl now');
  assert.equal(p.tokens[1].text, 'kubectl');
  assert.equal(p.tokens[1].ipa, 'ˈkjuːbkənˌtroʊl');
  assert.equal('ipa' in p.tokens[0], false);
});

test('ipa keeps punctuation attached after the mark and the token can be emphasised', () => {
  const p = parseSay('use *[SQL](/ˈsiːkwəl/),* then');
  assert.equal(p.tokens[1].text, 'SQL,');
  assert.equal(p.tokens[1].ipa, 'ˈsiːkwəl');
  assert.equal(p.tokens[1].emphasis, true);
});

// --- parseSay: tokens and sentences ---

test('sentenceEnd is true for . ! ? even inside closing quotes', () => {
  const ends = parseSay('Go. Now! Why? "Done." 4.2M ok').tokens.map((t) => t.sentenceEnd);
  assert.deepEqual(ends, [true, true, true, true, false, false]);
});

test('empty or mark-only say lines are a SayError', () => {
  for (const bad of ['', '   ', '...', '**', '(0.4)']) {
    assert.throws(() => parseSay(bad), (e) => e instanceof SayError, `input ${JSON.stringify(bad)}`);
  }
  assert.throws(() => parseSay(undefined), SayError);
});

// --- estimateWords ---

test('word length scales with letters and is clamped', () => {
  const unit = 60 / WPM;
  const [short] = words('a');
  const [long] = words('internationalization');
  near(short.end - short.start, unit * 0.6);
  near(long.end - long.start, unit * 1.8);
  const [five] = words('hello');
  near(five.end - five.start, unit);
});

test('aside words are faster and emphasised words are slower', () => {
  const [plain] = words('hello');
  const [aside] = words('_hello_');
  const [emph] = words('*hello*');
  near(aside.end - aside.start, (plain.end - plain.start) * 0.85);
  near(emph.end - emph.start, (plain.end - plain.start) * 1.15);
  assert.equal(aside.aside, true); assert.equal(emph.emphasis, true);
});

test('a sentence end adds 0.25 s before the next word, a pause adds its length', () => {
  const [a, b] = words('hello. world');
  near(b.start - a.end, 0.25);
  const [c, d] = words('hello (0.4) world');
  near(d.start - c.end, 0.4);
});

test('words start at zero and never overlap', () => {
  const w = words('One two *three* _four_ five.');
  near(w[0].start, 0);
  for (let i = 1; i < w.length; i++) assert.ok(w[i].start >= w[i - 1].end - 1e-12);
});

test('estimateWords rejects a bad wpm', () => {
  for (const wpm of [0, -1, NaN, undefined]) {
    assert.throws(() => estimateWords([], { wpm }), RangeError);
  }
});

// --- buildTimeline ---

test('MODE_PACE has the two paces', () => {
  assert.deepEqual(MODE_PACE, { pro: { wpm: 150, tail: 0.6 }, viral: { wpm: 175, tail: 0.3 } });
});

test('a spoken shot lasts its last word end plus the tail, rounded up to a frame', () => {
  const fps = 30;
  const film = { mode: 'pro', shots: [{ id: 'a', say: 'One file. Zero config. Done for you today.' }] };
  const [shot] = buildTimeline(film, { fps }).shots;
  const lastEnd = shot.words.at(-1).end;
  const frames = Math.round(shot.duration * fps);
  assert.ok(shot.duration >= lastEnd + MODE_PACE.pro.tail - 1e-9);
  assert.ok(shot.duration < lastEnd + MODE_PACE.pro.tail + 1 / fps);
  near(shot.duration, frames / fps);
});

test('mode defaults to pro and viral is faster with a shorter tail', () => {
  const shots = [{ id: 'a', say: 'This sentence has enough words to be well over a second long.' }];
  const dflt = buildTimeline({ shots }, { fps: 30 });
  const pro = buildTimeline({ mode: 'pro', shots }, { fps: 30 });
  const viral = buildTimeline({ mode: 'viral', shots }, { fps: 30 });
  assert.deepEqual(dflt, pro);
  assert.ok(viral.duration < pro.duration);
});

test('a short say is lifted to the 1 s minimum and a silent shot defaults to 2 s', () => {
  const tl = buildTimeline({ shots: [{ id: 'a', say: 'Hi.' }, { id: 'b' }] }, { fps: 30 });
  assert.equal(tl.shots[0].duration, 1);
  assert.equal(tl.shots[1].duration, 2);
  assert.deepEqual(tl.shots[1].words, []);
  assert.deepEqual(tl.shots[1].sentences, []);
});

test('a trailing pause is added to the shot before the tail', () => {
  const fps = 30;
  const base = buildTimeline({ shots: [{ id: 'a', say: 'This line is long enough to pass a second.' }] }, { fps }).shots[0];
  const paused = buildTimeline({ shots: [{ id: 'a', say: 'This line is long enough to pass a second. (1.0)' }] }, { fps }).shots[0];
  assert.deepEqual(paused.words, base.words);
  near(paused.duration - base.duration, 1, 1 / fps + 1e-9);
  assert.ok(paused.duration >= paused.words.at(-1).end + 1 + MODE_PACE.pro.tail - 1e-9);
});

test('a hold below the minimum is lifted to 1 s', () => {
  const tl = buildTimeline({ shots: [{ id: 'a', hold: 0.4 }] }, { fps: 30 });
  assert.equal(tl.shots[0].duration, 1);
});

test('shots carry index, id, back-to-back times and total frames', () => {
  const fps = 24;
  const tl = buildTimeline({ shots: [{ id: 'a', hold: 1.5 }, { id: 'b', hold: 2 }, { id: 'c', hold: 1 }] }, { fps });
  assert.deepEqual(tl.shots.map((s) => [s.id, s.index]), [['a', 0], ['b', 1], ['c', 2]]);
  assert.equal(tl.shots[0].start, 0);
  assert.equal(tl.shots[1].start, tl.shots[0].end);
  assert.equal(tl.shots[2].start, tl.shots[1].end);
  assert.equal(tl.fps, fps);
  assert.equal(tl.frameCount, Math.round(4.5 * fps));
  near(tl.duration, 4.5);
  assert.equal(tl.duration, tl.shots[2].end);
});

test('words and sentences are shot-local seconds', () => {
  const tl = buildTimeline({ shots: [{ id: 'a', hold: 3 }, { id: 'b', say: 'Later shot.' }] }, { fps: 30 });
  assert.equal(tl.shots[1].words[0].start, 0);
  assert.equal(tl.shots[1].sentences[0].start, 0);
});

test('sentences group words up to each sentence end, with a trailing open sentence', () => {
  const [shot] = buildTimeline({ shots: [{ id: 'a', say: 'One. Two three! Four five' }] }, { fps: 30 }).shots;
  assert.deepEqual(shot.sentences.map((s) => [s.first, s.last]), [[0, 0], [1, 2], [3, 4]]);
  for (const s of shot.sentences) {
    assert.equal(s.start, shot.words[s.first].start);
    assert.equal(s.end, shot.words[s.last].end);
  }
});

test('a say that ends on a sentence end has no extra empty sentence', () => {
  const [shot] = buildTimeline({ shots: [{ id: 'a', say: 'One. Two.' }] }, { fps: 30 }).shots;
  assert.equal(shot.sentences.length, 2);
});

test('an empty say is a SayError that names the shot', () => {
  assert.throws(
    () => buildTimeline({ shots: [{ id: 'intro', say: '' }] }, { fps: 30 }),
    (e) => e instanceof SayError && /intro/.test(e.message),
  );
});

test('a bad mark in a say is a SayError that names the shot and quotes the line', () => {
  assert.throws(
    () => buildTimeline({ shots: [{ id: 'intro', say: 'so *bad' }] }, { fps: 30 }),
    (e) => e instanceof SayError && /intro/.test(e.message) && /unclosed \* in "so \*bad"/.test(e.message),
  );
});

test('an unknown mode, bad fps, bad hold and missing shots are errors', () => {
  const shots = [{ id: 'a', hold: 1 }];
  assert.throws(() => buildTimeline({ mode: 'slow', shots }, { fps: 30 }), /unknown mode "slow"/);
  assert.throws(() => buildTimeline({ shots }, { fps: 0 }), RangeError);
  assert.throws(() => buildTimeline({ shots: [{ id: 'a', hold: -1 }] }, { fps: 30 }), RangeError);
  assert.throws(() => buildTimeline({}, { fps: 30 }), TypeError);
});

test('buildTimeline does not mutate its input', () => {
  const film = { mode: 'viral', shots: [{ id: 'a', say: 'Same *in* same out.' }] };
  const copy = structuredClone(film);
  buildTimeline(film, { fps: 30 });
  assert.deepEqual(film, copy);
});
