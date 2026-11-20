// The `tag` device: a small coloured label in caps. One group (the object entrance) holding the plate and a text
// node set in the look's label font at scale step 1. The tag measures its own text, so `build` needs `measure`, and
// it returns its measured box in `boxes.tag` ([x, y, w, h] in canvas pixels, top left at the given box's top left)
// so a caller can place things beside it; the given box's own size is not used (but by a ruled tag). A look whose tag style says
// `shape: 'pill'` (cosmos) gets a pill plate: a rounded rectangle whose radius is half its height. A style with a `rule`
// (ledger) is ruled: a thin rule runs right from the plate's mid height to the given box's right edge, which is then
// read. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { checkParams, isHand, styleOf, colourOf, deviceRng, spread, entrance, polyline, roundedRect, styledBy } from './shared.mjs';

const PAD_X = 18; // units
const PAD_Y = 10; // units
const SCALE_STEP = 1; // index into look.scale
const NO_WRAP = 1e6; // px: a tag is one line
const CORNER_JITTER = 1.5; // units, hand look
// Never accent2 here: text on it reaches only about 4:1 on desk paper. A look that styles the tag says otherwise.
const DEFAULT_FILL = 'ink';
const DEFAULT_TEXT = 'paper';
const HALF = 2;

// `size` (px, optional): the label's size in place of scale step 1 (a poster compare's side tag at its points' size, so
// the frame keeps two sizes)
function labelFont(look, unit, size) {
  const sizeUnits = size === undefined ? look.scale[SCALE_STEP] : size / unit;
  const { family, weight, width } = look.fonts.label;
  return { family, weight, width, size: sizeUnits * unit, tracking: look.tracking(sizeUnits, 'label') };
}

function buildTag(params) {
  const { id, box, at, look, unit, seed, measure } = checkParams('tag', params, ['text', 'size']);
  const { text, size } = params;
  if (typeof text !== 'string' || text.trim() === '') throw new Error('tag: text must be a non-empty string');
  if (measure === undefined) throw new Error('tag: needs params.measure (text, font) => { width, ascent, descent } to size its plate');
  if (size !== undefined && !(Number.isFinite(size) && size > 0)) throw new Error(`tag: size must be a positive number of px, got ${JSON.stringify(size)}`);
  const font = labelFont(look, unit, size);
  const layout = layoutText({ text: look.caps.label ? text.toUpperCase() : text, font, maxWidth: NO_WRAP, measure });
  const w = layout.width + HALF * PAD_X * unit, h = layout.height + HALF * PAD_Y * unit;
  const style = styleOf(look, 'tag'), rng = deviceRng(seed, id, 'tag');
  const jitter = (p) => (isHand(look) ? [p[0] + spread(rng, CORNER_JITTER * unit), p[1] + spread(rng, CORNER_JITTER * unit)] : p);
  const plate = node('path', `${id}.plate`, {
    d: style.shape === 'pill'
      ? roundedRect(-w / HALF, -h / HALF, w, h, h / HALF)
      : polyline([[-w / HALF, -h / HALF], [w / HALF, -h / HALF], [w / HALF, h / HALF], [-w / HALF, h / HALF]].map(jitter), true),
    fill: colourOf(look, style.fill ?? DEFAULT_FILL),
    // a drawn plate (marker): its outline, in the style's colour and width units; a plate in the board's own colour is no more than that
    ...(style.outline === undefined ? {} : { stroke: colourOf(look, style.outline.color), strokeWidth: style.outline.width * unit, lineCap: 'round' }),
  });
  const label = node('text', `${id}.text`, {
    x: -w / HALF + PAD_X * unit, y: -h / HALF + PAD_Y * unit, layout, font, fill: colourOf(look, style.text ?? DEFAULT_TEXT), role: 'tag',
  });
  const [x, y] = box;
  const rule = ruleNode(id, style.rule, { look, unit, w, reach: x + box[2] - (x + w / HALF) });
  const group = entrance({ id, at, look, unit, cx: x + w / HALF, cy: y + h / HALF, children: [plate, label, ...rule] });
  return { nodes: [group], boxes: { tag: [x, y, w, h] } };
}

// A ruled tag's rule (style.rule: { color, width units }, ledger): from the plate's right edge on its mid height to the
// given box's right edge (`reach`, group-local: the group sits on the plate's centre). None without the style, or when
// the box ends at the plate.
function ruleNode(id, rule, { look, unit, w, reach }) {
  if (rule === undefined || reach <= w / HALF) return [];
  return [node('path', `${id}.rule`, {
    d: polyline([[w / HALF, 0], [reach, 0]]), stroke: colourOf(look, rule.color), strokeWidth: rule.width * unit, lineCap: 'butt',
  })];
}

export const tag = Object.freeze({
  name: 'tag',
  summary: 'A small coloured label in capitals.',
  supports: styledBy('tag'),
  build: buildTag,
});
