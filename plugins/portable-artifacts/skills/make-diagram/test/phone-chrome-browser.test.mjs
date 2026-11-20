// The page chrome on a phone (390x800, the size and motion setting scripts' screenshots use): every toolbar control
// is either shown whole inside the screen or behind a visible More button that shows it; every legend key is shown
// or behind a labelled Legend toggle that opens the whole key. Never a clipped single row. On a desktop nothing hides.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildPage, example, EXAMPLES } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';

after(async () => { await closeBrowser(); });

const PHONE = { width: 390, height: 800, reducedMotion: 'reduce' };
const CHROME_SHARE = 0.25; // toolbar + collapsed legend, of the viewport height

// Each control: whether it shows and whether it sits whole inside the screen and inside any clipping ancestor.
const controls = (page, selector) => page.evaluate((sel) => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const inside = (el) => {
    const b = el.getBoundingClientRect();
    if (b.left < -0.5 || b.right > vw + 0.5 || b.top < -0.5 || b.bottom > vh + 0.5) return false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const r = p.getBoundingClientRect();
      if (b.left < r.left - 0.5 || b.right > r.right + 0.5 || b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5) return false;
    }
    return true;
  };
  return [...document.querySelectorAll(sel)].map((el) => {
    const shown = el.checkVisibility() && el.getBoundingClientRect().width > 0;
    return { name: (el.getAttribute('aria-label') || el.placeholder || el.textContent).trim().slice(0, 24), shown, whole: shown && inside(el) };
  });
}, selector);

const TOOLS = '.tools button:not([data-pa-more]), .tools input';
const named = (list) => list.map((c) => c.name).join(', ');

const PAGES = [...EXAMPLES.map((name) => ({ name })), { name: 'cloud-architecture' }, { name: 'story', theme: 'mono' }];

for (const { name, theme } of PAGES) {
  const label = theme ? `${name} (${theme})` : name;

  test(`${label} at 390x800: every toolbar control shows whole, or a visible More button shows it`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await openPage(buildPage(example(name), { name: `chrome-${name}-${theme ?? 'base'}`, theme }).url, PHONE);
    try {
      const first = await controls(page, TOOLS);
      const clipped = first.filter((c) => c.shown && !c.whole);
      assert.deepEqual(clipped, [], `no control is cut off: ${named(clipped)}`);
      if (first.every((c) => c.shown)) return;
      const [more] = await controls(page, '[data-pa-more]');
      assert.ok(more?.whole, 'a More button shows whole when controls are tucked away');
      assert.equal(await page.getAttribute('[data-pa-more]', 'aria-expanded'), 'false');
      await page.click('[data-pa-more]');
      assert.equal(await page.getAttribute('[data-pa-more]', 'aria-expanded'), 'true');
      const open = await controls(page, TOOLS);
      const missing = open.filter((c) => !c.whole);
      assert.deepEqual(missing, [], `with More open every control shows whole: ${named(missing)}`);
    } finally {
      await context.close();
    }
  });

  test(`${label} at 390x800: every legend key shows, or a labelled Legend toggle opens the whole key; chrome within a quarter`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, context } = await openPage(buildPage(example(name), { name: `legend-${name}-${theme ?? 'base'}`, theme }).url, PHONE);
    try {
      const chrome = await page.evaluate(() => document.querySelector('.bar').getBoundingClientRect().height + document.querySelector('[data-pa-legend]').getBoundingClientRect().height);
      assert.ok(chrome <= CHROME_SHARE * PHONE.height, `toolbar + legend take ${Math.round(chrome)} px of ${PHONE.height}`);
      const first = await controls(page, '[data-pa-legend] .lg');
      const clipped = first.filter((c) => c.shown && !c.whole);
      assert.deepEqual(clipped, [], `no key is cut off: ${named(clipped)}`);
      const [toggle] = await controls(page, '[data-pa-legend-toggle]');
      // a shown toggle folds the keys until it is pressed (else it opens nothing)
      if (toggle?.shown) assert.ok(first.every((c) => !c.shown), `the Legend toggle shows, so the keys wait behind it: ${named(first.filter((c) => c.shown))}`);
      if (first.every((c) => c.whole)) return;
      assert.ok(toggle?.whole, 'a Legend toggle shows whole when keys are tucked away');
      assert.match(toggle.name, /legend/i, 'and says what it opens');
      assert.equal(await page.getAttribute('[data-pa-legend-toggle]', 'aria-expanded'), 'false');
      await page.click('[data-pa-legend-toggle]');
      assert.equal(await page.getAttribute('[data-pa-legend-toggle]', 'aria-expanded'), 'true');
      const open = await controls(page, '[data-pa-legend] .lg');
      const missing = open.filter((c) => !c.whole);
      assert.deepEqual(missing, [], `the open legend shows every key whole: ${named(missing)}`);
    } finally {
      await context.close();
    }
  });
}

test('at 390x800 the / key opens More and puts the caret in Find', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildPage(example('story'), { name: 'chrome-slash' }).url, PHONE);
  try {
    await page.keyboard.press('/');
    assert.equal(await page.getAttribute('[data-pa-more]', 'aria-expanded'), 'true');
    assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('[data-pa-find]')), '/ focuses the box');
  } finally {
    await context.close();
  }
});

test('at 1280x800 nothing is tucked away: every control and key shows, no More button or Legend toggle', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(buildPage(example('story'), { name: 'chrome-desk' }).url, { ...PHONE, width: 1280 });
  try {
    const all = [...await controls(page, TOOLS), ...await controls(page, '[data-pa-legend] .lg')];
    assert.deepEqual(all.filter((c) => !c.whole), [], 'every control and key shows whole');
    const extra = await controls(page, '[data-pa-more], [data-pa-legend-toggle]');
    assert.ok(extra.every((c) => !c.shown), 'no More button or Legend toggle on a desktop');
  } finally {
    await context.close();
  }
});
