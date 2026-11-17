// The quote kind: a quotation on a tilted paper card with a hanging opening mark and the attribution after a short rule
// (desk), or a stack behind a giant accent opening mark with the attribution as a tag (pop); an optional portrait as a
// cut-out that never covers text. Pure scene-graph work with a fake text measure (helpers/kinds.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { quoteBody, OPEN_MARK, CLOSE_MARK } from '../../engine/kinds/quote.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import '../../engine/kinds/index.mjs';
import { EPS, filmOf, expandIn, expandShot, all, textNode, near, inside, overlaps, plateBox, viralOf } from './helpers/kinds.mjs';

const EXAMPLE = () => structuredClone(registries.kinds.get('quote').example);
const FORTY = 'We did not set out to build a video tool, we set out to make every number in a report carry its own source, so that anyone reading it could check the figure, open the query and see the rows.';

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-quote-')); writeFileSync(path.join(specDir, 'shot.png'), 'x'); });
after(() => rmSync(specDir, { recursive: true, force: true }));

const errorsOf = (shot, mode = 'pro', extra = {}) => validateFilm({ version: 2, mode, shots: [shot], ...extra }, { specDir }).errors;
const wordsOf = (n) => n.props.layout.lines.flatMap((l) => l.words.map((w) => w.text));
const boxOfPath = (n, dx = 0, dy = 0) => {
  const pts = pathPoints(n.props.d);
  const xs = pts.map((p) => p[0] + (n.props.x ?? 0) + dx), ys = pts.map((p) => p[1] + (n.props.y ?? 0) + dy);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
// A text's box in its parent's space: each line from its cap line (0.74 em ink) to its baseline, over its words.
const textBox = (n) => {
  const { layout, font } = n.props;
  const lefts = layout.lines.map((l) => n.props.x + l.x), rights = layout.lines.map((l) => n.props.x + l.x + l.width);
  const top = n.props.y + layout.lines[0].y - 0.74 * font.size, bottom = n.props.y + layout.lines.at(-1).y + 0.22 * font.size;
  return [Math.min(...lefts), top, Math.max(...rights) - Math.min(...lefts), bottom - top];
};

// ---- fields and the marks ----

test('quote: the example validates in both looks; fields are text, by, role, src and hero; --list kinds shows it', () => {
  assert.deepEqual(errorsOf(EXAMPLE()), []);
  assert.deepEqual(errorsOf(EXAMPLE(), 'viral'), []);
  assert.deepEqual(Object.keys(registries.kinds.get('quote').schema.properties).sort(), ['by', 'hero', 'role', 'src', 'text']);
  assert.ok(listEntries('kinds').some((e) => e.name === 'quote'));
  const typo = errorsOf({ ...EXAMPLE(), bye: 'x' });
  assert.ok(typo.some((e) => /did you mean "by"/.test(e.message)), JSON.stringify(typo));
  const outside = errorsOf({ ...EXAMPLE(), src: '../face.png' });
  assert.ok(outside.some((e) => e.path === 'shots[0].src' && /outside the spec folder/.test(e.message)));
  const silent = errorsOf({ id: 'q', show: 'quote', hold: 3, by: 'Someone' });
  assert.ok(silent.some((e) => e.path === 'shots[0].text' && /needs words to quote/.test(e.message)), JSON.stringify(silent));
});

test('quote: the marks are the kind\'s own, added once: marks the author typed are taken off first', () => {
  for (const typed of ['"Show your work."', '“Show your work.”', '\'Show your work.\'', '«Show your work.»', 'Show your work.']) {
    assert.equal(quoteBody(typed), 'Show your work.', typed);
  }
  const { nodes } = expandShot({ id: 'q', show: 'quote', hold: 3, text: '"Show your work."', by: 'A reader' }, 'desk', '16:9');
  const words = wordsOf(textNode(nodes, 'q.text'));
  assert.deepEqual(words, [`${OPEN_MARK}Show`, 'your', `work.${CLOSE_MARK}`], 'the marks ride on the first and last word');
  const pop = expandShot({ id: 'q', show: 'quote', hold: 3, text: '"Show your work."', by: 'A reader' }, 'pop', '9:16');
  const stack = pop.nodes.find((n) => n.id === 'q.text');
  const popWords = stack.children.flatMap((n) => wordsOf(n));
  assert.ok(popWords.every((w) => !/["“”]/.test(w)), `pop draws the opener as a glyph, not in the words: ${popWords}`);
});

test('quote: a look with no data for the kind refuses it; expand says so', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('test-no-quote')) registries.looks.add('test-no-quote', { ...desk, name: 'test-no-quote', kinds: {} });
  assert.deepEqual(errorsOf(EXAMPLE(), 'pro', { look: 'test-no-quote' }), [{ path: 'shots[0].show', message: 'kind "quote" is not supported by look "test-no-quote"; the looks that support it: desk, pop, cosmos, ledger' }]);
  assert.throws(() => expandIn(filmOf([EXAMPLE()], 'test-no-quote')), /look "test-no-quote" has no data for kind "quote"/);
});

// ---- desk ----

test('desk quote at 16:9 (hand computed): a taped card from column 2 (242) wrapped to its text, slightly tilted, the quotation in on the paper with its opening mark hanging into the padding', () => {
  const { nodes, ctx, hero } = expandShot(EXAMPLE(), 'desk', '16:9');
  const card = nodes.find((n) => n.id === hero);
  assert.equal(hero, 'voice.card');
  assert.ok(Math.abs(card.props.rotate ?? 0) <= 1.5 + EPS && (card.props.rotate ?? 0) !== 0, `slight tilt: ${card.props.rotate}`);
  const paper = card.children.find((n) => n.id === 'voice.card.paper');
  const [px, , pw] = boxOfPath(paper);
  assert.ok(Math.abs(card.props.x + px - 242) <= 3, `paper left on column 2: ${card.props.x + px}`);
  const quote = textNode(card.children, 'voice.text');
  assert.equal(quote.props.role, 'hero');
  assert.equal(quote.props.font.family, ctx.look.fonts.display.family);
  // the text edge is 64 units in, or the opening mark's advance at the largest size (220) plus 16 when that is more: the
  // fake measure's mark is 0.55 em less 0.01 em of tracking, 118.8 px, so 134.8
  const edge = 134.8;
  assert.ok(Math.abs(quote.props.x - (-pw / 2 + edge)) <= 3, `text ${edge} units in from the paper edge: ${quote.props.x} vs ${-pw / 2 + edge}`);
  const content = Math.max(...quote.props.layout.lines.map((l) => l.x + l.width));
  assert.ok(Math.abs(pw - (edge + content + 64)) <= 3, `the card wraps its longest line and 64 units: ${pw} vs ${edge + content + 64}`);
  assert.ok(pw <= 1290 + 3, 'never wider than columns 2 to 10');
  const lines = quote.props.layout.lines;
  const opener = ctx.measure(OPEN_MARK, quote.props.font).width + quote.props.font.tracking * quote.props.font.size;
  near(lines[0].x, -opener, 'the first line starts its opening mark\'s advance left of the edge: the mark hangs');
  assert.ok(lines.slice(1).every((l) => l.x === 0), 'every other line on the edge');
  assert.ok(quote.props.x + lines[0].x >= px + EPS, 'the hanging mark stays on the paper');
});

test('desk quote: the attribution sits under the quotation in label caps after a short rule, 0.45 em of the quotation below its last baseline, a third of its size or less', () => {
  const { nodes, ctx, hero } = expandShot({ ...EXAMPLE(), role: 'house rule' }, 'desk', '16:9');
  const card = nodes.find((n) => n.id === hero);
  const quote = textNode(card.children, 'voice.text');
  const by = textNode(card.children, 'voice.by');
  const rule = card.children.find((n) => n.id === 'voice.rule');
  assert.equal(by.props.font.family, ctx.look.fonts.label.family);
  assert.equal(by.props.role, 'label');
  assert.deepEqual(wordsOf(by), ['THE', 'DATA', 'DESK', '·', 'HOUSE', 'RULE']);
  assert.ok(quote.props.font.size >= 3 * by.props.font.size - EPS);
  const size = quote.props.font.size;
  const capLine = by.props.y + by.props.layout.lines[0].y - 0.7 * by.props.font.size;
  near(capLine, quote.props.y + quote.props.layout.lines.at(-1).y + 0.45 * size, 'cap line 0.45 em under the quotation');
  const [rx, ry, rw, rh] = boxOfPath(rule);
  near(rx, quote.props.x, 'the rule starts on the text edge');
  assert.ok(rw > rh * 8, 'a short horizontal rule');
  assert.ok(by.props.x >= rx + rw - EPS, 'the label after the rule');
  assert.ok(ry >= capLine - EPS && ry + rh <= capLine + 0.7 * by.props.font.size + EPS, 'the rule within the label\'s cap height');
});

test('desk quote: the words arrive with the narration, the first on frame 0; the attribution lands after the last word', () => {
  const { nodes, timing, hero } = expandShot(EXAMPLE(), 'desk', '16:9');
  const card = nodes.find((n) => n.id === hero);
  const quote = textNode(card.children, 'voice.text');
  near(sample(quote.wordTracks[0].opacity, 0), 1, 'first word on frame 0');
  quote.wordTracks.slice(1).forEach((tr, i) => near(sample(tr.opacity, timing.words[i + 1].start), 1, `word ${i + 1}`));
  const by = textNode(card.children, 'voice.by');
  assert.ok(by.tracks.opacity.points.at(-1).t > timing.words.at(-1).start);
});

test('desk quote: an emphasised run gets the highlighter behind its words on the card, and the text says how many lines a run spans', () => {
  const { nodes, hero } = expandShot({ ...EXAMPLE(), say: 'Every chart should *show its work*.' }, 'desk', '16:9');
  const card = nodes.find((n) => n.id === hero);
  const ids = card.children.map((n) => n.id);
  const band = ids.findIndex((id) => id.startsWith('voice.hl'));
  assert.ok(band >= 0, 'a highlight band');
  assert.ok(band < ids.indexOf('voice.text'), 'drawn under the quotation');
  assert.ok(textNode(card.children, 'voice.text').props.highlightLines >= 1);
});

test('desk quote with a portrait: a cut-out over the card\'s top right corner that never covers the quotation or the attribution, inside the frame', () => {
  for (const format of ['16:9', '9:16']) {
    const { nodes, hero, canvas } = expandShot({ ...EXAMPLE(), src: 'shot.png' }, 'desk', format);
    const card = nodes.find((n) => n.id === hero);
    const portrait = nodes.find((n) => n.id === 'voice.portrait');
    assert.ok(portrait, `${format}: a portrait`);
    assert.ok(nodes.indexOf(portrait) > nodes.indexOf(card), 'over the card');
    const keyline = portrait.children.find((n) => n.id.endsWith('.keyline'));
    const pbox = boxOfPath(keyline, portrait.props.x, portrait.props.y);
    const paper = boxOfPath(card.children.find((n) => n.id === 'voice.card.paper'), card.props.x, card.props.y);
    assert.ok(overlaps(pbox, paper), `${format}: it overlaps the card`);
    assert.ok(pbox[0] + pbox[2] > paper[0] + paper[2] && pbox[1] < paper[1], `${format}: at its top right corner`);
    for (const id of ['voice.text', 'voice.by']) {
      const t = textBox(textNode(card.children, id));
      const local = [t[0] + card.props.x, t[1] + card.props.y, t[2], t[3]];
      const clear = 24; // a gutter: room for the tilt of the card and of the cut-out
      assert.ok(!overlaps([pbox[0] - clear, pbox[1] - clear, pbox[2] + 2 * clear, pbox[3] + 2 * clear], local), `${format}: ${id} is clear of the portrait`);
    }
    inside(pbox, { left: 0, top: 0, right: 0, bottom: 0 }, canvas, `${format} portrait`);
  }
});

test('desk quote at 9:16: the card from column 1, inside the margins; the quotation broken by sense with no line of one word', () => {
  const { nodes, hero, canvas, ctx } = expandShot(EXAMPLE(), 'desk', '9:16');
  const card = nodes.find((n) => n.id === hero);
  const lines = textNode(card.children, 'voice.text').props.layout.lines;
  assert.ok(lines.every((l) => l.words.length > 1), `no one-word line: ${lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' / ')}`);
  const paper = boxOfPath(card.children.find((n) => n.id === 'voice.card.paper'), card.props.x, card.props.y);
  assert.ok(Math.abs(paper[0] - gridX(ctx.look, canvas, 1)) <= 3, `left on column 1: ${paper[0]}`);
  const m = ctx.look.grid.margin;
  inside(paper, { left: m - 3, top: m - 3, right: m - 3, bottom: m - 3 }, canvas, 'paper'); // the hand corners jitter 1.5 units
});

test('a 40-word quotation fits or says so: desk sets it whole on the card inside the frame or flags the fit, pop keeps its stack in the safe zone', () => {
  const shot = { id: 'q', show: 'quote', hold: 8, text: FORTY, by: 'A founder' };
  assert.equal(FORTY.split(/\s+/).length, 40);
  const desk = expandShot(shot, 'desk', '16:9');
  const card = desk.nodes.find((n) => n.id === desk.hero);
  const quote = textNode(card.children, 'q.text');
  const paper = boxOfPath(card.children.find((n) => n.id === 'q.card.paper'), card.props.x, card.props.y);
  assert.ok(quote.props.layout.overflow === true || (paper[1] >= -EPS && paper[1] + paper[3] <= desk.canvas.h + EPS), 'fits the frame or flags it');
  const pop = expandShot(shot, 'pop', '9:16');
  const lines = pop.nodes.find((n) => n.id === 'q.text').children;
  const insets = viralOf(pop.canvas);
  const top = Math.min(...lines.map((n) => n.props.y + n.props.layout.lines[0].y - 0.74 * n.props.font.size));
  const bottom = Math.max(...lines.map((n) => n.props.y + n.props.layout.lines[0].y));
  assert.ok(lines.some((n) => n.props.layout.overflow) || (top >= insets.top - EPS && bottom <= pop.canvas.h - insets.bottom + EPS), 'pop fits or flags');
});

// ---- pop ----

test('pop quote at 16:9: the opening mark stays inside the margins when the stack fills the height', () => {
  const { nodes, ctx } = expandShot(EXAMPLE(), 'pop', '16:9');
  const mark = boxOfPath(nodes.find((n) => n.id === 'voice.mark'));
  const margin = ctx.look.grid.margin;
  assert.ok(mark[1] >= margin - 1, `mark top ${mark[1]} under the top margin ${margin}`);
});

test('pop quote at 9:16: a stack flush left in the safe zone, the opening mark a giant accent shape over the first line, the attribution a tag under it', () => {
  const { nodes, ctx, canvas, boxes } = expandShot(EXAMPLE(), 'pop', '9:16');
  const insets = viralOf(canvas);
  const stack = nodes.find((n) => n.id === 'voice.text');
  const mark = nodes.find((n) => n.id === 'voice.mark');
  assert.equal(mark.type, 'path');
  assert.equal(mark.props.fill, ctx.look.palette.accent);
  assert.ok(nodes.indexOf(mark) < nodes.indexOf(stack), 'drawn behind the stack');
  const markBox = boxOfPath(mark);
  const first = stack.children[0];
  const firstSize = first.props.font.size;
  assert.ok(markBox[3] >= firstSize * 0.7, `giant: ${markBox[3]} tall against a ${firstSize} line`);
  assert.ok(Math.abs(markBox[0] - insets.left) <= 2, `flush left on the stack edge: ${markBox[0]}`);
  const firstInk = boxes['word:0'];
  assert.ok(!overlaps(markBox, firstInk) && markBox[1] + markBox[3] <= firstInk[1] + 1e-6, 'clear above the first line, never over it (look revision 1)');
  const lineInk = [insets.left, first.props.y + first.props.layout.lines[0].y - 0.74 * firstSize, 1, 0.74 * firstSize];
  assert.ok(markBox[1] < lineInk[1], 'it rises above the first line');
  assert.ok(markBox[1] + markBox[3] < lineInk[1] + lineInk[3], 'it never holds the whole first line (the line\'s ground stays the field)');
  const tag = nodes.find((n) => n.id === 'voice.by');
  const plate = plateBox(tag);
  const last = stack.children.at(-1);
  assert.ok(plate[1] > last.props.y + last.props.layout.lines[0].y, 'the tag under the stack');
  near(plate[0], insets.left, 'flush left');
  assert.equal(all([tag]).find((n) => n.type === 'text').props.role, 'tag');
  inside(plate, insets, canvas, 'tag');
});

test('pop quote: emphasis turns a word to the accent; in viral the words are ghosts lit as spoken', () => {
  const { nodes, timing, ctx } = expandShot({ ...EXAMPLE(), say: 'Every chart should *show* its work.' }, 'pop', '9:16');
  const words = nodes.find((n) => n.id === 'voice.text').children.flatMap((n) => n.wordTracks);
  const k = timing.words.findIndex((w) => w.emphasis);
  assert.equal(sample(words[k].fill, timing.words[k].start + ctx.look.moves.emphasize.dur + EPS), ctx.look.palette.accent);
  assert.equal(sample(words[0].fill, timing.words[0].start + ctx.look.moves.emphasize.dur + EPS), ctx.look.palette.ink);
});

test('pop quote with a portrait: a cut-out beside the opening mark, over the first line and off it, inside the safe zone; the stack still fits', () => {
  const { nodes, canvas } = expandShot({ ...EXAMPLE(), role: 'house rule', src: 'shot.png' }, 'pop', '9:16');
  const insets = viralOf(canvas);
  const portrait = nodes.find((n) => n.id === 'voice.portrait');
  const keyline = portrait.children.find((n) => n.id.endsWith('.keyline'));
  const pbox = boxOfPath(keyline, portrait.props.x, portrait.props.y);
  inside(pbox, insets, canvas, 'portrait');
  const mark = boxOfPath(nodes.find((n) => n.id === 'voice.mark'));
  assert.ok(pbox[0] >= mark[0] + mark[2] - EPS, 'beside the mark');
  const lines = nodes.find((n) => n.id === 'voice.text').children;
  const first = lines[0];
  assert.ok(pbox[1] + pbox[3] <= first.props.y + first.props.layout.lines[0].y - 0.74 * first.props.font.size + EPS, 'over the first line, never on it');
  assert.ok(lines.every((n) => !n.props.layout.overflow), 'the stack still fits at its own sizes');
});

test('desk quote: a highlight from on is drawn over the card (a band under it would be hidden by the paper)', () => {
  const shot = { ...EXAMPLE(), on: [{ at: 'word:show', do: 'highlight', target: 'word:3' }] };
  assert.deepEqual(errorsOf(shot), []);
  const { nodes, hero } = expandShot(shot, 'desk', '16:9');
  const band = nodes.findIndex((n) => n.id.startsWith('voice.on0'));
  assert.ok(band > nodes.findIndex((n) => n.id === hero), 'after the card group');
});

test('desk quote: the card is on screen on frame 0 (a card shot after a hard cut never opens on the field)', () => {
  const { nodes, hero } = expandShot(EXAMPLE(), 'desk', '16:9');
  const card = nodes.find((n) => n.id === hero);
  assert.equal(sample(card.tracks.opacity, 0), 1);
});

test('desk quote: an attribution too long for one line puts the role on its own line and drops the separator', () => {
  const shot = { ...EXAMPLE(), by: 'The data desk of a large newsroom', role: 'house rule since the first edition' };
  const { nodes, hero } = expandShot(shot, 'desk', '9:16');
  const by = textNode(nodes.find((n) => n.id === hero).children, 'voice.by');
  const lines = by.props.layout.lines.map((l) => l.words.map((w) => w.text).join(' '));
  assert.ok(lines.length >= 2);
  assert.ok(!lines.join(' ').includes('·'), `no separator: ${lines}`);
  assert.ok(lines.some((l) => l.startsWith('HOUSE')), `the role starts a line: ${lines}`);
});

test('quote marks: only a matched outer pair is taken off; apostrophes at either end stay; a mark before trailing punctuation never doubles', () => {
  assert.equal(quoteBody('"Ship it"'), 'Ship it');
  assert.equal(quoteBody('\u201cShip it\u201d'), 'Ship it');
  assert.equal(quoteBody("'Ship it'"), 'Ship it');
  assert.equal(quoteBody('"Ship it".'), 'Ship it.');
  assert.equal(quoteBody('\u201cShip it\u201d!'), 'Ship it!');
  assert.equal(quoteBody("Hear the players'"), "Hear the players'");
  assert.equal(quoteBody("'Tis the season"), "'Tis the season");
  assert.equal(quoteBody('\u201990s were loud'), '\u201990s were loud');
});

// ---- targets and declarations ----

test('quote: targets are the text, its words and the attribution; declarations', () => {
  const kind = registries.kinds.get('quote');
  assert.deepEqual(kind.targets(EXAMPLE()), ['text', 'word:0', 'word:1', 'word:2', 'word:3', 'word:4', 'word:5', 'by']);
  assert.equal(kind.showsWords, true);
  assert.notEqual(kind.numbered, true);
  assert.deepEqual(kind.srcFields, ['src']);
  assert.equal(kind.heroTarget, 'text');
  const shot = { ...EXAMPLE(), on: [{ at: 'word:show', do: 'underline', target: 'word:3' }] };
  assert.deepEqual(errorsOf(shot), []);
  assert.ok(all(expandShot(shot, 'desk', '16:9').nodes).some((n) => n.id === 'voice.on0'));
});
