// The `code` kind's drawing: the panel (desk: a printout on the card device; pop: a dark panel with a thick outline and
// the offset accent shadow) and the shown text as rows of runs. A run is a stretch of one token with no space in it, set
// at its column (column x one character's measured advance), so a mono line keeps its spacing and each token its role
// colour. One size everywhere, the title included. Every run, sign, strike and highlight arrives as a step on its time
// (arrivals.mjs), never part-way. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { colourOf, roundedRect, landing } from '../devices/shared.mjs';
import { cardOf, rectPath } from './shared.mjs';
import { arrivalTrack } from './arrivals.mjs';

const NO_WRAP = 1e6;
const HALF = 2;
const SIGN_COLUMNS = 2; // a diff row's sign and its space
const STRIKE_AT = 0.55; // of the row's height from its top: where a removed line is struck (through the lower-case letters)

/** The layout font of code at `size` px: the look's mono, no tracking, one row `lineHeight` em. */
export const codeFont = (data, size) => ({ family: data.font.family, weight: data.font.weight, width: data.font.width ?? 'normal', size, tracking: 0, lineHeight: data.lineHeight });

/** The runs of a line of tokens: { text, role, col } for every stretch of non-space characters, col its first column. */
export function runsOf(tokens) {
  const runs = [];
  let col = 0;
  for (const token of tokens) {
    for (const m of token.text.matchAll(/\S+/g)) runs.push({ text: m[0], role: token.role, col: col + m.index });
    col += token.text.length;
  }
  return runs;
}

/** How many characters a line of tokens takes. */
export const widthOf = (tokens) => tokens.reduce((n, t) => n + t.text.length, 0);

// One run as a text node at its column in the row whose top is `top`; `fill` a colour, or a word fill track.
function runNode(id, run, { x, top, font, measure, fill, tracks, wordFill }) {
  const layout = layoutText({ text: run.text, font, maxWidth: NO_WRAP, measure });
  return node('text', id, { x, y: top, layout, font, fill }, { tracks, wordTracks: wordFill ? [{ fill: wordFill }] : [] });
}

/**
 * The text nodes of one row: its runs from column `from` (a diff row's sign columns before it), each shown at its own
 * time (`times[j]`, default 0) in its role's colour, or turned to `lit` at `litAt` (a pop highlight).
 * row: { id, tokens, top, field }; geo: { x (inner left), advance (px a column), font, measure }.
 */
export function rowNodes(row, geo, { look, data, times = [], from = 0, lit, litAt }) {
  // the part of a line past the panel's last column (geo.cols: a line too long for the reading floor) is cut off at the
  // panel's edge, not spilled; the review names the line to cut
  const room = (run) => (geo.cols === undefined ? Infinity : geo.cols - from - run.col);
  const kept = runsOf(row.tokens).map((run, j) => ({ run: room(run) >= [...run.text].length ? run : { ...run, text: [...run.text].slice(0, Math.max(0, room(run))).join('') }, j }));
  return kept.filter(({ run }) => run.text !== '').map(({ run, j }) => {
    const fill = colourOf(look, data.roles[run.role] ?? data.roles.plain);
    const wordFill = lit !== undefined ? track([{ t: 0, v: fill }, { t: litAt, v: fill }, { t: litAt, v: lit }]) : undefined;
    return runNode(`${row.id}.c${run.col}`, run, { x: geo.x + (from + run.col) * geo.advance, top: row.top, font: geo.font, measure: geo.measure, fill, tracks: { opacity: arrivalTrack(times[j] ?? 0) }, wordFill });
  });
}

/** A diff row's sign ("+" or "-") at the row's first column, shown from `at`, in `colour`. Its field is computed (null). */
export const signNode = (id, sign, geo, top, colour, at) => runNode(id, { text: sign, col: 0 }, { x: geo.x, top, font: geo.font, measure: geo.measure, fill: colour, tracks: { opacity: arrivalTrack(at) } });

/** A line struck through from `at`: a rule across `chars` columns from `from`, at the row's middle, `width` px thick. */
export function strikeNode(id, geo, { top, from, chars, colour, width, at }) {
  const y = top + (geo.font.lineHeight * geo.font.size) * STRIKE_AT;
  const x = geo.x + from * geo.advance;
  return node('path', id, { d: rectPath(chars * geo.advance, width), x, y: y - width / HALF, fill: colour }, { tracks: { opacity: arrivalTrack(at) } });
}

/** A highlighted row's band from `at`, half a column past the row each side: under the highlighter (desk, multiply) or
 *  an opaque lime plate whose row turns dark (pop, data.highlight.text). */
export function highlightNode(id, geo, { top, chars, data, look, at }) {
  const rowH = geo.font.lineHeight * geo.font.size;
  const style = data.highlight;
  const pad = geo.advance / HALF;
  return node('path', id, { d: rectPath(chars * geo.advance + HALF * pad, rowH), x: geo.x - pad, y: top, fill: colourOf(look, style.band), ...(style.multiply ? { blend: 'multiply' } : {}) }, { tracks: { opacity: arrivalTrack(at) } });
}

/** A row that moves from `dy` px off its rest to its rest with the look's settle move, starting at `at`: a group. */
export function movingRow(id, children, { dy, at, look }) {
  const move = look.moves.settle;
  const tracks = dy === 0 ? {} : { y: landing(at + move.dur, move, 0, -dy) };
  return node('group', id, {}, { tracks, children });
}

// pop's panel: the offset accent shadow, the dark body, then (over the content) the thick outline.
function popPanel(id, box, ctx, data, content) {
  const { look, unit } = ctx;
  const d = roundedRect(...box, 0);
  const { dx, dy, alpha, color } = look.shadow;
  return [
    node('path', `${id}.shadow`, { d, fill: colourOf(look, color), opacity: alpha, x: dx * unit, y: dy * unit }),
    node('path', `${id}.body`, { d, fill: colourOf(look, data.fill) }),
    ...content,
    node('path', `${id}.line`, { d, stroke: colourOf(look, data.line), strokeWidth: data.lineWidth * unit }),
  ];
}

/** The panel at `box` ([x, y, w, h]) holding `content`, on frame 0: the card (desk) or the outlined panel (pop). */
export function panelNodes(id, box, ctx, data, content) {
  if (data.card) return [cardOf(ctx, `${id}.card`, box, 0), ...content];
  return popPanel(id, box, ctx, data, content);
}

/** desk's rule under the title row, across the inner width: a hairline in the code's plain colour. */
export const titleRule = (id, geo, { inner, top, look, data, unit }) => node('path', id, { d: rectPath(inner.w, Math.max(1, unit)), x: inner.x, y: top - Math.max(1, unit), fill: colourOf(look, data.roles.comment) });

export { SIGN_COLUMNS };
