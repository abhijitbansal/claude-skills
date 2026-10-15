// Node, edge-label and group sizing from font metrics plus per-shape padding.
// Every figure is a px constant here so the renderer, the stylesheet and the
// geometry lint can reuse them; nothing is measured in a browser.
import { measure, wrap, lineHeight, fontFor } from '../../shared/text.mjs';
import { BOX_SHAPES } from './kinds.mjs';

export const MAX_TEXT_WIDTH = 180; // wrap labels here first
export const MAX_WIDENED_TEXT_WIDTH = 240; // a label that needs a third line widens the wrap, up to here
export const MAX_LABEL_LINES = 2;
const WIDEN_STEP = 10;

export const LABEL_SIZE = 14;
export const NOTE_SIZE = 11; // the note, in the theme's mono font
export const TYPE_SIZE = 10; // the kind, in spaced capitals above the label
export const TYPE_TRACK = 0.8; // px of letter-spacing per character (.08em at 10 px); measure() knows no tracking
export const TYPE_GAP = 2; // type line to label block
export const EDGE_LABEL_SIZE = 12;
export const LEGEND_SIZE = 11;
export const GROUP_LABEL_SIZE = 11;
export const GROUP_TRACK = 0.9; // .08em at 11 px: group labels are drawn in spaced capitals
export const EMOJI_SIZE = 18; // an emoji in the tile (css.mjs draws .pa-emoji at this size)
export const TILE_SIZE = 28; // the icon or emoji tile
export const TILE_GAP = 10; // tile to text
export const TILE_PAD_Y = 6; // tile to the box's top and bottom, at least
export const TILE_RADIUS = 7;
export const PAD_X = 14;
export const PAD_Y = 10;
export const NOTE_GAP = 2; // label block to note line
export const EDGE_LABEL_PAD_X = 8; // the pill around an edge label
export const EDGE_LABEL_PAD_Y = 2;
export const GROUP_LABEL_INSET = 12; // label starts this far in from the group's left edge
export const GROUP_MIN_HEIGHT = 64;
const MIN_BOX = { width: 80, height: 40 };
const MIN_STADIUM = { width: 72, height: 36 };
const MIN_DIAMOND = { width: 88, height: 56 };
// The padded text box must sit inside the rhombus: a w x h box fits a W x H
// rhombus only while w/W + h/H <= 1, so both axes are sized to twice the padded box.
export const DIAMOND_PAD = { x: 8, y: 4 };
// Corner cut of hexagon-rect and slant of parallelogram, shared with the renderer.
export const HEXAGON_CUT = 10;
export const PARALLELOGRAM_SLANT = 12;
export const CYLINDER_CAP = 6; // ry of the top and bottom ellipse (together the +12 px)
const DOT = { width: 20, height: 20 };
const SMALL_DIAMOND = { width: 24, height: 24 };

// Extra width/height a shape needs beyond its padded text box.
const SHAPE_EXTRA = {
  cylinder: { width: 0, height: 2 * CYLINDER_CAP },
  'hexagon-rect': { width: 2 * HEXAGON_CUT, height: 0 },
  parallelogram: { width: 2 * PARALLELOGRAM_SLANT, height: 0 },
  'double-bar-rect': { width: 16, height: 0 },
  stadium: { width: 16, height: 0 },
};
// Shapes drawn without room for text: the label sits beside them.
const EXTERNAL_SHAPES = { 'filled-dot': DOT, 'ringed-dot': DOT, 'small-diamond': SMALL_DIAMOND };

export const evenUp = (v) => Math.ceil(v / 2) * 2;

export function fonts(theme) {
  const body = fontFor(theme, 'body');
  const mono = fontFor(theme, 'mono');
  return {
    label: { ...body, weight: 600, size: LABEL_SIZE },
    note: { ...mono, weight: 400, size: NOTE_SIZE },
    type: { ...body, weight: 600, size: TYPE_SIZE },
    edge: { ...body, weight: 400, size: EDGE_LABEL_SIZE },
    group: { ...body, weight: 600, size: GROUP_LABEL_SIZE },
    legend: { ...body, weight: 400, size: LEGEND_SIZE },
  };
}

/** Width of `text` drawn in spaced capitals: the uppercase measured, plus `track` px after every character. */
export function trackedWidth(text, font, track) {
  return measure(text.toUpperCase(), font) + track * [...text].length;
}

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();
const widest = (lines, font) => Math.max(0, ...lines.map((l) => measure(l, font)));

// Wrap to at most two lines. 180 px first; a label that still needs a third
// line widens the wrap, up to 240 px. A 48-character Latin label always fits
// by then; text of unusually wide glyphs may still wrap to a third line (never
// cut), which the geometry lint reports.
function wrapLabel(text, font) {
  const clean = oneLine(text);
  let lines = [];
  for (let width = MAX_TEXT_WIDTH; width <= MAX_WIDENED_TEXT_WIDTH; width += WIDEN_STEP) {
    lines = wrap(clean, width, font);
    if (lines.length <= MAX_LABEL_LINES) break;
  }
  return lines;
}

// The type line (when the card has one), the label lines and the note, stacked.
function textBlock(node, f, typeLine) {
  const lines = wrapLabel(node.label, f.label);
  const noteLine = node.note === undefined ? null : oneLine(node.note);
  const typeWidth = typeLine === null ? 0 : trackedWidth(typeLine, f.type, TYPE_TRACK);
  const width = Math.max(widest(lines, f.label), noteLine ? measure(noteLine, f.note) : 0, typeWidth);
  const height = (typeLine === null ? 0 : lineHeight(f.type) + TYPE_GAP) + lines.length * lineHeight(f.label) + (noteLine ? NOTE_GAP + lineHeight(f.note) : 0);
  return { lines, noteLine, width, height };
}

/** Whether a node of this shape reserves room for a tile (icon or emoji). */
export function holdsIcon(kindInfo) {
  return BOX_SHAPES.has(kindInfo.shape);
}

/** What the tile holds: { icon, emoji }. An emoji replaces the icon; a shape without a tile holds neither. */
export function tileOf(node, kindInfo) {
  if (!holdsIcon(kindInfo)) return { icon: null, emoji: null };
  if (node.emoji !== undefined) return { icon: null, emoji: node.emoji };
  return { icon: node.icon ?? kindInfo.icon ?? null, emoji: null };
}

/**
 * Size of one node. Returns { width, height, lines, noteLine, icon, emoji, typeLine, labelBox? }:
 * widths and heights are even px; `icon` is the resolved icon ref and `emoji`
 * the emoji drawn instead of it (both null when there is no tile); `typeLine`
 * is the kind in capitals, drawn above the label on every card with a tile,
 * else null; `labelBox` ({ width, height }) is set only for dot and
 * small-diamond shapes, whose label is drawn outside the shape.
 */
export function nodeSize(node, kindInfo, theme) {
  const f = fonts(theme);
  const { icon, emoji } = tileOf(node, kindInfo);
  const tile = icon !== null || emoji !== null;
  const typeLine = tile && kindInfo.name ? kindInfo.name.toUpperCase() : null;
  const block = textBlock(node, f, typeLine);
  const { shape } = kindInfo;
  const base = { lines: block.lines, noteLine: block.noteLine, icon, emoji, typeLine };

  if (EXTERNAL_SHAPES[shape]) {
    return { ...base, ...EXTERNAL_SHAPES[shape], labelBox: { width: evenUp(block.width), height: evenUp(block.height) } };
  }
  if (shape === 'diamond') {
    const w = 2 * (block.width + 2 * DIAMOND_PAD.x);
    const h = 2 * (block.height + 2 * DIAMOND_PAD.y);
    return { ...base, width: evenUp(Math.max(w, MIN_DIAMOND.width)), height: evenUp(Math.max(h, MIN_DIAMOND.height)) };
  }
  const extra = SHAPE_EXTRA[shape] ?? { width: 0, height: 0 };
  const min = shape === 'stadium' ? MIN_STADIUM : MIN_BOX;
  const tileWidth = tile ? TILE_SIZE + TILE_GAP : 0;
  return {
    ...base,
    width: evenUp(Math.max(block.width + 2 * PAD_X + tileWidth + extra.width, min.width)),
    height: evenUp(Math.max(block.height + 2 * PAD_Y + extra.height, tile ? TILE_SIZE + 2 * TILE_PAD_Y : 0, min.height)),
  };
}

/**
 * Widest text line a node of this shape and width can hold: the inverse of the
 * width rule in nodeSize, so the geometry lint and the renderer read one rule.
 * Not for shapes whose label sits outside them (dots, small diamond).
 */
export function textRoom(shape, width, hasTile) {
  if (shape === 'diamond') return width / 2 - 2 * DIAMOND_PAD.x;
  const extra = SHAPE_EXTRA[shape]?.width ?? 0;
  return width - 2 * PAD_X - (hasTile ? TILE_SIZE + TILE_GAP : 0) - extra;
}

/** Size of an edge label's pill: one line, never wrapped. */
export function edgeLabelSize(text, theme) {
  const font = fonts(theme).edge;
  const clean = oneLine(text);
  return {
    text: clean,
    width: evenUp(measure(clean, font) + 2 * EDGE_LABEL_PAD_X),
    height: evenUp(lineHeight(font) + 2 * EDGE_LABEL_PAD_Y),
  };
}

/** Smallest group box that holds its label, drawn in spaced capitals. */
export function groupMinSize(group, theme) {
  const font = fonts(theme).group;
  return {
    width: evenUp(trackedWidth(oneLine(group.label), font, GROUP_TRACK) + 2 * GROUP_LABEL_INSET),
    height: GROUP_MIN_HEIGHT,
  };
}
