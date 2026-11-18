// The drawing hand (looks-four Task 2): in a look with `hand` data, a shot's elements are drawn by a hand that follows the
// strokes on screen. handLayer rewrites the shot's nodes for it: a stroked polyline is wobbled (seeded per id) and drawn
// along its own points as its stroke's time runs; a text is written a line at a time through a left-to-right clip the tip
// leads (one node per line, its reveal track), with its words' entrances dropped, so an unwritten word is absent, never
// ghosted; the first element is whole on the first frame; then the hand's group (role 'hand') is laid over everything.
// Without look.hand the nodes come back as they are. handFindings judges a plan: drawing faster than look.hand.maxSpeed
// (creative), the hand over a finished text for more than COVER_SECONDS or crossing the frame's top or left edge
// (mechanical). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { deviceRng, polyline } from '../devices/shared.mjs';
import { unitOf } from '../units.mjs';
import { wobble } from './geometry.mjs';
import { strokePlan, polylinePoints } from './strokes.mjs';
import { handPose } from './pose.mjs';
import { handNodes, handOutline } from './shape.mjs';
import { flattenForHand } from './flatten.mjs';

export { strokePlan } from './strokes.mjs';
export { handPose } from './pose.mjs';
export { handNodes } from './shape.mjs';

const FPS = 30;
const COVER_SECONDS = 0.3;
// a word's entrance, and the colour a word not yet spoken is given (the ghost grey of a recolour look): what is written is
// written in the marker's own colour from the first stroke, never a grey that lights
const WORD_ENTRANCE = Object.freeze(['opacity', 'x', 'y', 'scale', 'ghost', 'fill']);
const EPS = 1e-6;

const keyed = (keys) => track(keys.length === 0 ? [{ t: 0, v: 0 }] : keys);
// 0 until `start`, rising to 1 at `end` (linear: the tip leads it), 1 from frame 0 for a stroke with no length of time
const progress = (start, end) => (end <= start + EPS ? track([{ t: 0, v: 1 }]) : track([{ t: 0, v: 0 }, { t: start, v: 0 }, { t: end, v: 1 }]));

// A stroked polyline's wobbled copy (a node the hand draws), the same for a seed and id.
function wobbled(n, look, seed, unit) {
  const points = polylinePoints(n.props.d);
  const style = look.hand?.wobble;
  if (points === null || !n.props.stroke || !style) return n;
  const d = polyline(wobble(points, deviceRng(seed, n.id, 'hand'), { ...style, u: unit }));
  return node(n.type, n.id, { ...n.props, d }, { tracks: n.tracks, children: n.children, wordTracks: n.wordTracks, step: n.step, depth: n.depth });
}

// A text's words without their entrances or ghost colours (what is written is never faded in or greyed); other word tracks
// stay. An opacity that only
// steps (0 or 1: the number's digits shown a step at a time) is not a fade and stays.
const isStep = (tr) => tr.points.every((k) => k.v === 0 || k.v === 1);
// A text whose words come on a step at a time (the number's `steps`) keeps those; any other text is written whole by its reveal, so
// a word is never held back to its spoken time (it showed as a grey half-word on the end kind's first sheet).
const writtenWords = (wordTracks, counted) => wordTracks.map((entry) => Object.fromEntries(Object.entries(entry)
  .filter(([name, tr]) => !WORD_ENTRANCE.includes(name) || (counted && name === 'opacity' && isStep(tr)))));

// One node per line of a written text, each revealed by its stroke.
function writtenLines(n, strokes) {
  const { layout } = n.props;
  return layout.lines.map((line, k) => {
    const s = strokes.find((x) => x.line === k);
    return node('text', layout.lines.length === 1 ? n.id : `${n.id}.line${k}`, { ...n.props, layout: { ...layout, lines: [line] } }, {
      tracks: { reveal: progress(s.start, s.end) }, wordTracks: writtenWords(n.wordTracks, n.props.steps !== undefined), depth: n.depth,
    });
  });
}

// The node as the hand draws it, from its strokes in the plan.
function drawnNode(n, strokes) {
  if (strokes.length === 0) return [n];
  if (n.type === 'text') return writtenLines(n, strokes);
  const [s] = strokes;
  const rest = Object.fromEntries(Object.entries(n.tracks).filter(([name]) => name !== 'draw' && name !== 'opacity'));
  const tracks = s.kind === 'fill' ? { ...rest, opacity: track([{ t: 0, v: s.end <= EPS ? 1 : 0 }, { t: s.end, v: 1 }]) } : { ...rest, draw: progress(s.start, s.end) };
  return [node(n.type, n.id, n.props, { tracks, children: n.children, step: n.step, depth: n.depth })];
}

// x and y tracks of the hand at every frame of the shot, a run of equal values kept to its ends (a still hand stays still).
function poseTracks(plan, look, ctx, duration) {
  const xs = [], ys = [];
  const frames = Math.ceil(duration * FPS);
  for (let f = 0; f <= frames; f++) {
    const t = Math.min(duration, f / FPS);
    const pose = handPose(plan, t, look, { canvas: ctx.canvas, unit: ctx.unit });
    for (const [keys, v] of [[xs, pose.x], [ys, pose.y]]) {
      if (keys.length >= 2 && keys.at(-1).v === v && keys.at(-2).v === v) keys.at(-1).t = t;
      else keys.push({ t, v });
    }
  }
  return { x: keyed(xs), y: keyed(ys) };
}

/** The hand's plan for a shot's nodes, as handLayer draws them (groups lifted, curves and fills made strokes, polylines wobbled). */
export function handPlan(shotNodes, timing, ctx) {
  const unit = ctx.unit ?? unitOf(ctx.canvas);
  const nodes = flattenForHand(shotNodes, ctx.look, unit).map((n) => (n.type === 'path' ? wobbled(n, ctx.look, ctx.seed ?? 0, unit) : n));
  return { nodes, plan: strokePlan(nodes, timing, ctx.look, { unit }) };
}

/**
 * The shot's nodes for a hand look: its elements as the hand draws them, then the hand. `ctx` is the shot's context
 * ({ look, canvas, unit, seed }). Returns `shotNodes` itself when the look has no hand.
 */
export function handLayer(shotNodes, timing, ctx) {
  const look = ctx.look;
  if (!look?.hand) return shotNodes;
  const { nodes, plan } = handPlan(shotNodes, timing, ctx);
  const drawn = nodes.flatMap((n) => drawnNode(n, plan.filter((s) => s.node === n.id)));
  const hand = node('group', 'hand', { role: 'hand', rotate: look.hand.angle ?? 0 }, {
    tracks: poseTracks(plan, look, { ...ctx, unit: ctx.unit ?? unitOf(ctx.canvas) }, timing.duration),
    children: handNodes(look, ctx.unit ?? unitOf(ctx.canvas)),
  });
  return [...drawn, hand];
}

// ---- findings ----

const inside = ([px, py], [x, y, w, h]) => px >= x && px <= x + w && py >= y && py <= y + h;
function inPolygon([px, py], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const corners = ([x, y, w, h]) => [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
const overlaps = (poly, box) => poly.some((p) => inside(p, box)) || corners(box).some((c) => inPolygon(c, poly));

// The windows [from, to] in which a text is the hand's own target (controller ruling, impl-l1): a stroke drawn over its ink box
// (an underline under a word, a ring round it) marks it, so the hand being on it while it does is the move, not a cover.
const MARKING_TAIL = 0.15; // s after such a stroke ends
function markingWindows(plan, box) {
  return plan.filter((s) => s.kind === 'line' && s.points.some((p) => inside(p, box))).map((s) => [s.start, s.end + MARKING_TAIL]);
}

// The hand's outline at a pose, in canvas px.
function outlineAt(outline, pose) {
  const r = (pose.angle * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return outline.map(([x, y]) => [pose.x + x * c - y * s, pose.y + x * s + y * c]);
}

/**
 * The plan's findings: { kind, rule, node, message, t }. `texts`: [{ id, box: [x, y, w, h], done }] the ink box of every
 * text the hand writes or that stands on the board, and the shot second it is finished. `opts`: { canvas, unit, duration }.
 */
export function handFindings(plan, look, texts, { canvas, unit = 1, duration }) {
  const fast = plan.filter((s) => s.speed > look.hand.maxSpeed);
  const out = fast.length === 0 ? [] : [{ kind: 'creative', rule: 'hand-speed', node: fast[0].node, t: fast[0].start,
    message: `too much to draw in this sentence (${Math.round(fast[0].speed)} units a second, the most is ${look.hand.maxSpeed}): cut an element or lengthen the line` }];
  const outline = handOutline(look, unit);
  const covered = new Map();
  const marking = new Map(texts.map((text) => [text.id, markingWindows(plan, text.box)]));
  let edge = null;
  for (let f = 0; f <= Math.ceil(duration * FPS); f++) {
    const t = Math.min(duration, f / FPS);
    const poly = outlineAt(outline, handPose(plan, t, look, { canvas, unit }));
    if (edge === null && poly.some(([x, y]) => x < 0 || y < 0)) edge = t;
    for (const text of texts) {
      const marked = marking.get(text.id).some(([from, to]) => t >= from - EPS && t <= to);
      const run = text.done <= t + EPS && !marked && overlaps(poly, text.box) ? (covered.get(text.id)?.run ?? 0) + 1 / FPS : 0;
      covered.set(text.id, { run, worst: Math.max(run, covered.get(text.id)?.worst ?? 0), at: run > COVER_SECONDS && !covered.get(text.id)?.at ? t : covered.get(text.id)?.at });
    }
  }
  for (const [id, { worst, at }] of covered) {
    if (worst > COVER_SECONDS) out.push({ kind: 'mechanical', rule: 'covered', node: id, t: at, message: `the hand rests over the finished text "${id}" for ${worst.toFixed(2)} s; the most is ${COVER_SECONDS} s` });
  }
  if (edge !== null) out.push({ kind: 'mechanical', rule: 'hand-edge', node: 'hand', t: edge, message: 'the hand crosses the top or left edge of the frame; it may leave only through the bottom or right edge' });
  return out;
}
