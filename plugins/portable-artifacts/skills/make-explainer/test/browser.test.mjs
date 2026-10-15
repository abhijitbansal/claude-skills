import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, haveBrowser, buildFile, buildSpec, exampleFile, scratchDir, EXAMPLES } from './helpers/browser.mjs';

let browser;
after(() => browser?.close());

const pages = {};
const built = (name) => (pages[name] ??= buildFile(exampleFile(name), { name }));

// Opens a page; collects every console error/warning and page error.
async function open(url, { width = 1280, height = 900, colorScheme = 'light', reducedMotion = 'no-preference', blockStorage = false, hash = '', permissions = [] } = {}) {
  browser ??= await launchBrowser();
  const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, permissions });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  if (blockStorage) {
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, { get() { throw new DOMException('denied', 'SecurityError'); } });
      }
    });
  }
  await page.goto(url + hash);
  await page.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  return { page, problems, context };
}

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const current = (page) => page.evaluate(() => [...document.querySelectorAll('.toc a[aria-current]')].map((a) => a.getAttribute('href')));

// ---- every example renders ---------------------------------------------------------------

for (const name of EXAMPLES) {
  for (const width of [1280, 390]) {
    test(`${name} renders at ${width} px: no console problems, no horizontal overflow, nothing wider than the page`, async (t) => {
      if (await skipUnlessBrowser(t)) return;
      const { page, problems, context } = await open(built(name).url, { width, height: width === 390 ? 844 : 900, reducedMotion: 'reduce' });
      const fit = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll('body *')]
          // .dg-slot scrolls sideways inside itself by design (diagram.css), so what it holds may pass the edge; the slot itself may not.
          .filter((el) => !el.closest('.tablewrap, pre, .sr-only, .skip, svg, .dg-slot *') && el.getBoundingClientRect().right > limit + 1)
          .map((el) => `${el.tagName}.${el.className}`);
        return { scroll: document.documentElement.scrollWidth, limit, wide };
      });
      assert.ok(fit.scroll <= fit.limit, `page scrolls sideways: ${fit.scroll} > ${fit.limit}`);
      assert.deepEqual(fit.wide, []);
      assert.deepEqual(problems, []);
      await context.close();
    });
  }

  for (const width of [1280, 390]) {
    test(`${name}: screenshots at ${width} px in light and dark`, async (t) => {
      if (await skipUnlessBrowser(t)) return;
      for (const colorScheme of ['light', 'dark']) {
        const { page, problems, context } = await open(built(name).url, { width, height: width === 390 ? 844 : 900, colorScheme, reducedMotion: 'reduce' });
        await page.screenshot({ path: path.join(scratchDir(), `${name}-${width}-${colorScheme}.png`) });
        await page.screenshot({ path: path.join(scratchDir(), `${name}-${width}-${colorScheme}-full.png`), fullPage: true });
        assert.deepEqual(problems, []);
        await context.close();
      }
    });
  }
}

test('the first viewport at 1280 x 900 holds the hero, the whole verdict card and the numbers', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const name of ['concept', 'recap']) {
    const { page, context } = await open(built(name).url, { reducedMotion: 'reduce' });
    const verdict = await page.locator('.hero .hero-tldr .tldr').boundingBox();
    assert.ok(verdict.y + verdict.height <= 900, `${name}: verdict ends at ${verdict.y + verdict.height}`);
    const kpis = await page.locator('.sec-kpis .kpis').boundingBox();
    assert.ok(kpis.y + kpis.height <= 900, `${name}: numbers end at ${kpis.y + kpis.height}`);
    await context.close();
  }
});

// ---- contents ---------------------------------------------------------------------------

test('contents: the active entry follows the scroll and the last one is reachable at the page end', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('.toc a')].map((a) => a.getAttribute('href')));
  assert.ok(hrefs.length >= 4);
  assert.deepEqual(await current(page), [hrefs[0]]);
  const middle = hrefs[5];
  await page.evaluate((id) => document.getElementById(id).scrollIntoView(), middle.slice(1));
  await page.waitForFunction((h) => document.querySelector('.toc a[aria-current]')?.getAttribute('href') === h, middle);
  assert.deepEqual(await current(page), [middle]);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForFunction((h) => document.querySelector('.toc a[aria-current]')?.getAttribute('href') === h, hrefs.at(-1));
  assert.deepEqual(await current(page), [hrefs.at(-1)]);
  await context.close();
});

test('contents: sticky on desktop, collapsed on mobile and closed again after a choice', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const wide = await open(built('concept').url);
  assert.equal(await wide.page.evaluate(() => getComputedStyle(document.querySelector('.toc')).position), 'sticky');
  assert.equal(await wide.page.evaluate(() => document.querySelector('.toc details').open), true);
  await wide.context.close();

  const narrow = await open(built('concept').url, { width: 390, height: 844 });
  const { page } = narrow;
  assert.equal(await page.evaluate(() => document.querySelector('.toc details').open), false);
  await page.click('.toc summary');
  assert.equal(await page.locator('.toc a').first().isVisible(), true);
  await page.locator('.toc a').nth(3).click();
  assert.equal(await page.evaluate(() => document.querySelector('.toc details').open), false);
  assert.equal(await page.evaluate(() => location.hash), await page.evaluate(() => document.querySelectorAll('.toc a')[3].getAttribute('href')));
  await narrow.context.close();
});

test('headings carry an anchor link to their section', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  const bad = await page.evaluate(() => [...document.querySelectorAll('.sec-title')].filter((h) => {
    const a = h.querySelector('a.anchor');
    return !a || a.getAttribute('href') !== `#${h.closest('section').id}` || !a.getAttribute('aria-label');
  }).length);
  assert.equal(bad, 0);
  await context.close();
});

// ---- copy ---------------------------------------------------------------------------------

test('copy: the code button puts the code on the clipboard and says so', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('concept').url, { permissions: ['clipboard-read', 'clipboard-write'] });
  const button = page.locator('[data-copy]').first();
  await button.click();
  await page.waitForFunction(() => document.querySelector('[data-copy]').textContent === 'Copied');
  const expected = await page.evaluate(() => document.querySelector('figure.code pre code').textContent);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
  assert.match(await page.locator('[role=status]').textContent(), /copied/i);
  await page.waitForFunction(() => document.querySelector('[data-copy]').textContent === 'Copy', null, { timeout: 5000 });
  assert.deepEqual(problems, []);
  await context.close();
});

test('copy: without a working clipboard the text is selected instead', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true });
    document.execCommand = () => false;
  });
  await page.locator('[data-copy]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-copy]').textContent === 'Selected');
  const selected = await page.evaluate(() => window.getSelection().toString());
  assert.equal(selected, await page.evaluate(() => document.querySelector('figure.code pre code').textContent));
  await context.close();
});

// ---- theme ----------------------------------------------------------------------------------

test('theme: the toggle cycles Auto, Light, Dark, is remembered, and applies before first paint', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  const toggle = page.locator('[data-theme-toggle]');
  assert.equal(await toggle.getAttribute('data-mode'), 'auto');
  await toggle.click();
  assert.equal(await toggle.getAttribute('data-mode'), 'light');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light');
  await toggle.click();
  assert.equal(await toggle.getAttribute('data-mode'), 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.reload();
  await page.waitForFunction(() => window.paReady === true);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  assert.equal(await page.locator('[data-theme-toggle]').getAttribute('data-mode'), 'dark');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), bg);
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? null), null);
  await context.close();
});

test('theme: blocked storage is tolerated', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('concept').url, { blockStorage: true });
  await page.locator('[data-theme-toggle]').click();
  assert.equal(await page.locator('[data-theme-toggle]').getAttribute('data-mode'), 'light');
  assert.deepEqual(problems, []);
  await context.close();
});

test('theme: dark and light give different page colours, text keeps contrast with the page', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const ratio = async (colorScheme) => {
    const { page, context } = await open(built('concept').url, { colorScheme });
    const r = await page.evaluate(() => {
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map((v) => { const c = Number(v) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const pick = (sel) => getComputedStyle(document.querySelector(sel));
      const bg = lum(pick('body').backgroundColor);
      const out = {};
      for (const sel of ['.prose p', '.subtitle', '.meta dd', '.toc a']) {
        const fg = lum(pick(sel).color);
        out[sel] = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      }
      return out;
    });
    await context.close();
    return r;
  };
  for (const scheme of ['light', 'dark']) {
    for (const [sel, value] of Object.entries(await ratio(scheme))) assert.ok(value >= 4.5, `${scheme} ${sel} contrast ${value.toFixed(2)}`);
  }
});

// ---- motion and print ----------------------------------------------------------------------------

test('rise-in: sections fade in once and reduced motion turns it off', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const full = await open(built('concept').url);
  assert.equal(await full.page.evaluate(() => document.documentElement.classList.contains('rise-ready')), true);
  await full.page.waitForFunction(() => document.querySelector('.sections > .sec').classList.contains('in'));
  const before = await full.page.evaluate(() => document.querySelectorAll('.sec.in').length);
  assert.ok(before < (await full.page.evaluate(() => document.querySelectorAll('.sec').length)), 'sections below the fold wait for their turn');
  await full.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await full.page.waitForFunction(() => [...document.querySelectorAll('.sec')].slice(-1)[0].classList.contains('in'));
  assert.equal(await full.page.evaluate(() => document.querySelectorAll('.sec:not(.in)').length), 0, 'reaching the end marks every section above as seen');
  await full.page.evaluate(() => window.scrollTo(0, 0));
  await full.page.waitForTimeout(200);
  assert.equal(await full.page.evaluate(() => document.querySelectorAll('.sec:not(.in)').length), 0, 'a section animates once; it does not reset');
  await full.context.close();

  const reduced = await open(built('concept').url, { reducedMotion: 'reduce' });
  assert.equal(await reduced.page.evaluate(() => document.documentElement.classList.contains('rise-ready')), false);
  assert.equal(await reduced.page.evaluate(() => getComputedStyle(document.querySelector('.sec:last-child')).opacity), '1');
  await reduced.context.close();

});

test('rise-in: jumping to a late section marks the sections above it as seen, so they do not animate again', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  const target = await page.evaluate(() => document.querySelectorAll('.sec')[10].id);
  await page.evaluate((id) => document.getElementById(id).scrollIntoView(), target);
  await page.waitForFunction((id) => document.getElementById(id).classList.contains('in'), target);
  // Sections far above the viewport were never on screen, yet must already be shown.
  await page.waitForFunction(() => document.querySelectorAll('.sec')[2].classList.contains('in'));
  const above = await page.evaluate((id) => {
    const sections = [...document.querySelectorAll('.sec')];
    return sections.slice(0, sections.findIndex((s) => s.id === id)).filter((s) => !s.classList.contains('in')).length;
  }, target);
  assert.equal(above, 0);
  await context.close();
});

test('contents: a short final section is still reachable at the end of the page', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const long = Array.from({ length: 6 }, (_, i) => `Paragraph ${i} of filler that explains the point at some length so the section is tall.`).join('\n\n');
  const sections = [1, 2, 3, 4].map((n) => ({ type: 'text', title: `Claim ${n}`, text: long }));
  sections.push({ type: 'text', title: 'Last claim', text: 'Short.' });
  const { page, context } = await open(buildSpec({ title: 'T', sections }).url, { reducedMotion: 'reduce' });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const geometry = await page.evaluate(() => ({ top: document.querySelector('#last-claim').getBoundingClientRect().top, line: innerHeight * 0.3 }));
  assert.ok(geometry.top > geometry.line, 'the last section never reaches the reading line, so only the end-of-page rule can select it');
  await page.waitForFunction(() => document.querySelector('.toc a[aria-current]')?.getAttribute('href') === '#last-claim');
  await context.close();
});

// The runtime is the last inline script; a copy of the page without it shows what the head alone does.
function withoutRuntime(name) {
  const html = fs.readFileSync(built(name).file, 'utf8');
  const at = html.lastIndexOf('<script>');
  assert.ok(html.slice(at).includes('window.paReady = true'), 'the last script is the runtime');
  const file = path.join(scratchDir(), `${name}-no-runtime.html`);
  fs.writeFileSync(file, html.slice(0, at) + html.slice(html.indexOf('</script>', at) + '</script>'.length));
  return pathToFileURL(file).href;
}

async function openRaw(url, { reducedMotion }) {
  browser ??= await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion });
  const page = await context.newPage();
  await page.goto(url);
  return { page, context };
}

const opacities = (page) => page.evaluate(() => [...document.querySelectorAll('.sec')].map((s) => getComputedStyle(s).opacity));

test('rise-in is armed before first paint: with motion allowed every section starts hidden, even with no runtime', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openRaw(withoutRuntime('concept'), { reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rise-ready')), true);
  assert.ok((await opacities(page)).every((o) => o === '0'), 'nothing paints visible before the runtime reveals it');
  // ...and a runtime that never starts must not leave the page blank.
  await page.waitForFunction(() => !document.documentElement.classList.contains('rise-ready'), null, { timeout: 5000 });
  assert.ok((await opacities(page)).every((o) => o === '1'));
  await context.close();
});

test('rise-in is never armed under reduced motion', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openRaw(withoutRuntime('concept'), { reducedMotion: 'reduce' });
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rise-ready')), false);
  assert.ok((await opacities(page)).every((o) => o === '1'));
  await context.close();
});

test('copy: a stray copy button outside a code block does nothing and raises no error', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await open(built('concept').url);
  await page.evaluate(() => {
    const loose = document.createElement('button');
    loose.id = 'loose';
    loose.setAttribute('data-copy', '');
    loose.textContent = 'Copy';
    document.querySelector('main').appendChild(loose);
    const fig = document.createElement('figure');
    fig.innerHTML = '<button id="empty" data-copy>Copy</button><p>no code here</p>';
    document.querySelector('main').appendChild(fig);
  });
  await page.click('#loose');
  await page.click('#empty');
  assert.equal(await page.locator('#loose').textContent(), 'Copy');
  assert.equal(await page.locator('#empty').textContent(), 'Copy');
  assert.deepEqual(problems, []);
  await context.close();
});

test('print: controls and contents are hidden and every section is visible', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  await page.emulateMedia({ media: 'print' });
  const state = await page.evaluate(() => ({
    toc: getComputedStyle(document.querySelector('.toc')).display,
    toggle: getComputedStyle(document.querySelector('.theme-toggle')).display,
    copy: getComputedStyle(document.querySelector('.copy')).display,
    opacity: [...document.querySelectorAll('.sec')].map((s) => getComputedStyle(s).opacity),
  }));
  assert.equal(state.toc, 'none');
  assert.equal(state.toggle, 'none');
  assert.equal(state.copy, 'none');
  assert.ok(state.opacity.every((o) => o === '1'));
  await context.close();
});

test('every status is a shape and a word, not a colour: chips contain an svg and text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await open(built('concept').url);
  const bad = await page.evaluate(() => [...document.querySelectorAll('.chip')].filter((c) => !c.querySelector('svg') || c.textContent.trim() === '').length);
  assert.equal(bad, 0);
  assert.ok(await page.evaluate(() => document.querySelectorAll('.chip').length) > 5);
  await context.close();
});

test('a page built from a hostile spec runs no script and shows the text', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const hostile = '<img src=x onerror="window.__pwned=1"> <script>window.__pwned=1</script>';
  const built2 = buildSpec({
    title: 'Hostile',
    sections: [
      { type: 'text', title: hostile.slice(0, 40), text: `${hostile}\n\n[x](javascript:window.__pwned=1)` },
      { type: 'callout', tone: 'warn', title: hostile.slice(0, 60), text: hostile },
      { type: 'table', columns: ['a'], rows: [[hostile]] },
    ],
  });
  const { page, context } = await open(built2.url);
  assert.equal(await page.evaluate(() => window.__pwned ?? null), null);
  assert.equal(await page.evaluate(() => document.querySelectorAll('main img, main script').length), 0);
  assert.match(await page.locator('main').textContent(), /<img src=x onerror="window\.__pwned=1">/);
  assert.equal(await page.evaluate(() => document.querySelectorAll('main a[href^="javascript"]').length), 0);
  await context.close();
});
