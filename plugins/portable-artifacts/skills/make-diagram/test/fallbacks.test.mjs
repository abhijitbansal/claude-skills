// An engine without context-stroke or color-mix() must still draw the diagram.
// context-stroke has no var(), so the engine drops the declaration at parse time
// and the property keeps the plain one before it. Every colour-mix() here wraps
// var(): the declaration is valid at parse time, fails at computed-value time and
// falls to the property's initial value (black), never to an earlier declaration.
// So color-mix() lives only inside @supports (color: color-mix(...)), which a
// non-supporting engine skips whole, leaving the plain rule.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { diagramCss } from '../scripts/lib/render.mjs';
import { buildPage, example } from './helpers/browser.mjs';
import { openPage, closeBrowser, skipUnlessBrowser } from './helpers/page.mjs';

after(closeBrowser);

const MIX = /color-mix\(/;
const CONTEXT = /context-stroke/;
const SUPPORTS_MIX = /@supports\s*\(\s*color\s*:\s*color-mix\(/g;

/** `css` without its `@supports (color: color-mix(...)) {...}` blocks (brace-matched). */
export function withoutMixBlocks(css) {
  let out = '';
  let from = 0;
  for (const m of css.matchAll(SUPPORTS_MIX)) {
    if (m.index < from) continue;
    const open = css.indexOf('{', m.index);
    let depth = 0;
    let end = open;
    for (; end < css.length; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}' && --depth === 0) break;
    }
    out += css.slice(from, m.index);
    from = end + 1;
  }
  return out + css.slice(from);
}

/** Declarations using a modern form the stylesheet leaves unguarded: color-mix( outside an @supports block, context-stroke with no plain declaration of the same property directly before it. */
export function unguarded(css) {
  const outside = withoutMixBlocks(css);
  const bad = outside.split(/[;{}]/).map((d) => d.trim()).filter((d) => MIX.test(d));
  for (const [, body] of outside.matchAll(/\{([^{}]*)\}/g)) {
    const decls = body.split(';').map((d) => d.trim()).filter(Boolean);
    decls.forEach((d, i) => {
      if (!CONTEXT.test(d)) return;
      const prop = d.slice(0, d.indexOf(':')).trim();
      const prev = decls[i - 1];
      if (!prev || prev.slice(0, prev.indexOf(':')).trim() !== prop || CONTEXT.test(prev)) bad.push(d);
    });
  }
  return bad;
}

test('the checker flags a modern declaration the stylesheet leaves unguarded', () => {
  assert.deepEqual(unguarded('.a{fill:context-stroke}'), ['fill:context-stroke']);
  assert.deepEqual(unguarded('.a{fill:red;fill:context-stroke}'), []);
  assert.deepEqual(unguarded('.a{fill:red;fill:color-mix(in srgb,var(--x) 7%,blue)}'), ['fill:color-mix(in srgb,var(--x) 7%,blue)']);
  assert.deepEqual(unguarded('.a{--b:color-mix(in srgb,red,blue)}'), ['--b:color-mix(in srgb,red,blue)']);
  assert.deepEqual(unguarded('.a{fill:red}@supports (color: color-mix(in srgb, red, red)){.a{fill:color-mix(in srgb,var(--x) 7%,blue)}}.b{fill:red}'), []);
  assert.deepEqual(unguarded('@supports (display:grid){.a{fill:color-mix(in srgb,var(--x) 7%,blue)}}'), ['fill:color-mix(in srgb,var(--x) 7%,blue)']);
});

test('diagramCss: color-mix only inside @supports, context-stroke only after a plain declaration', () => {
  assert.match(diagramCss(), MIX, 'the stylesheet does use color-mix (else this test proves nothing)');
  assert.deepEqual(unguarded(diagramCss()), []);
});

test('the built page: the same holds for every style block', () => {
  const { html } = buildPage(example('architecture'), { name: 'fallbacks' });
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  assert.match(styles, MIX);
  assert.match(styles, CONTEXT);
  assert.deepEqual(unguarded(styles), []);
});

// What an engine without the two features does, modelled by renaming each to an unknown name (not by deleting text:
// a deleted var()-wrapped color-mix would pass here yet fail in a real engine at computed-value time).
for (const colorScheme of ['light', 'dark']) {
  test(`${colorScheme}: without color-mix() and context-stroke, arrow heads, groups, cards, tiles and the legend still draw`, async (t) => {
    if (await skipUnlessBrowser(t)) return;
    const { page, problems, context } = await openPage(buildPage(example('architecture'), { name: `fallbacks-${colorScheme}` }).url, { colorScheme });
    await page.evaluate(() => {
      document.querySelectorAll('style').forEach((s) => {
        s.textContent = s.textContent.replaceAll('color-mix(', 'colr-mox(').replaceAll('context-stroke', 'cntx-stroke');
      });
    });
    const got = await page.evaluate(() => {
      const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
      const card = '[class*="pa-family-"]:not(.pa-family-bare) .pa-shape';
      return {
        arrowFill: css('.pa-arrow-fill', 'fill'),
        arrowOpen: css('.pa-arrow-open', 'stroke'),
        group: css('.pa-group-box', 'fill'),
        tile: css('.pa-tile', 'fill'),
        shape: css(card, 'fill'),
        legendSwatch: css('.legend [class*="lg-sw-"]', 'backgroundColor'),
        legendBg: css('.legend', 'backgroundColor'),
        legendBorder: css('.legend', 'borderTopStyle'),
        stage: css('.stage', 'backgroundImage'),
      };
    });
    for (const key of ['arrowFill', 'arrowOpen', 'group', 'tile', 'shape']) {
      assert.ok(got[key] !== 'rgb(0, 0, 0)' && got[key] !== 'none', `${key} falls back to a real colour, got ${got[key]}`);
    }
    assert.notEqual(got.legendSwatch, 'rgba(0, 0, 0, 0)', 'legend swatch keeps a fill');
    assert.notEqual(got.legendBg, 'rgba(0, 0, 0, 0)', 'legend keeps a background');
    assert.notEqual(got.legendBorder, 'none', 'legend keeps its border');
    assert.notEqual(got.stage, 'none', 'the stage keeps its grid');
    assert.deepEqual(problems, []);
    await context.close();
  });
}
