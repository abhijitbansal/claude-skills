import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSpec, buildFile, exampleFile, haveBrowser, openPage, closeSharedBrowser, scratchDir } from './helpers/browser.mjs';

after(closeSharedBrowser);

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const SLUG_KEY = 'pa-slides:page';
const topic = (n) => ({ type: 'text', title: `Topic ${n}`, text: `Body ${n}.` });
const spec = (count, extra = {}) => ({ title: 'Deck', subtitle: 'A short deck', mode: 'slides', sections: Array.from({ length: count }, (_, i) => topic(i + 1)), ...extra });
const deck5 = () => buildSpec(spec(4)); // 5 slides with the title slide

const current = (page) => page.evaluate(() => Number(document.querySelector('[data-deck]').dataset.current));
const hash = (page) => page.evaluate(() => location.hash);
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), SLUG_KEY);
const settled = (page, n) => page.waitForFunction((want) => Number(document.querySelector('[data-deck]').dataset.current) === want, n);
// The deck is scrolled so slide n fills the viewport.
const aligned = (page, n) => page.evaluate((i) => {
  const deck = document.querySelector('[data-deck]');
  const slide = document.getElementById(`slide-${i}`);
  return Math.abs(deck.scrollTop - slide.offsetTop) < 2;
}, n);

// ---- keyboard ----------------------------------------------------------------------------

test('keys: arrows, Space, Shift+Space, PageUp/PageDown, Home and End move between slides', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(deck5().url);
  assert.equal(await current(page), 1);
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 2);
  assert.equal(await hash(page), '#slide-2');
  assert.equal(await aligned(page, 2), true, 'the deck scrolled so slide 2 fills the view');
  await page.keyboard.press('Space');
  assert.equal(await current(page), 3);
  await page.keyboard.press('PageDown');
  assert.equal(await current(page), 4);
  await page.keyboard.press('Shift+Space');
  assert.equal(await current(page), 3);
  await page.keyboard.press('PageUp');
  assert.equal(await current(page), 2);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await current(page), 1);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await current(page), 1, 'no wrap at the start');
  await page.keyboard.press('End');
  assert.equal(await current(page), 5);
  assert.equal(await aligned(page, 5), true);
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 5, 'no wrap at the end');
  await page.keyboard.press('Home');
  assert.equal(await current(page), 1);
  assert.equal(await aligned(page, 1), true);
  assert.deepEqual(problems, []);
  await context.close();
});

test('keys: ArrowUp/ArrowDown and modified keys are not taken', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Alt+ArrowRight');
  await page.keyboard.press('Meta+o');
  assert.equal(await current(page), 1);
  assert.equal(await page.locator('[data-outline]').evaluate((d) => d.open), false);
  await context.close();
});

test('keys on a button or checkbox keep Space for the control, arrows still navigate', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildSpec({
    title: 'Deck', mode: 'slides',
    sections: [topic(1), { type: 'checklist', title: 'Do it', key: 'k', groups: [{ title: 'G', items: [{ text: 'one' }, { text: 'two' }] }] }],
  });
  const { page, context } = await openPage(built.url);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  await page.locator('#slide-3 input').first().focus();
  await page.keyboard.press('Space');
  assert.equal(await current(page), 3, 'Space ticked the box instead of moving on');
  assert.equal(await page.locator('#slide-3 input').first().isChecked(), true);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await current(page), 2);
  await context.close();
});

// ---- deep link and resume ------------------------------------------------------------------

test('deep link: #slide-N opens that slide; out of range clamps; junk is ignored', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = deck5();
  for (const [suffix, want] of [['#slide-3', 3], ['#slide-1', 1], ['#slide-99', 5], ['#slide-0', 1], ['#slide-abc', 1], ['', 1]]) {
    const { page, problems, context } = await openPage(url + suffix);
    assert.equal(await current(page), want, suffix);
    assert.equal(await aligned(page, want), true, `${suffix} is scrolled into view`);
    assert.deepEqual(problems, []);
    await context.close();
  }
});

test('deep link: a hash change after load moves the deck, and Back follows the history', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  await page.evaluate(() => { location.hash = '#slide-4'; });
  await settled(page, 4);
  assert.equal(await aligned(page, 4), true);
  await page.evaluate(() => { location.hash = '#slide-2'; });
  await settled(page, 2);
  await page.goBack();
  await settled(page, 4);
  assert.equal(await aligned(page, 4), true);
  await context.close();
});

test('resume: the last slide is stored under pa-slides:<slug> and reopened; a deep link beats it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = deck5();
  const first = await openPage(url);
  await first.page.keyboard.press('ArrowRight');
  await first.page.keyboard.press('ArrowRight');
  assert.equal(await stored(first.page), '3');
  await first.page.keyboard.press('ArrowLeft');
  assert.equal(await stored(first.page), '2');
  await first.context.close();

  const seeded = await openPage(url, { seed: { [SLUG_KEY]: '4' } });
  assert.equal(await current(seeded.page), 4);
  assert.equal(await aligned(seeded.page, 4), true);
  await seeded.context.close();

  const linked = await openPage(`${url}#slide-2`, { seed: { [SLUG_KEY]: '4' } });
  assert.equal(await current(linked.page), 2, 'the deep link wins over the saved position');
  await linked.context.close();

  const stale = await openPage(url, { seed: { [SLUG_KEY]: '40' } });
  assert.equal(await current(stale.page), 5, 'a position past the end clamps to the last slide');
  await stale.context.close();

  const junk = await openPage(url, { seed: { [SLUG_KEY]: 'not a number' } });
  assert.equal(await current(junk.page), 1);
  assert.deepEqual(junk.problems, []);
  await junk.context.close();
});

test('resume: blocked storage is tolerated and navigation still works', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(deck5().url, { blockStorage: true });
  assert.equal(await current(page), 1);
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 2);
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('[data-theme-toggle]').textContent(), 'Theme: Light');
  assert.deepEqual(problems, []);
  await context.close();
});

// ---- outline ---------------------------------------------------------------------------------

test('outline: O opens a labelled dialog with every title, Esc closes it, O toggles', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(deck5().url);
  const dialog = page.locator('[data-outline]');
  assert.equal(await dialog.evaluate((d) => d.open), false);
  await page.keyboard.press('o');
  assert.equal(await dialog.evaluate((d) => d.open), true);
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'outline-title');
  assert.deepEqual(await dialog.locator('a').allTextContents().then((xs) => xs.map((s) => s.replace(/\s+/g, ' ').trim())), ['Deck', 'Topic 1', 'Topic 2', 'Topic 3', 'Topic 4']);
  assert.equal(await dialog.locator('a[aria-current]').getAttribute('href'), '#slide-1');
  await page.keyboard.press('Escape');
  assert.equal(await dialog.evaluate((d) => d.open), false);
  await page.keyboard.press('O');
  assert.equal(await dialog.evaluate((d) => d.open), true);
  await page.keyboard.press('o');
  assert.equal(await dialog.evaluate((d) => d.open), false);
  assert.equal(await current(page), 1, 'arrow keys do nothing to the deck while the outline is open');
  assert.deepEqual(problems, []);
  await context.close();
});

test('outline: keys do not move the deck while it is open; clicking a title jumps and closes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  await page.keyboard.press('o');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('End');
  assert.equal(await current(page), 1);
  await page.locator('[data-outline] a', { hasText: 'Topic 3' }).click();
  await settled(page, 4);
  assert.equal(await page.locator('[data-outline]').evaluate((d) => d.open), false);
  assert.equal(await hash(page), '#slide-4');
  assert.equal(await aligned(page, 4), true);
  await page.keyboard.press('o');
  assert.equal(await page.locator('[data-outline] a[aria-current]').getAttribute('href'), '#slide-4');
  await context.close();
});

test('outline: focus moves in, stays in while Tab cycles, and returns to the opener on close', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  const opener = page.locator('[data-outline-open]');
  await opener.focus();
  await opener.press('Enter');
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[data-outline]'));
  assert.equal(await inside(), true, 'focus moved into the dialog');
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await inside(), true, `Tab ${i + 1} stayed in the dialog`);
  }
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.equal(await inside(), true, `Shift+Tab ${i + 1} stayed in the dialog`);
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-outline-open')), true, 'focus came back to the Outline button');
  await context.close();
});

test('outline: the close button and a click on the backdrop both close it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  const dialog = page.locator('[data-outline]');
  await page.locator('[data-outline-open]').click();
  await page.locator('[data-outline-close]').click();
  assert.equal(await dialog.evaluate((d) => d.open), false);
  await page.locator('[data-outline-open]').click();
  await page.mouse.click(4, 4);
  assert.equal(await dialog.evaluate((d) => d.open), false);
  await context.close();
});

// ---- chrome: progress, counter, announcements, landmarks ------------------------------------------

test('progress bar and counter follow the slide; the current slide is announced politely', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  const state = () => page.evaluate(() => {
    const bar = document.querySelector('[role=progressbar]');
    return {
      count: document.querySelector('.deck-count').textContent.replace(/\s+/g, ' ').trim(),
      now: bar.getAttribute('aria-valuenow'), max: bar.getAttribute('aria-valuemax'), text: bar.getAttribute('aria-valuetext'),
      width: document.querySelector('[data-progress]').style.width,
      live: document.querySelector('[role=status]').textContent,
    };
  });
  assert.deepEqual(await state(), { count: '1 / 5', now: '1', max: '5', text: 'Slide 1 of 5', width: '20%', live: '' });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await state(), { count: '3 / 5', now: '3', max: '5', text: 'Slide 3 of 5', width: '60%', live: 'Slide 3 of 5: Topic 2' });
  assert.equal(await page.locator('[role=status]').count(), 1, 'one live region only');
  assert.equal(await page.locator('[role=status]').getAttribute('aria-live'), null);
  await context.close();
});

test('every slide is a labelled landmark; only the current slide is reachable', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  const labels = await page.evaluate(() => [...document.querySelectorAll('section.slide')].map((s) => s.getAttribute('aria-label')));
  assert.deepEqual(labels, ['Slide 1 of 5: Deck', 'Slide 2 of 5: Topic 1', 'Slide 3 of 5: Topic 2', 'Slide 4 of 5: Topic 3', 'Slide 5 of 5: Topic 4']);
  const inert = () => page.evaluate(() => [...document.querySelectorAll('section.slide')].map((s) => s.inert));
  assert.deepEqual(await inert(), [false, true, true, true, true]);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await inert(), [true, false, true, true, true]);
  await context.close();
});

test('the theme toggle works in slides mode and the deck takes the dark theme', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url, { colorScheme: 'dark' });
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('[data-theme-toggle]').textContent(), 'Theme: Light');
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), bg);
  await context.close();
});

// ---- touch / wheel and layout --------------------------------------------------------------------

test('scrolling the deck (wheel or touch) updates the current slide', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, 900);
  await settled(page, 2);
  assert.equal(await hash(page), '#slide-2');
  assert.equal(await stored(page), '2');
  await context.close();
});

test('layout: slides are the viewport tall, snap, and a short slide is centred', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url, { height: 800 });
  const geometry = await page.evaluate(() => {
    const deck = document.querySelector('[data-deck]');
    const slide = document.getElementById('slide-2');
    const inner = slide.querySelector('.slide-inner').getBoundingClientRect();
    return {
      snap: getComputedStyle(deck).scrollSnapType,
      height: slide.getBoundingClientRect().height,
      view: window.innerHeight,
      slack: [inner.top - slide.getBoundingClientRect().top, slide.getBoundingClientRect().bottom - inner.bottom],
      bodyScroll: document.documentElement.scrollHeight <= window.innerHeight,
    };
  });
  assert.match(geometry.snap, /y mandatory/);
  assert.equal(geometry.height, geometry.view);
  assert.ok(Math.abs(geometry.slack[0] - geometry.slack[1]) < 90, `centred: ${geometry.slack}`);
  assert.equal(geometry.bodyScroll, true, 'the page itself does not scroll; the deck does');
  await context.close();
});

// ---- Review Focus 3: a slide taller than the viewport -----------------------------------------------

const wideRows = Array.from({ length: 8 }, (_, i) => [`row ${i + 1}`, 'alpha value', 'beta value', 'gamma value', 'delta value', 'epsilon value']);
const tallSpec = () => ({
  title: 'Deck', mode: 'slides',
  sections: [topic(1), { type: 'table', title: 'A long table', columns: ['Name', 'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'], rows: wideRows }, topic(3)],
});
const tallPage = () => openPage(buildSpec(tallSpec()).url, { width: 390, height: 460 });

test('tall slide at 390 px: it scrolls inside itself, the page does not, and the top stays reachable', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await tallPage();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  const m = await page.evaluate(() => {
    const slide = document.getElementById('slide-3');
    const first = slide.querySelector('.slide-title').getBoundingClientRect().top - slide.getBoundingClientRect().top;
    return { tall: slide.scrollHeight > slide.clientHeight, overflowY: getComputedStyle(slide).overflowY, top: slide.scrollTop, first };
  });
  assert.equal(m.tall, true, 'precondition: the slide is taller than the viewport');
  assert.equal(m.overflowY, 'auto');
  assert.equal(m.top, 0);
  assert.ok(m.first >= 0, 'the heading is not clipped above the slide');
  await page.evaluate(() => document.getElementById('slide-3').scrollTo(0, 99999));
  const bottom = await page.evaluate(() => {
    const slide = document.getElementById('slide-3');
    const last = slide.querySelector('.slide-inner').getBoundingClientRect().bottom;
    const bar = document.querySelector('.deck-bar').getBoundingClientRect().top;
    return { last, bar, scrolled: slide.scrollTop };
  });
  assert.ok(bottom.scrolled > 0);
  assert.ok(bottom.last <= bottom.bar + 1, `the end of the content clears the controls: ${bottom.last} vs ${bottom.bar}`);
  assert.deepEqual(problems, []);
  await context.close();
});

test('tall slide: arrows navigate when focus is on the page, and Space scrolls the slide before it advances', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await tallPage();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await current(page), 2, 'focus is on the page, so the arrow moved to the previous slide');
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  const top = () => page.evaluate(() => document.getElementById('slide-3').scrollTop);
  await page.keyboard.press('Space');
  assert.equal(await current(page), 3, 'Space scrolled within the slide');
  assert.ok(await top() > 0);
  await context.close();
});

test('tall slide: Space at the bottom advances, Shift+Space on a short slide goes back', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await tallPage();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  assert.ok(await page.evaluate(() => { const e = document.getElementById('slide-3'); return e.scrollHeight - e.clientHeight - e.scrollTop; }) > 0, 'precondition: slide 3 overflows');
  let presses = 0;
  while ((await current(page)) === 3 && presses < 10) { await page.keyboard.press('Space'); presses++; }
  assert.equal(await current(page), 4, 'it reached the next slide');
  assert.ok(presses >= 2, `it scrolled the slide first (${presses} presses)`);
  await page.keyboard.press('Shift+Space');
  assert.equal(await current(page), 3, 'slide 4 is short, so Shift+Space went straight back');
  await context.close();
});

test('tall slide: focus inside a sideways-scrolling table keeps the arrows for the table', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await tallPage();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  const wrap = page.locator('#slide-3 .tablewrap');
  assert.equal(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth), true, 'precondition: six columns overflow at 390 px');
  await wrap.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3, 'the arrow went to the table, not the deck');
  await page.waitForFunction(() => document.querySelector('#slide-3 .tablewrap').scrollLeft > 0);
  await page.keyboard.press('ArrowLeft');
  assert.equal(await current(page), 3);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 4, 'focus left the table, so arrows navigate again');
  await context.close();
});

test('tall slide: focus inside a sideways-scrolling code block keeps the arrows for the code', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const long = `const value = ${'"a very long string that does not wrap" + '.repeat(8)}"end";`;
  const built = buildSpec({ title: 'Deck', mode: 'slides', sections: [topic(1), { type: 'code', title: 'Long line', language: 'js', code: long }, topic(3)] });
  const { page, context } = await openPage(built.url, { width: 390, height: 700 });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const pre = page.locator('#slide-3 pre');
  assert.equal(await pre.evaluate((el) => el.scrollWidth > el.clientWidth), true, 'precondition: the code overflows sideways');
  await pre.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await current(page), 3);
  await page.waitForFunction(() => document.querySelector('#slide-3 pre').scrollLeft > 0);
  await context.close();
});

// ---- reduced motion and print -----------------------------------------------------------------------

test('reduced motion: no transition on the progress bar; with motion allowed it eases', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { url } = deck5();
  const calm = await openPage(url, { reducedMotion: 'reduce' });
  assert.equal(await calm.page.evaluate(() => getComputedStyle(document.querySelector('[data-progress]')).transitionDuration), '0s');
  assert.equal(await calm.page.evaluate(() => getComputedStyle(document.querySelector('[data-deck]')).scrollBehavior), 'auto');
  await calm.context.close();
  const lively = await openPage(url, { reducedMotion: 'no-preference' });
  assert.notEqual(await lively.page.evaluate(() => getComputedStyle(document.querySelector('[data-progress]')).transitionDuration), '0s');
  await lively.page.keyboard.press('ArrowRight');
  await settled(lively.page, 2);
  await lively.page.waitForFunction(() => {
    const deck = document.querySelector('[data-deck]');
    return Math.abs(deck.scrollTop - document.getElementById('slide-2').offsetTop) < 2;
  });
  await lively.context.close();
});

test('print: one slide per page, no chrome, nothing clipped', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(deck5().url);
  await page.emulateMedia({ media: 'print' });
  const css = await page.evaluate(() => {
    const slide = getComputedStyle(document.getElementById('slide-2'));
    return {
      bar: getComputedStyle(document.querySelector('.deck-bar')).display,
      toggle: getComputedStyle(document.querySelector('[data-theme-toggle]')).display,
      deckOverflow: getComputedStyle(document.querySelector('[data-deck]')).overflowY,
      overflow: slide.overflowY, height: slide.height, breakBefore: slide.breakBefore,
    };
  });
  assert.equal(css.bar, 'none');
  assert.equal(css.toggle, 'none');
  assert.equal(css.deckOverflow, 'visible');
  assert.equal(css.overflow, 'visible');
  assert.equal(css.breakBefore, 'page');
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g) ?? []).length;
  assert.equal(pages, 5, 'five slides, five pages');
  await context.close();
});

// ---- screenshots for a human to look at -------------------------------------------------------------

const EXAMPLE = () => buildFile(exampleFile('slides'), { name: 'slides' });

for (const width of [1280, 390]) {
  test(`the slides example renders at ${width} px with no console problems or sideways scroll`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { url, html } = EXAMPLE();
    assert.ok(html.includes('data-deck'));
    for (const colorScheme of ['light', 'dark']) {
      const { page, problems, context } = await openPage(url, { width, height: width === 390 ? 844 : 800, colorScheme });
      const total = await page.evaluate(() => document.querySelectorAll('section.slide').length);
      const wide = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        return [...document.querySelectorAll('.deck *')].filter((el) => !el.closest('.tablewrap, pre, .sr-only, svg') && el.getBoundingClientRect().right > limit + 1).map((el) => `${el.tagName}.${el.className}`);
      });
      assert.deepEqual(wide, []);
      const out = process.env.SLIDE_SHOTS ?? scratchDir();
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, `slide-1-${width}-${colorScheme}.png`) });
      await page.keyboard.press('ArrowRight');
      await page.screenshot({ path: path.join(out, `slide-2-${width}-${colorScheme}.png`) });
      for (let i = 2; i < total; i++) {
        await page.keyboard.press('ArrowRight');
        const clipped = await page.evaluate(() => {
          const slide = document.getElementById(`slide-${Number(document.querySelector('[data-deck]').dataset.current)}`);
          const bar = document.querySelector('.deck-bar').getBoundingClientRect().top;
          return slide.scrollHeight > slide.clientHeight ? 'scrolls' : Math.round(slide.querySelector('.slide-inner').getBoundingClientRect().bottom) <= bar + 1 ? 'fits' : 'under the controls';
        });
        assert.notEqual(clipped, 'under the controls', `slide ${i + 1} is covered by the controls`);
        if (i === 4) await page.screenshot({ path: path.join(out, `slide-5-${width}-${colorScheme}.png`) });
      }
      await page.keyboard.press('Home');
      await page.keyboard.press('o');
      await page.screenshot({ path: path.join(out, `outline-${width}-${colorScheme}.png`) });
      assert.deepEqual(problems, []);
      await context.close();
    }
  });
}
