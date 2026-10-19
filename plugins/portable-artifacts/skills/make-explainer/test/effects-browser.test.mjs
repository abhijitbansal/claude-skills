// The flavored themes' see-through effects (film grain, the frosted dusk cover) and their reduced-effects path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildFile, exampleFile, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { grainContrast } from './helpers/grain.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

// Playwright has no option for prefers-reduced-transparency; Chrome's DevTools protocol does.
async function reduceTransparency(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
}

test('dusk deck cover: frosted by default; with reduced transparency no blur and an opaque panel', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(exampleFile('slides'), { theme: 'dusk', name: 'cover-dusk' });
  const cover = (page) => page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('#slide-1 > .slide-inner'));
    return { blur: cs.backdropFilter, fill: cs.backgroundColor, grain: getComputedStyle(document.body, '::before').display };
  });
  const plain = await openPage(url, { width: 1280, height: 720 });
  const frosted = await cover(plain.page);
  assert.match(frosted.blur, /blur\(16px\)/);
  await reduceTransparency(plain.page);
  const flat = await cover(plain.page);
  assert.equal(flat.grain, 'none', 'the emulation reaches the page (grain already honours it)');
  assert.equal(flat.blur, 'none');
  const page = await plain.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--page').trim());
  assert.ok(page.length > 0);
  assert.doesNotMatch(flat.fill, /rgba\(.*, 0\.\d+\)|color\(srgb [^)]* \/ 0\.\d+\)/, `opaque panel, got ${flat.fill}`);
  assert.notEqual(flat.fill, 'rgba(0, 0, 0, 0)');
  await plain.context.close();
});

// ---- text under the film grain ---------------------------------------------------------------------------
// The grain is a fixed overlay above the whole page (flavors.css body::before), which the token pairs in
// flavor.test.mjs cannot see. Every text box on a flat ground is measured (p05 of its pixels) with the grain on;
// the headroom keeps a token drift from scraping past 4.5. Text on art or other non-flat grounds is skipped,
// so the skipped count is capped to notice text quietly leaving the check.
const FLAVORS = ['dusk', 'press', 'poster'];
const MODES = ['light', 'dark'];
const TEXT_MIN = 4.5;
const HEADROOM = 0.15;
const MAX_SKIPPED = 16;

test(`text on a flat ground reads >= ${TEXT_MIN} + ${HEADROOM}:1 under the grain in every flavor and mode`, async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const problems = [];
  for (const theme of FLAVORS) {
    for (const example of ['recap', 'concept']) {
      const { url } = buildFile(exampleFile(example), { theme, name: `grain-${example}-${theme}` });
      const inks = new Set();
      for (const mode of MODES) {
        const { results, skipped, page } = await grainContrast(url, { colorScheme: mode });
        inks.add(page);
        assert.ok(results.some((r) => r.card), `${theme} ${example} ${mode}: no card text measured`);
        assert.ok(skipped <= MAX_SKIPPED, `${theme} ${example} ${mode}: ${skipped} text boxes skipped (cap ${MAX_SKIPPED})`);
        for (const r of results) if (r.ratio < TEXT_MIN + HEADROOM) problems.push(`${theme} ${example} ${mode}: ${r.what} ${r.ratio.toFixed(2)}:1`);
      }
      assert.equal(inks.size, 2, `${theme} ${example}: light and dark drew different pages`);
    }
  }
  assert.deepEqual(problems, []);
});

test('the grain measurement sees the grain: a strong grain drops text below 4.5:1', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = buildFile(exampleFile('recap'), { theme: 'dusk', name: 'grain-proof' });
  const { results } = await grainContrast(url, { colorScheme: 'light', grainOp: 0.3 });
  const worst = Math.min(...results.map((r) => r.ratio));
  assert.ok(worst < TEXT_MIN, `expected the forced grain to break the text, got ${worst.toFixed(2)}:1`);
});
