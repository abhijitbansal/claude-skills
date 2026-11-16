// How the `map` kind draws (map.mjs registers it): the prepared map (scripts/v2/prepare/map.mjs, projected WIDTH units
// wide) scaled into its box, the land whole from frame 0, highlighted areas filling and places' pins with their labels
// (the `label` device, one size) arriving on their times, routes drawing on (the `route` device) once both ends are on,
// the title (desk: a display heading; pop: the look's tag) and the source line. A wide frame puts the title on the left
// columns (desk) or above (pop) and the map beside or under it; a tall frame stacks title, map, and the places listed as
// a column of names that arrive with their pins, so the frame is used. Colours are look data (look.kinds.map). Labels
// that would cover another are left out and the first label says so (props.dropped). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { node } from '../graph/node.mjs';
import { layoutText } from '../text/layout.mjs';
import { gridSpan } from '../looks/index.mjs';
import { colourOf, at2 } from '../devices/shared.mjs';
import { fontFor, sizeAt, isWide, isEditorial, setCase, overlaps, cardOf, tagBox } from './shared.mjs';
import { arrivalTrack, roomOf } from './arrivals.mjs';

const HALF = 2;
const PIN = 11; // units: a pin's radius
const NO_WRAP = 1e6;

// The look's floor for the author's words on this format: its second step on a tall frame, its first on a wide one.
const floorSize = (ctx) => sizeAt(ctx.look, isWide(ctx.canvas) ? 1 : 2, ctx.unit);
const text = (ctx, role, size, words, maxWidth) => {
  const font = fontFor(ctx.look, role, size, ctx.unit);
  return { font, layout: layoutText({ text: setCase(ctx.look, role, words), font, maxWidth, measure: ctx.measure }) };
};

// The desk title: the largest of `steps` that holds it in three lines at three times the labels; null without a title.
function deskTitle(shot, ctx, steps, width) {
  if (shot.title === undefined) return null;
  const sets = [...steps].sort((a, b) => b - a).map((step) => text(ctx, 'display', sizeAt(ctx.look, step, ctx.unit), shot.title, width));
  return sets.find((s) => s.layout.lines.length <= 3 && s.layout.width <= width) ?? sets.at(-1);
}

// The circle of radius r at (x, y) as four cubic quarters (paths here use only M L Q C Z: every number is in a pair).
const BEZIER_CIRCLE = 0.5523;
function disc(x, y, r) {
  const k = BEZIER_CIRCLE * r;
  const c = (c1, c2, to) => `C${at2(c1)} ${at2(c2)} ${at2(to)}`;
  return `M${at2([x, y - r])}${c([x + k, y - r], [x + r, y - k], [x + r, y])}${c([x + r, y + k], [x + k, y + r], [x, y + r])}`
    + `${c([x - k, y + r], [x - r, y + k], [x - r, y])}${c([x - r, y - k], [x - k, y - r], [x, y - r])}Z`;
}

// The map group: the prepared paths scaled by `s` into the box at (x, y); highlights fill on their times.
function mapGroup(shot, ctx, data, { x, y, s }, times) {
  const { look } = ctx;
  const style = ctx.data;
  const land = node('path', `${shot.id}.land`, { d: data.land, fill: colourOf(look, style.land) });
  const lit = data.highlights.map((h, k) => node('path', `${shot.id}.hl${k}`, { d: h.d, fill: colourOf(look, style.highlight), ...(style.multiply ? { blend: 'multiply' } : {}) }, { tracks: { opacity: arrivalTrack(times.highlights[k] ?? 0) } }));
  const borders = node('path', `${shot.id}.borders`, { d: data.borders, stroke: colourOf(look, style.borders), strokeWidth: (style.borderWidth * ctx.unit) / s });
  return node('group', `${shot.id}.map`, { x, y, scale: s }, { children: [land, ...lit, borders] });
}

// Each place: its pin and its label (the label device, at the floor size, kept inside the map box), arriving together;
// a label that would cover one already placed is left out, and the first kept label names the places left out.
function placeNodes(shot, ctx, data, view, times) {
  const { look, unit, seed, measure } = ctx;
  const size = floorSize(ctx);
  const kept = [];
  const dropped = [];
  const nodes = data.places.flatMap((p, i) => {
    const at = times.places[i] ?? 0;
    const [px, py] = [view.x + p.x * view.s, view.y + p.y * view.s];
    const pin = node('path', `${shot.id}.place${i}.pin`, { d: disc(px, py, PIN * unit), fill: colourOf(look, ctx.data.pin) }, { tracks: { opacity: arrivalTrack(at) } });
    const side = sideAwayFromRoutes(data, p);
    const built = registries.devices.get('label').build({ id: `${shot.id}.place${i}`, box: view.box, at, look, unit, seed, measure, text: p.name, anchor: [px, py], size, ...(side ? { side } : {}) });
    if (kept.some((b) => overlaps(b, built.boxes.label))) { dropped.push(`places[${i}].name`); return [pin]; }
    kept.push(built.boxes.label);
    return [pin, ...stepIn(built.nodes, at)];
  });
  return { nodes: noteDropped(nodes, shot, dropped), labels: kept };
}

// The side of a place its label takes so that it keeps off the place's routes: the side away from where they leave
// (left when they mostly leave rightwards); undefined (the label chooses) for a place with no route.
function sideAwayFromRoutes(data, place) {
  const at = new Map(data.places.map((p) => [p.name, p]));
  const away = data.routes.flatMap((r) => (r.from === place.name ? [at.get(r.to)] : r.to === place.name ? [at.get(r.from)] : [])).filter(Boolean);
  if (away.length === 0) return undefined;
  return away.reduce((sum, q) => sum + (q.x - place.x), 0) > 0 ? 'left' : 'right';
}

// The label device fades its text in over the enter move; here every reveal is a step on its time (arrivals.mjs).
const stepIn = (nodes, at) => nodes.map((g) => node(g.type, g.id, g.props, { tracks: g.tracks, children: g.children.map((c) => (c.type === 'text'
  ? node('text', c.id, c.props, { tracks: { opacity: arrivalTrack(at) } }) : c)) }));

function noteDropped(nodes, shot, dropped) {
  if (dropped.length === 0) return nodes;
  const id = nodes.flatMap((n) => [n, ...n.children]).find((n) => n.type === 'text')?.id;
  const mark = (n) => (n.id === id ? node(n.type, n.id, { ...n.props, dropped }, { tracks: n.tracks }) : node(n.type, n.id, n.props, { tracks: n.tracks, children: n.children.map(mark) }));
  return nodes.map(mark);
}

// Each route: the route device through its prepared points, drawing on once both its ends are on.
function routeNodes(shot, ctx, data, view, times) {
  return data.routes.flatMap((r, j) => (r.points.length < HALF ? [] : registries.devices.get('route').build({
    id: `${shot.id}.route${j}`, at: times.routes[j], look: ctx.look, unit: ctx.unit, seed: ctx.seed, points: r.points.map(([x, y]) => [view.x + x * view.s, view.y + y * view.s]),
  }).nodes));
}

// The places as a column of names in the text face under the map (tall frames), each arriving with its pin.
function listNodes(shot, ctx, data, [x, y, w], times) {
  const size = floorSize(ctx);
  let top = y;
  return data.places.map((p, i) => {
    const set = text(ctx, 'text', size, p.name, w);
    const n = node('text', `${shot.id}.list${i}`, { x, y: top, layout: set.layout, font: set.font, fill: ctx.look.palette.ink }, { tracks: { opacity: arrivalTrack(times.places[i] ?? 0) } });
    top += set.layout.height + ctx.data.listGap * ctx.unit;
    return n;
  });
}

// The source line in the label face at the floor size, its top at `y`.
function sourceNode(shot, ctx, x, y) {
  if (shot.source === undefined) return [];
  const set = text(ctx, 'label', floorSize(ctx), shot.source, NO_WRAP);
  return [node('text', `${shot.id}.source`, { x, y, layout: set.layout, font: set.font, fill: ctx.look.palette.ink2 })];
}

// The title nodes and the height they take, at (x, y) within `width`: a display heading (an editorial look) or a tag.
function titleNodes(shot, ctx, x, y, width) {
  if (shot.title === undefined) return { nodes: [], h: 0 };
  if (isEditorial(ctx.look)) {
    const set = deskTitle(shot, ctx, ctx.data.titleSteps, width);
    return { nodes: [node('text', `${shot.id}.title`, { x, y, layout: set.layout, font: set.font, fill: ctx.look.palette.ink, role: 'hero' })], h: set.layout.height };
  }
  const box = tagBox(ctx, `${shot.id}.title`, shot.title, x, y);
  return { nodes: registries.devices.get('tag').build({ id: `${shot.id}.title`, text: shot.title, box: [x, y, 1, 1], at: 0, look: ctx.look, unit: ctx.unit, seed: ctx.seed, measure: ctx.measure }).nodes, h: box[3] };
}

// The map's view: its scale and place inside `area` ({ x, y, w, h }) from the top. A wide frame fits the whole map,
// centred across. A tall frame composes for its height: the map fills the height available (never narrower than the
// area), centred across on its places and highlights (data.extent), and the frame edge crops its sides; `box` is the
// part of the map on screen, which the labels keep inside.
function viewIn(data, area, tall) {
  const s = tall ? Math.max(area.w / data.width, area.h / data.height) : Math.min(area.w / data.width, area.h / data.height);
  const w = data.width * s, h = data.height * s;
  const [ex, , ew] = data.extent;
  const centred = tall ? area.x + area.w / HALF - (ex + ew / HALF) * s : area.x + (area.w - w) / HALF;
  const x = tall ? Math.min(area.x, Math.max(area.x + area.w - w, centred)) : centred; // a tall map always covers the area across
  const y = tall ? area.y : area.y + (area.h - h) / HALF; // a wide frame centres the map in its area
  const shown = tall ? [area.x, y, area.w, h] : [x, y, w, h];
  return { x, y, s, box: shown };
}

/** The map's nodes and boxes for the shot, from its prepared data and arrival times. */
export function mapLayout(shot, ctx, data, times) {
  const { look, canvas, unit } = ctx;
  const room = roomOf(ctx);
  const gap = ctx.data.gap * unit;
  const wide = isWide(canvas);
  const side = wide && isEditorial(look) ? gridSpan(look, canvas, 1, ctx.data.titleTo) : { x: room.x, w: room.w };
  const title = titleNodes(shot, ctx, side.x, room.y, side.w);
  const sourceH = shot.source === undefined ? 0 : floorSize(ctx) * HALF + gap;
  const listH = wide ? 0 : data.places.length * (floorSize(ctx) * look.lineHeight.text + ctx.data.listGap * unit) + gap;
  const beside = wide && isEditorial(look);
  const left = beside ? gridSpan(look, canvas, ctx.data.titleTo + 1, look.grid.columns).x : room.x;
  const top = beside ? room.y : room.y + title.h + (title.h > 0 ? gap : 0);
  const area = { x: left, y: top, w: room.x + room.w - left, h: room.y + room.h - top - sourceH - listH };
  const view = viewIn(data, area, !wide);
  const card = ctx.data.card ? [cardOf(ctx, `${shot.id}.sheet`, [view.box[0] - gap / HALF, view.box[1] - gap / HALF, view.box[2] + gap, view.box[3] + gap], 0)] : [];
  const places = placeNodes(shot, ctx, data, view, times);
  const below = view.box[1] + view.box[3] + gap;
  const list = wide ? [] : listNodes(shot, ctx, data, [room.x, below, room.w], times);
  const listEnd = wide ? below : below + listH;
  return {
    nodes: [...card, mapGroup(shot, ctx, data, view, times), ...routeNodes(shot, ctx, data, view, times), ...places.nodes, ...title.nodes, ...list, ...sourceNode(shot, ctx, view.box[0], listEnd)],
    boxes: { map: view.box, ...Object.fromEntries(data.places.map((p, i) => [`place:${p.name}`, [view.x + p.x * view.s - PIN * unit, view.y + p.y * view.s - PIN * unit, HALF * PIN * unit, HALF * PIN * unit]])) },
  };
}
