// Architecture, flow and state diagrams as a scene graph: ELK's 2D layout laid flat on a floor.
// 2D px / 40 -> world units; ELK x -> x, ELK y -> z. Nodes are blocks (shape and height by kind), groups are
// platforms raised by depth, edges are tubes along ELK's edge points at y = TUBE_Y.
import { emptyGraph, finalizeGraph } from '../lib/graph.mjs';
import { TUBE_RADIUS, blockOf, cameraFor, colourOfStyle, displayOf, focusFrom, kindGroups, oneLine, px, rounded, routeView, viewOf } from './diagram-parts.mjs';

const TUBE_Y = 0.3;
const PLATFORM_COLOUR = 'line';
const PLATFORM_THICKNESS = 0.1;
const PLATFORM_RISE = 0.1; // each nesting level stands this much higher than its parent
const LABEL_RISE = 0.15;
const NODE_LABEL_SIZE = 0.45;
const GROUP_LABEL_SIZE = 0.5;
const GROUP_LABEL_CHAR = 0.3; // world width of one character of a group label, roughly
const GROUP_LABEL_PAD = 0.25;
const VIEW_DIRECTION = [0.15, 1.25, 1]; // about 50 degrees up: a wide, flat layout reads as a plan, never edge-on
const NODE_VIEW_MIN = 12;
const NODE_VIEW_PER_UNIT = 1.8;
const NODE_VIEW_MARGIN = 6;
const GROUP_VIEW_PER_UNIT = 0.9;
const GROUP_VIEW_MARGIN = 4;

/** The top surface of a platform `depth` levels deep: level 0 is the floor. */
const topOfDepth = (depth) => PLATFORM_RISE * depth;

/** One tube per edge along its ELK points (ids are make-diagram's edge ids), labelled for the tooltip. */
function tubesOf(geometry, names, at) {
  return geometry.edges.map((e) => {
    const ends = `${names.get(e.from) ?? e.from} → ${names.get(e.to) ?? e.to}`;
    const tube = {
      id: e.id,
      points: rounded(e.points.map((p) => [at.x(p.x), TUBE_Y, at.z(p.y)])),
      radius: TUBE_RADIUS,
      colour: colourOfStyle(e.style),
      item: null,
      label: e.label ? oneLine(e.label.text) : ends,
      arrow: e.both ? 'both' : 'end',
    };
    return e.label ? { ...tube, display: ends } : tube;
  });
}

/** build(built, spec) -> scene graph v1 for a graph-layout diagram. `built` is make-diagram's buildDiagram result. */
export function flatGraph(built, spec) {
  const { geometry, data } = built;
  const centre = [geometry.drawing.x + geometry.drawing.width / 2, geometry.drawing.y + geometry.drawing.height / 2];
  const at = { x: (v) => px(v - centre[0]), z: (v) => px(v - centre[1]) };
  const depthOf = new Map(geometry.groups.map((g) => [g.id, g.depth]));
  const names = new Map(Object.entries(data.info).map(([id, entry]) => [id, entry.label]));

  const infos = geometry.nodes.map((n) => data.info[n.id]);
  const { groups, indexOf, batches } = kindGroups(infos.map((i) => i.kind));
  const items = [];
  const nodeViews = [];
  const labels = [];
  geometry.nodes.forEach((n, i) => {
    const info = infos[i];
    const base = n.group === null ? 0 : topOfDepth(depthOf.get(n.group));
    const [x, z] = [at.x(n.x + n.width / 2), at.z(n.y + n.height / 2)];
    const { instances, top } = blockOf(info.kind, { x, z, w: px(n.width), d: px(n.height), base });
    const group = indexOf.get(info.kind);
    items.push({ id: `i${i}`, label: oneLine(info.label), group, value: 0, display: displayOf(info) });
    for (const inst of instances) batches[group].instances.push([...inst, i]);
    labels.push({ text: oneLine(info.label), at: [x, top + LABEL_RISE, z], size: NODE_LABEL_SIZE });
    const reach = Math.max(px(n.width), px(n.height));
    nodeViews.push([n.id, viewOf([x, (base + top) / 2, z], VIEW_DIRECTION, Math.max(NODE_VIEW_MIN, NODE_VIEW_PER_UNIT * reach + NODE_VIEW_MARGIN))]);
  });

  // Outer platforms first, so a nested one is drawn after the one it stands on.
  const platform = { id: `b${batches.length}`, shape: 'box', colour: PLATFORM_COLOUR, emissive: null, flat: false, instances: [] };
  const groupViews = [];
  [...geometry.groups].sort((a, b) => a.depth - b.depth).forEach((g) => {
    const [w, d] = [px(g.width), px(g.height)];
    const [x, z] = [at.x(g.x + g.width / 2), at.z(g.y + g.height / 2)];
    const top = topOfDepth(g.depth);
    platform.instances.push([x, top - PLATFORM_THICKNESS / 2, z, w, PLATFORM_THICKNESS, d, -1]);
    // At the platform's back-left corner, where a nested group's label cannot land on its parent's: the label is
    // centred on its anchor, so the anchor sits half its width in from the corner.
    const text = oneLine(g.label);
    const half = Math.min(w / 2, (GROUP_LABEL_CHAR * text.length) / 2 + GROUP_LABEL_PAD);
    labels.push({ text, at: [x - w / 2 + half, top, z - d / 2 + LABEL_RISE], size: GROUP_LABEL_SIZE });
    groupViews.push([g.id, viewOf([x, top, z], VIEW_DIRECTION, GROUP_VIEW_PER_UNIT * Math.hypot(w, d) + GROUP_VIEW_MARGIN)]);
  });

  const g = emptyGraph('diagram', { title: spec.title });
  g.groups = groups;
  g.items = items;
  g.batches = platform.instances.length > 0 ? [...batches, platform] : batches;
  g.tubes = tubesOf(geometry, names, at);
  g.labels = labels;
  const edgeViews = g.tubes.map((t) => [t.id, routeView(t.points, VIEW_DIRECTION)]);
  g.focus = focusFrom([...nodeViews, ...groupViews, ...edgeViews], geometry.nodes.map((n, i) => [items[i].label, nodeViews[i][1]]));
  const done = finalizeGraph(g);
  return finalizeGraph({ ...done, camera: cameraFor(done.bounds, VIEW_DIRECTION) });
}
