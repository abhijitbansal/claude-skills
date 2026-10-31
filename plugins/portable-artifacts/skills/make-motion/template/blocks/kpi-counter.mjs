// kpi-counter: a card with a label, a number that counts up once the card is in, and an optional change line.
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack } from './layout.mjs';

const short = { type: 'string', minLength: 1, maxLength: 12 };
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['label', 'to'],
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 80 },
    to: { type: 'number' },
    from: { type: 'number', default: 0 },
    prefix: short,
    suffix: short,
    decimals: { type: 'integer', minimum: 0, maximum: 6, default: 0 },
    delta: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

const COUNT_SECONDS = 2; // the count runs this long once the number is in, unless the scene is short
const RISING = /^[+↑▲]/; // a delta that starts like this is good news, painted `good`; anything else is `text2`

const shown = (n, { prefix = '', suffix = '', decimals = 0 }) => `${prefix}${n.toFixed(decimals)}${suffix}`;

function expand(el, { size, sceneDuration }) {
  const u = unit(size);
  const p = el.params;
  const from = p.from ?? 0;
  const decimals = p.decimals ?? 0;
  const id = (part) => `${el.id}/${part}`;
  const cardW = contentWidth(size, 820 * u, 40 * u);
  const pad = 48 * u;
  const inner = cardW - 2 * pad;
  const labelFit = fitText(p.label, { size: 34 * u, min: 26 * u, maxWidth: inner, maxLines: 2 });
  // The number never wraps: size it so the widest value it shows fits on one line.
  const widest = [from, p.to].map((n) => shown(n, { ...p, decimals })).reduce((a, b) => (b.length > a.length ? b : a));
  const valueSize = Math.max(1, Math.floor(Math.min(140 * u, inner / textWidth(widest, 1))));
  const valueH = valueSize * 1.1;
  const deltaFit = p.delta && fitText(p.delta, { size: 32 * u, min: 24 * u, maxWidth: inner, maxLines: 2 });
  const heights = [labelFit.height, valueH, ...(deltaFit ? [deltaFit.height] : [])];
  const gaps = [16 * u, 20 * u];
  const content = heights.reduce((a, h) => a + h, 0) + gaps.slice(0, heights.length - 1).reduce((a, g) => a + g, 0);
  const [labelY, valueY, deltaY] = stack(heights, gaps);
  // Card, label, number, delta enter STAGGER apart; the count starts with the number's entrance and runs COUNT_SECONDS.
  const countStart = slot(2)[0];
  const countEnd = countStart + COUNT_SECONDS;
  const at = squeeze(sceneDuration, Math.max(countEnd, slot(deltaFit ? 3 : 2)[1]));
  const span = (i) => slot(i).map(at);
  const dy = 24 * u;
  const card = enter(rectPart(id('card'), 0, 0, cardW, content + 2 * pad, { fill: 'surface', stroke: 'line', strokeWidth: Math.max(1, Math.round(2 * u)), radius: Math.round(28 * u), elevated: true }), span(0), { scale: 0.96 });
  const label = enter(textPart(id('label'), p.label, 0, labelY, { fontSize: labelFit.fontSize, maxWidth: inner, fontWeight: 500, color: 'text2' }), span(1), { dy });
  const number = { id: id('value'), type: 'counter', x: 0, y: Math.round(valueY), from, to: p.to, decimals, fontSize: valueSize, fontWeight: 700, color: 'text' };
  if (p.prefix !== undefined) number.prefix = p.prefix;
  if (p.suffix !== undefined) number.suffix = p.suffix;
  const [start, landed] = span(2);
  number.keyframes = [
    { t: start, opacity: 0, value: from },
    { t: landed, opacity: 1, ease: 'enter' },
    { t: Math.max(landed, at(countEnd)), value: p.to, ease: 'outCubic' },
  ];
  const parts = [card, label, number];
  if (deltaFit) {
    const delta = textPart(id('delta'), p.delta, 0, deltaY, { fontSize: deltaFit.fontSize, maxWidth: inner, fontWeight: 600, color: RISING.test(p.delta) ? 'good' : 'text2' });
    parts.push(enter(delta, span(3), { dy }));
  }
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'one headline number on a card, counting up, with its label and an optional change line',
  params,
  describe: {
    label: 'what the number measures, above it',
    to: 'the number it counts up to',
    from: 'the number it starts from',
    prefix: 'text before the number, such as $ (up to 12 characters)',
    suffix: 'text after the number, such as % or M (up to 12 characters)',
    decimals: 'digits after the point, 0 to 6',
    delta: `a change line under the number; one that starts with + or ↑ is painted good, any other in text2`,
  },
  example: { label: 'Monthly active users', to: 48200, delta: '+12% on last month' },
  place: (size) => ({ x: size[0] / 2, y: size[1] / 2 }),
  expand,
});
