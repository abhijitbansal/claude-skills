// The hand's per-element speed model (looks-four Task 13, m2): the time a stroke takes comes from its own length and kind,
// a shot that cannot be drawn in its narration lengthens into its hold, and a decorative element the hand has no time for
// appears set (at once, never faded) while the heroes are still drawn. The hand-speed finding is as strict as before:
// when the heroes alone cannot be drawn at the speed cap it still fires.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { handLayer, handPlan, handFindings, handPose } from '../../engine/hand/index.mjs';
import { restPoint } from '../../engine/hand/pose.mjs';
import { expandIn, filmOf, all } from './helpers/kinds.mjs';
import { handLook } from './helpers/hand-look.mjs';

// the helper's hand has no stroke widths (flatten draws fills and curves with them)
const LOOK = handLook('hand-speed-test', { width: { line: 7, write: 6, fill: 5 }, maxSpeed: 2600 });
const INK = '#15130f';
const FONT = { family: 'Fraunces', size: 96, weight: 600, width: 'normal' };
const LABEL = { family: 'Schibsted Grotesk', size: 56, weight: 400, width: 'normal' };
const DRAW_TAIL = 0.3; // s the hand leaves at the end of a shot at least (the hold it may draw into)
const LATEST = 0.6; // s: kinds/arrivals.mjs LANDED_BEFORE_END
const EPS = 1e-6;

const heading = { type: 'text', id: 'heading', props: { text: 'The idea', font: FONT, maxWidth: 900, x: 160, y: 120, fill: INK } };
// a node's `sentence` (the narration sentence it is drawn in) is a prop the hand's plan reads; the free kind passes props on
const inSentence = (n) => (n.sentence === undefined ? n : { type: n.type, id: n.id, props: { ...n.props, sentence: n.sentence } });
const board = (nodes, say) => ({ id: 'b', show: 'free', background: '#f3eee3', say, nodes: [heading, ...nodes].map(inSentence) });
const expanded = (shot, format = '16:9') => expandIn(filmOf([shot], LOOK, format));
const planned = (out) => handPlan(out.nodes, out.timing, out.ctx);
const maxSpeed = registries.looks.get(LOOK).hand.maxSpeed;
const findingsOf = (out, { nodes, plan }) => handFindings(plan, out.ctx.look, [], { canvas: out.canvas, unit: out.ctx.unit, duration: out.timing.duration });

// a zigzag of `total` px: segments of about 1700 across the frame, the last cut to fit
function zigzag(x, y, total) {
  const points = [[x, y]];
  let left = total, dir = 1, at = x;
  while (left > 0) {
    const run = Math.min(1700, left);
    at += dir * run;
    points.push([at, y + (points.length % 2) * 2]);
    left -= Math.hypot(run, 2);
    dir = -dir;
  }
  return { d: `M${points.map(([px, py]) => `${px} ${py}`).join('L')}`, end: points.at(-1) };
}

const SAY = 'Slowly now we write the name of the idea and underline it so that it stays.';

test('a word is written slower than a rule is drawn, in the same generous sentence', () => {
  const out = expanded(board([
    { type: 'text', id: 'name', props: { text: 'Every number', font: LABEL, maxWidth: 680, x: 200, y: 480, fill: INK }, sentence: 0 },
    { type: 'path', id: 'rule', props: { d: 'M200 600L1000 600', stroke: INK, strokeWidth: 6 }, sentence: 0 },
  ], SAY));
  const { plan } = planned(out);
  const write = plan.find((s) => s.node === 'name');
  const rule = plan.find((s) => s.node === 'rule');
  assert.ok(write.end > write.start && rule.end > rule.start);
  assert.ok(rule.speed > write.speed * 1.2, `the rule (${rule.speed.toFixed(0)}) is drawn faster than the word is written (${write.speed.toFixed(0)})`);
  assert.ok(rule.speed <= maxSpeed + EPS && write.speed <= maxSpeed + EPS, 'neither passes the cap');
});

test('a sentence the hand cannot draw by the latest landing lengthens into the hold and stays within the speed cap', () => {
  const probe = expanded(board([], SAY));
  const sentence = probe.timing.sentences[0];
  const window = Math.min(sentence.end, probe.timing.duration - LATEST) - sentence.start;
  const total = (window + 0.06) * maxSpeed * probe.ctx.unit; // more than the window holds at the cap, less than the hold adds
  const out = expanded(board([{ type: 'path', id: 'long', props: { d: zigzag(160, 300, total / probe.ctx.unit).d, stroke: INK, strokeWidth: 6 }, sentence: 0 }], SAY));
  const result = planned(out);
  const last = result.plan.at(-1);
  assert.ok(last.end > out.timing.duration - LATEST + EPS, `the stroke runs on past the latest landing (ends ${last.end.toFixed(2)})`);
  assert.ok(last.end <= out.timing.duration - DRAW_TAIL + EPS, `and leaves its tail (ends ${last.end.toFixed(2)} of ${out.timing.duration.toFixed(2)})`);
  assert.deepEqual(findingsOf(out, result).filter((f) => f.rule === 'hand-speed'), [], 'no hand-speed finding');
});

// a filled rectangle too big to hatch in the sentence, and a decorative tick; the heroes (heading, name, the rectangle's outline)
const FILLED = { type: 'path', id: 'slab', props: { d: 'M200 700L1100 700L1100 1000L200 1000Z', fill: '#e0a800' }, sentence: 0 };
const TICK = { type: 'path', id: 'tick', props: { d: 'M1300 700L1500 700', stroke: INK, strokeWidth: 6, decor: true }, sentence: 0 };
const NAME = { type: 'text', id: 'name', props: { text: 'Every number', font: LABEL, maxWidth: 680, x: 200, y: 480, fill: INK }, sentence: 0 };

test('with no time for a hatch the hand draws the heroes and the fill appears set: at once, never faded', () => {
  const out = expanded(board([NAME, FILLED, TICK], SAY));
  const result = planned(out);
  assert.ok(!result.plan.some((s) => s.kind === 'fill'), 'no hatch stroke in the plan');
  assert.deepEqual(findingsOf(out, result).filter((f) => f.rule === 'hand-speed'), [], 'the heroes alone are drawn at a plausible speed');
  assert.ok(result.plan.some((s) => s.node === 'slab') && result.plan.some((s) => s.node === 'name'), 'the outline and the name are still drawn');
  const set = result.set.map((s) => s.node).sort();
  assert.deepEqual(set, ['slab.hatch'], `the set elements: ${set.join(', ')}`);
  const nodes = handLayer(out.nodes, out.timing, out.ctx);
  const hatch = all(nodes).find((n) => n.id === 'slab.hatch');
  assert.ok(hatch, 'the hatch is on the board');
  const keys = hatch.tracks.opacity.points;
  assert.ok(keys.every((k) => k.v === 0 || k.v === 1), 'it steps, it never fades');
  assert.equal(keys.at(-1).v, 1, 'and it ends shown');
  assert.equal(hatch.tracks.draw, undefined, 'it is not drawn');
});

test('a decorative tick the hand has no time for is set, not drawn, while a hero line is always drawn', () => {
  const out = expanded(board([NAME, { type: 'path', id: 'hero', props: { d: zigzag(160, 800, 1500).d, stroke: INK, strokeWidth: 6 }, sentence: 0 }, TICK], 'Short.'));
  const { plan, set } = planned(out);
  assert.ok(plan.some((s) => s.node === 'hero'), 'the hero line is a stroke in the plan');
  assert.notEqual(plan.some((s) => s.node === 'tick'), set.some((s) => s.node === 'tick'), 'the tick is either drawn or set, never both, never lost');
  assert.deepEqual(set.filter((s) => s.node !== 'tick'), [], 'only the decorative tick can be set');
});

test('the finding stays as strict: heroes alone that cannot be drawn still fire it, with decorations present', () => {
  const lines = Array.from({ length: 8 }, (_, i) => ({ type: 'path', id: `h${i}`, props: { d: `M100 ${400 + 50 * i}L1800 ${400 + 50 * i}`, stroke: INK, strokeWidth: 6 }, sentence: 0 }));
  const out = expanded(board([...lines, FILLED, TICK], 'All of this at once.'));
  const result = planned(out);
  const found = findingsOf(out, result).filter((f) => f.rule === 'hand-speed');
  assert.deepEqual(found.map((f) => f.kind), ['creative']);
  assert.ok(!result.plan.some((s) => s.kind === 'fill'), 'the fill was set to spare what it could');
  assert.equal(result.plan.filter((s) => /^h\d$/.test(s.node)).length, 8, 'every hero line is still a stroke');
});

test('a sentence that fits at natural speed is unchanged by the hold: every stroke ends by the latest landing', () => {
  const out = expanded(board([NAME, { type: 'path', id: 'rule', props: { d: 'M200 600L1000 600', stroke: INK, strokeWidth: 6 }, sentence: 0 }], SAY));
  const { plan, set } = planned(out);
  assert.equal(set.length, 0, 'nothing is set');
  assert.ok(plan.every((s) => s.end <= out.timing.duration - LATEST + EPS), 'all drawn by the latest landing');
});

// ---- travel, small labels and a later sentence kept whole ----

const TRAVEL_FLOOR_SPEED = 3000; // units a second the hand moves between strokes at least on average (a time-lapse hand sweeps)
const TWO_LINES = { type: 'text', id: 'two', props: { text: 'Every number has a source that you can open and check for yourself', font: LABEL, maxWidth: 560, x: 200, y: 480, fill: INK }, sentence: 0 };

test('the hand moves from the end of a line to the start of the next at a sweeping pace', () => {
  const out = expanded(board([TWO_LINES], SAY));
  const lines = planned(out).plan.filter((s) => s.node === 'two');
  assert.ok(lines.length >= 2, 'the text wraps onto two lines');
  const [a, b] = lines;
  const dist = Math.hypot(b.points[0][0] - a.points.at(-1)[0], b.points[0][1] - a.points.at(-1)[1]);
  const gap = b.start - a.end;
  assert.ok(gap <= dist / TRAVEL_FLOOR_SPEED + EPS, `the carriage return of ${dist.toFixed(0)} units takes ${gap.toFixed(3)} s`);
});

const FIGURE = { type: 'text', id: 'fig', props: { text: '42', font: LABEL, maxWidth: 200, x: 1300, y: 480, fill: INK }, sentence: 0 };

test('a figure of a glyph or two in a small size is a lesser element: set when the sentence has no time, drawn when it has', () => {
  const lines = Array.from({ length: 8 }, (_, i) => ({ type: 'path', id: `h${i}`, props: { d: `M100 ${400 + 50 * i}L1800 ${400 + 50 * i}`, stroke: INK, strokeWidth: 6 }, sentence: 0 }));
  const tight = planned(expanded(board([...lines, FIGURE], 'All of this at once.')));
  assert.deepEqual(tight.set.map((s) => s.node), ['fig'], 'the figure is set');
  assert.ok(!tight.plan.some((s) => s.node === 'fig'), 'and not drawn');
  const calm = planned(expanded(board([NAME, FIGURE], SAY)));
  assert.deepEqual(calm.set, [], 'with time to spare nothing is set');
  assert.ok(calm.plan.some((s) => s.node === 'fig'), 'the figure is written');
  const hero = { ...NAME, id: 'hero-words', props: { ...NAME.props, text: 'Every number has a source' } };
  const crowded = planned(expanded(board([...lines, hero], 'All of this at once.')));
  assert.ok(crowded.plan.some((s) => s.node === 'hero-words'), 'a word of meaning is never set');
});

test('a set text is on the board at once when its sentence opens: a stepped opacity, no fade, no entrance on its words', () => {
  const lines = Array.from({ length: 8 }, (_, i) => ({ type: 'path', id: `h${i}`, props: { d: `M100 ${400 + 50 * i}L1800 ${400 + 50 * i}`, stroke: INK, strokeWidth: 6 }, sentence: 0 }));
  const out = expanded(board([...lines, FIGURE], 'All of this at once.'));
  const fig = all(handLayer(out.nodes, out.timing, out.ctx)).find((n) => n.id === 'fig');
  assert.ok(fig.tracks.opacity.points.every((k) => k.v === 0 || k.v === 1), 'it steps');
  assert.equal(fig.tracks.opacity.points.at(-1).v, 1, 'it ends shown');
  assert.ok(fig.wordTracks.every((w) => Object.keys(w).every((name) => !['opacity', 'ghost', 'fill'].includes(name))), 'its words do not fade in');
});

test('a sentence that runs on into the hold leaves the next sentence what it needs at the speed cap', () => {
  const probe = expanded(board([], 'First we draw a long path and talk about it for a while. Then we add the closing line.'));
  const [s0, s1] = probe.timing.sentences;
  const duration = probe.timing.duration;
  const unit = probe.ctx.unit;
  const alone = planned(expanded(board([{ type: 'path', id: 'a', props: { d: zigzag(160, 300, 4000).d, stroke: INK, strokeWidth: 6 }, sentence: 0 }], 'First we draw a long path and talk about it for a while. Then we add the closing line.')));
  const startA = alone.plan.find((s) => s.node === 'a').start;
  const cap = maxSpeed * 0.999 * unit;
  const lenA = (Math.min(s0.end, duration - LATEST) + 0.1 - startA) * cap;
  const path = zigzag(160, 300, lenA / unit);
  const lenB = (duration - DRAW_TAIL - s1.start - 0.1) * cap;
  const [bx, by] = path.end;
  const nodes = [
    { type: 'path', id: 'a', props: { d: path.d, stroke: INK, strokeWidth: 6 }, sentence: 0 },
    { type: 'path', id: 'b', props: { d: zigzag(bx, by, lenB / unit).d, stroke: INK, strokeWidth: 6 }, sentence: 1 },
  ];
  const out = expanded(board(nodes, 'First we draw a long path and talk about it for a while. Then we add the closing line.'));
  const result = planned(out);
  const a = result.plan.find((s) => s.node === 'a');
  const b = result.plan.find((s) => s.node === 'b');
  assert.ok(a && b, `both strokes are planned: ${result.plan.map((s) => s.node).join(', ')} (set ${result.set.map((s) => s.node).join(', ')}); lenA ${lenA}, startA ${startA}, path ${path.d.slice(0, 80)}`);
  assert.ok(a.end > s1.start - EPS || a.end > Math.min(s0.end, duration - LATEST), `the first sentence runs on (${a.end.toFixed(2)} past ${s0.end.toFixed(2)})`);
  assert.ok(b.speed <= maxSpeed + EPS, `the second sentence's stroke is drawn at ${b.speed.toFixed(0)} units a second`);
  assert.deepEqual(findingsOf(out, result).filter((f) => f.rule === 'hand-speed'), [], 'no hand-speed finding');
});

// ---- frame 0 ----

test('with hand.restAtStart the hand is at its rest point on frame 0, not on the end of the first element', () => {
  const resting = handLook('hand-speed-rest0', { width: { line: 7, write: 6, fill: 5 }, maxSpeed: 2600, restAtStart: true });
  const first = (look) => {
    const out = expandIn(filmOf([board([NAME], SAY)], look, '16:9'));
    const { plan } = handPlan(out.nodes, out.timing, out.ctx);
    return { pose: handPose(plan, 0, out.ctx.look, { canvas: out.canvas, unit: out.ctx.unit }), plan, out };
  };
  const rest = first(resting);
  assert.deepEqual([rest.pose.x, rest.pose.y], restPoint(rest.out.ctx.look, rest.out.canvas), 'at the rest point');
  assert.equal(rest.pose.resting, true);
  const plain = first(LOOK);
  assert.deepEqual([plain.pose.x, plain.pose.y], plain.plan[0].points.at(-1), 'a hand without the flag still starts on the first element\'s end');
  // it sweeps in from the corner quickly: a hand that waits for the first sentence would eat its drawing time
  const stroke = rest.plan.find((s) => s.start > 0);
  const away = Math.hypot(stroke.points[0][0] - rest.pose.x, stroke.points[0][1] - rest.pose.y);
  const opens = rest.out.timing.sentences[0].start;
  assert.ok(stroke.start - opens <= Math.max(0.12, away / 5000) + EPS, `the sweep of ${away.toFixed(0)} units takes ${(stroke.start - opens).toFixed(3)} s`);
});

test('hand.restAtStart can be set for one format: the tall frame starts at rest, the wide one on the first element', () => {
  const tallOnly = handLook('hand-speed-rest-tall', { width: { line: 7, write: 6, fill: 5 }, maxSpeed: 2600, restAtStart: { wide: false, tall: true } });
  const start = (format) => {
    const out = expandIn(filmOf([board([NAME], SAY)], tallOnly, format));
    const { plan } = handPlan(out.nodes, out.timing, out.ctx);
    return { pose: handPose(plan, 0, out.ctx.look, { canvas: out.canvas, unit: out.ctx.unit }), plan, out };
  };
  const wide = start('16:9'), tall = start('9:16');
  assert.deepEqual([wide.pose.x, wide.pose.y], wide.plan[0].points.at(-1), 'wide: on the end of the first element');
  assert.deepEqual([tall.pose.x, tall.pose.y], restPoint(tall.out.ctx.look, tall.out.canvas), 'tall: at the rest point');
});
