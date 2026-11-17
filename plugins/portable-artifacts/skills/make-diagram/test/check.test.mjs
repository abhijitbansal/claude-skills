import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from '../scripts/build.mjs';
import { MAX_PAGE_BYTES } from '../scripts/lib/viewer.mjs';
import { haveBrowser, buildPage, example, EXAMPLES } from './helpers/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = path.join(ROOT, 'scripts/check.mjs');
const SKIP_RE = /^check: skipped \(no browser: [^;\n]+; ask the user, then run: node \S*doctor\.mjs\S* --for check --fix (dev_deps|chromium)\)\n$/;
const run = (args, env = {}) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-check-'));

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

// A page edited on disk: `edit` maps the built HTML to the doctored HTML.
const doctored = (name, edit) => {
  const { file, html } = buildPage(example(name), { name });
  const out = edit(html);
  assert.notEqual(out, html, 'the edit changed the page');
  const bad = file.replace(/\.html$/, '-doctored.html');
  fs.writeFileSync(bad, out);
  return bad;
};

// ---- the browser checks ------------------------------------------------------------------------

for (const name of EXAMPLES) {
  test(`${name}: a good page passes`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { file } = buildPage(example(name), { name });
    const r = run([file]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^check: ok \(2 viewports, \d+ beats\)\n$/);
  });
}

test('--json mirrors the passing result', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const r = run([file, '--json']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const body = JSON.parse(r.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.viewports, 2);
  assert.ok(body.beats > 0);
});

test('a label doctored too wide for its box fails and names the node id', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace(/(data-id="begin"[^>]*>.*?<tspan[^>]*>)Start(<\/tspan>)/, '$1Start a very very very very long label that cannot fit$2'));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: node "begin": text overflows its box by [\d.]+ px$/m);
  assert.match(r.stdout, /^390px: node "begin": text overflows its box by/m);
  assert.match(r.stdout, /check: \d+ problems?\n$/);
  const json = JSON.parse(run([bad, '--json']).stdout);
  assert.equal(json.ok, false);
  assert.ok(json.errors.some((e) => e.message.includes('node "begin"')));
});

test('a console error fails the check', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('</body>', '<script>console.error("boom")</script></body>'));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: console error: boom$/m);
});

test('a presentation that cannot reach its last step fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('function next() { if (presenting) goTo(stepIndex + 1); }', 'function next() {}'));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: presentation stopped at "1 \/ \d+", expected "\d+ \/ \d+"$/m);
});

test('a page wider than the viewport fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('</body>', '<div style="position:absolute;left:0;top:0;width:3000px;height:1px"></div></body>'));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /the page overflows the viewport/);
});

// A doctored page must really differ: a replace whose target drifted would leave a good page.
const swap = (html, from, to) => {
  assert.ok(html.includes(from), `the page still contains ${JSON.stringify(from)}`);
  return html.replace(from, to);
};
// Makes the camera's fit ignore the legend overlay.
const IGNORE_OVERLAY = ['var shown = r.height > 0 && r.width > 0 && o && o.height > 0;', 'var shown = false;'];

test('a legend overlay sitting on a node fails and names the node', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // The camera is told to ignore the overlay too, or it would fit the drawing into the sliver the stage-sized overlay leaves.
  const bad = doctored('flow', (html) => swap(swap(html, '.legend { position: absolute; top: 10px; right: 12px; z-index: 1; max-width: min(60%, 400px);', '.legend { position: absolute; inset: 0; z-index: 1; max-width: none;'), IGNORE_OVERLAY[0], IGNORE_OVERLAY[1]));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: node "[a-z-]+" is \d+% under the legend overlay$/m);
  assert.match(r.stdout, /^390px: node "[a-z-]+" is \d+% under the legend overlay$/m);
  assert.ok(JSON.parse(run([bad, '--json']).stdout).problems.some((p) => p.includes('under the legend overlay')));
});

test('a camera that ignores the legend overlay (fits the whole padded canvas) fails at 390 px, where it covers the first node', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // The phone's folded legend is undone too (its keys show): the guard needs the overlay as tall as it wraps to reach the first node.
  const PHONE_LEGEND = '  .lg-keys { display: none; }\n';
  const bad = doctored('flow', (html) => swap(swap(swap(html, 'var fitBox = overlay &&', 'var fitBox = false && overlay &&'), IGNORE_OVERLAY[0], IGNORE_OVERLAY[1]), PHONE_LEGEND, ''));
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^390px: node "begin" is \d+% under the legend overlay$/m);
});

test('a page missing its presentation caption fails with a problem line, quickly', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('data-pa-count', 'data-pa-gone'));
  const started = Date.now();
  const r = run([bad]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /^1440px: check crashed: .*data-pa-count/m);
  assert.ok(Date.now() - started < 25000, 'selector reads do not wait for the 30 s Playwright default');
  const json = run([bad, '--json']);
  assert.equal(json.status, 1);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, false);
  assert.ok(body.problems.some((p) => p.includes('check crashed')));
  assert.ok(body.errors.length > 0);
});

test('a missing #pa-data block fails as a crashed check, not a stack trace', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('id="pa-data"', 'id="pa-other"'));
  const r = run([bad, '--json']);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, false);
});

test('a page stuck in an infinite loop hits the wall-clock cap instead of hanging', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('</body>', '<script>for(;;){}</script></body>'));
  const started = Date.now();
  const r = run([bad], { PA_CHECK_TIMEOUT_MS: '1500' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stdout, 'check: timed out after 1.5 s\n');
  assert.ok(Date.now() - started < 20000);
  const json = JSON.parse(run([bad, '--json'], { PA_CHECK_TIMEOUT_MS: '1500' }).stdout);
  assert.equal(json.ok, false);
  assert.deepEqual(json.problems, ['check: timed out after 1.5 s']);
});

test('a bad PA_CHECK_TIMEOUT_MS is a usage error', () => {
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const r = run([file], { PA_CHECK_TIMEOUT_MS: 'soon' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /PA_CHECK_TIMEOUT_MS/);
});

// ---- no browser: skip, never fail ----------------------------------------------------------------

test('PA_NO_BROWSER=1 prints the skip line and exits 0', () => {
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const r = run([file], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, SKIP_RE);
  assert.match(r.stdout, /no browser: PA_NO_BROWSER=1;/);
  const json = JSON.parse(run([file, '--json'], { PA_NO_BROWSER: '1' }).stdout);
  assert.equal(json.ok, true);
  assert.equal(json.skipped, true);
  assert.match(json.hint, /^ask the user, then run: node \S*doctor\.mjs\S* --for check --fix chromium$/);
  assert.doesNotMatch(r.stdout + json.hint, /npx playwright install/);
});

test('without playwright installed the check skips and exits 0', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shared'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['scripts/check.mjs', 'scripts/lib/browser.mjs', 'scripts/lib/doctor-hint.mjs', 'scripts/lib/legibility.mjs', 'scripts/lib/shots.mjs', 'shared/cli.mjs', 'shared/errors.mjs', 'shared/doctor.mjs', 'shared/stale-copy.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/check.mjs'), file], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, SKIP_RE);
  assert.match(r.stdout, /no browser: playwright is not installed/);
  assert.match(r.stdout, /--for check --fix dev_deps\)/);
});

// ---- CLI rules --------------------------------------------------------------------------------------

test('usage errors exit 2', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['a.html', 'b.html']).status, 2);
  const unknown = run(['--bogus']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown option '--bogus'; usage: node scripts\/check\.mjs <page\.html> \[--json\] \[--shots <dir>\]/);
  const missing = run([path.join(tmp(), 'nope.html')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  const json = JSON.parse(run(['--json']).stdout);
  assert.equal(json.ok, false);
});

// ---- size budget: <= the page limit per built example ------------------------------------------------------------

for (const name of EXAMPLES) {
  test(`${name}: the built example is within the page budget`, () => {
    const { html } = buildPage(example(name), { name });
    assert.ok(Buffer.byteLength(html) <= MAX_PAGE_BYTES, `${Buffer.byteLength(html)} bytes`);
  });
}

test('the page limit is 1024 KB and an oversized page is refused without writing', async () => {
  assert.equal(MAX_PAGE_BYTES, 1024 * 1024);
  const dir = tmp();
  const spec = path.join(dir, 'flow.diagram.json');
  fs.writeFileSync(spec, JSON.stringify(example('flow')));
  const out = path.join(dir, 'big.html');
  // The page names its spec and its output file, so its size depends on both names: measure it with the very same
  // names (in another folder), not with a page built under different ones.
  const probeDir = tmp();
  const probeSpec = path.join(probeDir, 'flow.diagram.json');
  fs.writeFileSync(probeSpec, JSON.stringify(example('flow')));
  const probeOut = path.join(probeDir, 'big.html');
  assert.equal((await build(probeSpec, { out: probeOut })).ok, true);
  const exactly = fs.statSync(probeOut).size;
  const refused = await build(spec, { out, maxBytes: exactly - 1 });
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0].message, /the page is \d+ KB; the limit is \d+ KB/);
  assert.ok(!fs.existsSync(out), 'nothing was written');
  const accepted = await build(spec, { out, maxBytes: exactly });
  assert.equal(accepted.ok, true);
  assert.ok(fs.existsSync(out));
});

// ---- PA-22: the legibility rule ---------------------------------------------------------------------------------

const chainSpec = (n) => ({
  title: `chain of ${n}`,
  type: 'architecture',
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Service number ${i}` })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: 'calls' })),
});

test('a 60-node chain fails the legibility rule at 1440 px (not at 390 px) and says what to do', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildPage(chainSpec(60), { name: 'sixty-chain' });
  const r = run([file]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1440px: the diagram fits on this screen at \d+% zoom, so labels draw about [\d.]+ px \(the floor is 8 px\): split it into several diagrams/m);
  assert.doesNotMatch(r.stdout, /^390px: the diagram fits/m, 'a phone fits everything small; the rule is for the desktop stage');
});

test('a chain that wraps into legible rows passes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildPage(chainSpec(12), { name: 'twelve-chain' });
  const r = run([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---- PA-21 / NEW-73: --shots -------------------------------------------------------------------------------------

// shot.mjs refuses to start while another headless browser runs (the guard is for one person's Mac). `node --test` runs
// the test files side by side, so a sibling file's browser is usually live here: these tests mean to run beside it.
const SHOTS_ENV = { ALLOW_BROWSER_RUN: '1' };

test('--shots writes a PNG per viewport and colour scheme and prints each path', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const out = tmp();
  const r = run([file, '--shots', out], SHOTS_ENV);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const paths = r.stdout.split('\n').filter((l) => l.endsWith('.png'));
  assert.equal(paths.length, 4, r.stdout);
  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [1280, 'light'], [1280, 'dark']]) {
    const hit = paths.find((p) => p.endsWith(`-${width}-${scheme}.png`));
    assert.ok(hit, `no ${width} ${scheme} shot in ${paths.join(' ')}`);
    assert.equal(fs.readFileSync(hit).subarray(1, 4).toString(), 'PNG');
    assert.ok(hit.startsWith(fs.realpathSync(out)) || hit.startsWith(out), 'written under --shots');
  }
  const json = JSON.parse(run([file, '--shots', out, '--json'], SHOTS_ENV).stdout.split('\n')[0]);
  assert.equal(json.ok, true);
  assert.equal(json.shots.length, 4);
});

test('a failed check still takes its screenshots', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const bad = doctored('flow', (html) => html.replace('</body>', '<script>console.error("boom")</script></body>'));
  const out = tmp();
  const r = run([bad, '--shots', out], SHOTS_ENV);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(r.stdout.split('\n').filter((l) => l.endsWith('.png')).length, 4);
});

test('--shots without a folder, or with a blank one, is a usage error; --help lists it', () => {
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const none = run([file, '--shots']);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /--shots/);
  const blank = run([file, '--shots', ' ']);
  assert.equal(blank.status, 2);
  assert.match(blank.stderr, /--shots needs a folder path/);
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage: node scripts\/check\.mjs <page\.html> \[--json\] \[--shots <dir>\]\n$/);
});

test('a skipped check takes no screenshots and says so', () => {
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const out = path.join(tmp(), 'shots');
  const r = run([file, '--shots', out], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^shots: skipped \(the check was skipped\)\n$/m);
  assert.ok(!fs.existsSync(out), 'nothing was written');
});
