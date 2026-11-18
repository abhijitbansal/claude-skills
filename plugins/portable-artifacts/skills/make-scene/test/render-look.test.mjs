// The scene's look: lights, materials, fog and the contact pool come from named constants (template/runtime/look.js).
// The guards state what a viewer must be able to see: a shaded face clearly darker than a lit one, a rim in every dark
// scene, materials that do not all look alike, a ground the masses stand on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Color, Vector3 } from 'three';
import { loadTheme } from '../shared/theme.mjs';
import { TOKEN_VARS, resolveColour } from '../template/runtime/colour.js';
import { CONTACT, FRESNEL, LIGHT_SETS, MATERIAL_ROLES, MIN_FACE_RATIO, MIN_KEY_FILL_RATIO, WATER_DARK_LEVEL, contactFootings, fogRange, lightDirections, lightSetName, poolStyle } from '../template/runtime/look.js';
import { buildObjects } from '../template/runtime/render.js';
import { buildScene } from '../scripts/lib/api.mjs';
import { emptyGraph, finalizeGraph } from '../scripts/lib/graph.mjs';
import { citySpec } from './helpers/scene-fixtures.mjs';

const theme = loadTheme('dusk');
const VAR_TOKEN = Object.fromEntries(Object.entries(TOKEN_VARS).map(([token, cssVar]) => [cssVar, token]));
const paletteOf = (themeData, dark) => ({ dark, readVar: (cssVar) => themeData[dark ? 'dark' : 'light'][VAR_TOKEN[cssVar]] });
const palette = (dark) => paletteOf(theme, dark);
/** A colour reference of a light set (a hex or a { base, tint, share }) as the scene resolves it in a theme and mode. */
const resolved = (ref, themeData, dark) => new Color(resolveColour(ref, paletteOf(themeData, dark).readVar));

async function graphOf(overrides, themeData = theme) {
  return (await buildScene(citySpec(overrides), { dir: process.cwd(), theme: themeData })).graph;
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

const FACE_FLOOR = { light: 0.5, dark: 0.1 }; // the dimmest visible face still gets this much linear light, so its colour stays readable (dark: low, because the shaded wall must differ in value, not only in hue)

test('one light set per sky: space, night, dim and day', () => {
  assert.deepEqual(Object.keys(LIGHT_SETS).sort(), ['day', 'dim', 'night', 'space']);
  assert.equal(lightSetName({ sky: 'space' }, false), 'space');
  assert.equal(lightSetName({ sky: 'space', nightLights: true }, true), 'space');
  assert.equal(lightSetName({ sky: 'theme', nightLights: true }, true), 'night');
  assert.equal(lightSetName({ sky: 'theme', nightLights: true }, false), 'day');
  assert.equal(lightSetName({ sky: 'theme' }, true), 'dim');
  assert.equal(lightSetName({ sky: 'theme' }, false), 'day');
});

const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

test('every set has a key and a fill in a clear ratio; every dark set has a rim in a hue off the key, and the day has none', () => {
  for (const [name, set] of Object.entries(LIGHT_SETS)) {
    assert.ok(set.key / set.fill >= MIN_KEY_FILL_RATIO, `${name}: key ${set.key} over fill ${set.fill} is under ${MIN_KEY_FILL_RATIO}:1`);
    if (name === 'day') {
      assert.equal(set.rim, null, 'the day has no rim');
      continue;
    }
    assert.ok(set.rim && set.rim.intensity >= 1, `${name} has a rim light`);
    const [rim, key] = [resolved(set.rim.colour, theme, true), resolved(set.keyColour, theme, true)];
    assert.ok(hueGap(rim.getHSL({}).h * 360, key.getHSL({}).h * 360) >= 60, `${name}: the rim hue is a clear step off the key`);
  }
});

test('the rim of a lit-window city is the theme\'s own light, so it matches the windows and clashes with no tower colour', () => {
  assert.equal(LIGHT_SETS.night.rim.colour.tint, 'glow', 'built from the theme glow');
  assert.ok(LIGHT_SETS.night.rim.colour.share >= 0.5, 'mostly the glow');
  for (const name of ['dusk', 'paper', 'poster']) {
    const themeData = loadTheme(name);
    const rim = resolved(LIGHT_SETS.night.rim.colour, themeData, true);
    const hsl = rim.getHSL({});
    assert.ok(hsl.l >= 0.55, `${name}: the rim is a light (lightness ${hsl.l.toFixed(2)}), not a dark colour that fights a tower`);
    const glow = resolved('glow', themeData, true);
    assert.ok(hueGap(hsl.h * 360, glow.getHSL({}).h * 360) <= 45 || glow.getHSL({}).s < 0.25, `${name}: the rim keeps the hue of the windows' glow`);
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
    assert.ok(key[1] > 0.4 && rim[1] > 0.15, `${name}: both stand above the floor`);
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

// The two walls a camera sees differ in value, not only in hue: the one turned from the key gets a third of the light of the one
// turned to it (the top is excluded: it is lit by design, and the tests above cover it).
const WALL_RATIO = { light: 2.5, dark: 3 };

for (const name of ['dusk', 'paper', 'poster']) {
  for (const dark of [false, true]) {
    test(`${name}, ${dark ? 'dark' : 'light'}: the shaded wall gets a clear fraction of the light the lit wall gets`, async () => {
      const themeData = loadTheme(name);
      const graph = await graphOf({}, themeData);
      const built = buildObjects(graph, paletteOf(themeData, dark));
      const from = CAMERAS.default;
      built.aim(from.map((c, i) => c * 10 + graph.camera.target[i]));
      const walls = visibleFaces(from).filter(([face]) => face !== 'top').map(([face, n]) => [face, irradiance(built.root, n).total]);
      assert.equal(walls.length, 2, 'the default camera sees two walls');
      const ratio = Math.max(...walls.map((w) => w[1])) / Math.min(...walls.map((w) => w[1]));
      const need = WALL_RATIO[dark ? 'dark' : 'light'];
      assert.ok(ratio >= need, `${JSON.stringify(walls.map(([f, v]) => [f, +v.toFixed(2)]))}: ${ratio.toFixed(2)}:1, under ${need}:1`);
      built.dispose();
    });
  }
}

test('in dark the rim light does not flood level ground: an upward face gets at most 15% of its light from the rim', async () => {
  for (const world of [{ world: 'terrain' }, {}]) {
    const built = buildObjects(await graphOf(world), palette(true));
    const seen = irradiance(built.root, [0, 1, 0]);
    assert.ok(seen.rim <= 0.15 * seen.total, `${JSON.stringify(world)}: the rim gives level ground ${(seen.rim / seen.total * 100).toFixed(0)}% of its light`);
    built.dispose();
  }
});

test('at night the sea is a step darker than the land, so the land is what the eye goes to', async () => {
  const built = buildObjects(await graphOf({ world: 'terrain' }), palette(true));
  const water = built.root.children.find((o) => o.material?.userData.role === 'water');
  const land = built.root.children.find((o) => o.userData.kind === 'surface');
  assert.ok(water && land, 'the terrain has a sea and a surface');
  const colours = land.geometry.getAttribute('color');
  const meanLand = Array.from({ length: colours.count }, (_, i) => luminance({ r: colours.getX(i), g: colours.getY(i), b: colours.getZ(i) })).reduce((a, b) => a + b, 0) / colours.count;
  assert.ok(luminance(water.material.color) <= 0.35 * meanLand, `the sea (${luminance(water.material.color).toFixed(3)}) is not clearly darker than the land (${meanLand.toFixed(3)})`);
  assert.ok(WATER_DARK_LEVEL < 1);
  built.dispose();
});

test('land takes the rim colour only along its outline: level ground seen from the default camera gets almost none', async () => {
  const graph = await graphOf({ world: 'terrain' });
  const built = buildObjects(graph, palette(true));
  const land = built.root.children.find((o) => o.userData.kind === 'surface');
  const rim = land.material.userData.rim;
  const from = CAMERAS.default;
  const facing = from[1] / Math.hypot(...from); // the cosine between an upward normal and the line to the camera
  const flat = rim.strength.value * (1 - facing) ** rim.power;
  assert.ok(flat <= 0.02, `level ground gets ${flat.toFixed(3)} of the rim colour added`);
  const edge = rim.strength.value * (1 - 0.05) ** rim.power;
  assert.ok(edge >= 0.3, `and the outline (facing 0.05) gets ${edge.toFixed(2)}, enough to show`);
  built.dispose();
});

test('in every dark world the rim edges the left limb of a rounded mass, where the key does not reach', async () => {
  for (const world of [{}, { world: 'forest' }, GALAXY, { world: 'terrain' }]) {
    const graph = await graphOf(world);
    const built = buildObjects(graph, palette(true));
    for (const [name, from] of Object.entries(CAMERAS)) {
      built.aim(from.map((c, i) => c * 10 + graph.camera.target[i]));
      const flat = Math.hypot(from[0], from[2]);
      const left = [-from[2] / flat, 0, from[0] / flat]; // the surface normal on the viewer's left limb of a sphere or trunk
      const seen = irradiance(built.root, left);
      assert.ok(seen.rim >= 0.5, `${JSON.stringify(world)} ${name}: the rim gives the left limb only ${seen.rim.toFixed(2)}`);
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
  const rim = resolved(LIGHT_SETS.night.rim.colour, theme, true);
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
    const rim = resolved(set.rim.colour, theme, true);
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

// ---- the contact glow of a lifted chart or diagram ---------------------------------------------------------------

function liftedGraph(kind, instances) {
  const g = emptyGraph(kind, { title: 'lifted' });
  g.groups = [{ name: 'g', colour: 'cat1' }];
  g.items = instances.filter((i) => i[6] >= 0).map((_, n) => ({ id: `i${n}`, label: `n${n}`, group: 0, value: n, display: `${n}` }));
  g.batches = [{ id: 'b0', shape: 'box', colour: 'cat1', emissive: null, flat: false, instances }];
  return finalizeGraph(g);
}

const FLOOR = [0, -0.05, 0, 14, 0.1, 8, -1]; // the floor slab: not a mass
const BAR = [-3, 1, 0, 1, 2, 1, 0]; // stands on the floor
const BAR_ON_BAR = [-3, 3, 0, 1, 2, 1, 1]; // a stacked segment: stands on the bar below, not on the floor

test('a lifted chart puts a contact disc under each bar that stands on the floor, and under no floor, rule or stacked segment', () => {
  const feet = contactFootings(liftedGraph('chart', [FLOOR, BAR, BAR_ON_BAR]));
  assert.equal(feet.length, 1);
  assert.deepEqual([feet[0].x, feet[0].y, feet[0].z], [-3, 0, 0]);
  assert.ok(feet[0].r >= 0.5 * CONTACT.reach, 'the disc reaches clear past the foot of the bar');
});

test('a lifted diagram puts one contact disc under each node, however many slabs it is stacked from', () => {
  const slabs = [0, 1, 2].map((k) => [2, 0.1 + 0.15 * k, 1, 2, 0.1, 1, 4]); // one item, three slabs
  const feet = contactFootings(liftedGraph('diagram', [[0, 0.1, 0, 2, 0.2, 1, 3], ...slabs]));
  assert.equal(feet.length, 2);
  assert.ok(feet.some((f) => f.x === 2 && Math.abs(f.y - 0.05) < 1e-9), 'under the lowest slab');
});

test('a city and a forest draw no per-mass contact discs: they have their pool', async () => {
  assert.deepEqual(contactFootings(await graphOf({})), []);
  assert.deepEqual(contactFootings(await graphOf({ world: 'forest' })), []);
});

for (const dark of [false, true]) {
  test(`${dark ? 'dark' : 'light'}: the scene draws the contact discs of a lifted chart, strong enough to see`, () => {
    const graph = liftedGraph('chart', [FLOOR, BAR, [3, 0.5, 0, 1, 1, 1, 1]]);
    const built = buildObjects(graph, palette(dark));
    const discs = named(built.root, 'contact');
    assert.ok(discs, 'a contact mesh');
    assert.equal(discs.count, 2);
    const c = discs.material.color;
    const b = built.background;
    const apart = Math.abs(c.r - b.r) + Math.abs(c.g - b.g) + Math.abs(c.b - b.b);
    assert.ok(discs.material.opacity * apart >= 0.12, `a disc of opacity ${discs.material.opacity} and colour ${apart.toFixed(2)} off the page does not show`);
    assert.ok(discs.material.transparent && !discs.material.depthWrite, 'it blends and never hides what is behind it');
    built.dispose();
  });
}

test('a graph with no lifted masses has no contact mesh', async () => {
  const built = buildObjects(await graphOf({}), palette(true));
  assert.equal(named(built.root, 'contact'), undefined);
  built.dispose();
});

test('every named look constant this file reads exists', () => {
  assert.ok(FRESNEL.groundPower > FRESNEL.power, 'land has a tighter rim than a rounded mass');
});
