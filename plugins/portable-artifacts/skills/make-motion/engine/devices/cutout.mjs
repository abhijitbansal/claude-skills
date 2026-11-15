// The `cutout` device: an opaque image placed as a physical object with a keyline and a contact shadow. It returns
// one group (the entrance: a fade, plus the look's slide or spring) holding the shadow, the keyline and the image,
// all positioned about the group's centre. The keyline and the shadow are rounded rectangles behind the picture; the
// shadow is an offset, darker copy, blurred when the look's shadow has a blur. An image with transparency needs an
// alpha-dilated keyline the draw layer cannot make yet, so `alpha: true` is refused. Pure and DOM-free.
import { node } from '../graph/node.mjs';
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

function buildParts({ id, image, look, unit }) {
  const { w, h } = image.props;
  const origin = { x: -w / HALF, y: -h / HALF };
  const keyline = look.keyline * unit;
  const keyColour = colourOf(look, styleOf(look, 'cutout').keylineColor ?? DEFAULT_KEYLINE_COLOUR);
  const offset = { x: look.shadow.dx * unit, y: look.shadow.dy * unit };
  const radius = isHand(look) ? keyline : Math.min(CRISP_CORNER * unit, keyline);
  const d = roundedRect(origin.x - keyline, origin.y - keyline, w + HALF * keyline, h + HALF * keyline, radius);
  return [
    node('path', `${id}.shadow`, { d, fill: colourOf(look, look.shadow.color), ...offset, ...shadowLook(look.shadow, unit) }),
    node('path', `${id}.keyline`, { d, fill: keyColour }),
    node('image', `${id}.image`, { ...image.props, ...origin }),
  ];
}

function buildCutout(params) {
  const { id, box, at, look, unit, seed } = checkParams('cutout', params, ['image', 'alpha']);
  const image = checkImage(params.image);
  if (params.alpha !== undefined && typeof params.alpha !== 'boolean') throw new Error(`cutout: alpha must be true or false, got ${JSON.stringify(params.alpha)}`);
  if (params.alpha === true) throw new Error('cutout: images with transparency are not supported yet');
  const { w, h } = image.props;
  const rotate = isHand(look) ? spread(deviceRng(seed, id, 'cutout'), TILT) : 0;
  const children = buildParts({ id, image, look, unit });
  const group = entrance({ id, at, look, unit, cx: box[0] + w / HALF, cy: box[1] + h / HALF, rotate, children });
  return { nodes: [group] };
}

export const cutout = Object.freeze({
  name: 'cutout',
  supports: styledBy('cutout'),
  build: buildCutout,
});
