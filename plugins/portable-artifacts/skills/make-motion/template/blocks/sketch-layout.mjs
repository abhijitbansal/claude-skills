// Browser-safe (no Node imports): what the sketch-* blocks share. Their parts are drawn by hand (template/sketch/plan.mjs), so
// text is measured with Caveat's own metrics (caveat-metrics.mjs, the table the plan lays out with), not the estimate the
// standard blocks use: a label wraps here exactly where the plan wraps it, and `maxWidth` is always wide enough that the plan
// reports no word wider than its line. This module must stay light: index.mjs loads it for every spec, so it may import only
// layout.mjs, style.mjs and caveat-metrics.mjs, never the plan, geometry, timing or icon modules (a standard page must not
// fetch them). Parts carry no keyframes, rotate, fontWeight, elevated or cap: a sketch scene refuses them (the drawing decides
// how an element appears).
import metrics from '../sketch/caveat-metrics.mjs';
import { unit, freeBand, roomAt, contentWidth, rectPart } from './layout.mjs';

const { unitsPerEm, ascent, descent, advance } = metrics;
const FIT_EPSILON = 1e-9; // plan.mjs's wrap uses the same tolerance
const DRAW_MARGIN = 14; // px at 1080 kept free around what a block draws: the pen is 5.5 wide and the wobble moves it a few px
export const UNDERLINE = { width: 9, bow: 30, bowShare: 0.044 }; // the spike's underline: a 9 px accent stroke sagging 31 px over 700

export const LINE_EM = (ascent - descent) / unitsPerEm; // a line is as tall as the font's ascent plus its descent
const px = (n) => Math.round(n);
const tenth = (n) => Math.round(n * 10) / 10;

const words = (text) => text.normalize('NFC').split(/\s+/).filter(Boolean);
const glyphUnits = (str) => Array.from(str).reduce((sum, ch) => sum + (Object.hasOwn(advance, ch) ? advance[ch] : advance[' ']), 0); // a missing glyph takes a space's width, as in the plan

/** The one-line width of `text` at font size `fs`, in px. */
export const textWidth = (text, fs) => (glyphUnits(text.normalize('NFC')) * fs) / unitsPerEm;

/** The width of the longest word of `text` at `fs` (a word never wraps), 0 for none. */
export const longestWord = (text, fs) => Math.max(0, ...words(text).map((word) => textWidth(word, fs)));

/** The lines `text` wraps onto at `maxWidth`, wrapping at spaces and tabs exactly as the plan does. */
export function wrapLines(text, fs, maxWidth) {
  const space = textWidth(' ', fs);
  return text.normalize('NFC').split('\n').flatMap((paragraph) => {
    const lines = [];
    let line = '';
    let used = 0;
    for (const word of paragraph.split(/[ \t]+/).filter(Boolean)) {
      const w = textWidth(word, fs);
      if (line === '') { line = word; used = w; } else if (used + space + w <= maxWidth + FIT_EPSILON) { line += ` ${word}`; used += space + w; } else { lines.push(line); line = word; used = w; }
    }
    lines.push(line);
    return lines;
  });
}

/**
 * `text` at the first of `sizes` (canvas px, largest first) at which it takes at most `maxLines` inside `maxWidth` with no word
 * wider than the line; the last size when none does. -> { fontSize, lines, width (the widest line), height, wrapWidth }.
 * `wrapWidth` is the `maxWidth` to give the text part: a whole number, at least `maxWidth` and the longest word, so the plan
 * wraps it onto the same `lines`.
 */
export function fitLabel(text, { sizes, maxWidth, maxLines = 1 }) {
  const measure = (fontSize) => {
    const wrapWidth = Math.max(1, Math.ceil(Math.max(maxWidth, longestWord(text, fontSize))));
    const lines = wrapLines(text, fontSize, wrapWidth);
    return { fontSize, lines, width: Math.max(0, ...lines.map((line) => textWidth(line, fontSize))), height: lines.length * fontSize * LINE_EM, wrapWidth };
  };
  const fits = (m) => m.lines.length <= maxLines && longestWord(text, m.fontSize) <= maxWidth + FIT_EPSILON;
  const all = sizes.map(measure);
  return all.find(fits) ?? all.at(-1);
}

/** True when `fit` (fitLabel of `text`) is what the room asked for: at most `maxLines` lines, and no word wider than `maxWidth`. */
export const fitted = (text, fit, maxWidth, maxLines) => fit.lines.length <= maxLines && longestWord(text, fit.fontSize) <= maxWidth + FIT_EPSILON;

/** The first of `layouts` (roomiest first) whose `overflow` is 1 or less (it fits its room), else the one that overflows least. */
export const pickLayout = (layouts) => layouts.find((layout) => layout.overflow <= 1) ?? layouts.reduce((best, layout) => (layout.overflow < best.overflow ? layout : best));

/**
 * Where a block may draw: `width` across and `height` tall, centred on the block's x and y, inside the safe area (and above the
 * caption zone when the spec has captions), with the pen's margin taken off. `cap`: the widest the block may be, px at 1080.
 */
export function sketchRoom(ctx, el, cap) {
  const u = unit(ctx.size);
  const margin = 2 * DRAW_MARGIN * u;
  return { u, width: Math.max(1, contentWidth(ctx.size, cap * u, 0, ctx.insets) - margin), height: Math.max(1, roomAt(freeBand(ctx), el.y) - margin) };
}

// ---- parts ------------------------------------------------------------------------------------------------------------------

/** A text part from `fit` (fitLabel): `x`, `y` its centre, or its left edge with `anchor: 'left'` in `style`. */
export const labelPart = (id, text, fit, x, y, style = {}) => ({ id, type: 'text', text, x: px(x), y: px(y), fontSize: fit.fontSize, maxWidth: fit.wrapWidth, ...style });

export const boxPart = rectPart;

/** An oval `width` by `height` centred on x, y. */
export const ovalPart = (id, x, y, width, height, style = {}) => ({ id, type: 'shape', shape: 'ellipse', x: px(x), y: px(y), width: Math.max(0, px(width)), height: Math.max(0, px(height)), ...style });

/** A line from `from` to `to` (both [x, y], in the block's frame); `bow` in px at 1080 bends it to the left of the way it runs. */
export function linePart(id, from, to, { bow, ...style } = {}) {
  return { id, type: 'shape', shape: 'line', x: px(from[0]), y: px(from[1]), to: { x: px(to[0]), y: px(to[1]) }, ...(bow === undefined ? {} : { bow: tenth(bow) }), ...style };
}

/** A Lucide icon `size` px wide centred on x, y. */
export const iconPart = (id, name, x, y, size, style = {}) => ({ id, type: 'icon', name, x: px(x), y: px(y), size: Math.max(1, px(size)), ...style });

/** The accent underline from x `left` to `right` at height `y`: the spike's, sagging a little in the middle. */
export function underlinePart(id, left, right, y, u) {
  const length = Math.max(1, right - left);
  return linePart(id, [left, y], [right, y], { bow: -Math.min(UNDERLINE.bow, (UNDERLINE.bowShare * length) / u), stroke: 'accent', strokeWidth: Math.max(1, px(UNDERLINE.width * u)) });
}
