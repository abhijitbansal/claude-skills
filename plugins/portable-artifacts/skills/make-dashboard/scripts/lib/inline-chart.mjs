// A chart defined by rows written in the caller's spec (not a dashboard query):
// infer column types, check the kind's roles, and expand it to Vega-Lite the
// way a dashboard chart is. No DuckDB, no Vega: cheap enough for validation.
import { KINDS, KIND_NAMES, roleErrors, ROLES } from './kinds.mjs';
import { expandCharts, FORMAT_NAMES } from './views.mjs';
import { didYouMean } from '../../shared/errors.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const QUERY = 'data';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const isDate = (v) => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
// A zone-less time is read as UTC, so the drawing never depends on the machine's time zone.
const parseDateTime = (v) => Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v.replace(' ', 'T') : `${v.replace(' ', 'T')}Z`);
const isDateTime = (v) => typeof v === 'string' && ISO_DATETIME.test(v) && !Number.isNaN(parseDateTime(v));

// DuckDB-style type per column: all numbers -> DOUBLE, all ISO dates -> DATE, ISO dates and
// date-times with at least one date-time -> TIMESTAMP, anything else -> VARCHAR. Missing values (null / absent) are skipped.
export function inferTypes(rows, columns) {
  return columns.map((c) => {
    const values = rows.map((r) => r[c]).filter((v) => v !== null && v !== undefined);
    if (values.length > 0 && values.every((v) => typeof v === 'number' && Number.isFinite(v))) return 'DOUBLE';
    if (values.length > 0 && values.every(isDate)) return 'DATE';
    if (values.length > 0 && values.every((v) => isDate(v) || isDateTime(v))) return 'TIMESTAMP';
    return 'VARCHAR';
  });
}

// Column names in order of first appearance across the rows.
export function columnsOf(rows) {
  const seen = new Set();
  for (const r of rows) for (const k of Object.keys(r)) seen.add(k);
  return [...seen];
}

// The rows as the drawing reads them: a TIMESTAMP column holds UTC ISO strings, like a dashboard query's.
function drawingRows(rows, columns, types) {
  const stamps = columns.filter((_, i) => types[i] === 'TIMESTAMP');
  if (stamps.length === 0) return rows;
  const utc = (v) => (isDate(v) ? new Date(`${v}T00:00:00Z`) : new Date(parseDateTime(v))).toISOString();
  return rows.map((r) => ({ ...r, ...Object.fromEntries(stamps.filter((c) => typeof r[c] === 'string').map((c) => [c, utc(r[c])])) }));
}

const suggest = (value, names) => {
  const hint = didYouMean(value, names);
  return hint ? `did you mean ${JSON.stringify(hint)}?` : `available: ${names.join(', ')}`;
};

// roleErrors words its messages for a dashboard query; here the rows are the data.
const reword = (message) => message.replace(/ of query "data" \(columns: /, ' of the data (columns: ');

/**
 * chart = { kind, x, y, color, size, value, format } (the explainer section's fields), rows = array of objects.
 * -> { errors: [{ path, message }] } with paths relative to the chart ("x", "kind"), or
 *    { errors: [], vegaLite, label, columns, types, roles, plotRows } (plotRows: the rows to draw).
 */
export function inlineChart(chart, rows) {
  const columns = columnsOf(rows);
  const types = inferTypes(rows, columns);
  if (!KIND_NAMES.includes(chart.kind)) {
    return { errors: [{ path: 'kind', message: `unknown kind ${JSON.stringify(chart.kind)}; ${suggest(chart.kind, KIND_NAMES)}` }] };
  }
  const errors = [];
  if (chart.format !== undefined && !FORMAT_NAMES.includes(chart.format)) {
    errors.push({ path: 'format', message: `unknown format ${JSON.stringify(chart.format)}; ${suggest(chart.format, FORMAT_NAMES)}` });
  }
  const roles = Object.fromEntries(ROLES.filter((r) => chart[r] !== undefined).map((r) => [r, chart[r]]));
  const def = { id: 'chart', title: 'Chart', query: QUERY, kind: chart.kind, ...roles, ...(chart.format && FORMAT_NAMES.includes(chart.format) ? { format: chart.format } : {}) };
  const strip = (p) => p.replace(/^charts\[0\]\.?/, '');
  errors.push(...roleErrors({ charts: [def] }, { [QUERY]: { columns, types } }).map((e) => ({ path: strip(e.path), message: reword(e.message) })));
  if (errors.length > 0) return { errors };
  const result = { rows: drawingRows(rows, columns, types), columns, types, rowCount: rows.length, truncated: false };
  const expanded = expandCharts({ charts: [def] }, { [QUERY]: result });
  if (expanded.errors.length > 0) return { errors: expanded.errors.map((e) => ({ path: strip(e.path), message: e.message })) };
  return { errors: [], vegaLite: expanded.charts[0].views[0].vegaLite, label: KINDS[chart.kind].label, columns, types, roles, plotRows: drawingRows(rows, columns, types) };
}
