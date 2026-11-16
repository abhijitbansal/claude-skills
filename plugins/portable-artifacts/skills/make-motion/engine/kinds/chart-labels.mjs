// The chart kind's text pieces (chart-draw.mjs): one label node placed by its alignment, numerals in fixed advances,
// arriving at a time or there from the first frame, and vertical spreading so labels stacked down a side never meet.
// Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { landing } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT, setCase } from './shared.mjs';
import { numeralLayout } from './chart-scale.mjs';

const NO_WRAP = 1e6;
const FIT_EPSILON = 0.5;
const HALF = 2;

/** Opacity from 0 to `to` starting at `at` over the look's enter move; none for a part there from the first frame. */
export const arriveAt = (look, at, from = 0, to = 1) => (at === undefined ? {} : { opacity: landing(at + look.moves.enter.dur, look.moves.enter, from, to) });

/** The width a label would take on one line (numerals in fixed advances). */
export function labelWidth(ctx, font, text, numeric = false) {
  const shown = numeric ? text : setCase(ctx.look, 'label', text);
  return (numeric ? numeralLayout(shown, font, ctx.measure) : layoutText({ text: shown, font, maxWidth: NO_WRAP, measure: ctx.measure })).width;
}

/**
 * A label: `text` in `font`, its first baseline at `y`, placed by `align` about `x` (left edge, right edge or centre).
 * With `maxWidth` it wraps to at most `lines` lines (centred lines centre in that width); wider or longer is marked
 * overflow, the review's fit finding, as is a label its caller could not keep apart from its neighbours (`crowded`).
 * -> { node, box } with box the ink-ish rectangle (cap line to descent) in px.
 */
export function label(ctx, { id, text, font, x, y, align = 'left', fill, role = 'label', at, maxWidth, lines = 1, numeric = false, tracks, crowded = false }) {
  const { look, measure } = ctx;
  const shown = numeric ? text : setCase(look, 'label', text);
  const centred = align === 'center' && maxWidth !== undefined && !numeric; // wrapped lines centre in maxWidth
  let layout = numeric ? numeralLayout(shown, font, measure)
    : layoutText({ text: shown, font, maxWidth: maxWidth ?? NO_WRAP, align: centred ? 'center' : 'left', measure });
  if (crowded || (maxWidth !== undefined && (layout.lines.length > lines || layout.width > maxWidth + FIT_EPSILON))) layout = { ...layout, overflow: true };
  const width = centred ? maxWidth : layout.width;
  const left = align === 'right' ? x - width : align === 'center' ? x - width / HALF : x;
  const top = y - CAP_HEIGHT * font.size;
  const bottom = y + layout.lines.at(-1).y - layout.lines[0].y + WORD_DESCENT * font.size;
  const props = { x: left, y: y - layout.lines[0].y, layout, font, fill, role };
  const inkLeft = centred ? left + Math.min(...layout.lines.map((l) => l.x)) : left;
  return { node: node('text', id, props, { tracks: tracks ?? arriveAt(look, at) }), box: [inkLeft, top, layout.width, bottom - top] };
}

/**
 * Spreads blocks down a side so none meets the next: each { y (wanted centre), h } moves as little as it can, all kept
 * between `lo` and `hi`. -> { ys (centres, in the input order), fits }.
 */
export function spread(blocks, lo, hi, gap) {
  const order = blocks.map((b, i) => ({ ...b, i })).sort((a, b) => a.y - b.y);
  const total = order.reduce((sum, b) => sum + b.h, 0) + gap * Math.max(0, order.length - 1);
  let cursor = lo;
  const placed = order.map((b) => {
    const top = Math.max(b.y - b.h / HALF, cursor);
    cursor = top + b.h + gap;
    return { ...b, top };
  });
  let floor = hi;
  for (let k = placed.length - 1; k >= 0; k--) {
    placed[k].top = Math.min(placed[k].top, floor - placed[k].h);
    floor = placed[k].top - gap;
  }
  const ys = new Array(blocks.length);
  for (const b of placed) ys[b.i] = b.top + b.h / HALF;
  return { ys, fits: total <= hi - lo + FIT_EPSILON };
}
