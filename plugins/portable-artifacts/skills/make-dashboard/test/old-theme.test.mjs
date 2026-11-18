// A theme written before surface2, surface3 and shadow existed builds with a warning per missing token; a failed
// contrast pair, or a missing token with no fallback, still fails the build. loadTheme reads only the skill's own
// shared/themes, so each test builds in a throwaway copy of the skill that holds the theme under test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const NEW_TOKENS = ['surface2', 'surface3', 'shadow'];
const MODES = ['light', 'dark'];

const paper = () => JSON.parse(fs.readFileSync(path.join(SKILL, 'shared/themes/paper.json'), 'utf8'));
const withoutNewTokens = (theme) => {
  for (const mode of MODES) for (const key of NEW_TOKENS) delete theme[mode][key];
  return theme;
};

// A copy of the skill (node_modules linked, not copied) with `themes` ({ name: theme JSON }) added, and a project dir.
function setup(themes) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-oldtheme-')));
  made.push(root);
  const copy = path.join(root, 'make-dashboard');
  for (const d of ['scripts', 'shared', 'template']) fs.cpSync(path.join(SKILL, d), path.join(copy, d), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'package.json'), path.join(copy, 'package.json'));
  fs.symlinkSync(path.join(SKILL, 'node_modules'), path.join(copy, 'node_modules'));
  for (const [name, theme] of Object.entries(themes)) fs.writeFileSync(path.join(copy, 'shared/themes', `${name}.json`), JSON.stringify({ ...theme, name }));
  const project = path.join(root, 'project');
  fs.cpSync(path.join(SKILL, 'test/fixtures/data'), path.join(project, 'data'), { recursive: true });
  const spec = {
    title: 'T',
    sources: { sales: { type: 'csv', path: 'data/sales.csv' } },
    queries: { rev: 'SELECT region, SUM(amount) AS revenue FROM sales GROUP BY 1 ORDER BY 2 DESC' },
    charts: [{ id: 'c1', title: 'Chart', query: 'rev', vegaLite: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } } }],
  };
  const specFile = path.join(project, 'dashboard.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  return { copy, project, specFile };
}

function build({ copy, project, specFile }, theme, extra = []) {
  const out = path.join(project, 'dist');
  const r = spawnSync(process.execPath, [path.join(copy, 'scripts/build.mjs'), specFile, '--theme', theme, '--out', out, ...extra], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '1' } });
  return { ...r, out, text: `${r.stdout}${r.stderr}`, page: path.join(out, 'index.html') };
}

test('an old-token theme builds with exit 0 and a warning for each missing token, both modes', () => {
  const r = build(setup({ oldpaper: withoutNewTokens(paper()) }), 'oldpaper');
  assert.equal(r.status, 0, r.text);
  for (const mode of MODES) {
    for (const key of NEW_TOKENS) assert.match(r.stdout, new RegExp(`^theme oldpaper: ${mode}\\.${key}: warning: missing`, 'm'), `${mode}.${key}`);
  }
  assert.match(r.stdout, /themeCss uses #000000 \(plain black elevation shadow\) instead/, 'the warning names the fallback');
  const html = fs.readFileSync(r.page, 'utf8');
  assert.match(html, /--surface-2:#[0-9a-f]{6};/i, 'the fallback surface is written');
  assert.doesNotMatch(html.split('\n').filter((l) => !l.startsWith('@font-face')).join('\n'), /--[a-z0-9-]+:\s*(undefined|null|NaN)\b/);
});

test('--json carries the old-token warnings and ok: true', () => {
  const r = build(setup({ oldpaper: withoutNewTokens(paper()) }), 'oldpaper', ['--json']);
  assert.equal(r.status, 0, r.text);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, true);
  assert.deepEqual(body.warnings.map((w) => w.path).sort(), MODES.flatMap((m) => NEW_TOKENS.map((k) => `theme oldpaper: ${m}.${k}`)).sort());
});

test('a complete theme builds with no theme warning', () => {
  const r = build(setup({}), 'paper');
  assert.equal(r.status, 0, r.text);
  assert.doesNotMatch(r.stdout, /warning/);
});

test('an old-token theme with a failed contrast pair still exits 1 and writes no page', () => {
  const theme = withoutNewTokens(paper());
  theme.light.text3 = '#cccccc';
  const r = build(setup({ oldpale: theme }), 'oldpale');
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /theme oldpale: light\.text3/);
  assert.match(r.text, /against surface2; needs 4\.5:1/, 'judged against the fallback surface step');
  assert.equal(fs.existsSync(r.page), false);
});

test('a complete theme with a failed contrast pair exits 1', () => {
  const theme = paper();
  theme.light.text3 = '#cccccc';
  const r = build(setup({ pale: theme }), 'pale');
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /theme pale: light\.text3/);
  assert.equal(fs.existsSync(r.page), false);
});

test('a theme missing a token that has no fallback exits 1', () => {
  const theme = withoutNewTokens(paper());
  delete theme.dark.text;
  const r = build(setup({ notext: theme }), 'notext');
  assert.equal(r.status, 1, r.text);
  assert.match(r.text, /theme notext: dark\.text: missing/);
  assert.equal(fs.existsSync(r.page), false);
});
