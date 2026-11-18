// The `erase` cut (looks-four Task 2, reworked in m5 for gate-marker-2 ruling 1): a board wiped clean by a felt eraser the
// hand holds. The old board's ink is taken off, never painted over: it is drawn on a layer of its own and the eraser's passes
// are soft-edged strips that remove it from that layer (blend destination-out), so the board under it, its tone and its frame
// line, is never touched and the board ends exactly as it was. The hand leaves with its marker, comes back holding the eraser,
// sweeps the board in PASSES passes, each a band as tall as the eraser, turning at the edges (the first from the right, the
// last ending on the right), takes the eraser out of frame, and the marker hand comes in to where the next board's first stroke
// is. One hand at every frame. A look with a hand writes nothing of the next board before the cut ends (look.hand.afterCut,
// strokes.mjs `lead`), so the next board is the empty field until the wipe is done. A node cut: it composes two sampled
// frames (engine/cuts/index.mjs registers it). Pure and DOM-free.
import { unitOf } from '../units.mjs';
import { eraserHand, handOf, withoutHand, placed, leaving, incomingHand, within } from './hands.mjs';

export const ERASE = Object.freeze({
  dur: 1.6, band: 300, sweepShare: 0.82, overlap: 0.15, soft: 0.04, feather: 3, featherUnits: 24, eraserShare: 1.3, longSide: 2.0,
  // the stretches of p: the marker hand leaves, the eraser comes in, the passes, the eraser leaves, the marker hand comes in
  markerOut: [0, 0.09], eraserIn: [0.09, 0.14], passes: [0.14, 0.86], eraserOut: [0.86, 0.91], markerIn: [0.92, 1],
});
const MASK_FILL = '#000000'; // a mask removes what is under it; its colour is never seen

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (v) => v * v * (3 - 2 * v);
// a hand speeds up and slows down along a pass, but only a little: half the way eased, half steady (a full ease peaks at 1.57
// times the average speed, a pass of a tall board would then cross the board in a few frames)
const inOut = (v) => 0.5 * clamp01(v) + 0.25 * (1 - Math.cos(Math.PI * clamp01(v)));
const lerp = (a, b, k) => a + (b - a) * k;

/** The erase's geometry for `canvas`: an even number of passes (the last ends where the first began), the band each covers, the eraser's sides. */
export function eraseGeometry(canvas) {
  const unit = unitOf(canvas);
  const count = Math.max(4, 2 * Math.round(canvas.h / (2 * ERASE.band * unit)));
  const band = canvas.h / count;
  const short = band * ERASE.eraserShare;
  return { unit, count, band, short, long: short * ERASE.longSide };
}

// where pass k is at p, as { x, y, sweeping, done }: x the eraser's centre along its pass, y the centre of its band
function passState(k, p, geo, canvas) {
  const slot = (ERASE.passes[1] - ERASE.passes[0]) / geo.count;
  const u = (p - ERASE.passes[0]) / slot - k;
  const rightToLeft = k % 2 === 0;
  const [from, to] = rightToLeft ? [canvas.w, 0] : [0, canvas.w];
  const y = (geo.band * (k + 0.5));
  if (u <= 0) return { x: from, y, started: false, done: false, rightToLeft };
  if (u >= 1) return { x: to, y, started: true, done: true, rightToLeft };
  const sweep = clamp01(u / ERASE.sweepShare);
  return { x: lerp(from, to, inOut(sweep)), y, started: true, done: sweep >= 1, rightToLeft };
}

// the eraser's centre at p, or null when it is out of frame: in from the right, along the passes (turning at the edges), out to the right
function eraserAt(p, geo, canvas) {
  const [in0, in1] = ERASE.eraserIn, [out0, out1] = ERASE.eraserOut;
  if (p < in0 || p > out1) return null;
  const outside = canvas.w + geo.long;
  const first = passState(0, ERASE.passes[0], geo, canvas), last = passState(geo.count - 1, ERASE.passes[1], geo, canvas);
  if (p < in1) return [lerp(outside, first.x, smooth(within(p, in0, in1))), first.y];
  if (p > out0) return [lerp(last.x, outside, smooth(within(p, out0, out1))), last.y];
  const slot = (ERASE.passes[1] - ERASE.passes[0]) / geo.count;
  const k = Math.min(geo.count - 1, Math.max(0, Math.floor((p - ERASE.passes[0]) / slot)));
  const u = (p - ERASE.passes[0]) / slot - k;
  const now = passState(k, p, geo, canvas);
  if (u <= ERASE.sweepShare || k === geo.count - 1) return [now.x, now.y];
  const next = passState(k + 1, ERASE.passes[0] + (k + 1) * slot, geo, canvas);
  return [now.x, lerp(now.y, next.y, smooth((u - ERASE.sweepShare) / (1 - ERASE.sweepShare)))];
}

const maskNode = (id, x0, y0, x1, y1, alpha) => Object.freeze({
  type: 'path', id, depth: 0, props: Object.freeze({ d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`, fill: MASK_FILL, blend: 'destination-out' }),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: alpha, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]),
});

// One pass's mask at p: a strip from the edge it started at to the eraser's leading edge (every edge soft: a few strips of falling
// strength at the front, and above and below the band), the whole board's width once the pass is done.
function passMask(k, p, geo, canvas) {
  const state = passState(k, p, geo, canvas);
  if (!state.started) return [];
  const margin = geo.long;
  const top = geo.band * (k - ERASE.overlap), bottom = geo.band * (k + 1 + ERASE.overlap); // solid, overlapping its neighbours: no line is left half in a band
  const edge = state.done ? (state.rightToLeft ? -margin : canvas.w + margin) : state.x + (state.rightToLeft ? -1 : 1) * geo.long / 2;
  const far = state.rightToLeft ? canvas.w + margin : -margin;
  const feather = ERASE.featherUnits * geo.unit;
  const step = feather / ERASE.feather;
  const dir = state.rightToLeft ? 1 : -1; // from the edge back toward where the pass began
  const solid = edge + dir * (state.done ? 0 : feather);
  const [x0, x1] = [Math.min(far, solid), Math.max(far, solid)];
  const id = `erase.pass${k}`;
  const nodes = [maskNode(`${id}.body`, x0, top, x1, bottom, 1)];
  for (let j = 0; j < ERASE.feather; j++) {
    const a = solid - dir * j * step, b = solid - dir * (j + 1) * step;
    if (!state.done) nodes.push(maskNode(`${id}.edge${j}`, Math.min(a, b), top, Math.max(a, b), bottom, 1 - (j + 1) / (ERASE.feather + 1)));
  }
  const rise = geo.band * ERASE.soft;
  for (let j = 0; j < ERASE.feather; j++) {
    const alpha = 1 - (j + 1) / (ERASE.feather + 1), h = rise / ERASE.feather;
    nodes.push(maskNode(`${id}.above${j}`, x0, top - (j + 1) * h, x1, top - j * h, alpha), maskNode(`${id}.below${j}`, x0, bottom + j * h, x1, bottom + (j + 1) * h, alpha));
  }
  return nodes;
}

const cache = new WeakMap();
function eraserFor(look, canvas, geo, like) {
  if (!cache.has(look)) cache.set(look, new Map());
  const key = `${canvas.w}x${canvas.h}`;
  const known = cache.get(look);
  if (!known.has(key)) known.set(key, eraserHand(look, canvas, geo.unit, [geo.long, geo.short], like));
  return known.get(key);
}

// The one hand of the frame at p (see the head of this file): [] when neither shot has a hand.
function handsAt({ from, to, landing, p, canvas, look }, geo) {
  const outgoing = handOf(from), incoming = handOf(to);
  if (!outgoing && !incoming) return [];
  if (p < ERASE.markerOut[1]) return outgoing ? [leaving(outgoing, within(p, ...ERASE.markerOut), canvas)] : [];
  const at = eraserAt(p, geo, canvas);
  if (at !== null) return [placed(eraserFor(look, canvas, geo, outgoing ?? incoming), at)];
  return incomingHand({ to, landing, p, canvas, from: ERASE.markerIn[0], until: ERASE.markerIn[1] });
}

function eraseBlend(args) {
  const { from, to, p, canvas, look } = args;
  const geo = eraseGeometry(canvas);
  const old = withoutHand(from).filter((n) => !(n.depth > 0));
  const masks = Array.from({ length: geo.count }, (_, k) => passMask(k, p, geo, canvas)).flat();
  // the old ink and what removes it, on a layer of their own: the board under is never covered
  const layer = Object.freeze({
    type: 'group', id: 'erase.old', depth: 0, props: Object.freeze({ layer: true }),
    x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true,
    children: Object.freeze([...old, ...masks]),
  });
  return [
    ...to.filter((n) => n.depth > 0),
    ...withoutHand(to).filter((n) => !(n.depth > 0)),
    layer,
    ...handsAt(args, geo),
  ];
}

export const erase = Object.freeze({
  family: 'node',
  dur: ERASE.dur,
  summary: 'A felt eraser the hand holds sweeps the old board off in soft-edged passes over 1.6 s, leaving the board its own tone and frame, and the marker hand comes back to write the next board: the marker look\'s cut.',
  example: 'erase',
  directions: null,
  smearable: false,
  incomingOnly: false,
  apply(args) {
    const { from, to, p } = args;
    if (!Array.isArray(from) || !Array.isArray(to)) throw new Error('cut.apply needs from and to sampled frames');
    if (!Number.isFinite(p)) throw new Error(`cut.apply: p must be a finite number, got ${p}`);
    if (p <= 0) return from;
    if (p >= 1) return to;
    return eraseBlend(args);
  },
});
