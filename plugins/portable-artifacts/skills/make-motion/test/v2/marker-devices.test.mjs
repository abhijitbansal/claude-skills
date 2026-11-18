// The `marker` look's drawn devices and its underline emphasis (looks-four plan, Task 12): every drawn mark is one
// polyline stroke the hand draws, the same for a seed, with a stroke plan entry; a box closes with a small overshoot; the
// underline sits under its word's ink within the line gap and touches no neighbouring line; nothing a device builds has
// a part-way opacity; a look that does not style `drawn` keeps the marks it had (the frozen fixtures prove that).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { handPlan, handLayer } from '../../engine/hand/index.mjs';
import { polylinePoints } from '../../engine/hand/strokes.mjs';
import { expandShot, all } from './helpers/kinds.mjs';

const NAME = 'marker';
const look = () => registries.looks.get(NAME);
const UNIT = 1;
const OVERSHOOT_MAX = 12; // units a drawn box runs past where it began
const BOX = Object.freeze([300, 300, 400, 160]);
const MARKS = Object.freeze([
  ['underline', { box: BOX }],
  ['circle', { box: BOX }],
  ['arrow', { box: BOX, from: [900, 700] }],
  ['bracket', { box: BOX }],
]);

const build = (name, params, seed = 3, id = `m-${name}`) => registries.devices.get(name).build({ id, at: 1, look: look(), unit: UNIT, seed, ...params }).nodes;

test('every drawn mark is one stroked polyline in the palette colour, and the hand has a stroke plan entry for it', () => {
  for (const [name, params] of MARKS) {
    const nodes = build(name, params);
    assert.equal(nodes.length, 1, `${name}: one node`);
    const [mark] = nodes;
    assert.equal(mark.type, 'path');
    assert.ok(polylinePoints(mark.props.d) !== null, `${name}: an M/L polyline the hand can draw`);
    assert.ok(mark.props.stroke && !mark.props.fill, `${name}: stroked, not filled`);
    assert.equal(mark.props.lineCap, 'round');
    const timing = { duration: 4, sentences: [{ start: 0, end: 3 }], words: [] };
    const filler = expandShot({ id: 'f', show: 'statement', say: 'Hello there.' }, NAME, '16:9');
    const { plan } = handPlan([...filler.nodes, mark], { ...filler.timing, ...timing }, filler.ctx);
    const entries = plan.filter((s) => s.node === mark.id);
    assert.equal(entries.length, 1, `${name}: one stroke in the plan`);
    assert.equal(entries[0].kind, 'line');
  }
});

test('the marks are the same for a seed and a different seed draws a different mark only where the device uses its seed', () => {
  for (const [name, params] of MARKS) {
    assert.deepEqual(build(name, params, 7)[0].props.d, build(name, params, 7)[0].props.d, `${name}: same seed, same stroke`);
  }
  // the hand wobbles each stroke by its id (engine/hand), so a drawn mark's wobble is deterministic per id and seed
  const filler = expandShot({ id: 'f', show: 'statement', say: 'Hello there.' }, NAME, '16:9');
  const wobbled = (id, seed) => handLayer([...filler.nodes, ...build('underline', { box: BOX }, 1, id)], filler.timing, { ...filler.ctx, seed }).find((n) => n.id === id).props.d;
  assert.equal(wobbled('u', 5), wobbled('u', 5));
  assert.notEqual(wobbled('u', 5), wobbled('v', 5), 'two ids wobble apart');
  assert.notEqual(wobbled('u', 5), wobbled('u', 6), 'two seeds wobble apart');
});

test('a drawn box closes with an overshoot inside 12 units: its last point is past its first, along the left edge', () => {
  const [mark] = build('circle', { box: BOX });
  const points = polylinePoints(mark.props.d);
  assert.equal(points.length, 5, 'top left, top right, bottom right, bottom left, and past the start');
  const [first, , , , last] = points;
  assert.equal(last[0], first[0], 'closes on the left edge');
  const over = Math.hypot(last[0] - first[0], last[1] - first[1]);
  assert.ok(over > 0 && over <= OVERSHOOT_MAX * UNIT, `overshoot ${over}`);
  const [x, y, w, h] = BOX;
  const pad = look().devices.circle.pad;
  assert.deepEqual(points.slice(0, 4), [[x - pad, y - pad], [x + w + pad, y - pad], [x + w + pad, y + h + pad], [x - pad, y + h + pad]]);
});

test('the arrow ends on its head: shaft, both barbs and the tip in one polyline, the tip a gap outside the box', () => {
  const [mark] = build('arrow', { box: BOX, from: [900, 700] });
  const points = polylinePoints(mark.props.d);
  assert.deepEqual(points[0], [900, 700], 'starts at from');
  const tip = points.at(-3);
  const [x, y, w, h] = BOX;
  const gap = 12;
  assert.ok(tip[0] >= x - gap - 1 && tip[0] <= x + w + gap + 1 && tip[1] >= y - gap - 1 && tip[1] <= y + h + gap + 1, `tip ${tip}`);
  assert.deepEqual(points.at(-2).length, 2);
  assert.ok(points.length > 20, 'a bowed shaft of many points');
});

// The underline emphasis in a statement (the fake measure of helpers/kinds.mjs: the ink reaches 0.74 em above the baseline).
const CAP = 0.74;
const SHOTS = Object.freeze([
  { id: 'one', show: 'statement', say: 'Numbers need *sources* on the board.' },
  { id: 'two', show: 'statement', say: 'Every claim on this board needs a *source* that you can read.' },
]);

for (const format of ['16:9', '9:16']) {
  test(`the underline emphasis (${format}): one stroke under the emphasised word's ink, within the line gap, touching no neighbouring line`, () => {
    for (const shot of SHOTS) {
      const out = expandShot(shot, NAME, format);
      const text = all(out.nodes).find((n) => n.type === 'text');
      const marks = out.nodes.filter((n) => n.id.includes('.ul'));
      assert.equal(marks.length, 1, `${shot.id}: one underline for one emphasised word`);
      const points = polylinePoints(marks[0].props.d);
      const width = marks[0].props.strokeWidth;
      const size = text.props.font.size;
      const emphasised = text.props.layout.lines.flatMap((line) => line.words.map((w) => ({ line, w }))).find(({ w }) => /source/.test(w.text));
      const baseline = text.props.y + emphasised.line.y;
      const bottom = Math.max(...points.map((p) => p[1])) + width / 2;
      const top = Math.min(...points.map((p) => p[1])) - width / 2;
      assert.ok(top >= baseline - 0.05 * size, `${shot.id}: starts at or under the baseline (top ${top}, baseline ${baseline})`);
      const lines = text.props.layout.lines;
      const next = lines[lines.indexOf(emphasised.line) + 1];
      if (next) assert.ok(bottom < text.props.y + next.y - CAP * size, `${shot.id}: clear of the next line's ink (${bottom} against ${text.props.y + next.y - CAP * size})`);
      const left = text.props.x + emphasised.line.x + emphasised.w.x;
      assert.ok(points[0][0] <= left + 1 && points.at(-1)[0] >= left + emphasised.w.width - 1, `${shot.id}: spans the word`);
      assert.equal(marks[0].props.stroke, look().palette.accent, 'the accent colour');
      assert.equal(marks[0].props.window[0], out.timing.words[out.timing.words.findIndex((w) => /source/.test(w.text))].start, 'begun as the word is spoken');
    }
  });
}

test('the underline is placed after its text (the text is the first element) and a statement with no emphasis has none', () => {
  const out = expandShot(SHOTS[0], NAME, '16:9');
  assert.ok(out.nodes.findIndex((n) => n.type === 'text') < out.nodes.findIndex((n) => n.id.includes('.ul')));
  const plain = expandShot({ id: 'p', show: 'statement', say: 'Nothing is emphasised here.' }, NAME, '16:9');
  assert.equal(plain.nodes.filter((n) => n.id.includes('.ul')).length, 0);
});

test('an emphasised run of several words gets one underline for each line it sits on, none for a line it does not touch', () => {
  const out = expandShot({ id: 'r', show: 'statement', say: 'Draw *the whole source* by hand.' }, NAME, '16:9');
  const text = all(out.nodes).find((n) => n.type === 'text');
  const marked = text.props.layout.lines.filter((line) => line.words.some((w) => /^(the|whole|source)\b/.test(w.text)));
  assert.equal(out.nodes.filter((n) => n.id.includes('.ul')).length, marked.length);
});

test('no node a marker device or the underline emphasis builds has an opacity strictly between 0 and 1, at any sampled time', () => {
  const out = expandShot(SHOTS[0], NAME, '16:9');
  const nodes = [...out.nodes, ...MARKS.flatMap(([name, params]) => build(name, params))];
  const filler = handLayer(nodes, out.timing, out.ctx);
  for (const n of all(filler)) {
    for (const k of n.tracks.opacity?.points ?? []) assert.ok(k.v === 0 || k.v === 1, `${n.id}: opacity ${k.v}`);
    for (const word of n.wordTracks ?? []) for (const k of word.opacity?.points ?? []) assert.ok(k.v === 0 || k.v === 1, `${n.id}: word opacity ${k.v}`);
  }
});

test('a look that does not style drawn keeps its marks: desk\'s underline is still a smooth stroke, not a polyline', () => {
  const deskMark = registries.devices.get('underline').build({ id: 'u', box: BOX, at: 1, look: registries.looks.get('desk'), unit: UNIT, seed: 3 }).nodes[0];
  assert.equal(polylinePoints(deskMark.props.d), null);
});

// The registered statement example (a kicker on a slug tag, two written lines, one underline) under the stroke plan.
for (const format of ['16:9', '9:16']) {
  test(`the stroke plan of the statement example (${format}): frame furniture stands from frame 0, the underline gets time to draw and no stroke is faster than the hand's limit`, () => {
    const out = expandShot(registries.kinds.get('statement').example, NAME, format);
    const { plan } = handPlan(out.nodes, out.timing, out.ctx);
    const furniture = plan.filter((s) => /slug|kicker/.test(s.node));
    assert.ok(furniture.length >= 2, 'the slug plate and the kicker');
    assert.ok(furniture.every((s) => s.start === 0 && s.end === 0), 'drawn by nobody: on the board from frame 0');
    const underline = plan.find((s) => s.node.includes('.ul'));
    assert.ok(underline && underline.end > underline.start, 'the underline takes time to draw');
    assert.ok(underline.start >= 0 && underline.end <= out.timing.duration, 'inside the shot');
    assert.ok(plan.every((s) => s.speed <= look().hand.maxSpeed), `speeds ${plan.map((s) => Math.round(s.speed))}`);
  });
}
