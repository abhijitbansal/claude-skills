// The `chart` kind: a claim (`title`) shown with its evidence, a bar, column, line, area or donut chart of at most 12
// marks or 3 series. Direct labels, never a legend; no gridlines beyond the baseline and at most three light reference
// lines; one accent, for the highlighted mark, and everything else in ink or dimmed; numerals in fixed advances. The
// marks grow or draw over the first sentence and the highlighted one turns accent, the rest dimming, on the word that
// names it (chart-time.mjs). An editorial composition (desk) heads it with the claim in the serif and a source line
// under it (chart-desk.mjs); a stack (pop) tags the claim and punches the highlighted value as a numeral (chart-pop.mjs).
// Its honesty rules are mechanical review findings of its own (`review`): a donut of 2 to 6 non-negative values, a line
// of at least 2 points, finite values, and no bar below a baseline that is not 0; such a baseline always shows a
// broken-axis mark and a label saying it. How each look composes it is look data (look.kinds.chart). Pure and DOM-free.
import { registries } from '../registry.mjs';
import { kindData, kindSupportProblems } from '../looks/index.mjs';
import { HERO_SCHEMA, heroId, isEditorial, heroProblems, fieldNode, defaultCamera, onDevices, placeDevices, deviceCamera, NOT_BLANK, assertNoBlanks } from './shared.mjs';
import { chartData } from './chart-marks.mjs';
import { chartLanding } from './chart-time.mjs';
import { expandDeskChart } from './chart-desk.mjs';
import { expandPopChart } from './chart-pop.mjs';

const KIND = 'chart';
const TYPES = Object.freeze(['bar', 'column', 'line', 'area', 'donut']);
const CATEGORICAL = Object.freeze(['bar', 'column', 'donut']);
const MARKS_MAX = 12;
const SERIES_MAX = 3;
const POINTS_MAX = 24;
const LABEL_MAX = 24;
const X_MAX = 12;
const TITLE_MAX = 90;
const UNIT_MAX = 4;
const SOURCE_MAX = 60;
const DONUT_MIN = 2;
const DONUT_MAX = 6;
const POINTS_MIN = 2;
const MECHANICAL = 'mechanical';

const POINT = Object.freeze({
  type: 'object', required: ['x', 'y'], additionalProperties: false,
  properties: { x: { anyOf: [{ type: 'number' }, { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: X_MAX }] }, y: { type: 'number' } },
});
const ITEM = Object.freeze({
  type: 'object', required: ['label', 'value'], additionalProperties: false,
  properties: { label: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX }, value: { type: 'number' } },
});
const SERIES = Object.freeze({
  type: 'object', required: ['name', 'points'], additionalProperties: false,
  properties: { name: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX }, points: { type: 'array', minItems: 1, maxItems: POINTS_MAX, items: POINT } },
});
const DATA = Object.freeze({
  anyOf: [
    { type: 'array', minItems: 1, maxItems: MARKS_MAX, items: ITEM },
    { type: 'array', minItems: 1, maxItems: POINTS_MAX, items: POINT },
    { type: 'object', required: ['series'], additionalProperties: false, properties: { series: { type: 'array', minItems: 1, maxItems: SERIES_MAX, items: SERIES } } },
  ],
});

const isItems = (data) => Array.isArray(data) && data.every((d) => d !== null && typeof d === 'object' && 'label' in d);
const markNames = (shot) => {
  const data = chartData(shot);
  return data.items ? data.items.map((i) => i.key) : data.series.map((s) => s.name).filter((n) => n !== null);
};

// The input rules: data of the shape its type reads, and a highlight that names a mark.
function chartProblems(shot, { look } = {}) {
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
  return [...heroProblems(shot), ...highlight, ...kindSupportProblems(KIND, look)];
}

// The honesty rules, as mechanical findings at the field to fix (review.mjs kindFindings).
function honesty(shot) {
  const finding = (path, message) => ({ kind: MECHANICAL, path, at: 0, message });
  const data = chartData(shot);
  const out = [];
  if (data.items) {
    data.items.forEach((it, i) => { if (!Number.isFinite(it.value)) out.push(finding(`data[${i}].value`, 'a chart value must be a finite number')); });
    if (shot.type === 'donut') {
      if (data.items.length < DONUT_MIN || data.items.length > DONUT_MAX) out.push(finding('data', `a donut needs 2 to 6 values, it has ${data.items.length}: use a bar chart for more, a number for one`));
      data.items.forEach((it, i) => { if (it.value < 0) out.push(finding(`data[${i}].value`, 'a donut value cannot be negative: a share of a whole is 0 or more')); });
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
  });
  return out;
}

// The field a node shows, for a review finding's path: null for a text the chart computes (a tick), undefined for
// anything that is not the chart's.
function chartField(shot, id) {
  const own = (name) => id === `${shot.id}.${name}` || id.startsWith(`${shot.id}.${name}.`);
  for (const name of ['title', 'source', 'baseline']) if (own(name)) return name;
  const indexed = id.match(new RegExp(`^${shot.id.replace(/[-]/g, '\\-')}\\.(label|value|series|tick)\\.(\\d+)$`));
  const foreign = !id.startsWith(`${shot.id}.`) || id.startsWith(`${shot.id}.captions`) || /\.on\d/.test(id);
  if (indexed === null) return foreign ? undefined : null;
  const [, part, k] = indexed;
  if (part === 'tick' || (part === 'value' && !Array.isArray(shot.data))) return null;
  if (part === 'value' && (shot.type === 'line' || shot.type === 'area')) return null;
  if (part === 'series') return Array.isArray(shot.data) ? null : `data.series[${k}].name`;
  return `data[${k}].${part}`;
}

function expandChart(shot, ctx) {
  assertNoBlanks(shot, 'chart'); // a blank text is the validator's to refuse; expand names it rather than failing in layout
  const { look, timing, unit } = ctx;
  const data = kindData(look, KIND);
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
  summary: 'A claim and its evidence: a bar, column, line, area or donut chart of up to 12 marks or 3 series, labelled directly, with one highlighted mark that turns accent on the word that names it. The claim heads it in the serif with a source line (desk), or rides as a tag over big marks with the highlighted value punched as a numeral (pop).',
  example: {
    id: 'growth', show: 'chart', type: 'column', title: 'Q3 carried the year', say: 'Sales rose every quarter. Q3 carried the year.',
    data: [{ label: 'Q1', value: 12 }, { label: 'Q2', value: 18 }, { label: 'Q3', value: 31 }, { label: 'Q4', value: 24 }], highlight: 'Q3', source: 'Sales ledger, 2026',
  },
  schema: {
    required: ['type', 'data', 'title'],
    properties: {
      type: { enum: [...TYPES] },
      data: DATA,
      title: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: TITLE_MAX },
      unit: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: UNIT_MAX },
      highlight: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: LABEL_MAX },
      baseline: { type: 'number' },
      source: { type: 'string', minLength: 1, pattern: NOT_BLANK, maxLength: SOURCE_MAX },
      hero: HERO_SCHEMA,
    },
  },
  srcFields: [],
  heroTarget: 'chart',
  targets: (shot) => ['chart', 'title', ...chartData(shot)[CATEGORICAL.includes(shot.type) ? 'items' : 'series'].map((_, i) => `mark:${i}`)],
  ids: (shot) => [heroId(shot, 'chart')],
  nodeField: chartField,
  validate: chartProblems,
  review: honesty,
  landing: chartLanding, // the highlighted value landing (else the marks grown): the cue plan's land event
  expand: expandChart,
  numbered: false, // its claim is its own heading: no slug
  showsWords: false, // its narration is not its picture: captioned (engine/captions)
});
