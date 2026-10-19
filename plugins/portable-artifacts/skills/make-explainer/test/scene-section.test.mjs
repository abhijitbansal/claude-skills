import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildPage, BuildError, contentSecurityPolicy } from '../scripts/lib/page.mjs';
import { build as buildFile } from '../scripts/build.mjs';
import { SCENE_MAX_BYTES } from '../scripts/lib/scene-source.mjs';
import { requirementsFor } from '../scripts/lib/requirements.mjs';
import { ALL } from '../shared/doctor.mjs';

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:";
const INSTALL = 'npx --yes skills@1.7.2 add abhijitbansal/claude-skills --skill make-scene -y';
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function folder(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-scene-')));
  made.push(dir);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

const rows = [
  { group: 'api', t: '2026-W30', value: 12 }, { group: 'web', t: '2026-W30', value: 5 },
  { group: 'api', t: '2026-W31', value: 7 }, { group: 'web', t: '2026-W31', value: 9 },
];
const world = (title = 'Commits', extra = {}) => ({ title, world: 'city', data: { rows }, ...extra });
const section = (scene, extra = {}) => ({ type: 'scene', scene, ...extra });
const doc = (sections, extra = {}) => ({ title: 'Doc', sections, ...extra });
const text = { type: 'text', text: 'x' };
const errorsOf = async (spec, dir) => (await validateSpec(spec, { dir })).errors;
const build = (sections, extra = {}, dir = folder()) => buildPage(doc(sections, extra), { dir });
const count = (html, re) => (html.match(re) ?? []).length;

// ---- rendering --------------------------------------------------------------------------

test('scene section renders host and fallback', async () => {
  const { html } = await build([text, section(world('Commits'), { title: 'The city', caption: 'A **city**.' })]);
  assert.match(html, /<figure class="sc-fig"/);
  assert.match(html, /<div class="sc-frame">/);
  assert.match(html, /<div class="pa-scene" id="sc_1" data-pa-scene data-scene-state="loading"/);
  assert.match(html, /<div class="sc-fallback" data-scene-fallback[^>]*><div class="sc-table"><table>/, 'the table fallback is in the page');
  assert.match(html, /<script type="application\/json" id="sc_1-data">/);
  assert.match(html, /<figcaption>A <strong>city<\/strong>\.<\/figcaption>/);
  assert.match(html, /window\.PAScene=\{/, 'the runtime is inlined');
  assert.match(html, /PS\.mountScene/, 'the mount script is there');
});

test('a section title is the heading; the scene gets no heading of its own', async () => {
  const { html } = await build([section(world('Inner'), { title: 'The city' })]);
  assert.equal(count(html, /<h2 class="sec-title"/g), 1);
});

test('two scene sections inline the runtime once and share no ids', async () => {
  const { html } = await build([section(world('One')), text, section(world('Two'))]);
  assert.equal(count(html, /window\.PAScene=\{/g), 1, 'runtime once');
  assert.equal(count(html, /<div class="pa-scene"[^>]* data-pa-scene /g), 2);
  assert.equal(count(html, /\.sc-toolbar \{/g), 1, 'scene css once');
  const ids = [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids: ${ids.filter((x, i) => ids.indexOf(x) !== i)}`);
  assert.ok(ids.includes('sc_0') && ids.includes('sc_2'));
});

test('a page without a scene ships no scene css, runtime or markup', async () => {
  const { html } = await build([text]);
  assert.ok(!html.includes('PAScene'));
  assert.ok(!html.includes('.sc-toolbar'));
  assert.ok(!html.includes('data-pa-scene'));
});

test('a scene file in the spec folder builds the same as the inline object', async () => {
  const dir = folder({ 'city.scene.json': world('Commits') });
  const a = await build([section('city.scene.json')], {}, dir);
  const b = await build([section(world('Commits'))], {}, dir);
  assert.equal(a.html, b.html);
});

test('the same spec builds byte for byte the same page', async () => {
  const env = { SOURCE_DATE_EPOCH: '1792368000' };
  const dir = folder();
  const go = () => buildPage(doc([section(world('Commits'))]), { dir, env });
  assert.equal((await go()).html, (await go()).html);
});

test('a scene data file in a subfolder resolves next to the scene file', async () => {
  const dir = folder({ 'sub/rows.json': { rows }, 'sub/s.scene.json': { title: 'Sub', world: 'city', data: { file: 'rows.json' } } });
  assert.deepEqual(await errorsOf(doc([section('sub/s.scene.json')]), dir), []);
  assert.match((await build([section('sub/s.scene.json')], {}, dir)).html, /data-pa-scene/);
});

test('hostile text in the scene never reaches the page as markup', async () => {
  const P = '<i>X</i>"\'';
  const { html } = await build([section({ title: P, world: 'city', data: { rows: [{ group: P, t: P, value: 3, label: P }] } }, { caption: P })]);
  assert.ok(!html.includes('<i>X'), 'raw tag leaked');
  const data = /<script type="application\/json" id="sc_0-data">([^]*?)<\/script>/.exec(html)[1];
  assert.ok(!data.includes('<'), 'the data block holds no "<"');
  assert.equal(JSON.parse(data).title, P, 'and still parses back to the original');
});

// ---- slides and print ---------------------------------------------------------------------

test('a deck shows the fallback table only: no runtime, no mount script, no canvas host', async () => {
  const { html } = await build([section(world('Commits'), { title: 'The city' })], { mode: 'slides' });
  assert.match(html, /<div class="sc-fallback sc-fb-static" role="region"[^>]*><div class="sc-table"><table>/);
  assert.ok(!html.includes('PAScene'));
  assert.ok(!html.includes('data-pa-scene'));
  assert.ok(!html.includes('PS.mountScene'));
  assert.match(html, /\.sc-fb-static \{/, 'the table is styled');
  assert.match(html, /<div class="sc-fallback sc-fb-static"[^>]* tabindex="0">/, 'focusable, so slides.js lets the arrows scroll it');
});

test('print shows the table, not the frame', async () => {
  const { html } = await build([section(world('Commits'))]);
  const print = html.slice(html.lastIndexOf('/* scene sections */'));
  assert.match(print, /@media print[^]*\.sc-frame[^]*aspect-ratio: auto/);
});

// ---- limits and validation ------------------------------------------------------------------

test('four scene sections validate; five are rejected at the fifth', async () => {
  const four = Array.from({ length: 4 }, () => section(world()));
  assert.deepEqual(await errorsOf(doc(four), folder()), []);
  const five = [...four, section(world())];
  const errors = await errorsOf(doc(five), folder());
  assert.deepEqual(errors.map((e) => e.path), ['sections[4]']);
  assert.match(errors[0].message, /at most 4 scene sections/);
});

test('errors in an embedded scene are re-pathed under sections[i].scene', async () => {
  const bad = world('T', { world: 'cty', bogus: 1 });
  const errors = await errorsOf(doc([text, section(bad)]), folder());
  assert.deepEqual(errors.map((e) => e.path).sort(), ['sections[1].scene.bogus', 'sections[1].scene.world']);
  const semantic = await errorsOf(doc([section({ title: 'T', world: 'city', data: { rows: [{ group: 'a', value: 1 }] }, tour: [{ title: 'Go', focus: ['zz'] }] })]), folder());
  assert.deepEqual(semantic.map((e) => e.path), ['sections[0].scene.tour[0].focus[0]']);
});

test('a scene file reports errors under scene and names the file', async () => {
  const dir = folder({ 'x.scene.json': world('T', { bogus: 1 }) });
  const errors = await errorsOf(doc([section('x.scene.json')]), dir);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].path, 'sections[0].scene.bogus');
  assert.match(errors[0].message, /\(in x\.scene\.json\)/);
});

test('a scene path must be a json file inside the spec folder, not a symlink, within the cap', async () => {
  const root = folder({ 'spec/ok.scene.json': world(), 'secret.scene.json': world(), 'spec/notes.txt': 'x', 'spec/bad.scene.json': '{ nope', 'spec/list.scene.json': '[1]', 'spec/huge.scene.json': `{${' '.repeat(SCENE_MAX_BYTES)}}` });
  const dir = path.join(root, 'spec');
  fs.symlinkSync(path.join(root, 'secret.scene.json'), path.join(dir, 'link.scene.json'));
  const at = async (p) => (await errorsOf(doc([section(p)]), dir)).map((e) => `${e.path}: ${e.message}`);
  assert.deepEqual(await at('ok.scene.json'), []);
  assert.match((await at('../secret.scene.json'))[0], /^sections\[0\]\.scene: "\.\.\/secret\.scene\.json" is outside the spec folder/);
  assert.match((await at('link.scene.json'))[0], /goes through a symlink/);
  assert.match((await at('missing.scene.json'))[0], /file not found/);
  assert.match((await at('notes.txt'))[0], /must be a \.json file/);
  assert.match((await at('bad.scene.json'))[0], /is not valid JSON/);
  assert.match((await at('list.scene.json'))[0], /must hold one JSON object/);
  assert.match((await at('huge.scene.json'))[0], /is 1024 KB; the limit is 1024 KB — split the scene/);
  assert.match((await at('  '))[0], /^sections\[0\]\.scene: must contain at least one non-space character/);
});

test('building an invalid embedded scene is a BuildError at the field', async () => {
  await assert.rejects(build([section(world('T', { world: 'cty' }))]), (e) => {
    assert.ok(e instanceof BuildError);
    assert.equal(e.errors[0].path, 'sections[0].scene.world');
    return true;
  });
});

// ---- page security and theme ------------------------------------------------------------------

test('CSP unchanged with scene sections', async () => {
  assert.equal(contentSecurityPolicy(doc([section(world()), section(world())])), BASE_CSP);
  const { html } = await build([section(world())]);
  const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
  assert.equal(meta[1].replaceAll('&#39;', "'"), BASE_CSP);
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'no external script');
  assert.ok(!/url\(\s*["']?https?:/i.test(html), 'no css url() to the network');
});

test('page theme overrides scene theme', async () => {
  const dir = folder();
  const themed = world('T', { theme: 'no-such-theme' });
  const result = await validateSpec(doc([section(themed)], { theme: 'ink' }), { dir });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings.map((w) => w.path), ['sections[0].scene.theme']);
  assert.match(result.warnings[0].message, /ignored — the page theme \("ink"\) is used/);
  assert.deepEqual((await validateSpec(doc([section(world())]), { dir })).warnings, [], 'no theme, no warning');
  const ink = await build([section(themed)], { theme: 'ink' });
  const paper = await build([section(world())], { theme: 'paper' });
  assert.match(ink.html, /<h1>/);
  assert.notEqual(ink.html.match(/--page:\s*[^;]+;/)[0], paper.html.match(/--page:\s*[^;]+;/)[0], 'the page theme is the one drawn');
});

// ---- missing make-scene ----------------------------------------------------------------------

function skillWithoutScene() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-nosc-')));
  made.push(root);
  const copy = path.join(root, 'make-explainer');
  fs.mkdirSync(copy);
  for (const name of ['scripts', 'shared', 'template', 'references', 'package.json']) fs.cpSync(path.join(SKILL, name), path.join(copy, name), { recursive: true });
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'));
  return { root, copy };
}

test('missing make-scene gives install command', async () => {
  const { root, copy } = skillWithoutScene();
  const spec = path.join(root, 's.explainer.json');
  fs.writeFileSync(spec, JSON.stringify(doc([section(world())])));
  const r = spawnSync(process.execPath, [path.join(copy, 'scripts/validate.mjs'), spec], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /sections\[0\]\.scene: make-scene skill not found next to make-explainer/);
  assert.ok(r.stdout.includes(`install it with: ${INSTALL}`), r.stdout);

  const page = await import(pathToFileURL(path.join(copy, 'scripts/lib/page.mjs')).href);
  await assert.rejects(page.buildPage(doc([section(world())]), { dir: root }), (e) => {
    assert.equal(e.name, 'SiblingError');
    assert.equal(e.command, INSTALL);
    return true;
  });
  assert.match((await page.buildPage(doc([text]), { dir: root })).html, /<!doctype html>/, 'a page with no scene never needs it');
});

// A dashboard lift whose 2D chart Vega cannot draw (values too close together) has a table-only fallback, no svg.
// Both modes must render it: the page keeps the table in the fallback region, the deck shows it alone.
test('a dashboard lift with a table-only fallback renders in a page and in a deck, with no svg and no Vega noise', async () => {
  const dir = folder({
    'close.dashboard.json': { title: 'T', sources: {}, queries: { q: 'SELECT 33.333333333333336::DOUBLE AS v UNION ALL SELECT 33.33333333333333::DOUBLE' }, charts: [{ id: 'close', title: 'Close', query: 'q', kind: 'histogram', value: 'v' }] },
  });
  const lifted = { title: 'Close values', lift: { dashboard: 'close.dashboard.json', chart: 'close' } };
  assert.deepEqual(await errorsOf(doc([section(lifted)]), dir), []);
  const stderr = [];
  const write = process.stderr.write;
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  let page;
  let deck;
  try {
    page = await build([section(lifted)], {}, dir);
    deck = await build([section(lifted)], { mode: 'slides' }, dir);
  } finally {
    process.stderr.write = write;
  }
  for (const { html } of [page, deck]) {
    assert.match(html, /<div class="sc-fallback[^"]*"[^>]*>(?:(?!<\/div><\/div>)[^])*<table>/, 'the fallback region holds the table');
    assert.ok(!html.includes('<div class="sc-fb-svg'), 'no 2D drawing');
  }
  assert.match(deck.html, /<div class="sc-fallback sc-fb-static" role="region"[^>]*><div class="sc-table"><table>/);
  assert.equal(stderr.join('').includes('ERROR'), false, stderr.join(''));
});

// ---- network sources -----------------------------------------------------------------------------

// A scene lifted from a dashboard with a database source must be refused like a chart section on it is,
// before make-scene runs the dashboard (which would open the connection). The URL points at a closed port:
// a refusal that says "Connection refused" means a connection was attempted.
test('a scene lifting a postgres or mysql dashboard is refused as an explainer chart is, with no connection attempted', async () => {
  const saved = process.env.SCENE_NET_URL;
  process.env.SCENE_NET_URL = 'postgresql://user:pw@127.0.0.1:1/db';
  try {
    for (const type of ['postgres', 'mysql']) {
      const dir = folder();
      fs.cpSync(path.join(SKILL, 'test/fixtures/chart'), dir, { recursive: true });
      const file = path.join(dir, 'sales.dashboard.json');
      const dash = JSON.parse(fs.readFileSync(file, 'utf8'));
      dash.sources.warehouse = { type, env: 'SCENE_NET_URL' };
      fs.writeFileSync(file, JSON.stringify(dash));
      const lifted = { title: 'Sales', lift: { dashboard: 'sales.dashboard.json', chart: 'by-region' } };
      const message = `source "warehouse" is ${type}, a network source; explainer charts read local files only (no network at build or view time) — export the query to CSV or Parquet and point a file source at it (in sales.dashboard.json)`;
      for (const scene of [lifted, 'lifted.scene.json']) {
        fs.writeFileSync(path.join(dir, 'lifted.scene.json'), JSON.stringify(lifted));
        const spec = doc([text, section(scene)]);
        const [first, ...more] = await errorsOf(spec, dir);
        assert.equal(more.length, 0, 'one error');
        assert.equal(first.path, 'sections[1].scene.lift.dashboard');
        assert.equal(first.message, message);
        await assert.rejects(buildPage(spec, { dir }), (e) => {
          assert.ok(e instanceof BuildError);
          assert.equal(e.errors[0].path, 'sections[1].scene.lift.dashboard');
          assert.equal(e.errors[0].message, message);
          return true;
        });
        const file2 = path.join(dir, 'doc.explainer.json');
        fs.writeFileSync(file2, JSON.stringify(spec));
        const result = await buildFile(file2, { out: path.join(dir, 'out.html') });
        assert.equal(result.ok, false);
        assert.equal(result.errors[0].message, message);
      }
    }
  } finally {
    if (saved === undefined) delete process.env.SCENE_NET_URL;
    else process.env.SCENE_NET_URL = saved;
  }
});

// A dashboard ref the chart gate refuses (symlink, absolute, outside the folder, missing, wrong extension) must be
// refused behind a scene section with the same message: make-scene would otherwise run the dashboard, and a
// symlinked postgres dashboard would open a connection. The URL points at a closed port.
test('a scene lifting a dashboard ref the chart gate refuses is refused with its message, no connection attempted', async () => {
  const saved = process.env.SCENE_NET_URL;
  process.env.SCENE_NET_URL = 'postgresql://user:pw@127.0.0.1:1/db';
  try {
    const dir = folder();
    fs.cpSync(path.join(SKILL, 'test/fixtures/chart'), dir, { recursive: true });
    const outside = folder();
    const dash = JSON.parse(fs.readFileSync(path.join(dir, 'sales.dashboard.json'), 'utf8'));
    dash.sources.warehouse = { type: 'postgres', env: 'SCENE_NET_URL' };
    fs.writeFileSync(path.join(outside, 'net.dashboard.json'), JSON.stringify(dash));
    fs.symlinkSync(path.join(outside, 'net.dashboard.json'), path.join(dir, 'link.dashboard.json'));
    fs.writeFileSync(path.join(dir, 'dashboard.txt'), '{}');
    const refs = {
      symlink: 'link.dashboard.json', absolute: path.join(outside, 'net.dashboard.json'), outside: '../net.dashboard.json',
      missing: 'nope.dashboard.json', extension: 'dashboard.txt',
    };
    const pattern = { symlink: /goes through a symlink/, absolute: /is absolute/, outside: /outside the spec folder/, missing: /file not found/, extension: /must be a \.json file/ };
    for (const [kind, dashboard] of Object.entries(refs)) {
      const [chartError] = await errorsOf(doc([{ type: 'chart', dashboard, chart: 'by-region' }]), dir);
      assert.match(chartError.message, pattern[kind], `the chart gate refuses the ${kind} ref`);
      const spec = doc([text, section({ title: 'Sales', lift: { dashboard, chart: 'by-region' } })]);
      const [first, ...more] = await errorsOf(spec, dir);
      assert.equal(more.length, 0, `${kind}: one error`);
      assert.equal(first.path, 'sections[1].scene.lift.dashboard', kind);
      assert.equal(first.message, chartError.message, `${kind}: the chart gate's message`);
      assert.doesNotMatch(first.message, /Connection refused|ECONNREFUSED/);
      await assert.rejects(buildPage(spec, { dir }), (e) => {
        assert.ok(e instanceof BuildError);
        assert.equal(e.errors[0].path, 'sections[1].scene.lift.dashboard');
        assert.equal(e.errors[0].message, chartError.message);
        return true;
      });
    }
  } finally {
    if (saved === undefined) delete process.env.SCENE_NET_URL;
    else process.env.SCENE_NET_URL = saved;
  }
});

// ---- per-scene css ------------------------------------------------------------------------------

test('each scene css ships once: the chrome once, a lift fallback css per distinct extra', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-fakesc-')));
  made.push(root);
  const copy = path.join(root, 'make-explainer');
  fs.mkdirSync(copy);
  for (const name of ['scripts', 'shared', 'template', 'references', 'package.json']) fs.cpSync(path.join(SKILL, name), path.join(copy, name), { recursive: true });
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'));
  const api = path.join(root, 'make-scene/scripts/lib/api.mjs');
  fs.mkdirSync(path.dirname(api), { recursive: true });
  fs.writeFileSync(api, `const CHROME = '.fake-chrome{}';
export const sceneCss = () => CHROME;
export const validateSpec = async () => ({ ok: true, errors: [] });
export const buildScene = async (spec, { idPrefix }) => ({
  html: '<div class="pa-scene" id="' + idPrefix + '" data-pa-scene><script type="application/json">{}</script></div>',
  css: CHROME + (spec.extra ? '\\n' + spec.extra : ''), runtime: 'window.PAScene={mountScene(){}};', fallbackHtml: '', bytes: 1,
});
`);
  const page = await import(pathToFileURL(path.join(copy, 'scripts/lib/page.mjs')).href);
  const { html } = await page.buildPage(doc([section({ extra: '.lift-a{}' }), section({ extra: '.lift-b{}' }), section({ extra: '.lift-a{}' }), section({})]), { dir: root });
  const n = (s) => html.split(s).length - 1;
  assert.equal(n('.fake-chrome{}'), 1);
  assert.equal(n('.lift-a{}'), 1);
  assert.equal(n('.lift-b{}'), 1);
});

// ---- doctor ---------------------------------------------------------------------------------

test('doctor --for spec with a scene section requires make-scene', () => {
  const file = path.join(folder(), 'x.explainer.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'T', sections: [{ type: 'scene' }, { type: 'text' }] }));
  const withScene = requirementsFor(file).map((r) => r.id);
  assert.ok(withScene.includes('make-scene'), withScene.join());
  assert.equal(withScene.includes('make-diagram'), false, 'only the sister the spec uses');
  fs.writeFileSync(file, JSON.stringify({ title: 'T', sections: [{ type: 'text' }] }));
  assert.equal(requirementsFor(file).some((r) => r.id === 'make-scene'), false);
  assert.ok(requirementsFor(ALL).some((r) => r.id === 'make-scene'), 'ALL accepts --fix make-scene');
});
