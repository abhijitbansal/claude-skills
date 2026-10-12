import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, buildFile, exampleFile, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const flow = (title) => ({
  title,
  type: 'flow',
  direction: 'right',
  nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Server' }, { id: 'c', label: 'Store' }, { id: 'd', label: 'Audit' }],
  edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'd' }],
  steps: [
    { title: 'Client calls', show: ['a'] },
    { title: 'Server answers', show: ['b'] },
    { title: 'Store keeps it', show: ['c'] },
    { title: 'Audit records it', note: 'Last step.', show: ['d'] },
  ],
});
const STEPS = 4;
const doc = (extra = {}, sections) => ({
  title: 'Doc',
  sections: sections ?? [{ type: 'text', title: 'Before', text: 'Intro.' }, { type: 'diagram', title: 'The path', diagram: flow('Path'), caption: 'A **path**.' }, { type: 'text', title: 'After', text: 'Outro.' }],
  ...extra,
});
const page1 = () => buildSpec(doc());
const deck = () => buildSpec(doc({ mode: 'slides' }));

const FIG = '[data-diagram]';
const node = (id) => `${FIG} .pa-node[data-id="${id}"]`;
const open = (page) => page.evaluate(() => document.querySelector('[data-dg-dialog]').open);
const count = (page) => page.locator('[data-pa-count]').textContent();
const activeIs = (page, selector) => page.evaluate((s) => document.activeElement === document.querySelector(s), selector);
const stageParent = (page) => page.evaluate(() => document.querySelector('[data-dg-stage]').parentElement.getAttribute('data-dg-slot') !== null ? 'slot' : document.querySelector('[data-dg-stage]').parentElement.getAttribute('data-dg-body') !== null ? 'body' : 'other');
const viewBox = (page) => page.locator(`${FIG} svg`).first().getAttribute('viewBox');

test('hover on a node dims what it does not touch, and leaving restores it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  await page.locator(node('b')).hover();
  assert.equal(await page.locator(`${FIG} .pa-dim`).count() > 0, true, 'something is dimmed');
  assert.equal(await page.locator(node('b')).evaluate((el) => el.classList.contains('pa-dim')), false);
  assert.equal(await page.locator(node('d')).evaluate((el) => el.classList.contains('pa-dim')), true, 'an unrelated node dims');
  const opacity = await page.locator(node('d')).evaluate((el) => getComputedStyle(el).opacity);
  assert.ok(Number(opacity) < 0.5, `dimmed opacity ${opacity}`);
  await page.mouse.move(2, 2);
  assert.equal(await page.locator(`${FIG} .pa-dim`).count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('inline, the wheel and keys leave the page alone', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page1().url);
  const stopped = await page.locator(`${FIG} [data-dg-stage]`).evaluate((el) => {
    const e = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  });
  assert.equal(stopped, false, 'the wheel is not cancelled, so the page scrolls');
  const before = await viewBox(page);
  await page.locator(node('a')).focus();
  for (const key of ['ArrowRight', '+', 'p', 'f']) await page.keyboard.press(key);
  assert.equal(await viewBox(page), before, 'keys do not pan or zoom an inline figure');
  assert.equal(await page.locator(`${FIG} .pa-presenting`).count(), 0, 'P does not start a presentation inline');
  await context.close();
});

test('Present opens the overlay, steps forward and back, and Esc closes it with focus back', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  await page.locator('[data-dg-present]').focus();
  await page.keyboard.press('Enter');
  assert.equal(await open(page), true);
  assert.equal(await stageParent(page), 'body', 'the stage moved into the overlay');
  assert.equal(await count(page), `1 / ${STEPS}`);
  assert.equal(await page.locator('[data-pa-title]').textContent(), 'Client calls');
  assert.equal(await page.locator('[data-pa-prev]').isDisabled(), true);

  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), `2 / ${STEPS}`);
  assert.equal(await page.locator('[data-pa-title]').textContent(), 'Server answers');
  await page.keyboard.press('Space');
  assert.equal(await count(page), `3 / ${STEPS}`);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), `2 / ${STEPS}`);
  await page.locator('[data-pa-next]').click();
  await page.locator('[data-pa-next]').click();
  assert.equal(await count(page), `4 / ${STEPS}`);
  assert.equal(await page.locator('[data-pa-next]').isDisabled(), true);
  assert.equal(await page.locator('[data-pa-note]').textContent(), 'Last step.');
  await page.locator('[data-pa-prev]').click();
  assert.equal(await count(page), `3 / ${STEPS}`);
  assert.equal(await page.locator(`${FIG} .pa-hidden`).count() > 0, true, 'steps not reached yet stay hidden');

  await page.keyboard.press('Escape');
  assert.equal(await open(page), false, 'one Esc closes the overlay');
  assert.equal(await stageParent(page), 'slot', 'the stage is back inline');
  assert.equal(await activeIs(page, '[data-dg-present]'), true, 'focus returns to the Present button');
  assert.equal(await page.locator(`${FIG} .pa-hidden`).count(), 0, 'every box is back after the presentation');
  assert.equal(await page.locator(`${FIG} .pa-presenting`).count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('the Close button and reopening work, and the overlay starts again at step one', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  await page.locator('[data-dg-present]').click();
  await page.keyboard.press('ArrowRight');
  await page.locator('[data-dg-close]').click();
  assert.equal(await open(page), false);
  assert.equal(await activeIs(page, '[data-dg-present]'), true);
  await page.locator('[data-dg-present]').click();
  assert.equal(await count(page), `1 / ${STEPS}`);
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the diagram follows the page theme toggle', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url, { colorScheme: 'light' });
  const fill = () => page.locator(`${node('a')} .pa-shape`).evaluate((el) => getComputedStyle(el).fill);
  const light = await fill();
  await page.locator('[data-theme-toggle]').click(); // auto -> light
  await page.locator('[data-theme-toggle]').click(); // light -> dark
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
  const dark = await fill();
  assert.notEqual(light, dark, `shape fill ${light} should change in dark mode`);
  assert.deepEqual(problems, []);
  await context.close();
});

test('slides: the overlay takes the keys, the deck stays put, and Esc hands them back', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(deck().url);
  const slide = () => page.evaluate(() => Number(document.querySelector('[data-deck]').dataset.current));
  await page.keyboard.press('ArrowRight'); // slide 2: Before
  await page.keyboard.press('ArrowRight'); // slide 3: the diagram
  assert.equal(await slide(), 3);
  await page.locator('#slide-3 [data-dg-present]').click();
  assert.equal(await open(page), true);
  assert.equal(await count(page), `1 / ${STEPS}`);
  const size = page.viewportSize();
  const box = await page.locator('[data-dg-dialog]').boundingBox();
  assert.ok(box.width >= size.width - 1 && box.height >= size.height - 1, `the overlay escapes the deck: ${JSON.stringify(box)}`);
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'o', 'End', 'Home']) await page.keyboard.press(key);
  assert.equal(await slide(), 3, 'the deck did not move');
  assert.equal(await page.locator('[data-outline]').evaluate((d) => d.open), false, 'O did not open the outline');
  assert.equal(await count(page), `2 / ${STEPS}`, 'the arrows stepped the presentation (right, right, left)');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), false);
  assert.equal(await activeIs(page, '#slide-3 [data-dg-present]'), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await slide(), 4, 'the deck takes its keys back');
  assert.deepEqual(problems, []);
  await context.close();
});

test('two diagrams on one page each present their own steps', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const two = doc({}, [{ type: 'diagram', diagram: flow('First') }, { type: 'diagram', diagram: { ...flow('Second'), steps: [{ title: 'Only', show: ['a', 'b', 'c', 'd'] }] } }]);
  const { page, problems, context } = await openPage(buildSpec(two).url);
  const figures = page.locator(FIG);
  assert.equal(await figures.count(), 2);
  await figures.nth(1).locator('[data-dg-present]').click();
  assert.equal(await figures.nth(1).locator('[data-pa-count]').textContent(), '1 / 1');
  await page.keyboard.press('Escape');
  await figures.nth(0).locator('[data-dg-present]').click();
  assert.equal(await figures.nth(0).locator('[data-pa-count]').textContent(), `1 / ${STEPS}`);
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('at 390 px the figure fits the page and the overlay fills the screen', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildFile(exampleFile('recap')).url, { width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.equal(overflow <= 0, true, `horizontal overflow ${overflow}`);
  await page.locator('[data-dg-present]').scrollIntoViewIfNeeded();
  await page.locator('[data-dg-present]').click();
  const box = await page.locator('[data-dg-dialog]').boundingBox();
  assert.ok(box.width >= 389 && box.height >= 843, JSON.stringify(box));
  const stage = await page.locator('[data-dg-body] [data-dg-stage]').boundingBox();
  assert.ok(stage.width >= 389 && stage.height > 300, JSON.stringify(stage));
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});
