// The legend on the viewer page is a fixed-size HTML overlay in the stage's top-right corner:
// the in-SVG legend shrinks with the camera and is unreadable at fit on a wide diagram. The
// in-SVG legend stays in the drawing, so SVG/PNG exports and make-explainer's figure keep it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { legendItems } from '../scripts/lib/legend.mjs';
import { launchBrowser, haveBrowser, buildPage, example, EXAMPLES } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';

let browser;
after(async () => { await browser?.close(); await closeBrowser(); });

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

// ---- the camera fits the drawing below the overlay: nothing sits under it at first paint ------------------------

const rectsAtFirstPaint = (page) => page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
  return { legend: r(document.querySelector('[data-pa-legend]')), stage: r(document.getElementById('pa-stage')), nodes: [...document.querySelectorAll('.pa-node')].map((n) => ({ id: n.dataset.id, ...r(n) })) };
});
const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

for (const name of EXAMPLES) {
  for (const [width, height] of [[1024, 768], [390, 780]]) {
    test(`${name} at ${width}x${height}, first paint: no node or participant sits under the legend overlay`, async (t) => {
      if (await skipUnlessBrowser(t)) return;
      const { page, problems, context } = await openPage(buildPage(example(name), { name: `overlap-${name}` }).url, { width, height });
      const { legend, nodes } = await rectsAtFirstPaint(page);
      const covered = nodes.filter((n) => overlap(n, legend) > 0).map((n) => `${n.id} ${Math.round(100 * overlap(n, legend) / ((n.right - n.left) * (n.bottom - n.top)))}%`);
      assert.deepEqual(covered, []);
      assert.deepEqual(problems, []);
      await context.close();
    });
  }
}

// ---- the page fits the drawing, not the canvas widened for the legend row it hides ----------------------------

// A drawing narrower than its legend row is laid out on a wider canvas (exports keep the drawn legend);
// the page hides that legend, so its camera fits the drawing alone.
const DOWN_FLOW = {
  title: 'Three nodes',
  type: 'flow',
  direction: 'down',
  nodes: ['a', 'b', 'c'].map((id) => ({ id, label: `Checkout service ${id.toUpperCase()}` })),
  edges: [{ from: 'a', to: 'b', style: 'solid' }, { from: 'b', to: 'c', style: 'dashed' }, { from: 'a', to: 'c', style: 'async' }],
};

test('a narrow diagram fits the phone by its own width: the fit reaches the 1.25 cap and a node is not drawn small', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildPage(DOWN_FLOW, { name: 'narrow' }).url, { width: 390, height: 780 });
  const seen = await page.evaluate(() => {
    const stage = document.getElementById('pa-stage').getBoundingClientRect();
    const vb = document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number);
    return { scale: stage.width / vb[2], aWidth: document.querySelector('.pa-node[data-id="a"] .pa-shape').getBoundingClientRect().width };
  });
  assert.ok(seen.scale >= 1.249, `fit scale ${seen.scale}`);
  assert.ok(seen.aWidth >= 190, `node a is ${seen.aWidth} px wide`);
  assert.deepEqual(problems, []);
  await context.close();
});

// The overlay holds only the top-right corner: a tall drawing on a wide stage fits to the full
// height beside it rather than shrinking under a full-width band as tall as the overlay.
test('a tall diagram on a wide stage fits the full height beside the overlay, clear of it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildPage(example('flow'), { name: 'tall-wide' }).url, { width: 1440, height: 900 });
  const seen = await page.evaluate(() => {
    const stage = document.getElementById('pa-stage').getBoundingClientRect();
    const o = document.querySelector('[data-pa-legend]').getBoundingClientRect();
    const vb = document.querySelector('#pa-stage svg').getAttribute('viewBox').split(' ').map(Number);
    const d = JSON.parse(document.getElementById('pa-data').textContent).drawing;
    const covered = [...document.querySelectorAll('.pa-node')].filter((n) => {
      const r = n.getBoundingClientRect();
      return r.right > o.left + 1 && r.left < o.right - 1 && r.bottom > o.top + 1 && r.top < o.bottom - 1;
    }).map((n) => n.dataset.id);
    return { scale: stage.width / vb[2], full: Math.min(1.25, stage.height / (d[3] + 32)), band: Math.min(1.25, (stage.height - (o.bottom - stage.top)) / (d[3] + 32)), covered };
  });
  assert.ok(seen.full > seen.band + 0.01, `precondition: the band would cost scale (${seen.full} vs ${seen.band})`);
  assert.ok(Math.abs(seen.scale - seen.full) < 0.01, `fit scale ${seen.scale}, full height gives ${seen.full}`);
  assert.deepEqual(seen.covered, [], 'no node under the overlay');
  assert.deepEqual(problems, []);
  await context.close();
});
