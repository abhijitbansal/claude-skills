import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedFrom } from '../shared/art.mjs';
import { WORLDS } from '../scripts/worlds/index.mjs';
import { assertGraph } from '../scripts/lib/graph.mjs';
import { groupColour } from '../scripts/lib/palette.mjs';
import { boxOfInstance, segmentHitsBox } from '../scripts/lib/views.mjs';

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'golden');
const SPEC = { title: 'Commits per folder', units: 'commits' };

// 6 groups x 12 weeks, values derived from a stable hash so the fixture is fixed.
const GROUPS = ['api', 'web', 'db', 'auth', 'docs', 'infra'];
const WEEKS = Array.from({ length: 12 }, (_, i) => `2026-W${String(i + 20).padStart(2, '0')}`);
const fixture = () => ({
  rows: GROUPS.flatMap((group) => WEEKS.map((t) => ({ group, t, value: seedFrom(`${group}|${t}`) % 40 }))),
  links: [],
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

for (const world of ['city', 'terrain']) {
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
      assert.ok(g.items.length === rows.length, name);
    }
  });

  test(`${world}: every item reachable`, () => {
    const sparse = fixture().rows.filter((_, i) => i % 7 !== 3);
    for (const rows of [fixture().rows, sparse]) {
      const g = WORLDS[world]({ rows, links: [] }, SPEC);
      const seen = new Set();
      for (const b of g.batches) for (const inst of b.instances) seen.add(inst[6]);
      for (const s of g.surfaces) for (const c of s.cells) seen.add(c);
      for (let i = 0; i < g.items.length; i++) assert.ok(seen.has(i), `${world} item ${i}`);
    }
  });

  test(`${world}: hostile and long labels pass through as plain strings`, () => {
    const name = '<img src=x onerror=alert(1)>'.padEnd(48, 'x');
    const g = WORLDS[world]({ rows: [{ group: name, t: 1, value: 3, label: '😀 <b>' }], links: [] }, SPEC);
    assert.equal(g.groups[0].name, name);
    assert.equal(g.items[0].label, '😀 <b>');
    assert.ok(Object.keys(g.focus).includes(name.toLowerCase()));
  });
}

test('zero value still draws a floor marker', () => {
  const g = WORLDS.city({ rows: [{ group: 'a', t: 1, value: 0 }, { group: 'a', t: 2, value: 4 }], links: [] }, SPEC);
  const zero = g.batches.flatMap((b) => b.instances).find((inst) => inst[6] === 0);
  assert.ok(zero, 'instance for the zero item');
  assert.equal(zero[4], 0.05);
  assert.ok(zero[4] > 0);
});

test('city heights are zero-based and proportional', () => {
  const rows = [{ group: 'a', t: 1, value: 10 }, { group: 'a', t: 2, value: 40 }, { group: 'a', t: 3, value: 25 }];
  const g = WORLDS.city({ rows, links: [] }, SPEC);
  const h = (i) => g.batches.flatMap((b) => b.instances).find((inst) => inst[6] === i)[4];
  const FLOOR = 0.15;
  assert.ok(Math.abs((h(0) - FLOOR) / (h(1) - FLOOR) - 10 / 40) < 1e-3);
  assert.ok(Math.abs((h(2) - FLOOR) / (h(1) - FLOOR) - 25 / 40) < 1e-3);
  assert.ok(Math.abs(h(1) - (FLOOR + 9)) < 1e-3, 'tallest is floor + H');
});

test('city: districts are rows, buildings follow t order, columns line up across groups', () => {
  const rows = [
    { group: 'a', t: 2, value: 1 }, { group: 'a', t: 1, value: 1 },
    { group: 'b', t: 2, value: 1 },
  ];
  const g = WORLDS.city({ rows, links: [] }, SPEC);
  const at = (i) => g.batches.flatMap((b) => b.instances).find((inst) => inst[6] === i);
  assert.ok(at(1)[0] < at(0)[0], 't=1 sits left of t=2');
  assert.equal(at(0)[0], at(2)[0], 'same t, same x in every district');
  assert.notEqual(at(0)[2], at(2)[2], 'different groups, different z');
  assert.equal(at(0)[2], at(1)[2], 'same group, same z');
});

test('city: duplicate (group, t) rows stand side by side, never summed', () => {
  const rows = [{ group: 'a', t: 1, value: 3 }, { group: 'a', t: 1, value: 5 }, { group: 'b', t: 1, value: 2 }];
  const g = WORLDS.city({ rows, links: [] }, SPEC);
  const at = (i) => g.batches.flatMap((b) => b.instances).find((inst) => inst[6] === i);
  assert.notEqual(at(0)[0], at(1)[0]);
  assert.equal(g.items.length, 3);
  assert.equal(g.items[0].value, 3);
});

test('city: no t orders buildings by value, tallest first', () => {
  const rows = [{ group: 'a', value: 1 }, { group: 'a', value: 9 }, { group: 'a', value: 4 }];
  const g = WORLDS.city({ rows, links: [] }, SPEC);
  const x = (i) => g.batches.flatMap((b) => b.instances).find((inst) => inst[6] === i)[0];
  assert.ok(x(1) < x(2) && x(2) < x(0));
});

test('city: night lights on, window density tracks value, every district has a focus', () => {
  const g = WORLDS.city(fixture(), SPEC);
  assert.equal(g.env.nightLights, true);
  const densities = new Set(g.batches.map((b) => b.emissive?.density ?? 0));
  assert.ok(densities.size > 2, 'several density levels');
  const lit = g.batches.filter((b) => b.emissive);
  for (const b of lit) {
    const values = b.instances.map((inst) => g.items[inst[6]].value);
    assert.ok(Math.max(...values) >= Math.min(...values));
  }
  for (const name of GROUPS) assert.ok(g.focus[name], `focus ${name}`);
  assert.deepEqual(g.fallback.columns, ['group', 't', 'value']);
  assert.equal(g.fallback.rows.length, 72);
});

test('city focus: nothing but the target itself stands between the camera and a district or a labelled building', () => {
  const labelled = fixture();
  labelled.rows = labelled.rows.map((r, i) => (i % 17 === 3 ? { ...r, label: `row ${i}` } : r));
  for (const data of [labelled, { rows: labelled.rows.filter((r) => r.group !== 'docs' && r.group !== 'infra'), links: [] }]) {
    const g = WORLDS.city(data, SPEC);
    const buildings = g.batches.flatMap((b) => b.instances).filter((inst) => inst[6] >= 0);
    const groupKeys = new Map(g.groups.map((grp, gi) => [grp.name.toLowerCase(), gi]));
    let checked = 0;
    for (const [key, view] of Object.entries(g.focus)) {
      const own = groupKeys.has(key) ? (inst) => g.items[inst[6]].group === groupKeys.get(key) : (inst) => g.items[inst[6]].label.toLowerCase() === key;
      const blockers = buildings.filter((inst) => !own(inst)).map(boxOfInstance);
      const hit = blockers.filter((box) => segmentHitsBox(view.position, view.target, box)).length;
      assert.equal(hit, 0, `focus "${key}": ${hit} buildings in the way`);
      const [dx, dy, dz] = view.position.map((c, a) => c - view.target[a]);
      assert.ok(Math.asin(dy / Math.hypot(dx, dy, dz)) >= (30 * Math.PI) / 180, `focus "${key}" looks down at least 30 degrees`);
      checked += 1;
    }
    assert.ok(checked >= g.groups.length + 1, 'groups and labelled rows were checked');
  }
});

test('group colours stay distinct past eight', () => {
  assert.notDeepEqual(groupColour(0), groupColour(8));
  const rows = Array.from({ length: 9 }, (_, i) => ({ group: `g${i}`, t: 1, value: 1 }));
  const g = WORLDS.city({ rows, links: [] }, SPEC);
  assert.notDeepEqual(g.groups[0].colour, g.groups[8].colour);
  assert.equal(new Set(g.groups.map((x) => JSON.stringify(x.colour))).size, 9);
});

test('terrain: the data grid sits inside a ring of empty cells, upsampled 5x; cells map data cells to items', () => {
  const g = WORLDS.terrain(fixture(), SPEC);
  const [s] = g.surfaces;
  assert.equal(g.surfaces.length, 1);
  const cols = 12 + 2;
  const rows = 6 + 2;
  assert.equal(s.nx, (cols - 1) * 5 + 1);
  assert.equal(s.nz, (rows - 1) * 5 + 1);
  assert.equal(s.heights.length, s.nx * s.nz);
  assert.equal(s.cells.length, cols * rows);
  // data cell (gi, ti) is cell (gi + 1) * cols + ti + 1, on vertex ((ti + 1) * 5, (gi + 1) * 5), and shows that item's value
  const max = Math.max(...g.items.map((i) => i.value));
  for (const [gi, ti] of [[0, 0], [2, 5], [5, 11]]) {
    const item = g.items[s.cells[(gi + 1) * cols + ti + 1]];
    assert.equal(item.group, gi);
    assert.ok(Math.abs(s.heights[(gi + 1) * 5 * s.nx + (ti + 1) * 5] - item.value / max) < 1e-3);
  }
  // the ring is empty: no item on it
  for (let c = 0; c < cols; c++) assert.equal(s.cells[c], -1);
  for (let r = 0; r < rows; r++) assert.equal(s.cells[r * cols], -1);
  const used = s.cells.filter((c) => c >= 0);
  assert.equal(used.length, 72);
  assert.equal(new Set(used).size, 72, 'every row is on the grid exactly once');
});

test('terrain: an island: the edge of the surface is flat at height 0 and the shore slopes down to it', () => {
  const [s] = WORLDS.terrain(fixture(), SPEC).surfaces;
  for (let ix = 0; ix < s.nx; ix++) {
    assert.equal(s.heights[ix], 0, 'north edge');
    assert.equal(s.heights[(s.nz - 1) * s.nx + ix], 0, 'south edge');
  }
  for (let iz = 0; iz < s.nz; iz++) {
    assert.equal(s.heights[iz * s.nx], 0, 'west edge');
    assert.equal(s.heights[iz * s.nx + s.nx - 1], 0, 'east edge');
  }
  assert.ok(Math.max(...s.heights) > 0.5, 'land inside');
  // Walking in from the middle of the west edge: the heights run 0 -> the first data column's height without leaving 0..1.
  const row = 3 * 5 * s.nx;
  const run = Array.from({ length: 6 }, (_, k) => s.heights[row + k]);
  assert.equal(run[0], 0);
  assert.ok(run.every((h) => h >= 0 && h <= 1));
  assert.ok(run.every((h, k) => k === 0 || h >= run[k - 1] - 0.05 || k === 5), 'rising to the shore');
});

test('terrain: smooth interpolation passes exactly through every data cell and stays within 0..1', () => {
  const rows = [
    { group: 'a', t: 1, value: 0 }, { group: 'a', t: 2, value: 10 }, { group: 'a', t: 3, value: 2 },
    { group: 'b', t: 1, value: 10 }, { group: 'b', t: 2, value: 0 }, { group: 'b', t: 3, value: 7 },
  ];
  const g = WORLDS.terrain({ rows, links: [] }, SPEC);
  const [s] = g.surfaces;
  const cols = 3 + 2;
  assert.ok(s.heights.every((h) => h >= 0 && h <= 1));
  assert.equal(Math.max(...s.heights), 1);
  g.items.forEach((item, i) => {
    const cell = s.cells.indexOf(i);
    const [gi, ti] = [Math.floor(cell / cols), cell % cols];
    assert.ok(Math.abs(s.heights[gi * 5 * s.nx + ti * 5] - item.value / 10) < 1e-3, `item ${i}`);
  });
  // between two data cells the height moves smoothly: no kink at a data column (the slope either side agrees)
  const row = 1 * 5 * s.nx; // row of group a
  const at = (ix) => s.heights[row + ix];
  const slopeIn = at(15) - at(14); // the 2, on the way down from the 10 to the sea
  const slopeOut = at(16) - at(15);
  assert.ok(Math.abs(slopeIn - slopeOut) < 0.08, `slope ${slopeIn.toFixed(3)} then ${slopeOut.toFixed(3)}`);
  const mid = at(7); // between the 0 (vertex 5) and the 10 (vertex 10)
  assert.ok(mid > 0.3 && mid < 0.7, `midpoint ${mid}`);
});

test('terrain focus: no other row of land stands between the camera and a row, or between it and a labelled cell', () => {
  const data = fixture();
  data.rows = data.rows.map((r, i) => (i % 23 === 5 ? { ...r, label: `cell ${i}` } : r));
  const g = WORLDS.terrain(data, SPEC);
  const [s] = g.surfaces;
  const cols = 12 + 2;
  const [sx, sz, sy] = s.size;
  const [px, pz] = [sx / (12 + 1), sz / (6 + 1)];
  const boxes = (skip) => s.cells.flatMap((item, cell) => {
    const [gi, ti] = [Math.floor(cell / cols) - 1, (cell % cols) - 1];
    if (item < 0 || skip(gi, ti)) return [];
    const [x, z] = [((ti + 1) / 13 - 0.5) * sx, ((gi + 1) / 7 - 0.5) * sz];
    const h = s.heights[(gi + 1) * 5 * s.nx + (ti + 1) * 5] * sy;
    return [{ min: [x - px / 2, 0, z - pz / 2], max: [x + px / 2, h, z + pz / 2] }];
  });
  let checked = 0;
  g.groups.forEach((grp, gi) => {
    const view = g.focus[grp.name.toLowerCase()];
    assert.equal(boxes((r) => r === gi).filter((b) => segmentHitsBox(view.position, view.target, b)).length, 0, `row ${grp.name}`);
    checked += 1;
  });
  for (const [key, view] of Object.entries(g.focus).filter(([k]) => k.startsWith('cell '))) {
    const item = g.items.findIndex((it) => it.label === key);
    const cell = s.cells.indexOf(item);
    const [gi, ti] = [Math.floor(cell / cols) - 1, (cell % cols) - 1];
    assert.equal(boxes((r, t) => r === gi && t === ti).filter((b) => segmentHitsBox(view.position, view.target, b)).length, 0, key);
    checked += 1;
  }
  assert.ok(checked > g.groups.length, 'labelled cells were checked too');
});

test('terrain: between two equal cells flanked by zeros the land never rises above them, and data cells stay exact', () => {
  // One row 0, 4, 4, 0, 8: the ridge of two 4s (0.5 of the max) must not bulge above 0.5 (a Catmull-Rom would reach 0.5625).
  const rows = [0, 4, 4, 0, 8].map((value, i) => ({ group: 'a', t: i + 1, value }));
  const [s] = WORLDS.terrain({ rows, links: [] }, SPEC).surfaces;
  const row = 1 * 5 * s.nx; // the single group's row; data column ti is vertex (ti + 1) * 5
  const at = (ix) => s.heights[row + ix];
  for (let ix = 10; ix <= 15; ix++) assert.ok(at(ix) <= 0.5 + 1e-3, `vertex ${ix}: ${at(ix)}`);
  [0, 0.5, 0.5, 0, 1].forEach((h, ti) => assert.ok(Math.abs(at((ti + 1) * 5) - h) < 1e-3, `data column ${ti}`));
  // the same across rows: two equal rows between zero rows, with a taller one elsewhere
  const cross = WORLDS.terrain({ rows: [0, 4, 4, 0, 8].map((value, i) => ({ group: `g${i}`, t: 1, value })), links: [] }, SPEC).surfaces[0];
  const col = (iz) => cross.heights[iz * cross.nx + 5];
  for (let iz = 10; iz <= 15; iz++) assert.ok(col(iz) <= 0.5 + 1e-3, `row vertex ${iz}: ${col(iz)}`);
});

test('terrain: bands, sea level and the world size', () => {
  const rows = [
    { group: 'a', t: 1, value: 0 }, { group: 'a', t: 2, value: 10 },
    { group: 'b', t: 1, value: 10 }, { group: 'b', t: 2, value: 0 },
  ];
  const g = WORLDS.terrain({ rows, links: [] }, SPEC);
  const [s] = g.surfaces;
  assert.deepEqual(s.bands.map((b) => b.colour), ['#d8c38a', '#6b9a4f', '#8a8178', '#f4f6f8']);
  assert.ok(s.bands.every((b, i, a) => i === 0 || b.below > a[i - 1].below));
  assert.deepEqual(g.env.water, { y: 0.12 });
  // the surface spans the data plus one cell of sea each side: its width is (columns + 1) cell pitches
  const [sx, sz] = s.size;
  assert.ok(sx / 3 <= 2.5 + 1e-9 && sz / 3 <= 2.5 + 1e-9, 'a tiny grid does not stretch its cells');
});

test('terrain: missing grid cells get cell -1 and zero height, never NaN', () => {
  const rows = [{ group: 'a', t: 1, value: 4 }, { group: 'a', t: 2, value: 6 }, { group: 'b', t: 1, value: 5 }];
  const g = WORLDS.terrain({ rows, links: [] }, SPEC);
  assert.deepEqual(g.surfaces[0].cells.filter((c) => c >= 0), [0, 1, 2]);
  assert.equal(g.surfaces[0].cells.length, 16, 'a 2 x 2 grid and its ring of empty cells');
  assert.equal(g.surfaces[0].cells[2 * 4 + 2], -1, 'the missing (b, 2) cell is empty');
  assert.deepEqual(finite(g), []);
});

test('terrain: rows without t, or duplicate (group, t), are internal errors', () => {
  assert.throws(() => WORLDS.terrain({ rows: [{ group: 'a', value: 1 }], links: [] }, SPEC), /needs t/);
  assert.throws(() => WORLDS.terrain({ rows: [{ group: 'a', t: 1, value: 1 }, { group: 'a', t: 1, value: 2 }], links: [] }, SPEC), /one row per/);
});

test('graph without data rows still builds', () => {
  assert.doesNotThrow(() => assertGraph(WORLDS.city({ rows: [], links: [] }, SPEC)));
});

for (const world of ['city', 'terrain']) {
  test(`${world}: groups and labels named like Object.prototype keys still get a focus entry`, () => {
    const names = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
    const rows = names.map((group, i) => ({ group, t: i + 1, value: i + 1, label: `${group}-row` }));
    rows.push({ group: 'plain', t: 5, value: 1, label: '__proto__' });
    const g = WORLDS[world]({ rows, links: [] }, SPEC);
    for (const n of names) {
      assert.ok(Object.hasOwn(g.focus, n.toLowerCase()), `group ${n}`);
      assert.ok(Object.hasOwn(g.focus, `${n}-row`.toLowerCase()), `label ${n}-row`);
    }
    assert.ok(Object.hasOwn(g.focus, 'plain'));
    assert.doesNotThrow(() => assertGraph(g));
    assert.deepEqual(JSON.parse(JSON.stringify(g)).focus, JSON.parse(JSON.stringify(g.focus)));
    assert.ok(Object.hasOwn(JSON.parse(JSON.stringify(g)).focus, '__proto__'));
  });

  test(`${world}: items keep exact values and display for tiny numbers`, () => {
    const g = WORLDS[world]({ rows: [{ group: 'a', t: 1, value: 0.0002 }, { group: 'a', t: 2, value: 5 }], links: [] }, SPEC);
    assert.equal(g.items[0].value, 0.0002);
    assert.equal(g.items[0].display, '0.0002 commits');
  });
}

test('terrain surface size carries the vertical scale as its third element', () => {
  const [s] = WORLDS.terrain(fixture(), SPEC).surfaces;
  assert.equal(s.size.length, 3);
  assert.ok(s.size.every(Number.isFinite));
});
