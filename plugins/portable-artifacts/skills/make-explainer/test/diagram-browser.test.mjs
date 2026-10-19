import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const STORY = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../make-diagram/references/examples/story.diagram.json', import.meta.url)), 'utf8'));
const storyPage = () => buildSpec(doc({}, [{ type: 'diagram', title: 'Orders', diagram: STORY, caption: 'An order.' }]));
const DLG = '[data-dg-dialog]';
const line = (page) => page.locator(`${DLG} [data-pa-line]`).textContent();
const dialogHas = (page, cls) => page.evaluate((c) => document.querySelector('[data-dg-dialog] [data-dg-root]').classList.contains(c), cls);
const REFUSES = () => { Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')); }; };

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
  assert.equal(await line(page), '01 / 04 · WALKTHROUGH · Client calls');
  assert.equal(await page.locator('[data-pa-prev]').isDisabled(), true);
  assert.equal(await activeIs(page, '[data-pa-play]'), true, 'focus starts on Play');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-play]`, 'aria-label'), 'Play', 'the overlay Play button is an icon with an accessible name');
  const playBox = await page.locator(`${DLG} [data-pa-play]`).boundingBox();
  assert.ok(playBox.width >= 40 && playBox.height >= 40, `Play hit area ${playBox.width}x${playBox.height} is at least 40x40`);
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="play"]`, 'aria-pressed'), 'true');

  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), `2 / ${STEPS}`);
  assert.equal(await line(page), '02 / 04 · WALKTHROUGH · Server answers');
  await page.keyboard.press('ArrowRight'); // Space is play/pause now, so a second step key
  assert.equal(await count(page), `3 / ${STEPS}`);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await count(page), `2 / ${STEPS}`);
  await page.locator('[data-pa-next]').click();
  await page.locator('[data-pa-next]').click();
  assert.equal(await count(page), `4 / ${STEPS}`);
  assert.equal(await page.locator('[data-pa-next]').isDisabled(), true);
  assert.equal(await activeIs(page, '[data-pa-play]'), true, 'Next went disabled under the pointer: focus moved to Play, not to the page');
  assert.equal(await line(page), '04 / 04 · WALKTHROUGH · Audit records it — Last step.');
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
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'o']) await page.keyboard.press(key);
  assert.equal(await count(page), `2 / ${STEPS}`, 'the arrows stepped the presentation (right, right, left)');
  for (const key of ['End', 'Home']) await page.keyboard.press(key);
  assert.equal(await count(page), `1 / ${STEPS}`, 'End then Home: both reached the viewer (focus stayed inside the overlay when Next went disabled)');
  assert.equal(await open(page), true);
  assert.equal(await slide(), 3, 'the deck did not move');
  assert.equal(await page.locator('[data-outline]').evaluate((d) => d.open), false, 'O did not open the outline');
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

test('at 390 px the overlay title keeps whole words on at most two lines', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url, { width: 390, height: 844 });
  await page.locator('[data-dg-present]').click();
  const m = await page.evaluate(() => {
    const el = document.querySelector('[data-dg-dialog] .dg-top-title');
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const split = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (const w of n.data.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(n, w.index); r.setEnd(n, w.index + w[0].length);
        const tops = new Set([...r.getClientRects()].map((q) => Math.round(q.top)));
        if (tops.size > 1) split.push(w[0]);
      }
    }
    return { text: el.textContent.trim(), height: el.getBoundingClientRect().height, lineHeight, split, overflows: el.scrollWidth > el.clientWidth };
  });
  assert.ok(m.text.length > 0);
  assert.deepEqual(m.split, [], `words split across lines in "${m.text}"`);
  assert.ok(m.height <= 2 * m.lineHeight + 1, `title is ${m.height}px tall (line ${m.lineHeight}px)`);
  assert.equal(m.overflows, false);
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

// ---- phase 4: the overlay runs the whole viewer -------------------------------------------------

test('the overlay plays a story: tabs, chapter chips, the transport with its dot, then Explore with the panel and Find', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url, { reducedMotion: 'no-preference' });
  await page.locator('[data-dg-present]').click();
  assert.equal(await open(page), true);
  assert.equal(await count(page), '1 / 9');
  assert.deepEqual(await page.locator(`${DLG} [data-pa-chapter]`).allTextContents(), ['Place the order', 'Fulfil it']);
  assert.equal(await line(page), '01 / 09 · PLACE THE ORDER · The shopper taps Buy — The app builds the order from the basket.');
  assert.equal(await activeIs(page, `${DLG} [data-pa-play]`), true);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-dg-stage]').classList.contains('pa-playing'));
  await page.waitForFunction(() => !!document.querySelector('[data-dg-stage] .pa-dot.pa-dot-on'), null, { timeout: 5000 });
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => document.querySelector('[data-dg-stage]').classList.contains('pa-playing')), false, 'Space pauses');
  await page.keyboard.press('e');
  assert.equal(await page.locator(`${DLG} [data-pa-caption]`).isHidden(), true, 'E leaves to Explore');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="explore"]`, 'aria-pressed'), 'true');
  await page.locator(`${FIG} .pa-node[data-id="orders"]`).click();
  assert.equal(await page.locator(`${DLG} [data-pa-panel-title]`).textContent(), 'Orders service');
  assert.ok((await page.locator(`${DLG} [data-pa-sends] .pa-row`).count()) >= 2, 'Sends to lists its edges');
  await page.keyboard.press('/');
  assert.equal(await activeIs(page, `${DLG} [data-pa-find]`), true, '/ focuses Find');
  await page.keyboard.type('ware');
  assert.equal(await page.locator(`${DLG} [data-pa-pick]`).count(), 1, 'one match: Warehouse');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), true, 'Escape in Find clears the box; the overlay stays');
  assert.equal(await page.inputValue(`${DLG} [data-pa-find]`), '');
  // Typing in Find dropped the selection, so nothing of the viewer's is left; focus is back in the dialog, so this is a keydown.
  await page.keyboard.press('Escape');
  assert.equal(await open(page), false, 'with nothing of its own left to close, Escape closes the overlay');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Escape closes the panel before the overlay; reopening starts clean on beat 1 in Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url);
  await page.locator('[data-dg-present]').click();
  await page.keyboard.press('e');
  await page.locator(`${FIG} .pa-node[data-id="orders"]`).click();
  assert.equal(await page.locator(`${DLG} [data-pa-panel-body]`).isHidden(), false);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator(`${DLG} [data-pa-panel-body]`).isHidden(), true, 'the panel closed');
  assert.equal(await open(page), true, 'the overlay stayed');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), false);
  await page.locator('[data-dg-present]').click();
  assert.equal(await count(page), '1 / 9');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="play"]`, 'aria-pressed'), 'true');
  assert.equal(await page.locator(`${DLG} [data-pa-panel]`).isHidden(), true, 'no panel over Play');
  await page.keyboard.press('/');
  await page.keyboard.type('ware');
  assert.equal(await page.locator(`${DLG} [data-pa-pick]`).count(), 1);
  await page.locator('[data-dg-close]').click();
  await page.locator('[data-dg-present]').click();
  assert.equal(await page.inputValue(`${DLG} [data-pa-find]`), '', 'closing cleared the Find box');
  assert.equal(await page.locator(`${DLG} [data-pa-found]`).isHidden(), true, 'and its matches');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('full screen in the overlay: a refused request puts pa-fill on the wrapper; Escape leaves it first; Close drops it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url, { init: REFUSES });
  await page.locator('[data-dg-present]').click();
  await page.locator(`${DLG} [data-pa-full]`).click();
  await page.waitForFunction(() => document.querySelector('[data-dg-dialog] [data-dg-root]').classList.contains('pa-fill'));
  assert.equal(await page.locator(`${DLG} [data-pa-full]`).textContent(), 'Exit full screen');
  await page.keyboard.press('Escape');
  assert.equal(await dialogHas(page, 'pa-fill'), false, 'Escape left full screen');
  assert.equal(await open(page), true, 'and the overlay stayed');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-dg-dialog] [data-dg-root]').classList.contains('pa-fill'));
  await page.locator('[data-dg-close]').click();
  assert.equal(await open(page), false);
  assert.equal(await dialogHas(page, 'pa-fill'), false, 'closing drops the layer');
  assert.deepEqual(problems, []);
  await context.close();
});

// A <dialog> can never be fullscreen (Chromium: "Dialog elements are invalid"), so the overlay asks
// for full screen on a wrapper div inside it. No REFUSES init: this is the browser's real answer.
test('full screen in the overlay is real: the wrapper inside the dialog is the fullscreen element, not the pa-fill fallback', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url);
  await page.locator('[data-dg-present]').click();
  const isRoot = () => page.evaluate(() => { const r = document.querySelector('[data-dg-dialog] [data-dg-root]'); return !!r && document.fullscreenElement === r; });
  await page.locator(`${DLG} [data-pa-full]`).click();
  await page.waitForFunction(() => !!document.fullscreenElement || document.querySelector('[data-dg-dialog].pa-fill, [data-dg-dialog] .pa-fill'), null, { timeout: 5000 });
  assert.equal(await isRoot(), true, 'the wrapper div is document.fullscreenElement');
  assert.equal(await page.evaluate(() => !!document.querySelector('[data-dg-dialog] .pa-fill')), false, 'no fallback layer');
  assert.equal(await page.locator(`${DLG} [data-pa-full]`).textContent(), 'Exit full screen');
  const size = page.viewportSize();
  const box = await page.locator(`${DLG} [data-dg-root]`).boundingBox();
  assert.ok(box.width >= size.width - 1 && box.height >= size.height - 1, `the wrapper fills the screen: ${JSON.stringify(box)}`);
  assert.equal(await page.locator(`${DLG} [data-pa-full]`).isVisible(), true, 'the way out stays visible');
  await page.locator(`${DLG} [data-pa-full]`).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  assert.equal(await page.locator(`${DLG} [data-pa-full]`).textContent(), 'Full screen');
  assert.equal(await open(page), true, 'leaving full screen keeps the overlay');
  await page.locator('[data-dg-close]').click();
  assert.deepEqual(problems, []);
  await context.close();
});

test('Escape order survives Find: panel, then overlay (the cancel path obeys the same rule)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url);
  await page.locator('[data-dg-present]').click();
  await page.keyboard.press('e');
  await page.locator(`${FIG} .pa-node[data-id="orders"]`).click();
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), true, 'the overlay stayed');
  assert.equal(await page.locator(`${DLG} [data-pa-panel-body]`).isHidden(), true, 'the second Escape closed the panel');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), false, 'the third closes the overlay');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the keys still work after Escape leaves Find', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url);
  await page.locator('[data-dg-present]').click();
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await count(page), '2 / 9', 'ArrowRight steps');
  await page.keyboard.press('Escape');
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  await page.keyboard.press('e');
  assert.equal(await page.getAttribute(`${DLG} [data-pa-mode="explore"]`, 'aria-pressed'), 'true', 'E reaches the viewer');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a diagram with no beats focuses Close on open, not the hidden Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  // The builder always derives beats, so strip them from the built page's data to reach the no-story case.
  const built = page1();
  const stripped = built.html.replace(/(<script[^>]*data-dg-data[^>]*>)([\s\S]*?)(<\/script>)/, (m, a, json, c) => {
    const d = JSON.parse(json);
    return a + JSON.stringify({ ...d, beats: [], chapters: [], steps: [] }) + c;
  });
  assert.notEqual(stripped, built.html, 'the data script was found and rewritten');
  fs.writeFileSync(built.file, stripped);
  const { page, problems, context } = await openPage(built.url);
  await page.locator('[data-dg-present]').click();
  assert.equal(await open(page), true);
  assert.equal(await page.locator(`${DLG} [data-pa-play]`).isVisible(), false, 'no transport without a story');
  assert.equal(await activeIs(page, '[data-dg-close]'), true);
  assert.deepEqual(problems, []);
  await context.close();
});

// Chrome's focus fix-up (a hidden element that held focus drops it to the body) runs at a later rendering update, not in the keypress: wait it out.
const inDialog = (page) => page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 150));
  const d = document.querySelector('[data-dg-dialog]');
  return d.contains(document.activeElement) && document.activeElement !== d;
});

test('closing Present from Explore returns the inline figure to its resting state: fitted, nothing selected, nothing dimmed', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  const before = await viewBox(page);
  await page.locator('[data-dg-present]').click();
  await page.locator(`${DLG} [data-pa-mode="explore"]`).click();
  await page.locator(node('b')).click();
  assert.equal(await page.locator(`${FIG} .pa-selected`).count(), 1, 'precondition: a node is selected');
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  assert.notEqual(await viewBox(page), before, 'precondition: the camera moved');
  await page.locator('[data-dg-close]').click();
  assert.equal(await open(page), false);
  await page.waitForFunction((vb) => document.querySelector('[data-diagram] svg').getAttribute('viewBox') === vb, before, { timeout: 3000 }).catch(() => {});
  assert.equal(await viewBox(page), before, 'the inline figure is fitted again');
  assert.equal(await page.locator(`${FIG} .pa-selected`).count(), 0, 'no selection left');
  assert.equal(await page.locator(`${FIG} .pa-dim`).count(), 0, 'nothing left dimmed');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Present: pressing E with Play focused keeps focus in the dialog, and the keys still work', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  await page.locator('[data-dg-present]').click();
  assert.equal(await activeIs(page, '[data-pa-play]'), true, 'precondition: focus on Play');
  await page.keyboard.press('e'); // the caption, with the focused Play button, hides
  assert.equal(await inDialog(page), true, 'focus stays inside the dialog');
  await page.keyboard.press('p');
  assert.equal(await page.locator(`${DLG} [data-pa-caption]`).isVisible(), true, 'P still starts the story');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Present: closing the details panel with the mouse keeps focus in the dialog, and the keys still work', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  await page.locator('[data-dg-present]').click();
  await page.locator(`${DLG} [data-pa-mode="explore"]`).click();
  await page.locator(node('b')).click();
  await page.locator(`${DLG} [data-pa-panel-close]`).click(); // nothing stays selected, so Close hides
  assert.equal(await inDialog(page), true, 'focus stays inside the dialog');
  const before = await viewBox(page);
  await page.keyboard.press('+');
  assert.notEqual(await viewBox(page), before, '+ still zooms');
  assert.deepEqual(problems, []);
  await context.close();
});

test('Present: Esc out of Find in Explore hands focus to a visible control, not the hidden Play, and does not close the overlay', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page1().url);
  await page.locator('[data-dg-present]').click();
  await page.keyboard.press('e');
  await page.keyboard.press('/');
  await page.keyboard.press('Escape');
  assert.equal(await open(page), true, 'the first Esc after Find does not close the overlay');
  assert.equal(await inDialog(page), true, 'focus returns inside the dialog');
  await page.keyboard.press('p');
  assert.equal(await page.locator(`${DLG} [data-pa-caption]`).isVisible(), true, 'P still starts the story');
  assert.deepEqual(problems, []);
  await context.close();
});

// A figure keeps its drawn legend (the legend overlay is make-diagram's own page only), so its camera
// fits the whole canvas, widened for a legend row wider than the drawing, not the drawing alone.
test('an inline figure of a narrow diagram still shows its whole legend at rest', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const narrow = {
    title: 'Narrow',
    type: 'flow',
    direction: 'down',
    nodes: ['a', 'b', 'c'].map((id) => ({ id, label: `Checkout service ${id.toUpperCase()}` })),
    edges: [{ from: 'a', to: 'b', style: 'solid' }, { from: 'b', to: 'c', style: 'dashed' }, { from: 'a', to: 'c', style: 'async' }],
  };
  const { page, problems, context } = await openPage(buildSpec(doc({}, [{ type: 'diagram', title: 'Narrow', diagram: narrow, caption: 'Narrow.' }])).url, { width: 1280, height: 900 });
  const seen = await page.evaluate(() => {
    const fig = document.querySelector('[data-diagram]');
    const svg = fig.querySelector('svg').getBoundingClientRect();
    const legend = fig.querySelector('.pa-legend').getBoundingClientRect();
    const view = fig.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
    const data = JSON.parse(fig.querySelector('script[data-dg-data]').textContent);
    return { inside: legend.left >= svg.left - 1 && legend.right <= svg.right + 1 && legend.top >= svg.top - 1 && legend.width > 100, view, canvas: [data.width, data.height], drawing: data.drawing };
  });
  assert.equal(seen.inside, true, 'the drawn legend sits inside the figure');
  const FIT_MARGIN = 16; // make-diagram's camera: the whole canvas and this much around it
  const expected = [-FIT_MARGIN, -FIT_MARGIN, seen.canvas[0] + 2 * FIT_MARGIN, seen.canvas[1] + 2 * FIT_MARGIN];
  seen.view.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= 1, `the view ${seen.view.join(' ')} is the whole canvas (${expected.join(' ')}), not the ${seen.drawing.join('x')} drawing`));
  assert.deepEqual(problems, []);
  await context.close();
});

test('the overlay gives Next a progress ring while a story plays, and takes it away on pause', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(storyPage().url, { reducedMotion: 'no-preference' });
  await page.locator('[data-dg-present]').click();
  assert.equal(await page.locator(`${DLG} .pa-ring`).count(), 0, 'paused: no ring');
  await page.keyboard.press('Space'); // focus starts on Play
  await page.waitForSelector(`${DLG} [data-pa-next] .pa-ring`, { state: 'attached', timeout: 6000 });
  const geo = await page.evaluate(() => {
    const n = document.querySelector('[data-dg-dialog] [data-pa-next]').getBoundingClientRect();
    const r = document.querySelector('[data-dg-dialog] [data-pa-next] .pa-ring').getBoundingClientRect();
    return { w: r.width, h: r.height, inside: r.left >= n.left && r.right <= n.right && r.top >= n.top && r.bottom <= n.bottom };
  });
  assert.ok(geo.w >= 10 && geo.h >= 10 && geo.inside, `ring ${geo.w}x${geo.h} sits inside Next`);
  assert.equal(await page.locator(`${DLG} [data-pa-next]`).textContent(), 'Next');
  await page.keyboard.press('Space'); // pause
  assert.equal(await page.locator(`${DLG} .pa-ring`).count(), 0, 'no ring after pause');
  assert.deepEqual(problems, []);
  await context.close();
});
