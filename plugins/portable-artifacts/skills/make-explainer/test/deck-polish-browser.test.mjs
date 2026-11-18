// Look gate round 2 (r13), measured in a browser: the colophon on the closing slide has no band of its own on a classic
// theme, and on a flavored theme its strip is as wide as its line, centred, and closed; the dusk title chips are unboxed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildFile, exampleFile, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';
import { CLASSIC_ART_THEMES } from '../scripts/lib/deck-art.mjs';

after(closeSharedBrowser);
const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const SHAPES = [['phone', 390, 800], ['desk', 1280, 720]];
const FLAVORED = ['dusk', 'poster', 'press'];

async function lastSlideFooter(built, width, height) {
  const { page, context } = await openPage(built.url, { width, height });
  await page.keyboard.press('End');
  await page.waitForFunction(() => Number(document.querySelector('[data-deck]').dataset.current) === Number(document.querySelector('[data-deck]').dataset.total));
  const r = await page.evaluate(() => {
    const slide = document.querySelector('.slide[aria-current], .slide.is-current, .slide:last-of-type') ?? document.querySelector('.slide:last-of-type');
    const foot = slide.querySelector('.pa-footer');
    const p = foot.querySelector('.pa-colophon');
    const fs = getComputedStyle(foot);
    const box = foot.getBoundingClientRect();
    const sb = slide.getBoundingClientRect();
    const art = slide.querySelector('.slide-art');
    return {
      bg: fs.backgroundColor, shadow: fs.boxShadow,
      borders: [fs.borderTopWidth, fs.borderRightWidth, fs.borderBottomWidth, fs.borderLeftWidth],
      boxWidth: box.width, lineWidth: p.scrollWidth, centreOff: Math.abs((box.left + box.right) / 2 - (sb.left + sb.right) / 2),
      mask: art ? (getComputedStyle(art).webkitMaskImage || getComputedStyle(art).maskImage) : '',
    };
  });
  await context.close();
  return r;
}

test('classic closing slide: the colophon has no background or halo of its own, and the art fades out above it', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const theme of CLASSIC_ART_THEMES) {
    const built = buildFile(exampleFile('slides'), { theme, name: `polish-classic-${theme}` });
    for (const [shape, width, height] of SHAPES) {
      const r = await lastSlideFooter(built, width, height);
      const at = `${theme} ${shape}`;
      assert.equal(r.bg, 'rgba(0, 0, 0, 0)', `${at}: no band behind the colophon`);
      assert.equal(r.shadow, 'none', `${at}: no halo round the colophon`);
      assert.match(r.mask, /linear-gradient/, `${at}: the art fades into the ground`);
    }
  }
});

test('flavored closing slide: the colophon strip is as wide as its line, centred, and closed on every side', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const theme of FLAVORED) {
    const built = buildFile(exampleFile('slides'), { theme, name: `polish-flavored-${theme}` });
    for (const [shape, width, height] of SHAPES) {
      const r = await lastSlideFooter(built, width, height);
      const at = `${theme} ${shape}`;
      assert.ok(r.boxWidth <= r.lineWidth + 48, `${at}: the strip is ${r.boxWidth}px for a ${r.lineWidth}px line`);
      assert.ok(r.centreOff <= 2, `${at}: the strip is ${r.centreOff}px off centre`);
      const widths = new Set(r.borders);
      assert.ok(widths.size === 1, `${at}: borders are uneven ${r.borders}`);
    }
  }
});

test('dusk title slide: the meta chips are unboxed', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('slides'), { theme: 'dusk', name: 'polish-dusk-chips' });
  for (const [shape, width, height] of SHAPES) {
    const { page, context } = await openPage(built.url, { width, height });
    const chip = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('#slide-1 .meta div'));
      return { pad: s.paddingLeft, border: s.borderTopWidth, bg: s.backgroundColor, radius: s.borderTopLeftRadius };
    });
    assert.deepEqual(chip, { pad: '0px', border: '0px', bg: 'rgba(0, 0, 0, 0)', radius: '0px' }, shape);
    await context.close();
  }
});
