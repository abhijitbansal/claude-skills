// What every lifted chart shares: the plot box, the value axis, the floor and gridlines, axis labels, and the
// focus views. The plot is WIDTH along x, HEIGHT above the floor along y, and its series stand in lanes along z.
// y = 0 is the floor and every height scale starts there; negative values hang below it.
import { displayValue, groupColour } from '../lib/palette.mjs';
import { focusFrom, viewOf } from './diagram-parts.mjs';

export const WIDTH = 12;
export const HEIGHT = 6;
export const VIEW_DIRECTION = [0.3, 0.75, 1];
export const MIN_MARK = 0.05; // a zero (or tiny) value is still a visible marker this tall

const LANE_PITCH = 1.6;
const LANE_SPAN = 9; // a plot never grows deeper than this, however many series
const MIN_DEPTH = 2.4;
const TICK_TARGET = 5;
const FLOOR_THICKNESS = 0.1;
const FLOOR_MARGIN = 1;
const RULE = 0.03; // gridline thickness
const FRAME_RULE = 0.05;
const TICK_LABEL = 0.45;
const TITLE_LABEL = 0.55;
const MAX_X_LABELS = 12;
const TICK_GAP = 1; // value tick labels sit this far left of the plot
const TITLE_GAP = 2.2; // the x title sits this far in front of it
const VIEW_MIN = 9;
const VIEW_PER_UNIT = 1.3;
const VIEW_MARGIN = 5;

const clean = (v) => Number(v.toFixed(10));

/** The lanes of a plot with `count` series: { depth, z(i), pitch }. One series sits at z = 0. */
export function lanesOf(count) {
  const pitch = Math.min(LANE_PITCH, LANE_SPAN / Math.max(1, count));
  return { pitch, depth: Math.max(MIN_DEPTH, count * pitch), z: (i) => (i - (count - 1) / 2) * pitch };
}

/**
 * A value axis over the data range [lo, hi] (the range includes 0): nice ticks, and `k`, the world height of
 * one unit. The same k serves above and below the floor. `integer` keeps the ticks on whole numbers (counts).
 */
export function valueAxis(lo, hi, niceStep, { integer = false } = {}) {
  const low = Math.min(0, lo);
  const high = Math.max(0, hi);
  const nice = high - low > 0 ? niceStep((high - low) / TICK_TARGET) : 1;
  const step = integer ? Math.max(1, nice) : nice;
  const top = clean(Math.ceil(high / step) * step);
  const bottom = clean(Math.floor(low / step) * step);
  const reach = Math.max(top, -bottom, step);
  const ticks = [];
  for (let v = bottom; v <= top + step / 2; v = clean(v + step)) ticks.push(v);
  return { lo: bottom, hi: top === bottom ? bottom + step : top, step, ticks, k: HEIGHT / reach, negative: bottom < 0 };
}

/** Evenly spaced slots along x: { slot, at(i) } for `n` categories. */
export function slotsOf(n) {
  const slot = WIDTH / Math.max(1, n);
  return { slot, at: (i) => -WIDTH / 2 + (i + 0.5) * slot };
}

/** The legend: one entry per group name, coloured by position. */
export const legendOf = (names) => names.map((name, i) => ({ name, colour: groupColour(i) }));

// Every n-th tick so labels stay readable; the data is all in the items and the table.
export function thinned(ticks) {
  const stride = Math.ceil(ticks.length / MAX_X_LABELS);
  return ticks.filter((_, i) => i % stride === 0);
}

const rule = (x, y, z, w, h, d) => [x, y, z, w, h, d, -1];

/**
 * The floor, the gridlines on the back wall and every label of the plot, as { batches, labels }.
 * `xTicks` is [{ text, x }] along the front edge; `laneNames` label the lanes on the right.
 */
export function frameOf({ axis, depth, xTicks, titles, laneNames = [], lane, firstBatch, floor = true }) {
  const back = -depth / 2;
  const rules = axis.ticks.filter((v) => v !== 0).map((v) => rule(0, v * axis.k, back, WIDTH, RULE, RULE));
  const zero = axis.negative
    ? [rule(0, 0, back, WIDTH, FRAME_RULE, FRAME_RULE), rule(0, 0, -back, WIDTH, FRAME_RULE, FRAME_RULE), rule(-WIDTH / 2, 0, 0, FRAME_RULE, FRAME_RULE, depth), rule(WIDTH / 2, 0, 0, FRAME_RULE, FRAME_RULE, depth)]
    : [];
  const slab = floor && !axis.negative ? [[0, -FLOOR_THICKNESS / 2, 0, WIDTH + FLOOR_MARGIN, FLOOR_THICKNESS, depth + FLOOR_MARGIN, -1]] : [];
  const batches = [
    { id: `b${firstBatch}`, shape: 'box', colour: 'line', emissive: null, flat: false, instances: [...slab, ...zero] },
    { id: `b${firstBatch + 1}`, shape: 'box', colour: 'grid', emissive: null, flat: false, instances: rules },
  ].filter((b) => b.instances.length > 0);
  const labels = [
    ...axis.ticks.map((v) => ({ text: displayValue(v, ''), at: [-WIDTH / 2 - TICK_GAP, v * axis.k, back], size: TICK_LABEL })),
    ...thinned(xTicks).map((t) => ({ text: t.text, at: [t.x, 0.05, depth / 2 + 0.7], size: TICK_LABEL })),
    ...laneNames.map((text, i) => ({ text, at: [WIDTH / 2 + 1, 0.1, lane.z(i)], size: TICK_LABEL })),
  ];
  if (titles.y) labels.push({ text: titles.y, at: [-WIDTH / 2 - TICK_GAP, HEIGHT + 0.8, back], size: TITLE_LABEL });
  if (titles.x) labels.push({ text: titles.x, at: [0, 0.05, depth / 2 + TITLE_GAP], size: TITLE_LABEL });
  if (titles.lane) labels.push({ text: titles.lane, at: [WIDTH / 2 + 1, 0.1, back - 0.9], size: TITLE_LABEL });
  return { batches, labels };
}

/**
 * Focus views by key. `add(key, position)` records a position under a key (several positions share one
 * view: their centre, from a distance that takes in their spread); `entries()` gives [key, view] pairs.
 */
export function focusCollector() {
  const places = new Map();
  return {
    add(key, position) {
      if (key === '' || key === undefined) return;
      places.set(key, [...(places.get(key) ?? []), position]);
    },
    entries() {
      return [...places].map(([key, ps]) => {
        const mid = [0, 1, 2].map((a) => ps.reduce((s, p) => s + p[a], 0) / ps.length);
        const spread = Math.max(...[0, 1, 2].map((a) => Math.max(...ps.map((p) => p[a])) - Math.min(...ps.map((p) => p[a]))));
        return [key, viewOf(mid, VIEW_DIRECTION, Math.max(VIEW_MIN, VIEW_PER_UNIT * spread + VIEW_MARGIN))];
      });
    },
  };
}

/** The graph's focus: x values first, then colours, then item labels; the first view of a key wins. */
export const focusOf = (...lists) => focusFrom(lists.flat(), []);
