// before-after: two numbers compared. A "before" card and an "after" card (side by side, stacked on a tall canvas) joined
// by an arrow; each number counts up when its card is in, the after number from the before one. before-after-swipe
// compares two pictures instead.
import { unit, contentWidth, textWidth, fitText, fitHeight, sizeLadder, squeeze, slot, textPart, rectPart, linePart, enter, drawIn, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';

const LIMIT = 999999999999;
const side = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'value'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 24 },
    value: { type: 'number', minimum: -LIMIT, maximum: LIMIT },
    suffix: { type: 'string', minLength: 1, maxLength: 6 },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['before', 'after'],
  properties: {
    before: side,
    after: side,
    headline: { type: 'string', minLength: 1, maxLength: 40 },
  },
};

const COUNT_SECONDS = 1.5; // each count runs this long once its card is in, unless the scene is short
const MAX_DECIMALS = 4;
const HEADLINE_SIZES = [64, 56, 48, MIN_TEXT]; // px at 1080, largest first
const VALUE_MAX = 160; // px at 1080: the largest number
const SCALES = [1, 0.85, 0.7, 0.6]; // the card shrinks by the first of these at which everything fits
const PAD = 36; // px at 1080
const GAP = 16; // px at 1080 between a card's label and its number
const ARROW = 200; // px at 1080 between the cards, a row's arrow slot; a column uses ARROW_COLUMN
const ARROW_COLUMN = 120;
const HEAD_GAP = 40;

// Digits after the point a value needs, at most MAX_DECIMALS: both numbers show the larger count.
const decimalsOf = (n) => Math.min(MAX_DECIMALS, (String(n).split('.')[1] ?? '').replace(/e.*/, '').length);
const shown = (n, suffix, decimals) => `${n.toFixed(decimals)}${suffix ?? ''}`;

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { before, after, headline } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const row = size[0] >= size[1];
  const wide = contentWidth(size, 1700 * u, 0, ctx.insets);
  const room = roomAt(freeBand(ctx), el.y);
  const decimals = Math.max(decimalsOf(before.value), decimalsOf(after.value));
  const widest = [shown(before.value, before.suffix, decimals), shown(after.value, after.suffix, decimals)].reduce((a, b) => (b.length > a.length ? b : a));
  const headFit = headline && fitHeight(headline, { sizes: sizeLadder(HEADLINE_SIZES, u), maxWidth: wide, maxHeight: room / 5, lineHeight: LINE_HEIGHT.title });
  const headH = headFit ? headFit.height + HEAD_GAP * u : 0;
  let fit;
  for (const k of SCALES) {
    const slotW = (row ? ARROW : ARROW_COLUMN) * u * k;
    const cardW = row ? Math.min(700 * u, (wide - slotW) / 2) : contentWidth(size, 800 * u, 0, ctx.insets);
    const inner = Math.max(1, cardW - 2 * PAD * u * k);
    const labels = [before, after].map((s) => fitText(s.label, { size: 44 * u * k, min: MIN_TEXT * u, maxWidth: inner, maxLines: 2 }));
    const valueSize = Math.max(1, Math.round(MIN_TEXT * u), Math.floor(Math.min(VALUE_MAX * u * k, inner / textWidth(widest, 1))));
    const labelH = Math.max(...labels.map((l) => l.height));
    const cardH = 2 * PAD * u * k + labelH + GAP * u * k + valueSize * 1.1;
    fit = { k, slotW, cardW, inner, labels, valueSize, labelH, cardH };
    if (headH + (row ? cardH : 2 * cardH + slotW) <= room) break;
  }
  const { k, slotW, cardW, inner, labels, valueSize, labelH, cardH } = fit;
  const ys = stack([...(headFit ? [headFit.height] : []), ...(row ? [cardH] : [cardH, cardH])], [HEAD_GAP * u, slotW]);
  const cardYs = ys.slice(headFit ? 1 : 0);
  const centres = row ? [[-(cardW + slotW) / 2, cardYs[0]], [(cardW + slotW) / 2, cardYs[0]]] : [[0, cardYs[0]], [0, cardYs[1]]];
  // Headline, before card, arrow, after card, each STAGGER after the one before; each count starts as its card lands.
  const first = headFit ? 1 : 0;
  const countEnd = (n) => slot(first + n)[0] + COUNT_SECONDS; // a count runs from its card's entrance
  const at = squeeze(sceneDuration, countEnd(2)); // the after card is the last in
  const span = (n) => slot(n).map(at);
  const parts = [];
  if (headFit) parts.push(enter(textPart(id('headline'), headline, 0, ys[0], { fontSize: headFit.fontSize, maxWidth: wide, fontWeight: 700, role: 'title', color: 'text' }), span(0), { dy: 24 * u }));
  [['before', before, 0], ['after', after, 2]].forEach(([name, s, n], i) => {
    const [cx, cy] = centres[i];
    const top = cy - cardH / 2 + PAD * u * k;
    const range = span(first + n);
    const accent = i === 1;
    const card = rectPart(id(`${name}-card`), cx, cy, cardW, cardH, { fill: 'surface', stroke: accent ? 'accent' : 'line', strokeWidth: Math.max(1, Math.round((accent ? 4 : 2) * u)), radius: Math.round(28 * u), elevated: true });
    const label = textPart(id(`${name}-label`), s.label, cx, top + labelH / 2, { fontSize: labels[i].fontSize, maxWidth: inner, fontWeight: 500, color: 'text2' });
    const from = i === 0 ? 0 : before.value;
    const counter = { id: id(`${name}-value`), type: 'counter', x: Math.round(cx), y: Math.round(cy + cardH / 2 - PAD * u * k - (valueSize * 1.1) / 2), from, to: s.value, decimals, fontSize: valueSize, fontWeight: 700, color: 'text' };
    if (s.suffix !== undefined) counter.suffix = s.suffix;
    counter.keyframes = [
      { t: range[0], opacity: 0, value: from },
      { t: range[1], opacity: 1, ease: 'enter' },
      { t: Math.max(range[1], at(countEnd(n))), value: s.value, ease: 'outCubic' },
    ];
    for (const part of [card, label]) parts.push(enter(part, range, { dy: 24 * u }));
    parts.push(counter);
    if (i === 0) {
      const stroke = Math.max(1, Math.round(6 * u));
      const [ax, ay] = row ? [0, cy] : [0, (centres[0][1] + centres[1][1]) / 2];
      const length = Math.max(1, slotW - (row ? 40 : 24) * u);
      parts.push(drawIn(linePart(id('arrow'), ax, ay, length, { stroke: 'accent', strokeWidth: stroke, cap: 'round', arrow: 'end', ...(row ? {} : { rotate: 90 }) }), span(first + 1)));
    }
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'two numbers compared: a before card and an after card joined by an arrow, each counting up',
  params,
  describe: {
    before: '{ label, value, suffix? }: the starting number; label up to 24 characters, value at most 999999999999 either side of 0, suffix such as % or ms up to 6 characters',
    after: '{ label, value, suffix? }: the number it became, the same way; it counts up from the before value',
    headline: 'a line above the cards, up to 40 characters',
  },
  example: { headline: 'One change to the build', before: { label: 'Before', value: 94, suffix: 's' }, after: { label: 'After', value: 12, suffix: 's' } },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    const [, name, kind] = /^(before|after)-(label|value)$/.exec(part) ?? [];
    if (name) return kind === 'label' ? `${name}.label` : `${name}.value`;
    return part === 'headline' ? 'headline' : null;
  },
  expand,
});
