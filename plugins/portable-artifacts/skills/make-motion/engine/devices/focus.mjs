// The `focus` device: the look's paper scrim over `cover` ([x, y, w, h]) with `box` left clear, so what is in the box
// reads and the rest recedes. Built on paperScrim (engine/kinds/shared.mjs), the scrim compare and the clipping use;
// those keep their own code. It rises to the look's `devices.focus.dim` over the draw move, landing on `at`. Pure and
// DOM-free.
import { paperScrim } from '../kinds/shared.mjs';
import { checkParams, styleOf, styledBy } from './shared.mjs';

const DEFAULT_DIM = 0.6;

function buildFocus(params) {
  const { id, box, at, look } = checkParams('focus', params, ['cover']);
  const { cover } = params;
  if (!Array.isArray(cover) || cover.length !== 4 || !cover.every(Number.isFinite)) throw new Error(`focus: cover must be [x, y, w, h], got ${JSON.stringify(cover)}`);
  const [x, y, w, h] = cover;
  const outline = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]; // clockwise; the hole goes the other way
  const scrim = paperScrim({ id, cover: [outline], hole: box, at, dur: look.moves.draw.dur, opacity: styleOf(look, 'focus').dim ?? DEFAULT_DIM, look });
  return { nodes: [scrim] };
}

export const focus = Object.freeze({
  name: 'focus',
  summary: 'A paper scrim over everything but its target, so the target reads and the rest recedes.',
  supports: styledBy('focus'),
  build: buildFocus,
});
