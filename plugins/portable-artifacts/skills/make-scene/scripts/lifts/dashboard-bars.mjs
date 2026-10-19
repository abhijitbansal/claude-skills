// bar, stacked-bar, grouped-bar and histogram as box towers. Towers rise from the floor (y = 0) in
// proportion to the value, or hang below it for a negative one. Stacked bars stack in one column (positive
// values up from 0, negative down); grouped bars stand in one lane per colour; a histogram is a row of
// touching towers, one per bin. Rows that share a tower's place (the same x, and for grouped bars the same
// colour) stack there, each its own item, as the 2D chart adds them up: no row hides behind another.
import { displayValue, groupColour } from '../lib/palette.mjs';
import { orderOf } from './dashboard-data.mjs';
import { AxisError, MIN_MARK, WIDTH, clean, focusCollector, frameOf, lanesOf, legendOf, slotsOf, valueAxis } from './dashboard-frame.mjs';

const MAX_TOWER = 1.4;
const TOWER_SHARE = 0.7; // of its slot
const BIN_SHARE = 0.94;
const BIN_DEPTH = 1.2;
const LANE_FILL = 0.8;
const MAX_BINS = 20; // as the dashboard's own histogram
const BIN_EPSILON = 1e-9;
const MAX_BIN_COUNT = 100; // a hard stop: nice steps give at most 22 bins
const FLAT_SHARE = 1e-14; // values this close together, relative to their size (a few dozen ULPs), are one value plus float noise

const emptyBatch = (id, colour) => ({ id, shape: 'box', colour, emissive: null, flat: false, instances: [] });

// A tower on y = 0 (or hanging from it); `base` is where a stacked segment starts.
function tower(x, z, w, d, height, base = 0) {
  const length = Math.max(Math.abs(height), MIN_MARK);
  return { box: [x, height < 0 ? base - length / 2 : base + length / 2, z, w, length, d], top: height < 0 ? base - length : base + length };
}

// The tower a row belongs to: its x column, and for grouped bars its colour lane too.
const columnOf = (kind, p) => (kind === 'grouped-bar' ? `${p.x}\u0000${p.color}` : p.x);

// [lo, hi] of what the towers reach: rows in one column add up, positive and negative apart.
function reach(model) {
  const up = new Map();
  const down = new Map();
  for (const p of model.points) {
    const sums = p.y >= 0 ? up : down;
    const key = columnOf(model.kind, p);
    sums.set(key, (sums.get(key) ?? 0) + p.y);
  }
  return [Math.min(0, ...down.values()), Math.max(0, ...up.values())];
}

/** The part for a bar, stacked-bar or grouped-bar chart. */
export function barsPart(model, { units, niceStep }) {
  const { kind, roles, points } = model;
  const xs = orderOf(points.map((p) => p.x), model.xTemporal);
  const xIndex = new Map(xs.map((x, i) => [x, i]));
  const { slot, at } = slotsOf(xs.length);
  const names = roles.color === undefined ? [roles.y] : model.groupNames;
  const groupOf = new Map(names.map((n, i) => [n, i]));
  const grouped = kind === 'grouped-bar';
  const lane = lanesOf(grouped ? names.length : 1);
  const axis = valueAxis(...reach(model), niceStep);
  const w = Math.min(MAX_TOWER, slot * TOWER_SHARE);
  const d = grouped ? Math.max(0.2, lane.pitch * LANE_FILL) : w;
  const batches = names.map((_, g) => emptyBatch(`b${g}`, groupColour(g)));
  const groupAt = (p) => (roles.color === undefined ? 0 : groupOf.get(p.color));
  // Stacked as the 2D chart stacks: the last colour from the floor up (Vega-Lite sorts a stack descending by colour),
  // rows of one colour in row order. Rows that share a column and colour add up in that order.
  const stack = new Map();
  const bases = new Array(points.length);
  points.map((_, idx) => idx).sort((a, b) => groupAt(points[b]) - groupAt(points[a]) || a - b).forEach((idx) => {
    const p = points[idx];
    const column = columnOf(kind, p);
    const sums = stack.get(column) ?? { up: 0, down: 0 };
    bases[idx] = p.y >= 0 ? sums.up : sums.down;
    const height = p.y * axis.k;
    if (p.y !== 0) stack.set(column, p.y >= 0 ? { ...sums, up: sums.up + height } : { ...sums, down: sums.down + height });
  });
  const [xFocus, colourFocus, itemFocus] = [focusCollector(), focusCollector(), focusCollector()];
  const items = points.map((p, idx) => {
    const g = groupAt(p);
    const x = at(xIndex.get(p.x));
    const z = lane.z(grouped ? g : 0);
    const { box } = tower(x, z, w, d, p.y * axis.k, bases[idx]);
    batches[g].instances.push([...box, idx]);
    const label = roles.color === undefined ? p.x : `${p.x} · ${p.color}`;
    const place = [x, box[1], z];
    xFocus.add(p.x, place);
    if (roles.color !== undefined) colourFocus.add(p.color, place);
    itemFocus.add(label, place);
    return { id: `i${idx}`, label, group: g, value: p.y, display: displayValue(p.y, units) };
  });
  const frame = frameOf({
    axis,
    depth: lane.depth,
    xTicks: xs.map((text, i) => ({ text, x: at(i) })),
    titles: { x: roles.x, y: roles.y, lane: grouped ? roles.color : undefined },
    laneNames: grouped ? names : [],
    lane,
    firstBatch: names.length,
  });
  return {
    groups: legendOf(names), items, batches: [...batches, ...frame.batches], tubes: [], surfaces: [], labels: frame.labels,
    focus: [xFocus.entries(), colourFocus.entries(), itemFocus.entries()],
    categories: { x: true, color: roles.color !== undefined },
  };
}

// The histogram's bins: nice edges, at most MAX_BINS of them, counting the rows in each. Values that differ by
// float noise only (a spread under FLAT_SHARE of their size: a few dozen ULPs, so a real spread such as 1e13 + 50 x i still bins) are one bin; every row is counted in a valid bin.
function binned(values, niceStep) {
  if (values.length === 0) return { start: 0, step: 1, counts: [] };
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const range = max - min;
  const scale = Math.max(Math.abs(min), Math.abs(max));
  if (!Number.isFinite(range)) throw new AxisError(`the values run from ${min} to ${max}, which is too wide to bin; scale them in SQL`);
  const flat = range <= scale * FLAT_SHARE;
  const step = niceStep(flat ? scale / MAX_BINS || 1 / MAX_BINS : range / MAX_BINS);
  if (!(step > 0) || !Number.isFinite(step)) throw new AxisError(`the values run from ${min} to ${max}, which is too small or too large to bin; scale them in SQL`);
  let start = clean(Math.floor(min / step) * step);
  if (flat && max >= start + step) start = min; // the noise straddles an edge: keep it in one bin
  const wanted = flat ? 1 : Math.floor((max - start) / step + BIN_EPSILON) + 1;
  if (wanted > MAX_BIN_COUNT) throw new AxisError(`the values need ${wanted} bins; the limit is ${MAX_BIN_COUNT}; scale them in SQL`);
  if (!Number.isFinite(start + wanted * step)) throw new AxisError(`the values run from ${min} to ${max}, which is too large to bin; scale them in SQL`);
  const counts = new Array(wanted).fill(0);
  for (const v of values) counts[Math.min(wanted - 1, Math.max(0, Math.floor((v - start) / step + BIN_EPSILON)))] += 1;
  return { start, step, counts };
}

/** The part for a histogram: one tower per bin, its value the row count. */
export function histogramPart(model, { niceStep }) {
  const { start, step, counts } = binned(model.points.map((p) => p.value), niceStep);
  const { slot, at } = slotsOf(counts.length);
  const axis = valueAxis(0, Math.max(0, ...counts), niceStep, { integer: true });
  const edge = (j) => clean(start + j * step);
  const edges = Array.from({ length: counts.length + 1 }, (_, j) => displayValue(edge(j), ''));
  if (counts.length > 0 && edges.some((text, j) => j > 0 && text === edges[j - 1])) throw new AxisError('the values are too close together to label their bins; scale them in SQL');
  const lane = lanesOf(1);
  const batch = emptyBatch('b0', groupColour(0));
  const itemFocus = focusCollector();
  const items = counts.map((count, j) => {
    const { box } = tower(at(j), 0, slot * BIN_SHARE, BIN_DEPTH, count * axis.k);
    batch.instances.push([...box, j]);
    const label = `${edges[j]} – ${edges[j + 1]}`;
    itemFocus.add(label, [at(j), box[1], 0]);
    return { id: `i${j}`, label, group: 0, value: count, display: `${count} ${count === 1 ? 'row' : 'rows'}` };
  });
  const frame = frameOf({
    axis,
    depth: lane.depth,
    xTicks: edges.map((text, j) => ({ text, x: -WIDTH / 2 + j * slot })),
    titles: { x: model.roles.value, y: 'count' },
    lane,
    firstBatch: 1,
  });
  return {
    groups: legendOf(['count']), items, batches: [batch, ...frame.batches], tubes: [], surfaces: [], labels: frame.labels,
    focus: [itemFocus.entries()],
    categories: { x: false, color: false },
  };
}
