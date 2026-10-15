import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIAGRAM_THEME, themeFor } from '../scripts/lib/theme.mjs';
import { loadTheme, DEFAULT_THEME, ThemeError } from '../shared/theme.mjs';

test('make-diagram defaults to blueprint while the shared default stays paper; an override, then the spec, win', () => {
  assert.equal(DIAGRAM_THEME, 'blueprint');
  assert.equal(DEFAULT_THEME, 'paper');
  assert.equal(themeFor({}).name, 'blueprint');
  assert.equal(themeFor({ theme: 'ink' }).name, 'ink');
  assert.equal(themeFor({ theme: 'ink' }, 'paper').name, 'paper', 'a name override wins');
  const loaded = loadTheme('editorial');
  assert.equal(themeFor({ theme: 'ink' }, loaded), loaded, 'a loaded theme passes through untouched');
  assert.throws(() => themeFor({}, 'nope'), ThemeError);
});
