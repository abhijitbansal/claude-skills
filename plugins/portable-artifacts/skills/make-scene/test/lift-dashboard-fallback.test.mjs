// The 2D fallback of a dashboard lift. Vega cannot draw some extreme data (a NaN number format); that one known
// failure becomes a table-only fallback with ONE stderr line. Any other failure of the drawing is a real error and
// must stop the build, never ship a silent table. The drawing is replaced by a fake make-dashboard (the siblingRoot
// seam) that fails in the way a test asks; everything else of the sibling is the real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { liftDashboard } from '../scripts/lifts/dashboard.mjs';
import { loadSibling, siblingDir } from '../scripts/lib/siblings.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { PINNED_ENV, tempDir } from './helpers/scene-fixtures.mjs';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const THEME = loadTheme('dusk');
const DASHBOARD = 'dashboard.json';
const REAL_LIBS = ['pipeline.mjs', 'kinds.mjs', 'axis-ticks.mjs', 'views.mjs'];
const NOTE = /^note: v-spread: drawn as a table in the fallback because its values are too close together for a 2D chart$/;

let skipReason;
try {
  await loadSibling('make-dashboard', 'scripts/lib/pipeline.mjs');
} catch (e) {
  skipReason = `make-dashboard is not loadable (${String(e.message).split('\n')[0]})`;
}
const dtest = (name, fn) => test(name, { skip: skipReason }, fn);

// A dashboard folder: a histogram of two ordinary values (the chart id names it in the note).
function histogramDir(t, values = ['1', '2']) {
  const dir = tempDir(t, 'scene-fb-');
  const sql = values.map((v) => `SELECT ${v}::DOUBLE AS v`).join(' UNION ALL ');
  fs.writeFileSync(path.join(dir, DASHBOARD), JSON.stringify({ title: 'T', sources: {}, queries: { q: sql }, charts: [{ id: 'v-spread', title: 'C', query: 'q', kind: 'histogram', value: 'v' }] }));
  return dir;
}

// A folder of sibling skills whose make-dashboard is the real one except for static-chart.mjs, which is `body`.
function fakeSiblings(t, body) {
  const root = tempDir(t, 'scene-fake-');
  const lib = path.join(root, 'make-dashboard/scripts/lib');
  fs.mkdirSync(lib, { recursive: true });
  const real = path.join(siblingDir('make-dashboard'), 'scripts/lib');
  for (const file of REAL_LIBS) fs.writeFileSync(path.join(lib, file), `export * from ${JSON.stringify(pathToFileURL(path.join(real, file)).href)};\n`);
  fs.writeFileSync(path.join(lib, 'static-chart.mjs'), body);
  return root;
}

const VEGA_FORMAT_FAILURE = `export async function renderThemedSvgs() {
  console.error('ERROR Error: invalid format: ,.NaN~f\\n    at formatSpecifier (d3-format)');
  throw new TypeError("Cannot read properties of undefined (reading 'marktype')");
}`;

// stderr lines written while `fn` runs.
async function stderrOf(fn) {
  const lines = [];
  const write = process.stderr.write.bind(process.stderr);
  const log = console.error;
  const take = (chunk) => { lines.push(...String(chunk).split('\n').filter(Boolean)); return true; };
  process.stderr.write = take;
  console.error = (...args) => take(`${args.join(' ')}\n`);
  try {
    return { result: await fn(), lines };
  } catch (error) {
    return { error, lines };
  } finally {
    process.stderr.write = write;
    console.error = log;
  }
}

dtest('a drawing that fails with something other than the known Vega format failure stops the build loudly', async (t) => {
  const siblingRoot = fakeSiblings(t, "export async function renderThemedSvgs() { throw new Error('the renderer is broken'); }");
  const dir = histogramDir(t);
  await assert.rejects(
    () => liftDashboard({ dashboard: DASHBOARD, chart: 'v-spread' }, { dir, theme: THEME, siblingRoot }),
    /the renderer is broken/,
    'a non-Vega failure must not be swallowed into a table fallback',
  );
});

dtest('a Vega failure that is not the format one is not swallowed either, and what Vega logged still reaches stderr', async (t) => {
  const siblingRoot = fakeSiblings(t, `export async function renderThemedSvgs() { console.error('ERROR Error: Unrecognized scale type'); throw new Error('bad scale'); }`);
  const dir = histogramDir(t);
  const { error, lines } = await stderrOf(() => liftDashboard({ dashboard: DASHBOARD, chart: 'v-spread' }, { dir, theme: THEME, siblingRoot }));
  assert.match(String(error?.message), /bad scale/);
  assert.ok(lines.some((l) => /Unrecognized scale type/.test(l)), `Vega's own error is kept: ${lines.join(' | ')}`);
});

dtest('the known Vega format failure is a table-only fallback: no ERROR lines, exactly one note', async (t) => {
  const siblingRoot = fakeSiblings(t, VEGA_FORMAT_FAILURE);
  const dir = histogramDir(t);
  const { result, lines } = await stderrOf(() => liftDashboard({ dashboard: DASHBOARD, chart: 'v-spread' }, { dir, theme: THEME, siblingRoot }));
  assert.equal(result.fallback.kind, 'table');
  assert.ok(!result.fallback.svg && !result.fallback.svgDark, 'no drawing, only the table');
  assert.deepEqual(result.fallback.columns, ['v']);
  assert.equal(lines.some((l) => /ERROR/.test(l)), false, lines.join(' | '));
  assert.equal(lines.length, 1, lines.join(' | '));
  assert.match(lines[0], NOTE);
});

dtest('build.mjs on values too close together for a 2D chart prints no Vega stack and one note line', (t) => {
  const dir = histogramDir(t, ['33.333333333333336', '33.33333333333333']);
  fs.writeFileSync(path.join(dir, 'scene.json'), JSON.stringify({ title: 'Close', lift: { dashboard: DASHBOARD, chart: 'v-spread' } }));
  const out = path.join(dir, 'out.html');
  const r = spawnSync(process.execPath, [path.join(SCRIPTS, 'build.mjs'), path.join(dir, 'scene.json'), '--out', out], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, EVAL_LOG: '' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(/ERROR|\s+at \S+ \(/.test(r.stderr), false, `no Vega stack on stderr:\n${r.stderr.split('\n').slice(0, 4).join('\n')}`);
  const notes = r.stderr.split('\n').filter((l) => l.startsWith('note:'));
  assert.equal(notes.length, 1, r.stderr);
  assert.match(notes[0], NOTE);
  assert.ok(fs.existsSync(out));
  const v = spawnSync(process.execPath, [path.join(SCRIPTS, 'validate.mjs'), path.join(dir, 'scene.json')], { encoding: 'utf8', env: { ...process.env, ...PINNED_ENV, EVAL_LOG: '' } });
  assert.equal(v.status, 0, v.stderr);
  assert.equal(v.stderr.split('\n').filter((l) => l.startsWith('note:')).length, 1, `validate draws once per theme but says it once: ${v.stderr}`);
  assert.equal(/ERROR/.test(v.stderr), false);
});
