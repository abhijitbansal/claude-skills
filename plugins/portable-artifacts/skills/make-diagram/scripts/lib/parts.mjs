// Drawing parts shared by the graph and sequence renderers: a node's shape and
// content, edge paths with arrow heads, label plates.
import { measure, lineHeight } from '../../shared/text.mjs';
import { ICON_SIZE, ICON_GAP, NOTE_GAP } from './sizes.mjs';
import { shapeParts, pathD } from './shapes.mjs';
import { esc, num, textLines, iconGroup, markerIds, ICON_DRAW } from './svg.mjs';

const PLATE_RADIUS = 3;
const widest = (lines, font) => Math.max(0, ...lines.map((l) => measure(l, font)));

/** A node's box shape and decoration as <path> elements. */
export function shapeSvg(shape, box) {
  const { outline, decor } = shapeParts(shape, box);
  const decorCls = shape === 'ringed-dot' ? 'pa-decor pa-decor-dot' : 'pa-decor';
  return `<path class="pa-shape pa-shape-${shape}" d="${pathD(outline)}"/>${decor.map((d) => `<path class="${decorCls}" d="${pathD(d)}"/>`).join('')}`;
}

/**
 * Icon, label lines and note of a node centred in its box (or beside the
 * icon when it has one). `n` is { x, y, width, height, lines, noteLine, icon }.
 */
export function boxContent(n, f) {
  const labelLh = lineHeight(f.label);
  const noteLh = lineHeight(f.note);
  const blockHeight = n.lines.length * labelLh + (n.noteLine ? NOTE_GAP + noteLh : 0);
  const top = n.y + (n.height - blockHeight) / 2;
  const textWidth = Math.max(widest(n.lines, f.label), n.noteLine ? measure(n.noteLine, f.note) : 0);
  const iconWidth = n.icon ? ICON_SIZE + ICON_GAP : 0;
  const left = n.x + n.width / 2 - (iconWidth + textWidth) / 2;
  const cx = left + iconWidth + textWidth / 2;
  let out = '';
  if (n.icon) out += iconGroup(n.icon, left + ICON_SIZE / 2 - ICON_DRAW / 2, top + blockHeight / 2 - ICON_DRAW / 2);
  out += textLines('pa-label', n.lines, { x: cx, top, lh: labelLh, size: f.label.size });
  if (n.noteLine) {
    out += textLines('pa-note', [n.noteLine], { x: cx, top: top + n.lines.length * labelLh + NOTE_GAP, lh: noteLh, size: f.note.size });
  }
  return out;
}

// The label of a dot or a choice, drawn in its reserved box beside the shape.
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

/** The label plate drawn over an edge or message: a surface rectangle with the text centred. */
export function plateSvg(edgeId, label, f) {
  const lh = lineHeight(f.edge);
  const text = textLines('pa-edge-text', [label.text], { x: label.x + label.width / 2, top: label.y + (label.height - lh) / 2, lh, size: f.edge.size });
  return `<g class="pa-edge-label" data-edge="${esc(edgeId)}"><rect class="pa-edge-plate" x="${num(label.x)}" y="${num(label.y)}" width="${num(label.width)}" height="${num(label.height)}" rx="${PLATE_RADIUS}"/>${text}</g>`;
}

/** The <g> of one edge or message: its path, with arrow heads by `heads` ('solid' | 'open'). */
export function edgeSvg({ id, from, to, style, both, d, heads, extra = '' }, prefix) {
  const ids = markerIds(prefix);
  const end = `marker-end="url(#${ids[heads]})"`;
  const start = both ? ` marker-start="url(#${ids[heads]})"` : '';
  return `<g class="pa-edge pa-edge-${style}${extra}" data-id="${esc(id)}" data-from="${esc(from)}" data-to="${esc(to)}"><path d="${d}" fill="none" ${end}${start}/></g>`;
}

/** Attributes every node <g> carries: classes, id, focus and an accessible name. */
export function nodeOpen(node, kind, label) {
  return `<g class="pa-node pa-kind-${esc(kind)} pa-tone-${esc(node.tone)}" data-id="${esc(node.id)}" tabindex="0" role="img" aria-label="${esc(`${label}: ${kind}`)}">`;
}
