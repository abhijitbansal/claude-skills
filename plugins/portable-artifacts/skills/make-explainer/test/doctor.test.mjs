import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const NAME = 'make-explainer';
const run = (skillDir, args, env = process.env) => spawnSync(process.execPath, [path.join(skillDir, 'scripts/doctor.mjs'), ...args], { encoding: 'utf8', env });

test('runs on a fresh copy with no node_modules and reports it missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-fresh-'));
  const copy = path.join(dir, NAME);
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'scripts/doctor.mjs'), path.join(copy, 'scripts/doctor.mjs'));
  const r = run(copy, ['--json']);
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.missing.find((m) => m.id === 'node_modules').required, true);
});

test('unknown argument exits 2 and lists the accepted ones', () => {
  const r = run(SKILL, ['--frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--json|--for|--fix/);
});

test('--for with an unknown target exits 2 and lists the accepted ones', () => {
  const r = run(SKILL, ['--for', 'bogus']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /check/);
});

test('--fix with an unknown id reports it instead of installing anything', () => {
  const r = run(SKILL, ['--fix', 'no-such-requirement', '--json']);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /no-such-requirement/);
});

function specFile(sections) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-spec-'));
  const file = path.join(dir, 'x.explainer.json');
  fs.writeFileSync(file, JSON.stringify({ title: 'T', sections }));
  return file;
}

test('--for spec.json asks for the sister skills its sections need', () => {
  // Fresh copy in a temp tree with no sisters: every needed sister is reported.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-sisters-'));
  const copy = path.join(dir, NAME);
  fs.mkdirSync(path.join(copy, 'scripts'), { recursive: true });
  fs.cpSync(path.join(SKILL, 'shared'), path.join(copy, 'shared'), { recursive: true });
  fs.copyFileSync(path.join(SKILL, 'scripts/doctor.mjs'), path.join(copy, 'scripts/doctor.mjs'));
  const file = specFile([{ type: 'diagram' }, { type: 'chart' }, { type: 'text' }]);
  const ids = JSON.parse(run(copy, ['--json', '--for', file]).stdout).missing.map((m) => m.id);
  assert.ok(ids.includes('make-diagram'));
  assert.ok(ids.includes('make-dashboard'));
  assert.equal(ids.includes('make-motion'), false);
});

test('--for spec.json does not report sisters that sit beside the skill', () => {
  const file = specFile([{ type: 'diagram' }, { type: 'text' }]);
  const ids = JSON.parse(run(SKILL, ['--json', '--for', file]).stdout).missing.map((m) => m.id);
  assert.equal(ids.includes('make-dashboard'), false);
  assert.equal(ids.includes('make-diagram'), false);
});

test('a malformed spec is a one-line usage error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-bad-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{ nope');
  const r = run(SKILL, ['--for', file]);
  assert.equal(r.status, 2);
  assert.equal(r.stderr.trim().split('\n').length, 1, r.stderr);
});
