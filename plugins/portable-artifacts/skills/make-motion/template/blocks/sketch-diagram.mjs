// sketch-diagram: 2 to 8 hand-drawn boxes, each with a label and an optional icon and scribble fill, joined by arrows with
// optional labels, as a row, a column or a grid. A node is its box, then its icon, then its label; an arrow that leaves a node
// is drawn right after it, then its label. Edges run from box edge to box edge with a slight bow, as in the spike.
import { abovePlace, blockGroup } from './layout.mjs';
import { SCRIBBLE_FILL } from '../sketch/style.mjs';
import { fitLabel, labelPart, boxPart, linePart, iconPart, sketchRoom, textWidth, longestWord, pickLayout } from './sketch-layout.mjs';

const text = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const params = {
  type: 'object',
  additionalProperties: false,
  required: ['nodes', 'edges'], // `nodes` first: a scene too short for the drawing is reported at the first required param
  properties: {
    nodes: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: text(24), label: text(24), icon: text(40), fill: { type: 'boolean' } } },
    },
    edges: {
      type: 'array',
      minItems: 0,
      maxItems: 12,
      items: { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: text(24), to: text(24), label: text(16) } },
    },
    layout: { enum: ['row', 'column', 'grid'] },
  },
};

const WIDTH_CAP = 1720; // px at 1080: the widest a diagram goes, as step-flow's row
// Sizes, roomiest first, in px at 1080 (the spike's are the second: a 370 x 300 box, a 112 icon, 76 and 56 text). A layout takes the
// first tier, in the first mode, whose whole drawing fits its room. `lines` is how many lines a label may wrap onto.
const TIERS = [
  { label: 92, edge: 64, icon: 132, padX: 44, padY: 38, boxMax: 480, gapX: 190, gapY: 140, lines: 2 },
  { label: 76, edge: 56, icon: 112, padX: 36, padY: 30, boxMax: 400, gapX: 170, gapY: 120, lines: 2 },
  { label: 64, edge: 48, icon: 88, padX: 30, padY: 24, boxMax: 340, gapX: 140, gapY: 100, lines: 2 },
  { label: 52, edge: 44, icon: 68, padX: 24, padY: 20, boxMax: 280, gapX: 120, gapY: 84, lines: 2 },
  { label: 44, edge: 40, icon: 52, padX: 20, padY: 14, boxMax: 240, gapX: 100, gapY: 68, lines: 2 },
  { label: 40, edge: 40, icon: 44, padX: 16, padY: 10, boxMax: 200, gapX: 90, gapY: 56, lines: 3 },
];
const BOX_MIN_SHARE = 0.62; // a box is at least this share of its tier's widest
const INLINE_CAP = 900; // px at 1080: a column's boxes are as wide as their label needs, up to this
const ICON_GAP = 14; // between an icon and its label
const ARROW_GAP = 18; // between a box and the arrow that leaves or meets it
const EDGE_PAD = 10; // between an arrow and its label
const LABEL_MARGIN = 18; // between a label over an arrow and the boxes either side of it
const EDGE_WRAP_SHARE = 1.15; // an edge label wraps at this share of the gap between boxes
const EDGE_WRAP_BESIDE = 420; // px at 1080: ... or at this, beside a column's arrow
const OBSTACLE_PAD = 8; // an arrow keeps this far from a box it is not joined to
const ARROW_BOW = 26; // px at 1080: the spike's slight bow of an arrow, and at most this share of its length (the same numbers as the plan's
const ARROW_BOW_SHARE = 0.17; // default, written out here because the label is placed from the bow, so every arrow says its own)
// Shares of an arrow's length it bows by when the straight one would cross a box. Out of the sides of both boxes (SIDE_ARCHES) it
// must bow at least half its length to come back into the second box's side at 45 degrees or less; bowed straight (ARCHES) it
// bows over then under, smallest first.
const SIDE_ARCHES = Array.from({ length: 11 }, (_, i) => (i + 5) / 10);
const ARCHES = Array.from({ length: 29 }, (_, i) => (i + 2) / 10).flatMap((share) => [share, -share]);
const CURVE_SAMPLES = [0.15, 0.25, 0.35, 0.45, 0.5, 0.55, 0.65, 0.75, 0.85];
const FALLBACKS = ['grid', 'column', 'row']; // after the layout asked for, in this order

// Columns and rows of a layout: a grid is two columns on a tall canvas, two rows on a wide one, a square on a square one.
function gridShape(mode, count, [width, height]) {
  if (mode === 'row') return { cols: count, rows: 1 };
  if (mode === 'column') return { cols: 1, rows: count };
  const cols = width < height ? 2 : width > height ? Math.max(2, Math.ceil(count / 2)) : Math.ceil(Math.sqrt(count));
  return { cols, rows: Math.ceil(count / cols) };
}

// One layout: `mode` at `tier`, sized from the labels. With `inline` a node's icon sits beside its label (boxes are short and
// wide), else above it. `overflow`: how many times the drawing is wider or taller than its room.
function measure(nodes, edges, mode, tier, room, size, inline) {
  const { u } = room;
  const fs = Math.max(1, Math.round(tier.label * u));
  const edgeFs = Math.max(1, Math.round(tier.edge * u));
  const [padX, padY, iconGap, icon] = [tier.padX * u, tier.padY * u, ICON_GAP * u, Math.max(1, Math.round(tier.icon * u))];
  const hasIcon = nodes.some((node) => node.icon);
  const iconCol = inline && hasIcon ? icon + iconGap : 0;
  const widest = Math.max(...nodes.map((node) => textWidth(node.label, fs)));
  const longest = Math.max(...nodes.map((node) => longestWord(node.label, fs)));
  const cap = mode === 'column' ? Math.min(room.width, INLINE_CAP * u) : tier.boxMax * u + iconCol;
  const boxW = Math.max(Math.min(cap, widest + iconCol + 2 * padX), longest + iconCol + 2 * padX, (!inline && hasIcon ? icon : 0) + 2 * padX, tier.boxMax * u * BOX_MIN_SHARE);
  const inner = boxW - 2 * padX - iconCol;
  const fits = nodes.map((node) => fitLabel(node.label, { sizes: [fs], maxWidth: inner, maxLines: tier.lines }));
  const content = inline ? Math.max(hasIcon ? icon : 0, ...fits.map((f) => f.height)) : Math.max(...nodes.map((node, i) => (node.icon ? icon + iconGap : 0) + fits[i].height));
  const boxH = 2 * padY + content;
  // A label across the room between two boxes beside each other wraps to it; one beside a downward arrow may run wide, so that
  // only its height (one line) takes room between the rows.
  const fitEdge = (edge, maxWidth) => fitLabel(edge.label, { sizes: [edgeFs], maxWidth, maxLines: 2 });
  const edgeFits = edges.map((edge) => (edge.label ? { across: fitEdge(edge, tier.gapX * u * EDGE_WRAP_SHARE), beside: fitEdge(edge, EDGE_WRAP_BESIDE * u) } : null));
  const gapX = Math.max(tier.gapX * u, ...edgeFits.map((f) => (f ? f.across.width + 2 * LABEL_MARGIN * u : 0)));
  const gapY = Math.max(tier.gapY * u, ...edgeFits.map((f) => (f ? f.beside.height + 2 * EDGE_PAD * u : 0)));
  const { cols, rows } = gridShape(mode, nodes.length, size);
  const [width, height] = [cols * boxW + (cols - 1) * gapX, rows * boxH + (rows - 1) * gapY];
  return { mode, inline, u, icon, iconGap, padX, iconCol, boxW, boxH, inner, fits, edgeFits, gapX, gapY, cols, rows, width, height, overflow: Math.max(width / room.width, height / room.height) };
}

// The layout asked for at the first tier that fits, icons above the labels then (all but a column) beside them, else the next
// mode's, and so on; none fitting: the one that overflows least.
function chooseLayout(nodes, edges, requested, room, size) {
  const modes = [...new Set([requested, ...FALLBACKS])];
  const at = (mode, inline) => TIERS.map((tier) => measure(nodes, edges, mode, tier, room, size, inline));
  return pickLayout(modes.flatMap((mode) => (mode === 'column' ? at(mode, true) : [...at(mode, false), ...at(mode, true)])));
}

// Node `i`'s centre: a grid snakes (the second row runs back), so each node sits beside the one before it.
function centreOf(layout, i) {
  const { cols, rows, boxW, boxH, gapX, gapY, mode } = layout;
  const row = Math.floor(i / cols);
  const col = mode === 'grid' && row % 2 === 1 ? cols - 1 - (i % cols) : i % cols;
  return [(col - (cols - 1) / 2) * (boxW + gapX), (row - (rows - 1) / 2) * (boxH + gapY)];
}

function nodeParts(node, i, layout, [cx, cy], id) {
  const { boxW, boxH, padX, icon, iconGap, iconCol, inner, inline } = layout;
  const k = i + 1;
  const fit = layout.fits[i];
  const parts = [boxPart(id(`box-${k}`), cx, cy, boxW, boxH, node.fill ? { fill: SCRIBBLE_FILL } : {})];
  if (inline) {
    const left = cx - boxW / 2 + padX;
    if (node.icon) parts.push(iconPart(id(`icon-${k}`), node.icon, left + icon / 2, cy, icon));
    parts.push(labelPart(id(`label-${k}`), node.label, fit, left + iconCol + inner / 2, cy));
    return parts;
  }
  const top = cy - ((node.icon ? icon + iconGap : 0) + fit.height) / 2;
  if (node.icon) parts.push(iconPart(id(`icon-${k}`), node.icon, cx, top + icon / 2, icon));
  parts.push(labelPart(id(`label-${k}`), node.label, fit, cx, top + (node.icon ? icon + iconGap : 0) + fit.height / 2));
  return parts;
}

// Where the line from `centre` towards `target` leaves a box `half` wide and tall, and `gap` beyond it.
function boundary(centre, half, target, gap) {
  const [dx, dy] = [target[0] - centre[0], target[1] - centre[1]];
  const length = Math.hypot(dx, dy) || 1;
  const reach = Math.min(dx === 0 ? Infinity : half[0] / Math.abs(dx), dy === 0 ? Infinity : half[1] / Math.abs(dy)) + gap / length;
  return [centre[0] + dx * reach, centre[1] + dy * reach];
}

const quadAt = (p0, c, p1, t) => [0, 1].map((a) => (1 - t) ** 2 * p0[a] + 2 * (1 - t) * t * c[a] + t * t * p1[a]);

// The centre of an arrow's label: on the side the arrow bows to, beyond the bend (above a rightward arrow, to the right of a
// downward one), `fit` the label's fitted text.
function labelCentre(p0, p1, bow, fit, u) {
  const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
  const side = bow < 0 ? -1 : 1;
  const [nx, ny] = [((p1[1] - p0[1]) / length) * side, (-(p1[0] - p0[0]) / length) * side];
  const reach = Math.abs(bow) / 2 + EDGE_PAD * u + (Math.abs(nx) * fit.width + Math.abs(ny) * fit.height) / 2;
  return [(p0[0] + p1[0]) / 2 + nx * reach, (p0[1] + p1[1]) / 2 + ny * reach];
}

// The ways an arrow from the box at ca to the one at cb may run, best first: straight from box edge to box edge, bowed one way or
// the other; then out of the same side of both boxes and round whatever lies between (over, then under, in arches of growing
// height); then bowed straight. Each is { p0, p1, bow } (bow in canvas px, positive: to the left of the way it runs).
function routesOf(ca, cb, layout) {
  const { u } = layout;
  const half = [layout.boxW / 2, layout.boxH / 2];
  const gap = ARROW_GAP * u;
  const direct = [boundary(ca, half, cb, gap), boundary(cb, half, ca, gap)];
  const length = Math.hypot(direct[1][0] - direct[0][0], direct[1][1] - direct[0][1]);
  const base = Math.min(ARROW_BOW * u, ARROW_BOW_SHARE * length);
  const routes = [base, -base].map((bow) => ({ p0: direct[0], p1: direct[1], bow }));
  const chord = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
  const normal = [(cb[1] - ca[1]) / chord, -(cb[0] - ca[0]) / chord];
  const reach = Math.abs(normal[0]) * half[0] + Math.abs(normal[1]) * half[1] + gap;
  for (const side of [1, -1]) {
    const [p0, p1] = [ca, cb].map((c) => [c[0] + normal[0] * side * reach, c[1] + normal[1] * side * reach]);
    for (const share of SIDE_ARCHES) routes.push({ p0, p1, bow: side * share * chord });
  }
  for (const share of ARCHES) routes.push({ p0: direct[0], p1: direct[1], bow: share * length });
  return routes;
}

// The first route that crosses no box it is not joined to and keeps the arrow and its label (`fit`, or null) in the room; else the
// first that stays in the room; else the plain one.
function chooseRoute(ca, cb, obstacles, layout, room, fit) {
  const pad = OBSTACLE_PAD * layout.u;
  const controlOf = ({ p0, p1, bow }) => {
    const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    return [(p0[0] + p1[0]) / 2 + ((p1[1] - p0[1]) / length) * bow, (p0[1] + p1[1]) / 2 - ((p1[0] - p0[0]) / length) * bow];
  };
  const clear = (route) => CURVE_SAMPLES.every((t) => {
    const [x, y] = quadAt(route.p0, controlOf(route), route.p1, t);
    return obstacles.every(([cx, cy]) => Math.abs(x - cx) > layout.boxW / 2 + pad || Math.abs(y - cy) > layout.boxH / 2 + pad);
  });
  const within = ([x, y], [halfW, halfH]) => Math.abs(x) + halfW <= room.width / 2 && Math.abs(y) + halfH <= room.height / 2;
  const roomy = (route) => within(quadAt(route.p0, controlOf(route), route.p1, 0.5), [0, 0])
    && (!fit || within(labelCentre(route.p0, route.p1, route.bow, fit, layout.u), [fit.width / 2, fit.height / 2]));
  const routes = routesOf(ca, cb, layout);
  return routes.find((route) => clear(route) && roomy(route)) ?? routes.find(roomy) ?? routes[0];
}

// The arrow of `edge` and its label, or [] for an edge that names no node, or the same node twice (validate reports both).
function edgeParts(edge, j, layout, centres, ids, room, id) {
  const [a, b] = [ids.get(edge.from), ids.get(edge.to)];
  if (a === undefined || b === undefined || a === b) return [];
  const { u } = layout;
  const fits = layout.edgeFits[j];
  const level = Math.abs(centres[b][0] - centres[a][0]) >= Math.abs(centres[b][1] - centres[a][1]);
  const fit = fits && (level ? fits.across : fits.beside); // a level arrow's label sits above it, a steep one's beside it
  const { p0, p1, bow } = chooseRoute(centres[a], centres[b], centres.filter((_, n) => n !== a && n !== b), layout, room, fit);
  const parts = [linePart(id(`arrow-${j + 1}`), p0, p1, { arrow: 'end', bow: bow / u })];
  if (fit) parts.push(labelPart(id(`edge-${j + 1}`), edge.label, fit, ...labelCentre(p0, p1, bow, fit, u)));
  return parts;
}

function expand(el, ctx) {
  const { nodes, edges } = el.params;
  const room = sketchRoom(ctx, el, WIDTH_CAP);
  const requested = el.params.layout ?? (ctx.size[0] >= ctx.size[1] ? 'row' : 'column');
  const layout = chooseLayout(nodes, edges, requested, room, ctx.size);
  const id = (part) => `${el.id}/${part}`;
  const ids = new Map();
  nodes.forEach((node, i) => { if (!ids.has(node.id)) ids.set(node.id, i); });
  const centres = nodes.map((_, i) => centreOf(layout, i));
  // An arrow is drawn right after the node it leaves when it points at the next node (the spike's order); any other, once both its nodes are.
  const after = nodes.map(() => []);
  edges.forEach((edge, j) => {
    const [a, b] = [ids.get(edge.from), ids.get(edge.to)];
    if (a !== undefined && b !== undefined) after[b === a + 1 ? a : Math.max(a, b)].push(j);
  });
  const parts = nodes.flatMap((node, i) => [...nodeParts(node, i, layout, centres[i], id), ...after[i].flatMap((j) => edgeParts(edges[j], j, layout, centres, ids, room, id))]);
  return blockGroup(el, parts);
}

export default Object.freeze({
  summary: 'a hand-drawn architecture: 2 to 8 boxes with an optional icon and scribble fill, joined by labelled arrows; draws only in a hand-drawn scene',
  sketchOnly: true,
  params,
  describe: {
    nodes: '2 to 8 boxes in order: { id (up to 24 characters, what edges name), label (up to 24), icon? (a Lucide name; node scripts/sketch-icons.mjs search <word>), fill? (true hatches the box in the accent colour) }',
    edges: 'arrows between nodes: { from, to (node ids), label? (up to 16 characters) }; up to 12, and none is allowed. An arrow across other boxes arches over them',
    layout: 'row, column or grid; default row on a wide canvas, column on a tall one. One that does not fit is drawn smaller, then as a grid, then as a column',
  },
  example: {
    nodes: [{ id: 'web', label: 'Browser', icon: 'monitor' }, { id: 'api', label: 'API', icon: 'server', fill: true }, { id: 'db', label: 'Database', icon: 'database' }],
    edges: [{ from: 'web', to: 'api', label: 'https' }, { from: 'api', to: 'db', label: 'SQL' }],
  },
  // Centred across, and in the band between the safe area top and the caption zone, so a drawing fits above captions.
  place: (size, format, _side, insets) => abovePlace(size, format, insets),
  paramOf: (part) => {
    const node = /^(label|icon)-(\d+)$/.exec(part);
    if (node) return `nodes[${Number(node[2]) - 1}].${node[1]}`;
    const edge = /^edge-(\d+)$/.exec(part);
    return edge ? `edges[${Number(edge[1]) - 1}].label` : null;
  },
  validate(blockParams) {
    const errors = [];
    const first = new Map();
    blockParams.nodes.forEach((node, i) => {
      if (first.has(node.id)) errors.push({ path: `nodes[${i}].id`, message: `duplicate node id ${JSON.stringify(node.id)} (first used at nodes[${first.get(node.id)}].id)` });
      else first.set(node.id, i);
    });
    const known = [...first.keys()].join(', ');
    blockParams.edges.forEach((edge, i) => {
      for (const key of ['from', 'to']) {
        if (!first.has(edge[key])) errors.push({ path: `edges[${i}].${key}`, message: `unknown node ${JSON.stringify(edge[key])}; nodes: ${known}` });
      }
      if (edge.from === edge.to && first.has(edge.to)) errors.push({ path: `edges[${i}].to`, message: `an edge cannot join node ${JSON.stringify(edge.to)} to itself` });
    });
    return errors;
  },
  expand,
});
