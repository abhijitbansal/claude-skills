import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildPage, BuildError, contentSecurityPolicy } from '../scripts/lib/page.mjs';
import { build } from '../scripts/build.mjs';
import { loadTheme } from '../shared/theme.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = path.join(SKILL, 'test/fixtures/chart');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// A fresh spec folder holding the fixture dashboard and its CSV, plus any extra files.
function folder(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-chart-')));
  made.push(dir);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const doc = (sections, extra = {}) => ({ title: 'Doc', sections, ...extra });
const text = { type: 'text', text: 'x' };
const DATA = [{ team: 'Core', bugs: 12 }, { team: 'Web', bugs: 7 }, { team: 'Infra', bugs: 4 }];
const inline = (extra = {}) => ({ type: 'chart', title: 'Open bugs', data: DATA, kind: 'bar', x: 'team', y: 'bugs', ...extra });
const dashboard = (extra = {}) => ({ type: 'chart', dashboard: 'sales.dashboard.json', chart: 'by-region', ...extra });
const errorsOf = async (spec, dir) => (await validateSpec(spec, { dir })).errors.map((e) => `${e.path}: ${e.message}`);
const make = (sections, dir = folder(), extra = {}) => buildPage(doc(sections, extra), { dir });

// ---- validation -------------------------------------------------------------------------

test('a valid inline chart and a valid dashboard chart both validate', async () => {
  const dir = folder();
  assert.deepEqual(await errorsOf(doc([inline()]), dir), []);
  assert.deepEqual(await errorsOf(doc([dashboard(), dashboard({ chart: 'weekly' })]), dir), []);
});

test('inline chart mistakes are reported at the field with the fix', async () => {
  const dir = folder();
  const at = async (patch) => errorsOf(doc([text, inline(patch)]), dir);
  assert.match((await at({ kind: 'barr' }))[0], /^sections\[1\]\.kind: unknown kind "barr"; did you mean "bar"\?/);
  assert.match((await at({ x: 'tean' }))[0], /^sections\[1\]\.x: "tean" is not a column of the data \(columns: team, bugs\); did you mean "team"\?/);
  assert.match((await at({ x: 'bugs' }))[0], /^sections\[1\]\.x: "bugs" is numeric \(DOUBLE\); x of kind "bar" needs a text column/);
  assert.match((await at({ format: 'currancy' }))[0], /^sections\[1\]\.format: unknown format "currancy"; did you mean "currency"\?/);
  assert.match((await at({ y: undefined }))[0], /^sections\[1\]\.y: required for kind "bar"/);
  assert.match((await at({ color: 'team' }))[0], /^sections\[1\]\.color: kind "bar" does not use color/);
});

test('interactive needs a dashboard: with inline data it is an error at the field that names the fix', async () => {
  const errors = await errorsOf(doc([text, inline({ interactive: true })]), folder());
  assert.deepEqual(errors, ['sections[1].interactive: interactive needs dashboard + chart (the dashboard is what opens); set dashboard and chart, or remove interactive']);
  assert.deepEqual(await errorsOf(doc([dashboard({ interactive: true })]), folder()), []);
  assert.deepEqual(await errorsOf(doc([inline({ interactive: false })]), folder()), [], 'false is harmless');
});

test('an unknown chart id gets a did-you-mean at sections[i].chart', async () => {
  const errors = await errorsOf(doc([text, dashboard({ chart: 'by-regoin' })]), folder());
  assert.deepEqual(errors, ['sections[1].chart: chart "by-regoin" not found in the dashboard; did you mean "by-region"? (in sales.dashboard.json)']);
  assert.match((await errorsOf(doc([dashboard({ chart: 'zzzzzzzz' })]), folder()))[0], /available: by-region, weekly/);
});

test('errors inside the dashboard keep its paths, under sections[i].dashboard, and name the file', async () => {
  const dir = folder();
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'sales.dashboard.json'), 'utf8'));
  spec.charts[0].x = 'regoin';
  fs.writeFileSync(path.join(dir, 'sales.dashboard.json'), JSON.stringify(spec));
  const errors = await errorsOf(doc([dashboard()]), dir);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^sections\[0\]\.dashboard\.charts\[0\]\.x: "regoin" is not a column of query "by_region".*\(in sales\.dashboard\.json\)$/);
});

test('two interactive charts that would share an output folder are an error', async () => {
  const dir = folder({ 'other/sales.dashboard.json': JSON.parse(fs.readFileSync(path.join(FIXTURE, 'sales.dashboard.json'), 'utf8')), 'other/sales.csv': fs.readFileSync(path.join(FIXTURE, 'sales.csv'), 'utf8') });
  const same = await errorsOf(doc([dashboard({ interactive: true }), dashboard({ interactive: true })]), dir);
  assert.deepEqual(same, [], 'the same dashboard and chart share one build');
  const clash = await errorsOf(doc([dashboard({ interactive: true }), dashboard({ dashboard: 'other/sales.dashboard.json', interactive: true })]), dir);
  assert.equal(clash.length, 1);
  assert.match(clash[0], /^sections\[1\]\.interactive: chart "by-region" is already used by sections\[0\] from another dashboard; interactive dashboards are written to <name>\.assets\/<chart id>\/ — give the charts different ids/);
});

// ---- path rules (Review Focus 4) ----------------------------------------------------------

test('a dashboard path must be a json file inside the spec folder, not a symlink', async () => {
  const root = folder({ 'spec/notes.txt': 'x' });
  const dir = path.join(root, 'spec');
  fs.copyFileSync(path.join(FIXTURE, 'sales.dashboard.json'), path.join(dir, 'ok.dashboard.json'));
  fs.copyFileSync(path.join(FIXTURE, 'sales.csv'), path.join(dir, 'sales.csv'));
  fs.symlinkSync(path.join(root, 'sales.dashboard.json'), path.join(dir, 'link.dashboard.json'));
  fs.symlinkSync(root, path.join(dir, 'up'));
  const at = async (p) => errorsOf(doc([dashboard({ dashboard: p })]), dir);

  assert.deepEqual(await at('ok.dashboard.json'), []);
  assert.deepEqual(await at('../sales.dashboard.json'), [`sections[0].dashboard: "../sales.dashboard.json" is outside the spec folder; move the file under ${dir} and use a relative path`]);
  assert.deepEqual(await at(path.join(root, 'sales.dashboard.json')), [`sections[0].dashboard: ${JSON.stringify(path.join(root, 'sales.dashboard.json'))} is absolute; use a path relative to the spec folder`]);
  assert.match((await at('link.dashboard.json'))[0], /^sections\[0\]\.dashboard: "link\.dashboard\.json" goes through a symlink/);
  assert.match((await at('up/sales.dashboard.json'))[0], /goes through a symlink/);
  assert.match((await at('missing.json'))[0], /^sections\[0\]\.dashboard: file not found: "missing\.json"/);
  assert.match((await at('notes.txt'))[0], /must be a \.json file/);
});

test('building with a dashboard path outside the folder is a BuildError, not a read', async () => {
  const root = folder();
  const dir = path.join(root, 'spec');
  fs.mkdirSync(dir);
  await assert.rejects(buildPage(doc([dashboard({ dashboard: '../sales.dashboard.json' })]), { dir }), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[0].dashboard');
    assert.match(e.errors[0].message, /outside the spec folder/);
    return true;
  });
});

// ---- missing make-dashboard ---------------------------------------------------------------

// The skill copied next to no make-dashboard: the sibling lookup fails the way an install without it would.
function skillWithoutSibling() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-nodash-')));
  made.push(root);
  const copy = path.join(root, 'make-explainer');
  fs.mkdirSync(copy);
  for (const name of ['scripts', 'shared', 'template', 'references', 'package.json']) fs.cpSync(path.join(SKILL, name), path.join(copy, name), { recursive: true });
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'));
  return { root, copy };
}
const INSTALL = 'npx skills add abhijitbansal/claude-skills --skill make-explainer make-dashboard';

test('without make-dashboard, validate exits 1 with the install command (inline and dashboard charts)', () => {
  const { root, copy } = skillWithoutSibling();
  for (const [name, section, field] of [['inline', inline(), 'sections[0]'], ['dash', dashboard(), 'sections[0].dashboard']]) {
    const spec = path.join(root, `${name}.explainer.json`);
    fs.writeFileSync(spec, JSON.stringify(doc([section])));
    fs.copyFileSync(path.join(FIXTURE, 'sales.dashboard.json'), path.join(root, 'sales.dashboard.json'));
    const r = spawnSync(process.execPath, [path.join(copy, 'scripts/validate.mjs'), spec], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.ok(r.stdout.includes(`${field}: make-dashboard skill not found next to make-explainer`), r.stdout);
    assert.ok(r.stdout.includes(`install it with: ${INSTALL}`), r.stdout);
  }
});

test('without make-dashboard, buildPage lets the SiblingError through; a page with no chart never needs it', async () => {
  const { root, copy } = skillWithoutSibling();
  const page = await import(pathToFileURL(path.join(copy, 'scripts/lib/page.mjs')).href);
  await assert.rejects(page.buildPage(doc([inline()]), { dir: root }), (e) => {
    assert.equal(e.name, 'SiblingError');
    assert.equal(e.command, INSTALL);
    return true;
  });
  assert.match((await page.buildPage(doc([text]), { dir: root })).html, /<!doctype html>/);
});

// ---- rendering --------------------------------------------------------------------------

// Every Vega SVG on the page, in order: light wide, light narrow, dark wide, dark narrow, per chart.
const svgs = (html) => [...html.matchAll(/<svg [^>]*class="marks"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
const PER_CHART = 4;

test('an inline chart renders a light and a dark SVG with marks, axis titles and a labelled figure', async () => {
  const { html } = await make([inline({ caption: 'Bugs by **team**' })]);
  const [light, lightNarrow, dark, darkNarrow] = svgs(html);
  assert.equal(svgs(html).length, PER_CHART);
  for (const svg of [light, lightNarrow, dark, darkNarrow]) {
    assert.match(svg, />team</);
    assert.match(svg, />bugs</);
    assert.match(svg, />Core</);
    assert.ok((svg.match(/<path[^>]*d="M[^"]*"[^>]*fill="#/g) ?? []).length >= 3, 'one bar per row');
  }
  assert.match(html, /<figure class="ch">/, 'the section heading already names a titled chart; the figure does not repeat it');
  assert.match(html, /<div class="ch-card" role="img" aria-label="Bar chart of bugs by team\. The plotted values are in the data table below\.">/);
  assert.match(html, /<figcaption>Bugs by <strong>team<\/strong><\/figcaption>/);
  assert.deepEqual([...html.matchAll(/<div class="(?:ch-svg )?ch-(light|dark|wide|narrow)"/g)].map((m) => m[1]), ['light', 'wide', 'narrow', 'dark', 'wide', 'narrow'], 'a scheme holds its wide and narrow drawing');
  assert.match(lightNarrow, /<svg [^>]*\swidth="320"/);
  assert.match(light, /<svg [^>]*\swidth="600"/);
});

test('the chart follows the page theme: light and dark palettes, and the selectors the page theme uses', async () => {
  const { html } = await make([inline()], folder(), { theme: 'ink' });
  const ink = loadTheme('ink');
  const [light, , dark] = svgs(html);
  assert.ok(light.includes(ink.light.cat1) && !light.includes(ink.dark.cat1), 'light SVG: light palette only');
  assert.ok(dark.includes(ink.dark.cat1) && !dark.includes(ink.light.cat1), 'dark SVG: dark palette only');
  assert.match(html, /\.ch-dark\s*\{\s*display:\s*none/);
  assert.ok(html.includes(':root[data-theme="dark"] .ch-light'), 'explicit dark toggle hides the light SVG');
  assert.match(html, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \.ch-light \{ display: none; \}/, 'auto follows the OS scheme unless light is forced');
});

test('format is applied to the axis labels', async () => {
  const { html } = await make([inline({ format: 'currency' })]);
  assert.match(svgs(html)[0], />\$\d/);
  const plain = await make([inline()]);
  assert.ok(!/>\$\d/.test(svgs(plain.html)[0]));
});

test('the data table fallback lists the plotted columns, is capped, and escapes cells', async () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ team: i === 0 ? '<img src=x onerror=alert(1)>' : `T${i}`, bugs: i, unused: 'q' }));
  const { html } = await make([inline({ data: rows })]);
  assert.match(html, /<details class="ch-data">\s*<summary>Data table \(40 rows\)<\/summary>/);
  assert.match(html, /<th scope="col">team<\/th>\s*<th scope="col">bugs<\/th>/);
  assert.ok(!html.includes('>unused<'), 'only the plotted columns');
  assert.equal((html.match(/<tr><th scope="row">/g) ?? []).length, 25);
  assert.match(html, /Showing the first 25 of 40 rows\./);
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  const small = await make([inline()]);
  assert.ok(!/Showing the first/.test(small.html));
});

test('text from the spec is escaped in the labels, caption and SVG', async () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { html } = await make([inline({ title: evil, caption: evil, data: [{ team: evil, bugs: 3 }, { team: 'b', bugs: 4 }] })]);
  assert.ok(!html.includes('<img src=x'));
  const scripts = html.match(/<script[^>]*>[\s\S]*?<\/script>/g);
  for (const s of scripts) assert.equal((s.match(/<\/script/gi) ?? []).length, 1);
});

test('a dashboard chart renders from the dashboard rows; its title names the figure when the section has none', async () => {
  const { html, assets } = await make([dashboard()]);
  const [light] = svgs(html);
  assert.match(light, />North</);
  assert.match(light, />region</);
  assert.match(light, />\$\d/, 'the dashboard chart format applies');
  assert.match(html, /<figure class="ch" aria-label="Revenue by region">/);
  assert.match(html, /role="img" aria-label="Bar chart of revenue by region\./, 'the name is not repeated in the image label');
  assert.match(html, /<summary>Data table \(3 rows\)<\/summary>/);
  assert.deepEqual(assets, [], 'no interactive link, no assets');
  assert.ok(!html.includes('Open interactive dashboard'));
  const line = await make([dashboard({ chart: 'weekly', title: 'Weekly' })]);
  assert.match(svgs(line.html)[0], /<path d="M[^"]*" stroke="#[0-9a-f]{6}" stroke-width="2"/, 'a line chart draws stroked lines');
  assert.match(svgs(line.html)[0], /class="mark-line role-mark/);
  assert.match(line.html, /<figure class="ch">/);
});

test('a dashboard query over the 500-row limit is a BuildError at the chart field', async () => {
  const csv = `day,region,amount\n${Array.from({ length: 501 }, (_, i) => `2025-01-01,R${i},${i}`).join('\n')}\n`;
  const dir = folder({ 'sales.csv': csv });
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'sales.dashboard.json'), 'utf8'));
  spec.queries.by_region = 'SELECT region, amount AS revenue FROM sales';
  spec.charts = spec.charts.slice(0, 1);
  fs.writeFileSync(path.join(dir, 'sales.dashboard.json'), JSON.stringify(spec));
  await assert.rejects(buildPage(doc([dashboard()]), { dir }), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[0].chart');
    assert.match(e.errors[0].message, /query "by_region" returns 501 rows; a static chart takes at most 500 — aggregate in SQL/);
    return true;
  });
});

test('two charts share no ids, and the chart css ships once', async () => {
  const { html } = await make([inline(), text, dashboard(), inline({ title: 'Third' })]);
  const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  assert.equal((html.match(/\/\* chart sections:/g) ?? []).length, 1);
  assert.equal(svgs(html).length, 3 * PER_CHART);
});

test('a page without a chart ships no chart css or markup', async () => {
  const { html } = await make([text]);
  assert.ok(!html.includes('.ch-card'));
  assert.ok(!html.includes('class="ch"'));
});

test('the CSP is unchanged by a chart', async () => {
  const { html } = await make([inline(), dashboard()]);
  const csp = contentSecurityPolicy(doc([inline()]));
  assert.equal(csp, "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:");
  assert.ok(html.includes(csp.replaceAll("'", '&#39;')));
});

test('slides mode renders the same figure inside its slide', async () => {
  const { html } = await make([inline({ title: 'Open bugs' })], folder(), { mode: 'slides' });
  assert.match(html, /<section class="slide slide-chart" id="slide-2"/);
  assert.match(html, /<figure class="ch"/);
  assert.equal(svgs(html).length, PER_CHART);
  assert.match(html, /\.slide-chart \.ch-svg svg/);
});

// ---- interactive --------------------------------------------------------------------------

test('interactive builds the dashboard next to the page and links to it', async () => {
  const dir = folder();
  const out = path.join(dir, 'out', 'my-doc.html');
  fs.writeFileSync(path.join(dir, 'doc.explainer.json'), JSON.stringify(doc([dashboard({ interactive: true })], { theme: 'ink' })));
  const result = await build(path.join(dir, 'doc.explainer.json'), { out });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const built = path.join(dir, 'out', 'my-doc.assets', 'by-region', 'index.html');
  assert.deepEqual(result.assets, [built]);
  const dash = fs.readFileSync(built, 'utf8');
  assert.match(dash, /<title>Sales fixture<\/title>/);
  assert.ok(dash.includes(loadTheme('ink').light.accent), 'the dashboard uses the explainer theme');
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /<a class="ch-open" href="my-doc\.assets\/by-region\/index\.html" target="_blank" rel="noopener">Open interactive dashboard<\/a>/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'out')).sort(), ['my-doc.assets', 'my-doc.html']);
});

test('without interactive there is no link and no assets folder', async () => {
  const dir = folder();
  const out = path.join(dir, 'out', 'plain.html');
  fs.writeFileSync(path.join(dir, 'doc.explainer.json'), JSON.stringify(doc([dashboard()])));
  const result = await build(path.join(dir, 'doc.explainer.json'), { out });
  assert.equal(result.ok, true);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'out')), ['plain.html']);
});

// ---- the recap example ------------------------------------------------------------------

test('the recap example, with its diagram and chart, builds under the 600 KB budget', async () => {
  const file = path.join(SKILL, 'references/examples/recap.explainer.json');
  const out = path.join(folder(), 'recap.html');
  const result = await build(file, { out });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(result.bytes <= 600 * 1024, `${result.bytes} bytes`);
  const html = fs.readFileSync(out, 'utf8');
  assert.equal(svgs(html).length, PER_CHART, 'the example has one chart');
  assert.ok(html.includes('data-diagram'), 'and one diagram');
});

// ---- fix round 1 ----------------------------------------------------------------------------

test('the accessible name is announced once: a titled chart is named by its heading, an untitled one by its figure', async () => {
  const titled = (await make([inline({ caption: 'Bugs by team' })])).html;
  assert.ok(!titled.includes('aria-label="Open bugs'), 'title not repeated in any label but the data table');
  assert.equal((titled.match(/Open bugs/g) ?? []).length, 3, 'heading, the anchor label and the data table region');
  const captioned = (await make([inline({ title: undefined, caption: 'Bugs by **team**' })])).html;
  assert.match(captioned, /<figure class="ch">/, 'the figcaption names it; the caption is not repeated as a label');
  assert.match(captioned, /<figcaption>Bugs by <strong>team<\/strong><\/figcaption>/);
  assert.ok(!captioned.includes('aria-label="Bugs by team"'));
  assert.match((await make([dashboard()])).html, /<figure class="ch" aria-label="Revenue by region">/, 'no title and no caption: the dashboard chart title names it');
  assert.match(captioned, /role="img" aria-label="Bar chart of bugs by team\./);
});

test('the data table applies the chart format to numbers and leaves text alone', async () => {
  const money = (await make([inline({ data: [{ team: 'Core', bugs: 1234.5 }, { team: 'Web', bugs: 0.1 + 0.2 }], format: 'currency' })])).html;
  assert.match(money, /<th scope="row">Core<\/th><td>\$1,234\.5<\/td>/, 'the axis format, so the table agrees with the labels');
  assert.match(money, /<td>\$0\.3<\/td>/);
  const compact = (await make([inline({ data: [{ team: 'Core', bugs: 1200 }, { team: 'Web', bugs: 700 }], format: 'compact' })])).html;
  assert.match(compact, /<td>1\.2k<\/td>/, 'compact reads 1.2k in the table, as on the axis');
  assert.match((await make([inline()])).html, /<td>12<\/td>/, 'no format, no change');
  const fromDashboard = (await make([dashboard()])).html;
  assert.match(fromDashboard, /<td>\$\d[\d,]*(\.\d+)?<\/td>/, 'the dashboard chart format reaches its table');
});

test('ISO date-times plot on a time axis', async () => {
  const data = [{ at: '2025-01-01T10:00:00Z', n: 1 }, { at: '2025-01-01T12:00:00Z', n: 3 }];
  const section = { type: 'chart', title: 'Load', kind: 'line', x: 'at', y: 'n', data };
  assert.deepEqual(await errorsOf(doc([section]), folder()), []);
  assert.match(svgs((await make([section])).html)[0], /class="mark-line role-mark/);
});

test('a raw vegaLite dashboard chart renders, names its figure from the chart title and lists every column', async () => {
  const dir = folder();
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'sales.dashboard.json'), 'utf8'));
  spec.charts.push({ id: 'raw', title: 'Raw view', query: 'by_region', vegaLite: { width: 300, autosize: { type: 'pad' }, mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } });
  fs.writeFileSync(path.join(dir, 'sales.dashboard.json'), JSON.stringify(spec));
  assert.deepEqual(await errorsOf(doc([dashboard({ chart: 'raw' })]), dir), []);
  const { html } = await make([dashboard({ chart: 'raw' })], dir);
  assert.equal(svgs(html).length, PER_CHART);
  assert.match(svgs(html)[0], />region</);
  assert.match(svgs(html)[0], /width="600"/, 'the static width replaces a width in the view');
  assert.match(html, /<figure class="ch" aria-label="Raw view">/);
  assert.match(html, /role="img" aria-label="Chart\. The plotted values/);
  assert.match(html, /<th scope="col">region<\/th><th scope="col">revenue<\/th>/);
});

// A dashboard with a database source reads the network when it runs; explainer charts read local files only.
function dashboardWith(source) {
  const dir = folder();
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'sales.dashboard.json'), 'utf8'));
  spec.sources.warehouse = source;
  fs.writeFileSync(path.join(dir, 'sales.dashboard.json'), JSON.stringify(spec));
  return dir;
}

test('a dashboard with a postgres or mysql source is refused at sections[i].dashboard, before anything runs', async () => {
  for (const type of ['postgres', 'mysql']) {
    const dir = dashboardWith({ type, env: 'DATABASE_URL' });
    for (const section of [dashboard(), dashboard({ interactive: true })]) {
      const errors = await errorsOf(doc([text, section]), dir);
      assert.deepEqual(errors, [`sections[1].dashboard: source "warehouse" is ${type}, a network source; explainer charts read local files only (no network at build or view time) — export the query to CSV or Parquet and point a file source at it (in sales.dashboard.json)`]);
      await assert.rejects(buildPage(doc([text, section]), { dir }), (e) => {
        assert.ok(e instanceof BuildError);
        assert.equal(e.errors[0].path, 'sections[1].dashboard');
        assert.match(e.errors[0].message, /explainer charts read local files only/);
        return true;
      });
    }
  }
  assert.deepEqual(await errorsOf(doc([dashboard()]), dashboardWith({ type: 'csv', path: 'sales.csv' })), [], 'local file sources stay allowed');
});

test('a dashboard that is not valid JSON is reported by its path in the spec folder, not an absolute path', async () => {
  const dir = folder({ 'broken.dashboard.json': '{ nope' });
  const errors = await errorsOf(doc([dashboard({ dashboard: 'broken.dashboard.json' })]), dir);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^sections\[0\]\.dashboard: broken\.dashboard\.json is not valid JSON: .*\(in broken\.dashboard\.json\)$/);
  assert.ok(!errors[0].includes(dir), errors[0]);
});

test('absolute paths inside the spec folder become relative in every error from the dashboard', async () => {
  const dir = folder();
  const spec = JSON.parse(fs.readFileSync(path.join(dir, 'sales.dashboard.json'), 'utf8'));
  spec.queries.by_region = `SELECT * FROM read_csv_auto('${path.join(dir, 'sales.csv')}')`;
  fs.writeFileSync(path.join(dir, 'sales.dashboard.json'), JSON.stringify(spec));
  fs.rmSync(path.join(dir, 'sales.csv'));
  const errors = await errorsOf(doc([dashboard()]), dir);
  assert.ok(errors.length > 0);
  for (const e of errors) {
    assert.ok(!e.includes(dir), `absolute path left in: ${e}`);
    assert.match(e, /\(in sales\.dashboard\.json\)$/);
  }
});

test('interactive: the dashboard is not left in the temp folder, on success or on failure', async () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-tmpcheck-')));
  made.push(tmp);
  const dir = folder();
  const before = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    await make([dashboard({ interactive: true })], dir);
    assert.deepEqual(fs.readdirSync(tmp), [], 'success leaves nothing behind');
    // A later section that fails the build must not strand the dashboard already built for an earlier one.
    await assert.rejects(make([dashboard({ interactive: true }), dashboard({ chart: 'nope' })], dir));
    assert.deepEqual(fs.readdirSync(tmp), [], 'failure leaves nothing behind');
  } finally {
    if (before === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = before;
  }
});

test('the interactive link is URL-encoded as well as HTML-escaped when the output name needs it', async () => {
  const dir = folder();
  const out = path.join(dir, 'out', 'my doc #1.html');
  fs.writeFileSync(path.join(dir, 'doc.explainer.json'), JSON.stringify(doc([dashboard({ interactive: true })])));
  const result = await build(path.join(dir, 'doc.explainer.json'), { out });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('href="my%20doc%20%231.assets/by-region/index.html"'), html.match(/href="[^"]*assets[^"]*"/)?.[0]);
  assert.ok(fs.existsSync(path.join(dir, 'out', 'my doc #1.assets', 'by-region', 'index.html')));
});

// A make-dashboard folder that is present but has no node_modules: the first import of vega fails.
function dashboardWithoutModules() {
  const { root, copy } = skillWithoutSibling();
  const dash = path.join(root, 'make-dashboard');
  fs.mkdirSync(dash);
  const real = path.join(SKILL, '..', 'make-dashboard');
  for (const name of ['scripts', 'shared', 'template', 'package.json']) fs.cpSync(path.join(real, name), path.join(dash, name), { recursive: true });
  return { root, copy, dash };
}

test('make-dashboard without its node_modules is a SiblingError with the install hint, not a raw module error', async () => {
  const { root, copy, dash } = dashboardWithoutModules();
  const page = await import(pathToFileURL(path.join(copy, 'scripts/lib/page.mjs')).href);
  await assert.rejects(page.buildPage(doc([inline()]), { dir: root }), (e) => {
    assert.equal(e.name, 'SiblingError');
    assert.ok(e.message.includes(`make-dashboard is installed but its dependencies are missing (vega)`), e.message);
    assert.ok(e.message.includes(`run "npm ci" in ${dash}`), e.message);
    assert.ok(e.message.includes(`install it with: ${INSTALL}`), e.message);
    return true;
  });
});
