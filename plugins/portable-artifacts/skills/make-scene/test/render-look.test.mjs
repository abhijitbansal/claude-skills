// The scene's look: lights, materials, fog and the contact pool come from named constants (template/runtime/look.js).
// The guards state what a viewer must be able to see: a shaded face clearly darker than a lit one, a rim in every dark
// scene, materials that do not all look alike, a ground the masses stand on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Color, Vector3 } from 'three';
import { loadTheme } from '../shared/theme.mjs';
import { TOKEN_VARS } from '../template/runtime/colour.js';
import { LIGHT_SETS, MATERIAL_ROLES, MIN_FACE_RATIO, MIN_KEY_FILL_RATIO, fogRange, lightDirections, lightSetName, poolStyle } from '../template/runtime/look.js';
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

// ---- lights ---------------------------------------------------------------------------------------------------

const luminance = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const lightTowards = (light) => light.position.clone().sub(light.target.position).normalize();

/** Linear light reaching a face with this normal, from each light in the built scene (a Lambert surface, as three computes it). */
function irradiance(root, normal) {
  const n = new Vector3(...normal).normalize();
  const key = named(root, 'key');
  const rim = named(root, 'rim');
  const fill = named(root, 'fill');
  const ambient = root.children.find((c) => c.isAmbientLight);
  const sky = fill.groundColor.clone().lerp(fill.color, 0.5 * n.y + 0.5).multiplyScalar(fill.intensity);
  const out = {
    key: luminance(key.color) * key.intensity * Math.max(0, n.dot(lightTowards(key))),
    rim: luminance(rim.color) * rim.intensity * Math.max(0, n.dot(lightTowards(rim))),
    fill: luminance(sky) + luminance(ambient.color) * ambient.intensity,
  };
  return { ...out, total: out.key + out.rim + out.fill };
}

// The camera directions the examples start from (target -> camera): the city, forest, galaxy and terrain default
// (graph.mjs), the lifted dashboard and diagram (dashboard-frame.mjs, diagram-flat.mjs), and a diagram turned to look
// down its length on a phone (fit.js alignToStrip), along x and along z.
const CAMERAS = {
  default: [1, 0.8, 1],
  dashboard: [0.3, 0.75, 1],
  diagram: [0.15, 1.25, 1],
  'diagram, portrait': [0, 0.77, 1],
  'diagram, portrait along x': [1, 0.77, 0],
};

/** The faces a camera sees: the top, and every wall whose normal points at the camera (not edge-on). */
function visibleFaces(from) {
  const unit = new Vector3(...from).normalize();
  const faces = [['top', [0, 1, 0]]];
  for (const [name, n] of [['+x', [1, 0, 0]], ['-x', [-1, 0, 0]], ['+z', [0, 0, 1]], ['-z', [0, 0, -1]]]) {
    if (new Vector3(...n).dot(unit) >= 0.2) faces.push([name, n]);
  }
  return faces;
}

const FACE_FLOOR = { light: 0.5, dark: 0.3 }; // the dimmest visible face still gets this much linear light, so its colour stays readable

test('one light set per sky: space, night, dim and day', () => {
  assert.deepEqual(Object.keys(LIGHT_SETS).sort(), ['day', 'dim', 'night', 'space']);
  assert.equal(lightSetName({ sky: 'space' }, false), 'space');
  assert.equal(lightSetName({ sky: 'space', nightLights: true }, true), 'space');
  assert.equal(lightSetName({ sky: 'theme', nightLights: true }, true), 'night');
  assert.equal(lightSetName({ sky: 'theme', nightLights: true }, false), 'day');
  assert.equal(lightSetName({ sky: 'theme' }, true), 'dim');
  assert.equal(lightSetName({ sky: 'theme' }, false), 'day');
});

const hueOf = (hex) => new Color(hex).getHSL({}).h * 360;
const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('every set has a key and a fill in a clear ratio; every dark set has a rim in a hue off the key, and the day has none', () => {
  for (const [name, set] of Object.entries(LIGHT_SETS)) {
    assert.ok(set.key / set.fill >= MIN_KEY_FILL_RATIO, `${name}: key ${set.key} over fill ${set.fill} is under ${MIN_KEY_FILL_RATIO}:1`);
    if (name === 'day') {
      assert.equal(set.rim, null, 'the day has no rim');
      continue;
    }
    assert.ok(set.rim && set.rim.intensity >= 1, `${name} has a rim light`);
    const keyHex = typeof set.keyColour === 'string' ? set.keyColour : '#fff4e0'; // the sun is a warm white
    assert.ok(hueGap(hueOf(set.rim.colour), hueOf(keyHex)) >= 60, `${name}: the rim hue (${set.rim.colour}) is a clear step off the key (${keyHex})`);
  }
});

test('the lights in the scene carry the numbers of the set for the sky and mode', async () => {
  const graph = await graphOf({});
  const built = buildObjects(graph, palette(true));
  const read = (set) => {
    assert.equal(named(built.root, 'key').intensity, set.key);
    assert.equal(named(built.root, 'fill').intensity, set.fill);
    assert.equal(named(built.root, 'rim').intensity, set.rim?.intensity ?? 0);
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

test('the key and the rim stand relative to the camera: the key on its right, the rim on its left', () => {
  for (const [name, from] of Object.entries(CAMERAS)) {
    const { key, rim } = lightDirections(from);
    const flat = Math.hypot(from[0], from[2]);
    const right = [from[2] / flat, 0, -from[0] / flat];
    const side = (v) => v[0] * right[0] + v[2] * right[2];
    assert.ok(side(key) > 0.5, `${name}: the key rakes from the viewer's right (${side(key).toFixed(2)})`);
    assert.ok(side(rim) < -0.5, `${name}: the rim comes from the viewer's left (${side(rim).toFixed(2)})`);
    assert.ok(key[1] > 0.4 && rim[1] > 0.2, `${name}: both stand above the floor`);
  }
});

for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'}: seen from each camera, the brightest face is clearly brighter than the dimmest, which stays readable`, async () => {
    const graph = await graphOf({});
    const built = buildObjects(graph, palette(dark));
    for (const [name, from] of Object.entries(CAMERAS)) {
      built.aim(from.map((c, i) => c * 10 + graph.camera.target[i]));
      const faces = visibleFaces(from).map(([face, n]) => [face, irradiance(built.root, n).total]);
      const lit = Math.max(...faces.map((f) => f[1]));
      const shaded = Math.min(...faces.map((f) => f[1]));
      assert.ok(lit / shaded >= MIN_FACE_RATIO, `${name}: faces ${JSON.stringify(faces.map(([f, v]) => [f, +v.toFixed(2)]))} differ by ${(lit / shaded).toFixed(2)}:1, under ${MIN_FACE_RATIO}:1`);
      const floor = FACE_FLOOR[dark ? 'dark' : 'light'];
      assert.ok(shaded >= floor, `${name}: the dimmest visible face gets only ${shaded.toFixed(2)}, under ${floor}`);
    }
    built.dispose();
  });
}

test('in every dark world the rim edges the left limb of a rounded mass, where the key does not reach', async () => {
  for (const world of [{}, { world: 'forest' }, GALAXY, { world: 'terrain' }]) {
    const graph = await graphOf(world);
    const built = buildObjects(graph, palette(true));
    for (const [name, from] of Object.entries(CAMERAS)) {
      built.aim(from.map((c, i) => c * 10 + graph.camera.target[i]));
      const flat = Math.hypot(from[0], from[2]);
      const left = [-from[2] / flat, 0, from[0] / flat]; // the surface normal on the viewer's left limb of a sphere or trunk
      const seen = irradiance(built.root, left);
      assert.ok(seen.rim >= 0.6,`${JSON.stringify(world)} ${name}: the rim gives the left limb only ${seen.rim.toFixed(2)}`);
      assert.ok(seen.key < 0.3 * seen.rim, `${JSON.stringify(world)} ${name}: the key (${seen.key.toFixed(2)}) already lights the limb the rim edges`);
    }
    built.dispose();
  }
});

test('in dark the boxes carry an edge band in the rim colour; in light they carry none', async () => {
  const graph = await graphOf({});
  const built = buildObjects(graph, palette(true));
  const edged = [];
  built.root.traverse((o) => { if (o.isInstancedMesh && o.geometry.type === 'BoxGeometry') edged.push(o.material.userData.rim); });
  assert.ok(edged.length > 0 && edged.every(Boolean), 'every city box batch has an edge band');
  const rim = new Color(LIGHT_SETS.night.rim.colour);
  for (const e of edged) {
    assert.ok(e.strength.value >= 0.5, `the band is strong enough to see (${e.strength.value})`);
    assert.ok(e.width.value >= 0.025, 'and wide enough to show');
    assert.ok(Math.abs(e.colour.r - rim.r) + Math.abs(e.colour.g - rim.g) + Math.abs(e.colour.b - rim.b) < 0.02, 'in the rim colour of the night set');
  }
  built.retint(palette(false));
  for (const e of edged) assert.equal(e.strength.value, 0, 'by day there is no edge band');
  built.dispose();
});

test('in dark every curved surface carries a fresnel rim in the rim colour; in light none', async () => {
  for (const world of [{ world: 'forest' }, GALAXY, { world: 'terrain' }]) {
    const built = buildObjects(await graphOf(world), palette(true));
    const curved = [];
    built.root.traverse((o) => {
      if (o.isMesh && o.visible && o.material.isMeshStandardMaterial && o.geometry.type !== 'CircleGeometry' && o.geometry.type !== 'BoxGeometry') curved.push(o.material);
    });
    assert.ok(curved.length > 0, `${JSON.stringify(world)} has curved surfaces`);
    const set = LIGHT_SETS[world.world === 'forest' || world.world === 'terrain' ? 'dim' : 'space'];
    const rim = new Color(set.rim.colour);
    for (const m of curved) {
      const r = m.userData.rim;
      assert.ok(r, `${JSON.stringify(world)}: a ${m.userData.role} surface has no rim`);
      assert.ok(r.strength.value >= 0.5, `${JSON.stringify(world)}: its rim is ${r.strength.value}, too faint to see`);
      assert.ok(Math.abs(r.colour.r - rim.r) + Math.abs(r.colour.g - rim.g) + Math.abs(r.colour.b - rim.b) < 0.02, 'in the rim colour of the set');
    }
    built.retint(palette(false));
    const space = world === GALAXY; // a space sky is dark in light mode too
    for (const m of curved) assert.equal(m.userData.rim.strength.value > 0, space, space ? 'space keeps its rim in light mode' : 'by day there is no rim');
    built.dispose();
  }
});

// ---- materials ------------------------------------------------------------------------------------------------

test('materials come from named roles with distinct roughness', async () => {
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
  for (const role of ['ground', 'mass', 'accent', 'body']) assert.ok(seen.has(role), `no material plays ${role}`);
  const { ground, mass, accent, body } = MATERIAL_ROLES;
  assert.ok(ground.roughness - mass.roughness >= 0.4, 'a mass has a clear sheen against the matte ground (0.4 less rough)');
  assert.ok(mass.roughness - accent.roughness >= 0.2, 'an accent is clearly glossier than a mass');
  assert.ok(body.roughness >= 0.8, 'a self-lit body is rough enough to shade as a smooth ball');
});

test('a self-lit sphere has the body role, so it shades as a ball and carries no white point highlight', async () => {
  const built = buildObjects(await graphOf(GALAXY), palette(true));
  const spheres = [];
  built.root.traverse((o) => { if (o.isInstancedMesh && o.geometry.type === 'SphereGeometry' && o.material.emissive.getHex() !== 0) spheres.push(o); });
  assert.ok(spheres.length > 0, 'the galaxy has self-lit spheres');
  for (const s of spheres) {
    assert.equal(s.material.userData.role, 'body');
    assert.ok(s.material.roughness >= 0.8, `roughness ${s.material.roughness} is too glossy: a point highlight shows`);
  }
  built.dispose();
});

// ---- fog and the contact pool ---------------------------------------------------------------------------------

test('fog starts behind the middle of the scene and ends past it, in proportion to the extent', () => {
  const fit = 20;
  const diag = 12;
  const { near, far } = fogRange(fit, diag);
  assert.ok(near >= fit, 'fog does not start until the fitted camera distance, so no mass is hazed on its near half');
  assert.ok(near < fit + diag / 2, 'it starts before the far face of the scene, so depth still reads');
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

test('masses stand in a pool of light on the ground, in light and in dark where there are windows', async () => {
  const city = buildObjects(await graphOf({}), palette(false));
  const pool = named(city.root, 'pool');
  assert.ok(pool, 'the city has a contact pool');
  const footprint = Math.hypot(city.extent.size.x, city.extent.size.z) / 2;
  assert.ok(pool.geometry.parameters.radius >= footprint, 'the pool reaches past the foot of the masses');
  const apart = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  assert.ok(apart(pool.material.color, city.background) >= 0.1, 'in light the pool is a warm tint off the page');
  assert.ok(pool.material.opacity >= 0.5, 'and strong enough to see');
  city.retint(palette(true));
  assert.ok(pool.material.opacity >= 0.25, 'at night the windows spill a pool of their own');
  assert.ok(luminance(pool.material.color) - luminance(city.background) >= 0.1, 'lighter than the dark page');
  city.dispose();
  const forest = buildObjects(await graphOf({ world: 'forest' }), palette(true));
  assert.equal(named(forest.root, 'pool').material.opacity, 0, 'a forest at night has no windows to light a pool');
  assert.equal(poolStyle({ nightLights: false }, true).opacity, 0);
  forest.dispose();
});
