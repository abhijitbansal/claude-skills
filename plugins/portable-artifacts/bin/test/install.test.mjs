import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { targetsFor, HOSTS, expandRequires, UsageError } from '../install.mjs';

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

// --- portableArtifacts.requires expansion ---------------------------------

// A fake skills/ tree: { name: requiresArray | undefined } -> dirs with SKILL.md (+ package.json when requires is given).
function fakeSkills(spec) {
  const src = path.join(tmp(), 'skills');
  for (const [name, requires] of Object.entries(spec)) {
    const d = path.join(src, name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: fake\n---\n`);
    if (requires) fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name, portableArtifacts: { requires } }));
  }
  return src;
}

const names = (plan) => plan.map((p) => p.skill);

test('expandRequires puts required skills first, in declared order, and names who needed them', () => {
  const src = fakeSkills({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
  const plan = expandRequires(['make-explainer'], src);
  assert.deepEqual(names(plan), ['make-diagram', 'make-dashboard', 'make-explainer']);
  assert.deepEqual(plan.map((p) => p.requiredBy ?? null), ['make-explainer', 'make-explainer', null]);
});

test('expandRequires dedups a skill that is also listed explicitly and does not call it "also installing"', () => {
  const src = fakeSkills({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
  const plan = expandRequires(['make-dashboard', 'make-explainer'], src);
  assert.deepEqual(names(plan), ['make-dashboard', 'make-diagram', 'make-explainer']);
  assert.equal(plan.find((p) => p.skill === 'make-dashboard').requiredBy, undefined);
  assert.equal(plan.find((p) => p.skill === 'make-diagram').requiredBy, 'make-explainer');
});

test('expandRequires follows requirements transitively, dependency first', () => {
  const src = fakeSkills({ a: ['b'], b: ['c'], c: undefined });
  const plan = expandRequires(['a'], src);
  assert.deepEqual(names(plan), ['c', 'b', 'a']);
  assert.equal(plan[0].requiredBy, 'b');
});

test('expandRequires reports a cycle as a UsageError naming it', () => {
  const src = fakeSkills({ a: ['b'], b: ['a'] });
  assert.throws(() => expandRequires(['a'], src), (e) => e instanceof UsageError && /dependency cycle: a -> b -> a/.test(e.message));
});

test('expandRequires rejects an unknown required skill and a malformed requires list', () => {
  const missing = fakeSkills({ a: ['ghost'] });
  assert.throws(() => expandRequires(['a'], missing), (e) => e instanceof UsageError && /a requires unknown skill "ghost"/.test(e.message));
  const bad = fakeSkills({ a: [] });
  fs.writeFileSync(path.join(bad, 'a/package.json'), JSON.stringify({ portableArtifacts: { requires: 'b' } }));
  assert.throws(() => expandRequires(['a'], bad), (e) => e instanceof UsageError && /a: portableArtifacts\.requires must be an array of skill names/.test(e.message));
});

test('a skill with no package.json requires nothing', () => {
  const src = fakeSkills({ a: undefined });
  assert.deepEqual(names(expandRequires(['a'], src)), ['a']);
});

// End to end against a sandbox copy of install.mjs with fake skills.
function sandboxWith(spec) {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin'));
  fs.copyFileSync(installer, path.join(root, 'bin/install.mjs'));
  const skills = fakeSkills(spec);
  fs.renameSync(skills, path.join(root, 'skills'));
  return path.join(root, 'bin/install.mjs');
}
const runSandbox = (script, args, home) => spawnSync(process.execPath, [script, ...args, '--no-deps'], {
  encoding: 'utf8', env: { ...process.env, HOME: home },
});

test('installing make-explainer installs its required skills first and says why', () => {
  const home = tmp();
  const script = sandboxWith({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
  const r = runSandbox(script, ['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter((l) => /^(also installing|installed) /.test(l));
  assert.deepEqual(lines.map((l) => l.replace(/ ->.*/, '')), [
    'also installing make-diagram (required by make-explainer)',
    'also installing make-dashboard (required by make-explainer)',
    'installed make-diagram',
    'installed make-dashboard',
    'installed make-explainer',
  ]);
  for (const s of ['make-explainer', 'make-diagram', 'make-dashboard']) assert.ok(fs.existsSync(path.join(home, '.claude/skills', s, 'SKILL.md')), s);
});

test('listing a required skill explicitly installs it once, with no "also installing" for it', () => {
  const home = tmp();
  const script = sandboxWith({ 'make-explainer': ['make-diagram'], 'make-diagram': undefined });
  const r = runSandbox(script, ['claude', '--skills', 'make-diagram,make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal((r.stdout.match(/installed make-diagram/g) || []).length, 1);
  assert.doesNotMatch(r.stdout, /also installing/);
});

test('a requires cycle is a usage error (exit 2) and installs nothing', () => {
  const home = tmp();
  const script = sandboxWith({ a: ['b'], b: ['a'] });
  const r = runSandbox(script, ['claude', '--skills', 'a'], home);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /dependency cycle: a -> b -> a/);
  assert.equal(fs.existsSync(path.join(home, '.claude/skills')), false);
});

test('the real make-explainer pulls in make-diagram and make-dashboard', () => {
  const home = tmp();
  const r = runInstall(['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  const order = [...r.stdout.matchAll(/^installed (\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(order, ['make-diagram', 'make-dashboard', 'make-explainer']);
});
