// The hand that draws a sketch scene: one illustrated hand holding a pencil in a tripod grip, drawn on the stage above the
// scenes, and where it is at any moment. `handPose` is a pure lookup over a scene's stroke plan, with no timing of its own, so
// it runs in Node too; only `handSvg` and `applyHand` touch the DOM. The drawing is original line art, its pencil point at the origin.
import { pointAt } from './geometry.mjs';
import { handHome } from './timing.mjs';
import { PALETTE } from './style.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HAND_BASE_SCALE = 0.4; // drawing units to px at hand.scale 1 on a 1080 canvas: 0.8 of the approved clip's 0.5
const LIFT_PX = 16; // px at 1080 the hand rises at the top of a move
const LIFT_DEGREES = 2; // and the degrees it tips back
const SWAY_DEGREES = 1.8; // the idle sway: this many degrees either way
const SWAY_RATE = 1.3; // radians per second
// Writing: the pencil follows a smoothed path, not the zig-zag that uncovers the letters.
const SMOOTH_WINDOW = 2.2 * 0.5; // reach either way along the path, in font sizes
const SMOOTH_STEPS = 3; // points each way, so the mean is of 7
const SMOOTH_KEEP = 0.32; // of the deviation from the mean added back
const HIDDEN = 'hidden';
const DEFAULT_TONE = 'medium';
const DEFAULT_SCALE = 1;

/** Each `sketch.hand.tone`: the skin's fill, and the darker shade of the pocket behind the pencil. */
export const HAND_TONE_FILLS = Object.freeze({
  light: Object.freeze({ fill: '#f8dfc9', shade: '#e6c3a6' }),
  medium: Object.freeze({ fill: '#eec39d', shade: '#d9a680' }),
  tan: Object.freeze({ fill: '#d8a57b', shade: '#bc8860' }),
  brown: Object.freeze({ fill: '#a97249', shade: '#8c5b37' }),
  dark: Object.freeze({ fill: '#6f462b', shade: '#573520' }),
});

/** An SVG node with `attrs`, inside `parent` when one is given. */
export function svgEl(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

// ---- the drawing -----------------------------------------------------------------------------------------------------------

// The tripod grip: pencil almost level and in front of the hand, index pad on top of it, thumb pad under it at the base of the
// wood cone, the hand behind, cut at the wrist. Back to front, as the shapes overlap.
const OUTLINE = Object.freeze({ stroke: PALETTE.ink, 'stroke-width': 9, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
const CREASE = Object.freeze({ ...OUTLINE, fill: 'none', 'stroke-width': 6 });
const FINGER_EDGE = Object.freeze({ ...CREASE, 'stroke-width': 9 });
const BODY = 'M96 -48 C90 -75 105 -110 128 -135 C148 -165 175 -195 205 -215 C235 -238 270 -250 305 -246 C345 -240 385 -238 420 -240 C470 -248 530 -252 565 -215 C590 -185 615 -130 640 -80 C660 -30 700 70 756 118 C767 128 767 137 758 146 C716 186 668 232 628 281 C620 291 610 295 598 289 C560 270 470 225 380 190 C330 170 290 165 250 158 C205 148 150 120 112 78 C92 58 92 40 104 25 L110 -30 Z';

function drawBack(g, { fill, shade }) {
  svgEl('path', { class: 'hand-body', d: BODY, fill, ...OUTLINE }, g);
  // The pocket between index and thumb, with the middle finger just visible inside it.
  svgEl('path', { d: 'M180 -30 C192 -70 225 -120 265 -135 C305 -128 360 -122 398 -138 C412 -100 415 -60 400 -25 Z', fill: shade, stroke: 'none' }, g);
  svgEl('path', { d: 'M262 -135 C300 -124 360 -120 398 -140', ...CREASE }, g);
  svgEl('path', { d: 'M255 -28 C258 -62 285 -92 330 -92 C362 -90 390 -70 402 -40', ...CREASE }, g);
  svgEl('path', { d: 'M398 -140 C412 -100 415 -62 402 -30', ...CREASE }, g);
}

function drawPencil(g) {
  const pencil = svgEl('g', { transform: 'rotate(-4.2)' }, g);
  svgEl('rect', { x: 125, y: -27, width: 800, height: 54, fill: '#f7c948', ...OUTLINE }, pencil);
  svgEl('path', { d: 'M125 -9 H925 M125 9 H925', stroke: '#c99a1e', 'stroke-width': 4, fill: 'none' }, pencil);
  svgEl('rect', { x: 925, y: -27, width: 46, height: 54, fill: '#b9bec7', ...OUTLINE }, pencil);
  svgEl('path', { d: 'M971 -27 C1012 -27 1012 27 971 27 Z', fill: '#ef8a9b', ...OUTLINE }, pencil);
  svgEl('path', { d: 'M125 -27 L0 0 L125 27 Z', fill: '#f3dcb8', ...OUTLINE }, pencil);
  svgEl('path', { class: 'pencil-lead', d: 'M38 -8.2 L0 0 L38 8.2 Z', fill: PALETTE.ink, stroke: PALETTE.ink, 'stroke-width': 3 }, pencil);
}

function drawFingers(g, { fill }) {
  // Index pad resting on top of the pencil.
  svgEl('path', { d: 'M96 -48 C90 -75 105 -110 128 -135 L265 -135 C225 -120 192 -82 178 -62 C160 -44 130 -30 110 -32 C100 -34 97 -40 96 -48 Z', fill, stroke: 'none' }, g);
  svgEl('path', { d: 'M128 -135 C105 -110 90 -75 96 -48 C97 -40 100 -34 110 -32 C130 -30 160 -44 178 -62 C192 -82 225 -120 265 -135 C275 -150 285 -160 300 -172', ...FINGER_EDGE }, g);
  // Thumb pad under it. Its fill covers the inside half of the hand's outline, so its edge is drawn back over the same curve,
  // all the way to where the outline runs on alone: one line of one width, with no step.
  svgEl('path', { d: 'M104 25 C92 40 92 58 112 78 C150 120 205 148 250 158 L270 60 L262 32 C230 18 190 8 150 10 C128 12 112 16 104 25 Z', fill, stroke: 'none' }, g);
  svgEl('path', { d: 'M250 158 C205 148 150 120 112 78 C92 58 92 40 104 25 C112 16 128 12 150 10 C190 8 230 18 262 32', ...FINGER_EDGE }, g);
  svgEl('path', { d: 'M248 108 C256 85 254 62 240 44', ...CREASE }, g);
  svgEl('path', { d: 'M126 62 C116 52 112 42 118 34', ...CREASE, opacity: 0.6 }, g);
}

/**
 * The hand as an `<svg id="sketch-hand">` to lay over the stage, hidden until `applyHand` shows it. `tone`: a key of
 * HAND_TONE_FILLS. `scale`: `sketch.hand.scale`. `unit`: the canvas's px per px at 1080. The pencil's point is at the origin of
 * the svg's first group, which `applyHand` moves.
 */
export function handSvg({ tone = DEFAULT_TONE, scale = DEFAULT_SCALE, unit }) {
  if (!Object.hasOwn(HAND_TONE_FILLS, tone)) throw new Error(`unknown hand tone "${tone}"; accepted: ${Object.keys(HAND_TONE_FILLS).join(', ')}`);
  const colours = HAND_TONE_FILLS[tone];
  const root = svgEl('svg', { id: 'sketch-hand', 'aria-hidden': 'true' });
  root.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none;display:none';
  const pose = svgEl('g', {}, root);
  const drawing = svgEl('g', { class: 'hand-scale', transform: `scale(${HAND_BASE_SCALE * scale * unit})` }, pose);
  drawBack(drawing, colours);
  drawPencil(drawing);
  drawFingers(drawing, colours);
  return root;
}

// ---- where it is ------------------------------------------------------------------------------------------------------------

const ease = (t) => t * t * (3 - 2 * t);

// The pencil on `stroke` at progress `p`: the stroke itself, or on writing the spike's smoothed path.
function onStroke(plan, stroke, p) {
  const here = pointAt(stroke, p);
  if (stroke.kind !== 'write' || stroke.total <= 0) return here;
  const reach = SMOOTH_WINDOW * plan.elements.get(stroke.path).fontSize;
  const mean = [0, 0];
  const count = 2 * SMOOTH_STEPS + 1;
  for (let i = -SMOOTH_STEPS; i <= SMOOTH_STEPS; i++) {
    const [x, y] = pointAt(stroke, p + ((i / SMOOTH_STEPS) * reach) / stroke.total);
    mean[0] += x / count;
    mean[1] += y / count;
  }
  return [mean[0] + (here[0] - mean[0]) * SMOOTH_KEEP, mean[1] + (here[1] - mean[1]) * SMOOTH_KEEP];
}

/**
 * Where the pencil's point is at `sec` (seconds in the scene) by `plan` (planScene's): `{ x, y, lift, visible }` in canvas px,
 * `lift` 0 to 1. Not visible, at home off the canvas, before the hand enters and from the moment it has left. Pure.
 */
export function handPose(plan, sec) {
  const { moves, strokes } = plan;
  if (!moves.length || sec < Math.min(moves[0].t0, strokes[0].t0) || sec >= moves.at(-1).t1) {
    const [x, y] = handHome(plan.size, plan.unit);
    return { x, y, lift: 0, visible: false };
  }
  const stroke = strokes.find((s) => sec >= s.t0 && sec <= s.t1);
  if (stroke) {
    const [x, y] = onStroke(plan, stroke, stroke.t1 > stroke.t0 ? (sec - stroke.t0) / (stroke.t1 - stroke.t0) : 1);
    return { x, y, lift: 0, visible: true };
  }
  const move = moves.find((m) => sec >= m.t0 && sec < m.t1);
  if (move) {
    const p = (sec - move.t0) / (move.t1 - move.t0);
    const k = ease(p);
    return { x: move.from[0] + (move.to[0] - move.from[0]) * k, y: move.from[1] + (move.to[1] - move.from[1]) * k, lift: Math.sin(Math.PI * p), visible: true };
  }
  // Waiting between strokes, for a later `drawAt`: where the last stroke ended.
  const [x, y] = strokes.findLast((s) => s.t1 <= sec).points.at(-1);
  return { x, y, lift: 0, visible: true };
}

/**
 * Poses the hand `node` for `plan` at `sec` (seconds in the scene); a null plan (a standard scene) hides it. Returns a string
 * that changes whenever the pose does.
 */
export function applyHand(node, plan, sec) {
  const pose = plan ? handPose(plan, sec) : null;
  if (!pose?.visible) {
    node.style.display = 'none';
    return HIDDEN;
  }
  const y = pose.y - pose.lift * LIFT_PX * plan.unit;
  const turn = SWAY_DEGREES * Math.sin(sec * SWAY_RATE) - pose.lift * LIFT_DEGREES;
  const transform = `translate(${pose.x.toFixed(2)} ${y.toFixed(2)}) rotate(${turn.toFixed(2)})`;
  node.style.display = '';
  node.firstElementChild.setAttribute('transform', transform);
  return transform;
}
