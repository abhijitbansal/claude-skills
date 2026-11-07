// sketch-compare: two titled columns (before and after, option A and option B), each a heading with an accent underline over 1 to 5
// bulleted points, divided by a hand-drawn line: side by side on a wide or square canvas, stacked on a tall one. The left column
// is drawn first, then the divider, then the right column.
import { abovePlace, blockGroup } from './layout.mjs';
import { fitLabel, fitted, labelPart, ovalPart, linePart, underlinePart, sketchRoom, pickLayout } from './sketch-layout.mjs';

const side = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'points'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 24 },
    points: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 28 } },
  },
};
const params = { type: 'object', additionalProperties: false, required: ['left', 'right'], properties: { left: side, right: side } };

const WIDTH_CAP = 1720; // px at 1080
const STACK_WIDTH = 900; // px at 1080: a stacked column is this wide at most
const DIVIDER = 76; // px at 1080 between the columns (a line in the middle of it)
const BULLET_COL = 46; // a point's bullet and the room it takes
const BULLET = 20; // px at 1080: the bullet's width
const POINT_GAP_SHARE = 0.3; // of the text size, between points
const UNDERLINE_DROP = 8;
const TITLE_GAP = 30; // between a title's underline and the first point
const POINT_LINES = 2;
// Sizes, roomiest first, px at 1080: the points and the titles.
const TIERS = [
  { point: 72, title: 104 },
  { point: 60, title: 88 },
  { point: 52, title: 76 },
  { point: 46, title: 66 },
  { point: 42, title: 58 },
  { point: 40, title: 52 },
];

// One column `width` wide: its fitted title and points, its height and the width its points take.
function panel(data, tier, width, u) {
  const [fs, titleFs] = [Math.max(1, Math.round(tier.point * u)), Math.max(1, Math.round(tier.title * u))];
  const pointMax = width - BULLET_COL * u;
  const title = fitLabel(data.title, { sizes: [titleFs], maxWidth: width, maxLines: 1 });
  const points = data.points.map((text) => fitLabel(text, { sizes: [fs], maxWidth: pointMax, maxLines: POINT_LINES }));
  const gap = POINT_GAP_SHARE * fs;
  const titleBlock = title.height + (UNDERLINE_DROP + TITLE_GAP) * u;
  const height = titleBlock + points.reduce((sum, fit) => sum + fit.height, 0) + (points.length - 1) * gap;
  const ok = fitted(data.title, title, width, 1) && data.points.every((text, i) => fitted(text, points[i], pointMax, POINT_LINES));
  return { data, title, points, gap, titleBlock, height, ok, pointsWidth: BULLET_COL * u + Math.max(...points.map((fit) => fit.width)) };
}

function measure(params_, tier, room, stacked) {
  const { u } = room;
  const gap = DIVIDER * u;
  const width = stacked ? Math.min(room.width, STACK_WIDTH * u) : (room.width - gap) / 2;
  const [left, right] = [panel(params_.left, tier, width, u), panel(params_.right, tier, width, u)];
  const [totalW, totalH] = stacked ? [width, left.height + right.height + gap] : [2 * width + gap, Math.max(left.height, right.height)];
  // Stacked, both columns' points start at one left edge, centred as a pair.
  const pointsWidth = Math.max(left.pointsWidth, right.pointsWidth);
  return { u, stacked, width, gap, left, right, pointsWidth, totalW, totalH, overflow: Math.max(totalW / room.width, totalH / room.height) + (left.ok && right.ok ? 0 : 1) };
}

// A column's parts, centred across on cx and starting at `top`: its title, the title's underline, then each point's bullet and text.
function panelParts(name, column, [cx, top], layout, id) {
  const { u, stacked } = layout;
  const { title, points, titleBlock, gap } = column;
  const pointsWidth = stacked ? layout.pointsWidth : column.pointsWidth;
  const parts = [labelPart(id(`${name}-title`), column.data.title, title, cx, top + title.height / 2)];
  const half = title.width / 2 + 10 * u;
  parts.push(underlinePart(id(`${name}-line`), cx - half, cx + half, top + title.height + UNDERLINE_DROP * u, u));
  const pointsLeft = cx - pointsWidth / 2;
  let y = top + titleBlock;
  points.forEach((fit, i) => {
    const centre = y + fit.height / 2;
    parts.push(ovalPart(id(`${name}-bullet-${i + 1}`), pointsLeft + (BULLET_COL * u) / 4, centre, BULLET * u, BULLET * u, { stroke: 'accent' }));
    parts.push(labelPart(id(`${name}-${i + 1}`), column.data.points[i], fit, pointsLeft + BULLET_COL * u, centre, { anchor: 'left', align: 'left' }));
    y += fit.height + gap;
  });
  return parts;
}

function expand(el, ctx) {
  const room = sketchRoom(ctx, el, WIDTH_CAP);
  const stacked = ctx.size[0] < ctx.size[1];
  const layout = pickLayout(TIERS.map((tier) => measure(el.params, tier, room, stacked)));
  const { width, gap, left, right, totalW, totalH } = layout;
  const id = (part) => `${el.id}/${part}`;
  const top = -totalH / 2;
  const [leftAt, rightAt] = stacked ? [[0, top], [0, top + left.height + gap]] : [[-(width + gap) / 2, top], [(width + gap) / 2, top]];
  const divider = stacked
    ? linePart(id('divider'), [-0.4 * totalW, top + left.height + gap / 2], [0.4 * totalW, top + left.height + gap / 2])
    : linePart(id('divider'), [0, top], [0, top + totalH]);
  return blockGroup(el, [...panelParts('left', left, leftAt, layout, id), divider, ...panelParts('right', right, rightAt, layout, id)]);
}

export default Object.freeze({
  summary: 'a hand-drawn comparison: two titled columns of 1 to 5 points each, divided by a line; draws only in a hand-drawn scene',
  sketchOnly: true,
  params,
  describe: {
    left: 'the first column: { title (up to 24 characters), points (1 to 5, each up to 28 characters) }; drawn first',
    right: 'the second column, as left. Side by side on a wide or square canvas, below the first on a tall one',
  },
  example: {
    left: { title: 'On a slide', points: ['Shown all at once', 'The eye wanders', 'Easy to skim'] },
    right: { title: 'Drawn by hand', points: ['Built a step at a time', 'The eye follows the pencil', 'Hard to forget'] },
  },
  // Centred across, and in the band between the safe area top and the caption zone, so a comparison fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    const text = /^(left|right)-(\d+)$/.exec(part);
    if (text) return `${text[1]}.points[${Number(text[2]) - 1}]`;
    const title = /^(left|right)-title$/.exec(part);
    return title ? `${title[1]}.title` : null;
  },
  expand,
});
