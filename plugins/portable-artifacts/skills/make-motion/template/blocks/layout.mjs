// Browser-safe (no Node imports): what every block shares. Sizes scale with the canvas's short side (`unit`), timing
// follows one schedule (entrances with the `enter` ease over ENTER_SECONDS, STAGGER_SECONDS apart, squeezed so nothing
// moves after LAST_MOTION_SHARE of the scene), and text is sized without a DOM: expansion runs in the validator (Node)
// as well as the page, so a block estimates how many lines a text takes from its characters and reserves room for them.
// The estimate is deliberately wide (CHAR_EM), so a text takes at most the lines reserved for it.
import { safeMargin, captionZone } from '../formats.mjs';
import { ARROW_HEAD_LENGTH } from '../defaults.mjs';

export const ENTER_SECONDS = 0.6;
export const STAGGER_SECONDS = 0.2;
export const LAST_MOTION_SHARE = 0.85; // of the scene: no keyframe of a block lands after this

const REFERENCE_SIDE = 1080; // sizes below are in px at 1080 on the canvas's short side
const CHAR_EM = 0.62; // average glyph width as a share of the font size, on the wide side of the bundled fonts
const FIT_STEP = 0.92; // a text that does not fit shrinks by this factor per try
const MIN_FONT_SIZE = 1; // the validator's floor for fontSize, so a tiny canvas still gives a valid spec
const T_DECIMALS = 1e4;
export const LINE_HEIGHT = Object.freeze({ sans: 1.15, title: 1.05 }); // styles.css: .el.text 1.15, .title 1.02 (+ room)
export const MIN_TEXT = 40; // px at 1080 on the short side: no block text is smaller, so the 360 px phone tile stays legible
const BAND_INSET = 12; // px at 1080 kept free inside the band a block fills (freeBand)

// One px at 1080 on the short side, in canvas px.
export const unit = (size) => Math.min(size[0], size[1]) / REFERENCE_SIDE;

// The safe area's margins: a viral spec's `insets` (ctx.insets), else the plain safe margin on every side.
const marginsOf = (size, insets) => insets ?? { top: safeMargin(size), right: safeMargin(size), bottom: safeMargin(size), left: safeMargin(size) };

// The width a centred block may use: the canvas inside the safe area (`insets`: a viral spec's, ctx.insets), less
// `inset` on each side, at most `cap`.
export function contentWidth(size, cap, inset, insets = null) {
  const m = marginsOf(size, insets);
  return Math.min(size[0] - m.left - m.right - 2 * inset, cap);
}

// The band, top to bottom in canvas px, that a block may fill: the safe area (a viral spec's insets when it has them),
// ending above the caption zone when the spec has captions (ctx.captions), less BAND_INSET at each end.
export function freeBand({ size, format, captions, insets = null }) {
  const inset = BAND_INSET * unit(size);
  const m = marginsOf(size, insets);
  const bottom = captions ? captionZone(size, format, insets).top : size[1] - m.bottom;
  return { top: m.top + inset, bottom: bottom - inset };
}

// place() helpers, `insets` as in contentWidth. The middle of the safe area across (the canvas centre without insets).
const middleX = (size, insets) => (insets ? (insets.left + size[0] - insets.right) / 2 : size[0] / 2);
// Centred across and in the band between the safe area's top and the caption zone, so a stack fits above captions.
export const abovePlace = (size, format, insets = null) => ({ x: middleX(size, insets), y: (marginsOf(size, insets).top + captionZone(size, format, insets).top) / 2 });
// The canvas centre; with viral insets the band above the lifted caption zone instead (the canvas centre is too close
// to it to leave a block any room).
export const centrePlace = (size, format, insets = null) => (insets ? abovePlace(size, format, insets) : { x: size[0] / 2, y: size[1] / 2 });

// The height a block centred at canvas `y` may take inside `band`.
export const roomAt = (band, y) => Math.max(0, 2 * Math.min(band.bottom - y, y - band.top));

const chars = (text) => Array.from(text).length;
const wordsOf = (text) => text.split(/\s+/).filter(Boolean);

// The estimated one-line width of `text` at font size `fs`, and of its longest word (a word never wraps).
export const textWidth = (text, fs) => chars(text) * CHAR_EM * fs;
export const longestWordWidth = (text, fs) => Math.max(0, ...wordsOf(text).map(chars)) * CHAR_EM * fs;

// Lines `text` wraps onto at `maxWidth`, wrapping at spaces as the page does (a word longer than the line overflows it).
export function lineCount(text, fs, maxWidth) {
  let lines = 1;
  let used = 0;
  for (const word of wordsOf(text)) {
    const w = textWidth(word, fs);
    if (used === 0) used = w;
    else if (used + CHAR_EM * fs + w <= maxWidth) used += CHAR_EM * fs + w;
    else { lines++; used = w; }
  }
  return lines;
}

/**
 * The largest font size from `size` down to `min` at which `text` fits `maxWidth` in at most `maxLines` lines with no
 * word wider than the line; `min` when none does. -> { fontSize, lines, height } (height with `lineHeight`).
 */
export function fitText(text, { size, min, maxWidth, maxLines, lineHeight = LINE_HEIGHT.sans }) {
  const longest = Math.max(0, ...wordsOf(text).map(chars));
  const floor = Math.max(MIN_FONT_SIZE, Math.round(min));
  let fs = Math.max(floor, Math.round(size));
  while (fs > floor && (longest * CHAR_EM * fs > maxWidth || lineCount(text, fs, maxWidth) > maxLines)) fs = Math.max(floor, Math.floor(fs * FIT_STEP));
  const lines = lineCount(text, fs, maxWidth);
  return { fontSize: fs, lines, height: lines * fs * lineHeight };
}

/**
 * The first of `sizes` (canvas px, largest first) at which `text` takes at most `maxHeight` inside `maxWidth`, wrapping
 * at spaces with no word wider than the line; the last (smallest) when none does. -> { fontSize, lines, height }.
 */
export function fitHeight(text, { sizes, maxWidth, maxHeight, lineHeight = LINE_HEIGHT.sans }) {
  const fits = (fs) => longestWordWidth(text, fs) <= maxWidth && lineCount(text, fs, maxWidth) * fs * lineHeight <= maxHeight;
  const fontSize = sizes.find(fits) ?? sizes.at(-1);
  const lines = lineCount(text, fontSize, maxWidth);
  return { fontSize, lines, height: lines * fontSize * lineHeight };
}

// A ladder of sizes in px at 1080 on the short side (largest first, MIN_TEXT or more) as canvas px for fitHeight.
export const sizeLadder = (sizes, u) => sizes.map((s) => Math.max(MIN_FONT_SIZE, Math.round(s * u)));

/**
 * The scene-time function of a block whose schedule, at full speed, ends at `nominalEnd` seconds: the identity when
 * that fits inside LAST_MOTION_SHARE of the scene, else every time scaled down so the schedule ends exactly there.
 * Rounded down, so rounding never pushes a keyframe past the line.
 */
export function squeeze(sceneDuration, nominalEnd) {
  const k = Math.min(1, (LAST_MOTION_SHARE * sceneDuration) / nominalEnd);
  return (t) => Math.floor(t * k * T_DECIMALS + 1e-6) / T_DECIMALS;
}

/**
 * The scene-time function of a block with its own schedule and a validator that demands a scene of at least `needs`
 * seconds: such a scene keeps every time as the block wrote it (rounded to T_DECIMALS), a shorter one (invalid, but
 * still expanded without error) is squeezed as `squeeze` does.
 */
export function fitSchedule(sceneDuration, nominalEnd, needs) {
  if (sceneDuration + 1e-9 >= needs) return (t) => Math.round(t * T_DECIMALS) / T_DECIMALS;
  return squeeze(sceneDuration, nominalEnd);
}

// Item i's entrance at full speed: [start, end].
export const slot = (i) => [i * STAGGER_SECONDS, i * STAGGER_SECONDS + ENTER_SECONDS];

const px = (n) => Math.round(n);
const size0 = (n) => Math.max(0, px(n)); // a shape size the validator accepts (>= 0), however small the canvas

// The shortest line the validator accepts with this style (spec.mjs checkLineLength): more than the arrow head and the
// round caps take.
function shortestLine({ strokeWidth = 0, cap, arrow }) {
  const round = cap === 'round';
  return (arrow === 'end' ? ARROW_HEAD_LENGTH * strokeWidth : 0) + (round ? (arrow === 'end' ? 0.5 : 1) * strokeWidth : 0);
}

// Element builders. Positions are relative to the block's group centre; sizes are rounded to whole px and kept valid on
// any canvas the schema allows (16 px a side and up): a text's maxWidth at least 1, a line longer than its caps.
export const textPart = (id, text, x, y, { fontSize, maxWidth, ...style }) => ({ id, type: 'text', text, x: px(x), y: px(y), fontSize, maxWidth: Math.max(1, px(maxWidth)), ...style });
export const rectPart = (id, x, y, width, height, style) => ({ id, type: 'shape', shape: 'rect', x: px(x), y: px(y), width: size0(width), height: size0(height), ...style });
export const ellipsePart = (id, x, y, side, style) => ({ id, type: 'shape', shape: 'ellipse', x: px(x), y: px(y), width: size0(side), height: size0(side), ...style });
export const linePart = (id, x, y, width, style) => ({ id, type: 'shape', shape: 'line', x: px(x), y: px(y), width: Math.max(size0(width), Math.floor(shortestLine(style)) + 1), ...style });

/**
 * `part` with an entrance from `[start, end]` (scene seconds, already squeezed): from opacity 0 to 1 with the `enter`
 * ease, optionally travelling `dx`/`dy` px into place and growing from `scale`.
 */
export function enter(part, [start, end], { dx = 0, dy = 0, scale } = {}) {
  const from = { t: start, opacity: 0 };
  const to = { t: end, opacity: 1, ease: 'enter' };
  if (dx) { from.x = part.x + px(dx); to.x = part.x; }
  if (dy) { from.y = part.y + px(dy); to.y = part.y; }
  if (scale !== undefined) { from.scale = scale; to.scale = 1; }
  return { ...part, keyframes: [from, to] };
}

// `part` (a line) drawn in from `[start, end]` with the `enter` ease.
export const drawIn = (part, [start, end]) => ({ ...part, keyframes: [{ t: start, draw: 0 }, { t: end, draw: 1, ease: 'enter' }] });

// The group a block becomes: its id, place and pose, holding `children`.
export function blockGroup(el, children) {
  const group = { id: el.id, type: 'group', x: el.x, y: el.y, children };
  for (const key of ['opacity', 'scale', 'rotate', 'keyframes', 'hold']) if (el[key] !== undefined) group[key] = el[key];
  return group;
}

// Lays `heights` out top to bottom with `gaps` between them (gaps[i] sits after item i), centred on 0: each item's
// centre y.
export function stack(heights, gaps) {
  const total = heights.reduce((a, h) => a + h, 0) + gaps.slice(0, heights.length - 1).reduce((a, g) => a + g, 0);
  let top = -total / 2;
  return heights.map((h, i) => {
    const centre = top + h / 2;
    top += h + (gaps[i] ?? 0);
    return centre;
  });
}
