// sketch-callout: one phrase with an optional icon beside it, then an accent underline or a circle drawn round it, in that order.
import { abovePlace, blockGroup } from './layout.mjs';
import { fitLabel, fitted, labelPart, ovalPart, iconPart, underlinePart, sketchRoom, pickLayout, UNDERLINE } from './sketch-layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['text'],
  properties: {
    text: { type: 'string', minLength: 1, maxLength: 40 },
    icon: { type: 'string', minLength: 1, maxLength: 40 },
    mark: { enum: ['underline', 'circle'], default: 'underline' },
  },
};

const WIDTH_CAP = 1720; // px at 1080
const SIZES = [110, 96, 84, 72, 60, 52, 44, 40]; // px at 1080, roomiest first (the spike's phrase is 84)
const ICON_SHARE = 1.1; // the icon is this many times the text size
const ICON_GAP = 30; // between the icon and the phrase
const UNDERLINE_DROP = 6; // between the phrase's box and its underline
const UNDERLINE_REACH = 10; // the underline runs this far past each end of the phrase
const RING_WIDTH = 7; // the stroke of the circle
const RING_PAD = { x: 24, y: 14 }; // between the phrase and the rectangle the circle goes through the corners of
const OVAL = 1.5; // an oval that passes through the corners of a rectangle is this many times as wide and tall (1.41), with some air
const LINES = 2;

function measure(data, size, room) {
  const { u } = room;
  const circle = data.mark === 'circle';
  const fs = Math.max(1, Math.round(size * u));
  const icon = data.icon ? Math.max(1, Math.round(fs * ICON_SHARE)) : 0;
  const iconCol = icon ? icon + ICON_GAP * u : 0;
  const maxWidth = circle ? room.width / OVAL - 2 * RING_PAD.x * u - iconCol : room.width - iconCol - 2 * UNDERLINE_REACH * u;
  const fit = fitLabel(data.text, { sizes: [fs], maxWidth, maxLines: LINES });
  const [rowW, rowH] = [iconCol + fit.width, Math.max(icon, fit.height)];
  const stroke = Math.max(1, Math.round((circle ? RING_WIDTH : UNDERLINE.width) * u));
  const [width, height] = circle ? [(rowW + 2 * RING_PAD.x * u) * OVAL, (rowH + 2 * RING_PAD.y * u) * OVAL] : [Math.max(rowW, fit.width + 2 * UNDERLINE_REACH * u), rowH + UNDERLINE_DROP * u + stroke];
  return { u, circle, icon, iconCol, fit, rowW, rowH, stroke, width, height, overflow: Math.max(width / room.width, height / room.height) + (fitted(data.text, fit, maxWidth, LINES) ? 0 : 1) };
}

function expand(el, ctx) {
  const room = sketchRoom(ctx, el, WIDTH_CAP);
  const data = { ...el.params, mark: el.params.mark ?? 'underline' };
  const layout = pickLayout(SIZES.map((size) => measure(data, size, room)));
  const { u, circle, icon, iconCol, fit, rowW, rowH, width, height } = layout;
  const id = (part) => `${el.id}/${part}`;
  const left = -rowW / 2;
  const rowY = circle ? 0 : -height / 2 + rowH / 2; // the ring is centred on the phrase; an underline takes room below it
  const parts = [];
  if (data.icon) parts.push(iconPart(id('icon'), data.icon, left + icon / 2, rowY, icon));
  parts.push(labelPart(id('text'), data.text, fit, left + iconCol + fit.width / 2, rowY));
  if (circle) parts.push(ovalPart(id('mark'), 0, 0, width, height, { stroke: 'accent', strokeWidth: layout.stroke }));
  else {
    const textLeft = left + iconCol; // the underline runs under the phrase, not under the icon beside it
    parts.push(underlinePart(id('mark'), textLeft - UNDERLINE_REACH * u, textLeft + fit.width + UNDERLINE_REACH * u, rowY + fit.height / 2 + UNDERLINE_DROP * u, u));
  }
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a hand-drawn call-out: one phrase with an optional icon, then an accent underline or a circle round it; draws only in a hand-drawn scene',
  sketchOnly: true,
  params,
  describe: {
    text: 'the phrase, up to 40 characters',
    icon: 'a Lucide icon drawn before the phrase (node scripts/sketch-icons.mjs search <word>); none by default',
    mark: 'underline or circle, drawn after the phrase',
  },
  example: { text: 'Only the API talks to the database', icon: 'lock', mark: 'underline' },
  // Centred across, and in the band between the safe area top and the caption zone, so a call-out sits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  expand,
});
