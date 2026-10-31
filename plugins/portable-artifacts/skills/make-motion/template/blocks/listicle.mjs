// listicle: a title held from the first frame, then 2 to 5 rows that come in one every itemSeconds, each with a number
// badge when numbered. The title is the hook of a viral spec, so keep it to 3 to 7 words.
import { unit, contentWidth, fitHeight, sizeLadder, lineCount, fitSchedule, textPart, rectPart, enter, blockGroup, stack, freeBand, roomAt, ENTER_SECONDS, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'items'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 40 },
    items: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 40 } },
    numbered: { type: 'boolean', default: true },
    itemSeconds: { type: 'number', minimum: 1, maximum: 4, default: 2 },
  },
};

const FIRST_ROW_SECONDS = 0.8; // the first row comes in this long after the scene starts
const EPSILON = 1e-9;
const TITLE_SIZES = [88, 76, 64, 56, 48, MIN_TEXT]; // px at 1080, largest first
const ROW_SIZES = [48, 44, MIN_TEXT];
const TITLE_GAP = 40; // px at 1080 between the title and the first row
// Row spacing, roomiest first: the list takes the largest sizes and the roomiest spacing that fit.
const ROW_TIERS = [{ padY: 16, gap: 14 }, { padY: 10, gap: 8 }, { padY: 6, gap: 6 }];

const itemSeconds = (p) => p.itemSeconds ?? params.properties.itemSeconds.default;
const minDuration = (p) => FIRST_ROW_SECONDS + p.items.length * itemSeconds(p);
const num = (n) => Number(n.toFixed(2));

// The largest title size, row size and spacing at which the title, the gap and every row fit `room` tall: the first
// combination, scanning the sizes from the largest, that does; the smallest of everything when none does.
function fitList(p, { u, titleW, textW, d, room }) {
  const n = p.items.length;
  let fit;
  for (const titleSize of sizeLadder(TITLE_SIZES, u)) {
    const title = fitHeight(p.title, { sizes: [titleSize], maxWidth: titleW, maxHeight: Infinity, lineHeight: LINE_HEIGHT.title });
    for (const base of ROW_SIZES) {
      const fs = Math.min(...p.items.map((item) => fitHeight(item, { sizes: sizeLadder([base, MIN_TEXT], u), maxWidth: textW, maxHeight: Infinity }).fontSize));
      const lines = Math.max(...p.items.map((item) => lineCount(item, fs, textW)));
      for (const tier of ROW_TIERS) {
        const rowH = Math.max(d, lines * fs * LINE_HEIGHT.sans) + 2 * tier.padY * u;
        fit = { title, fontSize: fs, rowH, gap: tier.gap * u };
        if (title.height + TITLE_GAP * u + n * rowH + (n - 1) * fit.gap <= room) return fit;
      }
    }
  }
  return fit;
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const p = el.params;
  const n = p.items.length;
  const numbered = p.numbered ?? params.properties.numbered.default;
  const id = (part) => `${el.id}/${part}`;
  const rowW = contentWidth(size, 1240 * u, 0, ctx.insets);
  const padX = 24 * u;
  const d = 64 * u; // the number badge's diameter
  const textLeft = -rowW / 2 + padX + (numbered ? d + 20 * u : 0);
  const textW = rowW / 2 - padX - textLeft;
  const { title, fontSize, rowH, gap } = fitList(p, { u, titleW: rowW, textW, d, room: roomAt(freeBand(ctx), el.y) });
  const heights = [title.height, ...p.items.map(() => rowH)];
  const ys = stack(heights, [TITLE_GAP * u, ...p.items.slice(1).map(() => gap)]);
  const step = itemSeconds(p);
  // At the validator's minimum scene length the rows arrive exactly at 0.8 + i x itemSeconds (nothing is squeezed).
  const at = fitSchedule(sceneDuration, FIRST_ROW_SECONDS + (n - 1) * step + ENTER_SECONDS, minDuration(p));
  const parts = [textPart(id('title'), p.title, 0, ys[0], { fontSize: title.fontSize, maxWidth: rowW, fontWeight: 800, color: 'text' })];
  const badgeSize = Math.max(1, Math.round(MIN_TEXT * u));
  p.items.forEach((item, i) => {
    const k = i + 1;
    const y = ys[k];
    const start = FIRST_ROW_SECONDS + i * step;
    const span = [start, start + ENTER_SECONDS].map(at);
    const row = [rectPart(id(`row-${k}`), 0, y, rowW, rowH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(20 * u), elevated: true })];
    if (numbered) {
      const badgeX = -rowW / 2 + padX + d / 2;
      row.push(rectPart(id(`badge-${k}`), badgeX, y, d, d, { fill: 'accent', radius: Math.round(d / 2) }));
      row.push(textPart(id(`number-${k}`), String(k), badgeX, y, { fontSize: badgeSize, maxWidth: d, fontWeight: 800, color: 'surface' }));
    }
    row.push(textPart(id(`item-${k}`), item, textLeft + textW / 2, y, { fontSize, maxWidth: textW, fontWeight: 600, color: 'text' }));
    for (const part of row) parts.push(enter(part, span, { dx: 32 * u }));
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a title and 2 to 5 numbered rows that come in one at a time, such as "3 tricks for faster edits"',
  params,
  describe: {
    title: 'the heading, up to 40 characters, on screen from the first frame; 3 to 7 words reads best as a viral hook',
    items: '2 to 5 rows, each up to 40 characters, in the order they appear',
    numbered: 'a number badge on each row (default true)',
    itemSeconds: 'seconds between one row and the next, 1 to 4; the first row comes in at 0.8 s and the scene must last until the last row has had its turn',
  },
  example: { title: '3 tricks for faster edits', items: ['Cut on the beat', 'Keep captions short', 'Hook in one second'] },
  // Centred across, and in the band between the safe area top and the caption zone, so the title and rows fit above
  // captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  hook: ['title'],
  paramOf: (part) => (/^item-(\d+)$/.test(part) ? `items[${Number(part.split('-')[1]) - 1}]` : (part === 'title' ? part : null)),
  minDuration,
  validate: (p, { sceneDuration }) => (sceneDuration + EPSILON >= minDuration(p)
    ? []
    : [{ path: 'itemSeconds', message: `${p.items.length} items × ${num(itemSeconds(p))}s need a scene of at least ${num(minDuration(p))}s` }]),
  expand,
});
