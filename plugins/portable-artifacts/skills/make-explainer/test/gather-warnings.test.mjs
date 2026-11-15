// PA-19: gather names the cases where a recap would come out empty or stale: no commits on the branch, and
// uncommitted changes in the work tree (the facts cover committed work only). Each case is a warning, never a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, makeRepo, featureRepo } from './helpers/repo.mjs';

const GATHER = fileURLToPath(new URL('../scripts/gather.mjs', import.meta.url));
const run = (repo, ...extra) => spawnSync(process.execPath, [GATHER, 'git', '--repo', repo.dir, ...extra], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '' } });
const withRepo = (make, fn) => {
  const repo = make();
  try { return fn(repo); } finally { repo.cleanup(); }
};

test('a branch with no commits beyond the base: exit 0, an empty commit list, dirty false and a warning on stderr and in the facts', () => {
  withRepo(makeRepo, (repo) => {
    repo.write('README.md', '# demo\n');
    repo.commit('chore: base');
    const r = run(repo, '--json');
    assert.equal(r.status, 0, r.stderr);
    const facts = JSON.parse(r.stdout);
    assert.deepEqual(facts.commits, []);
    assert.equal(facts.dirty, false);
    assert.equal(facts.warnings.length, 1);
    assert.match(facts.warnings[0], /no commits on main beyond main/);
    assert.match(r.stderr, /^warning: no commits on main beyond main/);
    assert.match(facts.warnings[0], /--base/);
  });
});

test('a feature branch with commits and a clean tree has no warnings and says so in the facts', () => {
  withRepo(featureRepo, (repo) => {
    const r = run(repo, '--json');
    assert.equal(r.status, 0, r.stderr);
    const facts = JSON.parse(r.stdout);
    assert.equal(facts.dirty, false);
    assert.deepEqual(facts.warnings, []);
    assert.equal(r.stderr, '');
  });
});

test('uncommitted changes set dirty and warn that the facts cover committed work only', () => {
  withRepo(featureRepo, (repo) => {
    repo.write('src/auth/login.js', 'export const login = () => 99;\n');
    const tracked = JSON.parse(run(repo, '--json').stdout);
    assert.equal(tracked.dirty, true);
    assert.match(tracked.warnings[0], /uncommitted changes.*committed work only/);
    git(repo.dir, 'checkout', '--', 'src/auth/login.js');
    repo.write('notes.txt', 'new file\n');
    const untracked = JSON.parse(run(repo, '--json').stdout);
    assert.equal(untracked.dirty, true, 'an untracked file is uncommitted work too');
  });
});

test('both warnings together: no commits and a dirty tree', () => {
  withRepo(makeRepo, (repo) => {
    repo.write('README.md', '# demo\n');
    repo.commit('chore: base');
    repo.write('README.md', '# changed\n');
    const facts = JSON.parse(run(repo, '--json').stdout);
    assert.equal(facts.warnings.length, 2);
    assert.equal(facts.dirty, true);
  });
});

test('without --json the facts print alone on stdout and the warning goes to stderr', () => {
  withRepo(makeRepo, (repo) => {
    repo.write('README.md', '# demo\n');
    repo.commit('chore: base');
    const r = run(repo);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /warning: no commits/);
    assert.doesNotMatch(r.stdout, /warning:/);
  });
});
