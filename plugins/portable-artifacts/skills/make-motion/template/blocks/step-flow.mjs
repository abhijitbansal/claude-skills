// step-flow: 2 to 6 numbered steps in boxes joined by arrows, as a row or a column, each box then its arrow in turn.
import { captionZone, safeMargin } from '../formats.mjs';
import { unit, contentWidth, fitText, lineCount, longestWordWidth, squeeze, slot, textPart, rectPart, linePart, enter, drawIn, blockGroup, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 24 } },
    direction: { enum: ['row', 'column'] },
  },
};

const LABEL_SIZES = [48, 44, MIN_TEXT]; // px at 1080, largest first
const ROW_PAD = 16; // px at 1080 on each side of a row box's label
// Column spacing, roomiest first: the column takes the first (with the largest label size) that fits its room.
const COLUMN_TIERS = [{ gap: 44, padY: 18 }, { gap: 32, padY: 12 }, { gap: 24, padY: 8 }];

// One label size for every step: the largest at which each fits `labelWidth` in `maxLines`, and the label height.
function labelFit(steps, sizes, u, labelWidth, maxLines) {
  const fontSize = Math.min(...steps.map((s) => fitText(s, { size: sizes[0] * u, min: sizes.at(-1) * u, maxWidth: labelWidth, maxLines }).fontSize));
  return { fontSize, height: Math.max(...steps.map((s) => lineCount(s, fontSize, labelWidth))) * fontSize * LINE_HEIGHT.sans };
}

function rowLayout(steps, size, u) {
  const n = steps.length;
  const gap = 56 * u;
  const box = Math.min(360 * u, (contentWidth(size, 1720 * u, 40 * u) - (n - 1) * gap) / n);
  const labelWidth = box - 2 * ROW_PAD * u;
  // A row works only if every word of every label fits its box at the smallest size.
  const fits = steps.every((s) => longestWordWidth(s, MIN_TEXT * u) <= labelWidth);
  const label = labelFit(steps, LABEL_SIZES, u, labelWidth, 3);
  const step = box + gap;
  const x = (i) => (i - (n - 1) / 2) * step;
  return { fits, box, gap, labelWidth, label, centre: (i) => [x(i), 0], arrow: (i) => [x(i) + step / 2, 0], rotate: 0 };
}

// The column: the largest label size and roomiest spacing whose stack fits `room` tall (else the tightest of all).
function columnLayout(steps, size, u, room, numH) {
  const n = steps.length;
  const box = contentWidth(size, 760 * u, 40 * u);
  const labelWidth = box - 96 * u;
  let layout;
  for (const fontSize of LABEL_SIZES) {
    const label = labelFit(steps, [fontSize, MIN_TEXT], u, labelWidth, 2);
    for (const tier of COLUMN_TIERS) {
      const boxH = Math.max(numH, label.height) + 2 * tier.padY * u;
      const gap = tier.gap * u;
      const step = boxH + gap;
      const y = (i) => (i - (n - 1) / 2) * step;
      layout = { box, boxH, gap, labelWidth, label, centre: (i) => [0, y(i)], arrow: (i) => [0, y(i) + step / 2], rotate: 90 };
      if (n * boxH + (n - 1) * gap <= room) return layout;
    }
  }
  return layout;
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { steps } = el.params;
  const n = steps.length;
  const id = (part) => `${el.id}/${part}`;
  const numSize = Math.round(MIN_TEXT * u);
  const numH = numSize * LINE_HEIGHT.sans;
  const wantRow = (el.params.direction ?? (size[0] >= size[1] ? 'row' : 'column')) === 'row';
  const row = wantRow ? rowLayout(steps, size, u) : null;
  const isRow = row?.fits === true;
  const layout = isRow ? { ...row, boxH: 16 * u + numH + 6 * u + row.label.height + 20 * u } : columnLayout(steps, size, u, roomAt(freeBand(ctx), el.y), numH);
  const { boxH } = layout;
  // Box i, then arrow i, each STAGGER after the one before.
  const at = squeeze(sceneDuration, slot(2 * n - 2)[1]);
  const span = (k) => slot(k).map(at);
  const stroke = Math.max(1, Math.round(4 * u));
  const arrowW = layout.gap - (isRow ? 20 : 12) * u; // linePart keeps it longer than its head and caps
  const parts = [];
  steps.forEach((text, i) => {
    const k = i + 1;
    const [x, y] = layout.centre(i);
    const box = rectPart(id(`box-${k}`), x, y, layout.box, boxH, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(16 * u), elevated: true });
    const top = y - boxH / 2;
    const numAt = isRow ? [x, top + 16 * u + numH / 2] : [x - layout.box / 2 + 40 * u, y];
    const labelAt = isRow ? [x, top + 16 * u + numH + 6 * u + layout.label.height / 2] : [x + 24 * u, y];
    const num = textPart(id(`num-${k}`), String(k), ...numAt, { fontSize: numSize, maxWidth: 80 * u, fontWeight: 700, color: 'accent' });
    const label = textPart(id(`label-${k}`), text, ...labelAt, { fontSize: layout.label.fontSize, maxWidth: layout.labelWidth, fontWeight: 600, color: 'text' });
    for (const part of [box, num, label]) parts.push(enter(part, span(2 * i), { dy: 24 * u }));
    if (i < n - 1) {
      const [ax, ay] = layout.arrow(i);
      const arrow = linePart(id(`arrow-${k}`), ax, ay, arrowW, { stroke: 'accent', strokeWidth: stroke, cap: 'round', arrow: 'end', ...(layout.rotate ? { rotate: layout.rotate } : {}) });
      parts.push(drawIn(arrow, span(2 * i + 1)));
    }
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a short process: 2 to 6 numbered steps joined by arrows, revealed one at a time',
  params,
  describe: {
    steps: '2 to 6 step labels, each up to 24 characters, in order',
    direction: 'row or column; default row on a wide canvas, column on a tall one. A row whose boxes are too narrow for a label word is laid out as a column',
  },
  example: { steps: ['Write the spec', 'Validate', 'Preview', 'Render'] },
  // Centred across, and centred in the band between the safe area top and the caption zone, so a column fits above
  // captions.
  place: (size, format) => ({ x: size[0] / 2, y: (safeMargin(size) + captionZone(size, format).top) / 2 }),
  paramOf: (part) => (/^label-(\d+)$/.test(part) ? `steps[${Number(part.split('-')[1]) - 1}]` : null),
  expand,
});
