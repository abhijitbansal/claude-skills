// How the `diagram` kind draws (diagram.mjs registers it, diagram-layout.mjs places it): each node a paper card (a look
// whose data says `card`, desk) or a sticker (pop), its label in the display face; each edge a line that draws on with
// the look's draw move and a head that lands with it; each edge label on a small plate on its arrow, in the text face at
// the nodes' size (one size on the frame). A look whose data says `current` lights the node being spoken in the accent
// (an accent plate over the sticker's, the words turned to the field colour) until the next arrives; a highlight dims the
// other nodes to `dim` once the diagram is built (desk) or keeps the highlighted node lit (pop). Every reveal is a step on
// its time (arrivals.mjs). The title: a display heading three times the labels (desk) or the look's tag (pop). Pure.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { track } from '../time/track.mjs';
import { layoutText } from '../text/layout.mjs';
import { colourOf, polyline, landing, isHand } from '../devices/shared.mjs';
import { fontFor, sizeAt, isWide, isEditorial, setCase, cardOf, rectPath } from './shared.mjs';
import { roomOf } from './arrivals.mjs';
import { plainTag } from './plain-tag.mjs';
import { fitDiagram, edgeRoutes, labelPlates } from './diagram-layout.mjs';

const HALF = 2;
const HERO_RATIO = 3; // the title holds three times the labels (the frame review's hero rule)
const TITLE_LINES = 3;
const HEAD_ANGLE = Math.PI / 6;

// The look's floor step for the author's words: its second on a tall frame, its first on a wide one.
export const floorStep = (canvas) => (isWide(canvas) ? 1 : HALF);

/** Is the title the display heading (not the look's tag) on this frame by look data (`titleWide: 'display'`)? */
export const displayTitle = (data, canvas) => data.titleWide === 'display' && isWide(canvas);

/** The steps the title is tried at: data.titleWideSteps for a display title on a wide frame, else data.titleSteps. */
export const titleSteps = (data, canvas) => (displayTitle(data, canvas) ? data.titleWideSteps ?? data.titleSteps : data.titleSteps);

// Every node whose index is under `open` (data.openNodes, poster) is on from the first frame, and so is every edge
// between two of them, drawn whole: the shot opens on a composed chain, not a lone card (gate-poster-1 ruling 1).
const opensDrawn = (at) => at <= 0;

// Opacity: hidden until `at` (shown from the start at 0), then dimmed to `dim` from `dimAt` (null: never dimmed).
function presence(at, dimAt, dim) {
  const keys = at <= 0 ? [{ t: 0, v: 1 }] : [{ t: 0, v: 0 }, { t: at, v: 0 }, { t: at, v: 1 }];
  return track(dimAt === null ? keys : [...keys, { t: dimAt, v: 1 }, { t: dimAt, v: dim }]);
}

// A value that is `on` inside [from, to) and `off` outside it, as step keys.
function windowed(from, to, off, on) {
  const keys = from <= 0 ? [{ t: 0, v: on }] : [{ t: 0, v: off }, { t: from, v: off }, { t: from, v: on }];
  return track(to === Infinity ? keys : [...keys, { t: to, v: on }, { t: to, v: off }]);
}

// The desk title: the largest of `steps` that holds in TITLE_LINES lines within `width`; null without a title.
function deskTitle(shot, ctx, width) {
  if (shot.title === undefined) return null;
  const sets = [...titleSteps(ctx.data, ctx.canvas)].sort((a, b) => b - a).map((step) => {
    const font = fontFor(ctx.look, 'display', sizeAt(ctx.look, step, ctx.unit), ctx.unit);
    return { font, layout: layoutText({ text: setCase(ctx.look, 'display', shot.title), font, maxWidth: width, measure: ctx.measure }) };
  });
  return sets.find((s) => s.layout.lines.length <= TITLE_LINES && s.layout.width <= width) ?? sets.at(-1);
}

// The title's nodes, the height it takes and the largest label size it allows (Infinity for a tag).
function titleOf(shot, ctx, room) {
  if (shot.title === undefined) return { nodes: [], h: 0, maxSize: Infinity };
  // a look whose data sets `titleWide: 'display'` (poster, gate-poster-1 ruling 1) takes the display heading on a wide
  // frame too: the title the hero in the display capitals, the labels at most a third of it
  if (isEditorial(ctx.look) || displayTitle(ctx.data, ctx.canvas)) {
    const set = deskTitle(shot, ctx, room.w);
    return { nodes: [node('text', `${shot.id}.title`, { x: room.x, y: room.y, layout: set.layout, font: set.font, fill: ctx.look.palette.ink, role: 'hero' })], h: set.layout.height, maxSize: set.font.size / HERO_RATIO };
  }
  // the look's tag colours at the largest of titleSteps that holds it on a line, down to the floor, then wrapped: the
  // tag device's fixed size ran past a tall frame's safe width with a long title
  const style = ctx.look.devices.tag ?? {};
  const made = plainTag(ctx, `${shot.id}.title`, shot.title, { left: room.x, top: room.y, maxWidth: room.w, at: 0, fromStep: floorStep(ctx.canvas), toStep: Math.max(...ctx.data.titleSteps), fill: style.fill ?? 'ink', text: style.text ?? 'paper', snap: true });
  return { nodes: made.nodes, h: made.box[3], maxSize: Infinity };
}

// A label text centred in `box`, with word fill tracks when it changes colour (the current node in pop).
function labelText(id, layout, font, box, fill, wordFill) {
  const words = layout.lines.flatMap((l) => l.words);
  const props = { x: box[0] + (box[2] - layout.width) / HALF, y: box[1] + (box[3] - layout.height) / HALF, layout, font, fill };
  return node('text', id, props, wordFill ? { wordTracks: words.map(() => ({ fill: wordFill })) } : {});
}

// One node: a card or a sticker holding its label, shown on its time, dimmed or lit as the look says.
function nodeOf(shot, ctx, fit, k, t) {
  const { look, unit, data } = ctx;
  const id = `${shot.id}.node${k}`;
  const box = fit.boxes[k];
  const dimAt = data.current || t.highlight === null || shot.nodes[k].id === shot.highlight ? null : t.highlight;
  const lit = data.current ? t.lit[k] : null;
  const ink = colourOf(look, data.text), onAccent = data.current ? colourOf(look, data.litText) : ink;
  const text = labelText(`${id}.label`, fit.nodes[k], fit.nodeFont, box, ink, lit ? windowed(lit[0], lit[1], ink, onAccent) : null);
  const tracks = { opacity: presence(t.nodes[k], dimAt, data.dim) };
  if (data.card) return node('group', id, {}, { tracks, children: [cardOf(ctx, `${id}.card`, box, 0), text] });
  const pad = data.pad * unit;
  const made = registries.devices.get('sticker').build({ id: `${id}.sticker`, box: [box[0] + pad, box[1] + pad, box[2] - HALF * pad, box[3] - HALF * pad], at: 0, look, unit, seed: ctx.seed, children: [text] });
  const [sticker] = made.nodes;
  const [plate, ...rest] = sticker.children;
  const accent = lit ? [node('path', `${id}.lit`, { d: plate.props.d, fill: colourOf(look, data.litFill) }, { tracks: { opacity: windowed(lit[0], lit[1], 0, 1) } })] : [];
  return node('group', id, {}, { tracks, children: [node('group', sticker.id, sticker.props, { children: [plate, ...accent, ...rest] })] });
}

// One edge: its line drawing on to `at` and its head landing then, aimed along the last leg.
function edgeOf(shot, ctx, route, j, at) {
  const { look, unit, data } = ctx;
  const colour = colourOf(look, data.arrow), width = data.arrowWidth * unit;
  const step = isHand(look) ? look.moves.draw.step : undefined;
  const draw = opensDrawn(at) ? track([{ t: 0, v: 1 }]) : landing(at, look.moves.draw, 0, 1, step);
  const line = node('path', `${shot.id}.edge${j}.line`, { d: route.d, stroke: colour, strokeWidth: width, lineCap: 'round' }, { tracks: { draw }, step });
  const from = route.control ?? route.from, tip = route.to;
  const heading = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const len = data.head * unit;
  const barb = (s) => [tip[0] + Math.cos(heading + Math.PI + s * HEAD_ANGLE) * len, tip[1] + Math.sin(heading + Math.PI + s * HEAD_ANGLE) * len];
  const head = node('path', `${shot.id}.edge${j}.head`, { d: polyline([barb(-1), tip, barb(1)]), stroke: colour, strokeWidth: width, lineCap: 'round' }, { tracks: { opacity: presence(at, null, 1) } });
  return node('group', `${shot.id}.edge${j}`, {}, { children: [line, head] });
}

// One edge label: its plate in the field colour and its words in the text face, shown with its edge's head.
function edgeLabelOf(shot, ctx, fit, plate, j, at) {
  const p = ctx.data.platePad * ctx.unit;
  const bg = node('path', `${shot.id}.label${j}.plate`, { d: rectPath(plate[2], plate[3]), x: plate[0], y: plate[1], fill: colourOf(ctx.look, ctx.data.plate) });
  const words = node('text', `${shot.id}.label${j}.text`, { x: plate[0] + p, y: plate[1] + p, layout: fit.edges[j], font: fit.edgeFont, fill: colourOf(ctx.look, ctx.data.edgeText) });
  return node('group', `${shot.id}.label${j}`, {}, { tracks: { opacity: presence(at, null, 1) }, children: [bg, words] });
}

/** The diagram's area, fit, nodes and boxes for the shot and its arrival times `t` ({ nodes, edges, highlight, lit }). */
export function diagramLayout(shot, ctx, t) {
  const room = roomOf(ctx);
  const title = titleOf(shot, ctx, room);
  const top = room.y + title.h + (title.h > 0 ? ctx.data.titleGap * ctx.unit : 0);
  const area = { x: room.x, y: top, w: room.w, h: room.y + room.h - top };
  const layout = shot.layout ?? (isWide(ctx.canvas) ? 'row' : 'column');
  const fit = fitDiagram(shot, { look: ctx.look, data: ctx.data, area, unit: ctx.unit, measure: ctx.measure, layout, steps: ctx.data.steps, floorStep: floorStep(ctx.canvas), maxSize: title.maxSize });
  const routes = edgeRoutes(shot, fit.boxes, ctx.data.margin * ctx.unit);
  const plates = labelPlates(routes, fit.edges, fit.boxes, ctx.data.platePad * ctx.unit, area);
  const dropped = (shot.edges ?? []).flatMap((e, j) => (e.label !== undefined && plates[j] === null ? [`edges[${j}].label`] : []));
  const nodes = shot.nodes.map((_, k) => nodeOf(shot, ctx, fit, k, t));
  const marked = dropped.length === 0 ? nodes : [markDropped(nodes[0], dropped), ...nodes.slice(1)];
  const edges = routes.map((r, j) => edgeOf(shot, ctx, r, j, t.edges[j]));
  const labels = plates.flatMap((p, j) => (p ? [edgeLabelOf(shot, ctx, fit, p, j, t.edges[j])] : []));
  const boxes = {
    ...Object.fromEntries(shot.nodes.map((n, k) => [`node:${n.id}`, fit.boxes[k]])),
    ...Object.fromEntries(routes.map((r, j) => [`edge:${j}`, boxOfPoints([r.from, r.to, ...(r.control ? [r.control] : [])])])),
    ...Object.fromEntries(plates.flatMap((p, j) => (p ? [[`label:${j}`, p]] : []))),
  };
  return { nodes: [...edges, ...marked, ...labels, ...title.nodes], boxes, fit, layout };
}

// The first node's label carries the edge labels left out (the frame review's "left out its ..." finding).
function markDropped(group, dropped) {
  const mark = (n) => (n.type === 'text' ? node('text', n.id, { ...n.props, dropped }, { tracks: n.tracks, wordTracks: n.wordTracks }) : node(n.type, n.id, n.props, { tracks: n.tracks, children: n.children.map(mark) }));
  return mark(group);
}

function boxOfPoints(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}
