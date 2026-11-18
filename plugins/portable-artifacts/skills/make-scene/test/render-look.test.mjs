// The scene's look: lights, materials and fog come from named constants (template/runtime/look.js), one set per sky.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTheme } from '../shared/theme.mjs';
import { TOKEN_VARS } from '../template/runtime/colour.js';
import { LIGHT_SETS, MATERIAL_ROLES, MIN_KEY_FILL_RATIO, fogRange, lightSetName } from '../template/runtime/look.js';
import { buildObjects } from '../template/runtime/render.js';
import { buildScene } from '../scripts/lib/api.mjs';
import { citySpec } from './helpers/scene-fixtures.mjs';

const theme = loadTheme('dusk');
const VAR_TOKEN = Object.fromEntries(Object.entries(TOKEN_VARS).map(([token, cssVar]) => [cssVar, token]));
const palette = (dark) => ({ dark, readVar: (cssVar) => theme[dark ? 'dark' : 'light'][VAR_TOKEN[cssVar]] });

async function graphOf(overrides) {
  return (await buildScene(citySpec(overrides), { dir: process.cwd(), theme })).graph;
}

const GALAXY = { world: 'galaxy', links: [{ from: 'api', to: 'web', value: 5 }] };
const named = (root, name) => root.children.find((c) => c.name === name);
const standardMaterials = (root) => {
  const found = new Set();
  root.traverse((o) => { if (o.material?.isMeshStandardMaterial) found.add(o.material); });
  return [...found];
};

test('one light set per sky: space, night, dim and day', () => {
  assert.deepEqual(Object.keys(LIGHT_SETS).sort(), ['day', 'dim', 'night', 'space']);
  assert.equal(lightSetName({ sky: 'space' }, false), 'space');
  assert.equal(lightSetName({ sky: 'space', nightLights: true }, true), 'space');
  assert.equal(lightSetName({ sky: 'theme', nightLights: true }, true), 'night');
  assert.equal(lightSetName({ sky: 'theme', nightLights: true }, false), 'day');
  assert.equal(lightSetName({ sky: 'theme' }, true), 'dim');
  assert.equal(lightSetName({ sky: 'theme' }, false), 'day');
});

test('every set has a key and a fill in a clear ratio; only the night has a rim', () => {
  for (const [name, set] of Object.entries(LIGHT_SETS)) {
    assert.ok(set.key / set.fill >= MIN_KEY_FILL_RATIO, `${name}: key ${set.key} over fill ${set.fill} is under ${MIN_KEY_FILL_RATIO}:1`);
    if (name === 'night') assert.ok(set.rim && set.rim.intensity > 0, 'the night has a rim light');
    else assert.equal(set.rim, null, `${name} has no rim`);
  }
});

test('the lights in the scene carry the numbers of the set for the sky and mode', async () => {
  const graph = await graphOf({});
  const built = buildObjects(graph, palette(true));
  const read = (set) => {
    const key = named(built.root, 'key');
    const fill = named(built.root, 'fill');
    const rim = named(built.root, 'rim');
    assert.equal(key.intensity, set.key);
    assert.equal(fill.intensity, set.fill);
    assert.equal(rim.intensity, set.rim?.intensity ?? 0);
  };
  assert.equal(graph.env.nightLights, true, 'the city fixture lights its windows at night');
  read(LIGHT_SETS.night);
  built.retint(palette(false));
  read(LIGHT_SETS.day);
  built.retint(palette(true));
  read(LIGHT_SETS.night);
  built.dispose();
});

test('space and the dim dark sky use their own sets', async () => {
  const space = buildObjects(await graphOf(GALAXY), palette(true));
  assert.equal(named(space.root, 'key').intensity, LIGHT_SETS.space.key);
  space.dispose();
  const dim = buildObjects(await graphOf({ world: 'forest' }), palette(true));
  assert.equal(named(dim.root, 'key').intensity, LIGHT_SETS.dim.key);
  dim.dispose();
});

test('materials come from three named roles with distinct roughness', async () => {
  const worlds = [{}, GALAXY, { world: 'terrain' }];
  const seen = new Set();
  for (const overrides of worlds) {
    const built = buildObjects(await graphOf(overrides), palette(false));
    const materials = standardMaterials(built.root);
    assert.ok(materials.length > 0);
    for (const m of materials) {
      const role = m.userData.role;
      assert.ok(Object.hasOwn(MATERIAL_ROLES, role), `a material has the role ${JSON.stringify(role)}`);
      assert.equal(m.roughness, MATERIAL_ROLES[role].roughness, `${role} roughness`);
      assert.equal(m.metalness, MATERIAL_ROLES[role].metalness, `${role} metalness`);
      seen.add(role);
    }
    built.dispose();
  }
  for (const role of ['ground', 'mass', 'accent']) assert.ok(seen.has(role), `no material plays ${role}`);
  const { ground, mass, accent } = MATERIAL_ROLES;
  assert.ok(ground.roughness - mass.roughness >= 0.2 && mass.roughness - accent.roughness >= 0.2, 'the roles differ in roughness by at least 0.2 each');
});

test('fog starts in front of the far face of the scene and ends past it, in proportion to the extent', () => {
  const fit = 20;
  const diag = 12;
  const { near, far } = fogRange(fit, diag);
  assert.ok(near < fit && near > 0, 'fog starts in front of the fitted camera distance');
  assert.ok(far > fit + diag / 2, 'the far face of the scene is inside the fog range');
  assert.ok(far - near > diag, 'the range is wider than the scene, so the far face is hazed and not erased');
  const double = fogRange(2 * fit, 2 * diag);
  assert.equal(double.near, 2 * near);
  assert.equal(double.far, 2 * far);
});

test('the fog of a built scene follows the fitted camera distance and the extent', async () => {
  const graph = await graphOf({});
  const built = buildObjects(graph, palette(false));
  built.setFit(30);
  assert.deepEqual({ near: built.fog.near, far: built.fog.far }, fogRange(30, built.extent.diag));
  built.dispose();
});
