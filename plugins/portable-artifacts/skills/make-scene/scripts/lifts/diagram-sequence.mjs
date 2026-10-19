// Sequence diagrams as a scene graph: participants stand up as pillars along x (their 2D lifeline x / 40),
// and each message is a horizontal tube between two pillars. Time runs downward: message i sits at
// y = top - i * STEP, so the first message is the highest. Frames and notes are not drawn in 3D (the 2D
// fallback keeps them); self messages are a small loop beside the pillar.
import { emptyGraph, finalizeGraph } from '../lib/graph.mjs';
import { TUBE_RADIUS, cameraFor, colourOfStyle, displayOf, focusFrom, kindGroups, oneLine, px, viewOf } from './diagram-parts.mjs';

export const STEP = 0.9; // vertical distance between two messages
const PILLAR_WIDTH = 0.8;
const LAST_GAP = 0.9; // the last message's height above the pillar base
const FIRST_GAP = 0.7; // the pillar's top above the first message
const SLABS = 3;
const SLAB_GAP = 0.08;
const LOOP_REACH = 0.8;
const LOOP_DROP = 0.4;
const LABEL_RISE = 0.18;
const MESSAGE_LABEL_SIZE = 0.34;
const PARTICIPANT_LABEL_SIZE = 0.5;
const VIEW_DIRECTION = [0.2, 0.15, 1];
const FOCUS_DISTANCE = 9;

/** The route of one message: pillar surface to pillar surface along x; a self message loops to the right. */
function routeOf(m, xs, y) {
  const half = PILLAR_WIDTH / 2;
  const from = xs.get(m.from);
  const to = xs.get(m.to);
  if (m.from === m.to) {
    const edge = from + half;
    return [[edge, y, 0], [edge + LOOP_REACH, y, 0], [edge + LOOP_REACH, y - LOOP_DROP, 0], [edge, y - LOOP_DROP, 0]];
  }
  const dir = Math.sign(to - from);
  const [a, b] = [from + dir * half, to - dir * half];
  return [[a, y, 0], [(a + b) / 2, y, 0], [b, y, 0]];
}

/** build(built, spec) -> scene graph v1 for a sequence diagram. `built` is make-diagram's buildDiagram result. */
export function sequenceGraph(built, spec) {
  const { geometry, data } = built;
  const centre = geometry.drawing.x + geometry.drawing.width / 2;
  const names = new Map(Object.entries(data.info).map(([id, entry]) => [id, entry.label]));
  const first = LAST_GAP + (geometry.messages.length - 1) * STEP; // the height of message 0 ("top")
  const height = first + FIRST_GAP;

  const xs = new Map(geometry.participants.map((p) => [p.id, px(p.lifeline.x - centre)]));
  const infos = geometry.participants.map((p) => data.info[p.id]);
  const { groups, indexOf, batches } = kindGroups(infos.map((i) => i.kind));
  const items = [];
  const labels = [];
  const views = [];
  geometry.participants.forEach((p, i) => {
    const info = infos[i];
    const x = xs.get(p.id);
    const group = indexOf.get(info.kind);
    // A pillar is the kind's shape stretched to the height of the conversation (a queue: three slabs).
    const pillar = info.kind === 'queue' ? stack(x, height) : [[x, height / 2, 0, PILLAR_WIDTH, height, PILLAR_WIDTH]];
    for (const inst of pillar) batches[group].instances.push([...inst, i]);
    items.push({ id: `i${i}`, label: oneLine(info.label), group, value: 0, display: displayOf(info) });
    labels.push({ text: oneLine(info.label), at: [x, height + LABEL_RISE, 0], size: PARTICIPANT_LABEL_SIZE });
    views.push([p.id, viewOf([x, height * 0.6, 0], VIEW_DIRECTION, FOCUS_DISTANCE)]);
  });

  const tubes = geometry.messages.map((m, index) => {
    const y = first - index * STEP;
    const route = routeOf(m, xs, y);
    const label = m.label ? oneLine(m.label.text) : '';
    const ends = `${names.get(m.from) ?? m.from} → ${names.get(m.to) ?? m.to}`;
    if (label !== '') {
      const mid = route[Math.floor(route.length / 2)];
      labels.push({ text: label, at: [m.from === m.to ? mid[0] + 1 : mid[0], y + LABEL_RISE, 0], size: MESSAGE_LABEL_SIZE });
    }
    const tube = { id: m.id, points: route, radius: TUBE_RADIUS, colour: colourOfStyle(m.kind), item: null, label: label === '' ? ends : label };
    return label === '' ? tube : { ...tube, display: ends };
  });

  const g = emptyGraph('diagram', { title: spec.title });
  g.groups = groups;
  g.items = items;
  g.batches = batches;
  g.tubes = tubes;
  g.labels = labels;
  g.focus = focusFrom(views, geometry.participants.map((p, i) => [items[i].label, views[i][1]]));
  const done = finalizeGraph(g);
  return finalizeGraph({ ...done, camera: cameraFor(done.bounds, VIEW_DIRECTION) });
}

// A queue pillar: SLABS slabs with a SLAB_GAP between them, sharing the pillar's height.
function stack(x, height) {
  const slab = (height - (SLABS - 1) * SLAB_GAP) / SLABS;
  return Array.from({ length: SLABS }, (_, k) => [x, slab / 2 + k * (slab + SLAB_GAP), 0, PILLAR_WIDTH, slab, PILLAR_WIDTH]);
}
