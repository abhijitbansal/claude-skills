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

// ---- fix round 1: legibility floor, centring, scroll region, tab stops ------------------------

const NAMES = ['Client', 'Gateway', 'Auth service', 'Orders service', 'Orders store', 'Audit log', 'Billing service', 'Billing store', 'Report job', 'Archive'];
const WIDE = (title = 'Wide', count = 6) => ({
  title,
  type: 'flow',
  direction: 'right',
  nodes: NAMES.slice(0, count).map((label, i) => ({ id: `n${i}`, label })),
  edges: NAMES.slice(1, count).map((_, i) => ({ from: `n${i}`, to: `n${i + 1}` })),
});
const TALL = () => ({ ...WIDE('Tall'), direction: 'down' });
const wideDoc = (extra = {}) => doc(extra, [{ type: 'text', title: 'Before', text: 'Intro.' }, { type: 'diagram', title: 'Wide path', diagram: WIDE(), caption: 'Wide.' }]);
const labelPx = (page) => page.locator(`${FIG} .pa-label`).first().evaluate((el) => {
  const svg = el.ownerSVGElement;
  return parseFloat(getComputedStyle(el).fontSize) * svg.getScreenCTM().a;
});
const pageOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [width, height] of [[1280, 900], [390, 844]]) {
  test(`a wide diagram keeps its text at 10 px or more at ${width} px, with no page overflow`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(buildSpec(wideDoc()).url, { width, height });
    assert.ok(await labelPx(page) >= 10, `label renders at ${await labelPx(page)} px`);
    assert.ok(await pageOverflow(page) <= 0, 'the page does not scroll sideways');
    const slot = await page.locator('[data-dg-slot]').evaluate((el) => ({ scrolls: el.scrollWidth > el.clientWidth + 1, client: el.clientWidth, tab: el.tabIndex, role: el.getAttribute('role'), label: el.getAttribute('aria-label') }));
    // The 6-node flow is about 1000 units: at 1280 it fits the 832 px column above the 0.75 floor, at 390 it cannot.
    assert.equal(slot.scrolls, width === 390, width === 390 ? 'the slot scrolls sideways inside itself' : 'it fits, so it does not scroll');
    assert.equal(slot.tab, width === 390 ? 0 : -1, 'a scrolling slot is focusable');
    assert.equal(slot.role, width === 390 ? 'region' : null);
    if (width === 390) assert.match(slot.label, /^Diagram: Wide \(scrolls sideways\)$/);
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('a 10-node flow scrolls inside its slot at 1280 px and still keeps 10 px text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(doc({}, [{ type: 'diagram', diagram: WIDE('Very wide', 10) }])).url);
  assert.ok(await labelPx(page) >= 10, `label ${await labelPx(page)} px`);
  assert.equal(await page.locator('[data-dg-slot]').evaluate((el) => el.scrollWidth > el.clientWidth + 1), true);
  assert.ok(await pageOverflow(page) <= 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('in a deck, arrows with focus in the scrolling slot scroll it and keep the slide', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildSpec(wideDoc({ mode: 'slides' })).url, { width: 390, height: 844 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const slide = () => page.evaluate(() => Number(document.querySelector('[data-deck]').dataset.current));
  assert.equal(await slide(), 3);
  await page.locator('#slide-3 [data-dg-slot]').focus();
  const left = () => page.locator('#slide-3 [data-dg-slot]').evaluate((el) => el.scrollLeft);
  await page.keyboard.press('ArrowRight');
  assert.equal(await slide(), 3, 'the deck stayed');
  await page.waitForFunction(() => document.querySelector('#slide-3 [data-dg-slot]').scrollLeft > 0);
  assert.ok(await left() > 0, 'the slot scrolled');
  assert.ok(await labelPx(page) >= 10);
  assert.deepEqual(problems, []);
  await context.close();
});

test('page mode: the figure is centred, and caption and Present sit with the card', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const tall = doc({}, [{ type: 'diagram', title: 'Tall path', diagram: TALL(), caption: 'A tall figure.' }]);
  const { page, context } = await openPage(buildSpec(tall).url, { width: 1280, height: 900 });
  const m = await page.evaluate(() => {
    const box = (s) => document.querySelector(s).getBoundingClientRect();
    const col = box('.sections'); const slot = box('[data-dg-slot]'); const btn = box('[data-dg-present]'); const cap = box('figcaption');
    return { colMid: col.left + col.width / 2, slotMid: slot.left + slot.width / 2, slotRight: slot.right, btnRight: btn.right, capLeft: cap.left, slotLeft: slot.left, capWidth: cap.width };
  });
  assert.ok(Math.abs(m.colMid - m.slotMid) <= 2, `card centred: column ${m.colMid}, card ${m.slotMid}`);
  assert.ok(m.btnRight - m.slotRight <= 120, `Present is ${m.btnRight - m.slotRight} px past the card`);
  assert.ok(m.slotLeft - m.capLeft <= 120, 'the caption starts near the card');
  assert.ok(m.capWidth >= 250, `caption has room to read: ${m.capWidth}px`);
  assert.ok(await labelPx(page) >= 10, `tall label ${await labelPx(page)} px`);
  await context.close();
});

test('inline nodes are not tab stops, in Present they are', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page1().url);
  const tabs = () => page.locator(`${FIG} .pa-node`).evaluateAll((els) => els.map((e) => e.tabIndex));
  assert.deepEqual([...new Set(await tabs())], [-1]);
  assert.equal(await page.locator('[data-dg-slot]').evaluate((el) => [el.tabIndex, el.getAttribute('role')].join()), '-1,', 'a slot that does not scroll is not a tab stop or a region');
  await page.locator('[data-dg-present]').click();
  assert.deepEqual([...new Set(await tabs())], [0]);
  await page.keyboard.press('Escape');
  assert.deepEqual([...new Set(await tabs())], [-1]);
  await context.close();
});

test('Present is hidden when the viewer cannot mount', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = page1();
  const { page, context } = await openPage(url, { init: () => { Object.defineProperty(window, 'PADiagram', { get() { return undefined; }, set() {} }); } });
  assert.equal(await page.locator('[data-dg-present]').isHidden(), true);
  await context.close();
});

test('a deck on a short viewport keeps the diagram slot visible', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck().url, { width: 800, height: 260 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const box = await page.locator('#slide-3 [data-dg-slot]').boundingBox();
  assert.ok(box.width > 100 && box.height > 40, JSON.stringify(box));
  await context.close();
});

test('the overlay steps without a camera tween under reduced motion, and settles with motion on', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const reduced = await openPage(page1().url, { reducedMotion: 'reduce' });
  await reduced.page.locator('[data-dg-present]').click();
  await reduced.page.keyboard.press('ArrowRight');
  const vb = () => viewBox(reduced.page);
  const first = await vb();
  await reduced.page.waitForTimeout(500);
  assert.equal(await vb(), first, 'the camera jumped at once');
  assert.equal(await reduced.page.locator(`${FIG} .pa-hidden`).first().evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
  assert.deepEqual(reduced.problems, []);
  await reduced.context.close();

  const moving = await openPage(page1().url, { reducedMotion: 'no-preference' });
  await moving.page.locator('[data-dg-present]').click();
  await moving.page.keyboard.press('ArrowRight');
  await moving.page.waitForTimeout(700);
  const a = await viewBox(moving.page);
  await moving.page.waitForTimeout(300);
  assert.equal(await viewBox(moving.page), a, 'the camera settled');
  assert.equal(await moving.page.locator('[data-pa-count]').textContent(), `2 / ${STEPS}`);
  assert.deepEqual(moving.problems, []);
  await moving.context.close();
});
