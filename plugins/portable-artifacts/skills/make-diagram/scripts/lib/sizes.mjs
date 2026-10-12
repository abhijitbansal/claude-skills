// Node, edge-label and group sizing from font metrics plus per-shape padding.
// Every figure is a px constant here so the renderer and the geometry lint can
// reuse them; nothing is measured in a browser.
import { measure, wrap, lineHeight, fontFor } from '../../shared/text.mjs';
import { BOX_SHAPES } from './kinds.mjs';

export const MAX_TEXT_WIDTH = 180; // wrap labels here first
export const MAX_WIDENED_TEXT_WIDTH = 240; // a label that needs a third line widens the wrap, up to here
export const MAX_LABEL_LINES = 2;
const WIDEN_STEP = 10;

export const LABEL_SIZE = 14;
export const NOTE_SIZE = 12;
export const EDGE_LABEL_SIZE = 12;
export const GROUP_LABEL_SIZE = 12;
export const ICON_SIZE = 16;
export const ICON_GAP = 8;
export const PAD_X = 14;
export const PAD_Y = 10;
export const NOTE_GAP = 2; // label block to note line
export const EDGE_LABEL_PAD_X = 6; // the plate around an edge label
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
  return {
    label: { ...body, weight: 600, size: LABEL_SIZE },
    note: { ...body, weight: 400, size: NOTE_SIZE },
    edge: { ...body, weight: 400, size: EDGE_LABEL_SIZE },
    group: { ...body, weight: 600, size: GROUP_LABEL_SIZE },
  };
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

function textBlock(node, f) {
  const lines = wrapLabel(node.label, f.label);
  const noteLine = node.note === undefined ? null : oneLine(node.note);
  const width = Math.max(widest(lines, f.label), noteLine ? measure(noteLine, f.note) : 0);
  const height = lines.length * lineHeight(f.label) + (noteLine ? NOTE_GAP + lineHeight(f.note) : 0);
  return { lines, noteLine, width, height };
}

/** Whether a node of this shape reserves room for an icon. */
export function holdsIcon(kindInfo) {
  return BOX_SHAPES.has(kindInfo.shape);
}

/**
 * Size of one node. Returns { width, height, lines, noteLine, icon, labelBox? }:
 * widths and heights are even px; `icon` is the resolved icon ref (null when
 * the shape has no icon slot); `labelBox` ({ width, height }) is set only for
 * dot and small-diamond shapes, whose label is drawn outside the shape.
 */
export function nodeSize(node, kindInfo, theme) {
  const f = fonts(theme);
  const block = textBlock(node, f);
  const { shape } = kindInfo;
  const icon = holdsIcon(kindInfo) ? (node.icon ?? kindInfo.icon ?? null) : null;
  const base = { lines: block.lines, noteLine: block.noteLine, icon };

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
  const iconWidth = icon ? ICON_SIZE + ICON_GAP : 0;
  return {
    ...base,
    width: evenUp(Math.max(block.width + 2 * PAD_X + iconWidth + extra.width, min.width)),
    height: evenUp(Math.max(block.height + 2 * PAD_Y + extra.height, min.height)),
  };
}

/** Size of an edge label's plate: one line, never wrapped. */
export function edgeLabelSize(text, theme) {
  const font = fonts(theme).edge;
  const clean = oneLine(text);
  return {
    text: clean,
    width: evenUp(measure(clean, font) + 2 * EDGE_LABEL_PAD_X),
    height: evenUp(lineHeight(font) + 2 * EDGE_LABEL_PAD_Y),
  };
}

/** Smallest group box that holds its label. */
export function groupMinSize(group, theme) {
  const font = fonts(theme).group;
  return {
    width: evenUp(measure(oneLine(group.label), font) + 2 * GROUP_LABEL_INSET),
    height: GROUP_MIN_HEIGHT,
  };
}
