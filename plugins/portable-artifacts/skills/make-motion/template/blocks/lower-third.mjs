// lower-third: a name and an optional role on a card with an accent bar on its outer edge. Its `x`, `y` is the middle
// of that outer edge (the left edge for side left, the right edge for side right), so a longer name grows the card
// inward, away from the frame edge.
import { captionZone } from '../formats.mjs';
import { unit, contentWidth, textWidth, fitText, squeeze, slot, textPart, rectPart, enter, blockGroup, stack } from './layout.mjs';

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
const ABOVE_CAPTIONS = 110; // px at 1080 from the card's middle up from the caption zone's top, in place()

function expand(el, { size, sceneDuration }) {
  const u = unit(size);
  const { name, role, side = 'left' } = el.params;
  const id = (part) => `${el.id}/${part}`;
  const bar = 10 * u;
  const padX = 32 * u;
  const padY = 24 * u;
  const gap = 8 * u;
  const maxCard = contentWidth(size, Math.max(760 * u, 0.45 * size[0]), EDGE_INSET * u);
  const area = maxCard - bar - 2 * padX; // the widest the text may be
  const nameFit = fitText(name, { size: 46 * u, min: 32 * u, maxWidth: area, maxLines: 2 });
  const roleFit = role && fitText(role, { size: 30 * u, min: 24 * u, maxWidth: area, maxLines: 2 });
  const inner = Math.min(area, Math.max(240 * u, textWidth(name, nameFit.fontSize), role ? textWidth(role, roleFit.fontSize) : 0));
  const cardW = inner + bar + 2 * padX;
  const cardH = 2 * padY + nameFit.height + (role ? gap + roleFit.height : 0);
  const out = side === 'left' ? 1 : -1; // which way the card extends from the anchor
  const [nameY, roleY] = stack(role ? [nameFit.height, roleFit.height] : [nameFit.height], [gap]);
  const textX = out * (bar + padX + inner / 2);
  const parts = [
    rectPart(id('card'), out * (cardW / 2), 0, cardW, cardH, { fill: 'surface', radius: Math.round(8 * u), elevated: true }),
    rectPart(id('bar'), out * (bar / 2), 0, bar, cardH, { fill: 'accent' }),
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
    side: 'left (default) or right: which frame edge the card hangs from; x, y is the middle of that outer edge',
  },
  example: { name: 'Ada Lovelace', role: 'Head of Research', side: 'left' },
  // Its outer edge 40 px inside the safe area, its middle 110 px above the caption zone, so captions never cover it.
  place: (size, format, side = 'left') => {
    const u = unit(size);
    const zone = captionZone(size, format);
    const inset = zone.left + EDGE_INSET * u;
    return { x: side === 'right' ? size[0] - inset : inset, y: zone.top - ABOVE_CAPTIONS * u };
  },
  expand,
});
