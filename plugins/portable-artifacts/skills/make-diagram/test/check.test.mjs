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
const SKIP_RE = /^check: skipped \(no browser: [^;\n]+; run: npx playwright install chromium\)\n$/;
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
    assert.match(r.stdout, /^check: ok \(2 viewports, \d+ steps\)\n$/);
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
  assert.ok(body.steps > 0);
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
});

test('without playwright installed the check skips and exits 0', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shared'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  for (const f of ['scripts/check.mjs', 'scripts/lib/browser.mjs', 'shared/cli.mjs']) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  const { file } = buildPage(example('flow'), { name: 'flow' });
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts/check.mjs'), file], { encoding: 'utf8', env: { ...process.env, PA_NO_BROWSER: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, SKIP_RE);
  assert.match(r.stdout, /no browser: playwright is not installed/);
});

// ---- CLI rules --------------------------------------------------------------------------------------

test('usage errors exit 2', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['a.html', 'b.html']).status, 2);
  const unknown = run(['--bogus']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown option '--bogus'; usage: node scripts\/check\.mjs <page\.html> \[--json\]/);
  const missing = run([path.join(tmp(), 'nope.html')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /cannot read/);
  const json = JSON.parse(run(['--json']).stdout);
  assert.equal(json.ok, false);
});

// ---- size budget: <= 400 KB per built example ------------------------------------------------------------

for (const name of EXAMPLES) {
  test(`${name}: the built example is within the 400 KB budget`, () => {
    const { html } = buildPage(example(name), { name });
    assert.ok(Buffer.byteLength(html) <= 400 * 1024, `${Buffer.byteLength(html)} bytes`);
  });
}

test('the page limit is 400 KB and an oversized page is refused without writing', async () => {
  assert.equal(MAX_PAGE_BYTES, 400 * 1024);
  const dir = tmp();
  const spec = path.join(dir, 'flow.diagram.json');
  fs.writeFileSync(spec, JSON.stringify(example('flow')));
  const out = path.join(dir, 'big.html');
  const { html } = buildPage(example('flow'), { name: 'flow' });
  const exactly = Buffer.byteLength(html);
  const refused = await build(spec, { out, maxBytes: exactly - 1 });
  assert.equal(refused.ok, false);
  assert.match(refused.errors[0].message, /the page is \d+ KB; the limit is \d+ KB/);
  assert.ok(!fs.existsSync(out), 'nothing was written');
  const accepted = await build(spec, { out, maxBytes: exactly });
  assert.equal(accepted.ok, true);
  assert.ok(fs.existsSync(out));
});
