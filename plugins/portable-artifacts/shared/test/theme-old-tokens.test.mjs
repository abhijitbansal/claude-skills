// A theme written before surface2, surface3 and shadow existed (a theme JSON dropped into an installed copy's
// shared/themes/ folder). The refresh added those three tokens; this pins what an older theme still does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTheme, themeCss, TOKENS } from '../theme.mjs';
import { checkTheme } from '../contrast.mjs';

const NEW_TOKENS = ['surface2', 'surface3', 'shadow'];

function oldTokenSet() {
  const theme = structuredClone(loadTheme('paper'));
  for (const mode of ['light', 'dark']) for (const key of NEW_TOKENS) delete theme[mode][key];
  return theme;
}

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

test('the contrast check names the missing surface steps of an old theme, in both modes', () => {
  const paths = checkTheme(oldTokenSet()).map((e) => e.path);
  for (const mode of ['light', 'dark']) for (const key of ['surface2', 'surface3']) assert.ok(paths.includes(`${mode}.${key}`), `${mode}.${key} is reported missing`);
});
