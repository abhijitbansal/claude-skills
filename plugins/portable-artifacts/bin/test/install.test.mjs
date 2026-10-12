import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { targetsFor, HOSTS } from '../install.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const installer = path.resolve(here, '../install.mjs');
const made = [];
const tmp = () => { const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pa-install-'))); made.push(d); return d; };
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

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

test('empty --project is a usage error, not a silent user-scope install', () => {
  const home = tmp();
  const r = runInstall(['claude', '--project='], home);
  assert.equal(r.status, 2);
  assert.equal(fs.existsSync(path.join(home, '.claude/skills')), false);
});

test('duplicate --skills entries install once', () => {
  const home = tmp();
  const r = runInstall(['claude', '--skills', 'make-motion,make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/installed make-motion/g) || []).length, 1);
});

// Sandbox: a copy of install.mjs next to a fake skills/ tree, so a regression
// here can only ever delete throwaway files, never the real skills.
function sandbox() {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'));
  fs.copyFileSync(installer, path.join(root, 'bin/install.mjs'));
  fs.mkdirSync(path.join(root, 'skills/make-motion'), { recursive: true });
  fs.writeFileSync(path.join(root, 'skills/make-motion/SKILL.md'), '---\nname: make-motion\ndescription: fake\n---\n');
  return root;
}

test('--force refuses when the target resolves to the source skill (never deletes the source)', () => {
  const home = tmp();
  const root = sandbox();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.symlinkSync(path.join(root, 'skills'), path.join(home, '.claude/skills'), 'dir');
  const r = spawnSync(process.execPath, [path.join(root, 'bin/install.mjs'), 'claude', '--force', '--no-deps'], {
    encoding: 'utf8', env: { ...process.env, HOME: home },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is the source skill itself/);
  assert.ok(fs.existsSync(path.join(root, 'skills/make-motion/SKILL.md')));
});

test('a failed npm ci removes the half-installed copy and says so', () => {
  const home = tmp();
  const bin = tmp();
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\necho boom >&2\nexit 1\n', { mode: 0o755 });
  const r = spawnSync(process.execPath, [installer, 'claude', '--skills', 'make-motion'], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /npm ci failed.*removed/);
  assert.equal(fs.existsSync(path.join(home, '.claude/skills/make-motion')), false);
});

// Fake npm that records its argv, so the exact `npm ci` flags can be pinned.
function npmArgsFor(extraArgs) {
  const home = tmp();
  const bin = tmp();
  const log = path.join(bin, 'npm-args.txt');
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh\necho "$@" >> "${log}"\nexit 0\n`, { mode: 0o755 });
  const r = spawnSync(process.execPath, [installer, 'claude', '--skills', 'make-motion', ...extraArgs], {
    encoding: 'utf8', env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0, r.stderr);
  return fs.readFileSync(log, 'utf8').trim();
}

test('a copied install runs npm ci --omit=dev', () => {
  assert.match(npmArgsFor([]), /^ci --omit=dev\b/);
});

test('a --link install runs npm ci without --omit=dev (it would wipe the checkout dev deps)', () => {
  const args = npmArgsFor(['--link']);
  assert.match(args, /^ci\b/);
  assert.doesNotMatch(args, /--omit/);
});

test('usage errors exit 2', () => {
  const home = tmp();
  assert.equal(runInstall([], home).status, 2);
  assert.equal(runInstall(['emacs'], home).status, 2);
  assert.equal(runInstall(['codex', '--skills', 'nope'], home).status, 2);
  assert.equal(runInstall(['codex', '--bogus'], home).status, 2);
});
