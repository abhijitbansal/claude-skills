import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { haveBrowser, buildFile, openPage, closeSharedBrowser, exampleFile } from './helpers/browser.mjs';

after(closeSharedBrowser);

for (const name of ['recap', 'slides']) {
  test(`${name}: toggle click cycles data-theme and icon in the real page`, { skip: !(await haveBrowser()) }, async () => {
    const { url } = buildFile(exampleFile(name), { name });
    const { page, problems, context } = await openPage(url);
    const mode = () => page.evaluate(() => [document.documentElement.getAttribute('data-theme'), document.querySelector('[data-theme-toggle]').getAttribute('data-mode')]);
    assert.deepEqual(await mode(), [null, 'auto']);
    for (const want of ['light', 'dark', 'auto']) {
      await page.click('[data-theme-toggle]');
      const [theme, m] = await mode();
      assert.equal(m, want);
      assert.equal(theme, want === 'auto' ? null : want);
      assert.equal(await page.isVisible(`[data-theme-toggle] .pa-ti-${want}`), true);
    }
    assert.deepEqual(problems, []);
    await context.close();
  });
}
