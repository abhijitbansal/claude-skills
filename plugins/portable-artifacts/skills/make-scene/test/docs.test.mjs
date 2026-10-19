import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SKILL = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES = path.join(SKILL, 'references', 'examples');
const VALIDATE = path.join(SKILL, 'scripts', 'validate.mjs');
const MAX_SKILL_LINES = 130;
const WORLD_EXAMPLES = ['city', 'forest', 'galaxy', 'terrain'];
const LIFT_EXAMPLES = ['lift-diagram', 'lift-dashboard'];

const read = (...p) => fs.readFileSync(path.join(SKILL, ...p), 'utf8');
const validate = (file) => spawnSync(process.execPath, [VALIDATE, file, '--json'], {
  encoding: 'utf8',
  env: { ...process.env, EVAL_LOG: '' },
});

for (const name of [...WORLD_EXAMPLES, ...LIFT_EXAMPLES]) {
  test(`example ${name}.scene.json validates`, () => {
    const file = path.join(EXAMPLES, `${name}.scene.json`);
    assert.ok(fs.existsSync(file), `${name}.scene.json is missing`);
    const r = validate(file);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).ok, true);
  });
}

test('each world example sets its own world, and each lift example sets none', () => {
  for (const world of WORLD_EXAMPLES) {
    assert.equal(JSON.parse(read('references', 'examples', `${world}.scene.json`)).world, world);
  }
  for (const name of LIFT_EXAMPLES) {
    const spec = JSON.parse(read('references', 'examples', `${name}.scene.json`));
    assert.equal(spec.world, undefined);
    assert.ok(spec.lift);
  }
});

test('SKILL.md stays within its line budget', () => {
  const lines = read('SKILL.md').trimEnd().split('\n').length;
  assert.ok(lines <= MAX_SKILL_LINES, `${lines} lines; the limit is ${MAX_SKILL_LINES}`);
});

test('every script SKILL.md names exists', () => {
  const named = new Set([...read('SKILL.md').matchAll(/scripts\/([\w-]+\.mjs)/g)].map((m) => m[1]));
  for (const script of ['doctor.mjs', 'validate.mjs', 'build.mjs', 'check.mjs', 'rows.mjs']) {
    assert.ok(named.has(script), `SKILL.md does not mention ${script}`);
  }
  for (const script of named) assert.ok(fs.existsSync(path.join(SKILL, 'scripts', script)), `scripts/${script} does not exist`);
});

test('every reference file SKILL.md names exists', () => {
  const named = new Set([...read('SKILL.md').matchAll(/references\/([\w./-]+\.(?:md|json))/g)].map((m) => m[1]));
  assert.ok(named.size > 0);
  for (const ref of named) assert.ok(fs.existsSync(path.join(SKILL, 'references', ref)), `references/${ref} does not exist`);
});

test('SKILL.md carries the rules the build output depends on', () => {
  const md = read('SKILL.md');
  assert.match(md, /alternatives table/i);
  assert.match(md, /verbatim/i);
  assert.match(md, /--world/);
  assert.match(md, /sortable|zero-padded/i);
});
