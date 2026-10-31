// The one-line values in a KPI section are drawn at one size: the renderer puts the longest one-line value's
// length on the section (--n), and the CSS sizes every value from it. Driven in a real browser, page and deck.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { buildFile, buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { overflowProblems } from '../shared/nowrap-probe.mjs';

after(closeSharedBrowser);

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

// Per .kpis group: { hasWide, rows }; rows lists, per visual row (rounded top of the tile), the computed
// font sizes (px) of the group's one-line values. kpi-wide and kpi-long values size themselves and are left out; a group
// that is not drawn (a slide that is not showing) is left out too.
const sizesPerGroup = (page) => page.evaluate(() => [...document.querySelectorAll('.kpis')]
  .filter((group) => group.getClientRects().length > 0)
  .map((group) => {
    const rows = new Map();
    for (const tile of group.querySelectorAll('.kpi:not(.kpi-wide):not(.kpi-long)')) {
      const top = Math.round(tile.getBoundingClientRect().top);
      const size = parseFloat(getComputedStyle(tile.querySelector('.kpi-value')).fontSize);
      rows.set(top, [...(rows.get(top) ?? []), size]);
    }
    return { hasWide: group.querySelector('.kpi-wide') !== null, rows: [...rows.values()] };
  }));

// Sizes agree when they differ by no more than this: layout snaps track widths to 1/64 px, which moves a size by ~0.003px.
const SIZE_TOLERANCE_PX = 0.05;
const spread = (sizes) => Math.max(...sizes) - Math.min(...sizes);

// Every row holds one size; a group without a wide tile is an equal-track grid, so its rows also agree with each other.
function assertEvenRows(groups, label) {
  assert.ok(groups.some((g) => g.rows.length > 0), `${label}: found one-line KPI values to compare`);
  for (const { hasWide, rows } of groups) {
    for (const sizes of rows) assert.ok(spread(sizes) <= SIZE_TOLERANCE_PX, `${label}: one row holds sizes ${sizes.join(', ')}`);
    if (!hasWide) assert.ok(spread(rows.flat()) <= SIZE_TOLERANCE_PX, `${label}: rows disagree: ${rows.flat().join(', ')}`);
  }
}

const WIDTHS = [390, 1280, 1800];
const spec = JSON.parse(fs.readFileSync(fixture('kpi-rows.explainer.json'), 'utf8'));

// The theme is always named: buildFile passes --theme only when it is set and the fixture's own theme is dusk, so an unnamed iteration would test dusk twice.
// paper stands for every classic theme (ink, blueprint, editorial, mono, brief share base.css with it); the three flavors have their own kpi rules.
for (const theme of ['paper', 'dusk', 'press', 'poster']) {
  test(`page and deck: every one-line value in a KPI group has one font size at 390, 1280 and 1800 (${theme})`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const builds = [buildFile(fixture('kpi-rows.explainer.json'), { theme }), buildSpec({ ...spec, mode: 'slides', theme }, { name: 'deck' })];
    for (const { url } of builds) {
      const { page, problems, context } = await openPage(url);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 1000 });
        assertEvenRows(await sizesPerGroup(page), `${url} at ${width}px (${theme})`);
        assert.deepEqual(await overflowProblems(page, '.kpi-value'), [], `${url} at ${width}px`);
      }
      assert.deepEqual(problems, []);
      await context.close();
    }
  });
}

// A section with a wide or long value is not an equal-track grid: it wraps in flex rows whose tiles grow to fill the
// row, and cqi is each tile's own width, so only the short tiles in one visual row are asserted equal. Measured in
// dusk (px, one-line values only; kpi-wide and kpi-long values keep their own size and are not compared):
//   Wide value in the middle (--n 8)  390: row [87%, 1,204 ms] 22.32 | row [$4.2k, alone] 41.6 (spread 19.3 across rows)
//                                    1280: row [87%, 1,204 ms, $4.2k] 21.00, 21.0017 | 1800: the same
//   Wide value first (--n 5)          390: row [87%, $4.2k] 35.71 | 1280 and 1800: row [87%, $4.2k] 46.29
//   Short values only (--n 8)         390: three rows, all 22.32 | 1280 and 1800: one row of 21.00, 21.0017
// Within a row the sizes differ by at most 0.002px (layout snaps tile widths to 1/64 px); across rows they can differ.
test('a mixed group (wide and long values among short ones): short values in one visual row share a size, nothing spills, at 390, 1280 and 1800', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(fixture('nowrap-kpi-mix.explainer.json'), { theme: 'dusk' });
  const { page, problems, context } = await openPage(url);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    assertEvenRows(await sizesPerGroup(page), `nowrap-kpi-mix at ${width}px`);
    assert.deepEqual(await overflowProblems(page, '.kpi-value'), [], `values at ${width}px`);
    assert.deepEqual(await overflowProblems(page, '.kpi'), [], `tiles at ${width}px`);
  }
  assert.deepEqual(problems, []);
  await context.close();
});
