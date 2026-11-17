// Cuts between shots for the v2 engine. Importing this file registers the node cuts `cut`, `slide`, `cover` (cover.mjs),
// `punch` and `match`, and the layer cuts of layers.mjs, in registries.cuts (once: a second evaluation leaves the registry
// as it is). A node cut is { family, dur, apply,
// ... } (defineCut lists the fields) where apply({ from, to, p, canvas, look, frame, background, direction }) blends two
// sampled, camera-applied frames: `from` is the
// outgoing shot frozen at its end, `to` the incoming shot sampled live, p runs 0..1 over the first `dur` seconds of the
// incoming shot. Every cut returns `from` unchanged at p <= 0 and `to` unchanged at p >= 1. `frame`, when given, is
// how much p moves in one frame: `slide` and `punch` then draw a motion smear, the true average of SMEAR.samples
// pictures spread over SMEAR.span of a frame of travel, which exists only while the cut runs. `background` is the
// incoming shot's background colour (#rrggbb), painted under each sample so that every sample covers the frame.
// Pure and DOM-free.
import { registries } from '../registry.mjs';
import { ease } from '../time/ease.mjs';
import { stateKey } from '../graph/sample.mjs';
import { cover } from './cover.mjs';
import { LAYER_CUTS } from './layers.mjs';

const HALF = 2;
const SLIDE = Object.freeze({ dur: 0.4, ease: 'inOutCubic' });
const COVER = Object.freeze({ dur: 0.4 }); // its ease is cover.mjs's
const PUNCH = Object.freeze({ dur: 0.2, ease: 'outExpo', zoom: 1.15 });
const MATCH = Object.freeze({ dur: 0.5, ease: 'inOutCubic', outgoingShare: 0.4 });
const SMEAR = Object.freeze({ samples: 12, span: 0.5 }); // samples over this share of one frame of travel, centred on p
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

/** The edges a moving cut can bring the incoming shot from, first the default, each as the unit vector from the centre
 *  of the canvas toward that edge. */
export const EDGES = Object.freeze({ right: Object.freeze([1, 0]), left: Object.freeze([-1, 0]), up: Object.freeze([0, -1]), down: Object.freeze([0, 1]) });
const EDGE_NAMES = Object.freeze(Object.keys(EDGES));

// The endpoints are the plain frames; `blend` only ever sees 0 < p < 1. A node cut's registry entry (resolve.mjs reads
// it): `family` 'node', `dur` its default length, `directions` (the first the default) or null, `smearable` (it takes
// `smear`), `incomingOnly` (once p > 0 it draws only the incoming shot, as punch does, where a slide or a match still
// shows the outgoing one) and `example`, one valid `cut` value for --list cuts. `direction` reaches the blend as given,
// else the cut's first.
function defineCut({ dur, blend, summary, example, directions = null, smearable = false, incomingOnly = false }) {
  return Object.freeze({
    family: 'node',
    dur,
    summary,
    example,
    directions,
    smearable,
    incomingOnly,
    apply({ from, to, p, canvas, look, frame, background, direction }) {
      if (!Array.isArray(from) || !Array.isArray(to)) throw new Error('cut.apply needs from and to sampled frames');
      if (!Number.isFinite(p)) throw new Error(`cut.apply: p must be a finite number, got ${p}`);
      if (frame !== undefined && !(Number.isFinite(frame) && frame > 0)) throw new Error(`cut.apply: frame must be a number > 0, got ${frame}`);
      if (direction !== undefined && direction !== null && !directions?.includes(direction)) throw new Error(`cut.apply: direction must be one of ${(directions ?? ['none']).join(', ')}, got ${direction}`);
      if (p <= 0) return from;
      if (p >= 1) return to;
      return blend({ from, to, p, canvas, look, frame, background, direction: direction ?? directions?.[0] ?? null });
    },
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

// A group node at the identity, as sampleGraph would give it, holding `children`; `props` are its own.
const groupNode = (id, props, children, opacity = 1) => Object.freeze({
  type: 'group', id, depth: 0, props: Object.freeze(props),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity, draw: 1, reveal: 1, blur: 0, visible: opacity > 0,
  children: Object.freeze(children),
});

// A rectangle over the whole canvas in the shot's background colour: what the page paints before a frame.
export const backdropNode = (id, canvas, fill) => Object.freeze({
  type: 'path', id, depth: 0, props: Object.freeze({ d: `M0 0H${canvas.w}V${canvas.h}H0Z`, fill }),
  x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1, draw: 1, reveal: 1, blur: 0, visible: true, children: Object.freeze([]),
});

// `place(q)` gives the moving nodes where the cut has them at progress q; `still` are the nodes that do not move (the
// shared background). Without `frame` they are drawn once, at p. With it, the cut is SMEAR.samples pictures at the
// progress of evenly spread moments across SMEAR.span of a frame centred on p, each a layer (drawn as one picture: the
// page composites it whole, engine/page/draw.mjs) holding the backdrop, the still nodes and the moving nodes at that
// moment, so every layer covers the frame. Layer k is drawn at opacity 1 / (k + 1) over the layers before it: a running
// average, so each sample weighs 1 / samples in the result and no copy stands out (the first build drew 5 copies with
// a whole one on top, which read as separate echoes).
export function smeared(place, still, { p, frame, canvas, background }) {
  if (frame === undefined) return [...still, ...place(p)];
  const n = SMEAR.samples;
  return Array.from({ length: n }, (_, k) => {
    const q = clamp01(p + frame * SMEAR.span * (k / (n - 1) - 1 / HALF));
    const id = `smear${k}`;
    const backdrop = background === undefined ? [] : [backdropNode(`${id}.backdrop`, canvas, background)];
    return groupNode(id, { layer: true }, [...backdrop, ...still, ...place(q)], 1 / (k + 1));
  });
}

// Only the shot slides: the shared background stays (see backgroundNode()), so the cut happens over one surface. The
// incoming shot comes in from edge `direction` and pushes the outgoing one out by the opposite edge.
function slide({ from, to, p, canvas, frame, background, direction }) {
  const e = ease(SLIDE.ease)(p);
  const [ux, uy] = EDGES[direction];
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = backgroundIds(from, to);
  const leaving = from.filter((n) => !shared.has(n.id)), arriving = to.filter((n) => !shared.has(n.id));
  const still = to.filter((n) => shared.has(n.id)).map((n) => backgroundNode(outgoing.get(n.id), n, e));
  const place = (q) => {
    const eq = ease(SLIDE.ease)(q);
    return [...shifted(leaving, -ux * eq * canvas.w, -uy * eq * canvas.h), ...shifted(arriving, ...edgeOffset(direction, eq, canvas))];
  };
  return smeared(place, still, { p, frame, canvas, background });
}

function punch({ to, p, canvas, frame, background }) {
  const cx = canvas.w / HALF, cy = canvas.h / HALF;
  // a fixed node stays put, as it does under the camera, and in its place in the shot's order: a locked look's field
  // at the back, a pinned overlay (slug, kicker tag, caption) over the picture it sits on
  const zoomed = (q) => {
    const zoom = lerp(PUNCH.zoom, 1, ease(PUNCH.ease)(q));
    return to.map((n) => (n.props.fixed === true ? n : Object.freeze({ ...n, x: cx + (n.x - cx) * zoom, y: cy + (n.y - cy) * zoom, scale: n.scale * zoom })));
  };
  return smeared(zoomed, [], { p, frame, canvas, background });
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

const MATCH_FADE = 0.6; // of the cut: an unlike pair leaves over its first 60% and arrives over its last 60%
const HALF_WAY = 0.5; // an outgoing hero of an unlike pair drifts this share of the way toward the incoming one

// What a node shows, for deciding whether two heroes are the same: the words of its texts and the src of its images,
// through its groups.
function contentOf(n) {
  const own = n.type === 'text' ? (n.props.layout?.lines ?? []).flatMap((line) => line.words.map((w) => w.text)).join(' ') : n.type === 'image' ? n.props.src : '';
  return [own, ...n.children.map(contentOf)].join('|');
}

// Two shared heroes are the same hero when they are the same kind of node showing the same content; then the match
// morphs one into the other. Unlike ones (a statement into a number) are not scaled or reflowed into each other.
const sameHero = (a, b) => a.type === b.type && contentOf(a) === contentOf(b);

const centreOf = (n) => (Array.isArray(n.bbox) && boxSize(n.bbox) > 0 ? boxCentre(n.bbox) : [n.x, n.y]);

// How far the outgoing hero of an unlike pair has drifted toward the incoming one at progress p.
function offsetOf(from, into, p) {
  const f = clamp01(p / MATCH_FADE);
  const [a, b] = [centreOf(from), centreOf(into)];
  return [(b[0] - a[0]) * HALF_WAY * f, (b[1] - a[1]) * HALF_WAY * f];
}

// The outgoing hero of an unlike pair: not scaled, drifting up to half the way toward where the incoming hero stands
// while it fades out over the first MATCH_FADE of the cut.
function handOff(from, into, p) {
  const f = clamp01(p / MATCH_FADE);
  const [dx, dy] = offsetOf(from, into, p);
  return Object.freeze({ ...from, x: from.x + dx, y: from.y + dy, opacity: from.opacity * (1 - f), visible: from.opacity * (1 - f) > 0 });
}

// The incoming hero of an unlike pair: it fades in over the last MATCH_FADE of the cut, moving in from where the
// outgoing hero stands.
function handIn(from, into, p) {
  const f = clamp01((p - (1 - MATCH_FADE)) / MATCH_FADE);
  const e = ease(MATCH.ease)(f);
  const [a, b] = [centreOf(from), centreOf(into)];
  return Object.freeze({
    ...into, x: into.x + (a[0] - b[0]) * (1 - e), y: into.y + (a[1] - b[1]) * (1 - e),
    opacity: into.opacity * f, visible: into.opacity * f > 0,
  });
}

// Drawing order: the shared background the incoming frame starts with (shared nodes behind the picture plane, depth
// > 0, such as the field: see backgroundNode()), then the outgoing nodes fading out, then the rest of the incoming frame
// in its own order, a node identical in both passing through, a like shared node morphing in place and an unlike one
// handed over (handOff, handIn).
function match({ from, to, p }) {
  const e = ease(MATCH.ease)(p);
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = new Set(to.filter((n) => outgoing.has(n.id)).map((n) => n.id));
  const unlike = new Set(to.filter((n) => shared.has(n.id) && !(n.depth > 0) && !sameHero(outgoing.get(n.id), n)).map((n) => n.id));
  const leaving = new Set([...shared].filter((id) => !unlike.has(id)));
  const out = clamp01(1 - p / MATCH.outgoingShare);
  const into = clamp01((p - MATCH.outgoingShare) / (1 - MATCH.outgoingShare));
  const lead = to.findIndex((n) => !shared.has(n.id) || !(n.depth > 0));
  const split = lead < 0 ? to.length : lead;
  const blend = (n) => {
    if (!shared.has(n.id)) return faded(n, into);
    const a = outgoing.get(n.id);
    if (unlike.has(n.id)) return handIn(a, n, p);
    if (identical(a, n)) return n;
    return n.depth > 0 ? backgroundNode(a, n, e) : morph(a, n, e);
  };
  // The rest of the outgoing frame (a kicker, a highlight, a slug) leaves with its hero as one group: it drifts with it,
  // or the band would be left behind the text, and fades on the hero's own curve (handOff), not ahead of it.
  const lead0 = [...unlike][0];
  const drift = lead0 === undefined ? null : offsetOf(outgoing.get(lead0), to.find((t) => t.id === lead0), p);
  const withHero = 1 - clamp01(p / MATCH_FADE);
  const outgoingNode = (n) => {
    if (unlike.has(n.id)) return handOff(n, to.find((t) => t.id === n.id), p);
    const gone = faded(n, drift ? withHero : out);
    return drift && !(n.depth > 0) ? Object.freeze({ ...gone, x: gone.x + drift[0], y: gone.y + drift[1] }) : gone;
  };
  return [
    ...to.slice(0, split).map(blend),
    ...from.filter((n) => !leaving.has(n.id)).map(outgoingNode),
    ...to.slice(split).map(blend),
  ];
}

export const CUTS = Object.freeze({
  cut: defineCut({ dur: 0, blend: ({ to }) => to, summary: 'A hard cut: the next shot replaces the last on its first frame.', example: 'cut' }),
  slide: defineCut({
    dur: SLIDE.dur, blend: slide, directions: EDGE_NAMES, smearable: true, example: { type: 'slide', direction: 'left' },
    summary: 'The next shot slides in from an edge (right by default) and pushes the last one out by the other over 0.4 s.',
  }),
  cover: defineCut({
    dur: COVER.dur, blend: cover, directions: EDGE_NAMES, smearable: true, example: { type: 'cover', direction: 'up' },
    summary: 'The next shot slides in from an edge (right by default) over the last one, which stays where it is, over 0.4 s.',
  }),
  punch: defineCut({
    dur: PUNCH.dur, blend: punch, smearable: true, incomingOnly: true, example: 'punch',
    summary: 'The next shot lands zoomed in and settles to full size over 0.2 s.',
  }),
  match: defineCut({
    dur: MATCH.dur, blend: match, example: { type: 'match', duration: 0.6 },
    summary: 'Carries the node both shots share (see "hero") across in 0.5 s while the rest fades.',
  }),
});

for (const [name, cut] of Object.entries({ ...CUTS, ...LAYER_CUTS })) {
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
