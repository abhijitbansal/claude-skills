// quote-card: a pull quote on a card: an accent quotation mark, the quote, and an optional attribution.
import { unit, contentWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack, LINE_HEIGHT } from './layout.mjs';

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

function expand(el, { size, sceneDuration }) {
  const u = unit(size);
  const { quote, attribution } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const cardW = contentWidth(size, 1400 * u, 40 * u);
  const pad = 64 * u;
  const inner = cardW - 2 * pad;
  const markSize = Math.max(1, Math.round(120 * u));
  const markH = markSize * LINE_HEIGHT.title;
  const quoteFit = fitText(quote, { size: 52 * u, min: 30 * u, maxWidth: inner, maxLines: 5 });
  const byline = attribution && (DASHED.test(attribution) ? attribution : `— ${attribution}`);
  const byFit = byline && fitText(byline, { size: 32 * u, min: 24 * u, maxWidth: inner, maxLines: 2 });
  const heights = [markH, quoteFit.height, ...(byFit ? [byFit.height] : [])];
  const gaps = [8 * u, 32 * u];
  const ys = stack(heights, gaps);
  const content = heights.reduce((a, h) => a + h, 0) + gaps.slice(0, heights.length - 1).reduce((a, g) => a + g, 0);
  const at = squeeze(sceneDuration, slot(byFit ? 3 : 2)[1]);
  const span = (i) => slot(i).map(at);
  const dy = 24 * u;
  const parts = [
    enter(rectPart(id('card'), 0, 0, cardW, content + 2 * pad, { fill: 'surface', radius: Math.round(28 * u), elevated: true }), span(0), { scale: 0.96 }),
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
  place: (size) => ({ x: size[0] / 2, y: size[1] / 2 }),
  expand,
});
