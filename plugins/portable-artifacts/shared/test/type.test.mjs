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
    '--fs-d3': '28px', '--fs-d2': '37px', '--fs-d1': '49px', '--lh-tight': '1.1',
    '--track-caps': '0.07em', '--num': 'tabular-nums lining-nums',
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
  assert.match(typeCss(), /\.pa-label:not\(text\)[,{]/);
});

const px = (k) => Number.parseFloat(TYPE_TOKENS[k]);

test('display sizes step by at least 1.3 from the largest text size, and from each other', () => {
  const steps = ['--fs-md', '--fs-d3', '--fs-d2', '--fs-d1'].map(px);
  for (let i = 1; i < steps.length; i++) {
    assert.ok(steps[i] / steps[i - 1] >= 1.3, `step ${i}: ${steps[i]} / ${steps[i - 1]} = ${(steps[i] / steps[i - 1]).toFixed(3)}`);
  }
});

// The declaration block of the first rule whose selector list contains `selector`.
const ruleFor = (css, selector) => {
  for (const m of css.matchAll(/(?:^|\n|\})([^{}\n]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map((s) => s.trim()).includes(selector)) return { selectors: m[1], body: m[2] };
  }
  return null;
};

test('one caps tracking: .pa-caps and .pa-label share one rule that reads --track-caps, with no literal tracking', () => {
  const caps = ruleFor(typeCss(), '.pa-caps');
  const label = ruleFor(typeCss(), '.pa-label:not(text)');
  assert.ok(caps, '.pa-caps rule exists');
  assert.equal(label?.body, caps.body, '.pa-label is an alias of .pa-caps');
  assert.match(caps.body, /letter-spacing:var\(--track-caps\)/);
  assert.match(caps.body, /text-transform:uppercase/);
  assert.match(caps.body, /font-weight:var\(--strong-weight\)/);
  assert.doesNotMatch(caps.body, /letter-spacing:-?\d*\.?\d+em/);
});

test('.pa-num sets tabular and lining figures and matches no SVG text selector', () => {
  const num = ruleFor(typeCss(), '.pa-num:not(text)');
  assert.ok(num, '.pa-num:not(text) rule exists');
  assert.match(num.body, /font-variant-numeric:var\(--num\)/);
  assert.equal(TYPE_TOKENS['--num'], 'tabular-nums lining-nums');
  assert.doesNotMatch(num.selectors, /(?:^|[\s,])(?:svg|text|body|html|:root)\b/);
});

test('no body-level tabular-nums (it would reach measured SVG text); tabular figures stay where scoped', () => {
  const css = typeCss();
  // the figures live in the --num token and are applied only by .pa-num:not(text)
  assert.equal([...css.matchAll(/tabular-nums/g)].length, 1, 'tabular-nums appears once: the --num token');
  assert.equal([...css.matchAll(/font-variant-numeric/g)].length, 1, 'font-variant-numeric is set by one rule');
  for (const sel of ['body', 'html', ':root', 'svg', 'text', '*']) {
    const r = ruleFor(css, sel);
    assert.ok(!r || !/font-variant-numeric/.test(r.body), `${sel} sets no figures`);
  }
});
