import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser, scratchDir } from './helpers/browser.mjs';

after(closeSharedBrowser);

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FILES = ['demo.mp4', 'poster.png'].map((f) => path.join(FIXTURES, f));

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const topic = (n) => ({ type: 'text', title: `Topic ${n}`, text: `Body ${n}.` });
const clip = { type: 'motion', title: 'Walkthrough', video: 'demo.mp4', poster: 'poster.png', caption: 'The tour' };
// Title slide, topic 1, the clip, topic 2: the clip is slide 3 of 4.
const deck = () => buildSpec({ title: 'Deck', mode: 'slides', sections: [topic(1), clip, topic(2)] }, { files: FILES });
const page = () => buildSpec({ title: 'Doc', sections: [topic(1), clip, topic(2)] }, { files: FILES });

const current = (p) => p.evaluate(() => Number(document.querySelector('[data-deck]').dataset.current));
const settled = (p, n) => p.waitForFunction((want) => Number(document.querySelector('[data-deck]').dataset.current) === want, n);

// ---- a page ----------------------------------------------------------------------------------

test('the page loads the video and its poster from the assets folder under the page CSP, with no console problems', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = page();
  assert.ok(fs.existsSync(path.join(path.dirname(built.file), 'page.assets', 'walkthrough.mp4')));
  const { page: p, problems, context } = await openPage(built.url);
  const info = await p.evaluate(async () => {
    const v = document.querySelector('.mo video');
    if (v.readyState < 1) await new Promise((res) => { v.addEventListener('loadedmetadata', res, { once: true }); });
    return { duration: v.duration, width: v.videoWidth, controls: v.controls, preload: v.preload, autoplay: v.autoplay, paused: v.paused, poster: v.getAttribute('poster'), shown: v.getBoundingClientRect().width };
  });
  assert.equal(info.controls, true);
  assert.equal(info.preload, 'metadata');
  assert.equal(info.autoplay, false);
  assert.equal(info.paused, true);
  assert.equal(info.width, 160);
  assert.ok(info.duration > 0.5 && info.duration < 1.5, `duration ${info.duration}`);
  assert.match(info.poster, /^data:image\/png;base64,/);
  assert.ok(info.shown > 300, 'the video fills the column, not its 160px size');
  assert.deepEqual(problems, []);
  await context.close();
});

test('the video stays inside a 390px screen and keeps its shape in both colour schemes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = page();
  for (const colorScheme of ['light', 'dark']) {
    const { page: p, context } = await openPage(built.url, { width: 390, height: 800, colorScheme });
    const box = await p.evaluate(() => {
      const r = document.querySelector('.mo video').getBoundingClientRect();
      return { left: r.left, right: r.right, ratio: r.width / r.height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(box.overflow, false, 'no horizontal scroll');
    assert.ok(box.left >= 0 && box.right <= 390, JSON.stringify(box));
    assert.ok(Math.abs(box.ratio - 16 / 9) < 0.05, `ratio ${box.ratio}`);
    await p.screenshot({ path: path.join(scratchDir(), `motion-390-${colorScheme}.png`) });
    await context.close();
  }
});

// ---- a deck ----------------------------------------------------------------------------------

test('slides: with focus on the video, Space and the arrows stay with the player', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page: p, problems, context } = await openPage(deck().url);
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  assert.equal(await current(p), 3, 'the clip is slide 3');
  await p.locator('.slide-motion video').focus();
  await p.keyboard.press('Space');
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowLeft');
  await p.keyboard.press('PageDown');
  assert.equal(await current(p), 3, 'the keys went to the video, not the deck');
  assert.equal(await p.locator('.slide-motion video').evaluate((v) => v === document.activeElement), true);
  await p.keyboard.press('o');
  assert.equal(await p.locator('[data-outline]').evaluate((d) => d.open), true, 'O still opens the outline from the video');
  await p.keyboard.press('Escape');
  assert.deepEqual(problems, []);
  await context.close();
});

test('slides: Space toggles the video, and once focus is back on the slide the keys move the deck again', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page: p, context } = await openPage(deck().url);
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  const video = p.locator('.slide-motion video');
  await video.evaluate((v) => { v.muted = true; v.focus(); });
  await p.keyboard.press('Space');
  await p.waitForFunction(() => !document.querySelector('.slide-motion video').paused || document.querySelector('.slide-motion video').ended);
  await p.evaluate(() => document.querySelector('.slide-motion video').pause());
  await p.evaluate(() => document.querySelector('#slide-3').focus());
  await p.keyboard.press('ArrowRight');
  await settled(p, 4);
  await context.close();
});

test('slides: leaving the slide pauses a playing video, and a video that is not playing is left alone', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page: p, context } = await openPage(deck().url);
  await p.keyboard.press('ArrowRight');
  await p.keyboard.press('ArrowRight');
  const playing = await p.evaluate(async () => {
    const v = document.querySelector('.slide-motion video');
    v.muted = true;
    v.loop = true;
    await v.play();
    return !v.paused;
  });
  assert.equal(playing, true, 'the clip plays');
  await p.keyboard.press('ArrowRight');
  await settled(p, 4);
  assert.equal(await p.evaluate(() => document.querySelector('.slide-motion video').paused), true, 'it stopped when its slide was left');
  await p.keyboard.press('ArrowLeft');
  await settled(p, 3);
  assert.equal(await p.evaluate(() => document.querySelector('.slide-motion video').paused), true, 'it does not restart by itself');
  await context.close();
});

test('slides: a clip fits the slide at 390px and at desktop size', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = deck();
  for (const [width, height] of [[390, 780], [1280, 720]]) {
    const { page: p, context } = await openPage(built.url, { width, height });
    await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowRight');
    await settled(p, 3);
    const fit = await p.evaluate(() => {
      const slide = document.getElementById('slide-3').getBoundingClientRect();
      const r = document.querySelector('.slide-motion video').getBoundingClientRect();
      return { top: r.top - slide.top, bottom: slide.bottom - r.bottom, left: r.left, right: window.innerWidth - r.right };
    });
    assert.ok(fit.top >= 0 && fit.bottom >= 0 && fit.left >= 0 && fit.right >= 0, `${width}: ${JSON.stringify(fit)}`);
    await p.screenshot({ path: path.join(scratchDir(), `motion-slide-${width}.png`) });
    await context.close();
  }
});

// ---- print -----------------------------------------------------------------------------------

test('print: the poster stands in for the video, with its caption; with no poster the video drops out', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const withPoster = page();
  const { page: p, context } = await openPage(withPoster.url);
  await p.emulateMedia({ media: 'print' });
  const shown = await p.evaluate(() => {
    const visible = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    return { video: visible(document.querySelector('.mo video')), still: visible(document.querySelector('.mo .mo-still')), caption: visible(document.querySelector('.mo figcaption')), src: document.querySelector('.mo .mo-still')?.getAttribute('src').slice(0, 22) };
  });
  assert.deepEqual(shown, { video: false, still: true, caption: true, src: 'data:image/png;base64,' });
  await p.emulateMedia({ media: 'screen' });
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('.mo .mo-still')).display), 'none', 'the still is for print only');
  await context.close();

  const bare = buildSpec({ title: 'Doc', sections: [{ type: 'motion', title: 'Clip', video: 'demo.mp4', caption: 'Cap' }] }, { files: FILES });
  const second = await openPage(bare.url);
  await second.page.emulateMedia({ media: 'print' });
  assert.equal(await second.page.evaluate(() => document.querySelector('.mo .mo-still')), null, 'no poster, no still');
  assert.equal(await second.page.evaluate(() => getComputedStyle(document.querySelector('.mo video')).display), 'none');
  await second.context.close();
});
