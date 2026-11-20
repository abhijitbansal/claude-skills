import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSay, mergeOrphans, SayError } from '../../engine/script/say.mjs';
import { estimateWords, buildTimeline } from '../../engine/script/timing.mjs';
import { registries } from '../../engine/registry.mjs';

// The paces live on the registered modes (engine/modes); buildTimeline reads them there.
const PRO_TAIL = registries.modes.get('pro').tail;

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

test('an opener of an already-open type is nested wherever it appears', () => {
  const nested = (say, mark) => assert.throws(
    () => parseSay(say),
    (e) => e instanceof SayError && e.message.startsWith(`nested ${mark} in `),
    say,
  );
  nested('*a (*b*) c*', '*');
  nested('*a "*b*" c*', '*');
  nested('*a *b* c*', '*');
  nested('_a (_b_) c_', '_');
  nested('_a "_b_" c_', '_');
});

test('marks inside brackets and quotes open and close at word boundaries', () => {
  const p = parseSay('say (*hi*), "_x_" and "*quoted*" done');
  assert.equal(p.plain, 'say (hi), "x" and "quoted" done');
  assert.deepEqual(p.tokens.map((t) => t.emphasis), [false, true, false, false, true, false]);
  assert.deepEqual(p.tokens.map((t) => t.aside), [false, false, true, false, false, false]);
});

test('a * or _ inside a word or between spaces is literal text', () => {
  for (const say of ['call __init__ now', 'a*b and c*d', 'use snake_case here', '2 * 3 = 6']) {
    const p = parseSay(say);
    assert.equal(p.plain, say);
    assert.ok(p.tokens.every((t) => !t.emphasis && !t.aside), say);
  }
  assert.equal(parseSay('call __init__ now').tokens.length, 3);
});

test('punctuation glued after a pause stays on the word and the pause moves on', () => {
  const q = parseSay('Really...? Yes');
  assert.deepEqual(q.tokens.map((t) => t.text), ['Really?', 'Yes']);
  assert.equal(q.tokens[0].sentenceEnd, true);
  assert.equal(q.tokens[1].pauseBefore, 0.35);
  const quoted = parseSay('"wait..." now');
  assert.deepEqual(quoted.tokens.map((t) => t.text), ['"wait"', 'now']);
  assert.equal(quoted.tokens[1].pauseBefore, 0.35);
  const timed = parseSay('ok(0.4), then');
  assert.deepEqual(timed.tokens.map((t) => t.text), ['ok,', 'then']);
  assert.equal(timed.tokens[1].pauseBefore, 0.4);
  const last = parseSay('Really...?');
  assert.equal(last.tokens.length, 1);
  assert.equal(last.tokens[0].text, 'Really?');
  assert.equal(last.trailingPause, 0.35);
});

test('a token of only closing punctuation joins the previous token and hands on its pause', () => {
  const spaced = parseSay('ok (0.4), then');
  assert.deepEqual(spaced.tokens.map((t) => t.text), ['ok,', 'then']);
  assert.equal(spaced.tokens[1].pauseBefore, 0.4);
  assert.equal(spaced.plain, 'ok, then');

  const q = parseSay('Really ...? Yes');
  assert.deepEqual(q.tokens.map((t) => t.text), ['Really?', 'Yes']);
  assert.equal(q.tokens[0].sentenceEnd, true);
  assert.equal(q.tokens[1].pauseBefore, 0.35);

  const trailing = parseSay('done (0.4) .');
  assert.deepEqual(trailing.tokens.map((t) => t.text), ['done.']);
  assert.equal(trailing.tokens[0].sentenceEnd, true);
  assert.equal(trailing.trailingPause, 0.4);

  assert.deepEqual(parseSay('a , ; b').tokens.map((t) => t.text), ['a,;', 'b']);
  assert.deepEqual(parseSay('go (a) " now').tokens.map((t) => t.text), ['go', '(a)"', 'now']);
});

test('an orphan punctuation token with no previous token stays as it is', () => {
  assert.deepEqual(parseSay('?').tokens.map((t) => t.text), ['?']);
  assert.deepEqual(parseSay(', hello').tokens.map((t) => t.text), [',', 'hello']);
  assert.deepEqual(parseSay('"hi" there').tokens.map((t) => t.text), ['"hi"', 'there']);
});

const texts = (say) => parseSay(say).tokens.map((t) => t.text);
const plainTok = (text, extra = {}) => ({ text, emphasis: false, aside: false, pauseBefore: 0, sentenceEnd: false, ...extra });

test('(A) a lone mark between brackets or quotes opens and is unclosed, with a hint to escape it', () => {
  for (const say of ['(*)', 'the "*" key']) {
    assert.throws(
      () => parseSay(say),
      (e) => e instanceof SayError && e.message === `unclosed * in "${say}"; close it, or write \\* for a literal asterisk`,
      say,
    );
  }
  assert.throws(
    () => parseSay('"_"'),
    (e) => e instanceof SayError && e.message === 'unclosed _ in ""_""; close it, or write \\_ for a literal underscore',
  );
});

test('escapes: \\* and \\_ are literal marks and \\\\ is a backslash, none of them shown as a backslash', () => {
  assert.deepEqual(texts('(\\*)'), ['(*)']);
  assert.deepEqual(texts('the "\\*" key'), ['the', '"*"', 'key']);
  assert.deepEqual(texts('use \\_name\\_ here'), ['use', '_name_', 'here']);
  assert.deepEqual(texts('a \\\\ b'), ['a', '\\', 'b']);
  assert.deepEqual(texts('path C:\\temp'), ['path', 'C:\\temp']);
  const open = parseSay('\\*not emphasis\\*');
  assert.deepEqual(open.tokens.map((t) => [t.text, t.emphasis]), [['*not', false], ['emphasis*', false]]);
  const inside = parseSay('*a \\* b*');
  assert.deepEqual(inside.tokens.map((t) => [t.text, t.emphasis]), [['a', true], ['*', true], ['b', true]]);
  assert.equal(parseSay('(\\*)').plain, '(*)');
});

test('an escaped mark is ordinary text for the marks next to it', () => {
  assert.deepEqual(parseSay('*a\\**').tokens, [plainTok('a*', { emphasis: true })]);
  assert.deepEqual(parseSay('\\**a*').tokens, [plainTok('*a', { emphasis: true })]);
  assert.deepEqual(parseSay('\\*\\*').tokens, [plainTok('**')]);
  assert.deepEqual(parseSay('\\__a_').tokens, [plainTok('_a', { aside: true })]);
  assert.deepEqual(parseSay('_a\\__').tokens, [plainTok('a_', { aside: true })]);
  assert.deepEqual(parseSay('x \\**a* y').tokens.map((t) => [t.text, t.emphasis]), [['x', false], ['*a', true], ['y', false]]);
  assert.deepEqual(parseSay('*a\\\\*').tokens, [plainTok('a\\', { emphasis: true })]);
});

test('a mark closes before the other mark and the other mark can open right after it', () => {
  const glued = parseSay('*a*_b_').tokens;
  assert.deepEqual(glued, [plainTok('ab', { emphasis: true, aside: true })]);
  const spaced = parseSay('*a* _b_').tokens;
  assert.deepEqual(spaced, [plainTok('a', { emphasis: true }), plainTok('b', { aside: true })]);
  assert.deepEqual(parseSay('_a_*b*').tokens, [plainTok('ab', { emphasis: true, aside: true })]);
  assert.deepEqual(parseSay('_a_ *b*').tokens, [plainTok('a', { aside: true }), plainTok('b', { emphasis: true })]);
  assert.deepEqual(parseSay('go *a*_b_ now').tokens.map((t) => [t.text, t.emphasis, t.aside]), [['go', false, false], ['ab', true, true], ['now', false, false]]);
});

test('a mark pair in the middle of a word with nothing open is literal text', () => {
  assert.deepEqual(parseSay('a*_b').tokens, [plainTok('a*_b')]);
});

test('a mark that can both open and close closes when its kind is open, otherwise opens', () => {
  const quoted = parseSay('say *"quoted"* ok').tokens;
  assert.deepEqual(quoted.map((t) => [t.text, t.emphasis]), [['say', false], ['"quoted"', true], ['ok', false]]);
  const comma = parseSay('say *"quoted"*, ok').tokens;
  assert.deepEqual(comma.map((t) => [t.text, t.emphasis]), [['say', false], ['"quoted",', true], ['ok', false]]);
});

test('emphasis can end in a symbol, a percent sign or an emoji and can start with one', () => {
  assert.deepEqual(parseSay('up *41%* today').tokens.map((t) => [t.text, t.emphasis]), [['up', false], ['41%', true], ['today', false]]);
  assert.deepEqual(parseSay('go *\u{1F680}* now').tokens.map((t) => [t.text, t.emphasis]), [['go', false], ['\u{1F680}', true], ['now', false]]);
  assert.deepEqual(parseSay('pay *$5* now').tokens.map((t) => [t.text, t.emphasis]), [['pay', false], ['$5', true], ['now', false]]);
});

test('a closer with nothing open stays literal text', () => {
  assert.deepEqual(parseSay('foo* bar').tokens, [plainTok('foo*'), plainTok('bar')]);
  assert.deepEqual(parseSay('foo_ bar').tokens, [plainTok('foo_'), plainTok('bar')]);
});

test('error messages teach the fix', () => {
  assert.throws(
    () => parseSay('this is *broken'),
    (e) => e.message === 'unclosed * in "this is *broken"; close it, or write \\* for a literal asterisk',
  );
  assert.throws(
    () => parseSay('this is _broken'),
    (e) => e.message === 'unclosed _ in "this is _broken"; close it, or write \\_ for a literal underscore',
  );
  assert.throws(
    () => parseSay('*a *b* c*'),
    (e) => e.message === 'nested * in "*a *b* c*"; emphasis cannot contain emphasis',
  );
  assert.throws(
    () => parseSay('_a _b_ c_'),
    (e) => e.message === 'nested _ in "_a _b_ c_"; an aside cannot contain an aside',
  );
});

test('(B) a mark run of both kinds opens and closes together', () => {
  const [a, b] = parseSay('*a _b_*').tokens;
  assert.deepEqual([a.text, a.emphasis, a.aside], ['a', true, false]);
  assert.deepEqual([b.text, b.emphasis, b.aside], ['b', true, true]);
  const [only] = parseSay('*_a_*').tokens;
  assert.deepEqual([only.text, only.emphasis, only.aside], ['a', true, true]);
});

test('(C) a mark opens after a pause mark, a hyphen, a dash or a slash', () => {
  const afterPause = parseSay('go (0.4)*now* ok').tokens;
  assert.deepEqual(afterPause.map((t) => [t.text, t.emphasis]), [['go', false], ['now', true], ['ok', false]]);
  assert.equal(afterPause[1].pauseBefore, 0.4);
  const afterDots = parseSay('wait...*now* ok').tokens;
  assert.deepEqual(afterDots.map((t) => [t.text, t.emphasis]), [['wait', false], ['now', true], ['ok', false]]);
  assert.equal(afterDots[1].pauseBefore, 0.35);
  assert.deepEqual(parseSay('well-*known* x').tokens.map((t) => [t.text, t.emphasis]), [['well-known', true], ['x', false]]);
  assert.deepEqual(parseSay('—*x* y').tokens.map((t) => [t.text, t.emphasis]), [['—x', true], ['y', false]]);
  assert.deepEqual(parseSay('and/*or* y').tokens.map((t) => [t.text, t.emphasis]), [['and/or', true], ['y', false]]);
});

test('(D) a mark closes before a dash or a slash', () => {
  const dash = parseSay('*word*—next and more').tokens;
  assert.deepEqual(dash.map((t) => [t.text, t.emphasis]), [['word—next', true], ['and', false], ['more', false]]);
  const slash = parseSay('*a*/b and more').tokens;
  assert.deepEqual(slash.map((t) => [t.text, t.emphasis]), [['a/b', true], ['and', false], ['more', false]]);
});

test('(E) doubled marks are literal text', () => {
  assert.deepEqual(parseSay('**').tokens, [plainTok('**')]);
  assert.deepEqual(parseSay('**bold**').tokens, [plainTok('**bold**')]);
  assert.equal(parseSay('**bold**').trailingPause, 0);
  assert.deepEqual(parseSay('__init__').tokens, [plainTok('__init__')]);
});

test('(F) an opener-shaped mark inside an open emphasis is a nesting error, not a silent mis-parse', () => {
  assert.throws(
    () => parseSay('*a (*"b"*) c*'),
    (e) => e instanceof SayError && /nested \* in "\*a \(\*"b"\*\) c\*"/.test(e.message),
  );
});

test('(G) after a pause only what really closes the word is glued to it', () => {
  const single = parseSay("x(0.4)'y'").tokens;
  assert.deepEqual(single.map((t) => t.text), ['x', "'y'"]);
  assert.equal(single[1].pauseBefore, 0.4);
  const double = parseSay('x(0.4)"y"').tokens;
  assert.deepEqual(double.map((t) => t.text), ['x', '"y"']);
  assert.equal(double[1].pauseBefore, 0.4);
  const dot = parseSay('Wait(0.4).Next').tokens;
  assert.deepEqual(dot.map((t) => t.text), ['Wait.', 'Next']);
  assert.equal(dot[0].sentenceEnd, true);
  assert.equal(dot[1].pauseBefore, 0.4);
  assert.deepEqual(texts('say "hi"(0.4)" now'), ['say', '"hi""', 'now']);
});

test('(H) merging an orphan ORs its flags into the previous token and keeps the ipa', () => {
  const prev = plainTok('a', { ipa: 'ei' });
  const orphan = plainTok(',', { emphasis: true, aside: true, pauseBefore: 0.2 });
  const merged = mergeOrphans({ tokens: [prev, orphan], trailingPause: 0 });
  assert.deepEqual(merged.tokens, [plainTok('a,', { emphasis: true, aside: true, ipa: 'ei' })]);
  assert.equal(merged.trailingPause, 0.2);
  const viaParse = parseSay('[kubectl](/ku:b/) (0.4), go').tokens;
  assert.equal(viaParse[0].text, 'kubectl,');
  assert.equal(viaParse[0].ipa, 'ku:b');
});

// Parsing must be linear: each adversarial line returns or throws well inside the budget.
const LINEAR_N = 200000;
const LINEAR_BUDGET_MS = 500;
const ADVERSARIAL = {
  'closing punctuation then a letter': () => ')'.repeat(LINEAR_N) + 'a',
  'only marks': () => '*'.repeat(LINEAR_N),
  'alternating marks': () => '*_'.repeat(LINEAR_N),
  'open brackets': () => '['.repeat(LINEAR_N),
  'open parens': () => '('.repeat(LINEAR_N),
  'long digit run after a paren': () => `(${'1'.repeat(LINEAR_N)}`,
  'dots then a letter': () => `${'.'.repeat(LINEAR_N)}a`,
  'repeated ipa starts': () => '[a](/'.repeat(LINEAR_N),
  'repeated pauses': () => '(0.4)'.repeat(LINEAR_N),
  'repeated orphans': () => 'a ,'.repeat(LINEAR_N),
  'pause then quote, repeated': () => 'x(0.4)"'.repeat(LINEAR_N),
};

for (const [name, make] of Object.entries(ADVERSARIAL)) {
  test(`parseSay is linear on ${name}`, () => {
    const say = make();
    const start = process.hrtime.bigint();
    try {
      parseSay(say);
    } catch (e) {
      assert.ok(e instanceof SayError, `unexpected ${e}`);
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(ms < LINEAR_BUDGET_MS, `${name}: ${ms.toFixed(0)} ms for ${say.length} chars`);
  });
}

test('a long run of closing punctuation before a letter is not a sentence end', () => {
  const [token] = parseSay(`${')'.repeat(50)}a`).tokens;
  assert.equal(token.sentenceEnd, false);
  assert.equal(parseSay(`${')'.repeat(50)}.`).tokens[0].sentenceEnd, true);
  assert.equal(parseSay('done.")').tokens[0].sentenceEnd, true);
});

test('earlier mark shapes still hold', () => {
  assert.deepEqual(parseSay("don't *users'* data").tokens.map((t) => [t.text, t.emphasis]), [["don't", false], ["users'", true], ['data', false]]);
  assert.deepEqual(parseSay('"*really*" ok').tokens.map((t) => [t.text, t.emphasis]), [['"really"', true], ['ok', false]]);
  assert.deepEqual(parseSay('*lying*, ok').tokens.map((t) => [t.text, t.emphasis]), [['lying,', true], ['ok', false]]);
  assert.deepEqual(parseSay('_by the way_ ok').tokens.map((t) => [t.text, t.aside]), [['by', true], ['the', true], ['way', true], ['ok', false]]);
  assert.equal(parseSay('2 * 3').plain, '2 * 3');
});

test('the Unicode ellipsis is a pause exactly like ...', () => {
  const p = parseSay('wait… what');
  assert.equal(p.plain, 'wait what');
  assert.equal(p.tokens[1].pauseBefore, 0.35);
  assert.equal(parseSay('done…').trailingPause, 0.35);
  assert.equal(parseSay('Really…? Yes').tokens[0].text, 'Really?');
  assert.equal(parseSay('you…honestly').tokens.length, 2);
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
  for (const bad of ['', '   ', '...', '…', '(0.4)', '... (0.4)']) {
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

test('the registered modes carry the two paces', () => {
  const pace = (name) => ({ wpm: registries.modes.get(name).wpm, tail: registries.modes.get(name).tail });
  assert.deepEqual({ pro: pace('pro'), viral: pace('viral') }, { pro: { wpm: 150, tail: 0.6 }, viral: { wpm: 175, tail: 0.3 } });
});

test('a spoken shot lasts its last word end plus the tail, rounded up to a frame', () => {
  const fps = 30;
  const film = { mode: 'pro', shots: [{ id: 'a', say: 'One file. Zero config. Done for you today.' }] };
  const [shot] = buildTimeline(film, { fps }).shots;
  const lastEnd = shot.words.at(-1).end;
  const frames = Math.round(shot.duration * fps);
  assert.ok(shot.duration >= lastEnd + PRO_TAIL - 1e-9);
  assert.ok(shot.duration < lastEnd + PRO_TAIL + 1 / fps);
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
  assert.ok(paused.duration >= paused.words.at(-1).end + 1 + PRO_TAIL - 1e-9);
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

test('the rethrown shot SayError keeps the original as its cause', () => {
  try {
    buildTimeline({ shots: [{ id: 'intro', say: 'so *bad' }] }, { fps: 30 });
    assert.fail('expected a throw');
  } catch (e) {
    assert.ok(e instanceof SayError);
    assert.ok(e.cause instanceof SayError);
    assert.match(e.cause.message, /^unclosed \* in "so \*bad"/);
    assert.ok(!e.cause.message.startsWith('shot '));
  }
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
