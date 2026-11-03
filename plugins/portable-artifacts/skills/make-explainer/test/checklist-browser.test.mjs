import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSpec, buildFile, exampleFile, haveBrowser, openPage, openServed, closeSharedBrowser, scratchDir } from './helpers/browser.mjs';
import { itemId } from '../scripts/lib/render/checklist.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const KEY = 'pa-checklist:demo';
const spec = (groups, extra = {}) => ({ title: 'T', sections: [{ type: 'checklist', title: 'Tests', key: 'demo', groups, ...extra }] });
const G1 = { title: 'Install', items: [{ text: 'one' }, { text: 'two' }, { text: 'three', tag: 'regression' }] };
const G2 = { title: 'Themes', items: [{ text: 'four' }, { text: 'five' }] };
const page5 = () => buildSpec(spec([G1, G2]));

const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
const summary = (page) => page.evaluate(() => ({
  done: document.querySelector('[data-done]').textContent,
  pct: document.querySelector('[data-pct]').textContent,
  now: document.querySelector('[role=progressbar]').getAttribute('aria-valuenow'),
  groups: [...document.querySelectorAll('[data-group-done]')].map((g) => g.textContent),
  ticked: [...document.querySelectorAll('.cl-box:checked')].map((b) => b.closest('.cl-label').querySelector('.cl-text').textContent),
}));
const tick = (page, text) => page.locator('.cl-label', { hasText: text }).locator('input').check();
const untick = (page, text) => page.locator('.cl-label', { hasText: text }).locator('input').uncheck();
// Playwright treats aria-disabled as not clickable; the page must still survive a click on it.
const pressReset = (page) => page.locator('[data-reset]').click({ force: true });

test('ticking updates the bar, the percentage, the group tallies and the progressbar value', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page5().url);
  assert.deepEqual(await summary(page), { done: '0', pct: '0%', now: '0', groups: ['0', '0'], ticked: [] });
  await tick(page, 'one');
  await tick(page, 'four');
  await tick(page, 'five');
  assert.deepEqual(await summary(page), { done: '3', pct: '60%', now: '3', groups: ['1', '2'], ticked: ['one', 'four', 'five'] });
  assert.equal(await page.locator('[role=progressbar] > span').evaluate((el) => el.style.width), '60%');
  assert.equal(await page.locator('[data-complete]').isHidden(), true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('ticks persist across a reload under pa-checklist:<key> as {id: true}', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openServed(page5().url);
  await tick(page, 'two');
  await tick(page, 'five');
  assert.deepEqual(JSON.parse(await stored(page)), { [itemId('Install', 'two')]: true, [itemId('Themes', 'five')]: true });
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.deepEqual((await summary(page)).ticked, ['two', 'five']);
  assert.equal((await summary(page)).done, '2');
  await untick(page, 'two');
  assert.deepEqual(JSON.parse(await stored(page)), { [itemId('Themes', 'five')]: true });
  await context.close();
});

test('all done shows Complete with 100%, and one less takes it back', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page5().url);
  for (const text of ['one', 'two', 'three', 'four', 'five']) await tick(page, text);
  assert.equal((await summary(page)).pct, '100%');
  assert.equal(await page.locator('[data-complete]').isVisible(), true);
  assert.match(await page.locator('[data-complete]').textContent(), /Complete/);
  assert.equal(await page.locator('[data-group]').first().evaluate((el) => el.classList.contains('is-complete')), true);
  await untick(page, 'five');
  assert.equal((await summary(page)).pct, '80%');
  assert.equal(await page.locator('[data-complete]').isHidden(), true);
  await context.close();
});

// Review Focus 2: stable ids.
test('reordering items and groups in the spec keeps every tick', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const a = page5();
  const { page, context } = await openServed(a.url);
  await tick(page, 'one');
  await tick(page, 'five');
  const b = buildSpec(spec([{ ...G2, items: [...G2.items].reverse() }, { ...G1, items: [...G1.items].reverse() }]));
  fs.copyFileSync(b.file, a.file); // same file, same origin, same storage
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.deepEqual((await summary(page)).ticked.sort(), ['five', 'one']);
  assert.equal((await summary(page)).done, '2');
  await context.close();
});

test('editing one item resets only that item; renaming a group resets only that group', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const a = page5();
  const { page, context } = await openServed(a.url);
  for (const text of ['one', 'two', 'four']) await tick(page, text);
  const edited = buildSpec(spec([{ ...G1, items: [{ text: 'one' }, { text: 'two reworded' }, G1.items[2]] }, G2]));
  fs.copyFileSync(edited.file, a.file);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.deepEqual((await summary(page)).ticked.sort(), ['four', 'one']);
  const renamed = buildSpec(spec([{ ...G1, items: [{ text: 'one' }, { text: 'two reworded' }, G1.items[2]] }, { ...G2, title: 'Themes and kinds' }]));
  fs.copyFileSync(renamed.file, a.file);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.deepEqual((await summary(page)).ticked, ['one'], 'four lived in the renamed group, so it starts over; the edited item stays unticked');
  await context.close();
});

test('an id this page does not know is ignored in the tally but survives every write, reset included', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const stale = JSON.stringify({ deadbeef00: true, [itemId('Install', 'one')]: true });
  const { page, problems, context } = await openPage(page5().url, { seed: { [KEY]: stale } });
  assert.deepEqual(await summary(page), { done: '1', pct: '20%', now: '1', groups: ['1', '0'], ticked: ['one'] });
  await tick(page, 'two');
  assert.deepEqual(JSON.parse(await stored(page)), { deadbeef00: true, [itemId('Install', 'one')]: true, [itemId('Install', 'two')]: true });
  await untick(page, 'one');
  assert.deepEqual(JSON.parse(await stored(page)), { deadbeef00: true, [itemId('Install', 'two')]: true });
  await pressReset(page);
  await page.locator('[data-reset-yes]').click();
  assert.deepEqual(JSON.parse(await stored(page)), { deadbeef00: true }, 'reset clears this page\'s ticks only');
  assert.deepEqual(problems, []);
  await context.close();
});

test('two pages on one key: both ticks survive, and each page follows the other through the storage event', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const url = page5().url;
  const a = await openServed(url);
  const b = await openServed(url, { context: a.context });
  await tick(a.page, 'one');
  await b.page.waitForFunction(() => document.querySelector('[data-done]').textContent === '1');
  assert.deepEqual((await summary(b.page)).ticked, ['one'], 'B reflects A after the event');
  assert.deepEqual((await summary(b.page)).groups, ['1', '0']);
  assert.equal(await b.page.locator('[role=progressbar]').getAttribute('aria-valuenow'), '1');
  await tick(b.page, 'four');
  await a.page.waitForFunction(() => document.querySelector('[data-done]').textContent === '2');
  assert.deepEqual((await summary(a.page)).ticked.sort(), ['four', 'one']);
  assert.deepEqual(JSON.parse(await stored(a.page)), { [itemId('Install', 'one')]: true, [itemId('Themes', 'four')]: true });
  await untick(a.page, 'one');
  await b.page.waitForFunction(() => document.querySelector('[data-done]').textContent === '1');
  assert.deepEqual((await summary(b.page)).ticked, ['four']);
  assert.deepEqual(a.problems, []);
  assert.deepEqual(b.problems, []);
  await a.context.close();
});

test('a write from a page that never saw the other tab\'s tick still keeps it (merge, not replace)', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const url = page5().url;
  const a = await openServed(url);
  const b = await openServed(url, { context: a.context });
  // B ignores the event, as a tab that was asleep would.
  await b.page.evaluate(() => { window.addEventListener('storage', (e) => e.stopImmediatePropagation(), true); });
  await tick(a.page, 'one');
  await tick(b.page, 'five');
  assert.deepEqual(JSON.parse(await stored(b.page)), { [itemId('Install', 'one')]: true, [itemId('Themes', 'five')]: true });
  await a.context.close();
});

test('the reset count follows ticks made while the confirm is open, and the confirm closes when none are left', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page5().url);
  await tick(page, 'one');
  await pressReset(page);
  assert.equal((await page.locator('[data-confirm-text]').textContent()).trim(), 'Reset all 1 tick?');
  await tick(page, 'two');
  assert.equal((await page.locator('[data-confirm-text]').textContent()).trim(), 'Reset all 2 ticks?');
  await untick(page, 'one');
  assert.equal((await page.locator('[data-confirm-text]').textContent()).trim(), 'Reset all 1 tick?');
  await untick(page, 'two');
  assert.equal(await page.locator('[data-confirm]').isHidden(), true, 'nothing left to reset');
  assert.equal(await page.locator('[data-reset]').isVisible(), true);
  await context.close();
});

test('a tag chip that wraps to its own line starts at the text edge, not indented', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const long = 'A manual step with enough words that the tag chip no longer fits beside it on a phone screen';
  const built = buildSpec(spec([{ title: 'G', items: [{ text: long, tag: 'regression' }] }]));
  const { page, context } = await openPage(built.url, { width: 390, height: 844 });
  const edges = await page.evaluate(() => ({
    text: document.querySelector('.cl-text').getBoundingClientRect().left,
    chipTop: document.querySelector('.cl-item-chip').getBoundingClientRect().top,
    textBottom: document.querySelector('.cl-text').getBoundingClientRect().bottom,
    chip: document.querySelector('.cl-item-chip').getBoundingClientRect().left,
  }));
  assert.ok(edges.chipTop >= edges.textBottom - 1, 'the chip wrapped below the text at 390');
  assert.ok(Math.abs(edges.chip - edges.text) <= 1, `chip left ${edges.chip} vs text left ${edges.text}`);
  await context.close();
});

test('garbage in storage reads as an empty checklist without errors', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = page5();
  for (const junk of ['not json', '[1,2]', 'null', '{"__proto__":true,"constructor":true}', '"x"', '']) {
    const { page, problems, context } = await openPage(built.url, { seed: { [KEY]: junk } });
    assert.equal((await summary(page)).done, '0', junk);
    await tick(page, 'one');
    assert.equal((await summary(page)).done, '1');
    assert.deepEqual(problems, [], junk);
    await context.close();
  }
});

test('reset: asks inline with the count, No keeps the ticks, Yes clears them and the storage key, no dialog', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openServed(page5().url);
  assert.equal(await page.locator('[data-reset]').getAttribute('aria-disabled'), 'true');
  await pressReset(page);
  assert.equal(await page.locator('[data-confirm]').isHidden(), true, 'nothing to reset yet');
  await tick(page, 'one');
  await tick(page, 'two');
  assert.equal(await page.locator('[data-reset]').getAttribute('aria-disabled'), 'false');
  await page.locator('[data-reset]').click();
  assert.equal(await page.locator('[data-confirm]').isVisible(), true);
  assert.equal((await page.locator('[data-confirm-text]').textContent()).trim(), 'Reset all 2 ticks?');
  assert.equal(await page.locator('[data-reset]').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-reset-no')), true, 'focus lands on the safe choice');
  await page.locator('[data-reset-no]').click();
  assert.equal(await page.locator('[data-confirm]').isHidden(), true);
  assert.equal((await summary(page)).done, '2');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-reset')), true, 'focus returns to Reset');

  await page.locator('[data-reset]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-confirm]').isHidden(), true, 'Escape cancels');
  assert.equal((await summary(page)).done, '2');

  await page.locator('[data-reset]').click();
  await page.locator('[data-reset-yes]').click();
  assert.deepEqual(await summary(page), { done: '0', pct: '0%', now: '0', groups: ['0', '0'], ticked: [] });
  assert.equal(await stored(page), null, 'the key is removed, not left as {}');
  assert.equal(await page.locator('[data-confirm]').isHidden(), true);
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-reset')), true);
  assert.match(await page.locator('[role=status]').textContent(), /reset/i);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal((await summary(page)).done, '0');
  assert.deepEqual(problems, [], 'no window.confirm dialog was raised');
  await context.close();
});

test('reset says "1 tick" for a single tick', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page5().url);
  await tick(page, 'one');
  await page.locator('[data-reset]').click();
  assert.equal((await page.locator('[data-confirm-text]').textContent()).trim(), 'Reset all 1 tick?');
  await context.close();
});

test('blocked storage: a quiet chip says so, ticks still work for the visit, nothing throws', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page5().url, { blockStorage: true });
  const chip = page.locator('[data-unsaved]');
  assert.equal(await chip.isVisible(), true);
  assert.match(await chip.textContent(), /Progress won't be saved in this browser/);
  assert.equal(await chip.locator('svg').count(), 1, 'a glyph and a word');
  await tick(page, 'one');
  await tick(page, 'four');
  assert.deepEqual(await summary(page), { done: '2', pct: '40%', now: '2', groups: ['1', '1'], ticked: ['one', 'four'] });
  await page.locator('[data-reset]').click();
  await page.locator('[data-reset-yes]').click();
  assert.equal((await summary(page)).done, '0');
  assert.deepEqual(problems, []);
  await context.close();
});

test('working storage shows no unsaved chip; a write that fails mid-visit shows it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(page5().url);
  assert.equal(await page.locator('[data-unsaved]').isHidden(), true);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); }; });
  await tick(page, 'one');
  assert.equal(await page.locator('[data-unsaved]').isVisible(), true);
  assert.equal((await summary(page)).done, '1');
  assert.deepEqual(problems, []);
  await context.close();
});

test('keyboard: Tab reaches each checkbox, Space toggles it, the focus ring shows, Enter on Reset opens the confirm', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page5().url);
  // skip link, theme toggle, the heading's anchor, then Reset (aria-disabled but still focusable)
  for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement.hasAttribute('data-reset'))); i++) await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-reset')), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), itemId('Install', 'one'));
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'a visible focus ring');
  await page.keyboard.press('Space');
  assert.equal((await summary(page)).done, '1');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await page.keyboard.press('Space');
  assert.equal((await summary(page)).done, '1', 'Space twice toggles back');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-reset')), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('[data-confirm]').isVisible(), true);
  await context.close();
});

test('clicking the label text toggles the box, including the note and the tag chip', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(spec([{ title: 'G', items: [{ text: 'alpha', tag: 'device', note: 'a note under it' }, { text: 'beta' }] }]));
  const { page, context } = await openPage(built.url);
  await page.locator('.cl-text', { hasText: 'alpha' }).click();
  assert.equal((await summary(page)).done, '1');
  await page.locator('.cl-note').click();
  assert.equal((await summary(page)).done, '0');
  await page.locator('.cl-item-chip').click();
  assert.equal((await summary(page)).done, '1');
  await context.close();
});

test('the bar sticks to the top while the list scrolls, at 1280 and 390', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const many = Array.from({ length: 5 }, (_, g) => ({ title: `Group ${g}`, items: Array.from({ length: 8 }, (_, i) => ({ text: `Item ${g}.${i} with a sentence long enough to be a realistic manual test step` })) }));
  const built = buildSpec(spec(many));
  for (const width of [1280, 390]) {
    const { page, context } = await openPage(built.url, { width, height: width === 390 ? 844 : 900 });
    await page.evaluate(() => window.scrollTo(0, 1200));
    const top = await page.locator('.cl-bar').evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(Math.abs(top) <= 1, `bar top is ${top} at ${width}`);
    await tick(page, 'Item 3.2 ');
    assert.equal((await summary(page)).done, '1', 'the page can be ticked while the bar is stuck');
    await context.close();
  }
});

test('two checklists keep separate bars, tallies and storage keys', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec({
    title: 'T',
    sections: [
      { type: 'checklist', title: 'First', key: 'first', groups: [{ title: 'G', items: [{ text: 'a' }, { text: 'b' }] }] },
      { type: 'checklist', title: 'Second', key: 'second', groups: [{ title: 'G', items: [{ text: 'a' }] }] },
    ],
  });
  const { page, context } = await openPage(built.url);
  await page.locator('[data-checklist]').nth(1).locator('input').check();
  assert.equal(await page.locator('[data-checklist]').nth(0).locator('[data-done]').textContent(), '0');
  assert.equal(await page.locator('[data-checklist]').nth(1).locator('[data-done]').textContent(), '1');
  assert.equal(await page.evaluate(() => localStorage.getItem('pa-checklist:first')), null);
  assert.deepEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('pa-checklist:second'))), { [itemId('G', 'a')]: true });
  assert.deepEqual(await page.locator('[role=progressbar]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Progress: First', 'Progress: Second']);
  await context.close();
});

test('the context block is open and collapsible; the default failure text and a custom onFail both render', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec(spec([G1], { intro: 'What changed: **two** things.' }));
  const { page, context } = await openPage(built.url);
  assert.equal(await page.locator('.cl-context').evaluate((d) => d.open), true);
  assert.match(await page.locator('.cl-context summary').textContent(), /What's in this branch/);
  await page.locator('.cl-context summary').click();
  assert.equal(await page.locator('.cl-context').evaluate((d) => d.open), false);
  assert.match(await page.locator('.cl-fail').textContent(), /If something fails[\s\S]*Leave the box unticked/);
  await context.close();
});

test('print hides Reset and the confirm; the bar stops sticking', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(page5().url);
  await page.emulateMedia({ media: 'print' });
  const state = await page.evaluate(() => ({
    reset: getComputedStyle(document.querySelector('[data-reset]')).display,
    bar: getComputedStyle(document.querySelector('.cl-bar')).position,
  }));
  assert.deepEqual(state, { reset: 'none', bar: 'static' });
  await context.close();
});

// ---- the example: layout and screenshots ------------------------------------------------------

const exampleIds = () => {
  const spec = JSON.parse(fs.readFileSync(exampleFile('checklist'), 'utf8'));
  return spec.sections[0].groups.flatMap((g) => g.items.map((it) => itemId(g.title, it.text)));
};

test('the example checklist: no overflow at 1280 and 390, mid-progress screenshots in light and dark', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('checklist'), { name: 'checklist-example' });
  const ids = exampleIds();
  const seed = { 'pa-checklist:feat-visual-artifacts': JSON.stringify(Object.fromEntries(ids.filter((_, i) => i % 3 !== 2 && i < 18).map((id) => [id, true]))) };
  const shots = [];
  for (const width of [1280, 390]) {
    for (const colorScheme of ['light', 'dark']) {
      const { page, problems, context } = await openPage(built.url, { width, height: width === 390 ? 844 : 900, colorScheme, seed });
      const fit = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll('body *')].filter((el) => !el.closest('.sr-only, .skip') && el.getBoundingClientRect().right > limit + 1).map((el) => `${el.tagName}.${el.className}`);
        return { scroll: document.documentElement.scrollWidth, limit, wide };
      });
      assert.ok(fit.scroll <= fit.limit, `scrolls sideways at ${width}: ${fit.scroll} > ${fit.limit}`);
      assert.deepEqual(fit.wide, []);
      assert.deepEqual(problems, []);
      assert.ok(Number(await page.locator('[data-done]').first().textContent()) > 0, 'seeded ticks were read');
      const file = path.join(scratchDir(), `checklist-${width}-${colorScheme}.png`);
      await page.screenshot({ path: file });
      await page.screenshot({ path: file.replace('.png', '-full.png'), fullPage: true });
      shots.push(file);
      await context.close();
    }
  }
  console.log(`# screenshots: ${shots.join(' ')}`);
});
