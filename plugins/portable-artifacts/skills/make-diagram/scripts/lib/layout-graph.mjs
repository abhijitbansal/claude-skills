// Layered graph layout (architecture, flow, state) with ELK.
// layoutGraph(spec, theme) -> Geometry; every coordinate is absolute (top-left
// origin, OUTER_MARGIN px around the content) and rounded to 0.1 px.
import ELK from 'elkjs/lib/elk.bundled.js';
import { KINDS } from './kinds.mjs';
import { nodeSize, edgeLabelSize, groupMinSize } from './sizes.mjs';

export const OUTER_MARGIN = 24;
const GROUP_PADDING = `[top=40,left=${OUTER_MARGIN},bottom=${OUTER_MARGIN},right=${OUTER_MARGIN}]`;
const ROOT_PADDING = `[top=${OUTER_MARGIN},left=${OUTER_MARGIN},bottom=${OUTER_MARGIN},right=${OUTER_MARGIN}]`;
const DEFAULT_DIRECTION = { architecture: 'right', flow: 'down', state: 'right' };

// ELK ids are prefixed per kind of thing: node, group and edge ids are
// separate namespaces in the spec, so a node and an edge may share a spelling.
const elkNodeId = (id) => `n.${id}`;
const elkGroupId = (id) => `g.${id}`;
const elkEdgeId = (i) => `e.${i}`;

const round = (v) => Math.round(v * 10) / 10;
const box = (e) => ({ x: round(e.x), y: round(e.y), width: round(e.width), height: round(e.height) });

// Spacing is repeated on every group: ELK reads it per container, so a group
// that does not carry it falls back to ELK's tighter defaults inside.
const SPACING = {
  'elk.spacing.nodeNode': '32',
  'elk.layered.spacing.nodeNodeBetweenLayers': '72',
  'elk.spacing.edgeLabel': '6',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
};

function rootOptions(direction) {
  return {
    'elk.algorithm': 'layered',
    'elk.direction': direction === 'down' ? 'DOWN' : 'RIGHT',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.randomSeed': '1',
    // Reverse the later edge of a cycle: authors list forward edges first and
    // the "no / retry" edge back, so the flow keeps its reading order.
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    ...SPACING,
    'elk.edgeLabels.inline': 'false',
    'elk.padding': ROOT_PADDING,
    // Report every node, label and edge point in root coordinates, so nested
    // groups need no per-container offset conversion afterwards.
    'elk.json.shapeCoords': 'ROOT',
    'elk.json.edgeCoords': 'ROOT',
  };
}

// Outside label beside a dot: below it when edges run left-right, to its right
// when they run top-down, so the label never sits in an edge's path.
const LABEL_PLACEMENT = {
  right: { elk: '[H_CENTER, V_BOTTOM, OUTSIDE]', side: 'bottom' },
  down: { elk: '[H_RIGHT, V_CENTER, OUTSIDE]', side: 'right' },
};

function elkNode(node, size, direction) {
  const out = { id: elkNodeId(node.id), width: size.width, height: size.height };
  if (size.labelBox) {
    out.layoutOptions = { 'elk.nodeLabels.placement': LABEL_PLACEMENT[direction].elk };
    out.labels = [{ id: `nl.${node.id}`, text: node.label, ...size.labelBox }];
  }
  return out;
}

function elkGroup(group, children, theme) {
  const min = groupMinSize(group, theme);
  return {
    id: elkGroupId(group.id),
    layoutOptions: {
      ...SPACING,
      'elk.padding': GROUP_PADDING,
      'elk.nodeSize.constraints': '[MINIMUM_SIZE]',
      'elk.nodeSize.minimum': `(${min.width}, ${min.height})`,
    },
    children,
  };
}

function elkEdge(edge, i, theme, ends) {
  const out = { id: elkEdgeId(i), sources: [ends(edge.from)], targets: [ends(edge.to)] };
  if (edge.label !== undefined) {
    const { text, width, height } = edgeLabelSize(edge.label, theme);
    out.labels = [{ id: `el.${i}`, text, width, height }];
  }
  return out;
}

// Position of a group in the spec's node order: where its first descendant
// node appears (a group holding no nodes goes last). ELK's model-order cycle
// breaking follows child order, so children keep the order the author wrote.
function groupOrder(groups, nodes) {
  const order = new Map();
  const visit = (g) => {
    if (order.has(g.id)) return order.get(g.id);
    const own = nodes.flatMap((n, i) => (n.group === g.id ? [i] : []));
    const nested = groups.filter((c) => c.parent === g.id).map(visit);
    const first = Math.min(Infinity, ...own, ...nested);
    order.set(g.id, first);
    return first;
  };
  groups.forEach(visit);
  return order;
}

function buildElkGraph(spec, theme, sizes, direction) {
  const groups = spec.groups ?? [];
  const nodes = spec.nodes ?? [];
  const groupIds = new Set(groups.map((g) => g.id));
  const firstNode = groupOrder(groups, nodes);
  const members = (parent) => [
    ...groups.filter((g) => g.parent === parent).map((g) => ({ at: firstNode.get(g.id), elk: elkGroup(g, members(g.id), theme) })),
    ...nodes.flatMap((n, i) => (n.group === parent ? [{ at: i, elk: elkNode(n, sizes.get(n.id), direction) }] : [])),
  ].sort((a, b) => a.at - b.at).map((m) => m.elk);
  const ends = (id) => (groupIds.has(id) ? elkGroupId(id) : elkNodeId(id));
  return {
    id: 'root',
    layoutOptions: rootOptions(direction),
    children: members(undefined),
    edges: (spec.edges ?? []).map((e, i) => elkEdge(e, i, theme, ends)),
  };
}

// ---- reading the result back ------------------------------------------

function collect(elkNode, into = new Map()) {
  for (const child of elkNode.children ?? []) {
    into.set(child.id, child);
    collect(child, into);
  }
  return into;
}

// Edges can sit at any level of the result; with ROOT coordinates they all use
// the same frame.
function collectEdges(elkNode, into = new Map()) {
  for (const e of elkNode.edges ?? []) into.set(e.id, e);
  for (const child of elkNode.children ?? []) collectEdges(child, into);
  return into;
}

function groupDepths(groups) {
  const parent = new Map(groups.map((g) => [g.id, g.parent]));
  const depth = (id) => (parent.get(id) === undefined ? 0 : 1 + depth(parent.get(id)));
  return new Map(groups.map((g) => [g.id, depth(g.id)]));
}

// Nodes of one layer overlap along the main axis (they sit in the same
// column or row band) while two layers are at least a layer gap apart, so
// merge nodes whose main-axis intervals overlap. ELK exposes no per-node layer
// id in its JSON result (layering.layerId is an input hint, not an output).
function clusterLayers(items, axis) {
  const start = axis === 'x' ? (n) => n.x : (n) => n.y;
  const end = axis === 'x' ? (n) => n.x + n.width : (n) => n.y + n.height;
  const cross = axis === 'x' ? (n) => n.y : (n) => n.x;
  const layers = [];
  let layerEnd = -Infinity;
  for (const item of [...items].sort((a, b) => start(a) - start(b) || cross(a) - cross(b))) {
    if (start(item) >= layerEnd) layers.push([]);
    layers[layers.length - 1].push(item);
    layerEnd = Math.max(layerEnd, end(item));
  }
  return layers.map((layer) => layer.sort((a, b) => cross(a) - cross(b)));
}

function labelBox(label) {
  return { x: round(label.x), y: round(label.y), width: round(label.width), height: round(label.height) };
}

function readNode(node, size, kindInfo, laid, layerOf, direction) {
  const out = {
    id: node.id,
    ...box(laid),
    shape: kindInfo.shape,
    lines: size.lines,
    noteLine: size.noteLine,
    icon: size.icon,
    tone: node.tone ?? 'neutral',
    group: node.group ?? null,
    layer: layerOf.get(node.id),
  };
  if (size.labelBox) {
    out.labelBox = labelBox(laid.labels[0]);
    out.labelSide = LABEL_PLACEMENT[direction].side;
  }
  return out;
}

function readEdge(edge, i, laid) {
  if (laid.sections?.length !== 1) throw new Error(`ELK routed edge ${i} in ${laid.sections?.length ?? 0} sections; expected 1`);
  const [section] = laid.sections;
  const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: round(p.x), y: round(p.y) }));
  const out = {
    id: edge.id ?? `e${i}`,
    from: edge.from,
    to: edge.to,
    points,
    style: edge.style ?? 'solid',
    both: edge.both ?? false,
  };
  if (laid.labels?.length) {
    out.label = { text: laid.labels[0].text, ...labelBox(laid.labels[0]) };
  }
  return out;
}

/** Lay out an architecture, flow or state spec. */
export async function layoutGraph(spec, theme) {
  const direction = spec.direction ?? DEFAULT_DIRECTION[spec.type];
  const kinds = KINDS[spec.type];
  const nodes = spec.nodes ?? [];
  const sizes = new Map();
  const kindOf = new Map();
  for (const n of nodes) {
    const kindInfo = kinds.kinds[n.kind ?? kinds.default];
    kindOf.set(n.id, kindInfo);
    sizes.set(n.id, nodeSize(n, kindInfo, theme));
  }

  const result = await new ELK().layout(buildElkGraph(spec, theme, sizes, direction));

  const laidNodes = collect(result);
  const laidEdges = collectEdges(result);
  const axis = direction === 'down' ? 'y' : 'x';
  const clustered = clusterLayers(nodes.map((n) => ({ ...laidNodes.get(elkNodeId(n.id)), id: n.id })), axis);
  const layerOf = new Map(clustered.flatMap((layer, i) => layer.map((n) => [n.id, i])));

  const depths = groupDepths(spec.groups ?? []);
  return {
    width: round(result.width),
    height: round(result.height),
    nodes: nodes.map((n) => readNode(n, sizes.get(n.id), kindOf.get(n.id), laidNodes.get(elkNodeId(n.id)), layerOf, direction)),
    groups: (spec.groups ?? []).map((g) => ({
      id: g.id,
      ...box(laidNodes.get(elkGroupId(g.id))),
      label: g.label,
      depth: depths.get(g.id),
    })),
    edges: (spec.edges ?? []).map((e, i) => readEdge(e, i, laidEdges.get(elkEdgeId(i)))),
    layers: clustered.map((layer) => layer.map((n) => n.id)),
  };
}
