// The plain tag (split out of shared.mjs; number, quote, end, chart): a tag built from plain nodes at a chosen scale
// step. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { entrance, colourOf, polyline } from '../devices/shared.mjs';
import { sizeAt, fontFor, setCase } from './shared.mjs';

const HALF = 2;

const TAG_PAD = Object.freeze({ x: 0.32, y: 0.2 }); // em of the tag's own size
const NO_WRAP = 1e6;
const TAG_FIT_EPSILON = 1e-6;

// The tag size from `toStep` down to `fromStep`: any size (scaled to fit), or only the scale steps (snapped).
function smoothTagSize(look, unit, { fromStep, toStep, maxWidth }, widthAt) {
  const size = sizeAt(look, toStep, unit), first = widthAt(size);
  return first > maxWidth ? Math.max(sizeAt(look, fromStep, unit), Math.floor((size * maxWidth) / first)) : size;
}
function snappedTagSize(look, unit, { fromStep, toStep, maxWidth }, widthAt) {
  const sizes = Array.from({ length: toStep - fromStep + 1 }, (_, i) => sizeAt(look, toStep - i, unit));
  return sizes.find((s) => widthAt(s) <= maxWidth + TAG_FIT_EPSILON) ?? sizes.at(-1);
}

/**
 * A tag built from plain nodes at a chosen scale step (the tag device sets every tag at step 2): `fill` behind label
 * caps in `text` colour (palette keys), at `toStep`, set smaller (down to `fromStep`) and then wrapped when it is wider
 * than `maxWidth`. Smaller is any size between the two steps, or with `snap` only the scale steps between them (the
 * largest that holds it on one line), never under `minSize` px. Its plate's top left at (left, top); it enters as an
 * object device does. `role`: the text's role for the review ('tag', left out of the hero rule, by default; a tag that
 * carries text a viewer must read as part of the hierarchy takes a role the rule judges). { nodes, box }.
 */
export function plainTag(ctx, id, words, { left, top, maxWidth, at, fromStep, toStep, fill, text, snap = false, role = 'tag', minSize = 0 }) {
  const { look, unit, measure } = ctx;
  const shown = setCase(look, 'label', words);
  const padded = (size, width) => width + HALF * TAG_PAD.x * size;
  const oneLine = (size) => layoutText({ text: shown, font: fontFor(look, 'label', size, unit), maxWidth: NO_WRAP, measure });
  const sized = snap ? snappedTagSize(look, unit, { fromStep, toStep, maxWidth }, (s) => padded(s, oneLine(s).width)) : smoothTagSize(look, unit, { fromStep, toStep, maxWidth }, (s) => padded(s, oneLine(s).width));
  const size = Math.max(sized, minSize);
  const font = fontFor(look, 'label', size, unit);
  const layout = layoutText({ text: shown, font, maxWidth: maxWidth - HALF * TAG_PAD.x * size, measure });
  const w = padded(size, layout.width), h = layout.height + HALF * TAG_PAD.y * size;
  const corners = [[-w / HALF, -h / HALF], [w / HALF, -h / HALF], [w / HALF, h / HALF], [-w / HALF, h / HALF]];
  const plate = node('path', `${id}.plate`, { d: polyline(corners, true), fill: colourOf(look, fill) });
  const label = node('text', `${id}.text`, {
    x: -w / HALF + TAG_PAD.x * size, y: -h / HALF + TAG_PAD.y * size, layout, font, fill: colourOf(look, text), role,
  });
  const group = entrance({ id, at, look, unit, cx: left + w / HALF, cy: top + h / HALF, children: [plate, label] });
  return { nodes: [group], box: [left, top, w, h] };
}
