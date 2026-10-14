// Engines without context-stroke or color-mix() drop the whole declaration; the
// property then keeps its earlier value. Every such declaration must therefore
// follow a plain one for the same property, or the drawing goes black / vanishes.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { diagramCss } from '../scripts/lib/render.mjs';
import { buildPage, example } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';

after(closeBrowser);

const MODERN = /context-stroke|color-mix\(/;
// Strips each declaration that uses a modern keyword, as a non-supporting engine's parser would.
const STRIP = /[\w-]+\s*:[^;{}]*(?:context-stroke|color-mix\()[^;{}]*;?/g;

/** Declarations using a modern keyword that no plain declaration of the same property directly precedes (custom properties have no fallback: skipped). */
export function unguarded(css) {
  const bad = [];
  for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
    const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
    decls.forEach((d, i) => {
      if (!MODERN.test(d)) return;
      const prop = d.slice(0, d.indexOf(':')).trim();
      if (prop.startsWith('--')) return;
      const prev = decls[i - 1];
      if (!prev || prev.slice(0, prev.indexOf(':')).trim() !== prop || MODERN.test(prev)) bad.push(d);
    });
  }
  return bad;
}

test('the checker flags a modern declaration with no plain one before it', () => {
  assert.deepEqual(unguarded('.a{fill:context-stroke}'), ['fill:context-stroke']);
  assert.deepEqual(unguarded('.a{stroke:red;fill:color-mix(in srgb,red 7%,blue)}'), ['fill:color-mix(in srgb,red 7%,blue)']);
  assert.deepEqual(unguarded('.a{fill:red;fill:color-mix(in srgb,red 7%,blue)}'), []);
});

test('diagramCss: every context-stroke and color-mix declaration follows a plain one for the same property', () => {
  assert.deepEqual(unguarded(diagramCss()), []);
});

test('the built page: every context-stroke and color-mix declaration in its styles follows a plain one', () => {
  const { html } = buildPage(example('architecture'), { name: 'fallbacks' });
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  assert.ok(MODERN.test(styles), 'the page does use the modern forms (else this test proves nothing)');
  assert.deepEqual(unguarded(styles), []);
});

test('with every context-stroke and color-mix declaration dropped, arrow heads, group boxes and tiles are not black or missing', async (t) => {
  if (await skipUnlessBrowser(t)) return;
  const { page, problems, context } = await openPage(buildPage(example('architecture'), { name: 'fallbacks-browser' }).url);
  const read = () => page.evaluate(() => {
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    return {
      arrowFill: css('.pa-arrow-fill', 'fill'),
      arrowOpen: css('.pa-arrow-open', 'stroke'),
      group: css('.pa-group-box', 'fill'),
      tile: css('.pa-tile', 'fill'),
    };
  });
  const modern = await read();
  await page.evaluate((src) => {
    const strip = new RegExp(src, 'g');
    document.querySelectorAll('style').forEach((s) => { s.textContent = s.textContent.replace(strip, ''); });
  }, STRIP.source);
  const fallback = await read();
  for (const [name, value] of Object.entries(fallback)) {
    assert.ok(value !== 'rgb(0, 0, 0)' && value !== 'none', `${name} falls back to a real colour, got ${value}`);
  }
  assert.notEqual(modern.arrowFill, 'rgb(0, 0, 0)');
  assert.deepEqual(problems, []);
  await context.close();
});
