// Drawing parts shared by the graph and sequence renderers: a node's shape and
// content (tile, type line, label, note), edge paths with arrow heads, label pills.
import { measure, lineHeight } from '../../shared/text.mjs';
import { TILE_SIZE, TILE_GAP, TILE_RADIUS, TYPE_GAP, TYPE_TRACK, NOTE_GAP, EMOJI_SIZE, trackedWidth } from './sizes.mjs';
import { shapeParts, pathD } from './shapes.mjs';
import { esc, num, textLines, iconGroup, markerIds, ICON_DRAW } from './svg.mjs';

const EMOJI_BASELINE = 0.35 * EMOJI_SIZE; // the emoji's baseline sits this far below the tile's middle (svg.mjs BASELINE)
const widest = (lines, font) => Math.max(0, ...lines.map((l) => measure(l, font)));

/** A node's box shape and decoration as <path> elements. */
export function shapeSvg(shape, box) {
  const { outline, decor } = shapeParts(shape, box);
  const decorCls = shape === 'ringed-dot' ? 'pa-decor pa-decor-dot' : 'pa-decor';
  return `<path class="pa-shape pa-shape-${shape}" d="${pathD(outline)}"/>${decor.map((d) => `<path class="${decorCls}" d="${pathD(d)}"/>`).join('')}`;
}

// The tile: a rounded square in the kind's tint holding the icon, or the emoji as text.
function tileSvg(n, x, y) {
  let out = `<rect class="pa-tile" x="${num(x)}" y="${num(y)}" width="${TILE_SIZE}" height="${TILE_SIZE}" rx="${TILE_RADIUS}"/>`;
  if (n.emoji) out += `<text class="pa-emoji" text-anchor="middle" x="${num(x + TILE_SIZE / 2)}" y="${num(y + TILE_SIZE / 2 + EMOJI_BASELINE)}">${esc(n.emoji)}</text>`;
  else out += iconGroup(n.icon, x + (TILE_SIZE - ICON_DRAW) / 2, y + (TILE_SIZE - ICON_DRAW) / 2);
  return out;
}

/**
 * Tile, type line, label lines and note of a node centred in its box (the text
 * beside the tile when it has one). `n` is { x, y, width, height, lines,
 * noteLine, icon, emoji, typeLine }; sizes.mjs reserved the room for each.
 */
export function boxContent(n, f) {
  const labelLh = lineHeight(f.label);
  const noteLh = lineHeight(f.note);
  const typeLh = lineHeight(f.type);
  const hasType = !!n.typeLine;
  const blockHeight = (hasType ? typeLh + TYPE_GAP : 0) + n.lines.length * labelLh + (n.noteLine ? NOTE_GAP + noteLh : 0);
  const top = n.y + (n.height - blockHeight) / 2;
  const textWidth = Math.max(widest(n.lines, f.label), n.noteLine ? measure(n.noteLine, f.note) : 0, hasType ? trackedWidth(n.typeLine, f.type, TYPE_TRACK) : 0);
  const tile = !!(n.icon || n.emoji);
  const tileWidth = tile ? TILE_SIZE + TILE_GAP : 0;
  const left = n.x + n.width / 2 - (tileWidth + textWidth) / 2;
  const cx = left + tileWidth + textWidth / 2;
  let out = '';
  if (tile) out += tileSvg(n, left, n.y + (n.height - TILE_SIZE) / 2);
  let y = top;
  if (hasType) {
    out += textLines('pa-type', [n.typeLine], { x: cx, top: y, lh: typeLh, size: f.type.size });
    y += typeLh + TYPE_GAP;
  }
  out += textLines('pa-label', n.lines, { x: cx, top: y, lh: labelLh, size: f.label.size });
  y += n.lines.length * labelLh;
  if (n.noteLine) out += textLines('pa-note', [n.noteLine], { x: cx, top: y + NOTE_GAP, lh: noteLh, size: f.note.size });
  return out;
}

// The label of a dot or a choice, drawn in its reserved box beside the shape (no tile, no type line).
export function outsideContent(n, f) {
  const labelLh = lineHeight(f.label);
  const noteLh = lineHeight(f.note);
  const blockHeight = n.lines.length * labelLh + (n.noteLine ? NOTE_GAP + noteLh : 0);
  const top = n.labelBox.y + (n.labelBox.height - blockHeight) / 2;
  const centred = n.labelSide === 'bottom';
  const x = centred ? n.labelBox.x + n.labelBox.width / 2 : n.labelBox.x;
  const anchor = centred ? 'middle' : 'start';
  let out = textLines('pa-label', n.lines, { x, top, lh: labelLh, size: f.label.size, anchor });
  if (n.noteLine) {
    out += textLines('pa-note', [n.noteLine], { x, top: top + n.lines.length * labelLh + NOTE_GAP, lh: noteLh, size: f.note.size, anchor });
  }
  return out;
}

/** The label pill drawn over an edge or message: a fully rounded plate with the text centred. */
export function plateSvg(edgeId, label, f) {
  const lh = lineHeight(f.edge);
  const text = textLines('pa-edge-text', [label.text], { x: label.x + label.width / 2, top: label.y + (label.height - lh) / 2, lh, size: f.edge.size });
  return `<g class="pa-edge-label" data-edge="${esc(edgeId)}"><rect class="pa-edge-plate" x="${num(label.x)}" y="${num(label.y)}" width="${num(label.width)}" height="${num(label.height)}" rx="${num(label.height / 2)}"/>${text}</g>`;
}

/**
 * The <g> of one edge or message: its wire, with arrow heads by `heads`
 * ('solid' | 'open'). `family` is the from-node's colour family (css.mjs tints
 * the wire with it); an edge leaving a group passes none.
 */
export function edgeSvg({ id, from, to, style, both, d, heads, extra = '', family }, prefix) {
  const ids = markerIds(prefix);
  const end = `marker-end="url(#${ids[heads]})"`;
  const start = both ? ` marker-start="url(#${ids[heads]})"` : '';
  const fam = family ? ` data-family="${esc(family)}"` : '';
  return `<g class="pa-edge pa-edge-${style}${extra}" data-id="${esc(id)}" data-from="${esc(from)}" data-to="${esc(to)}"${fam}><path class="pa-wire" d="${d}" fill="none" ${end}${start}/></g>`;
}

/** Attributes every node <g> carries: classes (kind, colour family, tone), id, focus and an accessible name. */
export function nodeOpen(node, kind, label, family) {
  return `<g class="pa-node pa-kind-${esc(kind)} pa-family-${esc(family)} pa-tone-${esc(node.tone)}" data-id="${esc(node.id)}" tabindex="0" role="graphics-symbol" aria-label="${esc(`${label}: ${kind}`)}">`;
}
