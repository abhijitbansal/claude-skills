import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (prefix) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(d); return d; };

// Side-effect free: importing it runs nothing.
const loadRequirements = async () => (await import(pathToFileURL(path.join(SKILL, 'scripts/lib/requirements.mjs')).href)).requirementsFor;
const idsOf = (reqs) => reqs.map((r) => r.id);
const specFile = (spec) => {
  const file = path.join(tmp('scene-spec-'), 'scene.json');
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
};

test('pure world spec needs no sister skill', async () => {
  const requirementsFor = await loadRequirements();
  const ids = idsOf(requirementsFor(specFile({ title: 'T', world: 'city', data: { rows: [] } })));
  assert.deepEqual(ids, ['node', 'node_modules']);
  assert.ok(!ids.includes('make-diagram') && !ids.includes('make-dashboard'));
});

test('diagram lift spec needs make-diagram', async () => {
  const requirementsFor = await loadRequirements();
  const ids = idsOf(requirementsFor(specFile({ title: 'T', lift: { diagram: 'diagram.json' } })));
  assert.deepEqual(ids, ['node', 'node_modules', 'make-diagram']);
});

test('dashboard lift spec needs make-dashboard', async () => {
  const requirementsFor = await loadRequirements();
  const ids = idsOf(requirementsFor(specFile({ title: 'T', lift: { dashboard: 'dashboard.json' } })));
  assert.deepEqual(ids, ['node', 'node_modules', 'make-dashboard']);
});

test('check target needs browser and dev deps', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  const check = requirementsFor('check');
  assert.deepEqual(idsOf(check), ['node', 'node_modules', 'dev_deps', 'chromium']);
  assert.deepEqual(check.map((r) => r.required), [true, true, true, true]);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules']);
});

test('ALL adds both sister skills so --fix works without --for', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(ALL)), ['node', 'node_modules', 'dev_deps', 'chromium', 'make-diagram', 'make-dashboard']);
});
