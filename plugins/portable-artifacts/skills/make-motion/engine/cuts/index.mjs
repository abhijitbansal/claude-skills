// Cuts between shots for the v2 engine. Importing this file registers the node cuts `cut`, `slide`, `cover` (cover.mjs),
// `punch` and `match`, the layer cuts of layers.mjs and the shader cuts of shaders/index.mjs, in registries.cuts (once: a second evaluation leaves the registry
// as it is). A node cut is { family, dur, apply,
// ... } (defineCut lists the fields) where apply({ from, to, p, canvas, look, background, direction }) blends two
// sampled, camera-applied frames: `from` is the
// outgoing shot frozen at its end, `to` the incoming shot sampled live, p runs 0..1 over the first `dur` seconds of the
// incoming shot. Every cut returns `from` unchanged at p <= 0 and `to` unchanged at p >= 1. `background` is the
// incoming shot's background colour (#rrggbb). A cut that can smear (slide, cover, punch) also has
// parts({ from, to, p, canvas, look, background, direction }) -> { still, moving(q), travel(q0, q1), vector, over }: the
// nodes that do not move (drawn first), the moving nodes at progress q, the largest distance in pixels a moving point
// covers between two progress values, the unit vector of the motion (null for a zoom), and the nodes drawn over the
// moving ones; [...still, ...moving(p), ...over] is what apply returns. engine/graph/film.mjs draws the smear from it
// (engine/cuts/smear.mjs). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { ease } from '../time/ease.mjs';
import { stateKey } from '../graph/sample.mjs';
import { coverParts } from './cover.mjs';
import { ENTRY_EDGE, entryVector } from './edges.mjs';
import { LAYER_CUTS } from './layers.mjs';
import { SHADER_CUTS } from './shaders/index.mjs';
import { erase } from './erase.mjs';

const HALF = 2;
const SLIDE = Object.freeze({ dur: 0.4, ease: 'inOutCubic' });
const COVER = Object.freeze({ dur: 0.4 }); // its ease is cover.mjs's
const PUNCH = Object.freeze({ dur: 0.2, ease: 'outExpo', zoom: 1.15 });
const MATCH = Object.freeze({ dur: 0.5, ease: 'inOutCubic', outgoingShare: 0.4 });
// A shared node's incoming copy fades in over its outgoing one between these points of the eased p; the outgoing copy
// stays at full strength until the incoming one is fully in, then leaves, so the pair never reads thinner than either.
const CROSS_FROM = 0.25;
const CROSS_TO = 0.75;
const SAME_PLACE = 1e-9;
const FRAME_EPSILON = 1e-9; // keeps 0.4 s x 30 fps = 12.000000000000002 on frame 12
const DEGREES_TO_RADIANS = Math.PI / 180;

const lerp = (a, b, e) => a + (b - a) * e;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (lo, hi, v) => {
  const x = clamp01((v - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
};

/** The directions a moving cut takes, first the default, each as the unit vector from the centre of the canvas toward
 *  the edge the incoming shot enters by (edges.mjs: a direction is the way it moves, so `left` enters at the right). */
export const EDGES = Object.freeze(Object.fromEntries(Object.keys(ENTRY_EDGE).map((direction) => [direction, entryVector(direction)])));
const EDGE_NAMES = Object.freeze(Object.keys(EDGES));

// The endpoints are the plain frames; `blend` only ever sees 0 < p < 1. A node cut's registry entry (resolve.mjs reads
// it): `family` 'node', `dur` its default length, `directions` (the first the default) or null, `smearable` (it takes
// `smear`), `incomingOnly` (once p > 0 it draws only the incoming shot, as punch does, where a slide or a match still
// shows the outgoing one) and `example`, one valid `cut` value for --list cuts. `direction` reaches the blend as given,
// else the cut's first. A cut given `parts` (see the head of this file) smears: its blend is the parts drawn at p.
function defineCut({ dur, blend, parts = null, summary, example, directions = null, incomingOnly = false }) {
  const checked = (args) => {
    const { from, to, p, direction } = args;
    if (!Array.isArray(from) || !Array.isArray(to)) throw new Error('cut.apply needs from and to sampled frames');
    if (!Number.isFinite(p)) throw new Error(`cut.apply: p must be a finite number, got ${p}`);
    if (direction !== undefined && direction !== null && !directions?.includes(direction)) throw new Error(`cut.apply: direction must be one of ${(directions ?? ['none']).join(', ')}, got ${direction}`);
    return { ...args, direction: direction ?? directions?.[0] ?? null };
  };
  const draw = parts === null ? blend : (args) => {
    const { still, moving, over } = parts(args);
    return [...still, ...moving(args.p), ...over];
  };
  return Object.freeze({
    family: 'node',
    dur,
    summary,
    example,
    directions,
    smearable: parts !== null,
    incomingOnly,
    apply(args) {
      const ready = checked(args);
      if (ready.p <= 0) return ready.from;
      if (ready.p >= 1) return ready.to;
      return draw(ready);
    },
    ...(parts === null ? {} : { parts: (args) => parts(checked(args)) }),
  });
}

/** `nodes` moved by (dx, dy) pixels. */
export const shifted = (nodes, dx, dy = 0) => nodes.map((n) => Object.freeze({ ...n, x: n.x + dx, y: n.y + dy }));

/** How far the incoming shot of a cut from edge `direction` is from its place at eased progress `e`, in pixels. */
export function edgeOffset(direction, e, canvas) {
  const [ux, uy] = EDGES[direction];
  return [ux * (1 - e) * canvas.w, uy * (1 - e) * canvas.h];
}
const samePlace = (a, b) => ['x', 'y', 'scale', 'rotate'].every((k) => Math.abs(a[k] - b[k]) < SAME_PLACE);

// A shared background (a node behind the picture plane, depth > 0, whose id both frames hold: the film's one field)
// is never redrawn twice: it is where the incoming frame has it, eased there from where the outgoing frame left it
// when the two differ (a shot that ended pushed in), so the surface neither dips nor snaps.
export function backgroundNode(from, to, e) {
  if (from === undefined || samePlace(from, to)) return to;
  return Object.freeze({ ...to, x: lerp(from.x, to.x, e), y: lerp(from.y, to.y, e), scale: lerp(from.scale, to.scale, e), rotate: lerp(from.rotate, to.rotate, e) });
}

export const backgroundIds = (from, to) => {
  const outgoing = new Set(from.map((n) => n.id));
  return new Set(to.filter((n) => n.depth > 0 && outgoing.has(n.id)).map((n) => n.id));
};

// A rectangle over the whole canvas in the shot's background colour: what the page paints before a frame.
export const backdropNode = (id, canvas, fill) => Object.freeze({
  type: 'path', id, depth: 0, props: Object.freeze({ d: `M0 0H${canvas.w}V${canvas.h}H0Z`, fill }),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]),
});

/** How far a point moves along an edge cut's axis between eased progress values of `curve`: the canvas side along the
 *  edge times the eased distance. */
export const edgeTravel = (curve, direction, canvas) => (q0, q1) => Math.abs(curve(q1) - curve(q0)) * (EDGES[direction][0] === 0 ? canvas.h : canvas.w);

// Only the shot slides: the shared background stays (see backgroundNode()), so the cut happens over one surface. The
// incoming shot comes in from edge `direction` and pushes the outgoing one out by the opposite edge.
function slideParts({ from, to, p, canvas, direction }) {
  const curve = ease(SLIDE.ease);
  const [ux, uy] = EDGES[direction];
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = backgroundIds(from, to);
  const leaving = from.filter((n) => !shared.has(n.id)), arriving = to.filter((n) => !shared.has(n.id));
  const still = to.filter((n) => shared.has(n.id)).map((n) => backgroundNode(outgoing.get(n.id), n, curve(p)));
  const moving = (q) => {
    const eq = curve(q);
    return [...shifted(leaving, -ux * eq * canvas.w, -uy * eq * canvas.h), ...shifted(arriving, ...edgeOffset(direction, eq, canvas))];
  };
  return { still, moving, travel: edgeTravel(curve, direction, canvas), vector: [ux, uy], over: [] };
}

// The punch zooms the incoming shot about the centre of the canvas. A fixed node stays put, as it does under the camera,
// and in its place in the shot's order: a locked look's field at the back (still), a pinned overlay (slug, kicker tag,
// caption) over the picture it sits on (over, or inside the moving run when a zoomed node lies over it).
// The zoom it lands at and its ease are the look's (look.cutMotion.punchZoom, punchEase; engine/looks), else PUNCH's.
function punchParts({ to, canvas, look }) {
  const cx = canvas.w / HALF, cy = canvas.h / HALF;
  const zoom0 = look?.cutMotion?.punchZoom ?? PUNCH.zoom;
  const curve = ease(look?.cutMotion?.punchEase ?? PUNCH.ease);
  const zoomOf = (q) => lerp(zoom0, 1, curve(q));
  const first = to.findIndex((n) => n.props.fixed !== true);
  const last = to.findLastIndex((n) => n.props.fixed !== true);
  const [lead, run, tail] = first < 0 ? [to, [], []] : [to.slice(0, first), to.slice(first, last + 1), to.slice(last + 1)];
  const moving = (q) => {
    const zoom = zoomOf(q);
    return run.map((n) => (n.props.fixed === true ? n : Object.freeze({ ...n, x: cx + (n.x - cx) * zoom, y: cy + (n.y - cy) * zoom, scale: n.scale * zoom })));
  };
  // a point shown at the corner of the canvas at zoom z sits (corner reach) / z from the centre in the shot
  const reach = Math.hypot(cx, cy);
  const travel = (q0, q1) => (reach * Math.abs(zoomOf(q1) - zoomOf(q0))) / Math.min(zoomOf(q0), zoomOf(q1));
  return { still: lead, moving, travel, vector: null, over: tail };
}

// ---- match ----

const boxCentre = (b) => [b[0] + b[2] / HALF, b[1] + b[3] / HALF];
const boxSize = (b) => Math.sqrt(Math.max(0, b[2] * b[3]));

// The similarity that carries `n` from (centre `c0`, size `s0`) to (centre `c1`, size `s1`) and turns it by `turn`
// degrees about the centre: x' = c1 + R(turn) k (x - c0), scale' = k scale, rotate' = rotate + turn.
function carry(n, { c0, c1, k, turn, opacity, id }) {
  const a = turn * DEGREES_TO_RADIANS, cos = Math.cos(a), sin = Math.sin(a);
  const dx = (n.x - c0[0]) * k, dy = (n.y - c0[1]) * k;
  return Object.freeze({
    ...n, id, x: c1[0] + dx * cos - dy * sin, y: c1[1] + dx * sin + dy * cos, scale: n.scale * k, rotate: n.rotate + turn,
    opacity, visible: opacity > 0,
  });
}

// Where a node is, as a centre and a size: its bbox when both ends have one, else its origin and its scale.
function placeOf(n, useBox) {
  return useBox ? { centre: boxCentre(n.bbox), size: boxSize(n.bbox) } : { centre: [n.x, n.y], size: Math.abs(n.scale) };
}

function morph(a, b, e) {
  const useBox = Array.isArray(a.bbox) && Array.isArray(b.bbox) && boxSize(a.bbox) > 0 && boxSize(b.bbox) > 0;
  const pa = placeOf(a, useBox), pb = placeOf(b, useBox);
  const centre = [lerp(pa.centre[0], pb.centre[0], e), lerp(pa.centre[1], pb.centre[1], e)];
  const size = lerp(pa.size, pb.size, e);
  const opacity = lerp(a.opacity, b.opacity, e);
  const cross = smoothstep(CROSS_FROM, CROSS_TO, e);
  const leave = smoothstep(CROSS_TO, 1, e);
  const turn = b.rotate - a.rotate;
  const copies = [
    carry(a, { c0: pa.centre, c1: centre, k: size / pa.size, turn: turn * e, opacity: opacity * (1 - leave), id: `${a.id}.from` }),
    carry(b, { c0: pb.centre, c1: centre, k: size / pb.size, turn: -turn * (1 - e), opacity: opacity * cross, id: `${b.id}.to` }),
  ];
  // A group at the identity holding both copies: one node with the shared id, drawn on top of the frame.
  const out = {
    type: 'group', id: b.id, depth: b.depth, props: Object.freeze({ match: true }),
    x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true,
    children: Object.freeze(copies),
  };
  if (useBox) out.bbox = a.bbox.map((v, i) => lerp(v, b.bbox[i], e));
  return Object.freeze(out);
}

const faded = (n, factor) => Object.freeze({ ...n, opacity: n.opacity * factor, visible: n.opacity * factor > 0 });

// The same node in the same state in both frames (its bbox aside) passes through untouched.
const identical = (a, b) => stateKey({ ...a, bbox: undefined }) === stateKey({ ...b, bbox: undefined });

// An unlike pair hands over on one path: the outgoing copy is gone and the incoming one arrives between these points of
// p, so the two sets of words are never legible at once (look review gate-cuts-1 D1). Late in the window (round 2
// ruling 2): the ease does most of its travel around the middle, so a hand-over there hid the move; now the old line is
// seen travelling and resizing most of the way (to 0.89 of the path at p 0.7) before the words change where it lands.
const HAND_FROM = 0.7;
const HAND_TO = 0.9;
const HAND_MID = (HAND_FROM + HAND_TO) / HALF;

// What a node shows, for deciding whether two heroes are the same: the words of its texts and the src of its images,
// through its groups.
function contentOf(n) {
  const own = n.type === 'text' ? (n.props.layout?.lines ?? []).flatMap((line) => line.words.map((w) => w.text)).join(' ') : n.type === 'image' ? n.props.src : '';
  return [own, ...n.children.map(contentOf)].join('|');
}

// Two shared heroes are the same hero when they are the same kind of node showing the same content; then the match
// morphs one into the other. Unlike ones (a statement into a number) are not scaled or reflowed into each other.
const sameHero = (a, b) => a.type === b.type && contentOf(a) === contentOf(b);

// A line of type is carried by what a reader sees of it (round 2 ruling 2): its type size and where its first line
// starts. Two statements reflow into boxes of nearly the same area and centre, so a carry by box hid the type shrinking
// from one size to the other and moved the slot about 20 px; by type, the old line visibly shrinks and moves into the
// new one, and lines set far apart travel the whole way.
const isTypeLine = (n) => n.type === 'text' && Number.isFinite(n.props.layout?.size) && n.props.layout.size > 0 && n.props.layout.lines?.length > 0;
const typePlace = (n) => ({
  centre: [n.x + n.props.layout.lines[0].x * n.scale, n.y + n.props.layout.lines[0].y * n.scale],
  size: n.props.layout.size * Math.abs(n.scale),
});

// An unlike pair (a line into a different line) handed over on one path: both copies ride the same centre and size
// from where the outgoing hero stood to where the incoming one stands, as morph() carries a like pair, but the outgoing
// copy is gone before the incoming one shows (HAND_FROM to HAND_TO), so the slot is carried and the words change in
// flight instead of piling up.
function handOver(a, b, e, p) {
  const useBox = Array.isArray(a.bbox) && Array.isArray(b.bbox) && boxSize(a.bbox) > 0 && boxSize(b.bbox) > 0;
  const [pa, pb] = isTypeLine(a) && isTypeLine(b) ? [typePlace(a), typePlace(b)] : [placeOf(a, useBox), placeOf(b, useBox)];
  const centre = [lerp(pa.centre[0], pb.centre[0], e), lerp(pa.centre[1], pb.centre[1], e)];
  const size = lerp(pa.size, pb.size, e);
  const turn = b.rotate - a.rotate;
  const copies = [
    carry(a, { c0: pa.centre, c1: centre, k: size / pa.size, turn: turn * e, opacity: a.opacity * (1 - smoothstep(HAND_FROM, HAND_MID, p)), id: `${a.id}.from` }),
    carry(b, { c0: pb.centre, c1: centre, k: size / pb.size, turn: -turn * (1 - e), opacity: b.opacity * smoothstep(HAND_MID, HAND_TO, p), id: `${b.id}.to` }),
  ];
  return Object.freeze({
    type: 'group', id: b.id, depth: b.depth, props: Object.freeze({ match: true }),
    x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true,
    children: Object.freeze(copies), ...(useBox ? { bbox: a.bbox.map((v, i) => lerp(v, b.bbox[i], e)) } : {}),
  });
}

// Drawing order: the shared background the incoming frame starts with (shared nodes behind the picture plane, depth
// > 0, such as the field: see backgroundNode()), then the outgoing nodes fading out, then the rest of the incoming frame
// in its own order, a node identical in both passing through, a like shared node morphing in place and an unlike one
// handed over on the same path (handOver). The rest of the outgoing frame is gone before the rest of the incoming one
// arrives (MATCH.outgoingShare), so two kickers never stand at once.
function match({ from, to, p }) {
  const e = ease(MATCH.ease)(p);
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = new Set(to.filter((n) => outgoing.has(n.id)).map((n) => n.id));
  const out = clamp01(1 - p / MATCH.outgoingShare);
  const into = clamp01((p - MATCH.outgoingShare) / (1 - MATCH.outgoingShare));
  const lead = to.findIndex((n) => !shared.has(n.id) || !(n.depth > 0));
  const split = lead < 0 ? to.length : lead;
  const blend = (n) => {
    if (!shared.has(n.id)) return faded(n, into);
    const a = outgoing.get(n.id);
    if (identical(a, n)) return n;
    if (n.depth > 0) return backgroundNode(a, n, e);
    return sameHero(a, n) ? morph(a, n, e) : handOver(a, n, e, p);
  };
  return [
    ...to.slice(0, split).map(blend),
    ...from.filter((n) => !shared.has(n.id)).map((n) => faded(n, out)),
    ...to.slice(split).map(blend),
  ];
}

export const CUTS = Object.freeze({
  cut: defineCut({ dur: 0, blend: ({ to }) => to, summary: 'A hard cut: the next shot replaces the last on its first frame.', example: 'cut' }),
  slide: defineCut({
    dur: SLIDE.dur, parts: slideParts, directions: EDGE_NAMES, example: { type: 'slide', direction: 'right' },
    summary: 'The next shot slides in moving the way the direction names and pushes the last one out ahead of it: left (the default) comes in from the right edge, right from the left, up from below, down from above, over 0.4 s.',
  }),
  cover: defineCut({
    dur: COVER.dur, parts: coverParts, directions: EDGE_NAMES, example: { type: 'cover', direction: 'up' },
    summary: 'The next shot slides in over the last one, which stays where it is, moving the way the direction names: left (the default) comes in from the right edge, right from the left, up from below, down from above, over 0.4 s.',
  }),
  punch: defineCut({
    dur: PUNCH.dur, parts: punchParts, incomingOnly: true, example: 'punch',
    summary: 'The next shot lands zoomed in and settles to full size over 0.2 s.',
  }),
  match: defineCut({
    dur: MATCH.dur, blend: match, example: { type: 'match', duration: 0.6 },
    summary: 'Carries the node both shots share (see "hero") across in 0.5 s while the rest fades.',
  }),
});

// erase (erase.mjs): the drawing hand's board wipe, registered last so the earlier cuts keep their order
for (const [name, cut] of Object.entries({ ...CUTS, ...LAYER_CUTS, ...SHADER_CUTS, erase })) {
  if (!registries.cuts.has(name)) registries.cuts.add(name, cut);
}

const isResolved = (cut) => cut !== null && typeof cut === 'object' && Number.isFinite(cut.dur) && typeof cut.name === 'string';

/**
 * The first frame of a shot, counted from its start, that shows the incoming shot alone after `cut`, a cut as
 * resolve.mjs resolveCut gives it: 0 for a hard cut (no window); 1 for a cut that draws only the incoming shot once p > 0
 * (punch: on p 0 the outgoing shot is still the frame); null for a cut whose whole window shows the outgoing shot too
 * (slide, match).
 */
export function aloneFromFrame(cut) {
  if (!isResolved(cut)) throw new TypeError(`aloneFromFrame needs a resolved cut (resolve.mjs resolveCut), got ${JSON.stringify(cut)}`);
  if (cut.dur === 0) return 0;
  return cut.incomingOnly === true ? 1 : null;
}

/** As aloneFromFrame, and for a slide or a match the first frame after its window at `fps`: where the shot is alone. */
export function aloneAfterFrame(cut, fps) {
  return aloneFromFrame(cut) ?? Math.ceil(cut.dur * fps - FRAME_EPSILON);
}
