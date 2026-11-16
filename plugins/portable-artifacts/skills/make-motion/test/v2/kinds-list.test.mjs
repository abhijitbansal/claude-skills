// The list kind: points or numbered steps, one per sentence. Its timing (one item per sentence, else spread over the
// words, else equal intervals of the hold), the desk column (all arrived items on screen, earlier ones in ink2, figures
// hanging in the margin), the pop sequence (one item at a time as a stack under a count tag), its own review findings,
// fitting, `on` targets and a look with no data for it. Pure scene-graph work with a fake text measure.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { gridX } from '../../engine/looks/index.mjs';
import { listTimes } from '../../engine/kinds/list.mjs';
import { hitText } from '../../engine/kinds/list-pop.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';
import '../../engine/kinds/index.mjs';
import { EPS, filmOf, expandIn, expandShot, all, textNode, near, inside, plateBox, viralOf } from './helpers/kinds.mjs';

const EXAMPLE = () => structuredClone(registries.kinds.get('list').example);
const SAY3 = 'Write the film as JSON. Render it in one command. Share the MP4.';
const ITEMS3 = ['Write the film as JSON', 'Render it in one command', 'Share the MP4'];

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-list-')); writeFileSync(path.join(specDir, 'x.png'), 'x'); });
after(() => rmSync(specDir, { recursive: true, force: true }));

const errorsOf = (shot, mode = 'pro', extra = {}) => validateFilm({ version: 2, mode, shots: [shot], ...extra }, { specDir }).errors;
const opacity = (n, t) => (n.tracks.opacity === undefined ? 1 : sample(n.tracks.opacity, t, n.step));
const fillAt = (n, t) => sample(n.wordTracks[0].fill, t);

// ---- timing ----

test('list timing: one item per sentence when the counts match, the first on frame 0', () => {
  const { timing } = expandShot({ id: 'l', show: 'list', say: SAY3, items: ITEMS3 });
  assert.equal(timing.sentences.length, 3);
  const times = listTimes({ id: 'l', show: 'list', say: SAY3, items: ITEMS3 }, timing);
  assert.deepEqual(times, [0, timing.sentences[1].start, timing.sentences[2].start]);
});

test('list timing: with fewer sentences than items, the items are spread evenly over the spoken words', () => {
  const shot = { id: 'l', show: 'list', say: 'Three things matter here. Speed, cost and trust above all.', items: ['Speed', 'Cost', 'Trust', 'Scale'] };
  const { timing } = expandShot(shot);
  const words = timing.words;
  assert.equal(words.length, 10);
  // hand computed: item k lands on word round(k * 10 / 4): words 0, 3 (2.5 rounds to 3), 5, 8 (7.5 rounds to 8)
  assert.deepEqual(listTimes(shot, timing), [0, words[3].start, words[5].start, words[8].start]);
});

test('list timing: with hold and no say, items arrive at equal intervals from frame 0', () => {
  const shot = { id: 'l', show: 'list', hold: 4, items: ['One', 'Two', 'Three', 'Four'] };
  const { timing } = expandShot(shot);
  assert.deepEqual(listTimes(shot, timing), [0, 1, 2, 3]);
});

test('list timing: with fewer spoken words than items, items arrive at equal intervals of the shot, so none is lost', () => {
  const shot = { id: 'l', show: 'list', say: 'Three things.', items: ['Speed', 'Cost', 'Trust'] };
  const { timing } = expandShot(shot);
  assert.equal(timing.words.length, 2);
  const times = listTimes(shot, timing);
  times.forEach((t, k) => near(t, (k * timing.duration) / 3, `item ${k}`));
  const { nodes } = expandShot(shot, 'pop', '9:16');
  [0, 1, 2].forEach((k) => {
    const wrapper = all(nodes).find((n) => n.id === `l.item${k}`);
    assert.equal(opacity(wrapper, times[k] + 0.01), 1, `item ${k} is on screen at some time`);
  });
});

test('list: each arrival after the first is a device event named item for the cue plan, in shot seconds (item 0 rides the cut)', () => {
  const shot = { id: 'l', show: 'list', hold: 3, items: ['One', 'Two', 'Three'] };
  const { timing } = expandShot(shot);
  assert.deepEqual(registries.kinds.get('list').events(shot, timing), [
    { kind: 'device', device: 'item', t: 1 }, { kind: 'device', device: 'item', t: 2 },
  ]);
});

// ---- fields and support ----

test('list: the example validates in both looks; fields are items, title, numbered, style and hero', () => {
  assert.deepEqual(errorsOf(EXAMPLE()), []);
  assert.deepEqual(errorsOf(EXAMPLE(), 'viral'), []);
  assert.deepEqual(Object.keys(registries.kinds.get('list').schema.properties).sort(), ['hero', 'items', 'numbered', 'style', 'title']);
  assert.deepEqual(errorsOf({ id: 'l', show: 'list', hold: 3, items: ['A', { text: 'B', note: 'why' }], numbered: true }), []);
});

test('list: one item, a misspelt style, an unknown key in an item and an unknown shot key are refused with what to write', () => {
  const one = errorsOf({ id: 'l', show: 'list', hold: 3, items: ['Only'] });
  assert.ok(one.some((e) => e.path === 'shots[0].items' && /fewer than 2/.test(e.message)), JSON.stringify(one));
  const style = errorsOf({ id: 'l', show: 'list', hold: 3, items: ITEMS3, style: 'stpes' });
  assert.ok(style.some((e) => e.path === 'shots[0].style' && /did you mean "steps"/.test(e.message)), JSON.stringify(style));
  const note = errorsOf({ id: 'l', show: 'list', hold: 3, items: ['A', { text: 'B', nots: 'x' }] });
  assert.ok(note.some((e) => /did you mean "note"/.test(e.message)), JSON.stringify(note));
  const key = errorsOf({ id: 'l', show: 'list', hold: 3, items: ITEMS3, titel: 'x' });
  assert.ok(key.some((e) => e.path === 'shots[0].titel' && /did you mean "title"/.test(e.message)), JSON.stringify(key));
});

test('list: a look with no data for the kind refuses it, naming the looks that have it; expand says the same', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('test-no-list')) registries.looks.add('test-no-list', { ...desk, name: 'test-no-list', kinds: { end: desk.kinds.end } });
  assert.deepEqual(errorsOf(EXAMPLE(), 'pro', { look: 'test-no-list' }), [{ path: 'shots[0].show', message: 'kind "list" is not supported by look "test-no-list"; the looks that support it: desk, pop, cosmos' }]);
  assert.throws(() => expandIn(filmOf([EXAMPLE()], 'test-no-list')), /look "test-no-list" has no data for kind "list"/);
});

test('list: --list kinds shows the kind with its fields and example', () => {
  const entry = listEntries('kinds').find((e) => e.name === 'list');
  assert.ok(entry);
  assert.deepEqual(entry.example, EXAMPLE());
  assert.match(formatList('kinds', [entry]), /^list {2}/m);
});

// ---- desk ----

test('desk list at 16:9 (hand computed): items flush left on column 2 at 242, one size, the title on the slug; step figures hang in the margin centred on the items\' cap height, their ink ending a gutter before the items at 218', () => {
  const { nodes, ctx, canvas, hero } = expandShot(EXAMPLE(), 'desk', '16:9');
  const look = ctx.look;
  assert.equal(hero, 'how.items');
  const items = [0, 1, 2].map((k) => textNode(nodes, `how.item${k}`));
  const size = items[0].props.font.size;
  for (const item of items) {
    assert.equal(item.props.x, gridX(look, canvas, 2));
    assert.equal(item.props.x, 242);
    assert.equal(item.props.font.size, size, 'one size');
    assert.equal(item.props.font.family, look.fonts.display.family);
    assert.ok(item.props.layout.width <= gridX(look, canvas, 12) + (gridX(look, canvas, 12) - gridX(look, canvas, 11) - look.grid.gutter) - 242 + EPS, 'inside columns 2 to 11');
  }
  const slug = all(nodes).find((n) => n.id === 'how.slug');
  assert.ok(slug, 'the title is a slug');
  assert.deepEqual(textNode(slug.children, 'how.kicker').props.layout.lines.flatMap((l) => l.words.map((w) => w.text)), ['HOW', 'IT', 'WORKS']);
  for (const [k, item] of items.entries()) {
    const figure = textNode(nodes, `how.figure${k}`);
    assert.equal(figure.props.font.family, look.fonts.display.family, 'figures in the display serif (director\'s note)');
    assert.deepEqual(figure.props.layout.lines[0].words.map((w) => w.text), [String(k + 1)]);
    assert.equal(figure.props.font.size, item.props.font.size, 'a figure at its item\'s size');
    assert.equal(figure.props.stack, hero, 'a figure is one size class with the items');
    // one digit: the fake measure's ink ends 0.02 em before its 0.55 em advance (tracking runs only between glyphs)
    near(figure.props.x + 0.53 * figure.props.font.size, 218, `figure ${k} ink ends at 218`);
    near(figure.props.y + figure.props.layout.lines[0].y, item.props.y + item.props.layout.lines[0].y, `figure ${k} on the item's first baseline`);
  }
});

test('desk list: every arrived item is on screen, the current one in ink and earlier ones in ink2; later ones are not there yet', () => {
  const { nodes, ctx, timing } = expandShot(EXAMPLE(), 'desk', '16:9');
  const { ink, ink2 } = ctx.look.palette;
  const times = listTimes(EXAMPLE(), timing);
  const items = [0, 1, 2].map((k) => textNode(nodes, `how.item${k}`));
  near(opacity(items[0], 0), 1, 'the first item on frame 0');
  const mid = (times[1] + times[2]) / 2 + ctx.look.moves.emphasize.dur;
  assert.equal(opacity(items[0], mid), 1);
  assert.equal(opacity(items[1], mid), 1);
  assert.equal(opacity(items[2], mid), 0, 'not yet');
  assert.equal(fillAt(items[0], mid), ink2, 'earlier: ink2');
  assert.equal(fillAt(items[1], mid), ink, 'current: ink');
  const end = timing.duration;
  assert.deepEqual(items.map((n) => fillAt(n, end)), [ink2, ink2, ink], 'at the end the last is current');
  assert.equal(fillAt(textNode(nodes, 'how.figure0'), mid), ink2, 'its figure dims with it');
});

test('desk list: a list without numbering has no figures, and a note sits under its item in the text face', () => {
  const shot = { id: 'l', show: 'list', hold: 3, items: ['Fast', { text: 'Cheap', note: 'no server to run' }] };
  const { nodes, ctx } = expandShot(shot, 'desk', '16:9');
  assert.equal(all(nodes).filter((n) => n.id.startsWith('l.figure')).length, 0);
  const note = textNode(nodes, 'l.note1');
  const item = textNode(nodes, 'l.item1');
  assert.equal(note.props.font.family, ctx.look.fonts.text.family);
  assert.equal(note.props.fill, ctx.look.palette.ink2);
  assert.ok(item.props.font.size >= 3 * note.props.font.size - EPS);
  assert.ok(note.props.y + note.props.layout.lines[0].y > item.props.y + item.props.layout.lines.at(-1).y, 'under the item');
  near(opacity(note, 1.5), 1, 'arrives with its item, at 1.5 s (two items over a 3 s hold)');
  assert.ok(opacity(note, 1.5 - 0.6) < 1);
});

test('desk list at 9:16: items on columns 2 to 11 below the slug, inside the margins', () => {
  const { nodes, ctx, canvas, boxes } = expandShot(EXAMPLE(), 'desk', '9:16');
  const look = ctx.look;
  const slug = all(nodes).find((n) => n.id === 'how.slug');
  const items = [0, 1, 2].map((k) => textNode(nodes, `how.item${k}`));
  for (const item of items) assert.equal(item.props.x, gridX(look, canvas, 2));
  assert.ok(boxes['item:0'][1] > slug.props.y, 'the list starts under the slug');
  for (const k of [0, 1, 2]) inside(boxes[`item:${k}`], { left: look.grid.margin, top: look.grid.margin, right: look.grid.margin, bottom: look.grid.margin }, canvas, `item ${k}`);
});

test('desk list: items too long for the frame give the fit finding on an item and stay inside the frame', () => {
  const long = 'every one of these points is far too long to set at a reading size';
  const shot = { id: 'l', show: 'list', hold: 6, items: Array.from({ length: 6 }, () => long) };
  const { nodes, boxes, canvas } = expandShot(shot, 'desk', '16:9');
  const items = all(nodes).filter((n) => /^l\.item\d$/.test(n.id));
  assert.ok(items.some((n) => n.props.layout.overflow === true), 'a creative overflow finding');
  for (let k = 0; k < 6; k++) inside(boxes[`item:${k}`], { left: 0, top: 0, right: 0, bottom: 0 }, canvas, `item ${k}`);
});

// ---- pop ----

test('pop list: one item on screen at a time, the first on frame 0, each under a count tag "k / n"', () => {
  const { nodes, timing } = expandShot(EXAMPLE(), 'pop', '9:16');
  const times = listTimes(EXAMPLE(), timing);
  const wrappers = [0, 1, 2].map((k) => all(nodes).find((n) => n.id === `how.item${k}`));
  assert.equal(opacity(wrappers[0], 0), 1, 'item 0 on frame 0');
  assert.equal(opacity(wrappers[1], 0), 0);
  for (const [k, at] of times.entries()) {
    const t = at + 0.05;
    wrappers.forEach((w, j) => assert.equal(opacity(w, t), j === k ? 1 : 0, `at ${t}: item ${j}`));
  }
  wrappers.forEach((w, k) => {
    const tag = all(w.children).find((n) => n.id === `how.item${k}.kicker.text`);
    assert.deepEqual(tag.props.layout.lines[0].words.map((x) => x.text), ['STEP', String(k + 1), '/', '3']);
  });
});

test('pop list at 9:16: each item is a stack flush left in the safe zone; the title runs beside the count, judged like any text, a third of the stack or less', () => {
  const { nodes, canvas, ctx } = expandShot(EXAMPLE(), 'pop', '9:16');
  const insets = viralOf(canvas);
  const wrapper = all(nodes).find((n) => n.id === 'how.item1');
  const stack = wrapper.children.find((n) => n.id === 'how.item1.text');
  assert.equal(stack.type, 'group');
  for (const line of stack.children) {
    assert.equal(line.props.stack, 'how.item1.text');
    const word = line.props.layout.lines[0].words[0];
    near(line.props.x + line.props.layout.lines[0].x + word.x + 0.02 * line.props.font.size, insets.left, `${line.id} flush left`);
  }
  const head = textNode(wrapper.children, 'how.item1.title');
  assert.notEqual(head.props.furniture, true, 'on no card: not frame furniture');
  assert.ok(Math.max(...stack.children.map((n) => n.props.font.size)) >= 3 * head.props.font.size - EPS, 'the stack three times the head');
  assert.equal(head.props.fill, ctx.look.palette.ink2);
  const plate = plateBox(all(wrapper.children).find((n) => n.id === 'how.item1.kicker'));
  assert.ok(head.props.x > plate[0] + plate[2], 'beside the count tag');
  assert.ok(head.props.x + head.props.layout.width <= canvas.w - insets.right + EPS, 'inside the safe width');
});

test('pop list: a short item is broken over two lines as a hit, by sense, never leaving a short word alone', () => {
  assert.equal(hitText('EASY TO SHARE'), 'EASY| TO SHARE', 'before the preposition');
  assert.equal(hitText('WRITE THE FILM'), 'WRITE| THE FILM', 'no preposition: after the first word');
  assert.equal(hitText('THE BEST PART'), 'THE BEST| PART', 'a short first word is not left alone');
  assert.equal(hitText('RUN TO WIN'), 'RUN| TO WIN', 'the preposition rule comes first');
  assert.equal(hitText('FAST CHEAP'), 'FAST| CHEAP');
  assert.equal(hitText('SHIP IT'), 'SHIP IT', 'IT would stand alone');
  assert.equal(hitText('RENDER IT IN ONE COMMAND'), 'RENDER IT IN ONE COMMAND', 'four words or more: the stack breaks it');
  assert.equal(hitText('ONE | TWO THREE'), 'ONE | TWO THREE', 'the author broke it');
  const { nodes } = expandShot({ id: 'l', show: 'list', hold: 3, items: ['Fast to write', 'Easy'] }, 'pop', '9:16');
  const lines = all(nodes).find((n) => n.id === 'l.item0.text').children;
  assert.deepEqual(lines.map((n) => n.props.layout.lines[0].words.map((w) => w.text).join(' ')), ['FAST', 'TO WRITE']);
});

test('pop list: under a stack set small (long words), the running head steps down to scale step 1', () => {
  const shot = { id: 'l', show: 'list', hold: 4, title: 'Terms', items: ['Internationalisation', 'Accessibility'] };
  const { nodes, ctx } = expandShot(shot, 'pop', '9:16');
  const wrapper = all(nodes).find((n) => n.id === 'l.item0');
  const largest = Math.max(...wrapper.children.find((n) => n.id === 'l.item0.text').children.map((n) => n.props.font.size));
  assert.ok(largest < 3 * ctx.look.scale[1], `hand computed: a 20-letter word at the safe width is under ${3 * ctx.look.scale[1]} units (${largest})`);
  assert.equal(textNode(wrapper.children, 'l.item0.title').props.font.size, ctx.look.scale[0]);
});

test('pop list: points count "k / n"; a long item gives the fit finding and keeps inside the safe height', () => {
  // forty short words: some fourteen stack lines, which the 936 px between the 16:9 margins hold only under step 3
  const shot = { id: 'l', show: 'list', hold: 4, items: ['Speed', Array.from({ length: 40 }, () => 'go').join(' ')] };
  const { nodes, canvas, boxes, ctx } = expandShot(shot, 'pop', '16:9');
  const tag = all(nodes).find((n) => n.id === 'l.item0.kicker.text');
  assert.deepEqual(tag.props.layout.lines[0].words.map((x) => x.text), ['1', '/', '2']);
  const long = all(nodes).find((n) => n.id === 'l.item1.text');
  assert.ok(long.children.some((n) => n.props.layout.overflow === true), 'a creative overflow finding');
  const margin = ctx.look.grid.margin;
  const [, top, , h] = boxes['item:1'];
  const descent = 0.12 * long.children.at(-1).props.font.size; // a word box reaches 0.12 em under the baseline; caps ink does not
  assert.ok(top >= margin - EPS && top + h - descent <= canvas.h - margin + EPS, 'inside the margins');
});

test('pop list: a note sits under its item in the text face, in ink2, a third of the stack or less, inside the safe zone', () => {
  const shot = { id: 'l', show: 'list', hold: 4, items: ['Fast', { text: 'Cheap to run', note: 'no server at all' }] };
  const { nodes, canvas, ctx } = expandShot(shot, 'pop', '9:16');
  const wrapper = all(nodes).find((n) => n.id === 'l.item1');
  const note = textNode(wrapper.children, 'l.item1.note');
  const lines = wrapper.children.find((n) => n.id === 'l.item1.text').children;
  assert.equal(note.props.font.family, ctx.look.fonts.text.family);
  assert.equal(note.props.fill, ctx.look.palette.ink2);
  assert.ok(Math.max(...lines.map((n) => n.props.font.size)) >= 3 * note.props.font.size - EPS, 'the stack three times the note');
  const last = lines.at(-1);
  const noteCap = note.props.y + note.props.layout.lines[0].y - 0.7 * note.props.font.size;
  near(noteCap, last.props.y + last.props.layout.lines[0].y + 32, 'the note cap line 32 units under the stack');
  const insets = viralOf(canvas);
  assert.ok(note.props.y + note.props.layout.height <= canvas.h - insets.bottom + EPS, 'inside the safe zone');
});

// ---- targets, review, declarations ----

test('list: on targets are items and item:<n>; a device aimed at an item in pop goes inside that item, so it leaves with it', () => {
  const kind = registries.kinds.get('list');
  assert.deepEqual(kind.targets(EXAMPLE()), ['items', 'item:0', 'item:1', 'item:2']);
  const shot = { ...EXAMPLE(), on: [{ at: 'sentence:1', do: 'underline', target: 'item:1' }] };
  assert.deepEqual(errorsOf(shot, 'viral'), []);
  const { nodes } = expandShot(shot, 'pop', '9:16');
  const wrapper = all(nodes).find((n) => n.id === 'how.item1');
  assert.ok(all(wrapper.children).some((n) => n.id === 'how.on0'), 'inside item 1');
  assert.ok(!nodes.some((n) => n.id === 'how.on0'), 'not left on the frame');
  const desk = expandShot({ ...EXAMPLE(), on: [{ at: 'sentence:1', do: 'circle', target: 'item:1' }] }, 'desk', '16:9');
  assert.ok(all(desk.nodes).some((n) => n.id === 'how.on0'));
  const bad = errorsOf({ ...EXAMPLE(), on: [{ at: 'start', do: 'circle', target: 'item:3' }] });
  assert.ok(bad.some((e) => /unknown target "item:3"/.test(e.message)), JSON.stringify(bad));
});

test('list review: more than 6 items says split the list; an item over 12 words says cut words; a list within both is quiet', () => {
  const kind = registries.kinds.get('list');
  const { timing } = expandShot({ id: 'l', show: 'list', hold: 7, items: Array.from({ length: 7 }, (_, k) => `Point ${k}`) });
  const seven = kind.review({ id: 'l', show: 'list', hold: 7, items: Array.from({ length: 7 }, (_, k) => `Point ${k}`) }, { look: registries.looks.get('desk'), timing });
  assert.deepEqual(seven, [{ path: 'items', at: 0, message: '7 items is more than a list holds; split the list (6 at most)' }]);
  const wordy = { id: 'l', show: 'list', hold: 2, items: ['Short', { text: 'one two three four five six seven eight nine ten eleven twelve thirteen' }] };
  const t2 = expandShot(wordy).timing;
  assert.deepEqual(kind.review(wordy, { look: registries.looks.get('desk'), timing: t2 }), [{ path: 'items[1]', at: 1, message: 'item 1 has 13 words; cut words (12 at most)' }]);
  assert.deepEqual(kind.review(EXAMPLE(), { look: registries.looks.get('desk'), timing: expandShot(EXAMPLE()).timing }), []);
  assert.deepEqual(errorsOf({ id: 'l', show: 'list', hold: 7, items: Array.from({ length: 7 }, (_, k) => `Point ${k}`) }), [], 'seven validate: the review, not the validator, judges length');
});

test('list: declares itself numbered (the slug counts it), shows its words, one hero id', () => {
  const kind = registries.kinds.get('list');
  assert.equal(kind.numbered, true);
  assert.equal(kind.showsWords, true);
  assert.equal(kind.heroTarget, 'items');
  assert.deepEqual(kind.ids(EXAMPLE()), ['how.items']);
});
