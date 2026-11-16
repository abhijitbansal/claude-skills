// The `sweep` device: a slanted band of light that crosses `box` once, centred on `at`, screened so it only lightens.
// The band is SOFT_RINGS nested strips (its soft edge, with no gradient or blur filter), and its travel keeps every strip
// inside the box, fading in at the left edge and out at the right, so it never needs a clip. Only a look that styles it
// draws it (pop; paper has no light, so desk declines it). Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { checkParams, styleOf, colourOf, ringAlpha, polyline, styledBy, SOFT_RINGS } from './shared.mjs';

const BAND = 0.16; // of the box width
const SLANT = 0.27; // the band's lean, of the box height (about 15 degrees)
const SLANT_MAX = 0.2; // ...at most this share of the box width
const DURATION = 0.7; // s the crossing takes
const FADE = 0.2; // of the crossing spent fading in, and again fading out
const DEFAULT_ALPHA = 0.35;
const TRAVEL_EASE = 'inOutCubic';

// The nested strips of a band `bw` wide leaning `lean` over height h, in the band's own space (x from 0 to bw + lean).
function strips(id, bw, lean, h, fill, alpha) {
  return Array.from({ length: SOFT_RINGS }, (_, i) => {
    const inset = (bw * i) / (2 * SOFT_RINGS);
    const points = [[lean + inset, 0], [lean + bw - inset, 0], [bw - inset, h], [inset, h]];
    return node('path', `${id}.strip${i}`, { d: polyline(points, true), fill, opacity: ringAlpha(alpha) });
  });
}

function buildSweep(params) {
  const { id, box, at, look } = checkParams('sweep', params);
  const [x, y, w, h] = box;
  const style = styleOf(look, 'sweep');
  const bw = BAND * w, lean = Math.min(SLANT * h, SLANT_MAX * w);
  const start = Math.max(0, at - DURATION / 2), end = start + DURATION;
  const travel = track([{ t: start, v: x }, { t: end, v: x + w - bw - lean, ease: TRAVEL_EASE }]);
  const fade = FADE * DURATION;
  const opacity = track([{ t: 0, v: 0 }, { t: start, v: 0 }, { t: start + fade, v: 1 }, { t: end - fade, v: 1 }, { t: end, v: 0 }]);
  const children = strips(id, bw, lean, h, colourOf(look, style.color ?? 'ink'), style.alpha ?? DEFAULT_ALPHA);
  return { nodes: [node('group', id, { y, blend: 'screen' }, { tracks: { x: travel, opacity }, children })] };
}

export const sweep = Object.freeze({
  name: 'sweep',
  summary: 'A band of light that crosses its target once, as a glint on a screen.',
  supports: styledBy('sweep'),
  build: buildSweep,
});
