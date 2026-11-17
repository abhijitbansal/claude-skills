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
import { colourOf, at2, pathPoints, styleOf } from '../devices/shared.mjs';
import { fontFor, sizeAt, isWide, isEditorial, setCase, overlaps, cardOf, tagBox } from './shared.mjs';
import { arrivalTrack, roomOf, EDITORIAL_WIDE_COLUMN } from './arrivals.mjs';

const HALF = 2;
const PIN = 11; // units: a pin's radius
const NO_WRAP = 1e6;
const STICKER_PAD = 18; // units: the sticker device's own default pad (engine/devices/sticker.mjs)

// The look's reading floor for the map's words, its second step on every format: a place name at the wide frame's first
// step did not read on the phone tile (gate-kinds-b-1).
const READING_STEP = 2;
const floorSize = (ctx) => sizeAt(ctx.look, READING_STEP, ctx.unit);
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
// a label that would cover one already placed is left out, and the first kept label names the places left out. A look
// whose map data says `labelPlate: 'sticker'` sets each name on the sticker device (its own plate), so a name reads on
// the land and on a highlight alike (pop: white on the lime highlight did not read).
function placeNodes(shot, ctx, data, view, times) {
  const { look, unit, seed, measure } = ctx;
  const size = floorSize(ctx);
  const kept = [];
  const dropped = [];
  const areas = data.highlights.map((h) => boxOf(pathPoints(h.d).map(([x, y]) => [view.x + x * view.s, view.y + y * view.s])));
  const trace = routeTrace(data, view, ctx.data.unwrapped === true);
  const pins = data.places.map((q) => pinBox(view.x + q.x * view.s, view.y + q.y * view.s, PIN * unit));
  // a look may set the routes' destinations in another colour (ctx.data.pinTo, ledger: gate-ledger-2 ruling 4, only the
  // origin, a place no route arrives at, in the accent)
  const arrives = new Set(data.routes.map((r) => r.to));
  const pinFill = (p) => colourOf(look, ctx.data.pinTo && arrives.has(p.name) ? ctx.data.pinTo : ctx.data.pin);
  const nodes = data.places.flatMap((p, i) => {
    const at = times.places[i] ?? 0;
    const [px, py] = [view.x + p.x * view.s, view.y + p.y * view.s];
    const pin = node('path', `${shot.id}.place${i}.pin`, { d: disc(px, py, PIN * unit), fill: pinFill(p) }, { tracks: { opacity: arrivalTrack(at) } });
    const label = (side) => {
      const built = registries.devices.get('label').build({ id: `${shot.id}.place${i}`, box: view.box, at, look, unit, seed, measure, text: p.name, anchor: [px, py], size, ...(side ? { side } : {}), ...(ctx.data.labelFace ? { face: ctx.data.labelFace } : {}) });
      return ctx.data.labelPlate === 'sticker' ? onSticker(built, ctx, at) : { nodes: stepIn(built.nodes, at), box: built.boxes.label };
    };
    const plated = keepOff(label, sideAwayFromRoutes(data, p), areas, { trace, boxes: [...pins.filter((_, k) => k !== i), ...kept] });
    if (kept.some((b) => overlaps(b, plated.box))) { dropped.push(`places[${i}].name`); return [pin]; }
    kept.push(plated.box);
    return [pin, ...plated.nodes];
  });
  return { nodes: noteDropped(nodes, shot, dropped), labels: kept };
}

// The label `make(side)` gives on the side that keeps clear of the routes, the other pins and the labels already placed
// (`clear`: { trace, boxes }), and among those covers least of the highlighted areas (a name over the area it is in
// hides the highlight the narration names); the preferred side first, then the label device's own choice, then the
// four sides in turn; ties keep that order.
const SIDES = Object.freeze([undefined, 'right', 'left', 'above', 'below']);
const CLASH = 1e12; // a label on a route, a pin or a label costs more than any highlight it could cover
const CLEARANCE = 4; // units round a label kept free of a route's line
const coverOf = (box, areas) => areas.reduce((sum, a) => sum + Math.max(0, Math.min(box[0] + box[2], a[0] + a[2]) - Math.max(box[0], a[0])) * Math.max(0, Math.min(box[1] + box[3], a[1] + a[3]) - Math.max(box[1], a[1])), 0);
function clashesOf([x, y, w, h], { trace, boxes }) {
  const onRoute = trace.filter(([px, py]) => px > x - CLEARANCE && px < x + w + CLEARANCE && py > y - CLEARANCE && py < y + h + CLEARANCE).length;
  return onRoute + boxes.filter((b) => overlaps(b, [x, y, w, h])).length;
}
function keepOff(make, preferred, areas, clear) {
  const tries = (preferred ? [preferred, ...SIDES] : SIDES).map(make);
  const cost = (t) => CLASH * clashesOf(t.box, clear) + coverOf(t.box, areas);
  return tries.reduce((best, t) => (cost(t) < cost(best) ? t : best));
}

const TRACE_STEPS = 8; // samples between two prepared route points

// Points along every route's prepared line on screen (each part of a clipped route), dense enough that a label box
// cannot sit across a route between two samples.
function routeTrace(data, view, unwrapped = false) {
  const lines = data.routes.flatMap((r) => (r.parts && unwrapped ? [unwrappedPoints(data, r)] : r.parts ?? [r.points]));
  return lines.flatMap((pts) => pts.slice(1).flatMap((q, k) => Array.from({ length: TRACE_STEPS }, (_, s) => {
    const t = s / TRACE_STEPS, p = pts[k];
    return [view.x + (p[0] + (q[0] - p[0]) * t) * view.s, view.y + (p[1] + (q[1] - p[1]) * t) * view.s];
  })).concat(pts.length > 0 ? [[view.x + pts.at(-1)[0] * view.s, view.y + pts.at(-1)[1] * view.s]] : []));
}

function boxOf(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
}

// A label's text moved onto the sticker device over its leader; the sticker arrives as a step on `at` like every reveal
// here (a spring from 0.6 would show the name under the reading floor mid-pop). -> { nodes, box: the sticker's box }.
function onSticker(built, ctx, at) {
  const [group] = built.nodes;
  const drawn = group.children.find((c) => c.type === 'path');
  const leader = node('path', drawn.id, drawn.props, { tracks: { opacity: arrivalTrack(at) } }); // with its pin, as stepIn
  const label = group.children.find((c) => c.type === 'text');
  // moved out from the anchor by the sticker's pad, so the plate keeps the label's gap and the leader shows
  const pad = (styleOf(ctx.look, 'sticker').pad ?? STICKER_PAD) * ctx.unit;
  const [dx, dy] = { right: [pad, 0], left: [-pad, 0], above: [0, -pad], below: [0, pad] }[built.side];
  const [bx, by, bw, bh] = built.boxes.label;
  const words = node('text', label.id, { ...label.props, x: label.props.x + dx, y: label.props.y + dy });
  const made = registries.devices.get('sticker').build({ id: `${group.id}.sticker`, box: [bx + dx, by + dy, bw, bh], at, look: ctx.look, unit: ctx.unit, seed: ctx.seed, children: [words] });
  const [sticker] = made.nodes;
  const landed = node(sticker.type, sticker.id, sticker.props, { children: sticker.children, tracks: { opacity: arrivalTrack(at) } });
  return { nodes: [node('group', group.id, {}, { children: [leader, landed] })], box: made.boxes.sticker };
}

// A tall frame keys its places: each pin is a disc holding the place's number, and the names are listed under the map
// beside the same discs (listNodes), so a name is drawn once. The number is set at the names' size (one size on the
// frame) in the label face; the disc's colours are look data (keyFill, keyText, keyLine).
const KEY_DISC = 0.72; // a key disc's radius, in em of the names' size
function keyDisc(shot, ctx, id, [cx, cy], number, at) {
  const { look, unit } = ctx;
  const size = floorSize(ctx);
  const r = KEY_DISC * size;
  const set = text(ctx, 'label', size, String(number), NO_WRAP);
  const line = ctx.data.keyLine ? { stroke: colourOf(look, ctx.data.keyLine), strokeWidth: ctx.data.keyLineWidth * unit } : {};
  const plate = node('path', `${id}.disc`, { d: disc(cx, cy, r), fill: colourOf(look, ctx.data.keyFill), ...line });
  const num = node('text', `${id}.num`, { x: cx - set.layout.width / HALF, y: cy - set.layout.height / HALF, layout: set.layout, font: set.font, fill: colourOf(look, ctx.data.keyText) });
  return node('group', id, {}, { children: [plate, num], tracks: { opacity: arrivalTrack(at) } });
}

function keyedPlaces(shot, ctx, data, view, times) {
  const nodes = data.places.map((p, i) => keyDisc(shot, ctx, `${shot.id}.key${i}.pin`, [view.x + p.x * view.s, view.y + p.y * view.s], i + 1, times.places[i] ?? 0));
  return { nodes, labels: [] };
}

// The height of one row of the tall frame's key: a disc or a line of the names, the taller, and the gap under it.
const keyRow = (ctx) => Math.max(HALF * KEY_DISC * floorSize(ctx), floorSize(ctx) * ctx.look.lineHeight.text) + ctx.data.listGap * ctx.unit;

// The side of a place its label takes so that it keeps off the place's routes: the side away from where they leave
// (left when they mostly leave rightwards); undefined (the label chooses) for a place with no route.
function sideAwayFromRoutes(data, place) {
  const at = new Map(data.places.map((p) => [p.name, p]));
  const away = data.routes.flatMap((r) => (r.from === place.name ? [at.get(r.to)] : r.to === place.name ? [at.get(r.from)] : [])).filter(Boolean);
  if (away.length === 0) return undefined;
  return away.reduce((sum, q) => sum + (q.x - place.x), 0) > 0 ? 'left' : 'right';
}

// The label device fades its text in over the enter move and draws its leader on before it; here every reveal is a step
// on its time (arrivals.mjs), the leader too, so no leader shows as a stray dash before its pin.
const stepIn = (nodes, at) => nodes.map((g) => node(g.type, g.id, g.props, { tracks: g.tracks, children: g.children.map((c) => (c.type === 'text' || c.type === 'path'
  ? node(c.type, c.id, c.props, { tracks: { opacity: arrivalTrack(at) } }) : c)) }));

function noteDropped(nodes, shot, dropped) {
  if (dropped.length === 0) return nodes;
  const id = nodes.flatMap((n) => [n, ...n.children]).find((n) => n.type === 'text')?.id;
  const mark = (n) => (n.id === id ? node(n.type, n.id, { ...n.props, dropped }, { tracks: n.tracks }) : node(n.type, n.id, n.props, { tracks: n.tracks, children: n.children.map(mark) }));
  return nodes.map(mark);
}

// A route across the antimeridian drawn the long way inside the map (look data `unwrapped`, ledger: gate-ledger-1 ruling
// 2, every route starts and ends on a placed city): a shallow arc in map space from one place to the other, bowed by
// UNWRAP_BOW of the distance between them, UNWRAP_POINTS points along it, north or south, whichever keeps farther from
// every other place (gate-ledger-2 ruling 4: bowed north, Denver to Kyoto ran under Oslo's name); north on a tie.
const UNWRAP_BOW = 0.15;
const UNWRAP_POINTS = 17;
const BOW_SIDES = Object.freeze([1, -1]); // north, then south (map y grows south)
function unwrappedPoints(data, r) {
  const at = new Map(data.places.map((p) => [p.name, [p.x, p.y]]));
  const [a, b] = [at.get(r.from), at.get(r.to)];
  const others = data.places.filter((p) => p.name !== r.from && p.name !== r.to).map((p) => [p.x, p.y]);
  const clearance = (pts) => Math.min(Infinity, ...others.flatMap(([ox, oy]) => pts.map(([x, y]) => Math.hypot(x - ox, y - oy))));
  const arcs = BOW_SIDES.map((side) => bowedArc(a, b, side * UNWRAP_BOW));
  return arcs.reduce((best, arc) => (clearance(arc) > clearance(best) ? arc : best));
}

// A quadratic arc from a to b with its control point `share` of their distance north (negative: south) of the middle.
function bowedArc(a, b, share) {
  const bow = share * Math.hypot(b[0] - a[0], b[1] - a[1]);
  const c = [(a[0] + b[0]) / HALF, (a[1] + b[1]) / HALF - bow];
  return Array.from({ length: UNWRAP_POINTS }, (_, k) => {
    const t = k / (UNWRAP_POINTS - 1), u = 1 - t;
    return [u * u * a[0] + HALF * u * t * c[0] + t * t * b[0], u * u * a[1] + HALF * u * t * c[1] + t * t * b[1]];
  });
}

// Each route: the route device through its prepared points, drawing on once both its ends are on. A route across the
// antimeridian arrives in parts clipped at the map's edges (routePartNodes), or, in a look that keeps routes whole
// (`unwrapped`), as one line the long way inside the map (unwrappedPoints).
function routeNodes(shot, ctx, data, view, times) {
  const onScreen = (points) => points.map(([x, y]) => [view.x + x * view.s, view.y + y * view.s]);
  return data.routes.flatMap((r, j) => {
    const whole = r.parts && ctx.data.unwrapped === true ? unwrappedPoints(data, r) : null;
    if (r.parts && whole === null) return routePartNodes(`${shot.id}.route${j}`, ctx, r.parts.map(onScreen).filter((p) => p.length >= HALF), times.routes[j]);
    const points = whole ?? r.points;
    return points.length < HALF ? [] : registries.devices.get('route').build({
      id: `${shot.id}.route${j}`, at: times.routes[j], look: ctx.look, unit: ctx.unit, seed: ctx.seed, points: onScreen(points),
    }).nodes;
  });
}

const lengthOf = (points) => points.slice(1).reduce((sum, p, k) => sum + Math.hypot(p[0] - points[k][0], p[1] - points[k][1]), 0);

// A route's parts draw one after the other inside the route's own draw (each its share of the time by length), landing
// on `at`; only the route's true ends keep their marks: the first part's start pin, the last part's end pin (desk) or
// arrow head (pop). A clipped end at the map's edge has none.
function routePartNodes(id, ctx, parts, at) {
  if (parts.length === 0) return [];
  const draw = ctx.look.moves.draw;
  const lengths = parts.map(lengthOf);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const last = parts.length - 1;
  const children = parts.map((points, k) => {
    const done = lengths.slice(0, k + 1).reduce((a, b) => a + b, 0);
    const look = { ...ctx.look, moves: { ...ctx.look.moves, draw: { ...draw, dur: (draw.dur * lengths[k]) / total } } };
    const [group] = registries.devices.get('route').build({ id: `${id}.part${k}`, at: at - draw.dur * (1 - done / total), look, unit: ctx.unit, seed: ctx.seed, points }).nodes;
    const kept = group.children.filter((c) => !((c.id.endsWith('.pin0') && k > 0) || (c.id.endsWith('.pin1') && k < last) || (c.id.endsWith('.head') && k < last)));
    return node('group', group.id, group.props, { children: kept, tracks: group.tracks });
  });
  return [node('group', id, {}, { children })];
}

// The places as the key under the map (tall frames): each row the place's numbered disc and its name in the text face,
// arriving with its pin.
function listNodes(shot, ctx, data, [x, y, w], times) {
  const size = floorSize(ctx);
  const r = KEY_DISC * size;
  const row = keyRow(ctx);
  return data.places.map((p, i) => {
    const at = times.places[i] ?? 0;
    const mid = y + i * row + (row - ctx.data.listGap * ctx.unit) / HALF;
    const set = text(ctx, ctx.data.labelFace ?? 'text', size, p.name, w - HALF * r - size); // the labels' face
    const name = node('text', `${shot.id}.list${i}`, { x: x + HALF * r + size / HALF, y: mid - set.layout.height / HALF, layout: set.layout, font: set.font, fill: ctx.look.palette.ink }, { tracks: { opacity: arrivalTrack(at) } });
    return node('group', `${shot.id}.key${i}`, {}, { children: [keyDisc(shot, ctx, `${shot.id}.key${i}.mark`, [x + r, mid], i + 1, at), name] });
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
    // a look may name the steps a wide frame's title takes (data.titleStepsWide, ledger: one line across the top)
    const steps = isWide(ctx.canvas) && ctx.data.titleStepsWide !== undefined ? ctx.data.titleStepsWide : ctx.data.titleSteps;
    const set = deskTitle(shot, ctx, steps, width);
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

const pinBox = (x, y, r) => [x - r, y - r, HALF * r, HALF * r];

/** The map's nodes and boxes for the shot, from its prepared data and arrival times. */
export function mapLayout(shot, ctx, data, times) {
  const { look, canvas, unit } = ctx;
  const room = roomOf(ctx);
  const gap = ctx.data.gap * unit;
  const wide = isWide(canvas);
  // an editorial wide frame sets the title beside the map on columns 2 to `titleTo`, or across the top over a map the
  // full width (data.titleAbove, ledger: beside, a four-word title fell to step 3, under three times the place names,
  // and the map sat small with the lower half empty)
  const beside = wide && isEditorial(look) && ctx.data.titleAbove !== true;
  const side = wide && isEditorial(look) ? gridSpan(look, canvas, EDITORIAL_WIDE_COLUMN, beside ? ctx.data.titleTo : look.grid.columns) : { x: room.x, w: room.w };
  const title = titleNodes(shot, ctx, side.x, room.y, side.w);
  const sourceH = shot.source === undefined ? 0 : floorSize(ctx) * HALF + gap;
  const listH = wide ? 0 : data.places.length * keyRow(ctx) + gap;
  const left = beside ? gridSpan(look, canvas, ctx.data.titleTo + 1, look.grid.columns).x : room.x;
  const top = beside ? room.y : room.y + title.h + (title.h > 0 ? gap : 0);
  const area = { x: left, y: top, w: room.x + room.w - left, h: room.y + room.h - top - sourceH - listH };
  const view = viewIn(data, area, !wide);
  const card = ctx.data.card ? [cardOf(ctx, `${shot.id}.sheet`, [view.box[0] - gap / HALF, view.box[1] - gap / HALF, view.box[2] + gap, view.box[3] + gap], 0)] : [];
  const places = wide ? placeNodes(shot, ctx, data, view, times) : keyedPlaces(shot, ctx, data, view, times);
  const below = view.box[1] + view.box[3] + gap;
  const list = wide ? [] : listNodes(shot, ctx, data, [room.x, below, room.w], times);
  const listEnd = wide ? below : below + listH;
  return {
    nodes: [...card, mapGroup(shot, ctx, data, view, times), ...routeNodes(shot, ctx, data, view, times), ...places.nodes, ...title.nodes, ...list, ...sourceNode(shot, ctx, view.box[0], listEnd)],
    boxes: { map: view.box, ...Object.fromEntries(data.places.map((p, i) => [`place:${p.name}`, pinBox(view.x + p.x * view.s, view.y + p.y * view.s, wide ? PIN * unit : KEY_DISC * floorSize(ctx))])) },
  };
}
