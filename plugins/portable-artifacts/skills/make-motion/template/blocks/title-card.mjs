// title-card: an optional kicker, a big title, an accent rule and an optional subtitle, centred on the block.
import { unit, contentWidth, fitText, squeeze, slot, textPart, linePart, enter, drawIn, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT, centrePlace } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 80 },
    subtitle: { type: 'string', minLength: 1, maxLength: 80 },
    kicker: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

// Title and subtitle sizes (px at 1080), largest first: the card takes the first whose stack fits its room (the band
// above the caption zone when the spec has captions), else the last.
const SIZE_TIERS = [[120, 48], [104, 48], [88, 44], [72, MIN_TEXT], [56, MIN_TEXT]];

function rowsFor(el, u, width, [titleSize, subSize]) {
  const { title, subtitle, kicker } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const titleFit = fitText(title, { size: titleSize * u, min: Math.min(titleSize, 56) * u, maxWidth: width, maxLines: 3, lineHeight: LINE_HEIGHT.title });
  const kickerFit = kicker && fitText(kicker, { size: MIN_TEXT * u, min: MIN_TEXT * u, maxWidth: width, maxLines: 2 });
  const subWidth = Math.min(width, 1200 * u);
  const subFit = subtitle && fitText(subtitle, { size: subSize * u, min: MIN_TEXT * u, maxWidth: subWidth, maxLines: 3 });
  const ruleStroke = Math.round(6 * u);
  // Top to bottom: kicker, title, rule, subtitle; each present item enters STAGGER after the one before.
  return [
    kickerFit && { h: kickerFit.height, gap: 28 * u, make: (y) => textPart(id('kicker'), kicker, 0, y, { fontSize: kickerFit.fontSize, maxWidth: width, fontWeight: 700, color: 'accent' }) },
    { h: titleFit.height, gap: 40 * u, make: (y) => textPart(id('title'), title, 0, y, { fontSize: titleFit.fontSize, maxWidth: width, fontWeight: 700, role: 'title', color: 'text' }) },
    { h: ruleStroke, gap: 40 * u, line: true, make: (y) => linePart(id('rule'), 0, y, 120 * u, { stroke: 'accent', strokeWidth: ruleStroke, cap: 'round' }) },
    subFit && { h: subFit.height, gap: 0, make: (y) => textPart(id('subtitle'), subtitle, 0, y, { fontSize: subFit.fontSize, maxWidth: subWidth, fontWeight: 500, color: 'text2' }) },
  ].filter(Boolean);
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const width = contentWidth(size, 1560 * u, 48 * u, ctx.insets);
  const room = roomAt(freeBand(ctx), el.y);
  const height = (rows) => rows.reduce((a, r, i) => a + r.h + (i < rows.length - 1 ? r.gap : 0), 0);
  let rows;
  for (const tier of SIZE_TIERS) {
    rows = rowsFor(el, u, width, tier);
    if (height(rows) <= room) break;
  }
  const ys = stack(rows.map((r) => r.h), rows.map((r) => r.gap));
  const at = squeeze(sceneDuration, slot(rows.length - 1)[1]);
  const children = rows.map((row, i) => {
    const span = slot(i).map(at);
    const part = row.make(ys[i]);
    return row.line ? drawIn(part, span) : enter(part, span, { dy: 24 * u });
  });
  return blockGroup(el, children);
}

export default Object.freeze({
  summary: 'an opening or section title: kicker, big title, accent rule, subtitle, centred',
  params,
  describe: {
    title: 'the headline, up to 80 characters; shrinks to fit three lines',
    subtitle: 'one supporting line under the accent rule',
    kicker: 'a short label above the title, in the accent colour',
  },
  example: { kicker: 'Q3 2026', title: 'Revenue up 18%', subtitle: 'Three products, one quarter, no new hires' },
  place: (size, format, _side, insets) => centrePlace(size, format, insets),
  hook: ['title'],
  expand,
});
