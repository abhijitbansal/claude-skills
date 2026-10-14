// The legend on the viewer page is a fixed-size HTML overlay in the stage's top-right corner:
// the in-SVG legend shrinks with the camera and is unreadable at fit on a wide diagram. The
// in-SVG legend stays in the drawing, so SVG/PNG exports and make-explainer's figure keep it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { legendItems } from '../scripts/lib/legend.mjs';
import { launchBrowser, haveBrowser, buildPage, example } from './helpers/browser.mjs';

let browser;
after(() => browser?.close());

test('the page carries one overlay entry per legend item, text escaped', () => {
  const spec = example('architecture');
  const { html } = buildPage(spec, { name: 'legend-html' });
  const overlay = html.match(/<div class="legend" data-pa-legend[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(overlay, 'an overlay element exists in the stage');
  assert.equal((overlay[1].match(/<span class="lg"/g) ?? []).length, legendItems(spec).length);
  assert.ok(/aria-hidden="true"/.test(overlay[0]), 'decorative: the text alternative already names every node');
  assert.ok(html.indexOf('data-pa-legend') > html.indexOf('id="pa-stage"'), 'inside the stage');
});

test('overlay: fixed size at fit and zoom, top right, in-SVG copy hidden on screen but exported', async (t) => {
  if (!(await haveBrowser())) return t.skip('no browser');
  browser ??= await launchBrowser();
  const { url } = buildPage(example('story'), { name: 'legend-live' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  await page.goto(url);
  await page.waitForFunction(() => window.paReady === true);
  const rect = () => page.evaluate(() => {
    const r = document.querySelector('[data-pa-legend]').getBoundingClientRect();
    const s = document.getElementById('pa-stage').getBoundingClientRect();
    return { w: r.width, h: r.height, right: s.right - r.right, top: r.top - s.top, shown: getComputedStyle(document.querySelector('[data-pa-legend]')).display !== 'none' };
  });
  const fit = await rect();
  assert.ok(fit.shown && fit.w > 40 && fit.h > 12, 'visible');
  assert.ok(fit.right >= 0 && fit.right < 24 && fit.top >= 0 && fit.top < 24, 'in the stage corner');
  const fontPx = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-pa-legend] .lg')).fontSize));
  assert.ok(fontPx >= 11, 'readable at any zoom');
  await page.click('[data-act="zoom-in"]');
  await page.click('[data-act="zoom-in"]');
  assert.deepEqual(await rect(), fit, 'the same size and place after zooming');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.pa-legend')).display), 'none', 'the in-SVG legend is off screen');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="svg"]')]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  assert.ok(text.includes('class="pa-legend"'), 'the export keeps the drawn legend');
  assert.ok(!text.includes('data-pa-legend') && !/\.legend\b/.test(text), 'and not the overlay or its rules');
  assert.deepEqual(problems, []);
  await context.close();
});
