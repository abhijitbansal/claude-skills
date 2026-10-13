import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { git, makeRepo, featureRepo } from './helpers/repo.mjs';

const GATHER = fileURLToPath(new URL('../scripts/gather.mjs', import.meta.url));
const run = (args, env = {}) => spawnSync(process.execPath, [GATHER, ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', ...env } });
const gather = (repo, ...extra) => {
  const r = run(['git', '--repo', repo.dir, '--json', ...extra]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  return JSON.parse(r.stdout);
};
const withRepo = (make, fn) => {
  const repo = make();
  try { return fn(repo); } finally { repo.cleanup(); }
};
const byPath = (facts) => Object.fromEntries(facts.files.map((f) => [f.path, f]));

test('a feature branch: branch, base, merge base, commits, files, tests and date', () => {
  withRepo(featureRepo, (repo) => {
    const facts = gather(repo);
    assert.equal(facts.branch, 'feat/login');
    assert.equal(facts.detached, false);
    assert.equal(facts.base, 'main');
    assert.equal(facts.repo, path.basename(repo.dir));
    assert.equal(facts.mergeBase, git(repo.dir, 'rev-parse', 'main'));
    assert.deepEqual(facts.commits.map((c) => c.subject), ['feat: add login', 'refactor: rename file, drop the old doc']);
    assert.match(facts.commits[0].sha, /^[0-9a-f]{40}$/);
    assert.equal(facts.commits[0].date, '2026-10-02');
    assert.equal(facts.date, '2026-10-03');
    assert.deepEqual(facts.tests, ['test/login.test.js']);
    const files = byPath(facts);
    assert.deepEqual(files['src/auth/login.js'], { path: 'src/auth/login.js', change: 'added', add: 3, del: 0, binary: false });
    assert.equal(files['docs/gone.md'].change, 'deleted');
    assert.equal(files['docs/gone.md'].del, 1);
    assert.equal(files['docs/guide.md'].change, 'added');
  });
});

test('the default output is pretty JSON; --json is one compact line', () => {
  withRepo(featureRepo, (repo) => {
    const pretty = run(['git', '--repo', repo.dir]);
    assert.equal(pretty.status, 0, pretty.stderr);
    assert.ok(pretty.stdout.split('\n').length > 5);
    const compact = run(['git', '--repo', repo.dir, '--json']);
    assert.equal(compact.stdout.trim().split('\n').length, 1);
    assert.deepEqual(JSON.parse(pretty.stdout), JSON.parse(compact.stdout));
  });
});

test('uncommitted work is not part of the facts', () => {
  withRepo(featureRepo, (repo) => {
    repo.write('scratch.txt', 'x\n');
    assert.ok(!gather(repo).files.some((f) => f.path === 'scratch.txt'));
  });
});

// ---- Review Focus 5: unusual repositories -------------------------------------------------

test('detached HEAD: names the commit instead of crashing', () => {
  withRepo(featureRepo, (repo) => {
    const tip = git(repo.dir, 'rev-parse', 'HEAD');
    git(repo.dir, 'checkout', '-q', '--detach');
    const facts = gather(repo);
    assert.equal(facts.detached, true);
    assert.equal(facts.branch, `detached-${tip.slice(0, 7)}`);
    assert.equal(facts.commits.length, 2);
    assert.ok(facts.files.length > 0);
  });
});

test('a base branch that does not exist: exit 2, the message names --base and the branches that exist', () => {
  withRepo(featureRepo, (repo) => {
    const r = run(['git', '--repo', repo.dir, '--base', 'develop']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /base "develop" does not exist/);
    assert.match(r.stderr, /--base/);
    assert.match(r.stderr, /feat\/login/);
    assert.match(r.stderr, /main/);
    assert.equal(r.stderr.trim().split('\n').length, 1);
  });
});

test('--json turns the same failure into one JSON error line on stdout', () => {
  withRepo(featureRepo, (repo) => {
    const r = run(['git', '--repo', repo.dir, '--base', 'develop', '--json']);
    assert.equal(r.status, 2);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, false);
    assert.match(out.errors[0].message, /--base/);
  });
});

test('no main branch and no --base: the default fails with the branches that do exist', () => {
  withRepo(() => {
    const repo = makeRepo({ branch: 'trunk' });
    repo.write('a.txt', 'a\n');
    repo.commit('init');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    return repo;
  }, (repo) => {
    const r = run(['git', '--repo', repo.dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /pass --base/);
    assert.match(r.stderr, /trunk/);
    assert.equal(run(['git', '--repo', repo.dir, '--base', 'trunk']).status, 0);
  });
});

test('the default base falls back to master when there is no main', () => {
  withRepo(() => {
    const repo = makeRepo({ branch: 'master' });
    repo.write('a.txt', 'a\n');
    repo.commit('init');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    repo.write('b.txt', 'b\n');
    repo.commit('add b');
    return repo;
  }, (repo) => {
    const facts = gather(repo);
    assert.equal(facts.base, 'master');
    assert.deepEqual(facts.files.map((f) => f.path), ['b.txt']);
  });
});

test('a base that looks like an option is refused', () => {
  withRepo(featureRepo, (repo) => {
    const r = run(['git', '--repo', repo.dir, '--base', '--output=/tmp/x']);
    assert.equal(r.status, 2);
    const r2 = run(['git', '--repo', repo.dir, '--base=-x']);
    assert.equal(r2.status, 2);
    assert.match(r2.stderr, /--base/);
  });
});

test('a rename is one renamed file with its old path, not a delete plus an add', () => {
  withRepo(featureRepo, (repo) => {
    const f = byPath(gather(repo))['src/new name.js'];
    assert.equal(f.change, 'renamed');
    assert.equal(f.oldPath, 'src/old name.js');
    assert.equal(f.add, 0);
    assert.equal(f.del, 0);
    assert.ok(!('src/old name.js' in byPath(gather(repo))));
  });
});

test('a rename with edits keeps the edit counts', () => {
  withRepo(() => {
    const repo = makeRepo();
    repo.write('lib/a.txt', Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n');
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    git(repo.dir, 'mv', 'lib/a.txt', 'lib/b.txt');
    repo.write('lib/b.txt', Array.from({ length: 20 }, (_, i) => (i === 3 ? 'changed' : `line ${i}`)).join('\n') + '\n');
    repo.commit('rename and edit');
    return repo;
  }, (repo) => {
    const f = byPath(gather(repo))['lib/b.txt'];
    assert.equal(f.change, 'renamed');
    assert.equal(f.oldPath, 'lib/a.txt');
    assert.deepEqual([f.add, f.del], [1, 1]);
  });
});

test('a binary file is flagged and carries no line counts', () => {
  withRepo(() => {
    const repo = makeRepo();
    repo.write('a.txt', 'a\n');
    repo.write('img.bin', Buffer.from([0, 1, 2, 3, 0, 255, 0, 0]));
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    repo.write('logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 1, 0]));
    repo.write('img.bin', Buffer.from([0, 1, 2, 9, 0, 255, 0, 0, 7]));
    repo.write('a.txt', 'a\nb\n');
    repo.commit('binary changes');
    return repo;
  }, (repo) => {
    const files = byPath(gather(repo));
    assert.deepEqual(files['logo.png'], { path: 'logo.png', change: 'added', add: null, del: null, binary: true });
    assert.equal(files['img.bin'].binary, true);
    assert.equal(files['img.bin'].change, 'modified');
    assert.deepEqual([files['a.txt'].add, files['a.txt'].del, files['a.txt'].binary], [1, 0, false]);
  });
});

test('paths with spaces, quotes, tabs and non-ASCII letters come back exact', () => {
  const awkward = ['my docs/read me.md', 'q"uote.txt', 'tab\there.txt', 'café/naïve.txt', 'new\nline.txt'];
  withRepo(() => {
    const repo = makeRepo();
    repo.write('a.txt', 'a\n');
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    for (const p of awkward) repo.write(p, 'x\n');
    repo.commit('awkward names');
    return repo;
  }, (repo) => {
    const facts = gather(repo);
    assert.deepEqual(facts.files.map((f) => f.path).sort(), [...awkward].sort());
    for (const f of facts.files) assert.deepEqual([f.change, f.add, f.del], ['added', 1, 0]);
  });
});

test('an awkward commit subject survives', () => {
  withRepo(() => {
    const repo = makeRepo();
    repo.write('a.txt', 'a\n');
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    repo.write('b.txt', 'b\n');
    repo.commit('fix: "quoted" | pipe \\ backslash and <angle> é');
    return repo;
  }, (repo) => {
    assert.equal(gather(repo).commits[0].subject, 'fix: "quoted" | pipe \\ backslash and <angle> é');
  });
});

test('--repo may be a subfolder of the repository', () => {
  withRepo(featureRepo, (repo) => {
    const r = run(['git', '--repo', path.join(repo.dir, 'src'), '--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).repo, path.basename(repo.dir));
  });
});

test('on the base branch itself: empty commits and files, not an error', () => {
  withRepo(featureRepo, (repo) => {
    git(repo.dir, 'checkout', '-q', 'main');
    const facts = gather(repo);
    assert.equal(facts.branch, 'main');
    assert.deepEqual([facts.commits, facts.files, facts.tests], [[], [], []]);
  });
});

test('a repository with no commits is a clear error', () => {
  const repo = makeRepo();
  try {
    const r = run(['git', '--repo', repo.dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no commits/);
  } finally { repo.cleanup(); }
});

test('a branch with no common history with the base is a clear error', () => {
  withRepo(() => {
    const repo = makeRepo();
    repo.write('a.txt', 'a\n');
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '--orphan', 'island');
    repo.write('b.txt', 'b\n');
    repo.commit('island');
    return repo;
  }, (repo) => {
    const r = run(['git', '--repo', repo.dir]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /no common history/);
  });
});

test('not a repository, a missing folder and a file as --repo each say so', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-nogit-')));
  try {
    const plain = run(['git', '--repo', dir]);
    assert.equal(plain.status, 2);
    assert.match(plain.stderr, /not a git repository/);
    const missing = run(['git', '--repo', path.join(dir, 'nope')]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /no such folder/);
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x');
    const file = run(['git', '--repo', path.join(dir, 'f.txt')]);
    assert.equal(file.status, 2);
    assert.match(file.stderr, /not a folder/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a GIT_DIR in the environment does not redirect gather', () => {
  withRepo(featureRepo, (repo) => {
    const other = makeRepo();
    try {
      other.write('z.txt', 'z\n');
      other.commit('other');
      const r = run(['git', '--repo', repo.dir, '--json'], { GIT_DIR: path.join(other.dir, '.git') });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).branch, 'feat/login');
    } finally { other.cleanup(); }
  });
});

test('gather leaves the repository exactly as it found it', () => {
  withRepo(featureRepo, (repo) => {
    const before = git(repo.dir, 'status', '--porcelain=v2', '--branch');
    gather(repo);
    assert.equal(git(repo.dir, 'status', '--porcelain=v2', '--branch'), before);
  });
});

test('test files are found by folder and by name, deleted ones are not', () => {
  withRepo(() => {
    const repo = makeRepo();
    repo.write('old.test.js', 'x\n');
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '-b', 'topic');
    for (const p of ['tests/a.js', 'src/__tests__/b.js', 'src/c.spec.ts', 'pkg/d_test.go', 'tests_py/test_e.py', 'App/FooTests.swift', 'src/contest.js', 'src/latest.js']) repo.write(p, 'x\n');
    repo.remove('old.test.js');
    repo.commit('tests');
    return repo;
  }, (repo) => {
    assert.deepEqual(gather(repo).tests, ['App/FooTests.swift', 'pkg/d_test.go', 'src/__tests__/b.js', 'src/c.spec.ts', 'tests/a.js', 'tests_py/test_e.py']);
  });
});

// ---- command line ---------------------------------------------------------------------------

test('unknown and misspelled flags, a missing subcommand and an unknown one are rejected with the accepted list', () => {
  withRepo(featureRepo, (repo) => {
    const flag = run(['git', '--repo', repo.dir, '--bsae', 'main']);
    assert.equal(flag.status, 2);
    assert.match(flag.stderr, /usage: node scripts\/gather\.mjs git/);
    assert.equal(flag.stdout, '');
    const none = run([]);
    assert.equal(none.status, 2);
    assert.match(none.stderr, /expected a subcommand/);
    const other = run(['svn']);
    assert.equal(other.status, 2);
    assert.match(other.stderr, /unknown source "svn".*git/);
    const extra = run(['git', 'extra', '--repo', repo.dir]);
    assert.equal(extra.status, 2);
  });
});
