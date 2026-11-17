// The layer cuts: crossfade, fade, wipe, iris, zoom and blur. A layer cut does not move nodes; it composes two pictures,
// the outgoing shot frozen at its end and the incoming shot live (engine/graph/film.mjs frameAt gives both inside its
// window). Its entry's layers({ p, direction, canvas }) is a pure recipe for that composition:
//   { under: 'from' | 'to', from: Pose, to: Pose, backdrop: 'from' | 'to' | null }
//   Pose = { opacity, clip: { rect: [x, y, w, h] } | { circle: [cx, cy, r] } | null, scale (about the canvas centre),
//            blur (px) }
// `under` is drawn first, `backdrop` names whose background colour is painted under both (null: none, the picture under
// covers the frame). The recipe eases p itself; at p 0 the composition is the outgoing picture exactly and at p 1 the
// incoming one. The page composes it in canvas 2D (engine/page/cut-pictures.mjs), so a layer cut is the same picture
// with or without WebGL. Registered by index.mjs. Pure and DOM-free.
import { ease } from '../time/ease.mjs';

const LAYER_DUR = 0.4;
const LAYER_EASE = 'inOutCubic';
const ZOOM_FROM = Object.freeze({ in: 1.2, out: 0.8 }); // version 1's scales
const BLUR_SHARE = 24 / 1080; // version 1's 24 px blur on a 1080 px short side, as a share of the short side
const HALF = 2;
const WIPE_EDGES = Object.freeze(['left', 'right', 'up', 'down']);
const IRIS_WAYS = Object.freeze(['in', 'out']);

const pose = (fields = {}) => Object.freeze({ opacity: 1, clip: null, scale: 1, blur: 0, ...fields });
const UNTOUCHED = pose();
const recipe = (under, from, to, backdrop = null) => Object.freeze({ under, from, to, backdrop });
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const lerp = (a, b, e) => a + (b - a) * e;
const cornerReach = (canvas) => Math.hypot(canvas.w / HALF, canvas.h / HALF);

// The part of the canvas the incoming picture has reached at eased progress e, growing from `edge`.
function wipeRect(edge, e, { w, h }) {
  if (edge === 'left') return [0, 0, w * e, h];
  if (edge === 'right') return [w - w * e, 0, w * e, h];
  if (edge === 'up') return [0, 0, w, h * e];
  return [0, h - h * e, w, h * e];
}

const LAYERS = Object.freeze({
  crossfade: (e) => recipe('from', UNTOUCHED, pose({ opacity: e })),
  // a dip: the outgoing shot fades to the incoming background over the first half, the incoming one up over the second
  fade: (e, { p }) => recipe('from', pose({ opacity: 1 - ease(LAYER_EASE)(clamp01(p * HALF)) }), pose({ opacity: ease(LAYER_EASE)(clamp01(p * HALF - 1)) }), 'to'),
  wipe: (e, { direction, canvas }) => recipe('from', UNTOUCHED, pose({ clip: { rect: wipeRect(direction, e, canvas) } })),
  iris: (e, { direction, canvas }) => {
    const centre = [canvas.w / HALF, canvas.h / HALF], reach = cornerReach(canvas);
    if (direction === 'in') return recipe('from', UNTOUCHED, pose({ clip: { circle: [...centre, reach * e] } }));
    return recipe('to', pose({ clip: { circle: [...centre, reach * (1 - e)] } }), UNTOUCHED);
  },
  zoom: (e, { direction }) => recipe('from', UNTOUCHED, pose({ opacity: e, scale: lerp(ZOOM_FROM[direction], 1, e) })),
  blur: (e, { canvas }) => recipe('from', UNTOUCHED, pose({ opacity: e, blur: Math.max(0, BLUR_SHARE * Math.min(canvas.w, canvas.h) * (1 - e)) })),
});

// A layer cut's registry entry (resolve.mjs reads family, dur, directions, smearable, incomingOnly, example).
function defineLayer(name, { directions = null, summary, example }) {
  const build = LAYERS[name];
  return Object.freeze({
    family: 'layer', dur: LAYER_DUR, summary, example, directions, smearable: false, incomingOnly: false,
    layers({ p, direction, canvas }) {
      if (!Number.isFinite(p)) throw new Error(`${name}.layers: p must be a finite number, got ${p}`);
      if (directions !== null && !directions.includes(direction)) throw new Error(`${name}.layers: direction must be one of ${directions.join(', ')}, got ${direction}`);
      const q = clamp01(p);
      return build(ease(LAYER_EASE)(q), { p: q, direction, canvas });
    },
  });
}

/** The six layer cuts, as registry entries. */
export const LAYER_CUTS = Object.freeze({
  crossfade: defineLayer('crossfade', { example: 'crossfade', summary: 'The next shot fades in over the last one over 0.4 s.' }),
  fade: defineLayer('fade', { example: { type: 'fade', duration: 0.6 }, summary: 'The last shot fades to the next one\'s background, then the next one fades up, over 0.4 s.' }),
  wipe: defineLayer('wipe', { directions: WIPE_EDGES, example: { type: 'wipe', direction: 'up' }, summary: 'The next shot is uncovered from an edge (left by default) by a straight line over 0.4 s.' }),
  iris: defineLayer('iris', { directions: IRIS_WAYS, example: { type: 'iris', direction: 'out' }, summary: 'A circle opens from the centre on the next shot (in), or closes on the last one (out), over 0.4 s.' }),
  zoom: defineLayer('zoom', { directions: IRIS_WAYS, example: { type: 'zoom', direction: 'out' }, summary: 'The next shot fades in from 1.2 times its size (in) or 0.8 (out) over the last one, over 0.4 s.' }),
  blur: defineLayer('blur', { example: 'blur', summary: 'The next shot fades in from a blur over the last one over 0.4 s.' }),
});
