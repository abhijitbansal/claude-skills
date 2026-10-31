// quote-card: a pull quote on a card: an accent quotation mark, the quote, and an optional attribution.
import { captionZone, safeMargin } from '../formats.mjs';
import { unit, contentWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['quote'],
  properties: {
    quote: { type: 'string', minLength: 1, maxLength: 200 },
    attribution: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

const MARK = '“'; // the opening quotation mark
const DASHED = /^[-–—]/; // an attribution that already starts with a dash keeps it

// Quote size, quotation-mark size and card padding (px at 1080), roomiest first: the card takes the first that fits its
// room (the band above the caption zone when the spec has captions), else the last.
const TIERS = [{ quote: 56, mark: 120, pad: 64 }, { quote: 48, mark: 96, pad: 48 }, { quote: MIN_TEXT, mark: 80, pad: 36 }, { quote: MIN_TEXT, mark: 64, pad: 24 }];

function layout(el, u, cardW, tier) {
  const { quote, attribution } = el.params;
  const pad = tier.pad * u;
  const inner = cardW - 2 * pad;
  const markSize = Math.max(1, Math.round(tier.mark * u));
  const markH = markSize * LINE_HEIGHT.title;
  const quoteFit = fitText(quote, { size: tier.quote * u, min: MIN_TEXT * u, maxWidth: inner, maxLines: 5 });
  const byline = attribution && (DASHED.test(attribution) ? attribution : `— ${attribution}`);
  const byFit = byline && fitText(byline, { size: MIN_TEXT * u, min: MIN_TEXT * u, maxWidth: inner, maxLines: 2 });
  const heights = [markH, quoteFit.height, ...(byFit ? [byFit.height] : [])];
  const gaps = [8 * u, 32 * u];
  const content = heights.reduce((a, h) => a + h, 0) + gaps.slice(0, heights.length - 1).reduce((a, g) => a + g, 0);
  return { inner, markSize, quoteFit, byline, byFit, heights, gaps, cardH: content + 2 * pad };
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { quote } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const cardW = contentWidth(size, 1400 * u, 40 * u);
  const room = roomAt(freeBand(ctx), el.y);
  let fit;
  for (const tier of TIERS) {
    fit = layout(el, u, cardW, tier);
    if (fit.cardH <= room) break;
  }
  const { inner, markSize, quoteFit, byline, byFit, heights, gaps, cardH } = fit;
  const ys = stack(heights, gaps);
  const at = squeeze(sceneDuration, slot(byFit ? 3 : 2)[1]);
  const span = (i) => slot(i).map(at);
  const dy = 24 * u;
  const parts = [
    enter(rectPart(id('card'), 0, 0, cardW, cardH, { fill: 'surface', radius: Math.round(28 * u), elevated: true }), span(0), { scale: 0.96 }),
    enter(textPart(id('mark'), MARK, 0, ys[0], { fontSize: markSize, maxWidth: 200 * u, fontWeight: 700, role: 'title', color: 'accent' }), span(1), { scale: 0.8 }),
    enter(textPart(id('quote'), quote, 0, ys[1], { fontSize: quoteFit.fontSize, maxWidth: inner, fontWeight: 500, color: 'text' }), span(2), { dy }),
  ];
  if (byFit) parts.push(enter(textPart(id('attribution'), byline, 0, ys[2], { fontSize: byFit.fontSize, maxWidth: inner, fontWeight: 600, color: 'text2' }), span(3), { dy }));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a customer or press quote on a card, with who said it',
  params,
  describe: {
    quote: 'the words, up to 200 characters, without quotation marks (the card draws one)',
    attribution: 'who said it; a dash is added in front unless it starts with one',
  },
  example: { quote: 'We cut our release checklist from a day to ten minutes.', attribution: 'Priya Raman, platform lead' },
  // Centred across, and centred in the band between the safe area top and the caption zone, so a long quote's card fits
  // above captions.
  place: (size, format) => ({ x: size[0] / 2, y: (safeMargin(size) + captionZone(size, format).top) / 2 }),
  expand,
});
