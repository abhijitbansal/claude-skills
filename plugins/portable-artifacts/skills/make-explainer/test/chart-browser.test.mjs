import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { loadTheme } from '../shared/theme.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const DATA = [{ team: 'Core', bugs: 12 }, { team: 'Web', bugs: 7 }, { team: 'Infra', bugs: 4 }];
const doc = (extra = {}) => ({
  title: 'Doc',
  theme: 'paper',
  sections: [{ type: 'chart', title: 'Open bugs', data: DATA, kind: 'bar', x: 'team', y: 'bugs' }],
  ...extra,
});
const paper = loadTheme('paper');

// Which scheme's drawing is shown, and the fill of its first bar.
const shown = (page) => page.evaluate(() => {
  const visible = (el) => el.getClientRects().length > 0;
  const pick = (cls) => [...document.querySelectorAll(cls)].filter(visible);
  const light = pick('.ch-light .ch-svg').filter((el) => el.closest('.ch-light') && visible(el.closest('.ch-light')));
  const dark = pick('.ch-dark .ch-svg').filter((el) => el.closest('.ch-dark') && visible(el.closest('.ch-dark')));
  const shownSvg = [...light, ...dark];
  const bar = shownSvg[0]?.querySelector('svg path[fill^="#"][d^="M"]:not(.background)');
  return {
    light: light.length,
    dark: dark.length,
    fill: bar ? bar.getAttribute('fill') : null,
    width: shownSvg[0] ? Math.round(shownSvg[0].getBoundingClientRect().width) : 0,
    svgWidth: shownSvg[0] ? shownSvg[0].querySelector('svg').getAttribute('width') : null,
  };
});

test('auto follows the OS scheme: light OS shows the light drawing, dark OS the dark one', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(doc());
  for (const [scheme, tokens] of [['light', paper.light], ['dark', paper.dark]]) {
    const { page, problems, context } = await openPage(built.url, { colorScheme: scheme });
    const s = await shown(page);
    assert.equal(s[scheme], 1, `${scheme} OS: the ${scheme} drawing is shown`);
    assert.equal(s[scheme === 'light' ? 'dark' : 'light'], 0);
    assert.equal(s.fill, tokens.cat1);
    assert.deepEqual(problems, []);
    await context.close();
  }
});

test('the theme toggle swaps the drawing, whatever the OS scheme says', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(doc());
  const { page, problems, context } = await openPage(built.url, { colorScheme: 'light' });
  const toggle = page.locator('[data-theme-toggle]');
  assert.equal((await shown(page)).fill, paper.light.cat1, 'Auto on a light OS');
  await toggle.click(); // Light
  assert.equal((await shown(page)).fill, paper.light.cat1);
  await toggle.click(); // Dark
  const dark = await shown(page);
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  assert.equal(dark.dark, 1);
  assert.equal(dark.light, 0);
  assert.equal(dark.fill, paper.dark.cat1, 'forced dark on a light OS');
  await toggle.click(); // Auto
  assert.equal((await shown(page)).fill, paper.light.cat1);
  assert.deepEqual(problems, []);
  await context.close();

  // Forced light on a dark OS.
  const forced = await openPage(built.url, { colorScheme: 'dark', seed: { 'pa-theme': 'light' } });
  const s = await shown(forced.page);
  assert.equal(s.fill, paper.light.cat1, 'light stays light when the OS is dark');
  assert.deepEqual(forced.problems, []);
  await forced.context.close();
});

test('a phone shows the narrow drawing at about its natural size; a desktop the wide one', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(doc());
  const phone = await openPage(built.url, { width: 390, height: 844 });
  const p = await shown(phone.page);
  assert.equal(p.svgWidth, '320');
  assert.ok(p.width >= 280 && p.width <= 340, `narrow drawing is ${p.width} px wide on a 390 px screen`);
  assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no sideways scroll');
  await phone.context.close();
  const desktop = await openPage(built.url, { width: 1280, height: 900 });
  const d = await shown(desktop.page);
  assert.equal(d.svgWidth, '600');
  assert.ok(d.width >= 560, `wide drawing is ${d.width} px wide`);
  await desktop.context.close();
});

test('the data table opens and holds every plotted row; the figure has an accessible name', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(doc());
  const { page, problems, context } = await openPage(built.url);
  assert.equal(await page.locator('figure.ch').getAttribute('aria-label'), 'Open bugs');
  assert.equal(await page.locator('.ch-data tbody tr').first().isVisible(), false, 'closed until asked');
  await page.locator('.ch-data summary').click();
  assert.equal(await page.locator('.ch-data tbody tr').count(), 3);
  assert.equal(await page.locator('.ch-data tbody tr').first().isVisible(), true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('slides: a chart slide shows the drawing and the arrow keys still change slides', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(doc({ mode: 'slides', sections: [
    { type: 'chart', title: 'Open bugs', data: DATA, kind: 'bar', x: 'team', y: 'bugs' },
    { type: 'text', title: 'After', text: 'Done.' },
  ] }));
  const { page, problems, context } = await openPage(built.url, { height: 800 });
  assert.equal(await page.evaluate(() => document.querySelector('.deck').dataset.current), '1');
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.deck').dataset.current === '2');
  assert.equal((await shown(page)).light, 1);
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('.deck').dataset.current === '3');
  assert.deepEqual(problems, []);
  await context.close();
});
