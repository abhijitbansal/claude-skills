// checklist: 2 to 8 items, each on a row with an empty circle; once every row is in, the items are ticked in order.
import { unit, contentWidth, fitText, lineCount, squeeze, slot, textPart, rectPart, ellipsePart, linePart, enter, blockGroup, freeBand, roomAt, ENTER_SECONDS, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 40 } },
    tickAfter: { type: 'number', minimum: 0.1, maximum: 2, default: 0.25 },
  },
};

// The tick inside a circle of diameter d, as two strokes from its centre: the short one down to the elbow, then the long
// one up to the right. Each is [dx, dy, length, angle] of a line centred at (dx, dy), in units of d.
const SHORT_STROKE = [-0.14, 0.1, 0.226, 45];
const LONG_STROKE = [0.09, 0.01, 0.453, -48.6];
const STROKE_SHARE = 0.09; // the tick's stroke width, of d
const SHORT_DRAW = [0.15, 0.3]; // seconds after the tick starts: the short stroke draws over this span
const LONG_DRAW = [0.3, 0.5]; // ... then the long one

const FONT_SIZES = [48, 44, MIN_TEXT]; // px at 1080, largest first
// Row spacing, roomiest first: the rows take the largest font size, then the roomiest spacing, that fits their room.
const ROW_TIERS = [{ padY: 16, gap: 14 }, { padY: 10, gap: 8 }, { padY: 6, gap: 6 }];

// One font size for every row (the largest at which each item fits its row in two lines and the rows fit `room` tall)
// and the row height and gap that go with it; the smallest size and tightest spacing when nothing fits.
function fitRows(items, { u, d, textW, room }) {
  let fit;
  for (const base of FONT_SIZES) {
    const fs = Math.min(...items.map((item) => fitText(item, { size: base * u, min: MIN_TEXT * u, maxWidth: textW, maxLines: 2 }).fontSize));
    const lines = Math.max(...items.map((item) => lineCount(item, fs, textW)));
    for (const tier of ROW_TIERS) {
      const rowH = Math.max(d, lines * fs * LINE_HEIGHT.sans) + 2 * tier.padY * u;
      fit = { fontSize: fs, rowH, gap: tier.gap * u };
      if (items.length * rowH + (items.length - 1) * fit.gap <= room) return fit;
    }
  }
  return fit;
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { items } = el.params;
  const tickAfter = el.params.tickAfter ?? params.properties.tickAfter.default;
  const n = items.length;
  const id = (part) => `${el.id}/${part}`;
  const rowW = contentWidth(size, 1240 * u, 40 * u, ctx.insets);
  const d = 44 * u;
  const padX = 24 * u;
  const textLeft = -rowW / 2 + padX + d + 20 * u;
  const textW = rowW / 2 - padX - textLeft;
  const { fontSize, rowH, gap } = fitRows(items, { u, d, textW, room: roomAt(freeBand(ctx), el.y) });
  const y = (i) => (i - (n - 1) / 2) * (rowH + gap);
  const circleX = -rowW / 2 + padX + d / 2;
  // Rows enter STAGGER apart; the first tick starts when the last row has landed, then one every tickAfter seconds.
  const ticksFrom = slot(n - 1)[1];
  const tickStart = (i) => ticksFrom + i * tickAfter;
  const at = squeeze(sceneDuration, tickStart(n - 1) + Math.max(ENTER_SECONDS, LONG_DRAW[1]));
  const stroke = Math.max(1, d * STROKE_SHARE);
  const parts = [];
  items.forEach((item, i) => {
    const k = i + 1;
    const rowSpan = slot(i).map(at);
    const row = [
      rectPart(id(`row-${k}`), 0, y(i), rowW, rowH, { fill: 'surface', radius: Math.round(14 * u), elevated: true }),
      ellipsePart(id(`box-${k}`), circleX, y(i), d, { stroke: 'text2', strokeWidth: Math.max(1, Math.round(3 * u)) }),
      textPart(id(`item-${k}`), item, textLeft + textW / 2, y(i), { fontSize, maxWidth: textW, fontWeight: 500, color: 'text' }),
    ];
    for (const part of row) parts.push(enter(part, rowSpan, { dx: -24 * u }));
    const t0 = tickStart(i);
    parts.push(enter(ellipsePart(id(`tick-${k}`), circleX, y(i), d, { fill: 'good' }), [t0, t0 + ENTER_SECONDS].map(at), { scale: 0.6 }));
    [SHORT_STROKE, LONG_STROKE].forEach(([dx, dy, length, angle], s) => {
      const [from, to] = s === 0 ? SHORT_DRAW : LONG_DRAW;
      const line = linePart(id(`check-${k}-${s === 0 ? 'a' : 'b'}`), circleX + dx * d, y(i) + dy * d, length * d, { stroke: 'surface', strokeWidth: stroke, cap: 'round', rotate: angle });
      parts.push({ ...line, keyframes: [{ t: at(t0 + from), draw: 0 }, { t: at(t0 + to), draw: 1, ease: 'outCubic' }] });
    });
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a list of 2 to 8 items that get ticked off one by one',
  params,
  describe: {
    items: '2 to 8 items, each up to 40 characters, in order',
    tickAfter: 'seconds between one tick and the next, 0.1 to 2; ticking starts once every row is in',
  },
  example: { items: ['Offline renders', 'Same spec, same video', 'Captions in six styles', 'No code to write'] },
  // Centred across, and centred in the band between the safe area top and the caption zone, so the rows fit above
  // captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (/^item-(\d+)$/.test(part) ? `items[${Number(part.split('-')[1]) - 1}]` : null),
  expand,
});
