// sketch-steps: 2 to 6 numbered steps, each a hand-drawn box with its number in an accent circle, joined by arrows: a row on a wide
// canvas, a column on a tall one. Each step is drawn box, circle, number, label, then the arrow to the next step.
import { abovePlace, blockGroup } from './layout.mjs';
import { fitLabel, fitted, labelPart, boxPart, ovalPart, linePart, sketchRoom, pickLayout, textWidth } from './sketch-layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['steps'],
  properties: {
    steps: { type: 'array', minItems: 2, maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 32 } },
  },
};

const WIDTH_CAP = 1720; // px at 1080
const COLUMN_WIDTH = 820; // px at 1080: a column's boxes are this wide at most
const COLUMN_MIN = 520; // ... and this wide at least
const NUMERAL = 52; // px at 1080: the number in the circle (at least the text floor)
const NUMBER_GAP = 12; // between the circle and the label in a row's box
const INLINE_GAP = 20; // between the circle and the label in a column's box
const ARROW_GAP = 14; // between a box and its arrow
// Sizes, roomiest first, px at 1080. `lines`: how many lines a label may wrap onto in a row (a column's take two).
const TIERS = [
  { label: 64, circle: 76, padX: 28, padY: 26, boxMax: 360, gap: 110, lines: 3 },
  { label: 56, circle: 70, padX: 24, padY: 22, boxMax: 310, gap: 96, lines: 3 },
  { label: 48, circle: 64, padX: 20, padY: 18, boxMax: 270, gap: 84, lines: 3 },
  { label: 44, circle: 60, padX: 16, padY: 14, boxMax: 240, gap: 72, lines: 4 },
  { label: 40, circle: 58, padX: 14, padY: 10, boxMax: 210, gap: 64, lines: 4 },
];
const COLUMN_LINES = 2;
const COLUMN_GAP_SHARE = 0.55; // a column's arrows are this share of a row's long

function measure(steps, mode, tier, room) {
  const { u } = room;
  const n = steps.length;
  const row = mode === 'row';
  const fs = Math.max(1, Math.round(tier.label * u));
  const circle = Math.max(1, Math.round(tier.circle * u));
  const [padX, padY] = [tier.padX * u, tier.padY * u];
  const gap = (row ? tier.gap : tier.gap * COLUMN_GAP_SHARE) * u;
  const lines = row ? tier.lines : COLUMN_LINES;
  // A column's boxes are as wide as the longest label needs (between COLUMN_MIN and COLUMN_WIDTH), a row's fill the room.
  const natural = 2 * padX + circle + INLINE_GAP * u + Math.max(...steps.map((step) => textWidth(step, fs)));
  const boxW = row ? Math.min(tier.boxMax * u, (room.width - (n - 1) * gap) / n) : Math.min(room.width, COLUMN_WIDTH * u, Math.max(natural, COLUMN_MIN * u));
  const inner = boxW - 2 * padX - (row ? 0 : circle + INLINE_GAP * u);
  const fits = steps.map((step) => fitLabel(step, { sizes: [fs], maxWidth: inner, maxLines: lines }));
  const tallest = Math.max(...fits.map((fit) => fit.height));
  const boxH = row ? 2 * padY + circle + NUMBER_GAP * u + tallest : 2 * padY + Math.max(circle, tallest);
  const [width, height] = row ? [n * boxW + (n - 1) * gap, boxH] : [boxW, n * boxH + (n - 1) * gap];
  const ok = steps.every((step, i) => fitted(step, fits[i], inner, lines));
  return { row, u, fs, circle, padX, padY, gap, boxW, boxH, inner, fits, width, height, overflow: Math.max(width / room.width, height / room.height) + (ok ? 0 : 1) };
}

function expand(el, ctx) {
  const { steps } = el.params;
  const room = sketchRoom(ctx, el, WIDTH_CAP);
  const wide = ctx.size[0] >= ctx.size[1];
  const modes = wide ? ['row', 'column'] : ['column', 'row']; // the other way only when the first cannot hold the labels
  const layout = pickLayout(modes.flatMap((mode) => TIERS.map((tier) => measure(steps, mode, tier, room))));
  const { row, u, circle, boxW, boxH, gap, padX, padY, inner } = layout;
  const id = (part) => `${el.id}/${part}`;
  const numeral = Math.max(1, Math.round(NUMERAL * u));
  const step = row ? boxW + gap : boxH + gap;
  const parts = steps.flatMap((text, i) => {
    const k = i + 1;
    const at = (i - (steps.length - 1) / 2) * step;
    const [cx, cy] = row ? [at, 0] : [0, at];
    const [circleX, circleY] = row ? [cx, cy - boxH / 2 + padY + circle / 2] : [cx - boxW / 2 + padX + circle / 2, cy];
    const label = row
      ? labelPart(id(`label-${k}`), text, layout.fits[i], cx, cy - boxH / 2 + padY + circle + NUMBER_GAP * u + layout.fits[i].height / 2)
      : labelPart(id(`label-${k}`), text, layout.fits[i], cx - boxW / 2 + padX + circle + INLINE_GAP * u, cy, { anchor: 'left', align: 'left' });
    const own = [
      boxPart(id(`box-${k}`), cx, cy, boxW, boxH),
      ovalPart(id(`circle-${k}`), circleX, circleY, circle, circle, { stroke: 'accent' }),
      labelPart(id(`num-${k}`), String(k), fitLabel(String(k), { sizes: [numeral], maxWidth: circle }), circleX, circleY),
      label,
    ];
    if (i === steps.length - 1) return own;
    const [from, to] = row ? [[cx + boxW / 2 + ARROW_GAP * u, cy], [cx + step - boxW / 2 - ARROW_GAP * u, cy]] : [[cx, cy + boxH / 2 + ARROW_GAP * u], [cx, cy + step - boxH / 2 - ARROW_GAP * u]];
    return [...own, linePart(id(`arrow-${k}`), from, to, { arrow: 'end' })];
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a hand-drawn process: 2 to 6 numbered steps joined by arrows, drawn one after another; draws only in a hand-drawn scene',
  sketchOnly: true,
  params,
  describe: {
    steps: '2 to 6 step labels, each up to 32 characters, in order. A row on a wide canvas, a column on a tall one (a row whose boxes are too narrow for a label is drawn as a column)',
  },
  example: { steps: ['Write the spec', 'Validate', 'Preview', 'Render'] },
  // Centred across, and in the band between the safe area top and the caption zone, so a column fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => (/^label-(\d+)$/.test(part) ? `steps[${Number(part.split('-')[1]) - 1}]` : null),
  expand,
});
