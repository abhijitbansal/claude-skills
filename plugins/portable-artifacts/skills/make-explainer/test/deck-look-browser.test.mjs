// The look gate's findings on the deck's title and closing slides, as measured rules (the pixels themselves are judged
// by looking): no art behind the title text, the phone title as large and as far out as the page hero, the right
// picture for the screen's shape, unboxed chips, a colophon that fits on one line, and the dusk page's phone art.
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
const MODES = ['light', 'dark'];

test('classic title slide: solid ground under every text box, the picture for the screen shape, unboxed chips, a phone title at least 38px at the gutter', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const theme of CLASSIC_ART_THEMES) {
    const built = buildFile(exampleFile('slides'), { theme, name: `look-${theme}` });
    for (const [shape, width, height] of SHAPES) {
      for (const colorScheme of MODES) {
        const { page, context } = await openPage(built.url, { width, height, colorScheme });
        const r = await page.evaluate(() => {
          const slide = document.querySelector('#slide-1');
          const box = slide.querySelector('.slide-inner').getBoundingClientRect();
          const inside = ['h1', '.subtitle', '.meta'].map((s) => {
            const b = slide.querySelector(s).getBoundingClientRect();
            return b.left >= box.left - 0.5 && b.right <= box.right + 0.5 && b.top >= box.top - 0.5 && b.bottom <= box.bottom + 0.5;
          });
          const bg = getComputedStyle(slide.querySelector('.slide-inner')).backgroundColor;
          const shown = [...slide.querySelectorAll('.slide-art svg')].filter((s) => getComputedStyle(s).display !== 'none').map((s) => s.getAttribute('class'));
          const chip = getComputedStyle(slide.querySelector('.meta div'));
          const h1 = slide.querySelector('h1');
          return { inside, bg, shown, chip: { border: chip.borderTopWidth, bg: chip.backgroundColor, pad: chip.paddingLeft }, font: parseFloat(getComputedStyle(h1).fontSize), left: h1.getBoundingClientRect().left };
        });
        const at = `${theme} ${shape} ${colorScheme}`;
        assert.deepEqual(r.inside, [true, true, true], `${at}: the title, subtitle and chips sit inside the card`);
        assert.ok(/^rgb\(/.test(r.bg) || /,\s*1\)$/.test(r.bg), `${at}: the card is opaque (${r.bg})`);
        assert.equal(r.shown.length, 1, `${at}: one picture shows (${r.shown})`);
        assert.match(r.shown[0], new RegExp(`art-${colorScheme} art-${shape === 'phone' ? 'tall' : 'wide'}`), at);
        assert.deepEqual(r.chip, { border: '0px', bg: 'rgba(0, 0, 0, 0)', pad: '0px' }, `${at}: chips are unboxed`);
        if (shape === 'phone') {
          assert.ok(r.font >= 38, `${at}: the title is ${r.font}px`);
          assert.ok(r.left <= 16.5, `${at}: the title starts at ${r.left}px`);
        }
        await context.close();
      }
    }
  }
});

test('the colophon is one line that is not cut off, at 390 and 1280, in every theme', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const problems = [];
  for (const theme of ['blueprint', 'brief', 'dusk', 'editorial', 'ink', 'mono', 'paper', 'poster', 'press']) {
    const built = buildFile(exampleFile('slides'), { theme, name: `colophon-${theme}` });
    for (const [shape, width, height] of SHAPES) {
      const { page, context } = await openPage(built.url, { width, height });
      await page.keyboard.press('End');
      await page.waitForFunction(() => Number(document.querySelector('[data-deck]').dataset.current) === Number(document.querySelector('[data-deck]').dataset.total));
      const r = await page.evaluate(() => {
        const p = document.querySelector('.pa-colophon');
        const lineHeight = parseFloat(getComputedStyle(p).lineHeight) || parseFloat(getComputedStyle(p).fontSize) * 1.5;
        return { count: document.querySelectorAll('.pa-colophon').length, cut: p.scrollWidth > p.clientWidth, need: p.scrollWidth, have: p.clientWidth, height: p.getBoundingClientRect().height, lineHeight, text: p.textContent };
      });
      const at = `${theme} ${shape}`;
      assert.equal(r.count, 1, at);
      if (r.cut) problems.push(`${at}: cut off, needs ${r.need}px, the strip is ${r.have}px`);
      if (r.height > r.lineHeight * 1.2) problems.push(`${at}: more than one line (${r.height}px)`);
      assert.match(r.text, /model, effort, agent not reported/, `${at}: the not-reported wording stays`);
      await context.close();
    }
  }
  assert.deepEqual(problems, []);
});

test('dusk concept page at 390: the hero art is there, in both colour modes', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const built = buildFile(exampleFile('concept'), { theme: 'dusk', name: 'look-dusk-concept' });
  for (const colorScheme of MODES) {
    const { page, context } = await openPage(built.url, { width: 390, height: 800, colorScheme });
    const r = await page.evaluate(() => {
      const art = document.querySelector('.hero-art');
      const shown = [...art.querySelectorAll('svg')].filter((s) => getComputedStyle(s).display !== 'none');
      const box = art.getBoundingClientRect();
      return { display: getComputedStyle(art).display, shown: shown.length, width: box.width, height: box.height };
    });
    assert.notEqual(r.display, 'none', colorScheme);
    assert.equal(r.shown, 1, `${colorScheme}: one drawing shows`);
    assert.ok(r.width >= 300 && r.height >= 100, `${colorScheme}: the art is ${r.width}x${r.height}`);
    await context.close();
  }
});
