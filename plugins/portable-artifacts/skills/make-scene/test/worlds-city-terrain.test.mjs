import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedFrom } from '../shared/art.mjs';
import { WORLDS } from '../scripts/worlds/index.mjs';
import { assertGraph } from '../scripts/lib/graph.mjs';
import { groupColour } from '../scripts/lib/palette.mjs';

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

test('group colours stay distinct past eight', () => {
  assert.notDeepEqual(groupColour(0), groupColour(8));
  const rows = Array.from({ length: 9 }, (_, i) => ({ group: `g${i}`, t: 1, value: 1 }));
  const g = WORLDS.city({ rows, links: [] }, SPEC);
  assert.notDeepEqual(g.groups[0].colour, g.groups[8].colour);
  assert.equal(new Set(g.groups.map((x) => JSON.stringify(x.colour))).size, 9);
});

test('terrain: grid is upsampled 5x and cells map data cells to items', () => {
  const g = WORLDS.terrain(fixture(), SPEC);
  const [s] = g.surfaces;
  assert.equal(g.surfaces.length, 1);
  assert.equal(s.nx, (12 - 1) * 5 + 1);
  assert.equal(s.nz, (6 - 1) * 5 + 1);
  assert.equal(s.heights.length, s.nx * s.nz);
  assert.equal(s.cells.length, 72);
  // data cell (gi, ti) sits on upsampled vertex (gi*5, ti*5) and shows that item's value
  const max = Math.max(...g.items.map((i) => i.value));
  for (const [gi, ti] of [[0, 0], [2, 5], [5, 11]]) {
    const item = g.items[s.cells[gi * 12 + ti]];
    assert.equal(item.group, gi);
    assert.ok(Math.abs(s.heights[gi * 5 * s.nx + ti * 5] - item.value / max) < 1e-3);
  }
});

test('terrain: bilinear midpoints, normalized heights, bands and sea level', () => {
  const rows = [
    { group: 'a', t: 1, value: 0 }, { group: 'a', t: 2, value: 10 },
    { group: 'b', t: 1, value: 10 }, { group: 'b', t: 2, value: 0 },
  ];
  const g = WORLDS.terrain({ rows, links: [] }, SPEC);
  const [s] = g.surfaces;
  assert.ok(s.heights.every((h) => h >= 0 && h <= 1));
  assert.equal(Math.max(...s.heights), 1);
  assert.ok(Math.abs(s.heights[1] - 0.2) < 1e-3, 'edge vertex 1/5 of the way from 0 to 1');
  assert.ok(Math.abs(s.heights[2 * s.nx + 2] - 0.48) < 1e-3, 'bilinear saddle at (0.4, 0.4): 0.4*0.6 + 0.6*0.4');
  assert.deepEqual(s.bands.map((b) => b.colour), ['#d8c38a', '#6b9a4f', '#8a8178', '#f4f6f8']);
  assert.ok(s.bands.every((b, i, a) => i === 0 || b.below > a[i - 1].below));
  assert.deepEqual(g.env.water, { y: 0.12 });
});

test('terrain: missing grid cells get cell -1 and zero height, never NaN', () => {
  const rows = [{ group: 'a', t: 1, value: 4 }, { group: 'a', t: 2, value: 6 }, { group: 'b', t: 1, value: 5 }];
  const g = WORLDS.terrain({ rows, links: [] }, SPEC);
  assert.deepEqual(g.surfaces[0].cells, [0, 1, 2, -1]);
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
