import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildFile, buildSpec, exampleFile, haveBrowser, scratchDir } from './helpers/browser.mjs';
import { checkPage, isConsoleProblem } from '../scripts/check.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHECK = path.join(ROOT, 'scripts/check.mjs');

const fixture = (name) => path.join(ROOT, 'test/fixtures', name);
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
  test(`the ${name} example passes at 1280, 390 and 1800`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const result = await checkPage(buildFile(exampleFile(name)).file);
    assert.deepEqual(result.problems, []);
    assert.equal(result.status, 'ok');
    assert.equal(result.viewports, 3);
  });
}

test('the CLI prints one ok line for a clean page, and --json says so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildFile(exampleFile('slides'));
  const r = cli([file]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^check: ok \(3 viewports, \d+ slides\)\n$/);
  const j = JSON.parse(cli([file, '--json']).stdout);
  assert.equal(j.ok, true);
  assert.equal(j.viewports, 3);
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

// ---- chromium GL driver hints are not page problems ---------------------------------------------

test('a GL driver performance message is not a console problem, any other warning still is', () => {
  const stall = '[.WebGL-0x1234abcd]GL Driver Message (OpenGL, Performance, GL_CLOSE_PATH_NV, High): GPU stall due to ReadPixels';
  assert.equal(isConsoleProblem('warning', stall), false);
  assert.equal(isConsoleProblem('warning', 'careful'), true);
  assert.equal(isConsoleProblem('warning', '[.WebGL-0x1]GL Driver Message (OpenGL, Other, X, High): something else'), true);
  assert.equal(isConsoleProblem('error', stall), true, 'an error of that shape is still an error');
});

// ---- guardrail proof on a real old page ------------------------------------------------------

test('guardrail proof: a 0.8.0 page whose KPI values wrap only in a wide window fails at 1800 px and nowhere else', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(fixture('legacy-kpi-wide-wrap.html'));
  assert.equal(result.status, 'failed', result.problems.join('\n'));
  assert.ok(result.problems.includes('1800px: a number-plus-unit token wraps across lines: "39 ms"'), result.problems.join('\n'));
  assert.deepEqual(result.problems.filter((p) => !p.startsWith('1800px:')), [], 'the two older viewports stay clean');
  const r = cli([fixture('legacy-kpi-wide-wrap.html')]);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /^1800px: a number-plus-unit token wraps across lines: "39 ms"\ncheck: 1 problem\n$/);
});

// ---- the checklist saving probe (PA-03) ------------------------------------------------------------
// Written without a browser run: the orchestrator's serial browser pass runs them.

test('a checklist page passes the saving probe: tick, reload, still ticked, Reset empties the entry', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(buildFile(exampleFile('checklist')).file);
  assert.deepEqual(result.problems, []);
  assert.equal(result.status, 'ok');
});

test('guardrail proof: a page whose script saves ticks under another key fails the probe and names the entry it expected', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('checklist'));
  assert.ok(built.html.includes("'pa-checklist:'"), 'the runtime builds the entry name from this prefix');
  const broken = path.join(path.dirname(built.file), 'broken-key.html');
  fs.writeFileSync(broken, built.html.replace("'pa-checklist:'", "'pa-checklst:'"));
  const result = await checkPage(broken);
  assert.equal(result.status, 'failed');
  assert.ok(result.problems.some((p) => /^1280px \(http\): checklist 1: ticking an item saved nothing under "pa-checklist:/.test(p)), result.problems.join('\n'));
});

test('a page with no checklist runs no saving probe', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const result = await checkPage(buildFile(exampleFile('concept')).file);
  assert.deepEqual(result.problems.filter((p) => /\(http\)/.test(p)), []);
});

// ---- --shots (PA-21) -------------------------------------------------------------------------------

// shot.mjs refuses to start while another headless browser runs (the guard is for one person's Mac). `node --test`
// runs the test files side by side, so a sibling file's browser is usually live here (it was on CI): these tests mean
// to run beside it, the deliberate second run the guard names.
const SHOTS_ENV = { ALLOW_BROWSER_RUN: '1' };

test('--shots writes a PNG per width and colour scheme into the folder and prints each path', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { file } = buildFile(exampleFile('checklist'));
  const out = path.join(scratchDir(), 'shots-out');
  const r = cli([file, '--shots', out], SHOTS_ENV);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const names = fs.readdirSync(out).sort();
  assert.equal(names.length, 4, names.join(', '));
  for (const width of [390, 1280]) for (const scheme of ['light', 'dark']) assert.ok(names.some((n) => n.endsWith(`-${width}-${scheme}.png`)), `${width} ${scheme}`);
  for (const n of names) assert.ok(r.stdout.includes(path.join(out, n)) || r.stdout.includes(n), `${n} is printed`);
  const json = JSON.parse(cli([file, '--shots', out, '--json'], SHOTS_ENV).stdout.split('\n')[0]);
  assert.equal(json.shots.length, 4);
});

test('--shots with a blank folder is a usage error, and a skipped check takes no shots and says so', () => {
  const { file } = buildFile(exampleFile('concept'));
  const blank = cli([file, '--shots', ' ']);
  assert.equal(blank.status, 2);
  assert.match(blank.stdout + blank.stderr, /--shots needs a folder path/);
  const skipped = cli([file, '--shots', path.join(scratchDir(), 'never')], { PA_NO_BROWSER: '1' });
  assert.equal(skipped.status, 0, skipped.stdout + skipped.stderr);
  assert.match(skipped.stdout, /^shots: skipped \(the check was skipped\)\n$/m);
  assert.ok(!fs.existsSync(path.join(scratchDir(), 'never')));
});

// ---- scrolling regions (G-07, G-08) ----------------------------------------------------------------

test('a deck slide whose table scrolls vertically at 390 px is a warning, not a failure', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // The deck's table limit is 8 rows, so the rows themselves are tall: the cost cell wraps to several lines at 390 px.
  // (Eight one-line rows fitted the frame on the CI runner, so the test no longer leans on the host's font metrics.)
  const note = 'billed per seat, with a yearly true-up, a support tier and a metered overage that is invoiced after the month closes';
  const rows = Array.from({ length: 8 }, (_, i) => [`Item ${i + 1}`, `${(i + 1) * 100} a month, ${note}`]);
  const built = buildSpec({ title: 'Table deck', mode: 'slides', sections: [{ type: 'table', title: 'The costs', columns: ['Item', 'Cost'], rows }] });
  const result = await checkPage(built.file);
  assert.equal(result.status, 'ok', result.problems.join('\n'));
  assert.ok((result.warnings ?? []).some((w) => /^390px: slide \d+: its table needs \d+ px of vertical scrolling/.test(w)), JSON.stringify(result.warnings));
  assert.ok(!(result.warnings ?? []).some((w) => /^1280px/.test(w)), 'only at phone width');
});

test('a diagram that scrolls sideways with its cue line removed fails; with the cue showing it passes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const row = { title: 'Search path', type: 'flow', direction: 'right', nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `Stage number ${i + 1}` })), edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) };
  const built = buildSpec({ title: 'Wide', sections: [{ type: 'text', text: 'Intro.' }, { type: 'diagram', title: 'The path', diagram: row }] });
  const ok = await checkPage(built.file);
  assert.deepEqual(ok.problems, []);
  const cueless = withExtra(built, '<script>document.querySelectorAll("[data-dg-cue]").forEach(function (c) { c.remove(); });</script>', 'no-cue');
  const failed = await checkPage(cueless);
  assert.ok(failed.problems.some((p) => /^390px: diagram 1 scrolls sideways .* but shows no cue/.test(p)), failed.problems.join('\n'));
});
