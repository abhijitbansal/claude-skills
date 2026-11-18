import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOKEN_VARS, mixHex, resolveColour, toHex } from '../template/runtime/colour.js';
import { TOKENS, loadTheme, themeCss } from '../shared/theme.mjs';
import { buildObjects } from '../template/runtime/render.js';
import { buildScene } from '../scripts/lib/api.mjs';
import { citySpec } from './helpers/scene-fixtures.mjs';

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

const dusk = loadTheme('dusk');
const VAR_TOKEN = Object.fromEntries(Object.entries(TOKEN_VARS).map(([token, cssVar]) => [cssVar, token]));
const palette = (dark) => ({ dark, readVar: (cssVar) => dusk[dark ? 'dark' : 'light'][VAR_TOKEN[cssVar]] });
const graphOf = async (overrides = {}) => (await buildScene(citySpec(overrides), { dir: process.cwd(), theme: dusk })).graph;
const hexOf = (color) => `#${color.getHexString()}`;

test('retint sets the fog colour from the theme in both modes', async () => {
  const built = buildObjects(await graphOf(), palette(false));
  assert.equal(hexOf(built.fog.color), dusk.light.page);
  built.retint(palette(true));
  assert.equal(hexOf(built.fog.color), dusk.dark.page);
  built.retint(palette(false));
  assert.equal(hexOf(built.fog.color), dusk.light.page);
  built.dispose();
});

test('a space sky has no fog', async () => {
  const built = buildObjects(await graphOf({ world: 'galaxy', links: [{ from: 'api', to: 'web', value: 1 }] }), palette(true));
  assert.equal(built.fog, null);
  built.dispose();
});

test('fog near and far scale with the extent', async () => {
  const graph = await graphOf();
  const big = { ...graph, bounds: { min: graph.bounds.min.map((v) => v * 3), max: graph.bounds.max.map((v) => v * 3) } };
  const range = async (g, fit) => {
    const built = buildObjects(g, palette(false));
    built.setFit(fit);
    const out = { near: built.fog.near, far: built.fog.far };
    built.dispose();
    return out;
  };
  const small = await range(graph, 10);
  const large = await range(big, 30);
  assert.ok(Math.abs(large.near - 3 * small.near) < 1e-9, `near ${large.near} is not 3 x ${small.near}`);
  assert.ok(Math.abs(large.far - 3 * small.far) < 1e-9, `far ${large.far} is not 3 x ${small.far}`);
});
