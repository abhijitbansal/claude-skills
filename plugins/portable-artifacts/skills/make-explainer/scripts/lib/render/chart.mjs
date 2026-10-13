// chart section: a static SVG drawn in Node by make-dashboard (Vega), from a
// dashboard chart or from inline rows. A chart's colours live in its marks, so
// the page carries a light and a dark SVG and shows the one that matches the
// page theme (same selectors as the theme css), each in a wide and a narrow
// size (a phone shows the narrow one, so its text stays readable). A "Data table" holds the
// plotted rows, so no value is only a colour. `interactive` also builds the
// dashboard next to the page and links to it.
// The SVGs are built before rendering (render is synchronous): prepare() keeps
// them in ctx.charts, render() reads them. The css ships once (page()).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadSibling } from '../siblings.mjs';
import { loadChartSource } from '../chart-source.mjs';
import { SectionErrors } from '../section-errors.mjs';
import { repath } from '../diagram-source.mjs';
import { esc, inline, plain } from './ui.mjs';

const CSS = new URL('../../../template/chart.css', import.meta.url);
const TABLE_ROWS = 25;

// Per-page state: built charts by section, and each interactive dashboard built once (by its file).
const state = (ctx) => (ctx.charts ??= { items: new Map(), dashboards: new Map() });

// The dashboard page stamps "refreshed <time>" from the `now` it is built with. The wall clock would make
// every build of the same spec differ, so the stamp is the newest modification time among the dashboard
// spec and its file sources: it changes when an input does, and never otherwise. An input that cannot be
// read is skipped here; the build reports it.
function inputsTime(dashboardFile) {
  const files = [dashboardFile];
  try {
    const { sources } = JSON.parse(fs.readFileSync(dashboardFile, 'utf8'));
    for (const src of Object.values(sources ?? {})) {
      if (typeof src?.path === 'string') files.push(path.resolve(path.dirname(dashboardFile), src.path));
    }
  } catch {
    // a dashboard that does not parse is reported by the build
  }
  const times = files.flatMap((f) => {
    try {
      return [fs.statSync(f).mtimeMs];
    } catch {
      return [];
    }
  });
  return new Date(Math.max(0, ...times));
}

// The dashboard is built in a temporary folder that is gone before this returns; its page is kept in memory
// and written next to the explainer by the build (an asset with `content`).
async function buildInteractive(source, section, ctx) {
  const dashboards = state(ctx).dashboards;
  if (!dashboards.has(source.abs)) {
    const pipeline = await loadSibling('make-dashboard', 'scripts/lib/pipeline.mjs');
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-dashboard-'));
    try {
      const built = await pipeline.buildDashboard(source.abs, { out, theme: ctx.theme.name, now: inputsTime(source.abs) });
      if (!built.ok) {
        throw new SectionErrors(built.errors.map((e) => ({ path: repath('dashboard', e.path), message: `${e.message} (in ${section.dashboard})` })));
      }
      dashboards.set(source.abs, fs.readFileSync(path.join(built.outDir, 'index.html')));
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
  return dashboards.get(source.abs);
}

export async function prepare(section, ctx, i) {
  const source = await loadChartSource(section, ctx.dir);
  if (source.errors.length > 0) throw new SectionErrors(source.errors);
  const lib = await loadSibling('make-dashboard', 'scripts/lib/static-chart.mjs');
  const svgs = await lib.renderThemedSvgs(source.vegaLite, source.plotRows, ctx.theme, { idPrefix: `ch${i}-` });
  const dashboard = section.interactive === true && source.abs ? await buildInteractive(source, section, ctx) : undefined;
  state(ctx).items.set(section, { source, svgs, dashboard, axisFormat: lib.axisFormat });
}

/** The chart stylesheet; the page includes it once. */
export function page() {
  return { css: fs.readFileSync(CSS, 'utf8').replace(/\n$/, ''), js: [] };
}

/** The dashboard built for an interactive chart goes next to the page: <slug>.assets/<chart id>/index.html. */
export async function assets(section, ctx) {
  const entry = state(ctx).items.get(section);
  if (!entry?.dashboard) return [];
  return [{ content: entry.dashboard, to: path.join(ctx.assetsDir, entry.source.chartId, 'index.html') }];
}

// "Bar chart of bugs by team", from the roles the chart plots.
function describe(source) {
  const { x, y, color, value } = source.roles;
  const label = source.label ? `${source.label} chart` : 'Chart';
  if (y !== undefined && x !== undefined) return `${label} of ${y} by ${x}${color ? `, split by ${color}` : ''}`;
  if (value !== undefined) return `${label} of ${value}${x ? ` by ${x}` : ''}`;
  const cols = Object.values(source.roles);
  return cols.length > 0 ? `${label} of ${cols.join(', ')}` : label;
}

// A number in a measure column prints as the axis prints it, so the table and the labels agree;
// text, missing values and other columns are shown as they are.
function cellText(v, column, source, axisFormat) {
  if (v === null || v === undefined) return '—';
  return esc(typeof v === 'number' && source.format !== undefined && source.measures.includes(column) ? axisFormat(v, source.format) : String(v));
}

function dataTable(source, name, axisFormat) {
  const { columns, rows } = source;
  const shown = rows.slice(0, TABLE_ROWS);
  const head = columns.map((c) => `<th scope="col">${esc(c)}</th>`).join('');
  const body = shown.map((r) => `<tr>${columns.map((c, i) => (i === 0 ? `<th scope="row">${cellText(r[c], c, source, axisFormat)}</th>` : `<td>${cellText(r[c], c, source, axisFormat)}</td>`)).join('')}</tr>`);
  const note = rows.length > shown.length ? `\n<p class="ch-note">Showing the first ${shown.length} of ${rows.length} rows.</p>` : '';
  return `<details class="ch-data">
<summary>Data table (${rows.length} ${rows.length === 1 ? 'row' : 'rows'})</summary>
<div class="tablewrap" role="region" aria-label="Data for ${name}" tabindex="0">
<table>
<thead><tr>${head}</tr></thead>
<tbody>
${body.join('\n')}
</tbody>
</table>
</div>${note}
</details>`;
}

export function render(section, ctx) {
  const entry = state(ctx).items.get(section);
  if (!entry) throw new Error('chart was not prepared; build the page with buildPage');
  const { source, svgs, dashboard, axisFormat } = entry;
  // The figure's name: the section title, else its caption, else the dashboard chart's title, else the kind.
  const name = section.title !== undefined ? plain(section.title)
    : section.caption !== undefined ? plain(section.caption)
      : esc(source.title ?? (source.label ? `${source.label} chart` : 'Chart'));
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  const open = dashboard === undefined ? ''
    : `\n<p class="ch-links"><a class="ch-open" href="${esc(encodeURIComponent(ctx.slug))}.assets/${esc(encodeURIComponent(source.chartId))}/index.html" target="_blank" rel="noopener">Open interactive dashboard</a></p>`;
  const variants = (scheme) => `<div class="ch-${scheme}">
<div class="ch-svg ch-wide">${svgs[scheme].wide}</div>
<div class="ch-svg ch-narrow">${svgs[scheme].narrow}</div>
</div>`;
  // A titled chart is named by its section heading and a captioned one by its figcaption; only a chart with neither
  // is named by the figure's label, and the image label never repeats a name.
  const figureName = section.title === undefined && section.caption === undefined ? ` aria-label="${name}"` : '';
  return `<figure class="ch"${figureName}>
<div class="ch-card" role="img" aria-label="${esc(describe(source))}. The plotted values are in the data table below.">
${variants('light')}
${variants('dark')}
</div>${caption}
${dataTable(source, name, axisFormat)}${open}
</figure>`;
}
