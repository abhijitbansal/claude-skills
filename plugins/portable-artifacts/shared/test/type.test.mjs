import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_TOKENS, typeCss } from '../type.mjs';
import { themeCss, loadTheme } from '../theme.mjs';

test('every token is emitted with its spec value', () => {
  assert.deepEqual(TYPE_TOKENS, {
    '--fs-xs': '12px', '--fs-sm': '14px', '--fs-base': '17px', '--fs-md': '21px', '--fs-lg': '27px', '--fs-xl': '34px',
    '--fs-hero': 'clamp(40px, 6vw, 60px)', '--lh-body': '1.6', '--lh-head': '1.15', '--lh-hero': '1.05',
    '--track-display': '-0.02em', '--track-hero': '-0.03em',
    '--fs-display': 'clamp(2.5rem, 1.25rem + 4.2vw, 4.75rem)', '--fs-numeral': 'clamp(4.5rem, 2rem + 9vw, 9rem)',
    '--sp-1': '4px', '--sp-2': '8px', '--sp-3': '12px', '--sp-4': '16px', '--sp-5': '24px', '--sp-6': '32px', '--sp-7': '48px', '--sp-8': '72px', '--sp-9': '112px',
  });
  for (const [k, v] of Object.entries(TYPE_TOKENS)) assert.ok(typeCss().includes(`${k}:${v}`), k);
});

test('links: underline only inside running text; never for nav or buttons; visible focus', () => {
  const css = typeCss();
  assert.match(css, /(?:^|\n)a\{[^}]*text-decoration:none/);
  assert.match(css, /\.prose a, p a, li a, td a, dd a, figcaption a\{[^}]*text-decoration-line:underline[^}]*text-decoration-thickness:1px[^}]*text-underline-offset:0\.22em/);
  assert.match(css, /color-mix\(in srgb, var\(--accent\) 45%, transparent\)/);
  assert.match(css, /:focus-visible\{outline:2px solid var\(--accent\)/);
});

test('themeCss carries the type tokens', () => {
  assert.ok(themeCss(loadTheme('paper')).includes('--fs-base:17px'));
});

test('.pa-label never restyles make-diagram SVG labels (<text class="pa-label">)', () => {
  assert.match(typeCss(), /\.pa-label:not\(text\)\{/);
});

test('no body-level tabular-nums (it would reach measured SVG text); tabular figures stay where scoped', () => {
  assert.doesNotMatch(typeCss(), /tabular-nums/);
});
