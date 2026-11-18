// The product end card (look.kinds.end.product, keynote; gate-keynote-2 ruling 3): the film's product picture again, on
// an elevated card, beside the closing line on a wide frame (the line in the left columns, the card in the right) and
// under it on a tall one. The wordmark is the look's tag over the line and the ask under it, both on the line's left
// edge, so the card closes on the product, not on type alone. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { roundedRect, colourOf } from '../devices/shared.mjs';
import { elevatedShadow } from '../devices/card.mjs';
import { editorialSpan, editorialBounds } from './editorial.mjs';
import { CAP_HEIGHT, WORD_DESCENT, sizeAt, fontFor, isWide, fitDisplay, setCase, enterTracks, unionBox, wordBoxes, opensSet } from './shared.mjs';
import { MIN_HERO_RATIO } from '../review/frame.mjs';

const HALF = 2;

// The mark as the look's tag at (x, top), its text the film's mark (role 'mark'), pinned to the frame: { nodes, box }.
function tagAt(shot, ctx, x, top) {
  const { look, unit, seed, measure } = ctx;
  const id = `${shot.id}.mark`;
  const at = opensSet(look) ? 0 : look.moves.enter.dur;
  const [group] = registries.devices.get('tag').build({ id, box: [x, top, 1, 1], at, look, unit, seed, measure, text: shot.mark }).nodes;
  const box = registries.devices.get('tag').build({ id, box: [x, top, 1, 1], at, look, unit, seed, measure, text: shot.mark }).boxes.tag;
  const children = group.children.map((n) => (n.type === 'text' ? node('text', `${id}.text`, { ...n.props, role: 'mark' }, { tracks: n.tracks }) : n));
  return { nodes: [node('group', id, { ...group.props, fixed: true }, { tracks: group.tracks, children })], box };
}

// The closing line fitted to `span`, the ask under it at a third of its size: { title, ask, h } (h from the line's first
// cap line to the ask's last descent; the ask's y is relative to that top).
function textBlock(shot, ctx, data, span, maxHeight, title) {
  const { look, unit, measure } = ctx;
  const p = data.product;
  const max = data.max * unit;
  const face = fontFor(look, 'display', max, unit);
  const font = data.titleWeight === undefined ? face : { ...face, weight: data.titleWeight };
  const set = fitDisplay({ text: setCase(look, 'display', title), font, maxWidth: span.w, align: 'left', measure, optical: true }, { min: sizeAt(look, p.fromStep, unit), max, maxHeight, maxLines: look.maxLines.display }, look, unit);
  const size = set.font.size;
  const titleH = set.layout.lines.at(-1).y - set.layout.lines[0].y + (CAP_HEIGHT + WORD_DESCENT) * size;
  if (shot.ask === undefined) return { title: set, ask: null, h: titleH };
  const askFace = data.askFace ?? 'label';
  const askFont = fontFor(look, askFace, size / MIN_HERO_RATIO, unit);
  const layout = layoutText({ text: setCase(look, askFace, shot.ask), font: askFont, maxWidth: span.w, measure });
  const askTop = titleH + data.askGap * size;
  return { title: set, ask: { font: askFont, layout, top: askTop }, h: askTop + (CAP_HEIGHT + WORD_DESCENT) * askFont.size + layout.lines.at(-1).y - layout.lines[0].y };
}

// The product on its elevated card: the picture whole, `pad` inside the card, the card as wide as `span`: { nodes, box }.
function productCard(shot, ctx, picture, span, top, maxH) {
  const { look, unit } = ctx;
  const pad = ctx.data.product.pad * unit, radius = (look.devices.card?.radius ?? 0) * unit;
  const iw = Math.min(span.w - HALF * pad, ((maxH - HALF * pad) * picture.width) / picture.height), ih = (iw * picture.height) / picture.width;
  const box = [span.x + (span.w - iw - HALF * pad) / HALF, top, iw + HALF * pad, ih + HALF * pad];
  const id = `${shot.id}.product`;
  const nodes = [
    ...elevatedShadow(id, box, radius, look, unit, look.devices.card?.layers ?? []),
    node('path', `${id}.paper`, { d: roundedRect(...box, radius), fill: colourOf(look, 'card') }),
    node('image', `${id}.image`, { src: picture.src, w: iw, h: ih, x: box[0] + pad, y: box[1] + pad }),
  ];
  return { nodes, box };
}

/** The product end card's { nodes, boxes, hero } for `title` with the product `picture` ({ src, width, height }). */
export function expandProduct(shot, ctx, data, times, title, picture, hero) {
  const { look, unit, canvas } = ctx;
  const p = data.product;
  const c = { ...ctx, data };
  const bounds = editorialBounds(ctx);
  const wide = isWide(canvas);
  const text = editorialSpan(ctx, 1, wide ? p.textTo : 12);
  const cardSpan = wide ? editorialSpan(ctx, p.cardFrom, 12) : text;
  const block = textBlock(shot, ctx, data, text, bounds.height(wide ? p.heightWide : p.heightTall), title);
  const tagProbe = shot.mark === undefined ? null : tagAt(shot, ctx, text.x, 0);
  const tagH = tagProbe === null ? 0 : tagProbe.box[3] + p.tagGap * unit;
  const stackH = tagH + block.h;
  const gap = p.gap * unit;
  const cardMaxH = wide ? bounds.bottom - bounds.top : bounds.bottom - bounds.top - stackH - gap;
  const probe = productCard(shot, c, picture, cardSpan, 0, cardMaxH);
  const whole = wide ? stackH : stackH + gap + probe.box[3];
  const top = bounds.top + (bounds.bottom - bounds.top - whole) / HALF;
  const textTop = wide ? bounds.top + (bounds.bottom - bounds.top - stackH) / HALF : top;
  const card = productCard(shot, c, picture, cardSpan, wide ? bounds.top + (bounds.bottom - bounds.top - probe.box[3]) / HALF : top + stackH + gap, cardMaxH);
  const tag = tagProbe === null ? null : tagAt(shot, ctx, text.x, textTop);
  const capTop = textTop + tagH;
  const size = block.title.font.size;
  const y = capTop + CAP_HEIGHT * size - block.title.layout.lines[0].y;
  const titleNode = node('text', hero, { x: text.x, y, layout: block.title.layout, font: block.title.font, fill: look.palette.ink, role: 'hero' }, {
    wordTracks: times.title.map(({ at }) => (opensSet(look) ? {} : enterTracks(look, unit, at))),
  });
  const words = wordBoxes(block.title.layout, text.x, y);
  const boxes = { title: unionBox(words), ...Object.fromEntries(words.map((box, i) => [`word:${i}`, box])), product: card.box };
  const nodes = [...card.nodes, titleNode];
  if (block.ask !== null) {
    const askY = capTop + block.ask.top + CAP_HEIGHT * block.ask.font.size - block.ask.layout.lines[0].y;
    nodes.push(node('text', `${shot.id}.ask`, { x: text.x, y: askY, layout: block.ask.layout, font: block.ask.font, fill: look.palette.ink, role: 'ask' }, { tracks: enterTracks(look, unit, times.ask, { y: askY }) }));
    boxes.ask = unionBox(wordBoxes(block.ask.layout, text.x, askY));
  }
  if (tag !== null) {
    nodes.push(...tag.nodes);
    boxes.mark = tag.box;
  }
  return { nodes, boxes, hero };
}
