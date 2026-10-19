// Full screen: F or the button ask the browser for full screen on the page's
// root; where that is refused or absent the page switches to the window-filling
// pa-fill layer. Real full screen cannot be seen in a headless run, so the API
// is stubbed: once granting (and reporting through fullscreenchange), once
// refusing. A sandbox="allow-scripts" iframe refuses by itself.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildPage, example, launchBrowser } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser, settle } from './helpers/page.mjs';

let own; // the browser the iframe test launches itself (openPage waits for a top-level paReady, which a host page never sets)
after(async () => { await own?.close(); await closeBrowser(); });

const pages = {};
const built = (name) => (pages[name] ??= buildPage(example(name), { name: `fs-${name}` }));

const fillOn = (page) => page.evaluate(() => document.documentElement.classList.contains('pa-fill'));
const button = (page) => page.evaluate(() => { const b = document.querySelector('[data-pa-full]'); return { text: b.textContent, pressed: b.getAttribute('aria-pressed') }; });
const NAME = 'Full screen'; // the accessible name never changes, aria-pressed carries the state
const zoom = (page) => page.evaluate(() => Number(document.getElementById('pa-stage').getAttribute('data-zoom')));
const shown = (page, sel) => page.evaluate((s) => getComputedStyle(document.querySelector(s)).display !== 'none', sel);
const bodyHidden = (page) => page.evaluate(() => document.querySelector('[data-pa-panel-body]').hidden);

// A browser that grants: the request resolves and fullscreenchange reports the element.
const GRANTS = () => {
  let current = null;
  Object.defineProperty(document, 'fullscreenElement', { get: () => current, configurable: true });
  Object.defineProperty(document, 'fullscreenEnabled', { get: () => true, configurable: true });
  Element.prototype.requestFullscreen = function () { current = this; return Promise.resolve().then(() => document.dispatchEvent(new Event('fullscreenchange'))); };
  document.exitFullscreen = () => { current = null; return Promise.resolve().then(() => document.dispatchEvent(new Event('fullscreenchange'))); };
};
// A browser that refuses: the request rejects (what a page gets without a permission).
const REFUSES = () => {
  Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')); };
};

test('F enters real full screen on the page root when the browser grants it, the button follows, Escape leaves; 0 fits, F no longer does', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: GRANTS });
  assert.deepEqual(await button(page), { text: NAME, pressed: 'false' });
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'true');
  assert.equal(await page.evaluate(() => document.fullscreenElement === document.documentElement), true, 'the page root is the fullscreen element');
  assert.equal(await fillOn(page), false, 'no fallback when the browser granted');
  assert.deepEqual(await button(page), { text: NAME, pressed: 'true' });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'false');
  assert.equal(await page.evaluate(() => document.fullscreenElement), null);
  await page.click('[data-pa-full]');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'true');
  await page.click('[data-pa-full]');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'false');
  await page.keyboard.press('+');
  assert.ok(Math.abs((await zoom(page)) - 1.25) < 0.01);
  await page.keyboard.press('0');
  await settle(page);
  assert.ok(Math.abs((await zoom(page)) - 1) < 0.001, '0 fits');
  await page.keyboard.press('+');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.querySelector('[data-pa-full]').getAttribute('aria-pressed') === 'true');
  await settle(page);
  assert.ok(Math.abs((await zoom(page)) - 1.25) < 0.01, 'F is full screen now, not fit');
  await page.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('a refused request falls back to the pa-fill layer: the title and the export tools hide, the tabs and Find stay, Escape leaves', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: REFUSES });
  await page.click('[data-pa-full]');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  assert.deepEqual(await button(page), { text: NAME, pressed: 'true' });
  assert.equal(await shown(page, '.titles'), false, 'the title block goes');
  assert.equal(await shown(page, '[data-export="svg"]'), false, 'export goes');
  assert.equal(await shown(page, '[data-theme-toggle]'), false, 'the theme toggle goes');
  assert.equal(await shown(page, '[data-pa-mode="play"]'), true, 'the tabs stay');
  assert.equal(await shown(page, '[data-pa-find]'), true, 'Find stays');
  assert.equal(await shown(page, '[data-pa-full]'), true, 'and the way out stays');
  assert.equal(await shown(page, '[data-act="fit"]'), true, 'Fit stays (touch users in an iframe have no other)');
  assert.equal(await shown(page, '[data-act="zoom-in"]'), false, 'zoom buttons go');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[role=group]')].filter((g) => getComputedStyle(g).display !== 'none' && ![...g.children].some((c) => getComputedStyle(c).display !== 'none')).map((g) => g.getAttribute('aria-label'))), [], 'no visible group is empty');
  assert.equal(await page.getAttribute('[data-pa-full]', 'aria-keyshortcuts'), 'F');
  assert.equal(await page.getAttribute('[data-act="fit"]', 'aria-keyshortcuts'), '0');
  await page.keyboard.press('Escape');
  assert.equal(await fillOn(page), false);
  assert.equal(await shown(page, '.titles'), true);
  assert.deepEqual(await button(page), { text: NAME, pressed: 'false' });
  assert.deepEqual(problems, []);
  await context.close();
});

test('F in Play enters full screen and leaves the story playing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: REFUSES });
  await page.keyboard.press('p');
  await page.click('[data-pa-play]'); // the transport's Play starts the story
  const playing = async () => (await page.getAttribute('[data-pa-play]', 'aria-label')) === 'Pause';
  assert.equal(await playing(), true, 'the story plays');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  assert.equal(await playing(), true, 'F did not pause it');
  assert.deepEqual(problems, []);
  await context.close();
});

test('inside a sandbox="allow-scripts" iframe the browser refuses by itself and the fallback fires; F toggles it from the keyboard', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { html } = built('story');
  const host = `<!doctype html><title>host</title><iframe sandbox="allow-scripts" srcdoc="${html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="display:block;width:1000px;height:700px;border:0"></iframe>`;
  own ??= await launchBrowser();
  const context = await own.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.setContent(host);
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForFunction(() => window.paReady === true, null, { timeout: 15000 });
  assert.equal(await frame.evaluate(() => document.fullscreenEnabled), false, 'the sandbox grants no fullscreen permission');
  await frame.click('[data-pa-full]');
  await frame.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  assert.deepEqual(await frame.evaluate(() => { const b = document.querySelector('[data-pa-full]'); return { text: b.textContent, pressed: b.getAttribute('aria-pressed') }; }), { text: NAME, pressed: 'true' });
  await page.keyboard.press('Escape'); // focus sits on the button inside the frame
  await frame.waitForFunction(() => !document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('f');
  await frame.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('f');
  await frame.waitForFunction(() => !document.documentElement.classList.contains('pa-fill'));
  assert.deepEqual(problems, []);
  await context.close();
});

test('Escape closes the panel before it leaves the fallback, and leaves the fallback before it leaves Play', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(built('story').url, { init: REFUSES });
  await page.click('.pa-node[data-id="orders"]');
  assert.equal(await bodyHidden(page), false, 'the panel describes orders');
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('Escape');
  assert.equal(await bodyHidden(page), true, 'the panel closed first');
  assert.equal(await fillOn(page), true, 'the layer stayed');
  await page.keyboard.press('Escape');
  assert.equal(await fillOn(page), false, 'then the layer went');
  await page.keyboard.press('p');
  assert.equal(await page.isVisible('[data-pa-caption]'), true);
  await page.keyboard.press('f');
  await page.waitForFunction(() => document.documentElement.classList.contains('pa-fill'));
  await page.keyboard.press('Escape');
  assert.equal(await fillOn(page), false);
  assert.equal(await page.isVisible('[data-pa-caption]'), true, 'still in Play');
  await page.keyboard.press('Escape');
  assert.equal(await page.isVisible('[data-pa-caption]'), false, 'now Play ends');
  assert.deepEqual(problems, []);
  await context.close();
});
