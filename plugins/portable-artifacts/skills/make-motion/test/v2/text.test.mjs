// v2 text layout: line breaks by sense, balance, fit to a box, optical alignment, numeral advance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { breakBySense, stackLines } from '../../engine/text/breaks.mjs';
import { layoutText, fitText, numeralAdvance, NUMBER_TOKEN, UNIT_WORDS } from '../../engine/text/layout.mjs';

const measure = (text, font) => ({ width: text.length * font.size * 0.5, ascent: font.size * 0.8, descent: font.size * 0.2 });
const font = { family: 'x', size: 100, weight: 700 };
const lineTexts = (l) => l.lines.map((x) => x.words.map((w) => w.text).join(' '));

test('breaks before a preposition rather than at the box edge', () => {
  const l = layoutText({ text: 'Where did this number come from', font, maxWidth: 900, measure });
  assert.deepEqual(l.lines.map((x) => x.words.map((w) => w.text).join(' ')), ['Where did this', 'number come from']);
});

test('a | forces a break and is not drawn', () => {
  const l = layoutText({ text: 'One file | no server', font, maxWidth: 5000, measure });
  assert.deepEqual(l.lines.map((x) => x.words.map((w) => w.text).join(' ')), ['One file', 'no server']);
});

test('no one-word last line under a long line', () => {
  const l = layoutText({ text: 'Every chart here shows its query', font, maxWidth: 1350, measure });
  assert.ok(l.lines.at(-1).words.length >= 2);
});

test('a number with its unit stays on one line', () => {
  const l = layoutText({ text: 'Revenue grew $4.2M this quarter', font, maxWidth: 700, measure });
  assert.ok(l.lines.some((x) => x.words.some((w) => w.text === '$4.2M')));
});

test('a number and its unit word never split across lines but stay separate words', () => {
  const l = layoutText({ text: 'took 1,204 ms to load', font, maxWidth: 600, measure });
  const lineOf = (index) => l.lines.findIndex((x) => x.words.some((w) => w.index === index));
  assert.equal(lineOf(1), lineOf(2));
  const ms = l.lines[lineOf(2)].words.find((w) => w.index === 2);
  assert.equal(ms.text, 'ms');
  assert.equal(ms.width, 100);
  assert.ok(ms.x > 0);
});

test('UNIT_WORDS is the exported, case-sensitive list; a unit may carry trailing punctuation', () => {
  for (const u of ['ms', 's', '%', 'M', 'K', 'B', 'GB', 'MB', 'kg', 'km', 'px', 'fps', 'x']) assert.ok(UNIT_WORDS.has(u), u);
  assert.ok(!UNIT_WORDS.has('MS'));
  const l = layoutText({ text: 'took 1,204 ms. then more words follow here', font, maxWidth: 600, measure });
  const lineOf = (index) => l.lines.findIndex((x) => x.words.some((w) => w.index === index));
  assert.equal(lineOf(1), lineOf(2));
});

test('a number followed by an ordinary word may still break between them', () => {
  const l = layoutText({ text: 'took 1,204 days to load', font, maxWidth: 600, measure });
  assert.deepEqual(lineTexts(l), ['took 1,204', 'days to load']);
});

test('fitText reports overflow at the floor instead of clipping', () => {
  const long = Array(30).fill('paragraph').join(' ');
  // The brief gave maxHeight 300, but with this fake measure 30 words fit 300 high at size 34 (8 lines, 295.8)
  // and even at size 28 (6 lines, 182), so no layout overflows there. 150 makes the floor overflow for real.
  const l = fitText({ text: long, font, maxWidth: 800, measure }, { min: 28, max: 200, maxHeight: 150 });
  assert.equal(l.size, 28); assert.equal(l.overflow, true);
});

test('fitText on the brief box (maxHeight 300) finds size 34 with no overflow', () => {
  const long = Array(30).fill('paragraph').join(' ');
  const l = fitText({ text: long, font, maxWidth: 800, measure }, { min: 28, max: 200, maxHeight: 300 });
  assert.equal(l.size, 34); assert.equal(l.overflow, false);
  assert.ok(l.height <= 300);
});

test('optical alignment hangs an opening quote', () => {
  const l = layoutText({ text: '“Fast” they said', font, maxWidth: 5000, measure, align: 'left', optical: true });
  assert.ok(l.lines[0].x < 0);
});

// --- edge cases named in prose ---

test('a single word wider than maxWidth gets its own line without error', () => {
  const l = layoutText({ text: 'Supercalifragilistic is long', font, maxWidth: 400, measure });
  assert.deepEqual(lineTexts(l), ['Supercalifragilistic', 'is long']);
  assert.ok(l.lines[0].width > 400);
});

test('empty or whitespace-only text lays out to no lines and zero size', () => {
  for (const text of ['', '   \n\t ', ' | ']) {
    const l = layoutText({ text, font, maxWidth: 800, measure });
    assert.deepEqual(l.lines, []);
    assert.equal(l.width, 0);
    assert.equal(l.height, 0);
    assert.equal(l.overflow, false);
  }
});

test('align center and right offset each line inside maxWidth', () => {
  const center = layoutText({ text: 'ab | abcd', font, maxWidth: 500, measure, align: 'center' });
  assert.deepEqual(center.lines.map((x) => x.x), [200, 150]);
  const right = layoutText({ text: 'ab | abcd', font, maxWidth: 500, measure, align: 'right' });
  assert.deepEqual(right.lines.map((x) => x.x), [400, 300]);
});

// --- layout geometry ---

test('baselines start at the ascent and step by lineHeight * size', () => {
  const l = layoutText({ text: 'ab | cd', font, maxWidth: 500, measure });
  assert.deepEqual(l.lines.map((x) => x.y), [80, 190]);
  assert.equal(l.size, 100);
  assert.equal(l.height, 110 + 80 + 20);
  assert.equal(l.width, 100);
  const tall = layoutText({ text: 'ab | cd', font: { ...font, lineHeight: 1.5 }, maxWidth: 500, measure });
  assert.deepEqual(tall.lines.map((x) => x.y), [80, 230]);
});

test('word index counts kept words and word x advances by width plus space', () => {
  const l = layoutText({ text: 'a | b | c d', font, maxWidth: 5000, measure });
  assert.deepEqual(l.lines.map((x) => x.words.map((w) => w.index)), [[0], [1], [2, 3]]);
  const last = l.lines[2];
  assert.deepEqual(last.words.map((w) => w.x), [0, 100]);
  assert.equal(last.width, 150);
});

test('a word ending in | forces a break and a standalone | does too', () => {
  const a = layoutText({ text: 'One file| no server', font, maxWidth: 5000, measure });
  const b = layoutText({ text: 'One file | no server', font, maxWidth: 5000, measure });
  assert.deepEqual(lineTexts(a), ['One file', 'no server']);
  assert.deepEqual(lineTexts(b), lineTexts(a));
});

test('tracking adds tracking * size per character to word and space widths', () => {
  const l = layoutText({ text: 'ab cd', font: { ...font, tracking: 0.1 }, maxWidth: 5000, measure });
  assert.deepEqual(l.lines[0].words.map((w) => w.width), [120, 120]);
  assert.deepEqual(l.lines[0].words.map((w) => w.x), [0, 180]);
  assert.equal(l.lines[0].width, 300);
});

test('optical does not shift lines for center alignment or when off', () => {
  const centered = layoutText({ text: '“Fast”', font, maxWidth: 1000, measure, align: 'center', optical: true });
  assert.ok(centered.lines[0].x >= 0);
  const plain = layoutText({ text: '“Fast”', font, maxWidth: 1000, measure, align: 'left' });
  assert.equal(plain.lines[0].x, 0);
});

test('optical hangs by the width of that glyph on every line start', () => {
  const l = layoutText({ text: '(one) | [two]', font, maxWidth: 5000, measure, align: 'left', optical: true });
  assert.deepEqual(l.lines.map((x) => x.x), [-50, -50]);
});

test('layoutText rejects bad arguments with a clear message', () => {
  assert.throws(() => layoutText({ text: 'a', font, maxWidth: 0, measure }), /maxWidth/);
  assert.throws(() => layoutText({ text: 'a', font, maxWidth: 100 }), /measure/);
  assert.throws(() => layoutText({ text: 'a', font: { ...font, size: 0 }, maxWidth: 100, measure }), /size/);
  assert.throws(() => layoutText({ text: 'a', font, maxWidth: 100, measure, align: 'justify' }), /align/);
});

test('NUMBER_TOKEN matches amounts with units and rejects words', () => {
  for (const ok of ['$4.2M', '12%', '1,200km', '€3.50', '2024', '£9bn']) assert.ok(NUMBER_TOKEN.test(ok), ok);
  for (const bad of ['hello', '4.2 M', '$', 'M4']) assert.ok(!NUMBER_TOKEN.test(bad), bad);
});

// --- breakBySense directly ---

test('breakBySense never exceeds maxWidth unless one word alone is wider', () => {
  const rows = breakBySense(['aaa', 'bbb', 'ccc', 'ddd'], [300, 300, 300, 300], 50, 700);
  assert.deepEqual(rows, [[0, 1], [2, 3]]);
});

test('breakBySense prefers a break after punctuation', () => {
  const words = ['one', 'two,', 'three', 'four', 'five'];
  const rows = breakBySense(words, Array(5).fill(200), 50, 700);
  assert.deepEqual(rows, [[0, 1], [2, 3, 4]]);
});

test('breakBySense prefers to break before a preposition', () => {
  const words = ['The', 'edge', 'of', 'town', 'ends'];
  const widths = [150, 200, 100, 200, 200];
  const rows = breakBySense(words, widths, 50, 600);
  assert.deepEqual(rows, [[0, 1], [2, 3, 4]]);
});

test('breakBySense honours a forced break on a | word', () => {
  const rows = breakBySense(['a|', 'b', 'c'], [100, 100, 100], 50, 5000);
  assert.deepEqual(rows, [[0], [1, 2]]);
});

test('breakBySense keeps an author-forced one-word last line', () => {
  const rows = breakBySense(['a', 'b', 'c', 'd|', 'Go'], [100, 100, 100, 100, 100], 50, 5000);
  assert.deepEqual(rows, [[0, 1, 2, 3], [4]]);
});

test('breakBySense balances lines (shortest close to longest)', () => {
  const widths = Array(8).fill(100);
  const words = widths.map((_, i) => `w${i}`);
  const rows = breakBySense(words, widths, 50, 1000);
  assert.deepEqual(rows, [[0, 1, 2, 3], [4, 5, 6, 7]]);
  const narrow = breakBySense(words, widths, 50, 500);
  assert.deepEqual(narrow.map((r) => r.length).sort(), [2, 3, 3]);
});

test('breakBySense pulls a word down rather than leave one alone under three or more', () => {
  // Squared slack alone prefers [..][5,6,7][8] here (last line of one word under three words);
  // the lone-last-line penalty must give [..][4,5,6][7,8]. Found by search in .scratch/lone-last-search.mjs.
  const widths = [200, 200, 200, 250, 50, 50, 50, 200, 200];
  const words = widths.map((_, i) => `w${i}`);
  const rows = breakBySense(words, widths, 50, 450);
  // revision 2 costs a one-word line anywhere, so the break that also left w3 alone ([0][1 2][3][4 5 6][7 8]) gave way
  assert.deepEqual(rows, [[0], [1, 2], [3, 4], [5, 6], [7, 8]]);
  assert.ok(rows.at(-1).length > 1, 'the last line is not one word');
});

test('breakBySense never breaks after a word marked keep-with-next', () => {
  const words = ['took', '1,204', 'ms', 'to', 'load'];
  const widths = [200, 250, 100, 100, 200];
  const loose = breakBySense(words, widths, 50, 600);
  assert.ok(loose.some((r) => r.at(-1) === 1), 'without the mark the break falls after 1,204');
  const glued = breakBySense(words, widths, 50, 600, [false, true, false, false, false]);
  assert.ok(glued.every((r) => r.at(-1) !== 1));
});

test('breakBySense still lays out a glued pair wider than maxWidth', () => {
  const rows = breakBySense(['a', 'b', 'c'], [300, 300, 100], 50, 400, [true, false, false]);
  assert.deepEqual(rows, [[0, 1], [2]]);
});

test('breakBySense returns no rows for no words and rejects mismatched widths', () => {
  assert.deepEqual(breakBySense([], [], 50, 500), []);
  assert.throws(() => breakBySense(['a'], [], 50, 500), /widths/);
});

// --- fitText ---

test('fitText picks the largest whole-number size that fits the box', () => {
  const opts = { text: 'paragraph paragraph', font, maxWidth: 800, measure };
  const l = fitText(opts, { min: 10, max: 200, maxHeight: 120 });
  assert.equal(l.size, 84);
  assert.equal(l.overflow, false);
  assert.ok(l.height <= 120);
});

test('fitText respects maxLines', () => {
  const opts = { text: 'paragraph paragraph', font, maxWidth: 800, measure };
  const l = fitText(opts, { min: 10, max: 200, maxHeight: 10000, maxLines: 1 });
  assert.equal(l.size, 84);
  assert.equal(l.lines.length, 1);
});

test('fitText returns max when it fits at once, and rounds bounds inward', () => {
  const opts = { text: 'ab', font, maxWidth: 800, measure };
  assert.equal(fitText(opts, { min: 10, max: 60.7, maxHeight: 500 }).size, 60);
});

test('fitText treats a word wider than the box as not fitting', () => {
  const opts = { text: 'paragraph', font, maxWidth: 400, measure };
  const l = fitText(opts, { min: 10, max: 200, maxHeight: 5000 });
  assert.equal(l.size, 88);
  assert.equal(l.overflow, false);
});

test('fitText rejects an empty size range', () => {
  const opts = { text: 'a', font, maxWidth: 800, measure };
  assert.throws(() => fitText(opts, { min: 50, max: 10, maxHeight: 100 }), /min/);
});

// --- numeralAdvance ---

test('numeralAdvance is the widest digit advance', () => {
  const uneven = (text, f) => ({ width: text === '7' ? 70 : 50, ascent: f.size, descent: 0 });
  assert.equal(numeralAdvance(uneven, font), 70);
  assert.equal(numeralAdvance(measure, font), 50);
});

// ---- revision 1: word spacing and the stack ----

test('a font with wordSpace sets that many em between words instead of the measured space', () => {
  // the fake measure gives a space 0.5 em wide; wordSpace 0.26 em replaces it
  const spaced = layoutText({ text: 'Your charts', font: { ...font, wordSpace: 0.26 }, maxWidth: 5000, measure });
  const [your, charts] = spaced.lines[0].words;
  assert.equal(charts.x - (your.x + your.width), 26, '0.26 em of a 100 px font');
  assert.equal(spaced.lines[0].width, 200 + 26 + 300);
  const plain = layoutText({ text: 'Your charts', font, maxWidth: 5000, measure });
  assert.equal(plain.lines[0].words[1].x - plain.lines[0].words[0].width, 50, 'without it, the measured space');
});

test('stackLines: at most 3 words a line, 2 when a line would pass 12 letters, | honoured, breaks by sense', () => {
  const rows = (text) => stackLines(text.split(/\s+/)).map((r) => r.map((i) => text.split(/\s+/)[i]).join(' '));
  assert.deepEqual(rows('NO CLOUD.| NO ACCOUNT.| NO UPLOAD.'), ['NO CLOUD.|', 'NO ACCOUNT.|', 'NO UPLOAD.']);
  assert.deepEqual(rows('YOUR CHARTS ARE HIDING SOMETHING.'), ['YOUR CHARTS', 'ARE HIDING', 'SOMETHING.']);
  assert.deepEqual(rows('ONE FILE. NO SERVER.'), ['ONE FILE.', 'NO SERVER.']);
  for (const text of ['A B C D E F G', 'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG', 'SAVE THIS.| BUILD YOURS.']) {
    const words = text.split(/\s+/);
    for (const row of stackLines(words)) {
      assert.ok(row.length <= 3, `${text}: ${row.length} words on a line`);
      const letters = row.map((i) => words[i].replace(/[^\p{L}\p{N}]/gu, '')).join('').length;
      assert.ok(row.length <= 2 || letters <= 12, `${text}: 3 words and ${letters} letters`);
    }
  }
  assert.deepEqual(stackLines([]), []);
});

test('a sentence that ends mid-line costs a break: the line ends with the sentence when the width allows', () => {
  // proportional widths, roughly a serif's: narrow i l t f r, wide m w; this fit used to set "file. Scripts" on one line
  const W = { m: 0.85, w: 0.75, M: 0.9, W: 0.95, i: 0.28, l: 0.28, t: 0.32, f: 0.3, r: 0.36, j: 0.28, ' ': 0.24, '.': 0.24, s: 0.4, c: 0.42, e: 0.45 };
  const serif = (text, f) => ({ width: [...text].reduce((sum, ch) => sum + (W[ch] ?? 0.52), 0) * f.size, ascent: f.size * 0.8, descent: f.size * 0.2 });
  const l = fitText({ text: 'The model writes one small file. Scripts do the rest.', font: { family: 'x', size: 300, lineHeight: 1.1 }, maxWidth: 1100, measure: serif },
    { min: 72, max: 300, maxHeight: 691, maxLines: 4 });
  const lines = lineTexts(l);
  assert.ok(lines.every((line) => !/[.!?] \S/.test(line)), `no sentence ends mid-line: ${JSON.stringify(lines)}`);
  assert.deepEqual(lineTexts(layoutText({ text: 'One file. No server.', font, maxWidth: 5000, measure })), ['One file. No server.'], 'a line with room for both sentences keeps them');
});

test('words marked together stay on one line when a slightly smaller size allows: a highlight run is not broken', () => {
  const W = { m: 0.85, w: 0.75, M: 0.9, W: 0.95, i: 0.28, l: 0.28, t: 0.32, f: 0.3, r: 0.36, j: 0.28, ' ': 0.24, '.': 0.24, s: 0.4, c: 0.42, e: 0.45 };
  const serif = (text, f) => ({ width: [...text].reduce((sum, ch) => sum + (W[ch] ?? 0.52), 0) * f.size, ascent: f.size * 0.8, descent: f.size * 0.2 });
  const text = 'Built on your machine. Nothing leaves it.';
  // together[i]: keep word i with word i + 1 (Nothing, leaves, it. are the emphasised run)
  const together = [false, false, false, false, true, true, false];
  const fit = (extra) => fitText({ text, font: { family: 'x', size: 300, lineHeight: 1.1 }, maxWidth: 1000, measure: serif, ...extra }, { min: 72, max: 300, maxHeight: 691, maxLines: 4 });
  const kept = fit({ together });
  assert.ok(lineTexts(kept).includes('Nothing leaves it.'), `the run on one line: ${JSON.stringify(lineTexts(kept))}`);
  assert.ok(kept.size >= 0.85 * 160, `at most 15% smaller: ${kept.size}`);
  // the control (restored, look gate fix pass M1b): where the plain fit breaks a run, the mark is what keeps it whole.
  // The case above no longer shows that, since the one-word-line rule alone keeps "Nothing leaves it." together.
  const how = 'The model writes one small file and scripts do the rest.';
  const run = (l) => lineTexts(l).some((line) => line.includes('one small file'));
  const howFit = (extra) => fitText({ text: how, font: { family: 'x', size: 300, lineHeight: 1.1 }, maxWidth: 520, measure: serif, ...extra }, { min: 72, max: 300, maxHeight: 691, maxLines: 4 });
  assert.ok(!run(howFit({})), `without the mark the run breaks: ${JSON.stringify(lineTexts(howFit({})))}`);
  assert.ok(run(howFit({ together: [false, false, false, true, true, false, false, false, false, false, false] })), `with it the run stays whole: ${JSON.stringify(lineTexts(howFit({ together: [false, false, false, true, true] })))}`);
});

// ---- revision 2: no line of one word (E5) ----

const SERIF_W = { m: 0.85, w: 0.75, M: 0.9, W: 0.95, i: 0.28, l: 0.28, t: 0.32, f: 0.3, r: 0.36, j: 0.28, ' ': 0.24, '.': 0.24, s: 0.4, c: 0.42, e: 0.45 };
const serifMeasure = (text, f) => ({ width: [...text].reduce((sum, ch) => sum + (SERIF_W[ch] ?? 0.52), 0) * f.size, ascent: f.size * 0.8, descent: f.size * 0.2 });
const DESK_LIMITS = { min: 72, max: 300, maxHeight: 691, maxLines: 4 };
const serifFit = (text, maxWidth, extra = {}) => fitText({ text, font: { family: 'x', size: 300, lineHeight: 1.1 }, maxWidth, measure: serifMeasure, ...extra }, DESK_LIMITS);
// The largest size whose plain layout fits the box: what the fitter may give up at most 15% of.
function largestFit(text, maxWidth) {
  for (let size = DESK_LIMITS.max; size > DESK_LIMITS.min; size--) {
    const l = layoutText({ text, font: { family: 'x', size, lineHeight: 1.1 }, maxWidth, measure: serifMeasure });
    if (l.height <= DESK_LIMITS.maxHeight && l.lines.length <= DESK_LIMITS.maxLines && l.width <= maxWidth) return size;
  }
  return DESK_LIMITS.min;
}
const loneLines = (l) => l.lines.filter((line) => line.words.length === 1).map((line) => line.words[0].text);

test('the fitter avoids a line of one word, first, middle or last, when a layout up to 15% smaller has none', () => {
  const close = 'Built on your machine. Nothing leaves it.';
  const l = serifFit(close, 1000);
  assert.deepEqual(loneLines(l), [], `no one-word line: ${JSON.stringify(lineTexts(l))}`);
  assert.ok(lineTexts(l).every((line) => !/[.!?] \S/.test(line)), 'and still no sentence ending mid-line');
  assert.ok(l.size >= 0.85 * largestFit(close, 1000), `at most 15% smaller: ${l.size} of ${largestFit(close, 1000)}`);
  // the highlight run still stays on one line: that rule keeps its priority
  const kept = serifFit(close, 1000, { together: [false, false, false, false, true, true, false] });
  assert.ok(lineTexts(kept).includes('Nothing leaves it.'), `the run on one line: ${JSON.stringify(lineTexts(kept))}`);
  assert.deepEqual(loneLines(kept), []);
  // a one-word text has nothing to avoid
  assert.deepEqual(lineTexts(serifFit('Dashboards.', 1000)), ['Dashboards.']);
});

test('a short last sentence is not broken over two lines when it fits on one within 15%: "Scripts do the rest." stays whole', () => {
  const how = 'The model writes one small file. Scripts do the rest.';
  const l = serifFit(how, 1100);
  const lines = lineTexts(l);
  assert.equal(lines.at(-1), 'Scripts do the rest.', JSON.stringify(lines));
  assert.ok(lines.every((line) => !/[.!?] \S/.test(line)), `no sentence ends mid-line: ${JSON.stringify(lines)}`);
  assert.deepEqual(loneLines(l), []);
  assert.ok(l.size >= 0.85 * largestFit(how, 1100), `at most 15% smaller: ${l.size} of ${largestFit(how, 1100)}`);
});

test('breakBySense costs a one-word line anywhere, not only last: it takes a break of two two-word lines over one and three', () => {
  // at width 450 with a 50 space, [a][b c d] (slack 200 and 50) and [a b][c d] (slack 50 and 200) cost the same by
  // slack, and the first is found first; only a cost on the one-word line separates them
  const widths = [250, 100, 100, 100];
  const words = ['aaaa', 'bb', 'cc', 'dd.'];
  const rows = breakBySense(words, widths, 50, 450);
  assert.ok(rows.every((r) => r.length > 1), `no one-word line: ${JSON.stringify(rows)}`);
});

test('a separator dot never starts a line: the break falls after it', () => {
  const text = 'EVERY CHART SHOWS ITS QUERY · ILLUSTRATION';
  for (let maxWidth = 400; maxWidth <= 2200; maxWidth += 50) {
    const lines = lineTexts(layoutText({ text, font, maxWidth, measure }));
    assert.ok(lines.every((line) => !line.startsWith('·')), `${maxWidth}: ${JSON.stringify(lines)}`);
  }
});
