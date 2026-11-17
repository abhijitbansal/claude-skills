// The drawing hand (engine/hand, looks-four Task 2): its stroke plan, where the tip is, how text is written, the first
// frame of a board, the speed rule and the two hand findings. The hand look is a throwaway desk copy (helpers/hand-look).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import { strokePlan, handPose, handLayer, handPlan, handFindings } from '../../engine/hand/index.mjs';
import { pointAt, wobble } from '../../engine/hand/geometry.mjs';
import { restPoint } from '../../engine/hand/pose.mjs';
import { deviceRng } from '../../engine/devices/shared.mjs';
import { auditFrame } from '../../engine/review/frame.mjs';
import { safeRectFor } from '../../scripts/v2/review.mjs';
import { expandIn, filmOf, filmFor, all } from './helpers/kinds.mjs';
import { handLook, HAND } from './helpers/hand-look.mjs';

const LOOK = handLook();
const FPS = 30;
const TIP_NEAR = 6; // units
const MAX_JUMP = 400; // units in one frame
const FONT = { family: 'Fraunces', size: 96, weight: 600, width: 'normal' };
const LABEL = { family: 'Schibsted Grotesk', size: 56, weight: 400, width: 'normal' };
const INK = '#15130f';

// A board: a heading, an underline, a box and its label, said in two sentences.
const BOARD = Object.freeze({
  id: 'board', show: 'free', background: '#f3eee3', say: 'First we draw the box around the idea. Then we write its name inside it.',
  nodes: [
    { type: 'text', id: 'heading', props: { text: 'The idea', font: FONT, maxWidth: 900, x: 160, y: 120, fill: INK } },
    { type: 'path', id: 'rule', props: { d: 'M160 250L760 250', stroke: INK, strokeWidth: 6 } },
    { type: 'path', id: 'box', props: { d: 'M160 380L760 380L760 640L160 640Z', stroke: INK, strokeWidth: 6 } },
    { type: 'text', id: 'name', props: { text: 'Every number has a source', font: LABEL, maxWidth: 680, x: 200, y: 480, fill: INK }, sentence: 1 },
  ],
});
const shotOf = (extra = {}) => ({ ...BOARD, ...extra });
const expanded = (shot = BOARD, format = '16:9', look = LOOK) => expandIn(filmOf([shot], look, format));
const planOf = (out) => handPlan(out.nodes, out.timing, out.ctx).plan;
const poseAt = (out, plan, t) => handPose(plan, t, out.ctx.look, { canvas: out.canvas, unit: out.ctx.unit });
// the same look resting sooner: a board's last stroke lands LANDED_BEFORE_END (0.6 s) before the shot ends
const QUICK_REST = 0.3;
const RESTLESS = handLook('hand-test-rest', { rest: QUICK_REST });
const frames = (duration) => Array.from({ length: Math.ceil(duration * FPS) + 1 }, (_, f) => Math.min(duration, f / FPS));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
// a written line's ink box (the fake measure: capitals reach 0.74 em, the ink starts 0.02 em in)
const inkBoxes = (nodes) => all(nodes).filter((n) => n.type === 'text').flatMap((n) => n.props.layout.lines.map((line) => {
  const size = n.props.font.size;
  return [n.props.x + line.x, n.props.y + line.y - 0.74 * size, line.width, 0.74 * size];
}));

test('the stroke plan lists one stroke per drawn node (a text: one per line) in draw order with start before end', () => {
  const out = expanded();
  const plan = planOf(out);
  const nodesInPlan = [...new Set(plan.map((s) => s.node))];
  assert.deepEqual(nodesInPlan, ['heading', 'rule', 'box', 'name']);
  assert.ok(plan.every((s) => s.start <= s.end), 'start before end');
  assert.ok(plan.every((s, i) => i === 0 || s.start >= plan[i - 1].end - 1e-9), 'one after another');
  assert.ok(plan.slice(1).filter((s) => s.node !== 'heading').every((s) => s.end > s.start), 'every later stroke takes time');
  assert.equal(plan.filter((s) => s.node === 'name').length, all(out.nodes).find((n) => n.id === 'name').props.layout.lines.length, 'a write stroke per line');
});

test('while a stroke draws, the tip is within 6 units of the stroke\'s visible end at every 1/30 s', () => {
  const out = expanded();
  const plan = planOf(out);
  for (const s of plan.filter((x) => x.end > x.start)) {
    for (let t = s.start; t <= s.end; t += 1 / FPS) {
      const pose = poseAt(out, plan, t);
      const end = pointAt(s, (t - s.start) / (s.end - s.start));
      assert.ok(dist([pose.x, pose.y], end) <= TIP_NEAR * out.ctx.unit, `${s.id} at ${t.toFixed(3)}`);
      assert.equal(pose.down, true);
    }
  }
});

test('between strokes the hand travels in one eased move and never jumps more than 400 units in one frame', () => {
  for (const format of ['16:9', '9:16']) {
    const out = expanded(BOARD, format);
    const plan = planOf(out);
    let last = null;
    for (const t of frames(out.timing.duration)) {
      const pose = poseAt(out, plan, t);
      if (last) assert.ok(dist([pose.x, pose.y], last) <= MAX_JUMP * out.ctx.unit, `${format} jump at ${t.toFixed(3)}`);
      last = [pose.x, pose.y];
    }
  }
});

test('a write stroke\'s tip stays within the word\'s ink box and moves left to right', () => {
  const out = expanded();
  const plan = planOf(out);
  const boxes = inkBoxes(out.nodes);
  for (const s of plan.filter((x) => x.kind === 'write' && x.end > x.start)) {
    let lastX = -Infinity;
    for (let t = s.start; t <= s.end; t += 1 / FPS) {
      const { x, y } = poseAt(out, plan, t);
      assert.ok(boxes.some(([bx, by, bw, bh]) => x >= bx - 1e-6 && x <= bx + bw + 1e-6 && y >= by && y <= by + bh), `${s.id} tip in its ink box`);
      assert.ok(x >= lastX - 1e-9, `${s.id} moves left to right`);
      lastX = x;
    }
  }
});

test('with no stroke for more than hand.rest seconds the hand rests at the rest point, outside every text\'s ink box', () => {
  for (const format of ['16:9', '9:16']) {
    const out = expanded(BOARD, format);
    const plan = planOf(out);
    const rest = restPoint(out.ctx.look, out.canvas);
    const t = plan.at(-1).end + HAND.rest + 1; // the pose is a function of the plan, whatever the shot's length
    const pose = poseAt(out, plan, t);
    assert.deepEqual([pose.x, pose.y], rest);
    assert.equal(pose.resting, true);
    for (const [bx, by, bw, bh] of inkBoxes(out.nodes)) assert.ok(!(rest[0] >= bx && rest[0] <= bx + bw && rest[1] >= by && rest[1] <= by + bh), `${format}: rest point off the text`);
  }
});

test('the hand is absent when the look has no hand data', () => {
  const out = expanded(BOARD, '16:9', 'desk');
  assert.equal(handLayer(out.nodes, out.timing, out.ctx), out.nodes, 'the same nodes back');
  assert.equal(all(out.nodes).some((n) => n.props?.role === 'hand'), false);
});

test('the pose is a pure function of the plan and t', () => {
  const out = expanded();
  const plan = planOf(out);
  for (const t of [0, 0.5, 1.7, 3.2]) assert.deepEqual(poseAt(out, plan, t), poseAt(out, plan, t));
  assert.deepEqual(planOf(expanded()), plan, 'the same shot plans the same');
});

test('wobble is deterministic for a seed and differs between two ids', () => {
  const line = [[0, 0], [400, 0]];
  const make = (id, seed = 3) => wobble(line, deviceRng(seed, id, 'hand'), { ...HAND.wobble, u: 1 });
  assert.deepEqual(make('rule'), make('rule'));
  assert.notDeepEqual(make('rule'), make('box'));
  assert.notDeepEqual(make('rule', 3), make('rule', 4));
});

test('drawing speed follows the narration: a ten-element sentence is too much to draw (a creative finding)', () => {
  const lines = Array.from({ length: 10 }, (_, i) => ({ type: 'path', id: `l${i}`, props: { d: `M100 ${100 + 60 * i}L1800 ${100 + 60 * i}`, stroke: INK, strokeWidth: 6 } }));
  const out = expanded(shotOf({ say: 'All of this at once.', nodes: [BOARD.nodes[0], ...lines] }));
  const plan = planOf(out);
  const findings = handFindings(plan, registries.looks.get(LOOK), [], { canvas: out.canvas, unit: out.ctx.unit, duration: out.timing.duration });
  assert.deepEqual(findings.filter((f) => f.rule === 'hand-speed').map((f) => f.kind), ['creative']);
  assert.match(findings.find((f) => f.rule === 'hand-speed').message, /cut an element or lengthen the line/);
  const calm = handFindings(planOf(expanded()), registries.looks.get(LOOK), [], { canvas: out.canvas, unit: out.ctx.unit, duration: expanded().timing.duration });
  assert.deepEqual(calm.filter((f) => f.rule === 'hand-speed'), [], 'the board draws within the speed');
});

test('text is written, never faded: no text or path node of a hand shot has an opacity track strictly between 0 and 1', () => {
  const out = expanded();
  const nodes = handLayer(out.nodes, out.timing, out.ctx);
  for (const n of all(nodes).filter((x) => x.type === 'text' || x.type === 'path')) {
    for (const tr of [n.tracks.opacity, ...n.wordTracks.map((w) => w.opacity)].filter(Boolean)) {
      assert.ok(tr.points.every((p) => p.v === 0 || p.v === 1), `${n.id}: opacity keys ${tr.points.map((p) => p.v).join(', ')}`);
    }
  }
  assert.ok(all(nodes).some((n) => n.id.startsWith('name') && n.tracks.reveal), 'the label is revealed by its clip');
});

test('frame 0 of a board holds at least one fully drawn element and the hand resting at its end', () => {
  for (const format of ['16:9', '9:16']) {
    const built = filmFor([BOARD], LOOK, format);
    const first = built.sampleShot(0, 0);
    const whole = first.filter((n) => (n.type === 'text' && n.reveal === 1) || (n.type === 'path' && n.draw === 1 && n.props.role !== 'hand'));
    assert.ok(whole.some((n) => n.id === 'heading'), `${format}: the heading is written on frame 0`);
    const later = first.filter((n) => ['rule', 'box', 'name'].includes(n.id) || n.id.startsWith('name.'));
    assert.ok(later.length >= 3 && later.every((n) => (n.type === 'text' ? n.reveal : n.draw) === 0), `${format}: the rest is not drawn yet`);
    const out = expanded(BOARD, format);
    const plan = planOf(out);
    const pose = poseAt(out, plan, 0);
    assert.deepEqual([pose.x, pose.y], plan[0].points.at(-1), `${format}: the hand rests at the heading's end`);
  }
});

// ---- the audits and the hand ----

test('a text node given role "hand" is still judged by every text rule (the role exempts paths only)', () => {
  const canvas = { w: 1920, h: 1080 };
  const look = registries.looks.get('desk');
  const ctx = { look, canvas, mode: 'pro', shotId: 'h', shotIndex: 0, t: 1, safe: safeRectFor(canvas, look) };
  const text = {
    type: 'text', id: 'sneaky', depth: 0, props: { role: 'hand' }, x: 1800, y: 100, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, visible: true, children: [],
    words: [{ opacity: 1, x: 0, y: 0, scale: 1 }],
    layout: { size: 10, width: 400, height: 12, overflow: false, lines: [{ x: 0, y: 9, width: 400, words: [{ text: 'word', index: 0, x: 0, width: 400 }] }] },
    bbox: [1800, 100, 400, 12], spread: 0,
  };
  const rules = auditFrame([text], ctx).map((f) => f.rule);
  assert.ok(rules.includes('safe-area'), `safe-area still judged: ${rules.join(', ')}`);
  assert.ok(rules.includes('min-size'), `min-size still judged: ${rules.join(', ')}`);
});

test('the two hand findings fire on a planted pose: over a finished text for more than 0.3 s, and across the top edge', () => {
  const out = expanded(BOARD, '16:9', RESTLESS);
  const plan = planOf(out);
  const opts = { canvas: out.canvas, unit: out.ctx.unit, duration: out.timing.duration };
  const look = out.ctx.look;
  // a text planted where the hand rests, finished from the start
  const rest = restPoint(look, out.canvas);
  const planted = [{ id: 'under', box: [rest[0] + 20, rest[1] + 10, 120, 40], done: 0 }];
  // judged past the shot's end, where the hand has gone to rest over it
  const late = { ...opts, duration: opts.duration + 2 };
  assert.deepEqual(handFindings(plan, look, planted, late).filter((f) => f.rule === 'covered').map((f) => [f.kind, f.node]), [['mechanical', 'under']]);
  // the board's own texts, each finished when its line is written: never covered for long
  const writes = plan.filter((s) => s.kind === 'write');
  const own = inkBoxes(out.nodes).map((box, i) => ({ id: `t${i}`, box, done: writes[i].end }));
  assert.deepEqual(handFindings(plan, look, own, opts).filter((f) => f.rule === 'covered'), []);
  // a planted pose: a hand turned up (angle -90) resting on the top edge crosses it once it goes to rest
  const top = handLook('hand-test-top', { angle: -90, restAt: { wide: [0.5, 0.005], tall: [0.5, 0.005] } });
  const leftFindings = handFindings(plan, registries.looks.get(top), [], late);
  assert.deepEqual(leftFindings.filter((f) => f.rule === 'hand-edge').map((f) => f.kind), ['mechanical']);
  assert.deepEqual(handFindings(plan, look, [], late).filter((f) => f.rule === 'hand-edge'), [], 'the look\'s own rest point is clear of the top and left edges');
});
