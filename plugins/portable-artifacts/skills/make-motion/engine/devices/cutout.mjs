// The `cutout` device: an image placed as a physical object with a keyline and a contact shadow. It returns
// one group (the entrance: a fade, plus the look's slide or spring) holding the shadow, the keyline and the image,
// all positioned about the group's centre. For an opaque image the keyline and the shadow are rounded rectangles behind
// the picture; the shadow is an offset, darker copy, blurred when the look's shadow has a blur. With `alpha: true` (a
// picture with transparency: the kind passes ctx.asset(src).alpha) both follow the picture's own edge: the keyline is
// its silhouette dilated by the keyline's width, the shadow its silhouette offset and tinted. With `emphasisAt` (seconds) and a
// look whose cutout entry has `emphasis: { shadow, offset }`, the shadow changes on that second: the look's shadow goes
// and one in the `shadow` colour takes its place, growing from the look's offset to `offset` units with the emphasize
// move. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { checkParams, checkImage, isHand, styleOf, colourOf, deviceRng, spread, entrance, roundedRect, styledBy } from './shared.mjs';

const DEFAULT_KEYLINE_COLOUR = '#ffffff';
const CRISP_CORNER = 4; // units: the keyline corner radius in a crisp look (a hand look rounds by the keyline width)
const TILT = 1.2; // degrees: a hand look sets the cut-out down slightly crooked
const BLUR_TO_SIGMA = 2; // a look's blur is a canvas shadowBlur; the draw layer's blur is a standard deviation, half of it
const HALF = 2;

// The props a shadow copy carries beyond its shape: its alpha, and a blur only when the look's shadow has one.
function shadowLook(shadow, unit) {
  const props = { opacity: shadow.alpha };
  if (shadow.blur > 0) props.blur = (shadow.blur * unit) / BLUR_TO_SIGMA;
  return props;
}

// The shadow's emphasis: the look's shadow hidden on `at`, a copy in the emphasis colour shown on `at` and moving from the
// look's offset to the emphasis offset over the emphasize move. Both swaps are a step on the exact frame.
// `shape(nodeId, colour, props, opts)` builds a shadow or keyline in the cut-out's shape: a rounded rectangle for an
// opaque picture, the picture's own silhouette for one with transparency (shapeOf). Its props (x, y, opacity, blur)
// are positions relative to the shape's own origin.
function emphasisShadows(id, shape, look, unit, at) {
  const { shadow: colour, offset } = styleOf(look, 'cutout').emphasis;
  const move = look.moves.emphasize;
  const step = (before, after) => track(at === 0 ? [{ t: 0, v: after }] : [{ t: 0, v: before }, { t: at, v: before }, { t: at, v: after }]);
  const grow = (from) => track([...(at === 0 ? [] : [{ t: 0, v: from }]), { t: at, v: from }, { t: at + move.dur, v: offset * unit, ease: move.ease }]);
  const base = shape(`${id}.shadow`, colourOf(look, look.shadow.color), { ...shadowLook(look.shadow, unit), x: look.shadow.dx * unit, y: look.shadow.dy * unit }, {
    opacity: step(look.shadow.alpha, 0),
  });
  const lifted = shape(`${id}.shadow.emphasis`, colourOf(look, colour), shadowLook(look.shadow, unit), {
    opacity: step(0, look.shadow.alpha), x: grow(look.shadow.dx * unit), y: grow(look.shadow.dy * unit),
  });
  return [base, lifted];
}

// The two shapes. Opaque: a rounded rectangle `keyline` wider than the picture, filled. With transparency: the picture
// drawn as flat colour (draw.mjs props.silhouette), the keyline dilated by its width round the picture's own edge, the
// shadow undilated; both at the picture's origin, and both keep the picture's tracks (a clip's frame).
function shapeOf({ image, look, unit, origin, alpha }) {
  const { w, h } = image.props;
  const keyline = look.keyline * unit;
  if (alpha) {
    const silhouette = (spread) => (nodeId, colour, props, tracks = {}) => node('image', nodeId, {
      ...image.props, ...props, x: origin.x + (props.x ?? 0), y: origin.y + (props.y ?? 0), silhouette: { color: colour, spread },
    }, { tracks: { ...image.tracks, ...offsetTracks(tracks, origin) } });
    return { shadow: silhouette(0), keyline: silhouette(keyline) };
  }
  const radius = isHand(look) ? keyline : Math.min(CRISP_CORNER * unit, keyline);
  const d = roundedRect(origin.x - keyline, origin.y - keyline, w + HALF * keyline, h + HALF * keyline, radius);
  const rect = (nodeId, colour, props, tracks = {}) => node('path', nodeId, { d, fill: colour, ...props }, Object.keys(tracks).length > 0 ? { tracks } : {});
  return { shadow: rect, keyline: rect };
}

// A silhouette sits at the picture's origin, so its moving x and y tracks are moved there too.
function offsetTracks(tracks, origin) {
  const moved = { ...tracks };
  for (const axis of ['x', 'y']) {
    if (tracks[axis]) moved[axis] = track(tracks[axis].points.map((p) => ({ t: p.t, v: p.v + origin[axis], ease: p.ease })));
  }
  return moved;
}

function buildParts({ id, image, look, unit, emphasisAt, alpha }) {
  const { w, h } = image.props;
  const origin = { x: -w / HALF, y: -h / HALF };
  const keyColour = colourOf(look, styleOf(look, 'cutout').keylineColor ?? DEFAULT_KEYLINE_COLOUR);
  const offset = { x: look.shadow.dx * unit, y: look.shadow.dy * unit };
  const shape = shapeOf({ image, look, unit, origin, alpha });
  const emphasised = emphasisAt !== undefined && styleOf(look, 'cutout').emphasis !== undefined;
  return [
    ...(emphasised ? emphasisShadows(id, shape.shadow, look, unit, emphasisAt)
      : [shape.shadow(`${id}.shadow`, colourOf(look, look.shadow.color), { ...offset, ...shadowLook(look.shadow, unit) })]),
    shape.keyline(`${id}.keyline`, keyColour, {}),
    node('image', `${id}.image`, { ...image.props, ...origin }, { tracks: image.tracks }), // a clip's frame track plays on
  ];
}

function buildCutout(params) {
  const { id, box, at, look, unit, seed } = checkParams('cutout', params, ['image', 'alpha', 'emphasisAt']);
  const { emphasisAt } = params;
  if (emphasisAt !== undefined && !(Number.isFinite(emphasisAt) && emphasisAt >= 0)) throw new Error(`cutout: emphasisAt must be a second >= 0, got ${emphasisAt}`);
  const image = checkImage(params.image);
  if (params.alpha !== undefined && typeof params.alpha !== 'boolean') throw new Error(`cutout: alpha must be true or false, got ${JSON.stringify(params.alpha)}`);
  const { w, h } = image.props;
  const rotate = isHand(look) ? spread(deviceRng(seed, id, 'cutout'), TILT) : 0;
  const children = buildParts({ id, image, look, unit, emphasisAt, alpha: params.alpha === true });
  const group = entrance({ id, at, look, unit, cx: box[0] + w / HALF, cy: box[1] + h / HALF, rotate, children });
  return { nodes: [group] };
}

export const cutout = Object.freeze({
  name: 'cutout',
  summary: 'A picture placed as a physical object, with a keyline and a contact shadow.',
  supports: styledBy('cutout'),
  build: buildCutout,
});
