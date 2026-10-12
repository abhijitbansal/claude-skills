// SVG renderer. renderSvg(geometry, spec, { theme, idPrefix }) draws a laid-out
// diagram as one <svg>: classes only, with every colour a CSS variable from the
// theme (diagramCss() holds the rules). Text is measured with the theme fonts,
// never in a browser, so what the layout reserved is what is drawn.
import { lineHeight } from '../../shared/text.mjs';
import { KINDS } from './kinds.mjs';
import { fonts, GROUP_LABEL_INSET } from './sizes.mjs';
import { anchorEdges, roundedPath } from './edges.mjs';
import { esc, num, textLines, markerDefs } from './svg.mjs';
import { shapeSvg, boxContent, outsideContent, plateSvg, edgeSvg, nodeOpen } from './parts.mjs';
import { renderSequence } from './render-sequence.mjs';
import { diagramCss } from './css.mjs';

export { diagramCss };

const GROUP_RADIUS = 10;
const GROUP_LABEL_MIDDLE = 20; // group label centre, below the group's top edge
const EDGE_ARROW = { solid: 'solid', dashed: 'solid', async: 'open' };

function groupSvg(group, f) {
  const lh = lineHeight(f.group);
  const label = textLines('pa-group-label', [group.label], { x: group.x + GROUP_LABEL_INSET, top: group.y + GROUP_LABEL_MIDDLE - lh / 2, lh, size: f.group.size, anchor: 'start' });
  return `<g class="pa-group" data-id="${esc(group.id)}" data-depth="${group.depth}"><rect class="pa-group-box" x="${num(group.x)}" y="${num(group.y)}" width="${num(group.width)}" height="${num(group.height)}" rx="${GROUP_RADIUS}"/>${label}</g>`;
}

function graphNodeSvg(n, specNode, type, f) {
  const kind = specNode.kind ?? KINDS[type].default;
  const content = n.labelBox ? outsideContent(n, f) : boxContent(n, f);
  return `${nodeOpen(n, kind, specNode.label)}${shapeSvg(n.shape, n)}${content}</g>`;
}

function renderGraph(raw, spec, theme, prefix) {
  const g = anchorEdges(raw);
  const f = fonts(theme);
  const groups = [...g.groups].sort((a, b) => a.depth - b.depth).map((x) => groupSvg(x, f));
  const edges = g.edges.map((e) => edgeSvg({ ...e, d: roundedPath(e.points), heads: EDGE_ARROW[e.style] }, prefix));
  // Nodes are emitted in layer order: the DOM order is the Tab order.
  const rank = new Map(raw.layers.flat().map((id, i) => [id, i]));
  const nodes = g.nodes.map((n, i) => ({ id: n.id, svg: graphNodeSvg(n, spec.nodes[i], spec.type, f) }))
    .sort((a, b) => rank.get(a.id) - rank.get(b.id)).map((n) => n.svg);
  const labels = g.edges.filter((e) => e.label).map((e) => plateSvg(e.id, e.label, f));
  return { width: g.width, height: g.height, body: [...groups, ...edges, ...nodes, ...labels].join(''), counts: `${g.nodes.length} nodes and ${g.edges.length} edges` };
}

/**
 * Draw a laid-out diagram. `geometry` comes from layoutGraph or layoutSequence
 * for the same `spec`; `idPrefix` keeps ids unique when several diagrams share a page.
 */
export function renderSvg(geometry, spec, { theme, idPrefix = 'd' } = {}) {
  if (!theme) throw new TypeError('renderSvg needs { theme }: text is measured with the theme fonts');
  const drawn = spec.type === 'sequence' ? renderSequence(geometry, spec, theme, idPrefix) : renderGraph(geometry, spec, theme, idPrefix);
  const desc = `${spec.subtitle ? `${spec.subtitle}. ` : ''}${spec.type} diagram with ${drawn.counts}.`;
  const root = `pa-diagram pa-type-${spec.type}${spec.animate ? ' pa-animate' : ''}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${root}" viewBox="0 0 ${num(drawn.width)} ${num(drawn.height)}" role="graphics-document" aria-labelledby="${esc(idPrefix)}-title ${esc(idPrefix)}-desc">`,
    `<title id="${esc(idPrefix)}-title">${esc(spec.title)}</title>`,
    `<desc id="${esc(idPrefix)}-desc">${esc(desc)}</desc>`,
    markerDefs(idPrefix),
    drawn.body,
    '</svg>',
  ].join('');
}
