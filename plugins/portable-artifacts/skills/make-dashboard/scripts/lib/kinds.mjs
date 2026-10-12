// Chart kinds: which field roles each kind takes, which column types each role
// accepts, and the validate-time role check. Expansion to Vega-Lite lives in
// views.mjs; interaction params in interact.mjs.
import { didYouMean, pathJoin } from '../../shared/errors.mjs';

export const ROLES = ['x', 'y', 'color', 'size', 'value'];
const Q = ['quantitative'];
const N = ['nominal'];
const NT = ['nominal', 'temporal'];

export const KINDS = {
  bar: { label: 'Bar', required: ['x', 'y'], optional: [], types: { x: NT, y: Q }, views: ['sorted', 'share'] },
  'stacked-bar': { label: 'Stacked', required: ['x', 'y', 'color'], optional: [], types: { x: NT, y: Q, color: N }, views: ['grouped', 'normalized'] },
  'grouped-bar': { label: 'Grouped', required: ['x', 'y', 'color'], optional: [], types: { x: NT, y: Q, color: N }, views: ['stacked', 'normalized'] },
  line: { label: 'Line', required: ['x', 'y'], optional: ['color'], types: { x: NT, y: Q, color: N }, views: ['area'] },
  area: { label: 'Area', required: ['x', 'y'], optional: ['color'], types: { x: NT, y: Q, color: N }, views: ['line'] },
  scatter: { label: 'Scatter', required: ['x', 'y'], optional: ['color'], types: { x: Q, y: Q, color: N }, views: [] },
  bubble: { label: 'Bubble', required: ['x', 'y', 'size'], optional: ['color'], types: { x: Q, y: Q, size: Q, color: N }, views: ['scatter'] },
  heatmap: { label: 'Heatmap', required: ['x', 'y', 'value'], optional: [], types: { x: NT, y: NT, value: Q }, views: [] },
  histogram: { label: 'Histogram', required: ['value'], optional: [], types: { value: Q }, views: ['boxplot'] },
  boxplot: { label: 'Box plot', required: ['value'], optional: ['x'], types: { value: Q, x: N }, views: ['histogram'] },
  donut: { label: 'Donut', required: ['x', 'y'], optional: [], types: { x: N, y: Q }, views: ['bar'] },
};
export const KIND_NAMES = Object.keys(KINDS);

export function classOf(duckType) {
  const t = String(duckType);
  if (t === 'DATE' || t.startsWith('TIMESTAMP')) return 'temporal';
  if (/^(U?(TINY|SMALL|BIG|HUGE)?INT(EGER)?|UBIGINT|FLOAT|DOUBLE|REAL|DECIMAL\(\d+,\d+\))$/.test(t)) return 'quantitative';
  return 'nominal';
}

// Vega-Lite reads "." and "[" in a field string as nested access; escape them.
export function fieldRef(column) {
  return String(column).replace(/[\\.[\]]/g, '\\$&');
}

const NEED = { quantitative: 'a numeric column', temporal: 'a date or timestamp column', nominal: 'a text column' };
const IS = { quantitative: 'numeric', temporal: 'a date', nominal: 'text' };

function need(classes) {
  return classes.map((c) => NEED[c]).join(' or ');
}

function checkChart(chart, p, described) {
  const kind = KINDS[chart.kind];
  if (!kind) return []; // unknown kind is a schema (enum) error already
  const errors = [];
  const roles = [...kind.required, ...kind.optional];
  const rolesNote = `(roles: ${roles.join(', ')})`;
  for (const role of ROLES) {
    if (chart[role] !== undefined && !roles.includes(role)) errors.push({ path: pathJoin(p, role), message: `kind ${JSON.stringify(chart.kind)} does not use ${role} ${rolesNote}` });
  }
  for (const role of kind.required) {
    if (chart[role] === undefined) errors.push({ path: pathJoin(p, role), message: `required for kind ${JSON.stringify(chart.kind)} ${rolesNote}` });
  }
  const q = described[chart.query];
  if (q) {
    for (const role of roles) {
      const column = chart[role];
      if (column === undefined) continue;
      const i = q.columns.indexOf(column);
      if (i < 0) {
        const hint = didYouMean(column, q.columns);
        errors.push({ path: pathJoin(p, role), message: `${JSON.stringify(column)} is not a column of query ${JSON.stringify(chart.query)} (columns: ${q.columns.join(', ')})${hint ? `; did you mean ${JSON.stringify(hint)}?` : ''}` });
        continue;
      }
      const cls = classOf(q.types[i]);
      if (!kind.types[role].includes(cls)) {
        errors.push({ path: pathJoin(p, role), message: `${JSON.stringify(column)} is ${IS[cls]} (${q.types[i]}); ${role} of kind ${JSON.stringify(chart.kind)} needs ${need(kind.types[role])}` });
      }
    }
  }
  const offered = [...kind.views, 'table'];
  (chart.views ?? []).forEach((v, i) => {
    if (offered.includes(v)) return;
    const hint = didYouMean(v, offered);
    errors.push({ path: pathJoin(pathJoin(p, 'views'), i), message: `kind ${JSON.stringify(chart.kind)} has no view ${JSON.stringify(v)}; ${hint ? `did you mean ${JSON.stringify(hint)}? ` : ''}(views: ${offered.join(', ')})` });
  });
  return errors;
}

export function roleErrors(spec, described) {
  return (spec.charts ?? []).flatMap((chart, i) => (chart.kind ? checkChart(chart, pathJoin('charts', i), described) : []));
}
