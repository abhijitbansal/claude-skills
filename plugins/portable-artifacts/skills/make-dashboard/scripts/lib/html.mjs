// Page rendering: escaping helpers and the template fill. No network, no LLM.
import fs from 'node:fs';
import { MAX_ROWS_DEFAULT } from './spec.mjs';
import { themeCss } from '../../shared/theme.mjs';

const TEMPLATE = new URL('../../template/page.html', import.meta.url);
const PA_LIB = new URL('../../template/pa-lib.js', import.meta.url);
const RUNTIME = new URL('../../template/runtime.js', import.meta.url);
const TABLE_ROWS = 25;

export function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// JSON that is safe inside <script type="application/json">.
export function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

const inlineScript = (code) => `<script>${code.replace(/<\/(script)/gi, '<\\/$1')}</script>`;

function formatValue(value, format) {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'number') return String(value);
  const abs = Math.abs(value);
  const opts = {
    currency: { style: 'currency', currency: 'USD', maximumFractionDigits: abs >= 1000 ? 0 : 2 },
    percent: { style: 'percent', maximumFractionDigits: 1 },
    compact: { notation: 'compact', maximumFractionDigits: 1 },
  }[format] ?? { maximumFractionDigits: 2 };
  return new Intl.NumberFormat('en-US', opts).format(value);
}

const utc = (iso) => iso.slice(0, 16).replace('T', ' ');
const timeTag = (iso, text) => `<time datetime="${escapeHtml(iso)}" data-t="${text}">${escapeHtml(text === 'hm' ? iso.slice(11, 16) + ' UTC' : `${utc(iso)} UTC`)}</time>`;

function kpiTile(kpi, results) {
  const value = results[kpi.query]?.rows[0]?.[kpi.field];
  return `<div class="kpi" id="kpi-${escapeHtml(kpi.id)}"><div class="kpi-label">${escapeHtml(kpi.title)}</div><div class="kpi-value">${escapeHtml(formatValue(value, kpi.format))}</div></div>`;
}

function dataTable(res) {
  const head = res.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = res.rows.slice(0, TABLE_ROWS)
    .map((r) => `<tr>${res.columns.map((c) => `<td>${escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function tabs(c) {
  if (c.pair || c.views.length < 2) return '';
  const buttons = c.views.map((v, i) => `<button type="button" role="tab" id="tab-${escapeHtml(c.id)}-${escapeHtml(v.name)}" data-view="${escapeHtml(v.name)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${escapeHtml(v.label)}</button>`).join('');
  return `<div class="views" role="tablist" aria-label="${escapeHtml(c.title)} views">${buttons}</div>`;
}

function exportMenu(c) {
  return `<details class="export"><summary aria-label="Export ${escapeHtml(c.title)}">Export</summary><div class="menu">`
    + '<button type="button" data-export="png">PNG</button><button type="button" data-export="svg">SVG</button><button type="button" data-export="csv">CSV</button></div></details>';
}

function panes(c) {
  const pane = (suffix, i) => `<div class="chart" id="chart-${escapeHtml(c.id)}${suffix}" data-pane="${i}" role="img" aria-label="${escapeHtml(c.title)}"></div>`;
  return c.pair ? `<div class="panes pair">${pane('', 0)}${pane('-2', 1)}</div>` : `<div class="panes">${pane('', 0)}</div>`;
}

// chart: the spec chart; expanded: its expandCharts() entry (views, pair, width).
function card(chart, expanded, results, maxRows) {
  const res = results[chart.query];
  const note = res.truncated ? `<p class="meta">truncated at ${maxRows} rows</p>` : '';
  const empty = res.rowCount === 0 ? '<p class="meta empty">No rows returned</p>' : '';
  const shown = Math.min(res.rowCount, TABLE_ROWS);
  return `<article class="card ${expanded.width === 'half' ? 'half' : 'full'}" id="card-${escapeHtml(chart.id)}">
  <div class="card-head"><h2>${escapeHtml(chart.title)}</h2>${tabs(expanded)}${exportMenu(chart)}</div>
  ${panes(expanded)}
  ${empty}${note}
  <details>
    <summary>Query · ${res.rowCount} rows · refreshed ${timeTag(res.refreshedAt, 'hm')}</summary>
    <pre class="sql">${escapeHtml(res.sql)}</pre>
    <p class="meta">Data table (first ${shown} rows)</p>
    ${dataTable(res)}
  </details>
</article>`;
}

// vendor: { vega, vegaLite, vegaEmbed } source strings; theme: a loaded shared/ theme;
// charts: expandCharts(...).charts.
export function renderPage(spec, results, { vendor, theme, charts }) {
  const maxRows = spec.maxRows ?? MAX_ROWS_DEFAULT;
  const charted = new Set((spec.charts ?? []).map((c) => c.query));
  const queries = Object.fromEntries(
    Object.entries(results)
      .filter(([name]) => charted.has(name))
      .map(([name, r]) => [name, { rows: r.rows, columns: r.columns, rowCount: r.rowCount, truncated: r.truncated, refreshedAt: r.refreshedAt }]),
  );
  const data = { queries, charts };
  const refreshed = Object.values(results)[0]?.refreshedAt ?? new Date().toISOString();
  const kpis = (spec.kpis ?? []).length
    ? `<section class="kpis" aria-label="Key metrics">${spec.kpis.map((k) => kpiTile(k, results)).join('')}</section>`
    : '';
  const cards = (spec.charts ?? []).length
    ? `<section class="grid">${spec.charts.map((c) => card(c, charts.find((x) => x.id === c.id), results, maxRows)).join('\n')}</section>`
    : '';
  const parts = {
    TITLE: escapeHtml(spec.title),
    DESCRIPTION: spec.description ? `<p class="desc">${escapeHtml(spec.description)}</p>` : '',
    REFRESHED: timeTag(refreshed, 'full'),
    KPIS: kpis,
    CARDS: cards,
    DATA: jsonForScript(data),
    THEME: themeCss(theme),
    VENDOR: [vendor.vega, vendor.vegaLite, vendor.vegaEmbed].map(inlineScript).join('\n'),
    RUNTIME: [fs.readFileSync(PA_LIB, 'utf8'), fs.readFileSync(RUNTIME, 'utf8')].map(inlineScript).join('\n'),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
}
