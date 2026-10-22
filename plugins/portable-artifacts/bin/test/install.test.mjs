import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { targetsFor, agentTargetsFor, HOSTS, expandRequires, UsageError } from '../install.mjs';
import { agentFile } from '../../shared/agents.mjs';

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
  fs.mkdirSync(path.join(root, 'shared'));
  fs.copyFileSync(path.join(here, '../../shared/agents.mjs'), path.join(root, 'shared/agents.mjs'));
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
  fs.mkdirSync(path.join(root, 'shared'));
  fs.copyFileSync(path.join(here, '../../shared/agents.mjs'), path.join(root, 'shared/agents.mjs'));
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

// --- already-installed requirements, preflight, strict required names -----

const fakeTree = () => sandboxWith({ 'make-explainer': ['make-diagram', 'make-dashboard'], 'make-diagram': undefined, 'make-dashboard': undefined });
const skillDir = (home, s) => path.join(home, '.claude/skills', s);
function preInstall(home, s) {
  fs.mkdirSync(skillDir(home, s), { recursive: true });
  fs.writeFileSync(path.join(skillDir(home, s), 'mine.txt'), 'keep me');
}

test('an already-installed required skill is kept, and the dependent still installs', () => {
  const home = tmp();
  preInstall(home, 'make-diagram');
  const r = runSandbox(fakeTree(), ['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^make-diagram already installed \(required by make-explainer\)$/m);
  assert.match(r.stdout, /^also installing make-dashboard \(required by make-explainer\)$/m);
  assert.doesNotMatch(r.stdout, /installed make-diagram ->/);
  assert.equal(fs.readFileSync(path.join(skillDir(home, 'make-diagram'), 'mine.txt'), 'utf8'), 'keep me');
  assert.ok(fs.existsSync(path.join(skillDir(home, 'make-explainer'), 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(skillDir(home, 'make-dashboard'), 'SKILL.md')));
});

test('--force reinstalls required skills too', () => {
  const home = tmp();
  preInstall(home, 'make-diagram');
  const r = runSandbox(fakeTree(), ['claude', '--skills', 'make-explainer', '--force'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /already installed/);
  assert.equal(fs.existsSync(path.join(skillDir(home, 'make-diagram'), 'mine.txt')), false);
  assert.ok(fs.existsSync(path.join(skillDir(home, 'make-diagram'), 'SKILL.md')));
});

test('an explicitly requested existing skill still errors, and nothing is installed (no partial install)', () => {
  const home = tmp();
  preInstall(home, 'make-explainer');
  const r = runSandbox(fakeTree(), ['claude', '--skills', 'make-explainer'], home);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /already exists.*--force/);
  assert.equal(fs.existsSync(skillDir(home, 'make-diagram')), false);
  assert.equal(fs.existsSync(skillDir(home, 'make-dashboard')), false);
  assert.equal(fs.readFileSync(path.join(skillDir(home, 'make-explainer'), 'mine.txt'), 'utf8'), 'keep me');
});

test('malformed or unknown required names are usage errors (exit 2) and install nothing', () => {
  for (const bad of ['./make-diagram', 'make-diagram/', '../x', 'Make-Diagram', 'ghost']) {
    const home = tmp();
    const script = sandboxWith({ a: [bad], 'make-diagram': undefined });
    const r = runSandbox(script, ['claude', '--skills', 'a'], home);
    assert.equal(r.status, 2, `${bad}: ${r.stderr}`);
    assert.match(r.stderr, /a requires unknown skill/, bad);
    assert.equal(fs.existsSync(path.join(home, '.claude/skills')), false, bad);
  }
});

test('the make-motion hint also fires when make-motion is only pulled in as a requirement', () => {
  const home = tmp();
  const script = sandboxWith({ a: ['make-motion'], 'make-motion': undefined });
  const r = runSandbox(script, ['claude', '--skills', 'a'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /make-motion also needs ffmpeg/);
});

// --- artifact-builder agent files -----------------------------------------

test('agentTargetsFor maps each host and scope to its agent dirs (claude and gemini get none)', () => {
  const ctx = { home: '/h', proj: '/p' };
  const copilot = (base, rel) => ({ host: 'copilot', dir: `${base}/${rel}` });
  const codex = (base, rel) => ({ host: 'codex', dir: `${base}/${rel}` });
  const table = [
    ['claude', 'user', []],
    ['claude', 'project', []],
    ['gemini', 'user', []],
    ['gemini', 'project', []],
    ['copilot', 'user', [copilot('/h', '.copilot/agents')]],
    ['copilot', 'project', [copilot('/p', '.github/agents')]],
    ['codex', 'user', [codex('/h', '.codex/agents')]],
    ['codex', 'project', [codex('/p', '.codex/agents')]],
    ['agents', 'user', [copilot('/h', '.copilot/agents'), codex('/h', '.codex/agents')]],
    ['agents', 'project', [copilot('/p', '.github/agents'), codex('/p', '.codex/agents')]],
  ];
  for (const [host, scope, want] of table) assert.deepEqual(agentTargetsFor(host, scope, ctx), want, `${host} ${scope}`);
});

const copilotAgent = (proj) => path.join(proj, '.github/agents/artifact-builder.agent.md');
const codexAgent = (proj) => path.join(proj, '.codex/agents/artifact-builder.toml');

test('copilot --project writes the builder agent file and prints its path', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['copilot', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(copilotAgent(proj), 'utf8'), agentFile('copilot').content);
  assert.equal(fs.existsSync(codexAgent(proj)), false);
  assert.ok(r.stdout.split('\n').includes(`agent: ${copilotAgent(proj)}`), r.stdout);
});

test('codex --project writes only the codex builder agent file', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['codex', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(codexAgent(proj), 'utf8'), agentFile('codex').content);
  assert.equal(fs.existsSync(copilotAgent(proj)), false);
});

test('agents host writes both builder agent files', () => {
  const home = tmp();
  const proj = tmp();
  const r = runInstall(['agents', '--project', proj], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(copilotAgent(proj)));
  assert.ok(fs.existsSync(codexAgent(proj)));
});

test('user-scope install writes the agent file under HOME', () => {
  const home = tmp();
  const r = runInstall(['agents', '--skills', 'make-motion'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.copilot/agents/artifact-builder.agent.md')));
  assert.ok(fs.existsSync(path.join(home, '.codex/agents/artifact-builder.toml')));
});

test('claude and gemini installs write no agent file', () => {
  for (const host of ['claude', 'gemini']) {
    const home = tmp();
    const proj = tmp();
    const r = runInstall([host, '--project', proj], home);
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
    assert.doesNotMatch(r.stdout, /agent:/, host);
    assert.equal(fs.existsSync(path.join(proj, '.github/agents')), false, host);
    assert.equal(fs.existsSync(path.join(proj, '.codex/agents')), false, host);
    assert.equal(fs.existsSync(path.join(home, '.copilot/agents')), false, host);
    assert.equal(fs.existsSync(path.join(home, '.codex/agents')), false, host);
  }
});

test('an existing agent file is kept without --force and replaced with it', () => {
  const home = tmp();
  const proj = tmp();
  const file = copilotAgent(proj);
  assert.equal(runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home).status, 0);
  fs.writeFileSync(file, 'hand edited');
  // The skill dirs would make a second run refuse without --force; remove them to isolate the agent behaviour.
  fs.rmSync(path.join(proj, '.github/skills'), { recursive: true, force: true });
  const r2 = runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.split('\n').includes(`agent: kept existing ${file}`), r2.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited');
  const r3 = runInstall(['copilot', '--project', proj, '--skills', 'make-motion', '--force'], home);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('copilot').content);
  assert.ok(r3.stdout.split('\n').includes(`agent: ${file}`), r3.stdout);
});

test('an unwritable agent dir warns on stderr and the skills still install (exit 0)', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const home = tmp();
  const proj = tmp();
  const agentsDir = path.join(proj, '.github/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.chmodSync(agentsDir, 0o555);
  try {
    const r = runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /agent: could not write .*artifact-builder\.agent\.md/);
    assert.ok(fs.existsSync(path.join(proj, '.github/skills/make-motion/SKILL.md')));
    assert.equal(fs.existsSync(copilotAgent(proj)), false);
  } finally {
    fs.chmodSync(agentsDir, 0o755);
  }
});

// --- --agents-only ----------------------------------------------------------

// No automatic --no-deps here: --agents-only must reject it.
const runRaw = (args, home) => spawnSync(process.execPath, [installer, ...args], {
  encoding: 'utf8', env: { ...process.env, HOME: home },
});

test('--agents-only writes just the agent file even when the skills are already installed', () => {
  const home = tmp();
  const proj = tmp();
  assert.equal(runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home).status, 0);
  fs.rmSync(copilotAgent(proj), { force: true });
  const r = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.split('\n').includes(`agent: ${copilotAgent(proj)}`), r.stdout);
  assert.equal(fs.readFileSync(copilotAgent(proj), 'utf8'), agentFile('copilot').content);
  assert.doesNotMatch(r.stdout, /installed /);
});

test('--agents-only with an unwritable agent dir fails: exit 1, warning, no agent line', { skip: process.getuid?.() === 0 && 'root ignores file modes' }, () => {
  const home = tmp();
  const proj = tmp();
  const agentsDir = path.join(proj, '.github/agents');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.chmodSync(agentsDir, 0o555);
  try {
    const r = runRaw(['copilot', '--project', proj, '--agents-only'], home);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /could not write/);
    assert.doesNotMatch(r.stdout, /agent:/);
    assert.equal(fs.existsSync(copilotAgent(proj)), false);
  } finally {
    fs.chmodSync(agentsDir, 0o755);
  }
});

// A symlink at the target path must never be written through.
function agentsDirWithTarget(proj) {
  const dir = path.join(proj, '.github/agents');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'artifact-builder.agent.md');
}

test('a dangling symlink at the agent path is kept and its target is not created', () => {
  const home = tmp();
  const proj = tmp();
  const outside = path.join(tmp(), 'victim.md');
  const file = agentsDirWithTarget(proj);
  fs.symlinkSync(outside, file);
  const r = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.split('\n').includes(`agent: kept existing ${file}`), r.stdout);
  assert.equal(fs.existsSync(outside), false);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
});

test('a symlink to a real file is kept without --force; --force replaces the link, not the file it points to', () => {
  const home = tmp();
  const proj = tmp();
  const real = path.join(tmp(), 'precious.md');
  fs.writeFileSync(real, 'precious');
  const file = agentsDirWithTarget(proj);
  fs.symlinkSync(real, file);
  const r1 = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r1.status, 0, r1.stderr);
  assert.ok(r1.stdout.split('\n').includes(`agent: kept existing ${file}`), r1.stdout);
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  assert.equal(fs.readFileSync(real, 'utf8'), 'precious');
  const r2 = runRaw(['copilot', '--project', proj, '--agents-only', '--force'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(fs.readFileSync(real, 'utf8'), 'precious');
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('copilot').content);
});

test('a directory at the agent path is neither kept nor overwritten: warn, exit 0 in an install, 1 with --agents-only', () => {
  const home = tmp();
  const proj = tmp();
  const file = agentsDirWithTarget(proj);
  fs.mkdirSync(file);
  fs.writeFileSync(path.join(file, 'inside.txt'), 'x');
  for (const force of [[], ['--force']]) {
    const only = runRaw(['copilot', '--project', proj, '--agents-only', ...force], home);
    assert.equal(only.status, 1, only.stderr);
    assert.match(only.stderr, /agent: .*artifact-builder\.agent\.md is not a file/);
    assert.doesNotMatch(only.stdout, /agent:/);
  }
  const full = runInstall(['copilot', '--project', proj, '--skills', 'make-motion'], home);
  assert.equal(full.status, 0, full.stderr);
  assert.match(full.stderr, /is not a file/);
  assert.ok(fs.existsSync(path.join(proj, '.github/skills/make-motion/SKILL.md')));
  assert.ok(fs.statSync(file).isDirectory());
  assert.ok(fs.existsSync(path.join(file, 'inside.txt')));
});

test('inherited object keys are not hosts: constructor and toString are usage errors (exit 2)', () => {
  const home = tmp();
  for (const host of ['constructor', 'toString', '__proto__']) {
    assert.equal(runInstall([host], home).status, 2, host);
    assert.equal(runRaw([host, '--agents-only'], home).status, 2, host);
  }
  assert.deepEqual(agentTargetsFor('constructor', 'user', { home: '/h', proj: '/p' }), []);
});

test('--agents-only installs no skills', () => {
  const home = tmp();
  const proj = tmp();
  const r = runRaw(['agents', '--project', proj, '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(copilotAgent(proj)));
  assert.ok(fs.existsSync(codexAgent(proj)));
  assert.equal(fs.existsSync(path.join(proj, '.agents/skills')), false);
  assert.equal(fs.existsSync(path.join(proj, '.github/skills')), false);
});

test('--agents-only keeps an existing agent file, and --force replaces it', () => {
  const home = tmp();
  const proj = tmp();
  const file = copilotAgent(proj);
  assert.equal(runRaw(['copilot', '--project', proj, '--agents-only'], home).status, 0);
  fs.writeFileSync(file, 'hand edited');
  const r2 = runRaw(['copilot', '--project', proj, '--agents-only'], home);
  assert.equal(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.split('\n').includes(`agent: kept existing ${file}`), r2.stdout);
  assert.equal(fs.readFileSync(file, 'utf8'), 'hand edited');
  const r3 = runRaw(['copilot', '--project', proj, '--agents-only', '--force'], home);
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), agentFile('copilot').content);
});

test('--agents-only works at user scope under HOME', () => {
  const home = tmp();
  const r = runRaw(['codex', '--agents-only'], home);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(home, '.codex/agents/artifact-builder.toml')));
});

test('--agents-only on claude or gemini says there is no agent file and exits 0', () => {
  for (const host of ['claude', 'gemini']) {
    const home = tmp();
    const proj = tmp();
    const r = runRaw([host, '--project', proj, '--agents-only'], home);
    assert.equal(r.status, 0, `${host}: ${r.stderr}`);
    assert.ok(r.stdout.split('\n').includes(`no agent file for ${host}`), r.stdout);
    assert.equal(fs.readdirSync(proj).length, 0, host);
  }
});

test('--agents-only with --skills, --link or --no-deps is a usage error naming the flags', () => {
  const home = tmp();
  const proj = tmp();
  for (const flags of [['--skills', 'make-motion'], ['--link'], ['--no-deps'], ['--skills', 'make-motion', '--link']]) {
    const r = runRaw(['copilot', '--project', proj, '--agents-only', ...flags], home);
    assert.equal(r.status, 2, `${flags}: ${r.stderr}`);
    for (const f of flags.filter((x) => x.startsWith('--'))) assert.ok(r.stderr.includes(f), `${f} in: ${r.stderr}`);
    assert.match(r.stderr, /--agents-only/);
  }
  assert.equal(fs.readdirSync(proj).length, 0);
});
