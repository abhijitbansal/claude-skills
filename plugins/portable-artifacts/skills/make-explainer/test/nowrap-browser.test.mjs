// Numbers, percentages and KPI values stay on one line in a built page and in a deck. Driven in a real
// browser with the shared probes: nowrapProblems finds every number-plus-unit token that spans two lines,
// overflowProblems finds a KPI value that is wider than its tile.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkPage } from '../scripts/check.mjs';
import { buildFile, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { nowrapProblems, overflowProblems } from '../shared/nowrap-probe.mjs';

after(closeSharedBrowser);

const CHECK = fileURLToPath(new URL('../scripts/check.mjs', import.meta.url));
const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

// A token wraps only where a line happens to break just before its unit, so one width can pass by luck:
// besides the two widths the spec names, the page is swept across phone widths.
const SWEEP = Array.from({ length: 21 }, (_, i) => 320 + i * 8);

async function problemsAt(page, width) {
  await page.setViewportSize({ width, height: 900 });
  return {
    wraps: await nowrapProblems(page),
    overflow: [...await overflowProblems(page, '.kpi'), ...await overflowProblems(page, '.kpi-value')],
  };
}

const failuresAcross = async (page, widths) => {
  const failures = [];
  for (const width of widths) {
    const { wraps, overflow } = await problemsAt(page, width);
    if (wraps.length || overflow.length) failures.push({ width, wraps: wraps.map((w) => w.text), overflow: overflow.map((o) => o.text) });
  }
  return failures;
};

test('page: no number-plus-unit token wraps and no KPI value spills its tile, at 390 and 1280', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(fixture('nowrap.explainer.json'));
  const { page, problems, context } = await openPage(url);
  assert.deepEqual(await failuresAcross(page, [390, 1280]), []);
  assert.deepEqual(problems, []);
  await context.close();
});

test('page: the same holds at every phone width from 320 to 480', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(fixture('nowrap.explainer.json'));
  const { page, context } = await openPage(url);
  assert.deepEqual(await failuresAcross(page, SWEEP), []);
  await context.close();
});

for (const theme of ['dusk', 'press', 'poster']) {
  test(`page and slides in the ${theme} theme: no KPI value spills its tile or wraps`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    for (const name of ['nowrap.explainer.json', 'nowrap-slides.explainer.json']) {
      const { url } = buildFile(fixture(name), { theme });
      const { page, context } = await openPage(url);
      assert.deepEqual(await failuresAcross(page, [390, 1280]), [], `${name} in ${theme}`);
      await context.close();
    }
  });
}

test('slides: no token wraps and no KPI value spills its tile at 390 and 1280', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(fixture('nowrap-slides.explainer.json'));
  const { page, problems, context } = await openPage(url, { width: 390, height: 780 });
  for (const width of [390, 1280]) {
    const { wraps, overflow } = await problemsAt(page, width);
    assert.deepEqual(wraps, [], `tokens wrap at ${width}px`);
    assert.deepEqual(overflow.map((o) => o.text), [], `KPI values spill at ${width}px`);
  }
  assert.deepEqual(problems, []);
  await context.close();
});

test('the KPI tile holds a long value on one line and sizes it down instead of spilling', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(fixture('nowrap.explainer.json'));
  const { page, context } = await openPage(url, { width: 390 });
  const style = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.kpi-value')].find((v) => v.textContent.startsWith('On track'));
    const cs = getComputedStyle(el);
    return { whiteSpace: cs.whiteSpace, containerType: getComputedStyle(el.parentElement).containerType, tileOwnsWidth: el.scrollWidth <= el.clientWidth + 1 };
  });
  assert.equal(style.whiteSpace, 'nowrap');
  assert.equal(style.containerType, 'inline-size');
  assert.equal(style.tileOwnsWidth, true);
  await context.close();
});

test('the probes fire: a value sized for fewer characters than it has spills its tile, on one line', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(fixture('nowrap.explainer.json'));
  const { page, context } = await openPage(url, { width: 390 });
  await page.addStyleTag({ content: '.kpi-value { --n: 1 !important; }' });
  assert.ok((await overflowProblems(page, '.kpi-value')).length > 0, 'a value that is too big for its tile is reported');
  assert.deepEqual(await nowrapProblems(page, { root: '.kpis' }), [], 'and it still has not wrapped');
  await context.close();
});

// ---- the grid keeps its shape around a wide value --------------------------------------------

// For each KPI grid holding a wide value: the rows its tiles form, as [{ top, filled }], where `filled` is
// the share of the grid's width the row's tiles and gaps take. A hole beside short tiles shows as a low share.
const rowFill = (page) => page.evaluate(() => [...document.querySelectorAll('.kpis')]
  .filter((grid) => grid.querySelector('.kpi-wide'))
  .map((grid) => {
    const g = grid.getBoundingClientRect();
    const rows = new Map();
    for (const tile of grid.querySelectorAll('.kpi')) {
      const r = tile.getBoundingClientRect();
      const row = rows.get(Math.round(r.top)) ?? { right: 0, left: Infinity };
      rows.set(Math.round(r.top), { right: Math.max(row.right, r.right), left: Math.min(row.left, r.left) });
    }
    return { title: grid.closest('section')?.querySelector('h2')?.textContent, rows: [...rows.values()].map((r) => (r.right - r.left) / g.width) };
  }));

for (const theme of [undefined, 'dusk', 'press', 'poster']) {
  test(`a wide KPI value leaves no hole in its grid rows at 1280 and 390 (${theme ?? 'paper'})`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { url } = buildFile(fixture('nowrap-kpi-mix.explainer.json'), { theme });
    const { page, context } = await openPage(url);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const grids = await rowFill(page);
      assert.equal(grids.length, 2, 'the two sections that hold a wide value');
      for (const { title, rows } of grids) {
        for (const share of rows) assert.ok(share >= 0.95, `${title} at ${width}px: a row fills ${Math.round(share * 100)}% of the grid`);
      }
      assert.deepEqual(await overflowProblems(page, '.kpi-value'), [], `no spill at ${width}px`);
    }
    await context.close();
  });
}

// ---- scripts/check.mjs ----------------------------------------------------------------------

// A copy of a built page with `extra` markup placed before </body>.
function withExtra(built, extra, name) {
  const file = path.join(path.dirname(built.file), `${name}.html`);
  fs.writeFileSync(file, built.html.replace('</body>', `${extra}\n</body>`));
  return file;
}

test('check: the fixture page and deck pass at both viewports', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const name of ['nowrap.explainer.json', 'nowrap-slides.explainer.json']) {
    const result = await checkPage(buildFile(fixture(name)).file);
    assert.deepEqual(result.problems, [], name);
    assert.equal(result.status, 'ok');
  }
});

test('check: a token that wraps and a KPI value that spills each fail the check, at both viewports', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(fixture('nowrap.explainer.json'));
  const bad = '<p style="width:60px;font:16px/1.4 monospace">aaaa 1,204 ms</p><style>.kpi-value { --n: 1 !important; }</style>';
  const result = await checkPage(withExtra(built, bad, 'bad-numbers'));
  assert.equal(result.status, 'failed');
  for (const label of ['1280px', '390px']) {
    assert.ok(result.problems.includes(`${label}: a number-plus-unit token wraps across lines: "1,204 ms"`), result.problems.join('\n'));
    assert.ok(result.problems.some((p) => p.startsWith(`${label}: a KPI value overflows its tile: "`)), result.problems.join('\n'));
  }
  const cli = spawnSync(process.execPath, [CHECK, withExtra(built, bad, 'bad-numbers-cli')], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
});

test('the checklist counters, the deck counter and numeric table cells never wrap', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const page1 = buildFile(fixture('nowrap.explainer.json'));
  const a = await openPage(page1.url, { width: 320 });
  const held = await a.page.evaluate(() => [...document.querySelectorAll('.cl-count, .cl-pct, .cl-tally, td.nw')].map((el) => ({ cls: el.className, ws: getComputedStyle(el).whiteSpace })));
  assert.ok(held.length >= 6, `found ${held.length} counters and numeric cells`);
  for (const h of held) assert.equal(h.ws, 'nowrap', h.cls);
  await a.context.close();
  const deck = buildFile(fixture('nowrap-slides.explainer.json'));
  const b = await openPage(deck.url, { width: 390, height: 780 });
  assert.equal(await b.page.evaluate(() => getComputedStyle(document.querySelector('.deck-count')).whiteSpace), 'nowrap');
  await b.context.close();
});
