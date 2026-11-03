// comparison-split: two cards side by side (stacked on a tall canvas), each a title over 1 to 5 points, with a "vs" badge
// between them. The right card is the one painted in the accent colour.
import { unit, contentWidth, fitText, fitHeight, sizeLadder, lineCount, squeeze, slot, textPart, rectPart, ellipsePart, linePart, enter, blockGroup, stack, freeBand, roomAt, LINE_HEIGHT, MIN_TEXT, abovePlace } from './layout.mjs';

const side = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'points'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 24 },
    points: { type: 'array', minItems: 1, maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 28 } },
  },
};
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['left', 'right'],
  properties: {
    left: side,
    right: side,
    headline: { type: 'string', minLength: 1, maxLength: 40 },
  },
};

const HEADLINE_SIZES = [64, 56, 48, MIN_TEXT]; // px at 1080, largest first
const POINT_SIZES = [48, 44, MIN_TEXT];
const TITLE_SIZES = [56, 52, MIN_TEXT];
// Card spacing, roomiest first: padding, gap between points, gap under the title (px at 1080).
const TIERS = [{ pad: 40, gap: 20, rule: 36 }, { pad: 28, gap: 14, rule: 26 }, { pad: 20, gap: 10, rule: 20 }, { pad: 14, gap: 4, rule: 14 }];
const BADGE = 80; // px at 1080: the "vs" circle's diameter
const CARDS_GAP = 40; // px at 1080 between the cards, and between the headline and the cards
const PARAM_OF = { headline: 'headline' };

// The layout of both cards at one font size and tier: shared heights, so the two cards match.
function layoutAt(p, { u, innerW, fontSize, titleSize, tier }) {
  const fs = Math.min(...[p.left, p.right].flatMap((s) => s.points).map((pt) => fitHeight(pt, { sizes: sizeLadder([fontSize, MIN_TEXT], u), maxWidth: innerW, maxHeight: Infinity }).fontSize));
  const titles = [p.left, p.right].map((s) => fitText(s.title, { size: titleSize * u, min: MIN_TEXT * u, maxWidth: innerW, maxLines: 2, lineHeight: LINE_HEIGHT.title }));
  const titleH = Math.max(...titles.map((t) => t.height));
  const titleFs = Math.min(...titles.map((t) => t.fontSize));
  const pointHs = [p.left, p.right].map((s) => s.points.map((pt) => lineCount(pt, fs, innerW) * fs * LINE_HEIGHT.sans));
  const pointsH = Math.max(...pointHs.map((hs) => hs.reduce((a, h) => a + h, 0) + (hs.length - 1) * tier.gap * u));
  const cardH = 2 * tier.pad * u + titleH + tier.rule * u + pointsH;
  return { fs, titleFs, titleH, pointHs, cardH };
}

function expand(el, ctx) {
  const { size, sceneDuration } = ctx;
  const u = unit(size);
  const p = el.params;
  const id = (part) => `${el.id}/${part}`;
  const room = roomAt(freeBand(ctx), el.y);
  const headFit = p.headline && fitHeight(p.headline, { sizes: sizeLadder(HEADLINE_SIZES, u), maxWidth: contentWidth(size, 1700 * u, 0, ctx.insets), maxHeight: room / 5, lineHeight: LINE_HEIGHT.title });
  const headH = headFit ? headFit.height + CARDS_GAP * u : 0;
  // The arrangement, side by side or stacked, with the largest sizes and roomiest spacing whose whole block fits `room`.
  const arrange = (side) => {
    const cardW = side ? (contentWidth(size, 1700 * u, 0, ctx.insets) - CARDS_GAP * u) / 2 : contentWidth(size, 1000 * u, 0, ctx.insets);
    let found;
    for (const [i, base] of POINT_SIZES.entries()) {
      for (const tier of TIERS) {
        const innerW = cardW - 2 * tier.pad * u;
        const fit = layoutAt(p, { u, innerW, fontSize: base, titleSize: TITLE_SIZES[i], tier });
        found = { row: side, cardW, fit, tier, innerW, total: headH + (side ? fit.cardH : 2 * fit.cardH + CARDS_GAP * u) };
        if (found.total <= room) return found;
      }
    }
    return found;
  };
  // Side by side on a wide canvas and stacked on a tall one; the other way round when only that fits.
  const wanted = size[0] >= size[1];
  const [first, second] = [arrange(wanted), arrange(!wanted)];
  const { row, cardW, fit, tier, innerW } = first.total <= room || first.total <= second.total ? first : second;
  const { cardH } = fit;
  const heights = [...(headFit ? [headFit.height] : []), ...(row ? [cardH] : [cardH, cardH])];
  const ys = stack(heights, [CARDS_GAP * u, CARDS_GAP * u]);
  const cardYs = ys.slice(headFit ? 1 : 0);
  const centres = row ? [[-(cardW + CARDS_GAP * u) / 2, cardYs[0]], [(cardW + CARDS_GAP * u) / 2, cardYs[0]]] : [[0, cardYs[0]], [0, cardYs[1]]];
  const slots = headFit ? [1, 2] : [0, 1];
  const at = squeeze(sceneDuration, slot(slots[1])[1]);
  const span = (k) => slot(k).map(at);
  const parts = [];
  if (headFit) parts.push(enter(textPart(id('headline'), p.headline, 0, ys[0], { fontSize: headFit.fontSize, maxWidth: contentWidth(size, 1700 * u, 0, ctx.insets), fontWeight: 700, role: 'title', color: 'text' }), span(0), { dy: 24 * u }));
  [['left', p.left], ['right', p.right]].forEach(([name, s], i) => {
    const [cx, cy] = centres[i];
    const accent = i === 1;
    const top = cy - cardH / 2 + tier.pad * u;
    const children = [
      rectPart(id(`${name}-card`), cx, cy, cardW, cardH, { fill: 'surface', stroke: accent ? 'accent' : 'line', strokeWidth: Math.max(1, Math.round((accent ? 4 : 2) * u)), radius: Math.round(28 * u), elevated: true }),
      textPart(id(`${name}-title`), s.title, cx, top + fit.titleH / 2, { fontSize: fit.titleFs, maxWidth: innerW, fontWeight: 800, color: accent ? 'accent' : 'text2' }),
      linePart(id(`${name}-rule`), cx, top + fit.titleH + (tier.rule * u) / 2, innerW * 0.5, { stroke: 'line', strokeWidth: Math.max(1, Math.round(3 * u)) }),
    ];
    let y = top + fit.titleH + tier.rule * u;
    s.points.forEach((pt, k) => {
      const h = fit.pointHs[i][k];
      children.push(textPart(id(`${name}-point-${k + 1}`), pt, cx, y + h / 2, { fontSize: fit.fs, maxWidth: innerW, fontWeight: 500, color: 'text' }));
      y += h + tier.gap * u;
    });
    const move = row ? { dx: (accent ? 1 : -1) * 48 * u } : { dy: 24 * u };
    for (const part of children) parts.push(enter(part, span(slots[i]), move));
  });
  const badgeY = row ? centres[0][1] : (centres[0][1] + centres[1][1]) / 2;
  const badge = ellipsePart(id('vs-badge'), 0, badgeY, BADGE * u, { fill: 'accent' });
  const vs = textPart(id('vs'), 'vs', 0, badgeY, { fontSize: Math.max(1, Math.round(MIN_TEXT * u)), maxWidth: BADGE * u, fontWeight: 800, color: 'surface' });
  parts.push(enter(badge, span(slots[1]), { scale: 0.6 }), enter(vs, span(slots[1]), { scale: 0.6 }));
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'two cards side by side (stacked on a tall canvas), each a title and 1 to 5 points, joined by a "vs" badge',
  params,
  describe: {
    left: '{ title, points }: the first option; title up to 24 characters, 1 to 5 points of up to 28',
    right: '{ title, points }: the second option, the same way; its card is painted in the accent colour',
    headline: 'a line above the cards, up to 40 characters',
  },
  example: {
    headline: 'Spreadsheet or spec?',
    left: { title: 'By hand', points: ['Drag every keyframe', 'Re-export each tweak', 'Fix the timing again'] },
    right: { title: 'With a spec', points: ['Describe the scene', 'Preview in seconds', 'Same video every time'] },
  },
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    if (Object.hasOwn(PARAM_OF, part)) return PARAM_OF[part];
    const [, name, kind, n] = /^(left|right)-(title|point)(?:-(\d+))?$/.exec(part) ?? [];
    if (!name) return null;
    return kind === 'title' ? `${name}.title` : `${name}.points[${Number(n) - 1}]`;
  },
  expand,
});
