// The end kind: the closing card. Fields and their validation, the desk card composition (title hero on column 2, the
// ask under it in the text face, the mark on a taped card bottom right) and the pop stack (the mark as a tag, the title
// lines fitted to the safe width, the ask as the last line in the accent), words arriving with the narration, and a
// look that has no data for the kind. Pure scene-graph work with a fake text measure (helpers/kinds.mjs).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { gridX, kindSupportProblems } from '../../engine/looks/index.mjs';
import { createRegistry } from '../../engine/registry.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';
import { STACK } from '../../engine/kinds/stack.mjs';
import '../../engine/kinds/index.mjs';
import { EPS, filmOf, expandIn, expandShot, all, textNode, near, inside, overlaps, plateBox, viralOf } from './helpers/kinds.mjs';

const EXAMPLE = () => structuredClone(registries.kinds.get('end').example);
const CAP = 0.7;

let specDir;
before(() => {
  specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-end-'));
  writeFileSync(path.join(specDir, 'shot.png'), 'x');
});
after(() => rmSync(specDir, { recursive: true, force: true }));

const errorsOf = (shot, mode = 'pro', extra = {}) => validateFilm({ version: 2, mode, shots: [shot], ...extra }, { specDir }).errors;

// The unturned box of a card group's paper (its path is about the group's centre), in canvas pixels.
function paperBox(group) {
  const paper = group.children.find((n) => n.id.endsWith('.paper'));
  const nums = paper.props.d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
  return [group.props.x + Math.min(...xs), group.props.y + Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// A text node's ink as the fake measure reports it: capitals and ascenders 0.74 em over the baseline, 0.02 em in.
function lineInk(n, k = 0) {
  const { layout, font } = n.props;
  const line = layout.lines[k];
  const last = line.words.at(-1);
  const track = (font.tracking ?? 0) * font.size;
  return {
    left: n.props.x + line.x + line.words[0].x + 0.02 * font.size,
    right: n.props.x + line.x + last.x + [...last.text].length * 0.55 * font.size - 0.02 * font.size + track * ([...last.text].length - 1),
    baseline: n.props.y + line.y,
  };
}

// ---- fields ----

test('end: the example validates in both looks, and its fields are title, ask, mark, src and hero', () => {
  assert.deepEqual(errorsOf(EXAMPLE()), []);
  assert.deepEqual(errorsOf(EXAMPLE(), 'viral'), []);
  const props = Object.keys(registries.kinds.get('end').schema.properties);
  assert.deepEqual(props.sort(), ['ask', 'hero', 'mark', 'src', 'title']);
});

test('end: an unknown key gets a did-you-mean, a src outside the film folder is refused, and a shot with no words to close on is refused', () => {
  const typo = errorsOf({ ...EXAMPLE(), titel: 'Done.' });
  assert.ok(typo.some((e) => e.path === 'shots[0].titel' && /did you mean "title"/.test(e.message)), JSON.stringify(typo));
  const outside = errorsOf({ ...EXAMPLE(), src: '../logo.png' });
  assert.ok(outside.some((e) => e.path === 'shots[0].src' && /outside the spec folder/.test(e.message)), JSON.stringify(outside));
  assert.deepEqual(errorsOf({ ...EXAMPLE(), src: 'shot.png' }), [], 'a picture inside the folder is fine');
  const silent = errorsOf({ id: 'e', show: 'end', hold: 3, ask: 'Start today' });
  assert.ok(silent.some((e) => e.path === 'shots[0].title' && /needs a closing line/.test(e.message)), JSON.stringify(silent));
});

test('end: a look with no data for the kind refuses it, naming the looks that have it; expand says the same', () => {
  const stub = { name: 'stub', kinds: {} };
  const looks = createRegistry('look');
  looks.add('a', { name: 'a', kinds: { end: {} } });
  looks.add('stub', stub);
  looks.add('b', { name: 'b', kinds: { end: {}, list: {} } });
  assert.deepEqual(kindSupportProblems('end', stub, looks), [{ path: 'show', message: 'kind "end" is not supported by look "stub"; the looks that support it: a, b' }]);
  assert.deepEqual(kindSupportProblems('end', looks.get('a'), looks), []);
  assert.deepEqual(kindSupportProblems('end', null, looks), [], 'no look (an unknown one has its own error): nothing to add');
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('test-no-end')) registries.looks.add('test-no-end', { ...desk, name: 'test-no-end', kinds: {} });
  const errors = errorsOf(EXAMPLE(), 'pro', { look: 'test-no-end' });
  assert.deepEqual(errors, [{ path: 'shots[0].show', message: 'kind "end" is not supported by look "test-no-end"; the looks that support it: desk, pop' }]);
  assert.throws(() => expandIn(filmOf([EXAMPLE()], 'test-no-end')), /look "test-no-end" has no data for kind "end"/);
});

test('end: --list kinds shows the kind with its fields and its example', () => {
  const entry = listEntries('kinds').find((e) => e.name === 'end');
  assert.ok(entry, 'listed');
  assert.ok(entry.summary.length > 0);
  assert.deepEqual(entry.fields.map((f) => f.name).sort(), ['ask', 'hero', 'mark', 'src', 'title']);
  assert.deepEqual(entry.example, EXAMPLE());
  assert.match(formatList('kinds', [entry]), /^end {2}/m);
});

// ---- desk ----

test('desk end at 16:9 (hand computed): title flush left on column 2 at 242, the ask under it in the text face 0.42 em of the title below its last baseline, the block centred at 540, the mark on a card whose right edge is 1678 and bottom 984, turned -3 degrees', () => {
  const { nodes, ctx, canvas, hero } = expandShot(EXAMPLE(), 'desk', '16:9');
  const look = ctx.look;
  assert.equal(hero, 'close.title');
  const title = textNode(nodes, 'close.title');
  assert.equal(title.props.role, 'hero');
  assert.equal(title.props.font.family, look.fonts.display.family);
  const size = title.props.font.size;
  assert.ok(size >= look.scale[3] && size <= 300, `title size ${size}`);
  assert.equal(title.props.x, gridX(look, canvas, 2));
  assert.equal(title.props.x, 242);
  const ask = textNode(nodes, 'close.ask');
  assert.equal(ask.props.font.family, look.fonts.label.family, 'the ask in the label face (look revision 1)');
  const askSize = ask.props.font.size;
  near(askSize, size / 3, 'the ask a third of the title (director\'s note)');
  assert.ok(size >= 3 * askSize - EPS, 'the title is at least three times the ask');
  assert.equal(ask.props.x, 242);
  const titleLast = title.props.y + title.props.layout.lines.at(-1).y;
  near(ask.props.y + ask.props.layout.lines[0].y - CAP * askSize, titleLast + 0.42 * size, 'ask cap line');
  const top = title.props.y + title.props.layout.lines[0].y - CAP * size;
  const bottom = ask.props.y + ask.props.layout.lines.at(-1).y;
  near((top + bottom) / 2, 540, 'block centred on the height');
  const card = all(nodes).find((n) => n.id === 'close.mark');
  assert.equal(card.props.rotate, -3);
  assert.equal(card.props.fixed, true, 'pinned to the frame');
  const box = paperBox(card);
  assert.ok(Math.abs(box[0] + box[2] - 1678) <= 2, `card right edge ${box[0] + box[2]}`);
  assert.ok(Math.abs(box[1] + box[3] - 984) <= 2, `card bottom ${box[1] + box[3]}`);
  const mark = textNode(card.children, 'close.mark.text');
  assert.equal(mark.props.font.family, look.fonts.label.family, 'the mark in the label face');
  assert.ok([look.scale[0], look.scale[1]].includes(mark.props.font.size), `at a label step: ${mark.props.font.size}`);
  assert.deepEqual(mark.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)), ['MAKE-MOTION']);
  const block = [242, top, 1386 - 242, bottom - top];
  assert.ok(!overlaps(block, box), 'the title block stays off the card');
});

test('desk end at 9:16: title on columns 2 to 11, the ask under it, the card bottom right inside the margins', () => {
  const { nodes, ctx, canvas, boxes } = expandShot(EXAMPLE(), 'desk', '9:16');
  const look = ctx.look;
  const title = textNode(nodes, 'close.title');
  assert.equal(title.props.x, gridX(look, canvas, 2));
  assert.ok(title.props.layout.width <= gridX(look, canvas, 12) + (gridX(look, canvas, 12) - gridX(look, canvas, 11) - look.grid.gutter) - gridX(look, canvas, 2) + EPS);
  const card = all(nodes).find((n) => n.id === 'close.mark');
  const box = paperBox(card);
  assert.ok(Math.abs(box[0] + box[2] - (canvas.w - gridX(look, canvas, 2))) <= 2);
  assert.ok(Math.abs(box[1] + box[3] - (canvas.h - look.grid.margin)) <= 2);
  assert.ok(!overlaps(boxes.title, box) && !overlaps(boxes.ask, box), 'the text stays off the card');
});

test('desk end: the mark is not frame furniture: it is judged by the hero and size rules, the frame reading title, then ask, then mark', () => {
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(EXAMPLE(), 'desk', format);
    const heroes = all(nodes).filter((n) => n.type === 'text' && n.props.role === 'hero');
    assert.deepEqual(heroes.map((n) => n.id), ['close.title'], format);
    const mark = textNode(nodes, 'close.mark.text');
    assert.notEqual(mark.props.furniture, true, 'not furniture');
    assert.notEqual(mark.props.role, 'hero');
    const title = textNode(nodes, 'close.title'), ask = textNode(nodes, 'close.ask');
    assert.ok(title.props.font.size >= 3 * mark.props.font.size - EPS, `${format}: title three times the mark`);
    assert.ok(mark.props.font.size <= ask.props.font.size + EPS, `${format}: the mark never above the ask`);
    const paper = all(nodes).find((n) => n.id === 'close.mark.paper');
    assert.equal(paper.props.textCard, true, 'the review keeps other texts off the card');
  }
});

test('desk end: a picture sits on the card where the mark would, at most a sixth of the short side, over the mark', () => {
  const { nodes, canvas } = expandShot({ ...EXAMPLE(), src: 'shot.png' }, 'desk', '16:9');
  const card = all(nodes).find((n) => n.id === 'close.mark');
  const picture = card.children.find((n) => n.type === 'image');
  assert.equal(picture.props.src, 'shot.png');
  const short = Math.min(canvas.w, canvas.h);
  assert.ok(Math.max(picture.props.w, picture.props.h) <= short / 6 + EPS, `picture ${picture.props.w}x${picture.props.h}`);
  near(picture.props.w / picture.props.h, 1600 / 1000, 'the aspect is kept');
  const mark = textNode(card.children, 'close.mark.text');
  assert.ok(mark.props.y + mark.props.layout.lines[0].y - CAP * mark.props.font.size >= picture.props.y + picture.props.h - EPS, 'the mark under the picture');
});

// ---- pop ----

test('pop end at 16:9: the mark a tag over the stack, the title lines flush left on 72 at two sizes inside 1848, the ask an accent tag 40 units under the title (look revision 2), the block centred on 540', () => {
  const { nodes, ctx, boxes } = expandShot(EXAMPLE(), 'pop', '16:9');
  const look = ctx.look;
  const group = nodes.find((n) => n.id === 'close.title');
  assert.equal(group.type, 'group');
  const lines = group.children;
  const tag = nodes.find((n) => n.id === 'close.kicker');
  const plate = plateBox(tag);
  const small = Math.min(...lines.map((m) => m.props.font.size));
  for (const line of lines) {
    const ink = lineInk(line);
    assert.ok(Math.abs(ink.left - 72) <= 1, `${line.id} flush left at ${ink.left}`);
    assert.ok(ink.right <= 1848 + 1, `${line.id} inside the columns`);
    assert.ok(Math.abs(line.props.font.size - small) < 1e-6 || Math.abs(line.props.font.size - small * look.stack.ratio) < 1e-6, `${line.id}: one of two sizes`);
    assert.equal(line.props.stack, 'close.title');
  }
  const askPlate = all(nodes).find((n) => n.id === 'close.ask.plate');
  assert.equal(askPlate.props.fill, look.palette.accent, 'the ask on an accent plate');
  near(boxes.ask[0], 72, 'the ask flush left');
  const lastBaseline = lineInk(lines.at(-1)).baseline;
  assert.ok(boxes.ask[1] >= lastBaseline + 40 - 1, 'the ask 40 units or more under the last baseline');
  near(plate[0], 72, 'the tag flush left');
  const firstTop = lineInk(lines[0]).baseline - 0.74 * lines[0].props.font.size;
  near(firstTop - (plate[1] + plate[3]), STACK.kickerGap, 'the tag over the first line');
  assert.ok(Math.abs((plate[1] + boxes.ask[1] + boxes.ask[3]) / 2 - 540) < 40, 'the block centred in the available height, near 540');
});

test('pop end at 9:16 stays inside the platform safe zone', () => {
  const { nodes, canvas, boxes } = expandShot(EXAMPLE(), 'pop', '9:16');
  const insets = viralOf(canvas);
  for (const target of ['title', 'ask', 'mark']) inside(boxes[target], insets, canvas, target);
  const group = nodes.find((n) => n.id === 'close.title');
  assert.ok(group.children.every((n) => n.props.layout.overflow === false), 'every line fits');
});

test('pop end: the mark is a tag, never a second hero; every hero text is a line of the one stack', () => {
  const { nodes } = expandShot(EXAMPLE(), 'pop', '9:16');
  const heroes = all(nodes).filter((n) => n.type === 'text' && n.props.role === 'hero');
  assert.ok(heroes.length >= 2);
  assert.ok(heroes.every((n) => n.props.stack === 'close.title'));
  const tagText = all(nodes).find((n) => n.id === 'close.kicker.text');
  assert.equal(tagText.props.role, 'tag');
});

test('pop end: a picture takes the place over the stack, at most a sixth of the short side, flush left', () => {
  const { nodes, canvas } = expandShot({ ...EXAMPLE(), src: 'shot.png' }, 'pop', '9:16');
  const group = nodes.find((n) => n.id === 'close.picture');
  const image = group.children[0];
  assert.equal(image.type, 'image');
  const box = [group.props.x + image.props.x, group.props.y + image.props.y, image.props.w, image.props.h];
  const insets = viralOf(canvas);
  assert.ok(Math.max(box[2], box[3]) <= 1080 / 6 + EPS);
  near(box[0], insets.left, 'flush left on the stack edge');
  const tag = nodes.find((n) => n.id === 'close.kicker');
  near(plateBox(tag)[1] - (box[1] + box[3]), STACK.kickerGap, 'over the mark tag by the tag gap');
  inside(box, insets, canvas, 'picture');
});

// ---- words ----

test('end: the title words arrive with the narration and the first is on screen on frame 0; the ask lands after the last title word', () => {
  const { nodes, timing } = expandShot(EXAMPLE(), 'desk', '16:9');
  const title = textNode(nodes, 'close.title');
  const tracks = title.wordTracks;
  assert.equal(tracks.length, timing.words.length);
  near(sample(tracks[0].opacity, 0), 1, 'first word on frame 0');
  tracks.forEach((tr, i) => {
    if (i === 0) return;
    near(sample(tr.opacity, timing.words[i].start), 1, `word ${i} landed on its spoken start`);
    assert.ok(sample(tr.opacity, timing.words[i].start - 0.3) < 1, `word ${i} not there before`);
  });
  const ask = textNode(nodes, 'close.ask');
  const lastWord = timing.words.at(-1).start;
  const landed = ask.tracks.opacity.points.at(-1).t;
  assert.ok(landed > lastWord, `the ask lands after the last word: ${landed} vs ${lastWord}`);
  assert.ok(landed <= timing.duration, 'inside the shot');
});

test('end: an ask that is spoken lands on its first spoken word', () => {
  const shot = { id: 'close', show: 'end', say: 'Every number has a source. Start today.', title: 'Every number has a source.', ask: 'Start today' };
  const { nodes, timing } = expandShot(shot, 'desk', '16:9');
  const ask = textNode(nodes, 'close.ask');
  const start = timing.words.find((w) => w.text === 'Start').start;
  near(ask.tracks.opacity.points.at(-1).t, start, 'lands on "Start"');
});

test('pop end in viral: every title word is a ghost from frame 0 and lights as it is spoken', () => {
  const { nodes, timing, ctx } = expandShot(EXAMPLE(), 'pop', '9:16');
  const group = nodes.find((n) => n.id === 'close.title');
  const words = group.children.filter((n) => n.id !== 'close.title.ask').flatMap((n) => n.wordTracks);
  assert.equal(words.length, timing.words.length);
  words.forEach((tr, i) => {
    assert.ok(tr.fill, `word ${i} has a ghost fill`);
    assert.equal(sample(tr.fill, timing.words[i].start + ctx.look.moves.emphasize.dur + EPS), ctx.look.palette.ink, `word ${i} lit when spoken`);
  });
});

test('end: with hold and no say, the title words arrive from frame 0 and the ask lands inside the shot', () => {
  const { nodes, timing } = expandShot({ id: 'close', show: 'end', hold: 3, title: 'That is the film.', ask: 'Start today' }, 'desk', '16:9');
  const title = textNode(nodes, 'close.title');
  near(sample(title.wordTracks[0].opacity, 0), 1, 'first word on frame 0');
  const ask = textNode(nodes, 'close.ask');
  assert.ok(ask.tracks.opacity.points.at(-1).t < timing.duration);
});

// ---- targets and review ----

test('end: targets are the title, its words, the ask and the mark; an on event lands on them', () => {
  const kind = registries.kinds.get('end');
  assert.deepEqual(kind.targets(EXAMPLE()), ['title', 'word:0', 'word:1', 'word:2', 'word:3', 'word:4', 'ask', 'mark']);
  assert.deepEqual(kind.targets({ id: 'e', show: 'end', title: 'Done.' }), ['title', 'word:0']);
  const shot = { ...EXAMPLE(), on: [{ at: 'word:source', do: 'underline', target: 'word:4' }] };
  assert.deepEqual(errorsOf(shot), []);
  const { nodes } = expandShot(shot, 'desk', '16:9');
  assert.ok(all(nodes).some((n) => n.id === 'close.on0'), 'the device is built');
  const bad = errorsOf({ ...EXAMPLE(), on: [{ at: 'start', do: 'circle', target: 'item:0' }] });
  assert.ok(bad.some((e) => /unknown target "item:0"/.test(e.message)), JSON.stringify(bad));
});

test('end: emphasis in the say is not drawn on an end card, so the review says to drop it', () => {
  const kind = registries.kinds.get('end');
  const findings = kind.review({ ...EXAMPLE(), say: 'Every number, with its *source*.' }, { look: registries.looks.get('desk') });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].path, 'say');
  assert.equal(findings[0].at, 0);
  assert.match(findings[0].message, /not drawn on an end card/);
  assert.deepEqual(kind.review(EXAMPLE(), { look: registries.looks.get('desk') }), []);
});

test('end: declares itself: not numbered (no slug), shows its words (never captioned), one hero id', () => {
  const kind = registries.kinds.get('end');
  assert.notEqual(kind.numbered, true);
  assert.equal(kind.showsWords, true);
  assert.deepEqual(kind.srcFields, ['src']);
  assert.equal(kind.heroTarget, 'title');
  assert.deepEqual(kind.ids(EXAMPLE()), ['close.title']);
  assert.deepEqual(kind.ids({ ...EXAMPLE(), hero: 'last' }), ['last']);
});

test('end: a title too long for the frame is a fit (overflow) problem on the title, never silent; the pop stack keeps its height inside the safe zone', () => {
  const long = { id: 'close', show: 'end', hold: 4, title: 'Every single number on every single dashboard should always come with its own source attached', ask: 'Start today' };
  const desk = expandShot(long, 'desk', '16:9');
  assert.equal(textNode(desk.nodes, 'close.title').props.layout.overflow, true, 'desk: the review reports it as a creative overflow');
  const pop = expandShot(long, 'pop', '9:16');
  const lines = pop.nodes.find((n) => n.id === 'close.title').children;
  // look revision 2: the taller band may hold it; a line under the stack floor still says so
  const floor = pop.ctx.look.scale[2];
  assert.ok(lines.every((n) => n.props.font.size >= floor - EPS || n.props.layout.overflow === true), 'pop: a line set under the stack floor says so');
  const insets = viralOf(pop.canvas);
  inside(pop.boxes.ask, insets, pop.canvas, 'pop ask');
  const [, top, , h] = pop.boxes.title;
  assert.ok(top >= insets.top - EPS && top + h <= pop.canvas.h - insets.bottom + EPS, 'the stack fits the safe height');
});
