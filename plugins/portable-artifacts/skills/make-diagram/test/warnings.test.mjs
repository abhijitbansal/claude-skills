// PA-24: the validator's warning tier. Each case below passed silently before; now it validates (exit 0) and warns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VALIDATE = path.join(ROOT, 'scripts/validate.mjs');
const example = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, `references/examples/${name}.diagram.json`), 'utf8'));
const warningsOf = async (spec) => {
  const r = await validateSpec(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.warnings ?? [];
};
const find = (warnings, pathText) => warnings.find((w) => w.path === pathText);

const graph = (over = {}) => ({
  title: 'T', type: 'architecture',
  nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
  edges: [{ from: 'a', to: 'b' }],
  ...over,
});

test('the shipped examples raise no semantic warning', async () => {
  for (const name of ['architecture', 'flow', 'state', 'sequence', 'story']) {
    const bad = (await validateSpec(example(name))).warnings ?? [];
    assert.deepEqual(bad, [], name);
  }
});

test('a node no edge touches warns at the node', async () => {
  const w = find(await warningsOf(graph({ nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] })), 'nodes[2]');
  assert.ok(w, 'warning at nodes[2]');
  assert.match(w.message, /"c" has no edges/);
});

test('a single node with no edges is a legitimate diagram', async () => {
  assert.deepEqual(await warningsOf({ title: 'T', type: 'architecture', nodes: [{ id: 'a', label: 'A' }] }), []);
});

test('a node inside a group the edges reach is connected through the group', async () => {
  const spec = {
    title: 'T', type: 'architecture', groups: [{ id: 'g', label: 'G' }],
    nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', group: 'g' }],
    edges: [{ from: 'a', to: 'g' }],
  };
  assert.deepEqual(await warningsOf(spec), []);
});

test('a flow decision with one outgoing edge warns, and so does an unlabelled branch', async () => {
  const spec = {
    title: 'T', type: 'flow',
    nodes: [{ id: 's', label: 'Start', kind: 'start' }, { id: 'd', label: 'Valid?', kind: 'decision' }, { id: 'e', label: 'Done', kind: 'end' }],
    edges: [{ from: 's', to: 'd' }, { from: 'd', to: 'e' }],
  };
  const warnings = await warningsOf(spec);
  const w = find(warnings, 'nodes[1]');
  assert.ok(w, JSON.stringify(warnings));
  assert.match(w.message, /decision "d" has 1 outgoing edge; a decision branches two or more ways/);
  assert.match(find(warnings, 'edges[1]').message, /leaves decision "d" with no label/);
});

test('a decision with two labelled branches is fine', async () => {
  const spec = {
    title: 'T', type: 'flow',
    nodes: [{ id: 'd', label: 'Valid?', kind: 'decision' }, { id: 'y', label: 'Ship' }, { id: 'n', label: 'Fix' }],
    edges: [{ from: 'd', to: 'y', label: 'yes' }, { from: 'd', to: 'n', label: 'no' }],
  };
  assert.deepEqual(await warningsOf(spec), []);
});

test('two groups whose labels differ only by case warn at the later one', async () => {
  const spec = graph({
    groups: [{ id: 'g1', label: 'API' }, { id: 'g2', label: 'Api' }],
    nodes: [{ id: 'a', label: 'A', group: 'g1' }, { id: 'b', label: 'B', group: 'g2' }],
  });
  const w = find(await warningsOf(spec), 'groups[1].label');
  assert.ok(w);
  assert.match(w.message, /differs from groups\[0\] "API" only by case/);
});

test('a participant that sends and receives nothing warns', async () => {
  const spec = {
    title: 'T', type: 'sequence',
    participants: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
    messages: [{ id: 'm1', from: 'a', to: 'b', label: 'ping' }],
  };
  const w = find(await warningsOf(spec), 'participants[2]');
  assert.ok(w);
  assert.match(w.message, /participant "c" sends and receives no message/);
});

test('validate prints a warning as "path: warning: message", still says valid and exits 0; --json carries warnings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-warn-'));
  const file = path.join(dir, 'orphan.diagram.json');
  fs.writeFileSync(file, JSON.stringify(graph({ nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }] })));
  const text = spawnSync(process.execPath, [VALIDATE, file], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /^nodes\[2\]: warning: node "c" has no edges/m);
  assert.match(text.stdout, /: valid \(1 warning\)\n$/);
  const json = spawnSync(process.execPath, [VALIDATE, file, '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0);
  const body = JSON.parse(json.stdout);
  assert.equal(body.ok, true);
  assert.equal(body.warnings.length, 1);
  assert.equal(body.warnings[0].path, 'nodes[2]');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a clean spec prints no warning line and its JSON has no warnings key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-warn-'));
  const file = path.join(dir, 'clean.diagram.json');
  fs.writeFileSync(file, JSON.stringify(graph()));
  const json = spawnSync(process.execPath, [VALIDATE, file, '--json'], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(json.stdout), { ok: true, errors: [] });
  fs.rmSync(dir, { recursive: true, force: true });
});
