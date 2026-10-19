// One make-dashboard chart as the lift reads it: the rows that can be drawn, the category values in the
// order the 2D chart shows them, and the problems that make a chart un-liftable.
// Pure: make-dashboard's own helpers arrive in `lib` ({ KINDS, classOf, temporalUnit }).
import { LIMITS } from '../lib/schema.mjs';

const ROLES = ['x', 'y', 'color', 'size', 'value'];
export const BLANK = '(blank)'; // a null category
export const MISSING = '—'; // a null cell in the fallback table
const ISO_DIGITS = { utcyear: 4, utcyearmonth: 7, utcyearmonthdate: 10 };
// Roles whose values must be 0 or more: a surface or an arc cannot dip below zero.
const NON_NEGATIVE = { donut: ['y'], heatmap: ['value'], bubble: ['size'] };

export const liftableKinds = (KINDS) => Object.keys(KINDS).filter((k) => k !== 'boxplot');

/** The message for a chart the lift cannot draw (a boxplot or a hand-written vegaLite chart), else null. */
export function kindError(chart, KINDS) {
  if (chart.kind !== undefined && chart.kind !== 'boxplot') return null;
  const list = `liftable kinds: ${liftableKinds(KINDS).join(', ')}`;
  return chart.kind === undefined
    ? `vegaLite charts cannot be lifted; ${list} (chart ${JSON.stringify(chart.id)} is hand-written Vega-Lite; give it a kind and roles in the dashboard)`
    : `boxplot charts cannot be lifted; ${list}`;
}

/** The x axis of a bar or line chart as make-dashboard draws it: nominal x keeps query order (sort: null), a temporal axis sorts (ISO text sorts as time does). */
export const orderOf = (values, temporal) => {
  const seen = [...new Set(values)];
  return temporal ? seen.sort() : seen;
};

/**
 * Ascending order, as Vega-Lite sorts a colour scale's domain and a heatmap's band axes (sort: true in the compiled
 * chart, a plain `<` on text): so colour i here is the 2D chart's colour i, and its stack and donut follow it.
 */
export const sortedOf = (values) => [...new Set(values)].sort();

// The text of a category or table cell. A date column prints at the precision the dashboard's own axis uses.
function textReader(isTemporal, values, temporalUnit) {
  if (!isTemporal) return (v) => (v === null || v === undefined ? BLANK : String(v));
  const digits = ISO_DIGITS[temporalUnit(values)];
  return (v) => (v === null || v === undefined ? BLANK : digits ? String(v).slice(0, digits) : String(v).replace(/\.000Z$/, 'Z'));
}

/**
 * readChart({ chart, result }, lib) -> { errors } or a model:
 * { kind, chart, roles, points, xTemporal, groupNames, table: { columns, rows } }.
 * A point is { n (row index), x, y, color, size, value } for the roles the chart has: numbers for numeric
 * roles, text for categories. A row with no number in a numeric role is not drawn (it stays in the table).
 */
export function readChart({ chart, result }, lib) {
  const { KINDS, classOf, temporalUnit } = lib;
  const roles = Object.fromEntries(ROLES.filter((r) => chart[r] !== undefined).map((r) => [r, chart[r]]));
  if (result.truncated || result.rowCount > LIMITS.rows) {
    const n = result.truncated ? `more than ${result.rowCount}` : String(result.rowCount);
    return { errors: [{ path: 'lift.chart', message: `query ${JSON.stringify(chart.query)} returns ${n} rows; a lift takes at most ${LIMITS.rows}; aggregate in SQL or add a LIMIT` }] };
  }
  const column = (role) => result.columns.indexOf(roles[role]);
  const numeric = (role) => KINDS[chart.kind].types[role].length === 1 && KINDS[chart.kind].types[role][0] === 'quantitative';
  const temporal = (role) => classOf(result.types[column(role)]) === 'temporal';
  const reader = (role) => textReader(temporal(role), result.rows.map((r) => r[roles[role]]), temporalUnit);
  const read = Object.fromEntries(Object.keys(roles).map((role) => [role, numeric(role) ? null : reader(role)]));

  const errors = [];
  const points = [];
  result.rows.forEach((row, n) => {
    const point = { n };
    for (const role of Object.keys(roles)) {
      const v = row[roles[role]];
      if (!numeric(role)) {
        point[role] = read[role](v);
      } else if (v === null || v === undefined) {
        point[role] = undefined;
      } else if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push({ path: 'lift.chart', message: `row ${n + 1} has ${JSON.stringify(v)} in ${roles[role]}, which is too large to draw exactly; scale it in SQL` });
      } else if (v < 0 && (NON_NEGATIVE[chart.kind] ?? []).includes(role)) {
        const noun = role === 'size' ? 'sizes' : 'values';
        errors.push({ path: 'lift.chart', message: `${chart.kind} ${noun} must be 0 or more; row ${n + 1} has ${v}; shift the value in SQL or lift a bar chart instead` });
      } else {
        point[role] = v;
      }
    }
    if (Object.keys(roles).every((role) => !numeric(role) || point[role] !== undefined)) points.push(point);
  });
  if (errors.length > 0) return { errors: errors.slice(0, 1) };

  const groupRole = roles.color !== undefined ? 'color' : chart.kind === 'donut' ? 'x' : null;
  const groupNames = groupRole === null ? [] : sortedOf(points.map((p) => p[groupRole]));
  if (groupNames.length > LIMITS.groups) {
    return { errors: [{ path: 'lift.chart', message: `${roles[groupRole]} has ${groupNames.length} values; a lift takes at most ${LIMITS.groups} groups; fold the rest into "Other" in SQL` }] };
  }
  const plotted = result.columns.filter((c) => Object.values(roles).includes(c));
  const cells = plotted.map((c) => {
    const i = result.columns.indexOf(c);
    const asText = classOf(result.types[i]) === 'temporal' ? textReader(true, result.rows.map((r) => r[c]), temporalUnit) : (v) => String(v);
    return (row) => (row[c] === null || row[c] === undefined ? MISSING : asText(row[c]));
  });
  return {
    errors: [],
    kind: chart.kind,
    chart,
    roles,
    points,
    xTemporal: roles.x !== undefined && !numeric('x') && temporal('x'),
    groupNames,
    table: { columns: plotted, rows: result.rows.map((row) => cells.map((cell) => cell(row))) },
  };
}
