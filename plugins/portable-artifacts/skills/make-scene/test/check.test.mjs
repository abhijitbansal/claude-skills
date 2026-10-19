import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPage } from '../scripts/check.mjs';
import { GRID, MIN_COLOURS } from '../scripts/lib/canvas-shot.mjs';
import { buildWorldPage, haveBrowser } from './helpers/browser.mjs';
import { tempDir } from './helpers/scene-fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = path.join(ROOT, 'scripts/check.mjs');
const SKIP_RE = /^check: skipped \(no browser: [^;\n]+; ask the user, then run: node \S*doctor\.mjs\S* --for check --fix (dev_deps|chromium)\)\n$/;
const TOUR = [{ title: 'First', focus: ['api'], caption: 'one' }, { title: 'Second', focus: ['web'], caption: 'two' }];
const RUN_TIMEOUT_MS = 120000; // a hung check fails its test instead of stalling the suite
const run = (args, env = {}) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', timeout: RUN_TIMEOUT_MS, env: { ...process.env, ...env } });

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const goodPage = async (t, spec = { tour: TOUR }) => (await buildWorldPage(t, 'city', { spec })).file;

// A page edited on disk: `edit` maps the built HTML to the doctored HTML. The edit must change the page.
const doctored = async (t, edit) => {
  const file = await goodPage(t);
  const html = fs.readFileSync(file, 'utf8');
  const out = edit(html);
  assert.notEqual(out, html, 'the edit changed the page');
  const bad = file.replace(/\.html$/, '-doctored.html');
  fs.writeFileSync(bad, out);
  return bad;
};
const injectAtEnd = (script) => (html) => html.replace('</body>', `${script}</body>`);
const injectInHead = (markup) => (html) => html.replace('</head>', `${markup}</head>`);

test('a good page passes at both widths and reports its beats', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await goodPage(t)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'check: ok (2 viewports, 2 beats)\n');
});

test('--json mirrors the passing result', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await goodPage(t), '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, viewports: 2, beats: 2 });
});

test('a page with no tour passes with 0 beats', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await goodPage(t, {})]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout, 'check: ok (2 viewports, 0 beats)\n');
});

test('an injected console error fails the check', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = await doctored(t, injectAtEnd('<script>console.error("boom")</script>'));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: console error: boom$/m);
  assert.match(r.stdout, /^390px: console error: boom$/m);
  assert.match(r.stdout, /check: 2 problems\n$/);
  const json = JSON.parse(run([bad, '--json']).stdout);
  assert.equal(json.ok, false);
  assert.ok(json.errors.some((e) => e.message.includes('console error: boom')));
});

test('a canvas that draws nothing fails as blank', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await doctored(t, injectInHead('<style>canvas { opacity: 0 }</style>'))]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`^1440px: the canvas looks blank \\(1 distinct colours on a ${GRID}x${GRID} grid, need ${MIN_COLOURS}\\)$`, 'm'));
  assert.match(r.stdout, /^390px: the canvas looks blank/m);
});

test('a fallback table that stays visible once WebGL runs fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await doctored(t, injectInHead('<style>[data-scene-fallback] { width: 400px !important; height: 300px !important }</style>'))]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: the fallback table is still visible once WebGL runs \(400x300 px\)$/m);
});

test('a tour that cannot reach its last beat fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const swallow = '<script>window.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") e.stopImmediatePropagation(); }, true);</script>';
  const r = run([await doctored(t, injectInHead(swallow))]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: tour stopped at "1 \/ 2", expected "2 \/ 2"$/m);
});

test('a page wider than the viewport fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await doctored(t, injectAtEnd('<div style="position:absolute;left:0;top:0;width:3000px;height:1px"></div>'))]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /the page overflows the viewport/);
});

test('a page whose scene never draws fails instead of passing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = await doctored(t, (html) => html.replace('<script>if (window.PAScene) PAScene.initAll({ globalKeys: true });</script>', ''));
  const result = await checkPage(bad, { readyMs: 500 });
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.includes('1440px: the scene never left the loading state'), result.problems.join('\n'));
});

test('a browser without WebGL skips with a plain reason instead of failing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const r = run([await doctored(t, injectInHead('<script>HTMLCanvasElement.prototype.getContext = () => null;</script>'))]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: skipped \(no WebGL: WebGL is not available in this browser; /);
  assert.match(r.stdout, /node \S*doctor\.mjs\S* --for check\)\n$/);
  assert.doesNotMatch(r.stdout, /--fix/);
});

test('a page stuck in an infinite loop hits the wall-clock cap instead of hanging', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = await doctored(t, injectAtEnd('<script>for(;;){}</script>'));
  const started = Date.now();
  const r = run([bad], { PA_CHECK_TIMEOUT_MS: '1500' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stdout, 'check: timed out after 1.5 s\n');
  assert.ok(Date.now() - started < 20000);
});

test('a watchdog that fires while the browser is still launching returns at once, then closes it when it lands', async (t) => {
  const calls = [];
  const LAUNCH_MS = 1500;
  const slowLauncher = () => new Promise((resolve) => {
    setTimeout(() => resolve({ close: async () => calls.push('close'), newContext: async () => { calls.push('newContext'); throw new Error('no work after the watchdog'); } }), LAUNCH_MS);
  });
  const file = await goodPage(t);
  const started = Date.now();
  const result = await checkPage(file, { timeoutMs: 50, launcher: slowLauncher });
  const took = Date.now() - started;
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.problems, ['check: timed out after 50 ms']);
  assert.ok(took < LAUNCH_MS / 2, `the verdict did not wait for the launch (${took} ms)`);
  await new Promise((resolve) => setTimeout(resolve, LAUNCH_MS));
  assert.deepEqual(calls, ['close'], 'the late browser was closed and never used');
});

// The CLI's exit backstop (3 s) force-exits a process that something keeps alive, and Playwright kills its browsers when
// the process exits, so a leaked browser cannot be seen after exit. What shows it is how long the exit takes: a browser
// left connected holds Node until the backstop fires, while the close path lets it end at once.
const PROMPT_EXIT_MS = 2500;

test('with a tiny cap the CLI reports the timeout and exits promptly, without waiting for the exit backstop', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = await goodPage(t);
  const started = Date.now();
  const r = run([file], { PA_CHECK_TIMEOUT_MS: '20' });
  const took = Date.now() - started;
  assert.equal(r.status, 1, `exited (signal ${r.signal}): ${r.stdout}${r.stderr}`);
  assert.equal(r.stdout, 'check: timed out after 20 ms\n');
  assert.ok(took < PROMPT_EXIT_MS, `the process held on for ${took} ms after the verdict (a browser was left open)`);
});

test('a bad PA_CHECK_TIMEOUT_MS is a usage error', async (t) => {
  const r = run([await goodPage(t)], { PA_CHECK_TIMEOUT_MS: 'soon' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PA_CHECK_TIMEOUT_MS/);
});

// ---- no browser: skip, never fail --------------------------------------------------------------------

test('PA_NO_BROWSER=1 prints the skip line and exits 0', async (t) => {
  const file = await goodPage(t);
  const r = run([file], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, SKIP_RE);
  assert.match(r.stdout, /no browser: PA_NO_BROWSER=1;/);
  const json = JSON.parse(run([file, '--json'], { PA_NO_BROWSER: '1' }).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.skipped, true);
  assert.match(json.hint, /^ask the user, then run: node \S*doctor\.mjs\S* --for check --fix chromium$/);
});

test('without playwright installed the check skips and exits 0', async (t) => {
  const dir = tempDir(t, 'scene-check-');
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shared'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['scripts/check.mjs', 'scripts/lib/browser.mjs', 'scripts/lib/doctor-hint.mjs', 'scripts/lib/png.mjs', 'scripts/lib/canvas-shot.mjs', 'shared/cli.mjs', 'shared/errors.mjs', 'shared/doctor.mjs']) {
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/check.mjs'), await goodPage(t)], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, SKIP_RE);
  assert.match(r.stdout, /no browser: playwright is not installed/);
  assert.match(r.stdout, /--for check --fix dev_deps\)/);
});

// ---- CLI rules -----------------------------------------------------------------------------------------

test('usage errors exit 2 and list what is accepted', (t) => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['a.html', 'b.html']).status, 2);
  const unknown = run(['--bogus']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown option '--bogus'; usage: node scripts\/check\.mjs <page\.html> \[--json\]/);
  const missing = run([path.join(tempDir(t), 'nope.html')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  const json = JSON.parse(run(['--json']).stdout);
  assert.equal(json.ok, false);
});
