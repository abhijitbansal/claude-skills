// Where a chart section gets its picture: inline rows in the spec, or one chart
// of a make-dashboard spec. Shared by the validation check and the renderer; both
// need the make-dashboard sibling (a missing one is a SiblingError).
import fs from 'node:fs';
import { resolveRef } from './paths.mjs';
import { loadSibling } from './siblings.mjs';
import { repath } from './diagram-source.mjs';
import { LIMITS } from './schema.mjs';

export const DASHBOARD_EXTS = ['.json'];
export const CHART_MAX_ROWS = LIMITS.chartRows;
// Fields only an inline chart reads; a dashboard chart takes its definition from the dashboard.
export const INLINE_CHART_FIELDS = ['kind', 'x', 'y', 'color', 'size', 'value', 'format', 'data'];
const ROLES = ['x', 'y', 'color', 'size', 'value'];

/** 'dashboard' when the section names a dashboard chart, 'inline' when it carries rows, else null. */
export function chartMode(section) {
  if (section.dashboard !== undefined || section.chart !== undefined) return 'dashboard';
  return Array.isArray(section.data) ? 'inline' : null;
}

// Errors from the dashboard keep its own paths under `dashboard`, and name its file;
// an unknown chart id ("chart") is the section's own field.
function dashboardErrors(errors, section) {
  return errors.map((e) => ({
    path: e.path === 'chart' ? 'chart' : repath('dashboard', e.path),
    message: `${e.message} (in ${section.dashboard})`,
  }));
}

// A dashboard with a postgres or mysql source reads the network when it runs. Looked at before anything runs;
// a dashboard that is not JSON is left for make-dashboard to report.
async function networkSourceError(abs, section) {
  let sources;
  try {
    sources = JSON.parse(fs.readFileSync(abs, 'utf8'))?.sources;
  } catch {
    return null;
  }
  if (sources === null || typeof sources !== 'object') return null;
  const { URL_TYPES } = await loadSibling('make-dashboard', 'scripts/lib/sources.mjs');
  const [name, source] = Object.entries(sources).find(([, src]) => URL_TYPES.includes(src?.type)) ?? [];
  if (name === undefined) return null;
  return { path: 'dashboard', message: `source ${JSON.stringify(name)} is ${source.type}, a network source; explainer charts read local files only (no network at build or view time) — export the query to CSV or Parquet and point a file source at it (in ${section.dashboard})` };
}

async function inlineSource(section) {
  const lib = await loadSibling('make-dashboard', 'scripts/lib/inline-chart.mjs');
  const chart = lib.inlineChart(section, section.data);
  if (chart.errors.length > 0) return { errors: chart.errors };
  return {
    errors: [], label: chart.label, vegaLite: chart.vegaLite, rows: section.data, plotRows: chart.plotRows, roles: chart.roles, format: section.format,
    columns: Object.values(chart.roles).filter((c, i, all) => all.indexOf(c) === i),
  };
}

async function dashboardSource(section, dir, { rows }) {
  const ref = resolveRef(dir, section.dashboard, { exts: DASHBOARD_EXTS });
  if (ref.error) return { errors: [{ path: 'dashboard', message: ref.error }] };
  const network = await networkSourceError(ref.abs, section);
  if (network) return { errors: [network] };
  const pipeline = await loadSibling('make-dashboard', 'scripts/lib/pipeline.mjs');
  let out;
  try {
    out = rows ? await pipeline.chartData(ref.abs, section.chart) : await pipeline.validateChart(ref.abs, section.chart);
  } catch (e) {
    if (e.name !== 'UsageError') throw e;
    return { errors: [{ path: 'dashboard', message: e.message.replaceAll(ref.abs, section.dashboard) }] };
  }
  if (!out.ok) return { errors: dashboardErrors(out.errors, section) };
  if (!rows) return { errors: [], abs: ref.abs, chartId: out.chart.id };
  const { chart, view, result } = out;
  if (result.rowCount > CHART_MAX_ROWS || result.truncated) {
    const n = result.truncated ? `more than ${result.rowCount}` : String(result.rowCount);
    return { errors: [{ path: 'chart', message: `query ${JSON.stringify(chart.query)} returns ${n} rows; a static chart takes at most ${CHART_MAX_ROWS} — aggregate in SQL or add a LIMIT (in ${section.dashboard})` }] };
  }
  const kinds = chart.kind ? (await loadSibling('make-dashboard', 'scripts/lib/kinds.mjs')).KINDS : {};
  const roles = Object.fromEntries(ROLES.filter((r) => chart[r] !== undefined).map((r) => [r, chart[r]]));
  const plotted = Object.values(roles).filter((c, i, all) => all.indexOf(c) === i);
  return {
    errors: [], abs: ref.abs, chartId: chart.id, title: chart.title, label: kinds[chart.kind]?.label, vegaLite: view,
    rows: result.rows, plotRows: result.rows, format: chart.format, roles, columns: plotted.length > 0 ? plotted : result.columns,
  };
}

/**
 * The chart a section describes. `rows: false` only checks it (a dashboard's queries are not run).
 * -> { errors: [{ path, message }] } with paths relative to the section ("x", "dashboard", "chart",
 * "dashboard.charts[0].x"), or { errors: [], vegaLite, rows, plotRows, columns, roles, format?, label?, title?, abs?, chartId? }
 * (rows: as written, for the data table; plotRows: as drawn).
 * Throws SiblingError when make-dashboard is not installed.
 */
export function loadChartSource(section, dir, { rows = true } = {}) {
  return chartMode(section) === 'dashboard' ? dashboardSource(section, dir, { rows }) : inlineSource(section);
}
