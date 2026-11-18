// A theme written before surface2, surface3 and shadow existed (a theme JSON dropped into an installed copy's
// shared/themes/ folder). The refresh added those three tokens; this pins what an older theme still does:
// themeCss writes a derived surface step and the plain black elevation shadow instead of `undefined`, and
// checkTheme says which token is missing and what the build uses in its place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTheme, themeCss, TOKENS } from '../theme.mjs';
import { checkTheme, mixHex, withTokenFallbacks, FALLBACK_SHADOW, SURFACE_STEP_MIX } from '../contrast.mjs';

const NEW_TOKENS = ['surface2', 'surface3', 'shadow'];
const MODES = ['light', 'dark'];

function oldTokenSet() {
  const theme = structuredClone(loadTheme('paper'));
  for (const mode of MODES) for (const key of NEW_TOKENS) delete theme[mode][key];
  return theme;
}

// Everything but the embedded fonts: base64 can contain the letters "null" or "NaN" by chance.
const withoutFonts = (css) => css.split('\n').filter((line) => !line.startsWith('@font-face')).join('\n');
const count = (css, needle) => css.split(needle).length - 1;

test('the three new tokens are the only ones the old token set lacks', () => {
  const theme = oldTokenSet();
  const missing = TOKENS.filter((k) => theme.light[k] === undefined);
  assert.deepEqual(missing, NEW_TOKENS);
});

test('a theme with the old token set still builds: themeCss does not throw and every older token is written', () => {
  const css = themeCss(oldTokenSet());
  for (const cssVar of ['--page', '--surface', '--text', '--accent', '--s1', '--glow']) assert.ok(css.includes(`${cssVar}:#`), `${cssVar} is written`);
  assert.match(css, /--elev-1:/, 'the elevation scale is still emitted');
});

test('themeCss never writes undefined, null or NaN for a token of an old theme', () => {
  const css = withoutFonts(themeCss(oldTokenSet()));
  assert.doesNotMatch(css, /:\s*(undefined|null|NaN)\b/);
});

test('a missing surface2 and surface3 fall back to a mix of surface toward text, the same rule in light and dark', () => {
  const theme = oldTokenSet();
  const css = themeCss(theme);
  // the light :root block declares each token once; the dark tokens are declared in two blocks (media query and data-theme)
  const times = { light: 1, dark: 2 };
  for (const mode of MODES) {
    const { surface, text } = theme[mode];
    const [s2, s3] = SURFACE_STEP_MIX.map((share) => mixHex(text, surface, share));
    assert.notEqual(s2, surface, `${mode}: the first step differs from surface`);
    assert.notEqual(s3, s2, `${mode}: the second step differs from the first`);
    assert.equal(count(css, `--surface-2:${s2};`), times[mode], `${mode}: --surface-2 is ${s2}`);
    assert.equal(count(css, `--surface-3:${s3};`), times[mode], `${mode}: --surface-3 is ${s3}`);
  }
});

test('a missing shadow falls back to the plain black elevation shadow in both modes', () => {
  const css = themeCss(oldTokenSet());
  assert.equal(FALLBACK_SHADOW, '#000000');
  assert.equal(count(css, `--shadow:${FALLBACK_SHADOW};`), 3, 'one light block and two dark blocks');
});

test('a theme that sets the three tokens keeps its own values', () => {
  const theme = loadTheme('paper');
  const css = themeCss(theme);
  assert.ok(css.includes(`--surface-2:${theme.light.surface2};`));
  assert.ok(css.includes(`--surface-3:${theme.dark.surface3};`));
  assert.ok(css.includes(`--shadow:${theme.light.shadow};`));
  assert.ok(!css.includes(`--shadow:${FALLBACK_SHADOW};`), 'the fallback is not used when the theme sets a shadow');
});

test('a token the theme leaves out, or sets to null or NaN, is omitted instead of written as junk', () => {
  const theme = oldTokenSet();
  delete theme.light.glow;
  theme.light.accentSoft = null;
  theme.dark.warn = Number.NaN;
  const css = withoutFonts(themeCss(theme));
  assert.doesNotMatch(css, /:\s*(undefined|null|NaN)\b/);
  assert.equal(count(css, '--glow:'), 2, '--glow is declared only in the two dark blocks');
  assert.equal(count(css, '--accent-soft:'), 2, '--accent-soft is declared only in the two dark blocks');
  assert.equal(count(css, '--warn:'), 1, '--warn is declared only in the light block');
});

test('the contrast check names the missing surface steps of an old theme, in both modes', () => {
  const paths = checkTheme(oldTokenSet()).map((e) => e.path);
  for (const mode of MODES) for (const key of ['surface2', 'surface3']) assert.ok(paths.includes(`${mode}.${key}`), `${mode}.${key} is reported missing`);
});

test('the contrast check reports a missing shadow in both modes and names the fallback', () => {
  const found = checkTheme(oldTokenSet());
  for (const mode of MODES) {
    const entry = found.find((e) => e.path === `${mode}.shadow`);
    assert.ok(entry, `${mode}.shadow is reported`);
    assert.match(entry.message, /missing/);
    assert.ok(entry.message.includes(FALLBACK_SHADOW), 'the message names the fallback colour');
  }
});

test('a theme that sets a shadow is not told it is missing', () => {
  assert.deepEqual(checkTheme(loadTheme('paper')).filter((e) => e.path.endsWith('.shadow')), []);
});

test('the fallback surfaces of the old paper copy pass every contrast check', () => {
  const old = oldTokenSet();
  const filled = { ...old, light: withTokenFallbacks(old.light), dark: withTokenFallbacks(old.dark) };
  for (const mode of MODES) for (const key of NEW_TOKENS) assert.equal(typeof filled[mode][key], 'string', `${mode}.${key} is filled`);
  assert.deepEqual(checkTheme(filled), []);
});

test('withTokenFallbacks leaves a complete token set unchanged', () => {
  const paper = loadTheme('paper');
  for (const mode of MODES) assert.deepEqual(withTokenFallbacks(paper[mode]), paper[mode]);
});
