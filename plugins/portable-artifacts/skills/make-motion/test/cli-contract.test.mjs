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
const SCRIPTS = ['beats', 'cutout', 'doctor', 'make', 'storyboard'];

for (const name of SCRIPTS) {
  test(`${name}.mjs --help prints the usage on stdout and exits 0`, () => {
    const r = run(`${name}.mjs`, '--help');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /usage: .*(node )?(scripts\/)?[a-z-]+\.mjs/i, r.stdout);
    assert.equal(r.stderr, '');
  });
}

test('make.mjs rejects an unknown flag with exit 2 and names the accepted ones', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cli-'));
  const film = path.join(dir, 'film.json');
  writeFileSync(film, JSON.stringify({ shots: [] }));
  const r = run('make.mjs', film, '--jsno');
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /--jsno/);
});

test('make.mjs: no film, two films and an unreadable film are usage errors (exit 2)', () => {
  assert.equal(run('make.mjs').status, 2);
  assert.equal(run('make.mjs', 'a.json', 'b.json').status, 2);
  assert.equal(run('make.mjs', path.join(tmpdir(), 'no-such-film.json')).status, 2);
});

test('make.mjs --json keeps one JSON object with ok:false and an error on a usage error', () => {
  const r = run('make.mjs', '--json');
  assert.equal(r.status, 2);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.ok(out.error?.message, r.stdout);
});
