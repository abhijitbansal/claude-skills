import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedFrom } from '../shared/art.mjs';
import { WORLDS } from '../scripts/worlds/index.mjs';
import { assertGraph } from '../scripts/lib/graph.mjs';
import { TRUNK_RADIUS, LIMB_LEN } from '../scripts/worlds/forest.mjs';

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const SPEC = { title: 'Work per area', units: 'tasks' };

// 5 groups x 6 weeks; auth nests under api and docs under web (forest only).
const GROUPS = ['api', 'web', 'db', 'auth', 'docs'];
const PARENT = { auth: 'api', docs: 'web' };
const WEEKS = Array.from({ length: 6 }, (_, i) => `2026-W${String(i + 20).padStart(2, '0')}`);
const fixture = () => ({
  rows: GROUPS.flatMap((group) =>
    WEEKS.map((t) => ({ group, t, value: seedFrom(`${group}|${t}`) % 30, ...(PARENT[group] ? { parent: PARENT[group] } : {}) })),
  ),
  links: [{ from: 'api', to: 'web', value: 6 }, { from: 'web', to: 'db', value: 2 }, { from: 'db', to: 'docs' }],
});

const finite = (g) => {
  const bad = [];
  const walk = (v, p) => {
    if (typeof v === 'number' && !Number.isFinite(v)) bad.push(p);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
  };
  walk(g, 'graph');
  return bad;
};

const layout = (g) => '{\n' + Object.keys(g).map((k) => ` ${JSON.stringify(k)}: ${JSON.stringify(g[k])}`).join(',\n') + '\n}\n';
const instances = (g, pick) => g.batches.filter(pick).flatMap((b) => b.instances);
const leafOf = (g, i) => instances(g, (b) => b.shape === 'icosa').find((inst) => inst[6] === i);
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);

for (const world of ['forest', 'galaxy']) {
  test(`${world} golden`, () => {
    const file = path.join(GOLDEN_DIR, `${world}.json`);
    const graph = WORLDS[world](fixture(), SPEC);
    assertGraph(graph);
    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(GOLDEN_DIR, { recursive: true });
      fs.writeFileSync(file, layout(graph));
    }
    assert.deepEqual(JSON.parse(JSON.stringify(graph)), JSON.parse(fs.readFileSync(file, 'utf8')));
  });

  test(`${world}: same input same graph`, () => {
    assert.equal(JSON.stringify(WORLDS[world](fixture(), SPEC)), JSON.stringify(WORLDS[world](fixture(), SPEC)));
  });

  test(`${world}: degenerate data yields finite graph`, () => {
    const cases = {
      'one row': [{ group: 'a', t: '2026-W01', value: 5 }],
      'one group': [1, 2, 3].map((n) => ({ group: 'a', t: n, value: n })),
      'all zeros': [{ group: 'a', t: 1, value: 0 }, { group: 'b', t: 1, value: 0 }, { group: 'a', t: 2, value: 0 }],
    };
    for (const [name, rows] of Object.entries(cases)) {
      const g = WORLDS[world]({ rows, links: [] }, SPEC);
      assert.deepEqual(finite(g), [], name);
      assertGraph(g);
      assert.equal(g.items.length, rows.length, name);
      assert.ok(g.batches.some((b) => b.instances.some((inst) => inst[3] > 0 && inst[4] > 0 && inst[5] > 0)), `${name}: a visible marker`);
    }
  });

  test(`${world}: every item reachable, with or without t`, () => {
    const sparse = fixture().rows.filter((_, i) => i % 7 !== 3);
    const noT = fixture().rows.map(({ t, ...rest }) => rest);
    for (const rows of [fixture().rows, sparse, noT]) {
      const g = WORLDS[world]({ rows, links: [] }, SPEC);
      const seen = new Set(g.batches.flatMap((b) => b.instances.map((inst) => inst[6])));
      for (let i = 0; i < g.items.length; i++) assert.ok(seen.has(i), `${world} item ${i}`);
    }
  });

  test(`${world}: hostile and long labels pass through as plain strings`, () => {
    const name = '<img src=x onerror=alert(1)>'.padEnd(48, 'x');
    const g = WORLDS[world]({ rows: [{ group: name, t: 1, value: 3, label: '😀 <b>' }], links: [] }, SPEC);
    assert.equal(g.groups[0].name, name);
    assert.equal(g.items[0].label, '😀 <b>');
    assert.ok(Object.keys(g.focus).includes(name.toLowerCase()));
    assert.ok(g.labels.some((l) => l.text === name));
  });

  test(`${world}: group names that collide with Object keys still get focus`, () => {
    const rows = ['constructor', 'toString', 'hasOwnProperty'].map((group) => ({ group, t: 1, value: 2 }));
    const g = WORLDS[world]({ rows, links: [] }, SPEC);
    for (const { name } of g.groups) assert.ok(Object.hasOwn(g.focus, name.toLowerCase()), name);
  });

  test(`${world}: data fallback table, empty tour, one view per group`, () => {
    const g = WORLDS[world](fixture(), SPEC);
    assert.deepEqual(g.tour, []);
    assert.deepEqual(g.fallback.columns, ['group', 't', 'value']);
    assert.equal(g.fallback.rows.length, 30);
    for (const name of GROUPS) assert.ok(g.focus[name], `focus ${name}`);
    assert.equal(g.kind, world);
  });
}

test('forest and galaxy are registered', () => {
  assert.deepEqual(Object.keys(WORLDS), ['city', 'forest', 'galaxy', 'terrain']);
});

// ---- forest ----

test('forest: leaf cluster size is 0.15 + value/max * 0.95 and sway lists the leaf batches', () => {
  const rows = [{ group: 'a', t: 1, value: 0 }, { group: 'a', t: 2, value: 10 }, { group: 'a', t: 3, value: 40 }];
  const g = WORLDS.forest({ rows, links: [] }, SPEC);
  const size = (i) => leafOf(g, i)[3];
  assert.ok(Math.abs(size(0) - 0.15) < 1e-3, 'zero still draws the minimum cluster');
  assert.ok(Math.abs(size(1) - (0.15 + 0.25 * 0.95)) < 1e-3);
  assert.ok(Math.abs(size(2) - 1.1) < 1e-3, 'the largest is 0.15 + 0.95');
  const leafIds = g.batches.filter((b) => b.shape === 'icosa').map((b) => b.id);
  assert.deepEqual(g.anim.sway, leafIds);
  assert.ok(leafIds.length > 0);
  assert.deepEqual(g.anim.orbits, []);
});

test('forest: trunks and branches are decoration (item -1), leaves carry the data', () => {
  const g = WORLDS.forest(fixture(), SPEC);
  for (const b of g.batches) {
    const ids = new Set(b.instances.map((inst) => inst[6]));
    if (b.shape === 'icosa') assert.ok(!ids.has(-1), `leaf batch ${b.id}`);
    else assert.deepEqual([...ids], [-1], `decoration batch ${b.id}`);
  }
  const trunks = instances(g, (b) => b.shape === 'cylinder');
  assert.equal(trunks.length, GROUPS.length, 'one stem per group');
  assert.ok(g.env.ground, 'a meadow');
  assert.equal(g.env.sky, 'theme');
});

test('forest: root groups stand on a ring, one tree each', () => {
  const g = WORLDS.forest(fixture(), SPEC);
  const stems = instances(g, (b) => b.shape === 'cylinder'); // group order: api, web, db, auth, docs
  const roots = [stems[0], stems[1], stems[2]];
  const centre = [0, 0, 0];
  const radii = roots.map((s) => horizontal(s, centre));
  assert.ok(radii[0] > 1);
  for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 1e-2, 'same ring radius');
  assert.ok(horizontal(roots[0], roots[1]) > 3, 'trees are apart');
});

test('forest: parent nests under its tree', () => {
  const g = WORLDS.forest(fixture(), SPEC);
  const stems = instances(g, (b) => b.shape === 'cylinder');
  const [api, , , auth] = stems;
  const trunkRadius = api[3] / 2;
  const apiLeaves = g.items.map((it, i) => [it, i]).filter(([it]) => it.group === 0).map(([, i]) => leafOf(g, i));
  const treeRadius = Math.max(...apiLeaves.map((l) => horizontal(l, api)));
  const apiTop = api[1] + api[4] / 2;
  // the one decoration sphere touching the api trunk is where auth's limb attaches
  const attach = instances(g, (b) => b.shape === 'sphere').filter((s) => horizontal(s, api) <= trunkRadius + 1e-3);
  assert.equal(attach.length, 1, 'one limb leaves the api trunk');
  assert.ok(horizontal(attach[0], api) <= treeRadius, 'attachment lies inside the parent tree radius');
  assert.ok(attach[0][1] > 0 && attach[0][1] < apiTop, 'at a height on the parent trunk');
  const stemBase = [auth[0], auth[1] - auth[4] / 2, auth[2]];
  assert.ok(Math.abs(horizontal(stemBase, api) - (TRUNK_RADIUS + LIMB_LEN)) < 1e-2, 'the sub-trunk stands at the end of the limb');
  assert.ok(Math.abs(stemBase[1] - attach[0][1]) < 0.5, 'and at about the attachment height');
  // every child leaf is nearer its parent trunk than any other root trunk
  const authLeaves = g.items.map((it, i) => [it, i]).filter(([it]) => it.group === 3).map(([, i]) => leafOf(g, i));
  for (const leaf of authLeaves) for (const other of [stems[1], stems[2]]) assert.ok(horizontal(leaf, api) < horizontal(leaf, other));
});

test('forest: a child group does not become its own ring tree', () => {
  const g = WORLDS.forest(fixture(), SPEC);
  const stems = instances(g, (b) => b.shape === 'cylinder');
  const [api, web, db, auth, docs] = stems;
  const ringRadius = horizontal(api, [0, 0, 0]);
  for (const root of [api, web, db]) assert.ok(Math.abs(horizontal(root, [0, 0, 0]) - ringRadius) < 1e-2);
  assert.ok(Math.abs(horizontal(auth, [0, 0, 0]) - ringRadius) > 0.5, 'auth hangs off api, not on the ring');
  assert.ok(Math.abs(horizontal(docs, [0, 0, 0]) - ringRadius) > 0.5);
  assert.ok(auth[4] < api[4], 'a sub-branch is a smaller trunk');
});

test('forest: grandchildren grow from the child', () => {
  const rows = [
    { group: 'a', t: 1, value: 3 }, { group: 'b', t: 1, value: 3, parent: 'a' }, { group: 'c', t: 1, value: 3, parent: 'b' },
  ];
  const g = WORLDS.forest({ rows, links: [] }, SPEC);
  assertGraph(g);
  const [a, b, c] = instances(g, (x) => x.shape === 'cylinder');
  assert.ok(horizontal(b, a) > 0.5 && horizontal(c, b) > 0.5);
  assert.ok(b[1] - b[4] / 2 > a[1] - a[4] / 2, 'child base above parent base');
  assert.ok(c[1] - c[4] / 2 > b[1] - b[4] / 2, 'grandchild base above child base');
});

test('forest: branches spiral up by t order, or row order without t', () => {
  const byT = WORLDS.forest({ rows: [{ group: 'a', t: 2, value: 1 }, { group: 'a', t: 1, value: 1 }, { group: 'a', t: 3, value: 1 }], links: [] }, SPEC);
  assert.ok(leafOf(byT, 1)[1] < leafOf(byT, 0)[1] && leafOf(byT, 0)[1] < leafOf(byT, 2)[1], 't order, lowest at the bottom');
  const noT = WORLDS.forest({ rows: [{ group: 'a', value: 9 }, { group: 'a', value: 1 }, { group: 'a', value: 5 }], links: [] }, SPEC);
  assert.ok(leafOf(noT, 0)[1] < leafOf(noT, 1)[1] && leafOf(noT, 1)[1] < leafOf(noT, 2)[1], 'row order');
  const ys = new Set([0, 1, 2].map((i) => leafOf(noT, i)[1]));
  assert.equal(ys.size, 3);
  const angles = [0, 1, 2].map((i) => Math.atan2(leafOf(noT, i)[2], leafOf(noT, i)[0]));
  assert.equal(new Set(angles.map((a) => a.toFixed(2))).size, 3, 'branches spiral, never stack');
});

test('forest: focus has every group and row label, lowercased', () => {
  const rows = [{ group: 'Oak', t: 1, value: 2, label: 'Big Leaf' }, { group: 'Pine', t: 1, value: 3 }];
  const g = WORLDS.forest({ rows, links: [] }, SPEC);
  assert.deepEqual(Object.keys(g.focus).sort(), ['big leaf', 'oak', 'pine']);
});

// ---- galaxy ----

test('galaxy: sky is space with stars; one emissive star per group, stars on a ring', () => {
  const g = WORLDS.galaxy(fixture(), SPEC);
  assert.equal(g.env.sky, 'space');
  assert.equal(g.env.stars, true);
  const stars = g.batches.filter((b) => b.emissive !== null);
  assert.equal(stars.length, GROUPS.length);
  for (const b of stars) assert.deepEqual(b.instances.map((i) => i[6]), [-1], 'a star is decoration');
  const centres = stars.map((b) => b.instances[0]);
  const radii = centres.map((c) => horizontal(c, [0, 0, 0]));
  for (const r of radii) assert.ok(Math.abs(r - radii[0]) < 1e-2 && r > 1);
});

test('galaxy: orbit radius follows t rank', () => {
  const rows = [{ group: 'a', t: 30, value: 1 }, { group: 'a', t: 10, value: 1 }, { group: 'a', t: 20, value: 1 }];
  const g = WORLDS.galaxy({ rows, links: [] }, SPEC);
  const orbit = g.anim.orbits[0];
  const batch = g.batches.find((b) => b.id === orbit.batch);
  const radiusOf = (item) => orbit.r[batch.instances.findIndex((inst) => inst[6] === item)];
  assert.ok(Math.abs(radiusOf(1) - 1.4) < 1e-3, 'lowest t is innermost: 1.4 + 0 * 0.32');
  assert.ok(Math.abs(radiusOf(2) - 1.72) < 1e-3);
  assert.ok(Math.abs(radiusOf(0) - 2.04) < 1e-3);
});

test('galaxy: without t, orbit radius follows value rank (largest innermost)', () => {
  const rows = [{ group: 'a', value: 1 }, { group: 'a', value: 9 }, { group: 'a', value: 4 }];
  const g = WORLDS.galaxy({ rows, links: [] }, SPEC);
  const orbit = g.anim.orbits[0];
  const batch = g.batches.find((b) => b.id === orbit.batch);
  const radiusOf = (item) => orbit.r[batch.instances.findIndex((inst) => inst[6] === item)];
  assert.ok(radiusOf(1) < radiusOf(2) && radiusOf(2) < radiusOf(0));
});

test('galaxy: orbit arrays are per instance, speed is 0.9/sqrt(r), phases are seeded', () => {
  const g = WORLDS.galaxy(fixture(), SPEC);
  const again = WORLDS.galaxy(fixture(), SPEC);
  assert.deepEqual(g.anim.orbits, again.anim.orbits);
  assert.equal(g.anim.orbits.length, GROUPS.length, 'one orbit entry per planet batch');
  for (const orbit of g.anim.orbits) {
    const batch = g.batches.find((b) => b.id === orbit.batch);
    assert.equal(orbit.r.length, batch.instances.length);
    assert.equal(orbit.phase.length, batch.instances.length);
    assert.equal(orbit.speed.length, batch.instances.length);
    assert.equal(orbit.center.length, 3);
    orbit.r.forEach((r, k) => {
      assert.ok(Math.abs(orbit.speed[k] - 0.9 / Math.sqrt(r)) < 2e-3);
      // the stored position is the orbit position at time 0
      const inst = batch.instances[k];
      assert.ok(Math.abs(inst[0] - (orbit.center[0] + r * Math.cos(orbit.phase[k]))) < 5e-3);
      assert.ok(Math.abs(inst[2] - (orbit.center[2] + r * Math.sin(orbit.phase[k]))) < 5e-3);
    });
    assert.ok(new Set(orbit.phase).size > 1, 'phases differ');
  }
});

test('galaxy: planet size is 0.06 + value/max * 0.32', () => {
  const rows = [{ group: 'a', t: 1, value: 0 }, { group: 'a', t: 2, value: 10 }, { group: 'a', t: 3, value: 40 }];
  const g = WORLDS.galaxy({ rows, links: [] }, SPEC);
  const planets = g.batches.find((b) => b.emissive === null).instances;
  const size = (i) => planets.find((inst) => inst[6] === i)[3];
  assert.ok(Math.abs(size(0) - 0.06) < 1e-3);
  assert.ok(Math.abs(size(1) - (0.06 + 0.25 * 0.32)) < 1e-3);
  assert.ok(Math.abs(size(2) - 0.38) < 1e-3);
});

test('galaxy: links become tubes between stars', () => {
  const g = WORLDS.galaxy(fixture(), SPEC);
  assert.equal(g.tubes.length, 3);
  const starAt = (name) => g.batches.filter((b) => b.emissive !== null)[GROUPS.indexOf(name)].instances[0];
  const [first] = g.tubes;
  assert.deepEqual(first.points[0], starAt('api').slice(0, 3));
  assert.deepEqual(first.points.at(-1), starAt('web').slice(0, 3));
  assert.equal(first.item, null);
  const distance = horizontal(starAt('api'), starAt('web'));
  const apex = Math.max(...first.points.map((p) => p[1]));
  assert.ok(Math.abs(apex - (1 + distance * 0.15)) < 0.02, 'arc rises by 1 + distance * 0.15');
  const ids = g.tubes.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(g.tubes[0].radius > g.tubes[1].radius, 'value 6 draws a thicker tube than value 2');
  assert.ok(g.tubes[2].radius > 0, 'a link without value still draws');
  for (const t of g.tubes) assert.ok(t.points.length >= 3);
});

test('galaxy: a link from a group to itself is skipped, no links means no tubes', () => {
  const rows = [{ group: 'a', t: 1, value: 1 }, { group: 'b', t: 1, value: 1 }];
  assert.equal(WORLDS.galaxy({ rows, links: [{ from: 'a', to: 'a' }] }, SPEC).tubes.length, 0);
  assert.equal(WORLDS.galaxy({ rows, links: [] }, SPEC).tubes.length, 0);
});

test('galaxy: the default camera frames the whole orbit disc', () => {
  const g = WORLDS.galaxy(fixture(), SPEC);
  const reach = Math.max(...g.anim.orbits.map((o) => Math.max(...o.r)));
  const dist = Math.hypot(...g.camera.position.map((p, a) => p - g.camera.target[a]));
  assert.ok(dist > reach, 'camera sits outside every orbit');
});
