// lower-third: a name and an optional role on a card with an accent bar on its outer edge. Its `x`, `y` is the bottom
// corner of that outer edge (bottom-left for side left, bottom-right for side right): the card grows up and inward
// from there, so however long the name and role, its bottom edge stays at `y`. place() puts `y` CAPTION_GAP above the
// caption zone, so at its place the card never reaches the zone, whatever the text.
import { captionZone } from '../formats.mjs';
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, MIN_TEXT } from './layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    role: { type: 'string', minLength: 1, maxLength: 80 },
    side: { enum: ['left', 'right'], default: 'left' },
  },
};

const EDGE_INSET = 40; // px at 1080 from the safe area to the card's outer edge, in place()
const CAPTION_GAP = 24; // px at 1080 between the card's bottom (y) and the caption zone's top, in place()

function expand(el, { size, sceneDuration, insets }) {
  const u = unit(size);
  const { name, role, side = 'left' } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const bar = 10 * u;
  const padX = 32 * u;
  const padY = 24 * u;
  const gap = 8 * u;
  const maxCard = contentWidth(size, Math.max(900 * u, 0.55 * size[0]), EDGE_INSET * u, insets);
  const area = maxCard - bar - 2 * padX; // the widest the text may be
  const nameFit = fitText(name, { size: 56 * u, min: 44 * u, maxWidth: area, maxLines: 2 });
  const roleFit = role && fitText(role, { size: MIN_TEXT * u, min: MIN_TEXT * u, maxWidth: area, maxLines: 2 });
  const inner = Math.min(area, Math.max(320 * u, textWidth(name, nameFit.fontSize), role ? textWidth(role, roleFit.fontSize) : 0));
  const cardW = inner + bar + 2 * padX;
  const cardH = 2 * padY + nameFit.height + (role ? gap + roleFit.height : 0);
  const out = side === 'left' ? 1 : -1; // which way the card extends from the anchor
  const nameY = -cardH + padY + nameFit.height / 2;
  const roleY = role ? -cardH + padY + nameFit.height + gap + roleFit.height / 2 : 0;
  const textX = out * (bar + padX + inner / 2);
  const parts = [
    rectPart(id('card'), out * (cardW / 2), -cardH / 2, cardW, cardH, { fill: 'surface', radius: Math.round(8 * u), elevated: true }),
    rectPart(id('bar'), out * (bar / 2), -cardH / 2, bar, cardH, { fill: 'accent' }),
    textPart(id('name'), name, textX, nameY, { fontSize: nameFit.fontSize, maxWidth: inner, fontWeight: 700, color: 'text' }),
    role && textPart(id('role'), role, textX, roleY, { fontSize: roleFit.fontSize, maxWidth: inner, fontWeight: 500, color: 'text2' }),
  ].filter(Boolean);
  // The card and its bar slide in from the frame edge together; then the name, then the role.
  const order = [0, 0, 1, 2];
  const at = squeeze(sceneDuration, slot(order[parts.length - 1])[1]);
  return blockGroup(el, parts.map((part, i) => enter(part, slot(order[i]).map(at), { dx: -out * 40 * u })));
}

export default Object.freeze({
  summary: 'a name and role on a card near the bottom corner, for introducing a speaker or a product',
  params,
  describe: {
    name: 'the main line, in bold',
    role: 'a second, quieter line under the name',
    side: 'left (default) or right: which frame edge the card hangs from. x, y is the bottom corner of that outer edge: for left, x is the left edge; for right, x is the right edge. The card grows up and inward from there',
  },
  example: { name: 'Ada Lovelace', role: 'Head of Research', side: 'left' },
  // Its outer edge 40 px inside the safe area, its bottom 24 px above the caption zone, so captions never cover it.
  // `insets`: a viral spec's, which narrow the zone to the platform safe zone and lift it.
  place: (size, format, side = 'left', insets = null) => {
    const u = unit(size);
    const zone = captionZone(size, format, insets);
    return { x: side === 'right' ? zone.right - EDGE_INSET * u : zone.left + EDGE_INSET * u, y: zone.top - CAPTION_GAP * u };
  },
  expand,
});
