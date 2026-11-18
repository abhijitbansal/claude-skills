// The `diagram` kind: two to seven nodes joined by edges in one of four designed layouts (`row`, `column`, `cycle`, `hub`;
// default a row on a wide frame and a column on a tall one), with a title and a highlighted node. No general graph layout:
// a diagram that needs one is make-diagram's. The first node is whole on frame 0; a node arrives on the word that names
// its label, else one per sentence, else evenly; an edge draws on once both its ends are on, its label landing with the
// head. Events: `node`. `on` targets: `node:<id>` and `edge:<n>` (n counts edges from 0, as edges[n]). How each look
// composes it is look data (look.kinds.diagram; diagram-draw.mjs). Its review: labels that cannot fit at the look's floor
// in the layout, estimated from look data (kinds.diagram.advance) as the page is not there. Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems, supportsKind } from '../looks/index.mjs';
import { didYouMean } from '../../shared/errors.mjs';
import { HERO_SCHEMA, fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks, unionBox, isWide, sizeAt } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { landBy, namedTimes, latestLanding, editorialLeft } from './arrivals.mjs';
import { diagramLayout, floorStep, titleSteps } from './diagram-draw.mjs';
import { fitDiagram } from './diagram-layout.mjs';
import { unmarked } from './shared.mjs';

const KIND = 'diagram';
const EDGE_LAG = 0.4; // s after both ends are on that an edge has drawn
const MIN_CYCLE = 3;
const LABEL_MAX = 24;
const EDGE_LABEL_MAX = 16;
const TITLE_MAX = 60;
const HALF = 2;

/** When the nodes, edges and the highlight arrive, and when each node is lit ([from, to)), in shot seconds. `open`
 *  (look data openNodes, poster): the first `open` nodes are on from frame 0, and an edge between two of them too. */
export function arrivals(shot, timing, open = 1) {
  // `spoken`: when each node's label is said; the nodes that open on frame 0 are still lit when they are spoken
  const spoken = namedTimes(shot.nodes.map((n) => n.label), timing);
  const nodes = spoken.map((t, k) => (k < open ? 0 : t));
  const at = new Map(shot.nodes.map((n, k) => [n.id, nodes[k]]));
  const edgeAt = (ends) => (open > 1 && ends <= 0 ? 0 : landBy(ends + EDGE_LAG, timing));
  const edges = (shot.edges ?? []).map((e) => edgeAt(Math.max(at.get(e.from) ?? 0, at.get(e.to) ?? 0)));
  const built = Math.max(...nodes, ...edges);
  const highlight = shot.highlight === undefined ? null : Math.min(latestLanding(timing), Math.max(built, at.get(shot.highlight) ?? 0));
  const lit = spoken.map((said, k) => {
    // a node that is on from frame 0 is lit from its first spoken moment, not from frame 0 (the first is lit on 0)
    const from = k === 0 ? nodes[k] : said;
    if (shot.highlight === shot.nodes[k].id && highlight !== null) return [from, Infinity];
    const next = Math.min(...spoken.filter((t, j) => j !== k && t > said), highlight ?? Infinity);
    return [from, next];
  });
  return { nodes, edges, highlight, lit };
}

const idsOf = (shot) => (shot.nodes ?? []).map((n) => n.id);
const listed = (shot) => `(nodes: ${idsOf(shot).join(', ')})`;

function noNode(shot, path, name) {
  const hint = didYouMean(name, idsOf(shot));
  return { path, message: `no node "${name}"${hint ? `; did you mean "${hint}"?` : ''} ${listed(shot)}` };
}

function nodeProblems(shot) {
  const first = new Map();
  return (shot.nodes ?? []).flatMap((n, i) => {
    if (first.has(n.id)) return [{ path: `nodes.${i}.id`, message: `"${n.id}" is already the id of nodes[${first.get(n.id)}]` }];
    first.set(n.id, i);
    return [];
  });
}

function edgeProblems(shot) {
  const ids = idsOf(shot);
  return (shot.edges ?? []).flatMap((e, j) => {
    if (e.from === e.to) return [{ path: `edges.${j}`, message: 'an edge from a node to itself' }];
    return ['from', 'to'].filter((end) => !ids.includes(e[end])).map((end) => noNode(shot, `edges.${j}.${end}`, e[end]));
  });
}

function diagramProblems(shot, { look } = {}) {
  const cycle = shot.layout === 'cycle' && (shot.nodes ?? []).length < MIN_CYCLE ? [{ path: 'layout', message: `a cycle needs at least ${MIN_CYCLE} nodes` }] : [];
  const hl = shot.highlight !== undefined && !idsOf(shot).includes(shot.highlight) ? [noNode(shot, 'highlight', shot.highlight)] : [];
  return [...kindSupportProblems(KIND, look), ...nodeProblems(shot), ...edgeProblems(shot), ...cycle, ...hl];
}

// An estimate of the page's measure from the look's average advance (em per character), for the review.
const estimate = (advance) => (text, font) => {
  const width = [...text].length * font.size * advance;
  return { width, ascent: font.size * 0.8, descent: font.size * 0.2, inkAscent: font.size * 0.74, inkDescent: 0, inkLeft: 0, inkRight: width };
};

// The review's room: the canvas inside the look's margins (a look with a band on 9:16: the band), less a title row.
function reviewArea(shot, look, canvas, data, unit) {
  const margin = look.grid.margin * unit;
  const band = !isWide(canvas) && look.band ? [look.band.top * canvas.h, look.band.bottom * canvas.h] : [margin, canvas.h - margin];
  const title = shot.title === undefined ? 0 : sizeAt(look, Math.max(...titleSteps(data, canvas)), unit) * HALF + data.titleGap * unit;
  const left = editorialLeft(look, canvas, unit); // the kind's room (arrivals.mjs roomOf)
  return { x: left, y: band[0] + title, w: canvas.w - HALF * left, h: band[1] - band[0] - title };
}

// Labels that do not fit at the look's floor in the layout: a finding at the longest node label.
function diagramReview(shot, { look, canvas } = {}) {
  if (!look || !canvas || !supportsKind(look, KIND) || !Array.isArray(shot.nodes)) return [];
  const data = kindData(look, KIND);
  const unit = Math.min(canvas.w, canvas.h) / 1080;
  const layout = shot.layout ?? (isWide(canvas) ? 'row' : 'column');
  const env = { look, data, unit, layout, area: reviewArea(shot, look, canvas, data, unit), measure: estimate(data.advance), steps: [floorStep(canvas)], floorStep: floorStep(canvas), maxSize: Infinity };
  if (fitDiagram(shot, env).fits) return [];
  const i = shot.nodes.reduce((best, n, k) => (n.label.length > shot.nodes[best].label.length ? k : best), 0);
  const format = isWide(canvas) ? '16:9' : '9:16';
  return [{ path: `nodes[${i}].label`, at: 0, message: `at ${format} in the ${look.name} look the ${shot.nodes.length} node labels do not fit a ${layout}; shorten nodes[${i}].label (${shot.nodes[i].label.length} characters), use fewer nodes or another layout` }];
}

function expandDiagram(shot, ctx) {
  assertNoBlanks(shot, KIND);
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
  const laid = diagramLayout(shot, { ...ctx, data }, arrivals(shot, timing, data.openNodes));
  const boxes = { diagram: unionBox(shot.nodes.map((n) => laid.boxes[`node:${n.id}`])), ...laid.boxes };
  const devices = onDevices(shot, ctx, { boxes, defaultTarget: 'diagram' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...laid.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes, hero: `${shot.id}.node0`, background: look.palette.paper,
  };
}

// The field a node shows: a node's label, an edge label, an edge (its line and head), the title.
function diagramField(shot, id) {
  const rest = id.startsWith(`${shot.id}.`) ? id.slice(shot.id.length + 1) : null;
  if (rest === null) return undefined;
  if (/^title(\.|$)/.test(rest)) return 'title';
  const part = /^(node|edge|label)(\d+)/.exec(rest);
  if (!part) return undefined;
  if (part[1] === 'node') return /\.(card|sticker|lit)(\.|$)/.test(rest) && !rest.endsWith('.label') ? null : 'nodes';
  if (part[1] === 'label') return rest.endsWith('.plate') ? null : 'edges';
  return 'edges';
}

const NODE = { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: HERO_SCHEMA, label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX } } };
const EDGE = { type: 'object', additionalProperties: false, required: ['from', 'to'], properties: { from: { type: 'string', minLength: 1, pattern: NOT_BLANK }, to: { type: 'string', minLength: 1, pattern: NOT_BLANK }, label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: EDGE_LABEL_MAX } } };

registries.kinds.add(KIND, {
  summary: 'Two to seven labelled nodes joined by arrows in a row, a column, a cycle or a hub, each node arriving on the word that names it and each arrow drawing on once both its ends are there. Four designed layouts, no general graph layout (make-diagram draws those).',
  example: {
    id: 'flow', show: KIND, say: 'A client asks the cache, and the database answers.',
    nodes: [{ id: 'client', label: 'Client' }, { id: 'cache', label: 'Cache' }, { id: 'db', label: 'Database' }],
    edges: [{ from: 'client', to: 'cache' }, { from: 'cache', to: 'db' }],
  },
  schema: {
    required: ['nodes'],
    properties: {
      nodes: { type: 'array', minItems: 2, maxItems: 7, items: NODE },
      edges: { type: 'array', maxItems: 8, items: EDGE },
      layout: { enum: ['row', 'column', 'cycle', 'hub'] },
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      highlight: HERO_SCHEMA,
    },
  },
  srcFields: [],
  steeringFields: ['layout', 'highlight'],
  heroTarget: 'diagram',
  targets: (shot) => ['diagram', ...idsOf(shot).map((id) => `node:${id}`), ...(shot.edges ?? []).map((_, j) => `edge:${j}`)],
  ids: (shot) => [`${shot.id}.node0`],
  nodeField: diagramField,
  validate: diagramProblems,
  review: diagramReview,
  expand: (shot, ctx) => expandDiagram(unmarked(shot), ctx),
  arrivals,
  eventDevices: Object.freeze(['node']),
  events: (shot, timing) => arrivals(shot, timing).nodes.slice(1).map((t) => ({ kind: 'device', device: 'node', t })),
  lookData: true,
  numbered: false,
  showsWords: false,
});
