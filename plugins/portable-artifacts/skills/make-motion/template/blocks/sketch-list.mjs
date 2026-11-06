// sketch-list: an optional heading with an accent underline, then 2 to 6 rows, each an icon (or a bullet) and a phrase, drawn top to
// bottom, all on one left edge.
import { abovePlace, blockGroup } from './layout.mjs';
import { fitLabel, fitted, labelPart, ovalPart, iconPart, underlinePart, sketchRoom, pickLayout } from './sketch-layout.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 40 },
    items: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', minLength: 1, maxLength: 40 }, icon: { type: 'string', minLength: 1, maxLength: 40 } } },
    },
  },
};

const WIDTH_CAP = 1720; // px at 1080
const ICON_GAP = 26; // between a row's icon and its text
const ROW_GAP_SHARE = 0.42; // of the text size, between rows
const UNDERLINE_DROP = 8; // between the heading's box and its underline
const TITLE_GAP = 34; // between the underline and the first row
const BULLET_SHARE = 0.36; // a bullet is this share of the icon's size
const ITEM_LINES = 2;
// Sizes, roomiest first, px at 1080: the phrases, the heading and the icons.
const TIERS = [
  { item: 88, title: 128, icon: 100 },
  { item: 72, title: 108, icon: 84 },
  { item: 64, title: 96, icon: 76 },
  { item: 56, title: 84, icon: 66 },
  { item: 48, title: 72, icon: 58 },
  { item: 44, title: 60, icon: 52 },
  { item: 40, title: 52, icon: 48 },
];

function measure(title, items, tier, room) {
  const { u } = room;
  const [fs, icon] = [Math.max(1, Math.round(tier.item * u)), Math.max(1, Math.round(tier.icon * u))];
  const iconCol = icon + ICON_GAP * u;
  const textMax = room.width - iconCol;
  const fits = items.map((item) => fitLabel(item.text, { sizes: [fs], maxWidth: textMax, maxLines: ITEM_LINES }));
  const heights = fits.map((fit) => Math.max(icon, fit.height));
  const rowGap = ROW_GAP_SHARE * fs;
  const titleFit = title === undefined ? null : fitLabel(title, { sizes: [Math.max(1, Math.round(tier.title * u))], maxWidth: room.width, maxLines: 1 });
  const titleBlock = titleFit ? titleFit.height + (UNDERLINE_DROP + TITLE_GAP) * u : 0;
  const width = Math.max(iconCol + Math.max(...fits.map((fit) => fit.width)), titleFit ? titleFit.width : 0);
  const height = titleBlock + heights.reduce((sum, h) => sum + h, 0) + (items.length - 1) * rowGap;
  const ok = items.every((item, i) => fitted(item.text, fits[i], textMax, ITEM_LINES)) && (!titleFit || fitted(title, titleFit, room.width, 1));
  return { u, icon, iconCol, fits, heights, rowGap, titleFit, titleBlock, width, height, overflow: Math.max(width / room.width, height / room.height) + (ok ? 0 : 1) };
}

function expand(el, ctx) {
  const { title, items } = el.params;
  const room = sketchRoom(ctx, el, WIDTH_CAP);
  const layout = pickLayout(TIERS.map((tier) => measure(title, items, tier, room)));
  const { u, icon, iconCol, fits, heights, rowGap, titleFit, titleBlock, width, height } = layout;
  const id = (part) => `${el.id}/${part}`;
  const left = -width / 2;
  const top = -height / 2;
  const parts = [];
  if (titleFit) {
    parts.push(labelPart(id('title'), title, titleFit, left, top + titleFit.height / 2, { anchor: 'left', align: 'left' }));
    parts.push(underlinePart(id('title-line'), left, left + titleFit.width + 12 * u, top + titleFit.height + UNDERLINE_DROP * u, u));
  }
  let y = top + titleBlock;
  items.forEach((item, i) => {
    const k = i + 1;
    const centre = y + heights[i] / 2;
    if (item.icon) parts.push(iconPart(id(`icon-${k}`), item.icon, left + icon / 2, centre, icon));
    else parts.push(ovalPart(id(`bullet-${k}`), left + icon / 2, centre, icon * BULLET_SHARE, icon * BULLET_SHARE, { stroke: 'accent' }));
    parts.push(labelPart(id(`item-${k}`), item.text, fits[i], left + iconCol, centre, { anchor: 'left', align: 'left' }));
    y += heights[i] + rowGap;
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a hand-drawn list: an optional heading, then 2 to 6 rows of an icon and a phrase; draws only in a hand-drawn scene',
  sketchOnly: true,
  params,
  describe: {
    title: 'a heading drawn first, with an accent underline (up to 40 characters); none by default',
    items: '2 to 6 rows in order: { text (up to 40 characters), icon? (a Lucide name; node scripts/sketch-icons.mjs search <word>; a row without one gets a bullet) }',
  },
  example: {
    title: 'Why draw by hand',
    items: [{ text: 'It holds attention', icon: 'eye' }, { text: 'Ideas build one at a time', icon: 'layers' }, { text: 'Anyone can follow it', icon: 'users' }],
  },
  // Centred across, and in the band between the safe area top and the caption zone, so a list fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    if (part === 'title') return 'title';
    const row = /^(item|icon)-(\d+)$/.exec(part);
    return row ? `items[${Number(row[2]) - 1}].${row[1] === 'item' ? 'text' : 'icon'}` : null;
  },
  expand,
});
