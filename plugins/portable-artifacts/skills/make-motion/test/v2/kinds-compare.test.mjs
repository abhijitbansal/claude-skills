// The compare kind: two sides, options or before and after. Its turn (the right side arrives with the second sentence,
// else the narration's midpoint), the desk cards side by side (stacked at 9:16) with the unspoken side dimmed under a
// paper scrim and a hand-drawn vs or an arrow between them, the pop sides one at a time under A / B or BEFORE / AFTER
// tags, values set as numerals with neither styled as better, and its validation. Pure scene-graph work.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registries } from '../../engine/registry.mjs';
import { sample } from '../../engine/time/track.mjs';
import { compareTurn, valueText } from '../../engine/kinds/compare.mjs';
import { stackArea } from '../../engine/kinds/stack.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { pathPoints } from '../../engine/devices/shared.mjs';
import { srcsOfShot } from '../../engine/assets.mjs';
import '../../engine/kinds/index.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { shotContext } from '../../engine/graph/film.mjs';
import { EPS, FPS, IMAGES, filmOf, expandIn, expandShot, all, textNode, inside, viralOf, canvasOf, measure } from './helpers/kinds.mjs';

const EXAMPLE = () => structuredClone(registries.kinds.get('compare').example);
const SAY2 = 'Before, you ran a server. After, you share one file.';
const SIDES = (extra = {}) => ({
  id: 'c', show: 'compare', say: SAY2,
  left: { title: 'A server', points: ['Deploys', 'Logins', 'Bills'] }, right: { title: 'One file' }, ...extra,
});

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-compare-')); writeFileSync(path.join(specDir, 'shot.png'), 'x'); });
after(() => rmSync(specDir, { recursive: true, force: true }));

const errorsOf = (shot, mode = 'pro', extra = {}) => validateFilm({ version: 2, mode, shots: [shot], ...extra }, { specDir }).errors;
const opacity = (n, t) => (n.tracks?.opacity === undefined ? 1 : sample(n.tracks.opacity, t, n.step));
const paperOf = (card) => {
  const paper = card.children.find((n) => n.id === `${card.id}.paper`);
  const pts = pathPoints(paper.props.d);
  const xs = pts.map((p) => p[0] + card.props.x), ys = pts.map((p) => p[1] + card.props.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const cardsOf = (nodes) => {
  const sides = nodes.find((n) => n.id === 'c.sides');
  return { left: sides.children.find((n) => n.id === 'c.left'), right: sides.children.find((n) => n.id === 'c.right') };
};

// ---- timing ----

test('compare turn: the right side arrives with the second sentence; with one sentence at the narration\'s midpoint; with a hold at half of it; always inside the shot', () => {
  const two = expandShot(SIDES());
  assert.equal(compareTurn(two.timing), two.timing.sentences[1].start);
  const one = expandShot(SIDES({ say: 'A server against one file you can share anywhere.' }));
  assert.equal(one.timing.sentences.length, 1);
  // hand computed: 9 words, the midpoint word is round(9 / 2) = 5 ("file")
  assert.equal(compareTurn(one.timing), one.timing.words[5].start);
  const hold = expandShot(SIDES({ say: undefined, hold: 4 }));
  assert.equal(compareTurn(hold.timing), 2);
  const word = expandShot(SIDES({ say: 'Compare.' }));
  const t = compareTurn(word.timing);
  assert.ok(t > 0 && t < word.timing.duration, `one word: ${t} inside ${word.timing.duration}`);
  for (const r of [two, one, hold]) { const turn = compareTurn(r.timing); assert.ok(turn > 0 && turn < r.timing.duration); }
});

// ---- fields ----

test('compare: the example validates in both looks; a side missing its title, and a value on one side only are each refused with what to write', () => {
  assert.deepEqual(errorsOf(EXAMPLE()), []);
  assert.deepEqual(errorsOf(EXAMPLE(), 'viral'), []);
  assert.ok(listEntries('kinds').some((e) => e.name === 'compare'));
  const untitled = errorsOf(SIDES({ right: { points: ['x'] } }));
  assert.ok(untitled.some((e) => e.path === 'shots[0].right.title' && /required/.test(e.message)), JSON.stringify(untitled));
  const lopsided = errorsOf(SIDES({ left: { title: 'A', value: 3 } }));
  assert.ok(lopsided.some((e) => e.path === 'shots[0].left.value' && /both sides or neither/.test(e.message)), JSON.stringify(lopsided));
  const four = errorsOf(SIDES({ left: { title: 'A', points: ['1', '2', '3', '4'] } }));
  assert.ok(four.some((e) => /left\.points/.test(e.path)), JSON.stringify(four));
  const mode = errorsOf(SIDES({ mode: 'befor-after' }));
  assert.ok(mode.some((e) => e.path === 'shots[0].mode' && /did you mean "before-after"/.test(e.message)), JSON.stringify(mode));
});

test('compare: a look with no data for the kind refuses it; expand says so', () => {
  const desk = registries.looks.get('desk');
  if (!registries.looks.has('test-no-compare')) registries.looks.add('test-no-compare', { ...desk, name: 'test-no-compare', kinds: {} });
  assert.deepEqual(errorsOf(EXAMPLE(), 'pro', { look: 'test-no-compare' }), [{ path: 'shots[0].show', message: 'kind "compare" is not supported by look "test-no-compare"; the looks that support it: desk, pop, cosmos' }]);
  assert.throws(() => expandIn(filmOf([EXAMPLE()], 'test-no-compare')), /look "test-no-compare" has no data for kind "compare"/);
});

test('compare values: numbers as numerals with grouping and their own decimals, strings as written', () => {
  assert.equal(valueText(1234567), '1,234,567');
  assert.equal(valueText(-5), '-5');
  assert.equal(valueText(0), '0');
  assert.equal(valueText(3.25), '3.25');
  assert.equal(valueText(0.5), '0.5');
  assert.equal(valueText('2 days'), '2 days');
});

// ---- desk ----

test('desk compare at 16:9: two cards side by side on the grid, the same size and height, inside the margins, unequal content balanced (three points against none)', () => {
  const { nodes, canvas, ctx } = expandShot(SIDES(), 'desk', '16:9');
  const { left, right } = cardsOf(nodes);
  const a = paperOf(left), b = paperOf(right);
  assert.ok(a[0] + a[2] < b[0], 'left before right');
  assert.ok(Math.abs(a[2] - b[2]) <= 4 && Math.abs(a[3] - b[3]) <= 4, `same size: ${a} vs ${b}`);
  assert.ok(Math.abs(a[1] - b[1]) <= 4, 'same top');
  const m = ctx.look.grid.margin;
  for (const box of [a, b]) inside(box, { left: m - 4, top: m - 4, right: m - 4, bottom: m - 4 }, canvas, 'card');
  const lt = textNode(left.children, 'c.left.title'), rt = textNode(right.children, 'c.right.title');
  assert.equal(lt.props.font.size, rt.props.font.size, 'both titles at one size');
  assert.equal(lt.props.role, 'hero');
  const points = textNode(left.children, 'c.left.points');
  assert.ok(lt.props.font.size >= 2 * points.props.font.size - EPS, 'titles twice the points (look revision 2: one size class with them)');
  assert.equal(points.props.stack, lt.props.stack, 'title and points one size class');
  assert.equal(all(right.children).filter((n) => n.id === 'c.right.points').length, 0, 'no points on the right');
});

test('desk compare at 9:16: the cards stacked, left over right, on one column span, inside the margins', () => {
  const { nodes, canvas, ctx } = expandShot(SIDES(), 'desk', '9:16');
  const { left, right } = cardsOf(nodes);
  const a = paperOf(left), b = paperOf(right);
  assert.ok(a[1] + a[3] < b[1], 'left over right');
  assert.ok(Math.abs(a[0] - b[0]) <= 4 && Math.abs(a[2] - b[2]) <= 4, 'one column span');
  const m = ctx.look.grid.margin;
  for (const box of [a, b]) inside(box, { left: m - 4, top: m - 4, right: m - 4, bottom: m - 4 }, canvas, 'card');
});

test('desk compare: both cards on the paper from frame 0, the left in full ink and the right under a paper scrim until the turn; then the left goes under it and the right comes out (look revision 1)', () => {
  const { nodes, timing, ctx } = expandShot(SIDES(), 'desk', '16:9');
  const turn = compareTurn(timing);
  const { left, right } = cardsOf(nodes);
  const lt = textNode(left.children, 'c.left.title');
  assert.equal(opacity(lt, 0), 1, 'the left title on frame 0');
  assert.equal(opacity(right, 0.05), 1, 'the right card on the paper from the start');
  const scrim = left.children.find((n) => n.id.endsWith('.scrim'));
  assert.ok(scrim, 'a scrim over the left card');
  assert.equal(scrim.props.fill, ctx.look.palette.paper, 'a paper scrim');
  assert.ok(left.children.indexOf(scrim) > left.children.indexOf(lt), 'drawn over its text');
  assert.equal(opacity(scrim, turn - 0.01), 0, 'clear before the turn');
  assert.equal(scrim.tracks.opacity.points.at(-1).v, ctx.look.devices.focus.dim, 'dimmed to the look\'s focus dim');
  assert.equal(opacity(left, 0), 1, 'the left card itself is on screen on frame 0');
  const lifted = right.children.find((n) => n.id.endsWith('.scrim'));
  assert.equal(opacity(lifted, 0.05), ctx.look.devices.focus.dim, 'the unspoken right side dimmed before the turn');
  assert.equal(lifted.tracks.opacity.points.at(-1).v, 0, 'and clear once spoken');
});

test('desk compare: versus draws a hand vs between the cards at the turn; before-after draws an arrow from left to right, in both formats', () => {
  for (const format of ['16:9', '9:16']) {
    const vs = expandShot(SIDES(), 'desk', format);
    const mark = all(vs.nodes).filter((n) => n.id.startsWith('c.vs'));
    assert.ok(mark.length > 0, `${format}: a vs mark`);
    const turn = compareTurn(vs.timing);
    assert.equal(sample(mark[0].tracks.draw, turn - 0.01, mark[0].step), 0, `${format}: drawn from the turn`);
    const { left, right } = cardsOf(vs.nodes);
    const box = mark.map((n) => pathPoints(n.props.d)).flat();
    const cx = box.reduce((s, p) => s + p[0], 0) / box.length, cy = box.reduce((s, p) => s + p[1], 0) / box.length;
    const a = paperOf(left), b = paperOf(right);
    if (format === '16:9') assert.ok(cx > a[0] + a[2] - 60 && cx < b[0] + 60, `vs between the cards across: ${cx}`);
    else assert.ok(cy > a[1] + a[3] - 60 && cy < b[1] + 60, `vs between the cards down: ${cy}`);
    const ba = expandShot(SIDES({ mode: 'before-after' }), 'desk', format);
    assert.ok(all(ba.nodes).some((n) => n.id === 'c.arrow'), `${format}: an arrow`);
    assert.ok(!all(ba.nodes).some((n) => n.id.startsWith('c.vs')), `${format}: no vs`);
  }
});

test('desk compare: values on both sides are numerals at one size and one colour, neither styled as better', () => {
  const { nodes } = expandShot(SIDES({ left: { title: 'Server', value: 1200 }, right: { title: 'File', value: 0 } }), 'desk', '16:9');
  const { left, right } = cardsOf(nodes);
  const a = textNode(left.children, 'c.left.value'), b = textNode(right.children, 'c.right.value');
  assert.deepEqual(a.props.layout.lines[0].words.map((w) => w.text).join(''), '1,200');
  assert.deepEqual(b.props.layout.lines[0].words.map((w) => w.text).join(''), '0');
  assert.equal(a.props.font.size, b.props.font.size);
  assert.equal(a.props.fill, b.props.fill);
  assert.equal(a.props.font.family, b.props.font.family);
  // under a numeral the title is the second voice, and the points stay at most half the title
  const title = textNode(left.children, 'c.left.title');
  assert.ok(title.props.font.size <= 0.55 * a.props.font.size + EPS, `title ${title.props.font.size} under ${a.props.font.size}`);
  const two = expandShot(SIDES({ left: { title: 'Server', value: 1200, points: ['Per seat'] }, right: { title: 'File', value: 0 } }), 'desk', '16:9');
  const l2 = cardsOf(two.nodes).left;
  assert.ok(textNode(l2.children, 'c.left.title').props.font.size >= 2 * textNode(l2.children, 'c.left.points').props.font.size - EPS, 'points at most half the title');
});

test('desk compare: a one-word side against a thirty-word title keeps both cards inside the frame and one title size, or flags the fit', () => {
  const long = 'a much longer title that goes on and on about everything this option promises to do for anyone who picks it today and tomorrow';
  const { nodes, canvas } = expandShot(SIDES({ left: { title: 'Fast' }, right: { title: long.slice(0, 60) } }), 'desk', '16:9');
  const { left, right } = cardsOf(nodes);
  const lt = textNode(left.children, 'c.left.title'), rt = textNode(right.children, 'c.right.title');
  assert.equal(lt.props.font.size, rt.props.font.size);
  for (const card of [left, right]) {
    const box = paperOf(card);
    assert.ok(rt.props.layout.overflow === true || (box[1] >= -EPS && box[1] + box[3] <= canvas.h + EPS), 'inside the frame or flagged');
  }
});

// ---- pop ----

test('pop compare on a wide frame: one side at a time, a hard cut at the turn; each a stack with its title as the hero under an A / B tag (BEFORE / AFTER for before-after); both seen', () => {
  for (const [mode, tags] of [['versus', [['OPTION', 'A'], ['OPTION', 'B']]], ['before-after', [['BEFORE'], ['AFTER']]]]) {
    const { nodes, timing, canvas, ctx } = expandShot(SIDES({ mode }), 'pop', '16:9'); // a tall frame shows both (look revision 1)
    const turn = compareTurn(timing);
    const left = all(nodes).find((n) => n.id === 'c.left'), right = all(nodes).find((n) => n.id === 'c.right');
    assert.equal(opacity(left, 0), 1, `${mode}: left on frame 0`);
    assert.equal(opacity(right, 0), 0);
    assert.equal(opacity(left, turn), 0, `${mode}: hard cut`);
    assert.equal(opacity(right, turn), 1);
    [left, right].forEach((side, k) => {
      const tag = all(side.children).find((n) => n.id === `${side.id}.kicker.text`);
      assert.deepEqual(tag.props.layout.lines.flatMap((l) => l.words.map((w) => w.text)), tags[k]); // OPTION A / B since look revision 2
      const stack = side.children.find((n) => n.id === `${side.id}.title`);
      assert.ok(stack.children.every((n) => n.props.role === 'hero' && n.props.stack === `${side.id}.title`));
    });
    const edge = stackArea(ctx).left;
    const stack = left.children.find((n) => n.id === 'c.left.title');
    for (const line of stack.children) {
      const word = line.props.layout.lines[0].words[0];
      assert.ok(Math.abs(line.props.x + word.x + 0.02 * line.props.font.size - edge) <= 1, 'flush left on the stack edge');
    }
  }
});

test('pop compare: points sit under the stack in the text face, a third of it or less; the value is a numeral line of its own under the title', () => {
  const { nodes, ctx } = expandShot(SIDES({ left: { title: 'Server', value: 1200, points: ['Deploys'] }, right: { title: 'File', value: 3 } }), 'pop', '9:16');
  const left = all(nodes).find((n) => n.id === 'c.left');
  const stack = left.children.find((n) => n.id === 'c.left.title');
  const value = textNode(left.children, 'c.left.value');
  assert.equal(value.props.layout.lines[0].words.map((w) => w.text).join(''), '1,200', 'the value under the title');
  const lowest = Math.max(...stack.children.map((n) => n.props.y + n.props.layout.lines[0].y));
  assert.ok(value.props.y + value.props.layout.lines[0].y > lowest, 'under the stack');
  const points = textNode(left.children, 'c.left.points');
  assert.equal(points.props.font.family, ctx.look.fonts.text.family);
  assert.ok(Math.max(...stack.children.map((n) => n.props.font.size)) >= 3 * points.props.font.size - EPS);
});

// ---- targets ----

test('desk compare: titles break by sense, never leaving one word alone on a line when a smaller size avoids it', () => {
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(SIDES({ left: { title: 'A server' }, right: { title: 'One file' } }), 'desk', format);
    for (const card of Object.values(cardsOf(nodes))) {
      const lines = textNode(card.children, `${card.id}.title`).props.layout.lines;
      assert.ok(lines.length < 2 || lines.every((l) => l.words.length > 1), `${format} ${card.id}: ${lines.map((l) => l.words.map((w) => w.text).join(' ')).join(' / ')}`);
    }
  }
});

test('compare values: a number longer than 9 characters as set, or a longer string, is refused at its side\'s value', () => {
  const big = errorsOf(SIDES({ left: { title: 'A', value: 999999999999999 }, right: { title: 'B', value: 1 } }));
  assert.ok(big.some((e) => e.path === 'shots[0].left.value' && e.message.includes('999,999,999,999,999')), JSON.stringify(big));
  const text = errorsOf(SIDES({ left: { title: 'A', value: 'sixteen chars ok' }, right: { title: 'B', value: 1 } }));
  assert.ok(text.some((e) => e.path === 'shots[0].left.value'), JSON.stringify(text));
  assert.deepEqual(errorsOf(SIDES({ left: { title: 'A', value: 1200000 }, right: { title: 'B', value: '12 months' } })), []);
});

test('desk compare: a value is never set past its own card, in both formats, even where the face sets it wide', () => {
  // a face twice as wide as the fake one: nine characters no longer fit a 16:9 card at step 4
  const wide = (text, font) => { const m = measure(text, font); return { ...m, width: 2 * m.width, inkRight: 2 * m.inkRight }; };
  for (const format of ['16:9', '9:16']) {
    const film = filmOf([SIDES({ left: { title: 'A', value: -9999999 }, right: { title: 'B', value: 'WWWWWWWWW' } })], 'desk', format);
    const canvas = canvasOf(format);
    const ctx = shotContext({ film, index: 0, timeline: buildTimeline(film, { fps: FPS }), canvas, measure: wide, assets: IMAGES, viralInsets: viralOf(canvas) });
    const { nodes } = registries.kinds.get('compare').expand(film.shots[0], ctx);
    for (const card of Object.values(cardsOf(nodes))) {
      const value = textNode(card.children, `${card.id}.value`);
      const right = card.props.x + value.props.x + Math.max(...value.props.layout.lines.map((l) => l.x + l.width));
      const paper = paperOf(card);
      assert.ok(right <= paper[0] + paper[2] + EPS, `${format}: ${value.id} ends at ${right}, the card at ${paper[0] + paper[2]}`);
    }
  }
});

test('compare sounds its turn: one device event named turn when the second side arrives, declared in eventDevices', () => {
  const kind = registries.kinds.get('compare');
  assert.deepEqual(kind.eventDevices, ['turn']);
  const { timing } = expandShot(SIDES(), 'desk', '16:9');
  assert.deepEqual(kind.events(SIDES(), timing), [{ kind: 'device', device: 'turn', t: compareTurn(timing) }]);
});

test('compare pictures: a side\'s src is a picture field (srcFields left.src, right.src): inside the film folder it validates, outside it is refused at its own path', () => {
  assert.deepEqual(registries.kinds.get('compare').srcFields, ['left.src', 'right.src']);
  assert.deepEqual(srcsOfShot(SIDES({ left: { title: 'A', src: 'a.png' }, right: { title: 'B', src: 'b.png' } }), ['left.src', 'right.src']), ['a.png', 'b.png']);
  assert.deepEqual(errorsOf(SIDES({ left: { title: 'A', src: 'shot.png' }, right: { title: 'B', src: 'shot.png' } })), []);
  const outside = errorsOf(SIDES({ right: { title: 'B', src: '../secret.png' } }));
  assert.ok(outside.some((e) => e.path === 'shots[0].right.src' && /outside|escape|inside/i.test(e.message)), JSON.stringify(outside));
  const missing = errorsOf(SIDES({ left: { title: 'A', src: 'nope.png' } }));
  assert.ok(missing.some((e) => e.path === 'shots[0].left.src'), JSON.stringify(missing));
});

test('compare pictures are drawn on their side: desk inside the card above the text, pop inside the side above its stack, inside the frame', () => {
  const shot = SIDES({ left: { title: 'A server', src: 'shot.png' }, right: { title: 'One file', src: 'shot.png' } });
  for (const format of ['16:9', '9:16']) {
    const { nodes } = expandShot(shot, 'desk', format);
    for (const card of Object.values(cardsOf(nodes))) {
      const image = all(card.children).find((n) => n.type === 'image');
      assert.ok(image, `${format}: ${card.id} has its picture`);
      const title = textNode(card.children, `${card.id}.title`);
      assert.ok(image.props.y + image.props.h / 2 <= title.props.y + title.props.layout.lines[0].y - 0.74 * title.props.font.size + EPS, `${format}: ${card.id} picture above the title`);
    }
    const pop = expandShot(shot, 'pop', format);
    for (const side of ['left', 'right']) {
      const wrapper = all(pop.nodes).find((n) => n.id === `c.${side}`);
      assert.ok(all([wrapper]).some((n) => n.type === 'image'), `pop ${format}: ${side} has its picture`);
      const cutout = all([wrapper]).find((n) => n.id === `c.${side}.src`);
      const from = side === 'left' ? 0 : compareTurn(pop.timing);
      assert.equal(cutout.tracks?.opacity === undefined ? 1 : sample(cutout.tracks.opacity, from), 1, `pop ${format}: ${side} picture whole when its side shows`);
    }
  }
});

test('compare: on targets are left and right; an underline on the right lands, and an unknown target is refused', () => {
  const kind = registries.kinds.get('compare');
  assert.deepEqual(kind.targets(SIDES()), ['left', 'right']);
  const shot = SIDES({ on: [{ at: 'sentence:1', do: 'underline', target: 'right' }] });
  assert.deepEqual(errorsOf(shot), []);
  assert.ok(all(expandShot(shot, 'desk', '16:9').nodes).some((n) => n.id === 'c.on0'));
  const pop = expandShot({ ...shot, on: [{ at: 'sentence:1', do: 'underline', target: 'right' }] }, 'pop', '9:16');
  const right = all(pop.nodes).find((n) => n.id === 'c.right');
  assert.ok(all(right.children).some((n) => n.id === 'c.on0'), 'in pop a device aimed at a side leaves with it');
  const bad = errorsOf(SIDES({ on: [{ at: 'start', do: 'circle', target: 'middle' }] }));
  assert.ok(bad.some((e) => /unknown target "middle"/.test(e.message)));
  assert.equal(kind.showsWords, true);
  assert.notEqual(kind.numbered, true);
});

// ---- fix round 1 ----

const valueNode = (nodes, side) => all(nodes).find((n) => n.type === 'text' && n.id === `c.${side}.value`);

test('pop compare values share one size, the size at which the wider of the two fits, on both sides', () => {
  for (const format of ['16:9', '9:16']) {
    const { nodes, ctx } = expandShot(SIDES({ left: { title: 'Before', value: 3 }, right: { title: 'After', value: 1234567 } }), 'pop', format);
    const a = valueNode(nodes, 'left'), b = valueNode(nodes, 'right');
    assert.ok(a && b, `${format}: both values are their own numeral lines`);
    assert.equal(a.props.font.size, b.props.font.size, `${format}: one size`);
    assert.ok(b.props.x + b.props.layout.width <= ctx.canvas.w, `${format}: the wider one fits`);
  }
});

test('compare values are numerals in fixed advances: one word per character', () => {
  for (const look of ['desk', 'pop']) {
    const { nodes } = expandShot(SIDES({ left: { title: 'A', value: 1118 }, right: { title: 'B', value: 2000 } }), look, '16:9');
    assert.deepEqual(valueNode(nodes, 'left').props.layout.lines[0].words.map((w) => w.text), ['1', ',', '1', '1', '8'], `${look}: per character`);
  }
});

test('desk compare: a long legal value shrinks the numeral, never the title below its floor, and flags no title that fits', () => {
  for (const format of ['16:9', '9:16']) {
    const { nodes, ctx } = expandShot(SIDES({ left: { title: 'Server', value: 1200000, points: ['Per seat'] }, right: { title: 'File', value: 9 } }), 'desk', format);
    const title = textNode(cardsOf(nodes).left.children, 'c.left.title');
    const floor = Math.max(ctx.look.scale[2], 3 * ctx.look.scale[0]) * ctx.unit;
    assert.ok(title.props.font.size >= floor - EPS, `${format}: title ${title.props.font.size} at or over its floor ${floor}`);
    assert.notEqual(title.props.layout.overflow, true, `${format}: no false "does not fit"`);
  }
});
