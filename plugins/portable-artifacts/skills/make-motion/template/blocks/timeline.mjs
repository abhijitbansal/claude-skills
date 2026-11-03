// timeline: 2 to 8 events along a line, each a dot with a short `when` in the accent colour and a `what`, as a row (when
// above the line, what below) or a column (when left, what right), each event arriving in turn after the line is drawn.
// A row works only when every word fits its slice of the width; otherwise it is laid out as a column (as step-flow does).
import { unit, contentWidth, textWidth, fitText, lineCount, longestWordWidth, squeeze, slot, textPart, ellipsePart, linePart, enter, drawIn, blockGroup, stack, freeBand, roomAt, abovePlace, LINE_HEIGHT, MIN_TEXT } from './layout.mjs';
import { bottomShift } from './exit.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['events'],
  properties: {
    events: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['when', 'what'],
        properties: { when: { type: 'string', minLength: 1, maxLength: 16 }, what: { type: 'string', minLength: 1, maxLength: 40 } },
      },
    },
    direction: { enum: ['row', 'column'] },
  },
};

const DOT = 28; // px at 1080
const GAP = 24; // between the dot and its labels
const WHEN_SIZE = 48;
const WHAT_SIZE = 44;
const ROW_MAX_WHEN_LINES = 2;
const ROW_MAX_WHAT_LINES = 4;
const COLUMN_TIERS = [{ padY: 14, gap: 14 }, { padY: 10, gap: 8 }, { padY: 6, gap: 6 }]; // roomiest first

// One font size for every label of a kind: the largest at which each fits `maxWidth` in `maxLines`.
const commonSize = (texts, { size, min, maxWidth, maxLines }) => Math.min(...texts.map((t) => fitText(t, { size, min, maxWidth, maxLines }).fontSize));
const tallest = (texts, fs, maxWidth) => Math.max(...texts.map((t) => lineCount(t, fs, maxWidth))) * fs * LINE_HEIGHT.sans;

function rowLayout(events, size, u, insets) {
  const n = events.length;
  const colW = contentWidth(size, 1720 * u, 40 * u, insets) / n;
  const labelW = colW - GAP * u;
  const whens = events.map((e) => e.when);
  const whats = events.map((e) => e.what);
  const floor = MIN_TEXT * u;
  const fits = [...whens, ...whats].every((t) => longestWordWidth(t, floor) <= labelW)
    && Math.max(...whens.map((t) => lineCount(t, floor, labelW))) <= ROW_MAX_WHEN_LINES
    && Math.max(...whats.map((t) => lineCount(t, floor, labelW))) <= ROW_MAX_WHAT_LINES;
  const whenFs = commonSize(whens, { size: WHEN_SIZE * u, min: floor, maxWidth: labelW, maxLines: ROW_MAX_WHEN_LINES });
  const whatFs = commonSize(whats, { size: WHAT_SIZE * u, min: floor, maxWidth: labelW, maxLines: ROW_MAX_WHAT_LINES });
  return { fits, colW, labelW, whenFs, whatFs, whenH: tallest(whens, whenFs, labelW), whatH: tallest(whats, whatFs, labelW) };
}

function expandRow(el, ctx, row) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { events } = el.params;
  const n = events.length;
  const id = (part) => `${el.id}/${part}`;
  const dot = DOT * u;
  const gap = GAP * u;
  const axisY = (row.whenH - row.whatH) / 2; // the whole block is centred on y = 0
  const x = (i) => (i - (n - 1) / 2) * row.colW;
  const at = squeeze(sceneDuration, slot(n - 1)[1]);
  const stroke = Math.max(1, Math.round(4 * u));
  const parts = [drawIn(linePart(id('axis'), 0, axisY, (n - 1) * row.colW, { stroke: 'line', strokeWidth: stroke, cap: 'round' }), slot(0).map(at))];
  events.forEach(({ when, what }, i) => {
    const k = i + 1;
    const span = slot(i).map(at);
    const label = (part) => enter(part, span, { dy: 16 * u });
    parts.push(
      enter(ellipsePart(id(`dot-${k}`), x(i), axisY, dot, { fill: 'accent' }), span, { scale: 0.6 }),
      label(textPart(id(`when-${k}`), when, x(i), axisY - dot / 2 - gap - row.whenH / 2, { fontSize: row.whenFs, maxWidth: row.labelW, fontWeight: 700, color: 'accent' })),
      label(textPart(id(`what-${k}`), what, x(i), axisY + dot / 2 + gap + row.whatH / 2, { fontSize: row.whatFs, maxWidth: row.labelW, fontWeight: 500, color: 'text' })),
    );
  });
  return blockGroup(el, parts);
}

// The column: `when` in a left column, the axis with a dot per event, `what` in a right column; the largest text size and
// roomiest spacing whose rows fit the room, else the tightest (grown upward from the band's floor, see bottomShift).
function expandColumn(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { events } = el.params;
  const n = events.length;
  const id = (part) => `${el.id}/${part}`;
  const width = contentWidth(size, 1500 * u, 40 * u, ctx.insets);
  const dot = DOT * u;
  const gap = GAP * u;
  const room = roomAt(freeBand(ctx), el.y);
  const whenFs0 = Math.max(1, Math.round(WHAT_SIZE * u));
  const whenW = Math.min(0.36 * width, Math.max(160 * u, ...events.map((e) => textWidth(e.when, whenFs0))));
  const axisX = -width / 2 + whenW + gap + dot / 2;
  const whatLeft = axisX + dot / 2 + gap;
  const whatW = width / 2 - whatLeft;
  let fit;
  for (const base of [WHAT_SIZE, MIN_TEXT]) {
    const fs = Math.max(1, Math.round(base * u));
    for (const tier of COLUMN_TIERS) {
      const rowH = events.map((e) => Math.max(lineCount(e.when, fs, whenW), lineCount(e.what, fs, whatW)) * fs * LINE_HEIGHT.sans + 2 * tier.padY * u);
      fit = { fs, rowH, gap: tier.gap * u };
      if (rowH.reduce((a, h) => a + h, 0) + (n - 1) * fit.gap <= room) break;
    }
    if (fit.rowH.reduce((a, h) => a + h, 0) + (n - 1) * fit.gap <= room) break;
  }
  const { fs, rowH } = fit;
  const total = rowH.reduce((a, h) => a + h, 0) + (n - 1) * fit.gap;
  const shift = bottomShift(ctx, el.y, total);
  const ys = stack(rowH, events.map(() => fit.gap)).map((y) => y + shift);
  const at = squeeze(sceneDuration, slot(n - 1)[1]);
  const stroke = Math.max(1, Math.round(4 * u));
  const parts = [drawIn(linePart(id('axis'), axisX, (ys[0] + ys[n - 1]) / 2, ys[n - 1] - ys[0], { stroke: 'line', strokeWidth: stroke, cap: 'round', rotate: 90 }), slot(0).map(at))];
  events.forEach(({ when, what }, i) => {
    const k = i + 1;
    const span = slot(i).map(at);
    const label = (part) => enter(part, span, { dx: 24 * u });
    parts.push(
      enter(ellipsePart(id(`dot-${k}`), axisX, ys[i], dot, { fill: 'accent' }), span, { scale: 0.6 }),
      label(textPart(id(`when-${k}`), when, -width / 2 + whenW / 2, ys[i], { fontSize: fs, maxWidth: whenW, fontWeight: 700, color: 'accent' })),
      label(textPart(id(`what-${k}`), what, whatLeft + whatW / 2, ys[i], { fontSize: fs, maxWidth: whatW, fontWeight: 500, color: 'text' })),
    );
  });
  return blockGroup(el, parts);
}

function expand(el, ctx) {
  const u = unit(ctx.size);
  const wantRow = (el.params.direction ?? (ctx.size[0] >= ctx.size[1] ? 'row' : 'column')) === 'row';
  const row = wantRow ? rowLayout(el.params.events, ctx.size, u, ctx.insets) : null;
  return row?.fits ? expandRow(el, ctx, row) : expandColumn(el, ctx);
}

export default Object.freeze({
  summary: 'a timeline of 2 to 8 dated events along a line, such as a roadmap, a history or a schedule',
  params,
  describe: {
    events: '2 to 8 events in order; each { when (up to 16 characters: "2024", "Q3", "Day 1"), what (up to 40) }',
    direction: 'row or column; default row on a wide canvas, column on a tall one. A row whose slices are too narrow for a word is laid out as a column',
  },
  example: {
    events: [
      { when: '2023', what: 'First prototype' },
      { when: 'Q1 2024', what: 'Public beta' },
      { when: 'Q3 2024', what: 'Version 1.0' },
      { when: '2025', what: 'Teams and sharing' },
    ],
  },
  // Centred across, and in the band between the safe area top and the caption zone, so a column fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    const m = /^(when|what)-(\d+)$/.exec(part);
    return m ? `events[${Number(m[2]) - 1}].${m[1]}` : null;
  },
  expand,
});
