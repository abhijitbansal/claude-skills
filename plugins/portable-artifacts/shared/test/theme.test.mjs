import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, TOKENS, listThemes, loadTheme, themeCss, fontPayloadBytes, ThemeError } from '../theme.mjs';

test('four candidate themes ship, paper is the default', () => {
  assert.deepEqual(listThemes(), ['blueprint', 'editorial', 'ink', 'paper']);
  assert.equal(DEFAULT_THEME, 'paper');
});

test('unknown theme throws ThemeError listing what exists', () => {
  assert.throws(() => loadTheme('papr'), (e) => e instanceof ThemeError && e.available.includes('paper'));
  assert.throws(() => loadTheme('../etc/passwd'), ThemeError, 'names are checked, not resolved as paths');
});

test('themeCss: light tokens on :root, dark under the media query AND data-theme, fonts embedded', () => {
  const css = themeCss(loadTheme('paper'));
  for (const v of ['--page', '--surface', '--text-3', '--s8', '--seq7', '--font-display', '--font', '--mono', '--accent-soft']) {
    assert.ok(css.includes(`${v}:`), v);
  }
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{color-scheme:dark;/);
  assert.match(css, /:root\[data-theme="dark"\]\{color-scheme:dark;/);
  assert.match(css, /@font-face\{font-family:"IBM Plex Sans";font-style:normal;font-weight:400;font-display:swap;src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)\}/);
  assert.ok(!/url\((?!data:)/.test(css), 'no external url() anywhere');
});

test('every theme defines every token in both modes and stays within the font budget', () => {
  for (const name of listThemes()) {
    const t = loadTheme(name);
    for (const mode of ['light', 'dark']) for (const k of TOKENS) assert.match(t[mode][k] ?? '', /^#[0-9a-f]{6}$/, `${name}.${mode}.${k}`);
    const files = new Set(Object.values(t.fonts).flatMap((f) => Object.values(f.weights)));
    assert.ok(files.size <= 6, `${name} uses ${files.size} font files`);
    assert.ok(fontPayloadBytes(t) <= 200 * 1024, `${name} fonts ${fontPayloadBytes(t)} bytes`);
  }
});
