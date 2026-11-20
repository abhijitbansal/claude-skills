// The chart kind's donut (chart-draw.mjs draws columns and bars, chart-series.mjs lines and areas): a ring of segments
// drawn on clockwise from twelve o'clock, one after another over the first sentence, a paper gap between each, and
// each segment named outside the ring on its side with its value under the name, spread so no two names meet.
// Pure and DOM-free.
import { node } from '../graph/node.mjs';
import { landing, polyline } from '../devices/shared.mjs';
import { CAP_HEIGHT, WORD_DESCENT } from './shared.mjs';
import { valueText } from './chart-scale.mjs';
import { chartData, donutMarks, arcPoints } from './chart-marks.mjs';
import { chartTimes } from './chart-time.mjs';
import { label, labelWidth, arriveAt, spread } from './chart-labels.mjs';
import { valueDecimals, dimTracks, highlightIndex } from './chart-draw.mjs';

const LABEL_GAPS = 2; // gaps between the ring and its labels
const LINE_GAP = 0.25; // em of the label size between a name and its value
const HALF = 2;

// A segment's ring stroke, drawn on over its share of the growth (dimming unless highlighted), and the accent copy.
function segmentNodes(shot, ctx, style, { seg, ring, times, hl }) {
  const { look } = ctx;
  const gap = Math.min(style.gap / ring.centre, (seg.to - seg.from) / HALF); // a paper gap between neighbours
  const d = polyline(arcPoints(ring.cx, ring.cy, ring.centre, seg.from + gap / HALF, seg.to - gap / HALF));
  const start = times.growEnd * ((seg.from - ring.segments[0].from) / (2 * Math.PI)), end = times.growEnd * ((seg.to - ring.segments[0].from) / (2 * Math.PI));
  const draw = landing(end, { ease: look.moves.draw.ease, dur: Math.max(0, end - start) }, 0, 1, style.step);
  const dims = hl >= 0 && seg.index !== hl ? dimTracks(look, times.highlightAt, style.dim) : {};
  const stroke = { d, strokeWidth: ring.thickness, lineCap: 'butt' };
  const id = `${shot.id}.mark.${seg.index}`;
  const out = [node('path', id, { ...stroke, stroke: style.mark }, { tracks: { draw, ...dims }, step: style.step })];
  if (seg.index === hl) out.push(node('path', `${id}.accent`, { ...stroke, stroke: style.accent }, { tracks: arriveAt(look, times.highlightAt) }));
  return out;
}

/** A donut in `box`: { nodes, boxes, plot, highlight }. */
export function drawDonut(shot, ctx, style, box, { valueOnHighlight }) {
  const data = chartData(shot), times = chartTimes(shot, ctx.timing, ctx.look);
  const { font, gap } = style;
  const ink = (CAP_HEIGHT + WORD_DESCENT) * font.size, lineGap = LINE_GAP * font.size;
  const hl = highlightIndex(shot, data), decimals = valueDecimals(data.items.map((i) => i.value));
  const texts = data.items.map((it) => valueText(it.value, decimals, shot.unit));
  const labelW = Math.max(...data.items.map((it, k) => Math.max(labelWidth(ctx, font, it.key), labelWidth(ctx, font, texts[k], true))));
  const side = labelW + LABEL_GAPS * gap;
  // never under the look's minimum (style.minPlot of the box's short side): labels too long for it say so instead
  const floor = (style.minPlot * Math.min(box.w, box.h)) / HALF;
  const r = Math.max(1, Math.min(box.h / HALF, Math.max(floor, (box.w - HALF * side) / HALF)));
  // a label wider than the room the ring leaves at its side says so (only that one: a short label is not told to shorten)
  const room = box.w / HALF - r - LABEL_GAPS * gap;
  const tooWide = (k) => Math.max(labelWidth(ctx, font, data.items[k].key), labelWidth(ctx, font, texts[k], true)) > room;
  const plot = { x: box.x + box.w / HALF - r, y: box.y + box.h / HALF - r, w: HALF * r, h: HALF * r };
  const ring = donutMarks(data.items, plot);
  const nodes = ring.segments.flatMap((seg) => segmentNodes(shot, ctx, style, { seg, ring, times, hl }));
  const blockH = HALF * ink + lineGap;
  const sides = { right: ring.segments.filter((s) => Math.cos(s.mid) >= 0), left: ring.segments.filter((s) => Math.cos(s.mid) < 0) };
  const labels = Object.entries(sides).flatMap(([which, segs]) => {
    const { ys, fits } = spread(segs.map((s) => ({ y: ring.cy + (r + gap) * Math.sin(s.mid), h: blockH })), box.y, box.y + box.h, gap / HALF);
    return segs.flatMap((s, j) => {
      const align = which === 'right' ? 'left' : 'right';
      const x = which === 'right' ? ring.cx + r + LABEL_GAPS * gap : ring.cx - r - LABEL_GAPS * gap;
      const top = ys[j] - blockH / HALF;
      const highlighted = s.index === hl;
      const name = label(ctx, { id: `${shot.id}.label.${s.index}`, text: s.key, font, x, y: top + CAP_HEIGHT * font.size, align, fill: highlighted ? style.strong : style.text, crowded: !fits || tooWide(s.index) });
      if (highlighted && !valueOnHighlight) return [name.node];
      const tracks = highlighted ? arriveAt(ctx.look, times.highlightAt) : arriveAt(ctx.look, times.growEnd);
      const value = label(ctx, { id: `${shot.id}.value.${s.index}`, text: texts[s.index], font, x, y: top + ink + lineGap + CAP_HEIGHT * font.size, align, fill: highlighted ? style.strong : style.text, numeric: true, tracks });
      return [name.node, value.node];
    });
  });
  const boxes = Object.fromEntries(ring.segments.map((s) => {
    const pts = [...arcPoints(ring.cx, ring.cy, r, s.from, s.to), ...arcPoints(ring.cx, ring.cy, r - ring.thickness, s.from, s.to)];
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [`mark:${s.index}`, [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]];
  }));
  return { nodes: [...nodes, ...labels], boxes, plot, times, highlight: hl >= 0 ? { index: hl, text: texts[hl] } : null };
}
