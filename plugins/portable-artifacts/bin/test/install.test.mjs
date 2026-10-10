import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { targetsFor, HOSTS } from '../install.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.resolve(here, '../install.mjs');
const tmp = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-install-')));

function runInstall(args, home) {
  return spawnSync(process.execPath, [installer, ...args, '--no-deps'], {
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
}

test('targetsFor maps each host and scope to its documented skill dir', () => {
  const home = '/h';
  const proj = '/p';
  assert.equal(targetsFor('claude', 'user', { home, proj }).skills, '/h/.claude/skills');
  assert.equal(targetsFor('claude', 'project', { home, proj }).skills, '/p/.claude/skills');
  assert.equal(targetsFor('codex', 'user', { home, proj }).skills, '/h/.agents/skills');
  assert.equal(targetsFor('codex', 'project', { home, proj }).skills, '/p/.agents/skills');
  assert.equal(targetsFor('copilot', 'user', { home, proj }).skills, '/h/.copilot/skills');
  assert.equal(targetsFor('copilot', 'project', { home, proj }).skills, '/p/.github/skills');
  assert.equal(targetsFor('gemini', 'user', { home, proj }).skills, '/h/.gemini/skills');
  assert.equal(targetsFor('gemini', 'project', { home, proj }).commands, '/p/.gemini/commands');
  assert.equal(targetsFor('agents', 'user', { home, proj }).skills, '/h/.agents/skills');
  assert.deepEqual(Object.keys(HOSTS).sort(), ['agents', 'claude', 'codex', 'copilot', 'gemini']);
});

test('project install copies both skills without node_modules, tests or build output', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['codex', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['make-dashboard', 'make-motion']) {
    const dst = path.join(proj, '.agents/skills', s);
    assert.ok(fs.existsSync(path.join(dst, 'SKILL.md')), `${s}/SKILL.md`);
    assert.ok(fs.existsSync(path.join(dst, 'scripts/validate.mjs')));
    assert.ok(fs.existsSync(path.join(dst, 'package-lock.json')));
    assert.equal(fs.existsSync(path.join(dst, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(dst, 'test')), false);
  }
  assert.match(r.stdout, /\$make-dashboard/);
});

test('user install honours HOME and --skills filter', () => {
  const home = tmp();
  const r = runInstall(['copilot', '--skills', 'make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.copilot/skills/make-motion/SKILL.md')));
  assert.equal(fs.existsSync(path.join(home, '.copilot/skills/make-dashboard')), false);
  assert.match(r.stdout, /\/make-motion/);
});

test('gemini install also writes a TOML command per skill', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['gemini', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  const toml = fs.readFileSync(path.join(proj, '.gemini/commands/make-dashboard.toml'), 'utf8');
  assert.match(toml, /^description = ".+"$/m);
  assert.match(toml, /\{\{args\}\}/);
  assert.match(toml, /make-dashboard/);
});

test('refuses to overwrite an existing install without --force, then replaces with it', () => {
  const home = tmp();
  const proj = tmp();
  const dst = path.join(proj, '.claude/skills/make-dashboard');
  fs.mkdirSync(dst, { recursive: true });
  fs.writeFileSync(path.join(dst, 'mine.txt'), 'keep me');
  const r1 = runInstall(['claude', '--project', proj], home);
  assert.equal(r1.status, 1);
  assert.match(r1.stderr, /already exists.*--force/);
  assert.equal(fs.readFileSync(path.join(dst, 'mine.txt'), 'utf8'), 'keep me');
  const r2 = runInstall(['claude', '--project', proj, '--force'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.existsSync(path.join(dst, 'mine.txt')), false);
  assert.ok(fs.existsSync(path.join(dst, 'SKILL.md')));
});

test('--link symlinks instead of copying', () => {
  const home = tmp();
  const r = runInstall(['agents', '--link'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.lstatSync(path.join(home, '.agents/skills/make-motion')).isSymbolicLink());
});

test('usage errors exit 2', () => {
  const home = tmp();
  assert.equal(runInstall([], home).status, 2);
  assert.equal(runInstall(['emacs'], home).status, 2);
  assert.equal(runInstall(['codex', '--skills', 'nope'], home).status, 2);
  assert.equal(runInstall(['codex', '--bogus'], home).status, 2);
});
