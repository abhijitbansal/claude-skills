// Page rendering: escaping helpers and the template fill. No network, no LLM.
import fs from 'node:fs';
import { MAX_ROWS_DEFAULT } from './spec.mjs';
import { themeCss } from '../../shared/theme.mjs';
import { formatValue } from './format.mjs';
import { vegaConfig } from './vega-config.mjs';
import { faviconLink } from '../../shared/icons.mjs';
import { generatorMeta, provenanceHtml, buildDate } from '../../shared/provenance.mjs';
import { toggleIcons, TOGGLE_CSS, TOGGLE_JS } from '../../shared/theme-toggle.mjs';

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

// The page gets vegaConfig as window.PAVegaConfig: the function's own source, so the page and the Node
// render can never differ. It must stay self-contained (a helper outside it would throw in the page; a test calls it in a bare sandbox).
export function vegaConfigScript() {
  return `window.PAVegaConfig = ${vegaConfig.toString()};`;
}

// Inline code must not close its <script> or open an HTML comment (`<!--` changes how the parser ends the element).
const escapeInline = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('<!--', '<\\!--');
const inlineScript = (code) => `<script>${escapeInline(code)}</script>`;

const utc = (iso) => iso.slice(0, 16).replace('T', ' ');
const timeTag = (iso, text) => `<time datetime="${escapeHtml(iso)}" data-t="${text}">${escapeHtml(text === 'hm' ? iso.slice(11, 16) + ' UTC' : `${utc(iso)} UTC`)}</time>`;

// The value is one line, sized from its tile's width: --n (its length in code points) tells the CSS how many
// characters must fit. The thresholds come from the smallest size the CSS shrinks to, --fs-md = 21px, at an
// assumed 0.7em (14.7px) per character, in a tile whose content box is its width less 16px padding and 1px
// border on each side (34px):
//   short tile   min width 160px -> 126px content -> 8 characters (8.57 rounded down)
//   wide tile    min width 288px (a 320px viewport less 32px page padding) -> 254px content -> 17 characters (17.28)
// A value over KPI_WIDE_CHARS would not fit a short tile at the smallest size, so its tile is wide. A value
// over KPI_LONG_CHARS would not fit even a wide one, so it may wrap rather than spill.
const KPI_WIDE_CHARS = 8;
const KPI_LONG_CHARS = 17;

function kpiTile(kpi, results) {
  const value = formatValue(results[kpi.query]?.rows[0]?.[kpi.field], kpi.format);
  const chars = [...value].length;
  const size = chars > KPI_LONG_CHARS ? ' kpi-wide kpi-long' : chars > KPI_WIDE_CHARS ? ' kpi-wide' : '';
  return `<div class="kpi${size}" id="kpi-${escapeHtml(kpi.id)}"><div class="kpi-label">${escapeHtml(kpi.title)}</div><div class="kpi-value" style="--n: ${Math.max(1, chars)}">${escapeHtml(value)}</div></div>`;
}

function dataTable(res) {
  const head = res.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = res.rows.slice(0, TABLE_ROWS)
    .map((r) => `<tr>${res.columns.map((c) => `<td>${escapeHtml(r[c] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  return `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// On a paired card pane 1 stays on the primary view; the tabs switch pane 2 over views[1..].
function tabs(c) {
  const list = c.pair ? c.views.slice(1) : c.views;
  if (list.length < 2) return '';
  const buttons = list.map((v, i) => `<button type="button" role="tab" id="tab-${escapeHtml(c.id)}-${escapeHtml(v.name)}" data-view="${escapeHtml(v.name)}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">${escapeHtml(v.label)}</button>`).join('');
  return `<div class="views" role="tablist" aria-label="${escapeHtml(c.title)}${c.pair ? ' second view' : ' views'}">${buttons}</div>`;
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

// SOURCE_DATE_EPOCH pins the stamp date for reproducible builds; otherwise it is the build's own `now`,
// so it agrees with the refresh time beside it.
const stampDate = (env, now) => (/^\d+$/.test(env.SOURCE_DATE_EPOCH ?? '') ? buildDate(env) : now);

// vendor: { vega, vegaLite, vegaEmbed } source strings; theme: a loaded shared/ theme;
// charts: expandCharts(...).charts.
export function renderPage(spec, results, { vendor, theme, charts, env = process.env, now = new Date() }) {
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
    PROVENANCE: provenanceHtml('make-dashboard', spec.generatedBy, stampDate(env, now)),
    FAVICON: faviconLink('make-dashboard', theme),
    GENERATOR: generatorMeta('make-dashboard', spec.generatedBy),
    TOGGLE_ICONS: toggleIcons(),
    TOGGLE_CSS,
    TOGGLE_JS: escapeInline(TOGGLE_JS),
    KPIS: kpis,
    CARDS: cards,
    DATA: jsonForScript(data),
    THEME: themeCss(theme),
    VENDOR: [vendor.vega, vendor.vegaLite, vendor.vegaEmbed].map(inlineScript).join('\n'),
    RUNTIME: [fs.readFileSync(PA_LIB, 'utf8'), vegaConfigScript(), fs.readFileSync(RUNTIME, 'utf8')].map(inlineScript).join('\n'),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
}
