// The motion blur of slide, cover and punch in Node (transitions plan Task 6): the sample plan, each cut's parts, and the
// frame buildFilm gives inside a smeared window. The pixels are in cuts-smear-browser.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/cuts/index.mjs';
import { smearPlan, SMEAR_SHUTTER, SMEAR_GAP_PX, SMEAR_MIN_SAMPLES, SMEAR_MAX_SAMPLES } from '../../engine/cuts/smear.mjs';
import { coverEdgeNodes } from '../../engine/cuts/cover.mjs';
import { ease } from '../../engine/time/ease.mjs';
import { stateKey } from '../../engine/graph/sample.mjs';
import { buildTimeline } from '../../engine/script/timing.mjs';
import { CUT_DURATION } from '../../engine/cuts/resolve.mjs';
import { validateLook } from '../../engine/looks/index.mjs';
import { filmFor, filmOf, fakeSampled, near, FPS } from './helpers/kinds.mjs';

const CANVAS = { w: 1920, h: 1080 };
const cubic = ease('inOutCubic');
const linear = (px) => (q0, q1) => Math.abs(q1 - q0) * px;
const ids = (nodes) => nodes.map((n) => n.id);
const field = (x = 0) => Object.freeze({ ...fakeSampled('field', x), depth: 1 });

test('the plan\'s constants: half a frame of shutter, copies at most 1 px apart, 2 to 32 samples', () => {
  assert.deepEqual([SMEAR_SHUTTER, SMEAR_GAP_PX, SMEAR_MIN_SAMPLES, SMEAR_MAX_SAMPLES], [0.5, 1, 2, 32]);
});

test('a slide\'s fastest frame at 1920 wide: the cap of 32 samples binds and neighbouring copies are 7.19 px apart', () => {
  // p 0.5 of a 0.4 s slide at 30 fps: one frame moves p by 1/12, the shutter spans 0.5 - 1/48 to 0.5 + 1/48;
  // inOutCubic there: 4 (23/48)^3 = 0.440068 and 1 - (23/24)^3 / 2 = 0.559932, so 1920 x 0.119864 = 230.14 px
  const plan = smearPlan({ p: 0.5, frame: 1 / 12, travel: (q0, q1) => Math.abs(cubic(q1) - cubic(q0)) * 1920 });
  assert.equal(plan.samples.length, 32);
  assert.ok(Math.abs(plan.gapPx - 230.139 / 32) < 1e-3, `gap ${plan.gapPx}`);
  near(plan.samples[0], 0.5 - 1 / 48 + (1 / 24) / 64, 'the first sample sits in the middle of the first slice');
  near(plan.samples[31] - plan.samples[0], (1 / 24) * (31 / 32), 'the samples span the shutter less one slice');
});

test('a short travel takes one sample per pixel; no travel takes the fewest', () => {
  assert.equal(smearPlan({ p: 0.5, frame: 0.1, travel: linear(200) }).samples.length, 10, '10 px of travel');
  const still = smearPlan({ p: 0.5, frame: 0.1, travel: () => 0 });
  assert.equal(still.samples.length, SMEAR_MIN_SAMPLES);
  assert.equal(still.gapPx, 0);
});

test('samples never leave 0..1, at either end of the window', () => {
  for (const p of [0.001, 0.02, 0.98, 0.999]) {
    const { samples } = smearPlan({ p, frame: 1 / 6, travel: linear(5000) });
    assert.ok(samples.every((q) => q >= 0 && q <= 1), `${p}: ${samples}`);
    assert.ok(samples.every((q, k) => k === 0 || q > samples[k - 1]), 'in order');
  }
  assert.throws(() => smearPlan({ p: 0.5, frame: 0, travel: linear(1) }), /frame > 0/);
});

test('slide parts: the shared field is still, both shots move, and the travel is the eased distance times the side', () => {
  const parts = registries.cuts.get('slide').parts({ from: [field(), fakeSampled('a', 900)], to: [field(), fakeSampled('b', 100)], p: 0.5, canvas: CANVAS, direction: 'right' });
  assert.deepEqual(ids(parts.still), ['field']);
  assert.deepEqual(ids(parts.moving(0.5)), ['a', 'b']);
  near(parts.moving(0.5)[0].x, 900 - 0.5 * 1920, 'the outgoing node half way out');
  // inOutCubic 0.4 -> 0.256, 0.6 -> 0.744
  near(parts.travel(0.4, 0.6), 0.488 * 1920, 'along the width');
  const up = registries.cuts.get('slide').parts({ from: [field()], to: [field()], p: 0.5, canvas: CANVAS, direction: 'up' });
  near(up.travel(0.4, 0.6), 0.488 * 1080, 'along the height');
  assert.deepEqual(parts.vector, [1, 0]);
  assert.deepEqual(parts.over, []);
});

test('cover parts: the outgoing shot and the field are still; the sheet moves with its backdrop and its copy of the field', () => {
  const parts = registries.cuts.get('cover').parts({ from: [field(), fakeSampled('a', 900)], to: [field(), fakeSampled('b', 100)], p: 0.5, canvas: CANVAS, background: '#101010', direction: 'left' });
  assert.deepEqual(ids(parts.still), ['field', 'a']);
  assert.deepEqual(ids(parts.moving(0.5)), ['cover.backdrop', 'field.cover', 'b']);
  near(parts.moving(0.5)[2].x, 100 - 0.5 * 1920, 'from the left, half way in');
  near(parts.travel(0.4, 0.6), 0.488 * 1920, 'the travel');
});

test('punch parts: a locked field at the back is still, a pinned tag over the picture is drawn over, the travel is the corner\'s', () => {
  const to = [fakeSampled('ground', 0, { fixed: true }), fakeSampled('b', 500), fakeSampled('tag', 40, { fixed: true })];
  const parts = registries.cuts.get('punch').parts({ from: [], to, p: 0.5, canvas: CANVAS });
  assert.deepEqual([ids(parts.still), ids(parts.moving(0.5)), ids(parts.over)], [['ground'], ['b'], ['tag']]);
  assert.equal(parts.vector, null);
  // from 1.15 to 1 over the whole window: the corner reach hypot(960, 540) = 1101.45 x 0.15 / 1
  near(parts.travel(0, 1), Math.hypot(960, 540) * 0.15, 'the corner');
  // what apply draws is the parts in that order
  assert.equal(stateKey(registries.cuts.get('punch').apply({ from: [], to, p: 0.5, canvas: CANVAS })), stateKey([...parts.still, ...parts.moving(0.5), ...parts.over]));
});

test('a punch never needs the box filter: its fastest frame stays under the cap at every duration a film may give it', () => {
  const punch = registries.cuts.get('punch');
  const parts = punch.parts({ from: [], to: [fakeSampled('b', 0)], p: 0.5, canvas: CANVAS });
  for (const dur of [CUT_DURATION.min, punch.dur, CUT_DURATION.max]) {
    const frames = Math.ceil(dur * FPS);
    for (let i = 1; i < frames; i++) {
      const plan = smearPlan({ p: i / frames, frame: 1 / frames, travel: parts.travel });
      assert.ok(plan.gapPx <= SMEAR_GAP_PX, `${dur} s, frame ${i}: ${plan.gapPx} px`);
    }
  }
});

test('cover\'s leading edge is look data: a keyline and a fading shadow just outside the side that leads', () => {
  const palette = { ink: '#111111', rule: '#cccccc' };
  const edge = { line: { color: 'rule', width: 3, alpha: 0.6 }, shadow: { color: 'ink', width: 24, alpha: 0.2, steps: 4 } };
  const nodes = coverEdgeNodes(edge, 'right', CANVAS, palette);
  assert.deepEqual(ids(nodes), ['cover.edge.shadow0', 'cover.edge.shadow1', 'cover.edge.shadow2', 'cover.edge.shadow3', 'cover.edge.line']);
  assert.equal(nodes.at(-1).props.d, 'M-3 0H0V1080H-3Z', 'from the right the sheet leads with its left side');
  assert.equal(nodes[0].props.d, 'M-9 0H-3V1080H-9Z');
  assert.deepEqual(nodes.map((n) => n.props.fill), ['#111111', '#111111', '#111111', '#111111', '#cccccc']);
  assert.ok(nodes[0].opacity > nodes[3].opacity, 'the shadow fades outwards');
  assert.equal(coverEdgeNodes(edge, 'up', CANVAS, palette).at(-1).props.d, 'M0 1080H1920V1083H0Z', 'from the top it leads with its bottom');
  assert.deepEqual(coverEdgeNodes(undefined, 'up', CANVAS, palette), [], 'no edge in a look that gives none');
});

test('validateLook checks coverEdge: palette colours, widths, alphas, steps and nothing else; desk and pop give one', () => {
  const desk = registries.looks.get('desk');
  const edged = (coverEdge) => () => validateLook({ ...desk, name: 'edge-test', coverEdge });
  assert.doesNotThrow(edged({ line: { color: 'ink', width: 2, alpha: 0.5 } }));
  assert.throws(edged({ line: { color: 'teal', width: 2, alpha: 0.5 } }), /look "edge-test": coverEdge\.line\.color must name a palette colour \(paper, ink, ink2, accent, accent2, rule\), got "teal"/);
  assert.throws(edged({ shadow: { color: 'ink', width: 0, alpha: 0.5, steps: 3 } }), /coverEdge\.shadow\.width must be a number of pixels > 0, got 0/);
  assert.throws(edged({ shadow: { color: 'ink', width: 9, alpha: 2, steps: 3 } }), /coverEdge\.shadow\.alpha must be a number above 0 and at most 1, got 2/);
  assert.throws(edged({ shadow: { color: 'ink', width: 9, alpha: 0.2, steps: 40 } }), /coverEdge\.shadow\.steps must be a whole number from 1 to 16, got 40/);
  assert.throws(edged({ glow: {} }), /coverEdge\.glow is not a field; it takes line, shadow/);
  assert.throws(edged({ line: { color: 'ink', width: 2, alpha: 0.5, dash: 3 } }), /coverEdge\.line\.dash is not a field/);
  assert.throws(edged('thick'), /coverEdge must be an object of line and shadow/);
  assert.ok(desk.coverEdge.line && desk.coverEdge.shadow, 'desk: a hairline and a shadow on its paper');
  assert.ok(registries.looks.get('pop').coverEdge.line, 'pop: a keyline');
});

// A two-statement film with a slide (or `cut`) between them, smeared through the shot's own option.
const shots = (cut) => [{ id: 'one', show: 'statement', say: 'Your charts lie.' }, { id: 'two', show: 'statement', say: 'No cloud.', cut }];
const midOf = (cut, look) => buildTimeline(filmOf(shots(cut), look), { fps: FPS }).shots[1].start + 0.2;

test('inside a smeared window the frame holds the still nodes and the smear; without smear there is none', () => {
  const cut = { type: 'slide', smear: true };
  const frame = filmFor(shots(cut), 'desk').frameAt(midOf(cut, 'desk'));
  assert.ok(frame.smear, 'a smear');
  assert.ok(!frame.sampled.some((n) => n.id === 'one.text' || n.id === 'two.text'), 'the moving text is not in sampled');
  assert.ok(frame.smear.layers.length >= SMEAR_MIN_SAMPLES && frame.smear.layers.length <= SMEAR_MAX_SAMPLES);
  assert.ok(frame.smear.layers.every((layer) => layer.some((n) => n.id === 'one.text') && layer.some((n) => n.id === 'two.text')), 'both texts in every layer');
  assert.deepEqual([frame.smear.cut.name, frame.smear.cut.direction], ['slide', 'right']);
  assert.ok(frame.smear.whole.some((n) => n.id === 'two.text'), 'the whole frame at p for the review');
  const unsmeared = { type: 'slide', smear: false }; // desk smears its slides by default (cutStyle)
  const plain = filmFor(shots(unsmeared), 'desk').frameAt(midOf(unsmeared, 'desk'));
  assert.equal(plain.smear, undefined, 'a cut whose resolved smear is false');
  assert.equal(stateKey(plain.sampled), stateKey(frame.smear.whole), 'the whole frame is the unsmeared frame');
});
