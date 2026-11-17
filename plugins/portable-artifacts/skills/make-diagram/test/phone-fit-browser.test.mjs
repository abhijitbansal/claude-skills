// Every example reads on a phone and on a laptop. At 390 px: no node is clipped at the stage's right edge, the
// toolbar and the legend overlay take at most a quarter of the screen, and the zoom controls are on screen. At
// 1280 px: node labels draw at the page's reading floor or larger (legibility.mjs MIN_LABEL_PX).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildPage, example, EXAMPLES } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';
import { LABEL_PX, MIN_LABEL_PX } from '../scripts/lib/legibility.mjs';

after(async () => { await closeBrowser(); });

const CHROME_SHARE = 0.25; // toolbar + legend overlay, of the viewport height

const phoneFacts = (page) => page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, height: b.height }; };
  const legend = document.querySelector('[data-pa-legend]');
  const shown = legend && getComputedStyle(legend).display !== 'none' ? r(legend).height : 0;
  const zoom = [...document.querySelectorAll('[data-act="zoom-in"],[data-act="fit"]')].map(r);
  return { stage: r(document.getElementById('pa-stage')), bar: r(document.querySelector('.bar')).height, legend: shown, vh: window.innerHeight, vw: window.innerWidth,
    nodes: [...document.querySelectorAll('.pa-node')].map((n) => ({ id: n.dataset.id, ...r(n) })), zoom };
});

for (const name of [...EXAMPLES, 'cloud-architecture']) {
  test(`${name} at 390x844: nothing clipped at the right edge, chrome within a quarter of the screen, zoom on screen`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await openPage(buildPage(example(name), { name: `phone-${name}` }).url, { width: 390, height: 844 });
    try {
      const f = await phoneFacts(page);
      const clipped = f.nodes.filter((n) => n.right > f.stage.right + 1 || n.left < f.stage.left - 1).map((n) => `${n.id} ${Math.round(n.left)}..${Math.round(n.right)} of ${Math.round(f.stage.left)}..${Math.round(f.stage.right)}`);
      assert.deepEqual(clipped, [], 'every node inside the stage');
      assert.ok(f.bar + f.legend <= CHROME_SHARE * f.vh, `toolbar ${Math.round(f.bar)} + legend ${Math.round(f.legend)} px of ${f.vh}`);
      assert.ok(f.zoom.length >= 2 && f.zoom.every((z) => z.right <= f.vw && z.left >= 0 && z.bottom <= f.vh), 'Fit and zoom-in on screen');
    } finally {
      await context.close();
    }
  });

  test(`${name} at 1280x800: node labels draw at the reading floor or larger`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await openPage(buildPage(example(name), { name: `laptop-${name}` }).url, { width: 1280, height: 800 });
    try {
      const scale = await page.evaluate(() => document.querySelector('#pa-stage > svg').getScreenCTM().a);
      assert.ok(LABEL_PX * scale >= MIN_LABEL_PX - 0.05, `labels draw ${(LABEL_PX * scale).toFixed(1)} px (floor ${MIN_LABEL_PX})`);
    } finally {
      await context.close();
    }
  });
}
