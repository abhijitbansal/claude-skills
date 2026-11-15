// Looks for the v2 engine. Importing this file registers `desk` and `pop` in registries.looks (once: a second
// evaluation of this file leaves the registry as it is). Looks are frozen plain data plus pure functions; the grid
// helpers and applyAccent live here. Pure and DOM-free. The fields a look names (`paper`, `halftone`) are
// registered by engine/fields/index.mjs, which whoever draws the look imports.
import { registries } from '../registry.mjs';
import { unitOf } from '../units.mjs';
import { desk } from './desk.mjs';
import { pop } from './pop.mjs';

/**
 * A move in a look's motion grammar. `dur` is seconds; `dist` is a travel in units; `step` (fps) makes a hand
 * move advance in frames of 1/step s; `scale` is the starting scale of `enter` and the peak scale of `emphasize`.
 * @typedef {{ ease: string, dur: number, dist?: number, step?: number, overshoot?: number, scale?: number }} Move
 *
 * A typeface without a size. `width` is always a CSS font-stretch keyword (canvas reaches Archivo's width axis in
 * keyword steps only), `weight` a CSS weight. Fraunces carries no optical size: canvas picks it from the pixel size.
 * `wordSpace` (em), when given, is the space between words in place of the face's measured space.
 * @typedef {{ family: string, weight: number, width: string, wordSpace?: number }} Font
 *
 * @typedef {'display' | 'text' | 'label'} TrackingRole
 *
 * A complete art direction. Everything is in units (1 unit = short side / 1080 px) unless it says em, seconds or fps.
 * @typedef {object} Look
 * @property {string} name
 * @property {string[]} modes  the modes this look serves
 * @property {{ display: Font, text: Font, label: Font }} fonts
 * @property {{ paper: string, ink: string, ink2: string, accent: string, accent2: string, rule: string }} palette  #rrggbb
 * @property {[number, number, number, number, number]} scale  type sizes, small to large; scale[4] / scale[1] >= 3, scale[0] >= 28
 * @property {{ columns: 12, margin: number, gutter: number }} grid
 * @property {(sizeUnits: number, role?: TrackingRole) => number} tracking  letter spacing in em; role defaults to 'display'
 * @property {{ display: boolean, label: boolean }} caps  set in capitals
 * @property {{ display: number, text: number }} lineHeight  multiples of the font size
 * @property {{ display: number, text: number }} maxLines
 * @property {{ text: number }} wordsPerLine
 * @property {{ field: string, params: object }} field  a name in registries.fields and its params
 * @property {'editorial' | 'centred' | 'stack'} composition  how shots lay out: flush left on grid columns, centred, or
 *   a stack of short lines each set at its own size to fill the width, flush left
 * @property {'highlight' | 'recolor-scale' | 'recolor'} emphasis  a highlighter band, a recolour with a pulse, or a
 *   recolour alone
 * @property {{ enter: Move, exit: Move, emphasize: Move, draw: Move, count: Move }} moves
 * @property {number} wordStagger  seconds between words that have no spoken time; 0 means words follow their spoken times
 * @property {{ drift: number, style: 'desk' | 'locked' }} camera  drift is a travel in units
 * @property {string[]} cuts  a subset of cut, match, slide, punch
 * @property {number} keyline  width of a cut-out's keyline
 * @property {{ dx: number, dy: number, blur: number, alpha: number, color: string }} shadow  offset and blur in units, color #rrggbb
 * @property {Record<string, object>} devices  styling per device name; colours are palette keys or #rrggbb
 * @property {{ grain: number, halftone: number, bloom: number }} post  strengths from 0 to 1 of the post pass (engine/page/post.mjs), which
 *   runs over the WHOLE frame, pictures and clippings included: a halftone or a bloom above 0 dots or glows a screenshot
 *   as it does the paper, and without WebGL2 only the grain is applied (the review says so). Use halftone only for a look
 *   whose pictures should carry it; a look with a halftone field (pop) keeps it 0
 */

export { unitOf as unit };

const ACCENT_RE = /^#[0-9a-f]{6}$/i;
const RIGHT_EDGE = 13; // gridX's column for the right margin edge
const sameColour = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

// Freezes every object and array reachable from `value`; functions are left as they are.
function deepFreeze(value) {
  if (value !== null && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const columnWidth = (look, u, w) => (w - 2 * look.grid.margin * u - (look.grid.columns - 1) * look.grid.gutter * u) / look.grid.columns;

/** Left edge in pixels of 1-based `column` (1 to 12); 13 is the right margin edge. */
export function gridX(look, canvas, column) {
  if (!Number.isInteger(column) || column < 1 || column > RIGHT_EDGE) {
    throw new Error(`gridX: column must be an integer from 1 to ${RIGHT_EDGE}, got ${JSON.stringify(column)}`);
  }
  const u = unitOf(canvas);
  if (column === RIGHT_EDGE) return canvas.w - look.grid.margin * u;
  return look.grid.margin * u + (column - 1) * (columnWidth(look, u, canvas.w) + look.grid.gutter * u);
}

/** Columns `from` through `to` inclusive (1 to 12) as { x, w } in pixels: the left edge and the width. */
export function gridSpan(look, canvas, from, to) {
  const { columns } = look.grid;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > columns || from > to) {
    throw new Error(`gridSpan: columns must run from 1 to ${columns} with from <= to, got ${JSON.stringify(from)} to ${JSON.stringify(to)}`);
  }
  const x = gridX(look, canvas, from);
  const right = gridX(look, canvas, to) + columnWidth(look, unitOf(canvas), canvas.w);
  return { x, w: right - x };
}

/** A frozen copy of `look` whose palette.accent is `accent` (#rrggbb), and whose shadow colour follows when it was the accent. */
export function applyAccent(look, accent) {
  if (typeof accent !== 'string' || !ACCENT_RE.test(accent)) {
    throw new Error(`accent must be #rrggbb, for example "#ff6600", got ${JSON.stringify(accent)}`);
  }
  const shadow = sameColour(look.shadow.color, look.palette.accent) ? { ...look.shadow, color: accent } : look.shadow;
  return Object.freeze({
    ...look,
    palette: Object.freeze({ ...look.palette, accent }),
    shadow: Object.isFrozen(shadow) ? shadow : Object.freeze(shadow),
  });
}

for (const definition of [desk, pop]) {
  if (!registries.looks.has(definition.name)) registries.looks.add(definition.name, deepFreeze(definition));
}
