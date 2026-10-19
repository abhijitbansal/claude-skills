// line, area, scatter and bubble: each colour is a lane along z. A line is a tube ribbon through its
// points (an area's ribbon is 1.6 times as thick: no translucent surface), with a sphere marker on every
// point so each value is hoverable. Scatter and bubble are spheres only; a bubble's area follows its size.
import { displayValue, groupColour } from '../lib/palette.mjs';
import { orderOf } from './dashboard-data.mjs';
import { WIDTH, focusCollector, frameOf, lanesOf, legendOf, slotsOf, valueAxis } from './dashboard-frame.mjs';

export const LINE_RADIUS = 0.06;
export const AREA_RADIUS = LINE_RADIUS * 1.6;
const LINE_MARKER = 0.24;
const AREA_MARKER = 0.3;
const SCATTER_MARKER = 0.35;
const BUBBLE_MAX = 1.5;
const BUBBLE_MIN = 0.12;
const MIN_SEGMENT = 0.01; // a spline through two coincident points is NaN: routes never repeat a point

const sphereBatch = (g) => ({ id: `b${g}`, shape: 'sphere', colour: groupColour(g), emissive: null, flat: false, instances: [] });
const extent = (values) => [Math.min(0, ...values), Math.max(0, ...values)];
const apart = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > MIN_SEGMENT;
const withoutRepeats = (route) => route.reduce((run, spot) => (run.length === 0 || apart(spot, run.at(-1)) ? [...run, spot] : run), []);

/** The series of a chart: one per colour, or one named for the y column. */
const seriesOf = (model) => {
  const names = model.roles.color === undefined ? [model.roles.y] : model.groupNames;
  const index = new Map(names.map((n, i) => [n, i]));
  return { names, of: (p) => (model.roles.color === undefined ? 0 : index.get(p.color)) };
};

// One point as an item and a sphere; the focus places it under its colour and its label.
function place(ctx, g, p, idx, at, diameter, label, display) {
  const { batches, items, focus } = ctx;
  batches[g].instances.push([...at, diameter, diameter, diameter, idx]);
  items.push({ id: `i${idx}`, label, group: g, value: p.y, display });
  if (ctx.hasColour) focus.colour.add(p.color, at);
  focus.item.add(label, at);
}

function partOf(ctx, frame, categories) {
  const { names, batches, items, focus } = ctx;
  return {
    groups: legendOf(names),
    items,
    batches: [...batches, ...frame.batches],
    tubes: ctx.tubes ?? [],
    surfaces: [],
    labels: frame.labels,
    focus: [focus.x.entries(), focus.colour.entries(), focus.item.entries()],
    categories,
  };
}

const startContext = (model) => {
  const { names, of } = seriesOf(model);
  return { names, of, hasColour: model.roles.color !== undefined, batches: names.map((_, g) => sphereBatch(g)), items: [], focus: { x: focusCollector(), colour: focusCollector(), item: focusCollector() } };
};

/** The part for a line or area chart. */
export function linesPart(model, { units, niceStep }) {
  const { roles, points } = model;
  const ctx = startContext(model);
  const area = model.kind === 'area';
  const xs = orderOf(points.map((p) => p.x), model.xTemporal);
  const xIndex = new Map(xs.map((x, i) => [x, i]));
  const { at } = slotsOf(xs.length);
  const lane = lanesOf(ctx.names.length);
  const axis = valueAxis(...extent(points.map((p) => p.y)), niceStep);
  const routes = ctx.names.map(() => []);
  points.forEach((p, idx) => {
    const g = ctx.of(p);
    const spot = [at(xIndex.get(p.x)), p.y * axis.k, lane.z(g)];
    routes[g].push({ xi: xIndex.get(p.x), spot });
    const label = ctx.hasColour ? `${p.x} · ${p.color}` : p.x;
    place(ctx, g, p, idx, spot, area ? AREA_MARKER : LINE_MARKER, label, displayValue(p.y, units));
    ctx.focus.x.add(p.x, spot);
  });
  ctx.tubes = routes.flatMap((route, g) => {
    const run = withoutRepeats(route.sort((a, b) => a.xi - b.xi).map((r) => r.spot));
    return run.length < 2 ? [] : [{ id: `t${g}`, points: run, radius: area ? AREA_RADIUS : LINE_RADIUS, colour: groupColour(g), item: null, label: ctx.names[g] }];
  });
  const frame = frameOf({
    axis, depth: lane.depth, xTicks: xs.map((text, i) => ({ text, x: at(i) })),
    titles: { x: roles.x, y: roles.y, lane: ctx.hasColour ? roles.color : undefined },
    laneNames: ctx.hasColour ? ctx.names : [], lane, firstBatch: ctx.names.length,
  });
  return partOf(ctx, frame, { x: true, color: ctx.hasColour });
}

/** The part for a scatter or bubble chart: x and y on numeric axes from zero, a sphere per row. */
export function scatterPart(model, { units, niceStep }) {
  const { roles, points } = model;
  const ctx = startContext(model);
  const bubble = model.kind === 'bubble';
  const lane = lanesOf(ctx.names.length);
  const axisY = valueAxis(...extent(points.map((p) => p.y)), niceStep);
  const axisX = valueAxis(...extent(points.map((p) => p.x)), niceStep);
  const xAt = (v) => -WIDTH / 2 + ((v - axisX.lo) / (axisX.hi - axisX.lo)) * WIDTH;
  const biggest = Math.max(0, ...points.map((p) => p.size ?? 0));
  const across = (p) => (bubble ? (p.size > 0 ? Math.max(BUBBLE_MIN, BUBBLE_MAX * Math.sqrt(p.size / biggest)) : BUBBLE_MIN) : SCATTER_MARKER);
  points.forEach((p, idx) => {
    const spot = [xAt(p.x), p.y * axisY.k, lane.z(ctx.of(p))];
    const sized = bubble ? ` · ${roles.size} ${displayValue(p.size, '')}` : '';
    const display = `${roles.x} ${displayValue(p.x, '')} · ${roles.y} ${displayValue(p.y, units)}${sized}`;
    place(ctx, ctx.of(p), p, idx, spot, across(p), ctx.hasColour ? p.color : `${roles.x} ${displayValue(p.x, '')}`, display);
  });
  const frame = frameOf({
    axis: axisY, depth: lane.depth, xTicks: axisX.ticks.map((v) => ({ text: displayValue(v, ''), x: xAt(v) })),
    titles: { x: roles.x, y: roles.y, lane: ctx.hasColour ? roles.color : undefined },
    laneNames: ctx.hasColour ? ctx.names : [], lane, firstBatch: ctx.names.length,
  });
  return partOf(ctx, frame, { x: false, color: ctx.hasColour });
}
