import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

const rows = [
  { group: 'api', t: '2026-W30', value: 12 }, { group: 'web', t: '2026-W30', value: 5 },
  { group: 'api', t: '2026-W31', value: 7 }, { group: 'web', t: '2026-W31', value: 9 },
];
const doc = () => ({
  title: 'Doc',
  sections: [{ type: 'text', title: 'Before', text: 'Intro.' }, { type: 'scene', title: 'The city', scene: { title: 'Commits', world: 'city', data: { rows } } }],
});

// make-scene's full-screen fallback (requestFullscreen unavailable: iPhone Safari, sandboxed iframes) adds .sc-fill to the host.
// The card's own rule for the host must not outrank it, or the fill never leaves the 16:9 frame.
test('a scene host in fill mode is position: fixed inside the explainer card', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser (bundled Chromium or system Chrome)');
  const built = buildSpec(doc());
  const { page, context } = await openPage(built.url);
  try {
    const positions = await page.evaluate(() => {
      const host = document.querySelector('.sc-frame .pa-scene');
      const before = getComputedStyle(host).position;
      host.classList.add('sc-fill');
      return { before, after: getComputedStyle(host).position };
    });
    assert.equal(positions.before, 'absolute', 'in the card the host fills the frame');
    assert.equal(positions.after, 'fixed', 'in fill mode the host leaves the frame');
  } finally {
    await context.close();
  }
});
