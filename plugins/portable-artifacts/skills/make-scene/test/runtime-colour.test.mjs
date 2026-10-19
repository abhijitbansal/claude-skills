import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_VARS, mixHex, resolveColour, toHex } from '../template/runtime/colour.js';
import { TOKENS, loadTheme, themeCss } from '../shared/theme.mjs';

const DUSK_LIGHT = { '--s1': '#e8553a', '--s2': '#17a487', '--surface': '#fff8f0', '--glow': '#ff6b4a' };
const readLight = (name) => DUSK_LIGHT[name];
const readOther = (name) => ({ ...DUSK_LIGHT, '--s1': '#3d7dd8' })[name];

test('resolveColour handles token, hex and mix', () => {
  assert.equal(resolveColour('cat1', readLight), '#e8553a');
  assert.equal(resolveColour('glow', readLight), '#ff6b4a');
  assert.equal(resolveColour('#ABCDEF', readLight), '#abcdef');
  assert.equal(resolveColour({ base: '#ffffff', tint: 'cat1', share: 0.6 }, readLight), '#f19989');
  assert.equal(resolveColour({ base: '#000000', tint: 'cat1', share: 0.6 }, readLight), '#8b3323');
});

test('group mix follows tint var', () => {
  const ref = { base: '#ffffff', tint: 'cat1', share: 0.6 };
  const light = resolveColour(ref, readLight);
  const other = resolveColour(ref, readOther);
  assert.notEqual(light, other);
  assert.equal(other, mixHex('#3d7dd8', '#ffffff', 0.6));
});

test('mix share is the tint share: 0 is the base, 1 is the tint', () => {
  assert.equal(resolveColour({ base: '#4f8a46', tint: 'surface', share: 0 }, readLight), '#4f8a46');
  assert.equal(resolveColour({ base: '#4f8a46', tint: 'surface', share: 1 }, readLight), '#fff8f0');
});

test('toHex normalises what getPropertyValue returns', () => {
  assert.equal(toHex(' #FFF8F0 '), '#fff8f0');
  assert.equal(toHex('#abc'), '#aabbcc');
  assert.equal(toHex('rgb(232, 85, 58)'), '#e8553a');
  assert.equal(toHex('rgba(232 85 58 / 0.5)'), '#e8553a');
  assert.throws(() => toHex(''), /colour/);
  assert.throws(() => toHex('banana'), /banana/);
});

test('resolveColour rejects unknown refs by name', () => {
  assert.throws(() => resolveColour('cat9', readLight), /cat9/);
  assert.throws(() => resolveColour(7, readLight), /colour/);
  assert.throws(() => resolveColour({ base: '#fff', tint: 'nope', share: 0.5 }, readLight), /nope/);
  assert.throws(() => resolveColour('cat1', () => ''), /--s1/);
});

test('TOKEN_VARS mirrors the shared theme: same tokens, and every var is emitted by themeCss', () => {
  assert.deepEqual(Object.keys(TOKEN_VARS).sort(), [...TOKENS].sort());
  assert.equal(TOKEN_VARS.cat1, '--s1');
  assert.equal(TOKEN_VARS.cat8, '--s8');
  const css = themeCss(loadTheme('dusk'));
  for (const [token, cssVar] of Object.entries(TOKEN_VARS)) {
    assert.ok(css.includes(`${cssVar}:`), `${token} -> ${cssVar} is not defined by the theme css`);
  }
});
