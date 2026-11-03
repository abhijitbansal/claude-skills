// lower-third-tag: a name on a card with an accent bar, and a tag chip (LIVE, GUEST, SPONSOR…) sitting on the card's top
// edge. Its `x`, `y` is the bottom-left corner of the card's outer edge, as lower-third's: the card grows up and right
// from there, the chip above it, so the bottom edge stays at `y`. place() is lower-third's: CAPTION_GAP above the caption zone.
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, MIN_TEXT } from './layout.mjs';
import lowerThird from './lower-third.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'tag'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    tag: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

const EDGE_INSET = 40; // px at 1080 from the safe area to the card's outer edge

function expand(el, { size, sceneDuration, insets }) {
  const u = unit(size);
  const { name, tag } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const bar = 10 * u;
  const padX = 32 * u;
  const padY = 24 * u;
  const chipPadX = 20 * u;
  const chipPadY = 10 * u;
  const maxCard = contentWidth(size, Math.max(900 * u, 0.55 * size[0]), EDGE_INSET * u, insets);
  const area = maxCard - bar - 2 * padX;
  const nameFit = fitText(name, { size: 56 * u, min: 44 * u, maxWidth: area, maxLines: 2 });
  const tagFit = fitText(tag, { size: MIN_TEXT * u, min: MIN_TEXT * u, maxWidth: area - 2 * chipPadX, maxLines: 2 });
  const tagInner = Math.min(area - 2 * chipPadX, textWidth(tag, tagFit.fontSize));
  const inner = Math.min(area, Math.max(280 * u, textWidth(name, nameFit.fontSize), tagInner + 2 * chipPadX));
  const cardW = inner + bar + 2 * padX;
  const cardH = 2 * padY + nameFit.height;
  const chipW = Math.min(cardW, tagInner + 2 * chipPadX);
  const chipH = tagFit.height + 2 * chipPadY;
  const textX = bar + padX + inner / 2;
  const parts = [
    rectPart(id('card'), cardW / 2, -cardH / 2, cardW, cardH, { fill: 'surface', radius: Math.round(8 * u), elevated: true }),
    rectPart(id('bar'), bar / 2, -cardH / 2, bar, cardH, { fill: 'accent' }),
    rectPart(id('chip'), chipW / 2, -cardH - chipH / 2, chipW, chipH, { fill: 'accent', radius: Math.round(8 * u) }),
    textPart(id('tag'), tag, chipW / 2, -cardH - chipH / 2, { fontSize: tagFit.fontSize, maxWidth: chipW - 2 * chipPadX, fontWeight: 700, color: 'surface' }),
    textPart(id('name'), name, textX, -cardH + padY + nameFit.height / 2, { fontSize: nameFit.fontSize, maxWidth: inner, fontWeight: 700, color: 'text' }),
  ];
  // The card and its bar slide in from the frame edge, then the chip with its tag, then the name.
  const order = [0, 0, 1, 1, 2];
  const at = squeeze(sceneDuration, slot(2)[1]);
  return blockGroup(el, parts.map((part, i) => enter(part, slot(order[i]).map(at), { dx: -40 * u })));
}

export default Object.freeze({
  summary: 'a name on a card near the bottom-left corner with a coloured tag chip on top, such as LIVE, GUEST or SPONSOR',
  params,
  describe: {
    name: 'the main line, in bold',
    tag: 'the chip on the card\'s top edge: one or two words read best (LIVE, GUEST, NEW)',
  },
  example: { name: 'Ada Lovelace', tag: 'GUEST SPEAKER' },
  // x, y is the card's bottom-left corner: where lower-third puts it, 24 px above the caption zone, so captions never cover it.
  place: (size, format, _side, insets = null) => lowerThird.place(size, format, 'left', insets),
  expand,
});
