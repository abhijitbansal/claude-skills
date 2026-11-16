// The `numeral` device: one figure fitted to `box` in the look's display face, its digits in equal cells (kinds/shared.mjs
// numeralLayout, so "1" and "8" are the same width and a counting figure never jitters), and an optional unit
// (`unitText`) at UNIT_SHARE of its size, an affix whose cap line meets the figure's. It springs in with the look's `pop`
// move about its centre, landing on `at`. A layout device: kinds build it; an `on` event cannot place it (on: false).
// Returns { nodes: [group], boxes: { numeral: [x, y, w, h] } }. Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { numeralLayout } from '../kinds/shared.mjs';
import { checkParams, styleOf, colourOf, landing, styledBy } from './shared.mjs';

const REFERENCE = 100; // px: the size the figure is first set at, then scaled to the box
const UNIT_SHARE = 0.36; // the unit's size, of the figure's
const UNIT_GAP = 0.08; // em of the figure between the figure and its unit
const CAP_HEIGHT = 0.7; // em, when the measure reports no ink
const HALF = 2;

function displayFont(look, size, unit) {
  const { family, weight, width } = look.fonts.display;
  return { family, weight, width, size, tracking: look.tracking(size / unit, 'display') };
}

const capOf = (font, measure) => measure('0', font).inkAscent ?? CAP_HEIGHT * font.size;
const setCase = (look, text) => (look.caps.display ? text.toUpperCase() : text);

// The figure and unit layouts at `size`, and the total width they take.
function layoutsAt(size, { look, unit, measure, text, unitText }) {
  const figureFont = displayFont(look, size, unit);
  const figure = numeralLayout(text, figureFont, measure);
  const unitFont = unitText === undefined ? null : displayFont(look, size * UNIT_SHARE, unit);
  const after = unitFont ? numeralLayout(setCase(look, unitText), unitFont, measure) : null;
  const width = figure.width + (after ? UNIT_GAP * size + after.width : 0);
  return { figure, figureFont, after, unitFont, width };
}

// The largest size at which the figure and its unit fit the box: set at REFERENCE, scaled, and checked once more.
function fitted(box, opts) {
  const probe = layoutsAt(REFERENCE, opts);
  const size = REFERENCE * Math.min(box[2] / probe.width, box[3] / capOf(probe.figureFont, opts.measure));
  const first = layoutsAt(size, opts);
  return first.width <= box[2] ? first : layoutsAt(size * (box[2] / first.width), opts);
}

function buildNumeral(params) {
  const { id, box, at, look, unit, measure } = checkParams('numeral', params, ['text', 'unitText']);
  const { text, unitText } = params;
  if (typeof text !== 'string' || text.trim() === '') throw new Error('numeral: text must be a non-empty string');
  if (unitText !== undefined && (typeof unitText !== 'string' || unitText.trim() === '')) throw new Error('numeral: unitText, given, must be a non-empty string');
  if (measure === undefined) throw new Error('numeral: needs params.measure to fit its figure');
  const set = fitted(box, { look, unit, measure, text, unitText });
  const fill = colourOf(look, styleOf(look, 'numeral').color ?? 'ink');
  const capTop = box[1];
  const capH = capOf(set.figureFont, measure);
  const h = capH + (set.figure.height - set.figure.lines[0].y);
  const [cx, cy] = [box[0] + set.width / HALF, box[1] + h / HALF];
  const at0 = (layout, font) => capTop - (layout.lines[0].y - capOf(font, measure)) - cy;
  const children = [node('text', `${id}.figure`, { x: box[0] - cx, y: at0(set.figure, set.figureFont), layout: set.figure, font: set.figureFont, fill })];
  if (set.after) {
    const x = box[0] + set.figure.width + UNIT_GAP * set.figureFont.size - cx;
    children.push(node('text', `${id}.unit`, { x, y: at0(set.after, set.unitFont), layout: set.after, font: set.unitFont, fill, role: 'affix' }));
  }
  const move = look.moves.pop ?? look.moves.enter;
  const tracks = { opacity: landing(at, { ...move, ease: 'linear', dur: Math.min(move.dur, at) }, 0, 1) };
  if (move.scale !== undefined) tracks.scale = landing(at, move, move.scale, 1);
  return { nodes: [node('group', id, { x: cx, y: cy }, { tracks, children })], boxes: { numeral: [box[0], capTop, set.width, h] } };
}

export const numeral = Object.freeze({
  name: 'numeral',
  summary: 'One large figure with digits in equal cells and an optional smaller unit; built by shot kinds.',
  supports: styledBy('numeral'),
  on: false, // a layout device: kinds build it, an on event cannot place it
  build: buildNumeral,
});
