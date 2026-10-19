// SVG renderer. renderSvg(geometry, spec, { theme, idPrefix }) draws a laid-out
// diagram as one <svg>: classes only, with every colour a CSS variable from the
// theme (diagramCss() holds the rules). Text is measured with the theme fonts,
// never in a browser, so what the layout reserved is what is drawn.
import { lineHeight } from '../../shared/text.mjs';
import { KINDS, family } from './kinds.mjs';
import { fonts, GROUP_LABEL_INSET } from './sizes.mjs';
import { legendSvg } from './legend.mjs';
import { anchorEdges, roundedPath, curvedRoute } from './edges.mjs';
import { esc, num, textLines, markerDefs, shareBrandIcons } from './svg.mjs';
import { shapeSvg, boxContent, outsideContent, plateSvg, edgeSvg, nodeOpen } from './parts.mjs';
import { renderSequence } from './render-sequence.mjs';
import { diagramCss } from './css.mjs';

export { diagramCss };

const GROUP_RADIUS = 6;
const GROUP_LABEL_MIDDLE = 20; // group label centre, below the group's top edge
const LANE_BAR = 4; // the accent bar on a top-level group's left edge
const LANE_COLOURS = 8; // --s1 … --s8 cycle
const EDGE_ARROW = { solid: 'solid', dashed: 'solid', async: 'open' };

// A group box with its label in spaced capitals (CSS uppercases it; sizes.mjs
// measured the capitals). A top-level group is a lane: data-lane picks its bar colour.
function groupSvg(group, f, lane) {
  const lh = lineHeight(f.group);
  const label = textLines('pa-group-label', [group.label], { x: group.x + GROUP_LABEL_INSET, top: group.y + GROUP_LABEL_MIDDLE - lh / 2, lh, size: f.group.size, anchor: 'start' });
  const laneAttr = lane === null ? '' : ` data-lane="${lane}"`;
  const bar = lane === null ? '' : `<rect class="pa-lane" x="${num(group.x)}" y="${num(group.y + GROUP_RADIUS)}" width="${LANE_BAR}" height="${num(group.height - 2 * GROUP_RADIUS)}" rx="2"/>`;
  return `<g class="pa-group" data-id="${esc(group.id)}" data-depth="${group.depth}"${laneAttr}><rect class="pa-group-box" x="${num(group.x)}" y="${num(group.y)}" width="${num(group.width)}" height="${num(group.height)}" rx="${GROUP_RADIUS}"/>${bar}${label}</g>`;
}

function graphNodeSvg(n, specNode, type, f) {
  const kind = specNode.kind ?? KINDS[type].default;
  const content = n.labelBox ? outsideContent(n, f) : boxContent(n, f);
  return `${nodeOpen(n, kind, specNode.label, family(type, kind))}${shapeSvg(n.shape, n)}${content}</g>`;
}

// The label plate re-centred on the curve's midpoint (kept where ELK put it when there is none).
function onCurve(label, mid) {
  return mid ? { ...label, x: mid.x - label.width / 2, y: mid.y - label.height / 2 } : label;
}

function renderGraph(raw, spec, theme, prefix) {
  const g = anchorEdges(raw);
  const f = fonts(theme);
  const laneOf = new Map(g.groups.filter((x) => x.depth === 0).map((x, i) => [x.id, i % LANE_COLOURS]));
  const groups = [...g.groups].sort((a, b) => a.depth - b.depth).map((x) => groupSvg(x, f, laneOf.has(x.id) ? laneOf.get(x.id) : null));
  // An edge takes its from-node's colour family (none when it leaves a group).
  const famOf = new Map(spec.nodes.map((n) => [n.id, family(spec.type, n.kind)]));
  // Bézier wires; a self loop keeps its small rounded corners and its plate beside the loop.
  const routes = g.edges.map((e) => (e.from === e.to ? { d: roundedPath(e.points), mid: null } : curvedRoute(e.points)));
  const edges = g.edges.map((e, i) => edgeSvg({ ...e, d: routes[i].d, heads: EDGE_ARROW[e.style], family: famOf.get(e.from) }, prefix));
  // Nodes are emitted in layer order: the DOM order is the Tab order.
  const rank = new Map(raw.layers.flat().map((id, i) => [id, i]));
  const nodes = g.nodes.map((n, i) => ({ id: n.id, svg: graphNodeSvg(n, spec.nodes[i], spec.type, f) }))
    .sort((a, b) => rank.get(a.id) - rank.get(b.id)).map((n) => n.svg);
  const labels = g.edges.map((e, i) => (e.label ? plateSvg(e.id, onCurve(e.label, routes[i].mid), f) : '')).filter(Boolean);
  return { width: g.width, height: g.height, body: [...groups, ...edges, ...nodes, ...labels, legendSvg(g.legend, f)].join(''), counts: `${g.nodes.length} nodes and ${g.edges.length} edges` };
}

/**
 * Draw a laid-out diagram. `geometry` comes from layoutGraph or layoutSequence
 * for the same `spec`; `idPrefix` keeps ids unique when several diagrams share a page.
 */
export function renderSvg(geometry, spec, { theme, idPrefix = 'd' } = {}) {
  if (!theme) throw new TypeError('renderSvg needs { theme }: text is measured with the theme fonts');
  const drawn = spec.type === 'sequence' ? renderSequence(geometry, spec, theme, idPrefix) : renderGraph(geometry, spec, theme, idPrefix);
  const desc = `${spec.subtitle ? `${spec.subtitle}. ` : ''}${spec.type} diagram with ${drawn.counts}.`;
  const { body, defs } = shareBrandIcons(drawn.body, idPrefix);
  const root = `pa-diagram pa-type-${spec.type}${spec.animate ? ' pa-animate' : ''}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" class="${root}" viewBox="0 0 ${num(drawn.width)} ${num(drawn.height)}" role="graphics-document" aria-labelledby="${esc(idPrefix)}-title ${esc(idPrefix)}-desc">`,
    `<title id="${esc(idPrefix)}-title">${esc(spec.title)}</title>`,
    `<desc id="${esc(idPrefix)}-desc">${esc(desc)}</desc>`,
    markerDefs(idPrefix, defs),
    body,
    '</svg>',
  ].join('');
}
