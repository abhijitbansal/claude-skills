import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  assert.deepEqual(ids, ['node', 'node_modules', 'builder_agent']);
  assert.ok(!ids.includes('make-diagram') && !ids.includes('make-dashboard'));
});

test('diagram lift spec needs make-diagram', async () => {
  const requirementsFor = await loadRequirements();
  const ids = idsOf(requirementsFor(specFile({ title: 'T', lift: { diagram: 'diagram.json' } })));
  assert.deepEqual(ids, ['node', 'node_modules', 'make-diagram', 'builder_agent']);
});

test('dashboard lift spec needs make-dashboard', async () => {
  const requirementsFor = await loadRequirements();
  const ids = idsOf(requirementsFor(specFile({ title: 'T', lift: { dashboard: 'dashboard.json' } })));
  assert.deepEqual(ids, ['node', 'node_modules', 'make-dashboard', 'builder_agent']);
});

test('check target needs browser and dev deps', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  const check = requirementsFor('check');
  assert.deepEqual(idsOf(check), ['node', 'node_modules', 'dev_deps', 'chromium', 'builder_agent']);
  assert.deepEqual(check.map((r) => r.required), [true, true, true, true, false]);
  assert.deepEqual(idsOf(requirementsFor(undefined)), ['node', 'node_modules', 'builder_agent']);
});

test('ALL adds both sister skills so --fix works without --for', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  assert.deepEqual(idsOf(requirementsFor(ALL)), ['node', 'node_modules', 'dev_deps', 'chromium', 'make-diagram', 'make-dashboard', 'builder_agent']);
});

// The optional artifact-builder agent file: reported only where Copilot or Codex exists, never a failure on its own.
test('builder_agent is an optional requirement in every target, and a missing agent file keeps exit 0', async () => {
  const requirementsFor = await loadRequirements();
  const { ALL } = await import(pathToFileURL(path.join(SKILL, 'shared/doctor.mjs')).href);
  for (const t of [undefined, ALL]) {
    const b = requirementsFor(t).find((r) => r.id === 'builder_agent');
    assert.ok(b, `builder_agent for ${String(t)}`);
    assert.equal(b.required, false);
  }
  const home = tmp('doctor-home-');
  const cwd = tmp('doctor-cwd-');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  const doctor = () => spawnSync(process.execPath, [path.join(SKILL, 'scripts/doctor.mjs'), '--json'], { encoding: 'utf8', env, cwd });
  const read = (r) => JSON.parse(r.stdout);
  const consistent = (r) => {
    const out = read(r);
    assert.equal(out.ok, out.missing.filter((m) => m.required).length === 0, 'ok ignores optional misses');
    assert.equal(r.status, out.ok ? 0 : 1, 'an optional miss alone must not exit 1');
    return out;
  };
  // Neither ~/.copilot nor ~/.codex: Claude Code or Gemini, nothing to report.
  assert.equal(consistent(doctor()).missing.some((m) => m.id === 'builder_agent'), false, 'not reported without a Copilot or Codex folder');
  // ~/.codex exists, no agent file: a missing optional.
  fs.mkdirSync(path.join(home, '.codex'));
  const miss = consistent(doctor()).missing.find((m) => m.id === 'builder_agent');
  assert.ok(miss, 'reported once ~/.codex exists');
  assert.equal(miss.required, false);
  assert.match(miss.fix.manual.darwin, /install\.mjs copilot --agents-only/);
  fs.mkdirSync(path.join(home, '.codex/agents'));
  fs.writeFileSync(path.join(home, '.codex/agents/artifact-builder.toml'), 'name = "artifact-builder"\n');
  assert.equal(consistent(doctor()).missing.some((m) => m.id === 'builder_agent'), false, 'present once the file exists');
});
