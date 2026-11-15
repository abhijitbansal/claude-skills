// The `tag` device: a small coloured label in caps. One group (the object entrance) holding the plate and a text
// node set in the look's label font at scale step 1. The tag measures its own text, so `build` needs `measure`, and
// it returns its measured box in `boxes.tag` ([x, y, w, h] in canvas pixels, top left at the given box's top left)
// so a caller can place things beside it; the given box's own size is not used. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { checkParams, isHand, styleOf, colourOf, deviceRng, spread, entrance, polyline, styledBy } from './shared.mjs';

const PAD_X = 18; // units
const PAD_Y = 10; // units
const SCALE_STEP = 1; // index into look.scale
const NO_WRAP = 1e6; // px: a tag is one line
const CORNER_JITTER = 1.5; // units, hand look
// Never accent2 here: text on it reaches only about 4:1 on desk paper. A look that styles the tag says otherwise.
const DEFAULT_FILL = 'ink';
const DEFAULT_TEXT = 'paper';
const HALF = 2;

function labelFont(look, unit) {
  const sizeUnits = look.scale[SCALE_STEP];
  const { family, weight, width } = look.fonts.label;
  return { family, weight, width, size: sizeUnits * unit, tracking: look.tracking(sizeUnits, 'label') };
}

function buildTag(params) {
  const { id, box, at, look, unit, seed, measure } = checkParams('tag', params, ['text']);
  const { text } = params;
  if (typeof text !== 'string' || text.trim() === '') throw new Error('tag: text must be a non-empty string');
  if (measure === undefined) throw new Error('tag: needs params.measure (text, font) => { width, ascent, descent } to size its plate');
  const font = labelFont(look, unit);
  const layout = layoutText({ text: look.caps.label ? text.toUpperCase() : text, font, maxWidth: NO_WRAP, measure });
  const w = layout.width + HALF * PAD_X * unit, h = layout.height + HALF * PAD_Y * unit;
  const style = styleOf(look, 'tag'), rng = deviceRng(seed, id, 'tag');
  const jitter = (p) => (isHand(look) ? [p[0] + spread(rng, CORNER_JITTER * unit), p[1] + spread(rng, CORNER_JITTER * unit)] : p);
  const plate = node('path', `${id}.plate`, {
    d: polyline([[-w / HALF, -h / HALF], [w / HALF, -h / HALF], [w / HALF, h / HALF], [-w / HALF, h / HALF]].map(jitter), true),
    fill: colourOf(look, style.fill ?? DEFAULT_FILL),
  });
  const label = node('text', `${id}.text`, {
    x: -w / HALF + PAD_X * unit, y: -h / HALF + PAD_Y * unit, layout, font, fill: colourOf(look, style.text ?? DEFAULT_TEXT),
  });
  const [x, y] = box;
  const group = entrance({ id, at, look, unit, cx: x + w / HALF, cy: y + h / HALF, children: [plate, label] });
  return { nodes: [group], boxes: { tag: [x, y, w, h] } };
}

export const tag = Object.freeze({
  name: 'tag',
  summary: 'A small coloured label in capitals.',
  supports: styledBy('tag'),
  build: buildTag,
});
