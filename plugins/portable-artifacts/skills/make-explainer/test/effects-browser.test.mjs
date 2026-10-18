// The flavored themes' see-through effects (film grain, the frosted dusk cover) and their reduced-effects path.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildFile, exampleFile, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';

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
