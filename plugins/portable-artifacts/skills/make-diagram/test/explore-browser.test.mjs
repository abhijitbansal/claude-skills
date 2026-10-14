// Explore: the side panel for a node or an edge, the hover tooltip, Escape and
// focus. Task 5 appends the route tests, Task 6 the Find and count-chip tests.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPage, example } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle, viewBox, boxOf, holds } from './helpers/page.mjs';
import { PROTOTYPE_NAMED_SPECS } from './helpers/prototype-ids.mjs';

after(closeBrowser);

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name: `explore-${name}` }));

const title = (page) => page.textContent('[data-pa-panel-title]');
const texts = (page, sel) => page.locator(sel).allTextContents();
const bodyHidden = (page) => page.isHidden('[data-pa-panel-body]');
const selectedIds = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-selected')].map((e) => e.dataset.id).sort());
const dimmedNodes = (page) => page.evaluate(() => [...document.querySelectorAll('.pa-node.pa-dim')].map((n) => n.dataset.id).sort());
const activeId = (page) => page.evaluate(() => document.activeElement?.dataset?.id ?? document.activeElement?.tagName ?? null);
const playing = (page) => page.evaluate(() => document.getElementById('pa-stage').classList.contains('pa-playing'));
// A click that no real mouse can land (a thin edge path): the pointer events the stage listens for, on the element itself.
const tap = async (page, sel) => {
  await page.dispatchEvent(sel, 'pointerdown', { pointerId: 7, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
  await page.dispatchEvent(sel, 'pointerup', { pointerId: 7, button: 0, isPrimary: true, clientX: 10, clientY: 10 });
};

test('a node click opens the panel: emoji, kind, label, detail, Sends to and Receives from; the selection and its neighbours stay lit', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isVisible('[data-pa-panel]'), true, 'the panel is there in Explore');
  assert.equal(await title(page), 'Map');
  assert.equal(await bodyHidden(page), true);
  assert.equal(await page.isHidden('[data-pa-panel-close]'), true);
  await page.click('.pa-node[data-id="orders"]');
  assert.equal(await title(page), 'Orders service');
  assert.equal(await page.textContent('.panel-icon'), '📦');
  assert.equal(await page.textContent('.panel-kind'), 'service');
  assert.ok((await page.textContent('.panel-detail')).startsWith('Owns the order lifecycle.'));
  assert.equal(await page.locator('.panel-note').count(), 0, 'no note, no note line');
  assert.deepEqual(await texts(page, '[data-pa-sends] .pa-row'), ['→ Orders DB · writes order', '→ Event bus · order.placed', '→ API gateway · 201 Created']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .pa-row'), ['← API gateway · forwards']);
  assert.deepEqual(await selectedIds(page), ['orders']);
  assert.deepEqual(await dimmedNodes(page), ['app', 'shopper', 'warehouse'], 'neighbours stay lit');
  await page.mouse.move(2, 2);
  assert.deepEqual(await selectedIds(page), ['orders'], 'the selection outlives the pointer');
  assert.equal(await page.isVisible('[data-pa-panel-close]'), true);
  await page.click('[data-pa-panel-close]');
  assert.equal(await title(page), 'Map');
  assert.equal(await bodyHidden(page), true);
  assert.deepEqual(await selectedIds(page), []);
  assert.equal(await page.locator('.pa-dim').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('an icon node shows a copy of its icon; a Sends to row jumps to the other end, selects it and fits the camera', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-node[data-id="orders"]');
  await page.click('[data-pa-go="db"]');
  assert.equal(await title(page), 'Orders DB');
  assert.equal(await page.locator('.panel-icon svg.panel-glyph .pa-icon').count(), 1, 'the diagram icon, copied');
  assert.equal(await page.textContent('.panel-icon'), '', 'no emoji text');
  assert.equal(await page.textContent('.panel-kind'), 'database');
  assert.deepEqual(await selectedIds(page), ['db']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .pa-row'), ['← Orders service · writes order']);
  assert.deepEqual(await texts(page, '[data-pa-sends] .panel-none'), ['nothing']);
  await settle(page);
  assert.ok(holds(await viewBox(page), await boxOf(page, ['db'])), 'the camera fits the picked node');
  assert.deepEqual(problems, []);
  await context.close();
});

test('two edges between the same ends are two rows; a group at an edge end is a row that selects the group', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const story = await openPage(built('story').url);
  await story.page.click('.pa-node[data-id="gateway"]');
  assert.equal(await story.page.textContent('.panel-note'), 'auth, rate limits');
  assert.deepEqual(await texts(story.page, '[data-pa-sends] .pa-row'), ['→ Orders service · forwards']);
  assert.deepEqual(await texts(story.page, '[data-pa-receives] .pa-row'), ['← Mobile app · POST /orders', '← Orders service · 201 Created']);
  assert.deepEqual(story.problems, []);
  await story.context.close();

  const arch = await openPage(built('architecture').url);
  await arch.page.click('.pa-node[data-id="web"]');
  assert.deepEqual(await texts(arch.page, '[data-pa-sends] .pa-row'), ['→ Checkout API · POST /checkout', '→ Private VPC'], 'the two-headed edge onto the group, unlabelled');
  await arch.page.click('[data-pa-go="vpc"]');
  assert.equal(await title(arch.page), 'Private VPC');
  assert.equal(await arch.page.textContent('.panel-kind'), 'group');
  assert.ok(await arch.page.evaluate(() => document.querySelector('.pa-group[data-id="vpc"]').classList.contains('pa-selected')));
  assert.deepEqual(await texts(arch.page, '[data-pa-sends] .pa-row'), ['→ Web app']);
  await settle(arch.page);
  assert.ok(holds(await viewBox(arch.page), await boxOf(arch.page, ['vpc'])));
  assert.deepEqual(arch.problems, []);
  await arch.context.close();
});

test('Enter on a focused node opens the panel; Escape inside the panel closes it and returns focus to the node; a second Escape ends the focus trace', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.focus('.pa-node[data-id="gateway"]');
  await page.keyboard.press('Enter');
  assert.equal(await title(page), 'API gateway');
  await page.focus('[data-pa-panel-close]');
  assert.equal(await activeId(page), 'BUTTON');
  await page.keyboard.press('Escape');
  assert.equal(await bodyHidden(page), true, 'Escape in the panel closes it');
  assert.equal(await activeId(page), 'gateway', 'focus is back on the node');
  assert.ok((await page.locator('.pa-dim').count()) > 0, 'the focused node traces');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pa-dim').count(), 0, 'a second Escape clears the focus trace');
  assert.notEqual(await activeId(page), 'gateway');
  await page.focus('.pa-node[data-id="gateway"]');
  await page.keyboard.press('Enter');
  await page.focus('[data-pa-panel-close]');
  await page.keyboard.press('Enter');
  assert.equal(await bodyHidden(page), true, 'Enter on Close closes');
  assert.equal(await activeId(page), 'gateway', 'and, pressed from the keyboard, returns focus to the node');
  assert.deepEqual(problems, []);
  await context.close();
});

test('an edge click shows its label, style, ends and the beats that use it; a beat row enters Play paused at that beat', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-edge-label[data-edge="edge-0"]');
  assert.equal(await title(page), 'taps Buy');
  assert.equal(await page.textContent('.panel-kind'), 'solid');
  assert.deepEqual(await texts(page, '[data-pa-ends] .pa-row'), ['Shopper', 'Mobile app']);
  assert.equal(await page.textContent('[data-pa-ends] .panel-arrow'), '→');
  assert.deepEqual(await texts(page, '[data-pa-used] .pa-row'), ['01 The shopper taps Buy', '06 The shopper sees a receipt'], 'the forward hop and the reverse one');
  assert.deepEqual(await selectedIds(page), ['edge-0']);
  await page.click('[data-pa-beat-go="5"]');
  assert.equal(await page.textContent('[data-pa-count]'), '6 / 9');
  assert.equal(await playing(page), false, 'paused on the beat');
  assert.equal(await page.isHidden('[data-pa-panel]'), true, 'the panel hides in Play');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('[data-pa-caption]'), false);
  assert.equal(await page.isVisible('[data-pa-panel]'), true);
  assert.equal(await title(page), 'Map', 'entering Play dropped the selection');
  assert.deepEqual(problems, []);
  await context.close();
});

test('an unlabelled two-headed edge: title "Edge", a ↔ between the ends, "no beat"; in a sequence a message says its kind', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const arch = await openPage(built('architecture').url);
  await tap(arch.page, '.pa-edge[data-id="edge-3"]');
  assert.equal(await title(arch.page), 'Edge');
  assert.equal(await arch.page.textContent('.panel-kind'), 'dashed');
  assert.deepEqual(await texts(arch.page, '[data-pa-ends] .pa-row'), ['Web app', 'Private VPC']);
  assert.equal(await arch.page.textContent('[data-pa-ends] .panel-arrow'), '↔');
  assert.deepEqual(await texts(arch.page, '[data-pa-used] .panel-none'), ['no beat'], 'a step-derived timeline has no hops');
  assert.deepEqual(arch.problems, []);
  await arch.context.close();

  const seq = await openPage(built('sequence').url);
  await seq.page.click('.pa-edge-label[data-edge="m1"]');
  assert.equal(await seq.page.textContent('.panel-kind'), 'sync');
  assert.equal(await seq.page.textContent('[data-pa-ends] .panel-arrow'), '→');
  await seq.page.click('.pa-node[data-id="shopper"]');
  assert.ok((await seq.page.locator('[data-pa-sends] .pa-row').count()) >= 1, 'a participant lists the messages it sends');
  assert.deepEqual(seq.problems, []);
  await seq.context.close();
});

test('hover shows a tooltip: "label — note" for a node, the label for an edge, both ends for one without; it hides on leaving, while dragging and in Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.isHidden('[data-pa-tip]'), true);
  await page.hover('.pa-node[data-id="gateway"]');
  assert.equal(await page.isVisible('[data-pa-tip]'), true);
  assert.equal(await page.textContent('[data-pa-tip]'), 'API gateway — auth, rate limits');
  assert.equal(await page.getAttribute('[data-pa-tip]', 'role'), 'tooltip');
  const tipBox = await page.locator('[data-pa-tip]').boundingBox();
  const stageBox = await page.locator('#pa-stage').boundingBox();
  assert.ok(tipBox.x >= stageBox.x && tipBox.x + tipBox.width <= stageBox.x + stageBox.width + 1, 'the tip stays inside the stage');
  await page.hover('.pa-node[data-id="shopper"]');
  assert.equal(await page.textContent('[data-pa-tip]'), 'Shopper', 'no note, no dash');
  await page.hover('.pa-edge-label[data-edge="place"]');
  assert.equal(await page.textContent('[data-pa-tip]'), 'POST /orders');
  await page.mouse.move(2, 2);
  assert.equal(await page.isHidden('[data-pa-tip]'), true, 'leaving the diagram hides it');
  await page.keyboard.press('p');
  await page.dispatchEvent('.pa-node[data-id="db"]', 'pointerover');
  assert.equal(await page.isHidden('[data-pa-tip]'), true, 'no tooltip in Play');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('an edge with no label tips both ends', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('architecture').url);
  await page.dispatchEvent('.pa-edge[data-id="edge-3"]', 'pointerover');
  assert.equal(await page.textContent('[data-pa-tip]'), 'Web app → Private VPC');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a node with no edges: both lists say nothing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = { title: 'Lonely', type: 'flow', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ from: 'a', to: 'b' }] };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'lonely' }).url);
  await page.click('.pa-node[data-id="c"]');
  assert.equal(await title(page), 'C');
  assert.deepEqual(await texts(page, '[data-pa-sends] .panel-none'), ['nothing']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .panel-none'), ['nothing']);
  assert.deepEqual(await dimmedNodes(page), ['a', 'b']);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a prototype-named group at a two-headed edge end is listed both ways', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = PROTOTYPE_NAMED_SPECS['a group named constructor at a two-headed edge end'];
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'proto-group' }).url);
  await page.click('.pa-node[data-id="b"]');
  assert.deepEqual(await texts(page, '[data-pa-sends] .pa-row'), ['→ Group']);
  assert.deepEqual(await texts(page, '[data-pa-receives] .pa-row'), ['← A', '← Group']);
  await page.click('[data-pa-go="constructor"]');
  assert.equal(await title(page), 'Group');
  assert.equal(await page.textContent('.panel-kind'), 'group');
  assert.deepEqual(problems, []);
  await context.close();
});

test('hostile text in label, note, detail and an edge label reaches the panel, the rows and the tooltip as text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const evil = '<b>&"x"';
  const spec = {
    title: 'Evil explore', type: 'architecture',
    nodes: [{ id: 'a', label: evil, note: evil, detail: evil }, { id: 'b', label: 'B [x]' }],
    edges: [{ from: 'a', to: 'b', label: evil }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'evil-explore' }).url);
  await page.click('.pa-node[data-id="a"]');
  assert.equal(await page.locator('b').count(), 0);
  assert.equal(await title(page), evil);
  assert.equal(await page.textContent('.panel-note'), evil);
  assert.equal(await page.textContent('.panel-detail'), evil);
  assert.deepEqual(await texts(page, '[data-pa-sends] .pa-row'), [`→ B [x] · ${evil}`]);
  await page.hover('.pa-node[data-id="a"]');
  assert.equal(await page.textContent('[data-pa-tip]'), `${evil} — ${evil}`);
  assert.equal(await page.locator('b').count(), 0);
  assert.deepEqual(problems, []);
  await context.close();
});

test('exports carry no explore state: no pa-selected, no pa-dim, no pa-on', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.click('.pa-node[data-id="orders"]');
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('[data-export="svg"]')]);
  const text = fs.readFileSync(await d.path(), 'utf8');
  assert.ok(!/class="[^"]*\bpa-(selected|route|dim|on)\b/.test(text), 'no viewer state on any element');
  assert.deepEqual(problems, []);
  await context.close();
});

for (const width of [1280, 390]) {
  test(`the panel open with a selection at ${width} px: no console problems, no overflow, a finite camera`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(built('story').url, { width, height: width === 390 ? 780 : 800 });
    await page.click('.pa-node[data-id="orders"]');
    assert.equal(await title(page), 'Orders service');
    await settle(page);
    const fit = await page.evaluate(() => ({ w: document.documentElement.scrollWidth <= window.innerWidth, h: document.documentElement.scrollHeight <= window.innerHeight }));
    assert.ok(fit.w, 'no horizontal overflow');
    assert.ok(fit.h, 'no vertical overflow');
    assert.ok((await viewBox(page)).every(Number.isFinite));
    assert.deepEqual(problems, []);
    await context.close();
  });
}

test('Escape on Close never drops focus to the page: an edge falls back to its first end, a group to the panel title', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const story = await openPage(built('story').url);
  await tap(story.page, '.pa-edge[data-id="edge-0"]');
  assert.equal(await title(story.page), 'taps Buy');
  await story.page.focus('[data-pa-panel-close]');
  await story.page.keyboard.press('Escape');
  assert.equal(await bodyHidden(story.page), true);
  assert.equal(await activeId(story.page), 'shopper', 'an edge returns focus to its first end node');
  assert.deepEqual(story.problems, []);
  await story.context.close();

  const arch = await openPage(built('architecture').url);
  await arch.page.click('.pa-node[data-id="web"]');
  await arch.page.click('[data-pa-go="vpc"]');
  assert.equal(await title(arch.page), 'Private VPC');
  await arch.page.focus('[data-pa-panel-close]');
  await arch.page.keyboard.press('Enter');
  assert.equal(await bodyHidden(arch.page), true);
  assert.notEqual(await arch.page.evaluate(() => document.activeElement.tagName), 'BODY', 'a group has no focus stop: focus lands on the panel');
  assert.deepEqual(arch.problems, []);
  await arch.context.close();
});

test('pressing P with the pointer over a node hides the tooltip and it stays hidden as the pointer moves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  await page.hover('.pa-node[data-id="gateway"]');
  assert.equal(await page.isVisible('[data-pa-tip]'), true);
  await page.keyboard.press('p');
  assert.equal(await page.isHidden('[data-pa-tip]'), true, 'entering Play hides the tip');
  await page.dispatchEvent('.pa-node[data-id="gateway"]', 'pointermove', { clientX: 30, clientY: 30 });
  assert.equal(await page.isHidden('[data-pa-tip]'), true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('a group and a node named "null" are not selected by a null id', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const spec = {
    title: 'Null ids', type: 'architecture',
    groups: [{ id: 'null', label: 'Null group' }],
    nodes: [{ id: 'a', label: 'A', group: 'null' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
  };
  const { page, problems, context } = await openPage(buildPage(spec, { name: 'null-named' }).url);
  await page.hover('.pa-node[data-id="b"]');
  assert.deepEqual(await selectedIds(page), [], 'hover has no selection, so the "null" group is not selected');
  await page.mouse.move(2, 2);
  await page.focus('.pa-node[data-id="b"]');
  await page.keyboard.press('Escape');
  assert.notEqual(await activeId(page), 'null');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the panel title announces itself politely and is a focus fallback', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url);
  assert.equal(await page.getAttribute('[data-pa-panel-title]', 'aria-live'), 'polite');
  assert.equal(await page.getAttribute('[data-pa-panel-title]', 'tabindex'), '-1');
  assert.deepEqual(problems, []);
  await context.close();
});
