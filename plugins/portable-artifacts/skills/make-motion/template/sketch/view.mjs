// Draws a sketch scene's stroke plan in the page. Everything is built once, from the plan; `applyDrawn` then only looks up how
// far along each stroke is at the time it is given, so a frame depends on that time alone. No path is measured in the page.
import { PALETTE } from './style.mjs';
import { THEME_TOKENS, colourOf } from './plan.mjs';
import { svgEl } from './hand.mjs';

const WRITING_FONT = 'Caveat';
const WRITING_WEIGHT = 700;
const WRITING_FONT_URL = '/template/sketch/caveat-700.woff2';
const FONT_STYLE_ID = 'sketch-font';
const FONT_PROBE_SIZE = 72; // px: any size, one file holds them all
const MIN_SVG_SIDE = 1; // an svg with a side of 0 draws nothing, however far its strokes reach
const MASK_MARGIN = 1; // font sizes around the text box that the writing mask reaches, for a glyph's swash
const COORD_DECIMALS = 2;
const GLYPH_DECIMALS = 3;
const DASH_DECIMALS = 5;
const REVEAL_ROUNDING = 1e4;
let maskCount = 0; // one id per mask on the page; never an element's id, which is the user's text

const px = (n) => `${n}px`;
const coord = (n) => n.toFixed(COORD_DECIMALS);

/** Offers the handwriting font to the page and waits for it. */
export async function loadHandwriting() {
  if (!document.getElementById(FONT_STYLE_ID)) {
    const style = document.createElement('style');
    style.id = FONT_STYLE_ID;
    style.textContent = `@font-face { font-family: "${WRITING_FONT}"; font-weight: ${WRITING_WEIGHT}; src: url(${WRITING_FONT_URL}) format("woff2"); }`;
    document.head.append(style);
  }
  const faces = await document.fonts.load(`${WRITING_WEIGHT} ${FONT_PROBE_SIZE}px "${WRITING_FONT}"`);
  if (!faces.length) throw new Error(`the handwriting font failed to load: ${WRITING_FONT_URL}`);
}

/** The look a sketch scene's elements draw with: `look` (the theme's) with its colours turned to the board's palette. */
export function sketchLook(look) {
  const colors = { ...look.colors, ...Object.fromEntries(THEME_TOKENS.map((token) => [token, colourOf(token)])) };
  return { ...look, colors, text: PALETTE.ink, shape: PALETTE.accent, background: PALETTE.board };
}

/** Turns the theme's CSS tokens to the board's palette on a sketch scene's own layer. */
export function scopeLayer(layer) {
  layer.style.setProperty('--page', PALETTE.board);
  for (const token of THEME_TOKENS) layer.style.setProperty(`--${token}`, colourOf(token));
}

// ---- one stroke: hidden, being drawn, or done ---------------------------------------------------------------------------------

// A polyline as path data, in the coordinates of the element's box.
const pathData = (points, box) => `M${points.map(([x, y]) => `${coord(x - box.x)} ${coord(y - box.y)}`).join('L')}`;

// The path of `stroke` in `parent`, not yet drawn. `attrs` are its paint. A pathLength of 1 makes the dash its progress.
function strokePath(stroke, box, attrs, parent) {
  const node = svgEl('path', { d: pathData(stroke.points, box), fill: 'none', 'stroke-width': stroke.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', pathLength: 1, ...attrs }, parent);
  return { node, t0: stroke.t0, t1: stroke.t1, progress: null };
}

// Only the stroke being drawn carries a dash: a dash is measured along the whole path at every paint.
function setProgress(item, progress) {
  if (progress === item.progress) return;
  item.progress = progress;
  const { node } = item;
  node.style.visibility = progress > 0 ? 'visible' : 'hidden';
  if (progress >= 1) node.removeAttribute('stroke-dasharray');
  else node.setAttribute('stroke-dasharray', '1 2');
  node.setAttribute('stroke-dashoffset', (1 - progress).toFixed(DASH_DECIMALS));
}

// How far a window is at `sec`: 0 up to and at its start, 1 from its end. One with no length is simply done from then on.
const progressAt = (t0, t1, sec) => {
  if (sec < t0) return 0;
  return t1 > t0 ? Math.min(1, (sec - t0) / (t1 - t0)) : 1;
};

// ---- written text -------------------------------------------------------------------------------------------------------------

// The text as rows, one per baseline: its characters, spaces included (so the node's textContent is the plain text), and an x for
// each. The plan has no glyph for a space; it draws nothing, so it takes the x of the glyph before it.
function textRows(el, glyphs, box) {
  const rows = [];
  let next = 0;
  let row = null;
  for (const ch of String(el.text ?? '').normalize('NFC')) {
    const glyph = glyphs[next];
    if (glyph?.char === ch) {
      if (row?.y !== glyph.y) {
        row = { y: glyph.y, chars: '', xs: [] };
        rows.push(row);
      }
      row.chars += ch;
      row.xs.push(glyph.x - box.x);
      next++;
    } else if (row && /\s/.test(ch)) {
      row.chars += ch;
      row.xs.push(row.xs.at(-1));
    }
  }
  return rows;
}

// Written text is real text, one x per character so the page need not measure it (with no kerning or ligatures it could not
// disagree with the plan anyway), seen through a mask of the zig-zag strokes the plan gives for each line.
function mountWriting(svg, el, { box, glyphs, fontSize }, strokes, paint) {
  const defs = svgEl('defs', {}, svg);
  const id = `sketch-mask-${++maskCount}`;
  const margin = MASK_MARGIN * fontSize;
  const mask = svgEl('mask', { id, maskUnits: 'userSpaceOnUse', x: -margin, y: -margin, width: box.width + 2 * margin, height: box.height + 2 * margin }, defs);
  const items = strokes.map((stroke) => strokePath(stroke, box, { stroke: '#fff' }, mask));
  const words = svgEl('g', { mask: `url(#${id})`, fill: strokes[0]?.color ?? PALETTE.ink, opacity: paint(strokes[0]?.opacity ?? 1) }, svg);
  for (const { y, chars, xs } of textRows(el, glyphs, box)) {
    const line = svgEl('text', { x: xs.map((x) => x.toFixed(GLYPH_DECIMALS)).join(' '), y: (y - box.y).toFixed(GLYPH_DECIMALS) }, words);
    line.style.whiteSpace = 'pre';
    line.textContent = chars;
  }
  return { items, writing: { words, maskRef: `url(#${id})` } };
}

function styleWriting(node, color, fontSize) {
  node.style.fontFamily = `"${WRITING_FONT}"`;
  node.style.fontWeight = String(WRITING_WEIGHT);
  node.style.fontSize = px(fontSize);
  node.style.color = color;
  node.style.letterSpacing = '0';
  node.style.fontKerning = 'none';
  node.style.fontVariantLigatures = 'no-common-ligatures';
}

// Nothing written shows nothing; all of it written needs no mask (a mask left on would keep cutting a swash the zig-zag missed).
function setWritten({ words, maskRef }, reveal) {
  words.style.visibility = reveal > 0 ? 'visible' : 'hidden';
  if (reveal >= 1) words.removeAttribute('mask');
  else words.setAttribute('mask', maskRef);
}

// ---- an element -----------------------------------------------------------------------------------------------------------------

/**
 * Builds the drawing of a text, shape or icon into `part.node` from its plan. The node takes the plan's box; one svg inside it
 * holds the element's strokes in the box's coordinates. `part.inherited` is the element's opacity times its groups': those
 * nodes carry it as CSS (the audits read it there), so a stroke's own opacity, which the plan has already multiplied by it, is
 * divided by it here. Sets `part.drawing`, which `applyDrawn` reads.
 */
export function mountDrawn(part, el, elementPlan, strokes, look) {
  const { node } = part;
  const { box, t0, t1, glyphs, fontSize } = elementPlan;
  node.style.width = px(box.width);
  node.style.height = px(box.height);
  const svg = svgEl('svg', { width: Math.max(MIN_SVG_SIDE, box.width), height: Math.max(MIN_SVG_SIDE, box.height) });
  const paint = (opacity) => (part.inherited > 0 ? opacity / part.inherited : 0);
  let drawn;
  if (glyphs) {
    styleWriting(node, strokes[0]?.color ?? look.text, fontSize);
    drawn = mountWriting(svg, el, elementPlan, strokes, paint);
  } else {
    drawn = { items: strokes.map((stroke) => strokePath(stroke, box, { stroke: stroke.color, opacity: paint(stroke.opacity) }, svg)) };
  }
  node.append(svg);
  part.drawing = { t0, t1, reveal: null, ...drawn };
}

/**
 * Shows `part` as it is `sec` seconds into its scene. `dataset.reveal` holds the element's progress: '0' until it starts (the
 * audits take that as not on screen), and it changes with the drawing, which the dead-stretch audit reads as change.
 */
export function applyDrawn(part, sec) {
  const { drawing } = part;
  const reveal = progressAt(drawing.t0, drawing.t1, sec);
  if (reveal !== drawing.reveal) {
    drawing.reveal = reveal;
    part.node.dataset.reveal = String(Math.round(reveal * REVEAL_ROUNDING) / REVEAL_ROUNDING);
    if (drawing.writing) setWritten(drawing.writing, reveal);
  }
  for (const item of drawing.items) setProgress(item, progressAt(item.t0, item.t1, sec));
}
