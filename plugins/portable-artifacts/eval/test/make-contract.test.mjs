// The one report all five skills' scripts/make.mjs print. This file lives under eval/test, not bin/test: CI runs bin/test in
// a job that installs no skill, and the eval-harness entry of the node-skills matrix installs all five.
// Locally a skill without node_modules is skipped, and the skip says so; with CI set a missing install is a failure.
// No browser and no ffmpeg: every run here stops at validate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILLS = ['make-dashboard', 'make-diagram', 'make-explainer', 'make-scene', 'make-motion'];
const KINDS = ['mechanical', 'creative'];
const CORE_KEYS = ['ok', 'output', 'stages', 'findings'];
const EXIT_NOT_OK = 1;
const EXIT_MACHINE = 2;

/** What is wrong with a make report, as a list of sentences; empty when it meets the contract. */
export function contractProblems(report) {
  const problems = [];
  if (report === null || typeof report !== 'object' || Array.isArray(report)) return ['the report is not a JSON object'];
  for (const key of CORE_KEYS) if (!(key in report)) problems.push(`missing key ${key}`);
  if (typeof report.ok !== 'boolean') problems.push('ok is not a boolean');
  if (report.output !== null && typeof report.output !== 'string') problems.push('output is neither null nor a string');
  for (const [i, s] of (Array.isArray(report.stages) ? report.stages : []).entries()) {
    if (typeof s?.name !== 'string' || typeof s?.ok !== 'boolean' || typeof s?.seconds !== 'number') problems.push(`stages[${i}] lacks name, ok and seconds`);
  }
  for (const [i, f] of (Array.isArray(report.findings) ? report.findings : []).entries()) {
    if (!KINDS.includes(f?.kind)) problems.push(`findings[${i}].kind is not mechanical or creative`);
    if (typeof f?.path !== 'string') problems.push(`findings[${i}].path is not a string`);
    if (typeof f?.message !== 'string') problems.push(`findings[${i}].message is not a string`);
  }
  if (!Array.isArray(report.stages)) problems.push('stages is not an array');
  if (!Array.isArray(report.findings)) problems.push('findings is not an array');
  if ('error' in report && (typeof report.error?.message !== 'string' || typeof report.error?.hint !== 'string')) problems.push('error lacks message and hint');
  return problems;
}

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'make-contract-')));
const badSpec = path.join(work, 'bad.json');
fs.writeFileSync(badSpec, '{}');

function runMake(skill, args) {
  const r = spawnSync(process.execPath, [path.join(PLUGIN, 'skills', skill, 'scripts', 'make.mjs'), ...args, '--json'], { encoding: 'utf8', cwd: work, timeout: 120000 });
  const lines = r.stdout.trim().split('\n');
  return { status: r.status, lines, report: lines.length === 1 ? JSON.parse(lines[0]) : null, stderr: r.stderr };
}

// A skill is runnable when its dependencies are installed; the doctor stage would otherwise stop the run first.
function installed(skill) {
  return fs.existsSync(path.join(PLUGIN, 'skills', skill, 'node_modules'));
}

for (const skill of SKILLS) {
  test(`${skill}: make.mjs on a spec that does not validate exits 1 with one JSON object that meets the contract`, (t) => {
    if (!installed(skill)) {
      assert.ok(!process.env.CI, `${skill} has no node_modules and CI is set; run npm ci in the skill folder`);
      return t.skip(`${skill}: no node_modules (run npm ci --prefix ${path.join(PLUGIN, 'skills', skill)})`);
    }
    const { status, lines, report } = runMake(skill, [badSpec]);
    assert.equal(lines.length, 1, `stdout must be one line: ${lines.join(' | ')}`);
    assert.equal(status, EXIT_NOT_OK);
    assert.deepEqual(contractProblems(report), []);
    assert.equal(report.ok, false);
    assert.ok(report.findings.length > 0, 'a spec that does not validate has findings');
    assert.ok(report.findings.every((f) => f.kind === 'mechanical'), 'validation errors are mechanical');
  });

  test(`${skill}: make.mjs on a missing file exits 2 with error.message and error.hint`, (t) => {
    if (!installed(skill)) {
      assert.ok(!process.env.CI, `${skill} has no node_modules and CI is set`);
      return t.skip(`${skill}: no node_modules`);
    }
    const { status, lines, report } = runMake(skill, [path.join(work, 'does-not-exist.json')]);
    assert.equal(lines.length, 1);
    assert.equal(status, EXIT_MACHINE);
    assert.deepEqual(contractProblems(report), []);
    assert.equal(report.ok, false);
    assert.equal(typeof report.error.message, 'string');
    assert.ok(report.error.message.length > 0);
    assert.equal(typeof report.error.hint, 'string');
  });
}

test('guard proof: the checker fails a report that lacks stages, one with a bad finding kind, and one with an incomplete stage', () => {
  const good = { ok: false, output: null, stages: [{ name: 'validate', ok: false, seconds: 0.1 }], findings: [{ kind: 'mechanical', path: 'a', message: 'm' }] };
  assert.deepEqual(contractProblems(good), []);
  const { stages, ...noStages } = good;
  assert.ok(contractProblems(noStages).includes('missing key stages'));
  assert.ok(contractProblems({ ...good, findings: [{ kind: 'minor', path: 'a', message: 'm' }] }).length > 0);
  assert.ok(contractProblems({ ...good, stages: [{ name: 'validate', ok: false }] }).length > 0);
  assert.ok(contractProblems({ ...good, error: { message: 'm' } }).length > 0);
  assert.ok(contractProblems([]).length > 0);
});
