// The agent-facing CLI contract (PA-20): every entry script answers --help with its usage on stdout and exit 0, and the
// scripts that took any flag now reject an unknown one with exit 2. No browser: none of these runs gets past argument parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, ...args) => spawnSync(process.execPath, [path.join(root, 'scripts', script), ...args], { encoding: 'utf8' });
const SCRIPTS = ['beats', 'blocks', 'check', 'cutout', 'doctor', 'preview', 'render', 'sketch-icons', 'storyboard', 'validate', 'voice'];

for (const name of SCRIPTS) {
  test(`${name}.mjs --help prints the usage on stdout and exits 0`, () => {
    const r = run(`${name}.mjs`, '--help');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /usage: .*(node )?(scripts\/)?[a-z-]+\.mjs/i, r.stdout);
    assert.equal(r.stderr, '');
  });
}

test('validate.mjs and preview.mjs reject an unknown flag with exit 2 and the usage line', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cli-'));
  const spec = path.join(dir, 'm.json');
  writeFileSync(spec, JSON.stringify({ scenes: [{ id: 's1', duration: 1, elements: [] }] }));
  for (const script of ['validate.mjs', 'preview.mjs']) {
    const r = run(script, spec, '--jsno');
    assert.equal(r.status, 2, `${script}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /Unknown option '--jsno'/, script);
    assert.match(r.stderr, new RegExp(`usage: node scripts/${script}`), script);
  }
});

test('validate.mjs: no file, two files and an unreadable file are usage errors (exit 2)', () => {
  assert.equal(run('validate.mjs').status, 2);
  assert.equal(run('validate.mjs', 'a.json', 'b.json').status, 2);
  assert.equal(run('validate.mjs', path.join(tmpdir(), 'no-such-motion.json')).status, 2);
});

test('validate.mjs --json keeps its envelope on a usage error', () => {
  const r = run('validate.mjs', '--json');
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.errors[0].message, /expected one spec file/);
});
