// The data block the viewer runtime mounts from: one object, built here for
// both the page (scripts/lib/viewer.mjs) and embedders (buildDiagram().data).
import { parentMap } from './steps.mjs';
import { slugify } from './output.mjs';
import { KINDS } from './kinds.mjs';

const round = (v) => Math.round(v * 10) / 10;
const box = (x, y, w, h) => [round(x), round(y), round(w), round(h)];

function union(a, b) {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, width: Math.max(a.x + a.width, b.x + b.width) - x0, height: Math.max(a.y + a.height, b.y + b.height) - y0 };
}

// Who is next to whom: id -> { nodes: neighbour ids, edges: incident edge ids }.
// Ids are model-provided keys, so the maps are Maps until the end: a plain
// object would answer for "constructor". Object.fromEntries then makes own properties.
function adjacencyOf(links) {
  const adjacency = new Map();
  const at = (id) => {
    if (!adjacency.has(id)) adjacency.set(id, { nodes: [], edges: [] });
    return adjacency.get(id);
  };
  for (const { id, from, to } of links) {
    for (const [self, other] of [[from, to], [to, from]]) {
      const a = at(self);
      if (!a.edges.includes(id)) a.edges.push(id);
      if (other !== self && !a.nodes.includes(other)) a.nodes.push(other);
    }
  }
  return Object.fromEntries(adjacency);
}

// id -> [x, y, w, h]: what the camera fits when a step focuses the id.
function boxesOf(geometry) {
  const boxes = new Map();
  for (const g of geometry.groups ?? []) boxes.set(g.id, box(g.x, g.y, g.width, g.height));
  for (const n of [...(geometry.nodes ?? []), ...(geometry.participants ?? [])]) {
    const whole = n.labelBox ? union(n, n.labelBox) : n; // a dot's label sits beside it
    boxes.set(n.id, box(whole.x, whole.y, whole.width, whole.height));
  }
  for (const m of geometry.messages ?? []) {
    const xs = m.points.map((p) => p.x);
    const ys = m.points.map((p) => p.y);
    let shape = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    if (m.label) shape = union(shape, m.label);
    boxes.set(m.id, box(shape.x, shape.y, shape.width, shape.height));
  }
  return Object.fromEntries(boxes);
}

const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();

// id -> what the panel, the chips and the legend read: label and kind (plus
// emoji, note and detail when set) for a node or participant; style and label
// (when set) for an edge or message. `links` run in spec order, like the spec arrays.
function infoOf(spec, links) {
  const info = new Map();
  const sequence = spec.type === 'sequence';
  for (const n of sequence ? spec.participants : spec.nodes) {
    const entry = { label: oneLine(n.label), kind: n.kind ?? KINDS[spec.type].default };
    if (n.emoji !== undefined) entry.emoji = n.emoji;
    if (n.note !== undefined) entry.note = oneLine(n.note);
    if (n.detail !== undefined) entry.detail = String(n.detail).trim();
    info.set(n.id, entry);
  }
  (sequence ? spec.messages ?? [] : spec.edges ?? []).forEach((e, i) => {
    const entry = { style: sequence ? e.kind ?? 'sync' : e.style ?? 'solid' };
    if (e.label !== undefined) entry.label = oneLine(e.label);
    info.set(links[i].id, entry);
  });
  return Object.fromEntries(info);
}

// id -> the edges that leave it along the arrow (a two-headed edge leaves both
// ends). Only ids something leaves appear; the other end of an edge is edges[e].
function directedOf(links) {
  const out = new Map();
  const add = (id, edge) => {
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(edge);
  };
  for (const l of links) {
    add(l.from, l.id);
    if (l.both && l.to !== l.from) add(l.to, l.id);
  }
  return Object.fromEntries(out);
}

/**
 * `built` carries { geometry, steps, ids, width, height, beats, chapters }. The result is what
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
    autoplay: spec.autoplay === true,
    beats: built.beats,
    chapters: built.chapters,
    info: infoOf(spec, links),
    directed: directedOf(links),
  };
}
