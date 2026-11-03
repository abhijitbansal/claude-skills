// testimonial: a customer quote on a card, with who said it: an optional avatar (an image next to the spec), a name and
// a role. The avatar is a square image (fit cover) in an accent frame.
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack, freeBand, roomAt, abovePlace, MIN_TEXT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['quote', 'name'],
  properties: {
    quote: { type: 'string', minLength: 1, maxLength: 240 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    role: { type: 'string', minLength: 1, maxLength: 80 },
    avatar: { type: 'string', minLength: 1, maxLength: 80 },
  },
};

// Quote size, avatar size and card padding (px at 1080), roomiest first: the card takes the first that fits its room (the
// band above the caption zone when the spec has captions), else the last.
const TIERS = [{ quote: 52, avatar: 120, pad: 56 }, { quote: 48, avatar: 104, pad: 44 }, { quote: MIN_TEXT, avatar: 88, pad: 32 }, { quote: MIN_TEXT, avatar: 72, pad: 24 }];
const FRAME = 6; // px at 1080: the avatar's accent frame

function layout(el, u, cardW, tier) {
  const { quote, name, role, avatar } = el.params;
  const pad = tier.pad * u;
  const inner = cardW - 2 * pad;
  const av = avatar ? tier.avatar * u : 0;
  const gapAv = avatar ? 24 * u : 0;
  const textW = inner - av - gapAv;
  const quoteFit = fitText(quote, { size: tier.quote * u, min: MIN_TEXT * u, maxWidth: inner, maxLines: 6 });
  const nameFit = fitText(name, { size: 48 * u, min: MIN_TEXT * u, maxWidth: textW, maxLines: 2 });
  const roleFit = role && fitText(role, { size: MIN_TEXT * u, min: MIN_TEXT * u, maxWidth: textW, maxLines: 2 });
  const whoH = nameFit.height + (roleFit ? roleFit.height : 0);
  const rowH = Math.max(av, whoH);
  const textInner = Math.min(textW, Math.max(textWidth(name, nameFit.fontSize), role ? textWidth(role, roleFit.fontSize) : 0));
  const heights = [6 * u, quoteFit.height, rowH];
  const gaps = [28 * u, 36 * u];
  const content = heights.reduce((a, h) => a + h, 0) + gaps.reduce((a, g) => a + g, 0);
  return { inner, av, gapAv, quoteFit, nameFit, roleFit, whoH, rowH, textInner, heights, gaps, cardH: content + 2 * pad };
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const { quote, name, role, avatar } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const cardW = contentWidth(size, 1400 * u, 40 * u, ctx.insets);
  const room = roomAt(freeBand(ctx), el.y);
  let fit;
  for (const tier of TIERS) {
    fit = layout(el, u, cardW, tier);
    if (fit.cardH <= room) break;
  }
  const { inner, av, gapAv, quoteFit, nameFit, roleFit, whoH, textInner, heights, gaps, cardH } = fit;
  const ys = stack(heights, gaps);
  // The row of avatar and name/role is centred across the card.
  const rowW = av + gapAv + textInner;
  const rowLeft = -rowW / 2;
  const textX = rowLeft + av + gapAv + textInner / 2;
  const nameY = ys[2] - whoH / 2 + nameFit.height / 2;
  const at = squeeze(sceneDuration, slot(avatar ? 4 : 3)[1]);
  const span = (i) => slot(i).map(at);
  const dy = 24 * u;
  const frame = Math.max(1, Math.round(FRAME * u));
  const parts = [
    enter(rectPart(id('card'), 0, 0, cardW, cardH, { fill: 'surface', radius: Math.round(28 * u), elevated: true }), span(0), { scale: 0.96 }),
    enter(rectPart(id('rule'), 0, ys[0], 96 * u, 6 * u, { fill: 'accent', radius: Math.round(3 * u) }), span(1), { scale: 0.8 }),
    enter(textPart(id('quote'), quote, 0, ys[1], { fontSize: quoteFit.fontSize, maxWidth: inner, fontWeight: 500, color: 'text' }), span(2), { dy }),
  ];
  if (avatar) {
    parts.push(enter(rectPart(id('frame'), rowLeft + av / 2, ys[2], av + frame, av + frame, { fill: 'surface', stroke: 'accent', strokeWidth: frame }), span(3), { dy }));
    parts.push(enter({ id: id('avatar'), type: 'image', src: avatar, x: Math.round(rowLeft + av / 2), y: Math.round(ys[2]), width: Math.round(av), height: Math.round(av), fit: 'cover' }, span(3), { dy }));
  }
  const lastIn = span(avatar ? 4 : 3);
  parts.push(enter(textPart(id('name'), name, textX, nameY, { fontSize: nameFit.fontSize, maxWidth: textInner, fontWeight: 700, color: 'text' }), lastIn, { dy }));
  if (roleFit) parts.push(enter(textPart(id('role'), role, textX, ys[2] + whoH / 2 - roleFit.height / 2, { fontSize: roleFit.fontSize, maxWidth: textInner, fontWeight: 500, color: 'text2' }), lastIn, { dy }));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a customer testimonial on a card: the quote, then a picture, name and role of who said it',
  params,
  describe: {
    quote: 'the words, up to 240 characters, without quotation marks',
    name: 'who said it, in bold',
    role: 'their role or company, in a quieter line under the name',
    avatar: 'a picture of them: an image file next to the spec (PNG, JPG or SVG), shown square and cropped to fill; it must exist and stay inside the spec folder',
  },
  example: { quote: 'We cut our release checklist from a day to ten minutes.', name: 'Priya Raman', role: 'Platform lead, Northwind', avatar: 'avatar.svg' },
  // Centred across, and in the band between the safe area top and the caption zone, so a long quote's card fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  assets: ['avatar'],
  expand,
});
