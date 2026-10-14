// viewerData's per-id `info`: what the panel, the Find box and the count chips read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { viewerData } from '../scripts/lib/data.mjs';

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
