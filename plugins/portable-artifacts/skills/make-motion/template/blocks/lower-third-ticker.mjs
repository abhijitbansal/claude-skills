// lower-third-ticker: a full-width band near the bottom with 2 to 8 items crawling right to left at `speed` px/s (x
// keyframes, linear), a dot between items. The band spans the frame edge to edge, whatever the block's `x`. The items
// fade out as the crawl ends, at 85 % of the scene, and the empty band stays: a crawl cannot rest inside the safe area
// (check.mjs judges a text that is held, not one that moves), so it leaves instead. `y` is the band's bottom edge;
// place() puts it CAPTION_GAP above the caption zone, so captions never cover it.
// Each item is its own text, positioned from its estimated width (layout.mjs), so the gaps are even enough and no word
// ever wraps.
import { safeMargin } from '../formats.mjs';
import { unit, textWidth, squeeze, slot, textPart, rectPart, ellipsePart, enter, blockGroup, LAST_MOTION_SHARE } from './layout.mjs';
import lowerThird from './lower-third.mjs';

const params = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: { type: 'array', minItems: 2, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 40 } },
    speed: { type: 'number', minimum: 10, maximum: 400, default: 80 },
  },
};

const BAND_H = 96; // px at 1080
const RULE_H = 6; // the accent rule along the band's top edge
const TEXT_SIZE = 44;
const ITEM_GAP = 120; // px at 1080 between one item's estimated box and the next; the dot sits in the middle
const DOT = 14;
const FADE_SECONDS = 0.4;
const MIN_NOMINAL_END = 1.6; // seconds: room for the entrances (last one ends at 0.8 s) before the fade starts

function expand(el, { size, sceneDuration, insets }) {
  const u = unit(size);
  const { items } = el.params;
  const speed = el.params.speed ?? params.properties.speed.default;
  const id = (part) => `${el.id}/${part}`;
  const fs = Math.max(1, Math.round(TEXT_SIZE * u));
  const bandH = Math.round(BAND_H * u);
  const ruleH = Math.max(1, Math.round(RULE_H * u));
  const gap = ITEM_GAP * u;
  const centre = size[0] / 2 - el.x; // the frame's middle, in the group's coordinates
  const textY = -bandH / 2 + ruleH / 2;
  // Item k's box starts at the safe area's left edge plus the boxes before it.
  let cursor = (insets?.left ?? safeMargin(size)) - el.x;
  const boxes = items.map((item) => {
    const w = textWidth(item, fs);
    const box = { x: cursor + w / 2, w };
    cursor += w + gap;
    return box;
  });
  // The crawl runs the whole scene up to 85 % of it; the fade is its last FADE_SECONDS.
  const nominalEnd = Math.max(MIN_NOMINAL_END, LAST_MOTION_SHARE * sceneDuration);
  const at = squeeze(sceneDuration, nominalEnd);
  const end = at(nominalEnd);
  const fadeFrom = at(nominalEnd - FADE_SECONDS);
  // A part crawls `speed` px for every second between its first keyframe and the end.
  const crawl = (part, [start, entered]) => ({
    ...part,
    keyframes: [
      { t: start, opacity: 0, x: part.x },
      { t: entered, opacity: 1, ease: 'enter' },
      { t: fadeFrom, opacity: 1 },
      { t: end, opacity: 0, x: Math.round(part.x - speed * (end - start)) },
    ],
  });
  // The band and its rule stay (a scene may not end with nothing on screen); the items leave.
  const parts = [
    enter(rectPart(id('band'), centre, -bandH / 2, size[0], bandH, { fill: 'surface', elevated: true }), slot(0).map(at)),
    enter(rectPart(id('rule'), centre, -bandH + ruleH / 2, size[0], ruleH, { fill: 'accent' }), slot(0).map(at)),
  ];
  items.forEach((item, i) => {
    const k = i + 1;
    const span = slot(1).map(at);
    parts.push(crawl(textPart(id(`item-${k}`), item, boxes[i].x, textY, { fontSize: fs, maxWidth: Math.ceil(boxes[i].w) + 1, fontWeight: 600, color: 'text' }), span));
    if (i < items.length - 1) parts.push(crawl(ellipsePart(id(`sep-${k}`), boxes[i].x + boxes[i].w / 2 + gap / 2, textY, Math.max(1, Math.round(DOT * u)), { fill: 'accent' }), span));
  });
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a full-width ticker band near the bottom, headlines crawling right to left at a steady speed, for news or announcements',
  params,
  describe: {
    items: '2 to 8 short lines, each up to 40 characters, crawling in the order written with a dot between them',
    speed: 'how fast they crawl in px per second, 10 to 400 (default 80); it runs until 85 % of the scene, where the items fade out and the empty band stays, so a longer scene shows more of the items',
  },
  example: { items: ['Release 2.4 is out', 'Captions now render offline', 'Blocks reach 27'] },
  // The band spans the frame whatever x is (x is the frame's middle here); y is its bottom edge, 24 px above the caption zone.
  place: (size, format, _side, insets = null) => ({ x: size[0] / 2, y: lowerThird.place(size, format, 'left', insets).y }),
  paramOf: (part) => (/^item-(\d+)$/.test(part) ? `items[${Number(part.split('-')[1]) - 1}]` : null),
  expand,
});
