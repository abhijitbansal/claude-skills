// The `sticker` device: `children` (nodes in canvas pixels inside `box`) on an outlined cut shape, turned by a seeded
// angle inside the look's `devices.sticker.rotate` degrees, popping in with the look's enter move about the box centre
// and landing on `at`. Only a look that styles it draws it (pop); a layout device: kinds build it, an `on` event cannot
// place it (on: false). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { checkParams, styleOf, colourOf, deviceRng, spread, entrance, roundedRect, styledBy } from './shared.mjs';

const DEFAULT_PAD = 18; // units the cut shape reaches past the box
const DEFAULT_WIDTH = 8; // units of outline
const DEFAULT_ROTATE = 3; // degrees
const CORNER = 10; // units
const HALF = 2;

function buildSticker(params) {
  const { id, box, at, look, unit, seed } = checkParams('sticker', params, ['children']);
  const { children } = params;
  if (!Array.isArray(children)) throw new Error('sticker: children must be an array of nodes');
  const style = styleOf(look, 'sticker');
  const [x, y, w, h] = box;
  const pad = (style.pad ?? DEFAULT_PAD) * unit;
  const cx = x + w / HALF, cy = y + h / HALF;
  const d = roundedRect(-w / HALF - pad, -h / HALF - pad, w + HALF * pad, h + HALF * pad, CORNER * unit);
  const plate = node('path', `${id}.plate`, { d, fill: colourOf(look, style.fill ?? 'paper') });
  const outline = node('path', `${id}.outline`, { d, stroke: colourOf(look, style.outline ?? 'ink'), strokeWidth: (style.width ?? DEFAULT_WIDTH) * unit, lineCap: 'round' });
  const inner = node('group', `${id}.inner`, { x: -cx, y: -cy }, { children });
  const rotate = spread(deviceRng(seed, id, 'sticker'), style.rotate ?? DEFAULT_ROTATE);
  return { nodes: [entrance({ id, at, look, unit, cx, cy, rotate, children: [plate, outline, inner] })], boxes: { sticker: [x - pad, y - pad, w + HALF * pad, h + HALF * pad] } };
}

export const sticker = Object.freeze({
  name: 'sticker',
  summary: 'Parts set on an outlined cut-out shape, turned a little; built by shot kinds.',
  supports: styledBy('sticker'),
  on: false, // a layout device: kinds build it, an on event cannot place it
  build: buildSticker,
});
