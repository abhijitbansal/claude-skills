// The `chart` kind: a claim (`title`) shown with its evidence, a bar, column, line, area or donut chart of at most 12
// marks or 3 series. Direct labels, never a legend; no gridlines beyond the baseline and at most three light reference
// lines; one accent, for the highlighted mark, and everything else in ink or dimmed; numerals in fixed advances. The
// marks grow or draw over the first sentence and the highlighted one turns accent, the rest dimming, on the word that
// names it (chart-time.mjs). An editorial composition (desk) heads it with the claim in the serif and a source line
// under it (chart-desk.mjs); a stack (pop) tags the claim and punches the highlighted value as a numeral (chart-pop.mjs).
// Its honesty rules are mechanical review findings of its own (`review`): a donut of 2 to 6 non-negative values, a line
// of at least 2 points, finite values, a donut total above 0, and no bar or area point below a baseline that is not 0;
// such a baseline (bar, column, area only) always shows a broken-axis mark and a label saying it. How each look composes
// it is look data (look.kinds.chart). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { HERO_SCHEMA, heroId, isEditorial, heroProblems, fieldNode, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks, sizeAt } from './shared.mjs';
import { defaultCamera } from './camera.mjs';
import { chartData } from './chart-marks.mjs';
import { valueDecimals } from './chart-draw.mjs';
import { valueText } from './chart-scale.mjs';
import { VALUE_SCHEMA, showsAsZero, zeroMessage } from './values.mjs';
import { chartLanding } from './chart-time.mjs';
import { expandDeskChart } from './chart-desk.mjs';
import { expandPopChart } from './chart-pop.mjs';
import { SCATTER_MAX, scatterNames, scatterProblems, scatterHonesty, scatterPlainLabels, scatterField } from './chart-scatter.mjs';
import { TOP_MAX, raceNames, raceProblems, raceHonesty, raceField, raceLanding } from './chart-race.mjs';
import { unmarked } from './shared.mjs';

// The marks `on` events may target (mark:<i>): items, series, a scatter's points or a race's rows.
const marksOf = (shot) => {
  if (shot.type === 'scatter') return Array.isArray(shot.data) ? shot.data : [];
  if (shot.type === 'race') return Array.isArray(shot.data?.rows) ? shot.data.rows : [];
  return chartData(shot)[CATEGORICAL.includes(shot.type) ? 'items' : 'series'];
};

const KIND = 'chart';
const TYPES = Object.freeze(['bar', 'column', 'line', 'area', 'donut', 'scatter', 'race']);
const OWN_TYPES = Object.freeze(['scatter', 'race']); // the types with their own data, rules and drawing (chart-scatter.mjs, chart-race.mjs)
const AXIS_NAME_MAX = 24;
const PERIOD_MAX = 12;
const PERIODS = Object.freeze({ min: 2, max: 12 });
const ROWS = Object.freeze({ min: 2, max: 8 });
const TOP_MIN = 2;
const CATEGORICAL = Object.freeze(['bar', 'column', 'donut']);
const BASELINE_TYPES = Object.freeze(['bar', 'column', 'area']); // the types drawn from a baseline
const MARKS_MAX = 12;
const SERIES_MAX = 3;
const POINTS_MAX = 24;
const LABEL_MAX = 24;
const X_MAX = 12;
const TITLE_MAX = 90;
const UNIT_MAX = 4;
const VALUE_LABEL_MAX = 24;
const SOURCE_MAX = 60;
const DONUT_MIN = 2;
const DONUT_MAX = 6;
const POINTS_MIN = 2;
const FULL_PERCENT = 100;
const PERCENT_SLACK = 1; // shares that were rounded before they were typed may miss 100 by this much
const MECHANICAL = 'mechanical';

const POINT = Object.freeze({
  type: 'object', required: ['x', 'y'], additionalProperties: false,
  properties: { x: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: X_MAX }] }, y: VALUE_SCHEMA },
});
const ITEM = Object.freeze({
  type: 'object', required: ['label', 'value'], additionalProperties: false,
  properties: { label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX }, value: VALUE_SCHEMA },
});
const SERIES = Object.freeze({
  type: 'object', required: ['name', 'points'], additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX }, points: { type: 'array', minItems: 1, maxItems: POINTS_MAX, items: POINT } },
});
const ITEMS = Object.freeze({ type: 'array', minItems: 1, maxItems: MARKS_MAX, items: ITEM });
const POINTS = Object.freeze({ type: 'array', minItems: 1, maxItems: POINTS_MAX, items: POINT });
const SERIES_SET = Object.freeze({ type: 'object', required: ['series'], additionalProperties: false, properties: { series: { type: 'array', minItems: 1, maxItems: SERIES_MAX, items: SERIES } } });
// The data's shape is picked by the chart's type (and, for a line or area, by array against object), never tried
// against every shape: an error then comes from the one shape the type reads (errors.mjs drops the `if` keyword itself).
const DATA = Object.freeze({ type: ['array', 'object'] });
const typeIs = (types) => ({ required: ['type'], properties: { type: { enum: types } } });
const SCATTER_POINT = Object.freeze({
  type: 'object', required: ['x', 'y'], additionalProperties: false,
  properties: { x: VALUE_SCHEMA, y: VALUE_SCHEMA, label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX } },
});
const RACE_DATA = Object.freeze({
  type: 'object', required: ['periods', 'rows'], additionalProperties: false,
  properties: {
    periods: { type: 'array', minItems: PERIODS.min, maxItems: PERIODS.max, items: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: PERIOD_MAX } },
    rows: { type: 'array', minItems: ROWS.min, maxItems: ROWS.max, items: { type: 'object', required: ['name', 'values'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX }, values: { type: 'array', minItems: 1, maxItems: PERIODS.max, items: VALUE_SCHEMA } } } },
  },
});
const DATA_BY_TYPE = Object.freeze([
  { if: typeIs(CATEGORICAL), then: { properties: { data: ITEMS } } },
  { if: typeIs(['line', 'area']), then: { properties: { data: { if: { type: 'array' }, then: POINTS, else: SERIES_SET } } } },
  // two axes need names
  // (a data of the other shape passes here, so the kind's rule says which shape the type reads: chartProblems)
  { if: typeIs(['scatter']), then: { required: ['xLabel', 'yLabel'], properties: { data: { if: { type: 'array' }, then: { minItems: 1, maxItems: SCATTER_MAX, items: { if: { required: ['x'] }, then: SCATTER_POINT } } } } } },
  { if: typeIs(['race']), then: { properties: { data: { if: { type: 'object' }, then: RACE_DATA } } } },
]);

const isItems = (data) => Array.isArray(data) && data.every((d) => d !== null && typeof d === 'object' && 'label' in d);
const markNames = (shot) => {
  const data = chartData(shot);
  return data.items ? data.items.map((i) => i.key) : data.series.map((s) => s.name).filter((n) => n !== null);
};

// A scatter's data is points with numeric x and y; a race's is { periods, rows }.
const isScatter = (data) => Array.isArray(data) && data.every((d) => d !== null && typeof d === 'object' && 'x' in d && 'y' in d && !('label' in d && 'value' in d));
const isRace = (data) => data !== null && typeof data === 'object' && !Array.isArray(data) && 'periods' in data && 'rows' in data;
const OWN_SHAPES = Object.freeze({ scatter: { test: isScatter, shape: '[{ x, y, label? }]' }, race: { test: isRace, shape: '{ periods, rows }' } });
// Fields only some types read: refused on the others, so a field is never silently ignored.
const TYPE_FIELDS = Object.freeze({ xLabel: ['scatter'], yLabel: ['scatter'], top: ['race'], valueLabel: ['race'], unit: ['bar', 'column', 'line', 'area', 'donut', 'race'] });

// The input rules of a scatter or a race: its shape, its own rules, a highlight naming a mark, its fields.
function ownProblems(shot, look) {
  const { test, shape } = OWN_SHAPES[shot.type];
  if (!test(shot.data)) return [...heroProblems(shot), { path: 'data', message: `a ${shot.type} chart reads its data as ${shape}` }, ...kindSupportProblems(KIND, look)];
  const names = shot.type === 'scatter' ? scatterNames(shot) : raceNames(shot);
  const highlight = shot.highlight === undefined || names.includes(shot.highlight) ? [] : [{
    path: 'highlight', message: names.length === 0 ? 'there is no labelled point to highlight: label it, or leave highlight out' : `highlight names no ${shot.type === 'scatter' ? 'labelled point' : 'row'}; they are: ${names.join(', ')}`,
  }];
  const top = shot.type === 'race' && shot.top !== undefined && shot.top > raceNames(shot).length ? [{ path: 'top', message: `top ${shot.top} is more than the ${raceNames(shot).length} rows` }] : [];
  return [...heroProblems(shot), ...highlight, ...top, ...(shot.type === 'scatter' ? scatterProblems(shot) : raceProblems(shot)), ...kindSupportProblems(KIND, look)];
}

const typeFieldProblems = (shot) => Object.entries(TYPE_FIELDS).filter(([f, types]) => shot[f] !== undefined && !types.includes(shot.type))
  .map(([f, types]) => ({ path: f, message: `only a ${types.join(' or ')} chart takes ${f}; a ${shot.type} chart does not: leave it out` }));

// The input rules: data of the shape its type reads, and a highlight that names a mark.
function chartProblems(shot, { look } = {}) {
  if (OWN_TYPES.includes(shot.type)) return [...ownProblems(shot, look), ...typeFieldProblems(shot)];
  if (typeFieldProblems(shot).length > 0) return [...typeFieldProblems(shot), ...kindSupportProblems(KIND, look)];
  const categorical = CATEGORICAL.includes(shot.type);
  if (categorical !== isItems(shot.data)) {
    const shape = categorical ? '[{ label, value }]' : '[{ x, y }] or { series: [{ name, points }] }';
    return [...heroProblems(shot), { path: 'data', message: `a ${shot.type} chart reads its data as ${shape}` }, ...kindSupportProblems(KIND, look)];
  }
  const names = markNames(shot);
  const highlight = shot.highlight === undefined || names.includes(shot.highlight) ? [] : [{
    path: 'highlight',
    message: names.length === 0 ? 'there is no named mark to highlight: name the series, or leave highlight out' : `highlight names no mark; the marks are: ${names.join(', ')}`,
  }];
  const own = [...baselineProblems(shot), ...valueProblems(shot), ...orderProblems(shot), ...duplicateProblems(shot)];
  return [...heroProblems(shot), ...highlight, ...own, ...kindSupportProblems(KIND, look)];
}

// `baseline` only on the types drawn from it: a line fits its values and a donut has no axis.
function baselineProblems(shot) {
  if (shot.baseline === undefined || BASELINE_TYPES.includes(shot.type)) return [];
  return [{ path: 'baseline', message: `a ${shot.type} chart has no baseline to move: only ${BASELINE_TYPES.join(', ')} charts take one; leave it out` }];
}

// Where series i's points sit in the shot, for an error's path.
const pointsPath = (shot, i) => (Array.isArray(shot.data) ? 'data' : `data.series[${i}].points`);

// No value labelled 0 that is not 0, at the decimals the chart shows its values with (as compare refuses it).
function valueProblems(shot) {
  const data = chartData(shot);
  const hint = 'say the scale in the title or the unit';
  const check = (value, decimals, path) => {
    const text = valueText(value, decimals);
    return showsAsZero(value, text) ? [{ path, message: zeroMessage(value, text, hint) }] : [];
  };
  if (data.items) {
    const decimals = valueDecimals(data.items.map((i) => i.value));
    return data.items.flatMap((it, i) => check(it.value, decimals, `data[${i}].value`));
  }
  const decimals = valueDecimals(data.series.flatMap((s) => s.points.map((p) => p.y)));
  return data.series.flatMap((s, i) => s.points.flatMap((p, k) => check(p.y, decimals, `${pointsPath(shot, i)}[${k}].y`)));
}

// A line's numeric x rises from point to point (a line drawn in the order given would double back).
function orderProblems(shot) {
  const data = chartData(shot);
  if (!data.series) return [];
  return data.series.flatMap((s, i) => {
    if (!s.points.every((p) => typeof p.x === 'number')) return [];
    const back = s.points.findIndex((p, k) => k > 0 && p.x <= s.points[k - 1].x);
    if (back < 0) return [];
    const [prev, x] = [s.points[back - 1].x, s.points[back].x];
    return [{ path: `${pointsPath(shot, i)}[${back}].x`, message: `the points of a line run left to right: ${x} comes after ${prev}; sort them by x` }];
  });
}

// Each mark its own label, each series its own name (a highlight names one of them).
function duplicateProblems(shot) {
  const data = chartData(shot);
  const names = data.items ? data.items.map((i) => i.key) : data.series.map((s) => s.name);
  const at = (i) => (data.items ? `data[${i}].label` : `data.series[${i}].name`);
  return names.flatMap((name, i) => {
    const first = names.indexOf(name);
    return name === null || first === i ? [] : [{ path: at(i), message: `"${name}" is already the name of ${at(first)}: each mark needs its own` }];
  });
}

// The honesty rules, as mechanical findings at the field to fix (review.mjs kindFindings).
function honesty(shot) {
  if (shot.type === 'scatter') return [...scatterHonesty(shot), ...scatterPlainLabels(shot)];
  if (shot.type === 'race') return raceHonesty(shot);
  const finding = (path, message) => ({ kind: MECHANICAL, path, at: 0, message });
  const data = chartData(shot);
  const out = [];
  if (data.items) {
    data.items.forEach((it, i) => { if (!Number.isFinite(it.value)) out.push(finding(`data[${i}].value`, 'a chart value must be a finite number')); });
    if (shot.type === 'donut') {
      if (data.items.length < DONUT_MIN || data.items.length > DONUT_MAX) out.push(finding('data', `a donut needs 2 to 6 values, it has ${data.items.length}: use a bar chart for more, a number for one`));
      data.items.forEach((it, i) => { if (it.value < 0) out.push(finding(`data[${i}].value`, 'a donut value cannot be negative: a share of a whole is 0 or more')); });
      const total = data.items.reduce((sum, it) => sum + (Number.isFinite(it.value) && it.value > 0 ? it.value : 0), 0);
      if (total === 0) out.push(finding('data', 'a donut needs a total above 0: every value is 0, so there is no share to show'));
      const sum = data.items.reduce((s, it) => s + (Number.isFinite(it.value) ? it.value : 0), 0);
      if (shot.unit === '%' && total > 0 && Math.abs(sum - FULL_PERCENT) > PERCENT_SLACK) out.push(finding('data', `a donut in % shows shares of a whole, but these add up to ${sum}: make them add up to 100, or drop the % unit`));
    }
    const baseline = shot.baseline ?? 0;
    if (baseline !== 0 && (shot.type === 'bar' || shot.type === 'column')) {
      data.items.forEach((it, i) => { if (it.value < baseline) out.push(finding(`data[${i}].value`, `${it.value} is below the baseline ${baseline}: its bar would read as a loss; set the baseline at or under every value`)); });
    }
    return out;
  }
  const many = Array.isArray(shot.data) ? null : 'data.series';
  data.series.forEach((s, i) => {
    const at = many === null ? 'data' : `${many}[${i}].points`;
    if (s.points.length < POINTS_MIN) out.push(finding(at, `a line needs at least 2 points to show a change; this one has ${s.points.length}`));
    s.points.forEach((p, k) => { if (!Number.isFinite(p.y)) out.push(finding(`${at}[${k}].y`, 'a chart value must be a finite number')); });
    // an area's fill is its magnitude, as a bar's length is: a point under a baseline that is not 0 would be flattened onto it
    const baseline = shot.baseline ?? 0;
    if (shot.type === 'area' && baseline !== 0) {
      s.points.forEach((p, k) => { if (p.y < baseline) out.push(finding(`${at}[${k}].y`, `${p.y} is below the baseline ${baseline}: the area would flatten it onto the baseline; set the baseline at or under every value`)); });
    }
  });
  return out;
}

// The field a node shows, for a review finding's path: null for a text the chart computes (a tick), undefined for
// anything that is not the chart's.
function chartField(shot, id) {
  const own = (name) => id === `${shot.id}.${name}` || id.startsWith(`${shot.id}.${name}.`);
  for (const name of ['title', 'source', 'baseline']) if (own(name)) return name;
  if (OWN_TYPES.includes(shot.type) && id.startsWith(`${shot.id}.`) && !/\.on\d/.test(id) && !id.startsWith(`${shot.id}.captions`)) {
    const rest = id.slice(shot.id.length + 1);
    return shot.type === 'scatter' ? scatterField(shot, rest) : raceField(shot, rest);
  }
  if (own('numeral')) return numeralField(shot);
  const x = id.match(new RegExp(`^${shot.id.replace(/[-]/g, '\\-')}\\.x\\.(\\d+)$`));
  if (x !== null) return xField(shot, Number(x[1]));
  const indexed = id.match(new RegExp(`^${shot.id.replace(/[-]/g, '\\-')}\\.(label|value|series|tick)\\.(\\d+)$`));
  const foreign = !id.startsWith(`${shot.id}.`) || id.startsWith(`${shot.id}.captions`) || /\.on\d/.test(id);
  if (indexed === null) return foreign ? undefined : null;
  const [, part, k] = indexed;
  if (part === 'tick' || (part === 'value' && !Array.isArray(shot.data))) return null;
  if (part === 'value' && (shot.type === 'line' || shot.type === 'area')) return null;
  if (part === 'series') return Array.isArray(shot.data) ? null : `data.series[${k}].name`;
  return `data[${k}].${part}`;
}

// The pop numeral shows the highlighted value: an item's value, or a series' last point.
function numeralField(shot) {
  const data = chartData(shot);
  if (data.items) {
    const k = data.items.findIndex((i) => i.key === shot.highlight);
    return k < 0 ? null : `data[${k}].value`;
  }
  const i = data.series.findIndex((s) => s.name === shot.highlight);
  return i < 0 ? null : `${pointsPath(shot, i)}[${data.series[i].points.length - 1}].y`;
}

// A line's x label k (in axis order, as lineMarks orders them) shows the first point with that x.
function xField(shot, k) {
  const data = chartData(shot);
  if (!data.series) return null;
  const all = data.series.flatMap((s) => s.points.map((p) => p.x));
  const numeric = all.length > 0 && all.every((v) => typeof v === 'number');
  const order = numeric ? [...new Set(all)].sort((a, b) => a - b) : [...new Set(all.map(String))];
  const i = data.series.findIndex((s) => s.points.some((p) => String(p.x) === String(order[k])));
  return i < 0 ? null : `${pointsPath(shot, i)}[${data.series[i].points.findIndex((p) => String(p.x) === String(order[k]))}].x`;
}

// A scatter's or a race's labels (axis names, point labels, row names, values) carry the author's words, so they are
// set at the format's reading floor at least (the second step at 9:16, the first at 16:9; pop's chart labels are the
// first step everywhere), and the claim stays three times them. The first-wave types keep their approved sizes.
function readableData(shot, ctx, data) {
  if (!OWN_TYPES.includes(shot.type)) return data;
  const { look, unit, canvas } = ctx;
  const floorStep = canvas.w > canvas.h ? 1 : 2;
  const set = sizeAt(look, data.labelStep, unit) * (canvas.w > canvas.h ? data.labelScale ?? 1 : 1);
  return set >= sizeAt(look, floorStep, unit) - 1e-9 ? data : { ...data, labelStep: floorStep, labelScale: 1 };
}

function expandChart(shot, ctx) {
  assertNoBlanks(shot, 'chart'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit } = ctx;
  const data = readableData(shot, ctx, kindData(look, KIND));
  const hero = heroId(shot, 'chart');
  const built = isEditorial(look) ? expandDeskChart(shot, ctx, data, hero) : expandPopChart(shot, ctx, data, hero);
  const devices = onDevices(shot, ctx, { boxes: built.boxes, defaultTarget: 'chart' });
  return {
    nodes: placeDevices([fieldNode(shot, ctx), ...built.nodes], devices),
    camera: [...defaultCamera(look, timing, unit), ...deviceCamera(devices)],
    boxes: built.boxes,
    hero,
    background: look.palette.paper,
  };
}

registries.kinds.add(KIND, {
  summary: 'A claim and its evidence: a bar, column, line, area or donut chart of up to 12 marks or 3 series, a scatter of up to 40 points on two named axes, or a race of ranked bars over up to 12 periods, labelled directly, with one highlighted mark that turns accent on the word that names it. The claim heads it in the serif with a source line (desk), or rides as a tag over big marks with the highlighted value punched as a numeral (pop).',
  example: {
    id: 'growth', show: 'chart', type: 'column', title: 'Q3 carried the year', say: 'Sales rose every quarter. Q3 carried the year.',
    data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }], highlight: 'Q3', source: 'Sales ledger, 2026',
  },
  schema: {
    required: ['type', 'data', 'title'],
    allOf: DATA_BY_TYPE,
    properties: {
      type: { enum: [...TYPES] },
      data: DATA,
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      unit: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: UNIT_MAX },
      highlight: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX },
      baseline: { type: 'number' },
      source: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: SOURCE_MAX },
      xLabel: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: AXIS_NAME_MAX },
      yLabel: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: AXIS_NAME_MAX },
      top: { type: 'integer', minimum: TOP_MIN, maximum: TOP_MAX },
      // a race's measure, said once beside its period ("orders to date" for a running total)
      valueLabel: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: VALUE_LABEL_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'chart',
  targets: (shot) => ['chart', 'title', ...marksOf(shot).map((_, i) => `mark:${i}`)],
  ids: (shot) => [heroId(shot, 'chart')],
  nodeField: chartField,
  validate: chartProblems,
  review: honesty,
  // the highlighted value landing (else the marks grown), a race's last period: the cue plan's land event
  landing: (shot, timing) => (shot.type === 'race' ? raceLanding(shot, timing) : chartLanding(shot, timing)),
  // how the rest is drawn, not texts of their own: the type, the highlighted mark, which rows a race shows
  steeringFields: ['type', 'highlight', 'top'],
  expand: (shot, ctx) => expandChart(unmarked(shot), ctx),
  lookData: true, // a look ships it only with a kinds.chart entry (engine/looks/index.mjs listedKinds)
  numbered: false, // its claim is its own heading: no slug
  showsWords: false, // its narration is not its picture: captioned (engine/captions)
});
