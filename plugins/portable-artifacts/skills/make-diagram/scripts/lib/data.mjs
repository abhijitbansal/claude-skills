// The data block the viewer runtime mounts from: one object, built here for
// both the page (scripts/lib/viewer.mjs) and embedders (buildDiagram().data).
import { parentMap } from './steps.mjs';
import { slugify } from './output.mjs';

const round = (v) => Math.round(v * 10) / 10;
const box = (x, y, w, h) => [round(x), round(y), round(w), round(h)];

function union(a, b) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 };
}

// Who is next to whom: id -> { nodes: neighbour ids, edges: incident edge ids }.
function adjacencyOf(links) {
  const adjacency = {};
  const at = (id) => (adjacency[id] ??= { nodes: [], edges: [] });
  for (const { id, from, to } of links) {
    for (const [self, other] of [[from, to], [to, from]]) {
      const a = at(self);
      if (!a.edges.includes(id)) a.edges.push(id);
      if (other !== self && !a.nodes.includes(other)) a.nodes.push(other);
    }
  }
  return adjacency;
}

// id -> [x, y, w, h]: what the camera fits when a step focuses the id.
function boxesOf(geometry) {
  const boxes = {};
  for (const g of geometry.groups ?? []) boxes[g.id] = box(g.x, g.y, g.width, g.height);
  for (const n of [...(geometry.nodes ?? []), ...(geometry.participants ?? [])]) {
    const whole = n.labelBox ? union(n, n.labelBox) : n; // a dot's label sits beside it
    boxes[n.id] = box(whole.x, whole.y, whole.width, whole.height);
  }
  for (const m of geometry.messages ?? []) {
    const xs = m.points.map((p) => p.x);
    const ys = m.points.map((p) => p.y);
    let shape = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    if (m.label) shape = union(shape, m.label);
    boxes[m.id] = box(shape.x, shape.y, shape.width, shape.height);
  }
  return boxes;
}

/**
 * `built` carries { geometry, steps, ids, width, height }. The result is what
 * PADiagram.mount takes (template/viewer.js) plus `stem`, the file name the
 * page and its exports share.
 */
export function viewerData(spec, built) {
  const links = spec.type === 'sequence' ? built.geometry.messages : built.geometry.edges;
  return {
    type: spec.type,
    title: spec.title,
    stem: slugify(spec.title),
    animate: spec.animate === true,
    width: built.width,
    height: built.height,
    steps: built.steps,
    ids: built.ids,
    adjacency: adjacencyOf(links),
    edges: Object.fromEntries(links.map((l) => [l.id, [l.from, l.to]])),
    parents: Object.fromEntries(parentMap(spec)),
    boxes: boxesOf(built.geometry),
    frames: (built.geometry.frames ?? []).map((f) => ({ messages: [...f.messages], box: box(f.x, f.y, f.width, f.height) })),
  };
}
