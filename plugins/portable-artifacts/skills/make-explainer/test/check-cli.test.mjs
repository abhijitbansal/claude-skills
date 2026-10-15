import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFile, buildSpec, exampleFile, haveBrowser, scratchDir } from './helpers/browser.mjs';
import { checkPage } from '../scripts/check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = path.join(ROOT, 'scripts/check.mjs');

const cli = (args, env = {}) => spawnSync(process.execPath, [CHECK, ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', ...env } });
const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

// A copy of a built page with `extra` markup placed before </body>.
function withExtra(built, extra, name) {
  assert.ok(built.html.includes('</body>'), 'page has a closing body tag');
  const file = path.join(path.dirname(built.file), `${name}.html`);
  fs.writeFileSync(file, built.html.replace('</body>', `${extra}\n</body>`));
  return file;
}

const deck = (count = 3) => buildSpec({ title: 'Deck', mode: 'slides', sections: Array.from({ length: count }, (_, i) => ({ type: 'text', title: `Topic ${i + 1}`, text: `Body ${i + 1}.` })) });

// ---- usage, skip -----------------------------------------------------------------------------

test('no file, two files, an unknown flag and a missing file exit 2 with the usage', () => {
  for (const args of [[], ['a.html', 'b.html'], ['--nope'], [path.join(scratchDir(), 'missing.html')]]) {
    const r = cli(args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stdout + r.stderr, /usage: node scripts\/check\.mjs <page\.html>|cannot read/);
  }
});

test('without a browser the check skips: exit 0 and the install hint', () => {
  const built = buildFile(exampleFile('concept'));
  const r = cli([built.file], { PA_NO_BROWSER: '1' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: skipped \(no browser: [^;\n]+; ask the user, then run: node \S*doctor\.mjs\S* --for check --fix chromium\)/);
  assert.doesNotMatch(r.stdout, /npx playwright install/);
  const j = JSON.parse(cli([built.file, '--json'], { PA_NO_BROWSER: '1' }).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.skipped, true);
  assert.match(j.hint, /^ask the user, then run: node \S*doctor\.mjs\S* --for check --fix chromium$/);
});

test('PA_CHECK_TIMEOUT_MS must be a positive number', () => {
  const built = buildFile(exampleFile('concept'));
  const r = cli([built.file], { PA_CHECK_TIMEOUT_MS: 'soon' });
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /PA_CHECK_TIMEOUT_MS must be a positive number/);
});

// ---- clean pages pass ------------------------------------------------------------------------

for (const name of ['concept', 'checklist', 'slides', 'recap']) {
  test(`the ${name} example passes at 1280 and 390`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const result = await checkPage(buildFile(exampleFile(name)).file);
    assert.deepEqual(result.problems, []);
    assert.equal(result.status, 'ok');
    assert.equal(result.viewports, 2);
  });
}

test('the CLI prints one ok line for a clean page, and --json says so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildFile(exampleFile('slides'));
  const r = cli([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(2 viewports, \d+ slides\)\n$/);
  const j = JSON.parse(cli([file, '--json']).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.viewports, 2);
});

// ---- each problem fails with a clear line ----------------------------------------------------

test('a console error fails with its text and the viewport', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = withExtra(buildFile(exampleFile('concept')), '<script>console.error("boom")</script>', 'console-error');
  const result = await checkPage(file);
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.includes('1280px: console error: boom'), result.problems.join('\n'));
  assert.ok(result.problems.includes('390px: console error: boom'));
});

test('a console warning and an uncaught error fail too', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = withExtra(buildFile(exampleFile('concept')), '<script>console.warn("careful"); setTimeout(function () { throw new Error("late") }, 0)</script>', 'warn-throw');
  const result = await checkPage(file);
  assert.ok(result.problems.includes('1280px: console warning: careful'), result.problems.join('\n'));
  assert.ok(result.problems.includes('1280px: page error: late'));
});

test('a forced page overflow fails and names the viewport and the sizes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = withExtra(buildFile(exampleFile('concept')), '<div id="forced" style="width:3000px;height:10px">wide</div>', 'overflow');
  const result = await checkPage(file);
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.some((p) => /^1280px: the page scrolls sideways \(3\d\d\dpx wide in 1280px\)/.test(p)), result.problems.join('\n'));
  assert.ok(result.problems.some((p) => /^390px: the page scrolls sideways/.test(p)));
  assert.ok(result.problems.some((p) => /^390px: .*#forced is 3000px wide/.test(p)), 'the widest element is named');
});

test('an element wider than the page that sits inside a scrolling region is fine', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const file = withExtra(buildFile(exampleFile('concept')), '<div style="overflow-x:auto;width:200px"><div style="width:3000px;height:10px">inside</div></div>', 'contained');
  const result = await checkPage(file);
  assert.deepEqual(result.problems, []);
});

test('a deck whose keys do not work stops short of its last slide and says where', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const stuck = '<script>window.addEventListener("keydown", function (e) { e.stopImmediatePropagation(); }, true);</script>';
  const result = await checkPage(withExtra(deck(), stuck, 'stuck'));
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.some((p) => /^1280px: the deck stopped at slide 1 of 4 after the arrow keys; expected slide 4 of 4$/.test(p)), result.problems.join('\n'));
});

test('a deck whose counter disagrees with the slide fails', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const wrong = '<script>document.querySelector(".deck-count").lastChild.textContent = " / 9";</script>';
  const result = await checkPage(withExtra(deck(), wrong, 'counter'));
  assert.ok(result.problems.some((p) => /the counter reads "4 \/ 9", expected "4 \/ 4"/.test(p)), result.problems.join('\n'));
});

test('Present is exercised on a page with a diagram: open, then Esc closes it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const flow = { title: 'Path', type: 'flow', nodes: [{ id: 'a', label: 'Start', kind: 'start' }, { id: 'b', label: 'Do it' }, { id: 'c', label: 'Done', kind: 'end' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }] };
  const built = buildSpec({ title: 'With a figure', sections: [{ type: 'text', text: 'Intro.' }, { type: 'diagram', title: 'The path', diagram: flow }] });
  const result = await checkPage(built.file);
  assert.deepEqual(result.problems, []);
  assert.equal(result.presented, 1, 'one overlay was opened and closed');
  // Break closing: the overlay stays open after Esc and the check says so.
  const broken = withExtra(built, '<script>document.querySelectorAll("[data-dg-dialog]").forEach(function (d) { d.close = function () {}; });</script>', 'no-esc');
  const failed = await checkPage(broken);
  assert.ok(failed.problems.some((p) => /Present overlay did not close/.test(p)), failed.problems.join('\n'));
});

// ---- watchdog --------------------------------------------------------------------------------

test('a check that outlives its cap is a failure, not a hang', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('concept'));
  const r = cli([built.file], { PA_CHECK_TIMEOUT_MS: '1' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /check: timed out after 0\.001 s/);
});
