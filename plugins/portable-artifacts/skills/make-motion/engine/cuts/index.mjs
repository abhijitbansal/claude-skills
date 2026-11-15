// Cuts between shots for the v2 engine. Importing this file registers `cut`, `slide`, `punch` and `match` in
// registries.cuts (once: a second evaluation leaves the registry as it is). A cut is { dur, apply } where
// apply({ from, to, p, canvas, look }) blends two sampled, camera-applied frames: `from` is the outgoing shot frozen
// at its end, `to` the incoming shot sampled live, p runs 0..1 over the first `dur` seconds of the incoming shot.
// Every cut returns `from` unchanged at p <= 0 and `to` unchanged at p >= 1. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { ease } from '../time/ease.mjs';

const HALF = 2;
const SLIDE = Object.freeze({ dur: 0.4, ease: 'inOutCubic' });
const PUNCH = Object.freeze({ dur: 0.2, ease: 'outExpo', zoom: 1.15 });
const MATCH = Object.freeze({ dur: 0.5, ease: 'inOutCubic', outgoingShare: 0.4 });
// A shared node's two copies cross over in the middle of the match: smoothstep between these points of the eased p.
const CROSS_FROM = 0.25;
const CROSS_TO = 0.75;
const DEGREES_TO_RADIANS = Math.PI / 180;

const lerp = (a, b, e) => a + (b - a) * e;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (lo, hi, v) => {
  const x = clamp01((v - lo) / (hi - lo));
  return x * x * (3 - 2 * x);
};

// The endpoints are the plain frames; `blend` only ever sees 0 < p < 1.
function defineCut(dur, blend) {
  return Object.freeze({
    dur,
    apply({ from, to, p, canvas, look }) {
      if (!Array.isArray(from) || !Array.isArray(to)) throw new Error('cut.apply needs from and to sampled frames');
      if (!Number.isFinite(p)) throw new Error(`cut.apply: p must be a finite number, got ${p}`);
      if (p <= 0) return from;
      if (p >= 1) return to;
      return blend({ from, to, p, canvas, look });
    },
  });
}

const shifted = (nodes, dx) => nodes.map((n) => Object.freeze({ ...n, x: n.x + dx }));

// A shared background (a node behind the picture plane, depth > 0, whose id both frames hold: the film's one field)
// stays where the incoming frame has it; only the rest slides, so the cut happens over one continuous surface.
function slide({ from, to, p, canvas }) {
  const e = ease(SLIDE.ease)(p);
  const outgoing = new Set(from.map((n) => n.id));
  const isBackground = (n) => n.depth > 0 && outgoing.has(n.id);
  const background = new Set(to.filter(isBackground).map((n) => n.id));
  return [
    ...to.filter((n) => background.has(n.id)),
    ...shifted(from.filter((n) => !background.has(n.id)), -e * canvas.w),
    ...shifted(to.filter((n) => !background.has(n.id)), (1 - e) * canvas.w),
  ];
}

function punch({ to, p, canvas }) {
  const zoom = lerp(PUNCH.zoom, 1, ease(PUNCH.ease)(p));
  const cx = canvas.w / HALF, cy = canvas.h / HALF;
  return to.map((n) => Object.freeze({ ...n, x: cx + (n.x - cx) * zoom, y: cy + (n.y - cy) * zoom, scale: n.scale * zoom }));
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
  const turn = b.rotate - a.rotate;
  const copies = [
    carry(a, { c0: pa.centre, c1: centre, k: size / pa.size, turn: turn * e, opacity: opacity * (1 - cross), id: `${a.id}.from` }),
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

// Drawing order: the shared background the incoming frame starts with (shared nodes behind the picture plane, depth
// > 0, such as the field), then the outgoing nodes fading out, then the rest of the incoming frame in its own order,
// shared nodes morphing in place.
function match({ from, to, p }) {
  const e = ease(MATCH.ease)(p);
  const outgoing = new Map(from.map((n) => [n.id, n]));
  const shared = new Set(to.filter((n) => outgoing.has(n.id)).map((n) => n.id));
  const out = clamp01(1 - p / MATCH.outgoingShare);
  const into = clamp01((p - MATCH.outgoingShare) / (1 - MATCH.outgoingShare));
  const lead = to.findIndex((n) => !shared.has(n.id) || !(n.depth > 0));
  const split = lead < 0 ? to.length : lead;
  const blend = (n) => (shared.has(n.id) ? morph(outgoing.get(n.id), n, e) : faded(n, into));
  return [
    ...to.slice(0, split).map(blend),
    ...from.filter((n) => !shared.has(n.id)).map((n) => faded(n, out)),
    ...to.slice(split).map(blend),
  ];
}

export const CUTS = Object.freeze({
  cut: defineCut(0, ({ to }) => to),
  slide: defineCut(SLIDE.dur, slide),
  punch: defineCut(PUNCH.dur, punch),
  match: defineCut(MATCH.dur, match),
});

for (const [name, cut] of Object.entries(CUTS)) {
  if (!registries.cuts.has(name)) registries.cuts.add(name, cut);
}
