import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_THEME, TOKENS, listThemes, loadTheme, themeCss, fontPayloadBytes, ThemeError } from '../theme.mjs';

test('seven themes ship, paper is the default', () => {
  assert.deepEqual(listThemes(), ['blueprint', 'dusk', 'editorial', 'ink', 'paper', 'poster', 'press']);
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
  assert.match(css, /@font-face\{font-family:"Geist";font-style:normal;font-weight:400;font-display:swap;src:url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\)\}/);
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

test('kind hues and the glow are tokens with their own CSS variables', () => {
  for (const k of ['kindPerson', 'kindService', 'kindData', 'kindQueue', 'kindExternal', 'kindDecision', 'glow']) assert.ok(TOKENS.includes(k), k);
  const css = themeCss(loadTheme('blueprint'));
  assert.ok(css.includes('--k-person:#a3480a'), 'light person hue on :root');
  assert.ok(css.includes('--k-service:#38bdf8'), 'dark service hue');
  assert.ok(css.includes('--glow:#8fd0ff'), 'dark glow');
  for (const v of ['--k-data', '--k-queue', '--k-external', '--k-decision']) assert.ok(css.includes(`${v}:`), v);
});

test('themes use the Geist type system; editorial takes the serif display', () => {
  const fam = (t, role) => loadTheme(t).fonts[role].family;
  for (const t of ['paper', 'blueprint']) {
    assert.equal(fam(t, 'display'), 'Geist');
    assert.equal(fam(t, 'body'), 'Geist');
  }
  assert.equal(fam('ink', 'display'), 'Bricolage Grotesque');
  assert.equal(fam('ink', 'body'), 'Geist');
  assert.equal(fam('editorial', 'display'), 'Newsreader');
  assert.equal(fam('editorial', 'body'), 'Atkinson Hyperlegible');
  for (const t of ['paper', 'blueprint', 'ink', 'editorial']) assert.equal(fam(t, 'mono'), 'Geist Mono');
  assert.equal(fam('dusk', 'display'), 'Funnel Display');
  assert.equal(fam('press', 'display'), 'Young Serif');
  assert.equal(fam('poster', 'display'), 'Big Shoulders Display');
});
