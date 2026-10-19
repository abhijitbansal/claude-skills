// Contrast that only the rendered page can show: colours a flavored theme computes in place
// (focus rings on solid fills, chips on tinted callouts) and where the heading starts beside a numeral.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpec, haveBrowser, openPage, closeSharedBrowser } from './helpers/browser.mjs';

after(closeSharedBrowser);

const FLAVORED = ['dusk', 'press', 'poster'];
const MODES = ['light', 'dark'];
const TONES = ['info', 'warn', 'good', 'bad'];

const skipUnlessBrowser = async (t) => {
  if (await haveBrowser()) return false;
  t.skip('no browser (bundled Chromium or system Chrome)');
  return true;
};

const probe = (theme) => buildSpec({
  title: 'Focus and contrast probe',
  theme,
  sections: [
    { type: 'tldr', label: 'Verdict', text: 'Lead sentence with a [link](https://example.com).', points: ['One [docs](https://example.com/a).', 'Two.'] },
    { type: 'kpis', title: 'Numbers', items: [{ label: 'n', value: 1, note: 'see [notes](https://example.com/n)' }, { label: 'm', value: 2 }, { label: 'k', value: 3 }] },
    ...TONES.map((tone) => ({ type: 'callout', tone, title: `${tone} title`, text: 'Callout body.' })),
    ...Array.from({ length: 11 }, (_, i) => ({ type: 'text', title: `Claim ${i + 1}`, text: 'Body.' })),
  ],
}, { name: `probe-${theme}` });

// In-page helpers: parse rgb()/color(srgb ...) and the WCAG ratio; the backdrop is the nearest opaque background.
const IN_PAGE = `
window.__rgb = (c) => {
  const n = c.match(/-?\\d*\\.?\\d+/g).map(Number);
  return c.startsWith('color(') ? n.slice(0, 3).map((v) => v * 255) : n.slice(0, 3);
};
window.__alpha = (c) => { const n = c.match(/-?\\d*\\.?\\d+/g).map(Number); return c === 'transparent' ? 0 : (n.length > 3 ? n[3] : 1); };
window.__lum = (rgb) => { const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
window.__ratio = (a, b) => { const [x, y] = [window.__lum(window.__rgb(a)), window.__lum(window.__rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
window.__backdrop = (el) => {
  for (let n = el; n; n = n.parentElement) {
    const bg = getComputedStyle(n).backgroundColor;
    if (window.__alpha(bg) > 0) return bg;
    const fill = getComputedStyle(n, '::before').backgroundColor;
    if (n.matches('.hero-tldr') && window.__alpha(fill) > 0) return fill;
  }
  return getComputedStyle(document.body).backgroundColor;
};`;

test('focus ring: a link inside a solid fill (the verdict card, the dusk ink tile) contrasts 3:1 with that fill', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const theme of FLAVORED) {
    const { url } = probe(theme);
    for (const colorScheme of MODES) {
      const { page, context } = await openPage(url, { colorScheme });
      await page.addScriptTag({ content: IN_PAGE });
      const seen = {};
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const a = document.activeElement;
          const where = a.closest('.hero-tldr') ? 'card' : a.closest('.kpi:first-child') ? 'tile' : null;
          if (!where || !a.matches(':focus-visible')) return null;
          const cs = getComputedStyle(a);
          return { where, style: cs.outlineStyle, ratio: window.__ratio(cs.outlineColor, window.__backdrop(a)) };
        });
        if (r && !seen[r.where]) seen[r.where] = r;
      }
      assert.ok(seen.card, `${theme} ${colorScheme}: tabbing reaches a link in the verdict card`);
      for (const [where, r] of Object.entries(seen)) {
        assert.notEqual(r.style, 'none', `${theme} ${colorScheme} ${where}: a ring is drawn`);
        assert.ok(r.ratio >= 3, `${theme} ${colorScheme} ${where}: focus ring ${r.ratio.toFixed(2)}:1 on its fill`);
      }
      await context.close();
    }
  }
});

test('callouts: every tone chip and title reads at 4.5:1 on the callout it sits on', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const theme of FLAVORED) {
    const { url } = probe(theme);
    for (const colorScheme of MODES) {
      const { page, context } = await openPage(url, { colorScheme });
      await page.addScriptTag({ content: IN_PAGE });
      const rows = await page.evaluate(() => [...document.querySelectorAll('.callout')].flatMap((c) => [c.querySelector('.chip'), c.querySelector('.callout-title'), c.querySelector('p:not(.callout-head)')]
        .map((el) => ({ what: `${c.className} ${el.className || el.tagName}`, ratio: window.__ratio(getComputedStyle(el).color, window.__backdrop(el)) }))));
      assert.equal(rows.length, 12);
      for (const r of rows) assert.ok(r.ratio >= 4.5, `${theme} ${colorScheme} ${r.what}: ${r.ratio.toFixed(2)}:1`);
      await context.close();
    }
  }
});

test('poster: headings start at one x beside one- and two-digit numerals alike', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, context } = await openPage(probe('poster').url, { width: 1280 });
  const xs = await page.evaluate(() => [...document.querySelectorAll('.sec-title')].map((h) => Math.round(h.getBoundingClientRect().left)));
  assert.ok(xs.length >= 12);
  assert.equal(new Set(xs).size, 1, `heading x positions: ${xs.join(', ')}`);
  await context.close();
});

test('dusk: the outlined numeral overlaps no content of its section', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  for (const width of [1280, 375]) {
    const { page, context } = await openPage(probe('dusk').url, { width });
    const hits = await page.evaluate(() => {
      const off = document.createElement('style');
      off.textContent = '.sec[data-ghost]::before{content:none !important}';
      document.head.appendChild(off);
      return [...document.querySelectorAll('.sections > .sec:has(> .sec-title)')].flatMap((sec) => {
      // the numeral is ::before; measure a stand-in that copies its computed box, with the real one switched off
      const cs = getComputedStyle(sec, '::before');
      const ghost = document.createElement('span');
      for (const p of ['position', 'float', 'top', 'right', 'left', 'font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing', 'margin', 'display', 'width']) ghost.style.setProperty(p, cs.getPropertyValue(p));
      ghost.textContent = '00';
      sec.setAttribute('data-ghost', '');
      sec.insertBefore(ghost, sec.firstChild);
      const n = ghost.getBoundingClientRect();
      const out = [...sec.children].filter((el) => el !== ghost).flatMap((el) => [el, ...el.querySelectorAll('.kpi, .card, h2, p, li')])
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top; })
        .map((el) => `${sec.id}: ${el.className || el.tagName}`);
      ghost.remove();
      sec.removeAttribute('data-ghost');
      return out;
      });
    });
    assert.deepEqual(hits, [], `${width}px`);
    await context.close();
  }
});
