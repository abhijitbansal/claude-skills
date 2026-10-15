// viewerData's per-id `info`: what the panel, the Find box and the count chips read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { viewerData } from '../scripts/lib/data.mjs';
import { LEGEND_BAND } from '../scripts/lib/legend.mjs';

const example = (name) => JSON.parse(fs.readFileSync(new URL(`../references/examples/${name}.diagram.json`, import.meta.url), 'utf8'));

test('info names every id a step can name: groups as kind "group", so a route or a row can name a group an edge ends at', async () => {
  const { data, ids } = await buildDiagram(example('architecture'));
  for (const id of ids) assert.ok(Object.hasOwn(data.info, id), `info for ${id}`);
  assert.deepEqual(data.info.vpc, { label: 'Private VPC', kind: 'group' });
  assert.deepEqual(data.info.aws, { label: 'AWS us-east-1', kind: 'group' });
  assert.deepEqual(data.directed.vpc, ['edge-3'], 'the two-headed edge leaves the group too');
  assert.deepEqual(data.info['edge-3'], { style: 'dashed' }, 'an unlabelled edge has a style only');
  assert.deepEqual(data.info.web, { label: 'Web app', kind: 'client' });
});

test('a sequence has no groups: info is participants and messages', async () => {
  const { data } = await buildDiagram(example('sequence'));
  assert.ok(Object.values(data.info).every((e) => e.kind !== 'group'));
  assert.equal(data.info.m1.style, 'sync');
});

test('info keys edges by their ids, whatever order the geometry lists them in', async () => {
  const spec = example('story');
  const built = await buildDiagram(spec);
  const reversed = { ...built.geometry, edges: [...built.geometry.edges].reverse() };
  const data = viewerData(spec, { geometry: reversed, steps: built.steps, ids: built.ids, width: built.width, height: built.height, beats: built.data.beats, chapters: built.data.chapters });
  assert.deepEqual(data.info.place, { label: 'POST /orders', style: 'solid' });
  assert.deepEqual(data.info['edge-6'], { label: '201 Created', style: 'dashed' });
  assert.deepEqual(data.info['edge-4'], { label: 'order.placed', style: 'async' });
});

// ---- drawing: the diagram's own bounds, without the legend band or the widening for the legend row ----------

const DOWN_FLOW = {
  title: 'Three nodes',
  type: 'flow',
  direction: 'down',
  nodes: ['a', 'b', 'c'].map((id) => ({ id, label: `Checkout service ${id.toUpperCase()}` })),
  edges: [{ from: 'a', to: 'b', style: 'solid' }, { from: 'b', to: 'c', style: 'dashed' }, { from: 'a', to: 'c', style: 'async' }],
};

for (const [name, spec] of [['architecture', example('architecture')], ['flow', example('flow')], ['state', example('state')], ['sequence', example('sequence')], ['story', example('story')], ['a three-node down flow', DOWN_FLOW]]) {
  test(`${name}: data.drawing leaves the legend band out and holds every box`, async () => {
    const { data, width, height } = await buildDiagram(spec);
    const [x, y, w, h] = data.drawing;
    assert.equal(y, LEGEND_BAND, 'starts below the legend band');
    assert.equal(y + h, height, 'and ends at the canvas bottom');
    assert.ok(x >= 0 && x + w <= width, 'inside the canvas');
    for (const [id, [bx, by, bw, bh]] of Object.entries(data.boxes)) {
      const tol = 0.5;
      assert.ok(bx >= x - tol && by >= y - tol && bx + bw <= x + w + tol && by + bh <= y + h + tol, `${id} sits inside the drawing`);
    }
  });
}

test('a drawing narrower than its legend row is not widened: data.drawing is narrower than the canvas, the same height less the band', async () => {
  const { data, width, height } = await buildDiagram(DOWN_FLOW);
  const [x, , w] = data.drawing;
  assert.ok(w < width - 50, `the drawing is ${w} units, the canvas ${width}`);
  assert.ok(Math.abs(x + w / 2 - width / 2) <= 0.1, 'centred in the widened canvas');
  assert.equal(height - LEGEND_BAND, data.drawing[3]);
});

test('a drawing wider than its legend row is the whole width', async () => {
  const { data, width } = await buildDiagram(example('architecture'));
  assert.deepEqual([data.drawing[0], data.drawing[2]], [0, width]);
});
