// A throwaway git repository for the gather/scaffold tests: built in os.tmpdir(),
// removed by cleanup(). Git runs with argument arrays and a scrubbed environment so
// the developer's own git config (signing, hooks, templates) cannot change a test.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_SYSTEM: os.devNull,
  GIT_AUTHOR_NAME: 'Test Author',
  GIT_AUTHOR_EMAIL: 'author@example.com',
  GIT_COMMITTER_NAME: 'Test Author',
  GIT_COMMITTER_EMAIL: 'author@example.com',
};

export function git(cwd, ...args) {
  const env = { ...process.env, ...GIT_ENV };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

/**
 * -> { dir, write(rel, content), remove(rel), commit(message, date?), cleanup() }.
 * `dir` is a realpath so it compares equal to what git reports (macOS /var -> /private/var).
 * The initial branch is `main` unless `branch` says otherwise.
 */
export function makeRepo({ branch = 'main' } = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-repo-')));
  git(dir, 'init', '-q', '-b', branch);
  return repoAt(dir, dir);
}

/** A clone of `source` (a repo from makeRepo) in its own temp folder; `flags` go to `git clone` (e.g. '--depth', '1', '--bare'). */
export function cloneRepo(source, ...flags) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-clone-')));
  const dir = path.join(root, 'clone');
  git(root, 'clone', '-q', ...flags, `file://${source.dir}`, dir);
  return repoAt(dir, root);
}

// `removeDir` is what cleanup() deletes (the repo itself, or the folder a clone lives in).
function repoAt(dir, removeDir) {
  let tick = 0;
  return {
    dir,
    write(rel, content) {
      const abs = path.join(dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    },
    remove(rel) {
      fs.rmSync(path.join(dir, rel));
    },
    /** Stages everything and commits; each commit gets a distinct, fixed date unless one is given. */
    commit(message, date) {
      const when = date ?? `2026-10-${String(1 + tick++).padStart(2, '0')}T12:00:00Z`;
      git(dir, 'add', '-A');
      const env = { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
      const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--allow-empty', '-m', message], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, ...GIT_ENV, ...env },
      });
      if (r.status !== 0) throw new Error(`commit failed: ${r.stderr}`);
      return git(dir, 'rev-parse', 'HEAD');
    },
    cleanup() {
      fs.rmSync(removeDir, { recursive: true, force: true });
    },
  };
}

/** The usual fixture: `main` with a README, then branch feat/login with a mix of changes. */
export function featureRepo() {
  const repo = makeRepo();
  repo.write('README.md', '# demo\n');
  repo.write('src/old name.js', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  repo.write('docs/gone.md', 'bye\n');
  repo.commit('chore: base');
  git(repo.dir, 'checkout', '-q', '-b', 'feat/login');
  repo.write('src/auth/login.js', 'export const login = () => 1;\nexport const logout = () => 2;\n');
  repo.write('docs/guide.md', 'guide\n');
  repo.commit('feat: add login');
  git(repo.dir, 'mv', 'src/old name.js', 'src/new name.js');
  repo.remove('docs/gone.md');
  repo.write('test/login.test.js', 'import test from "node:test";\n');
  repo.write('src/auth/login.js', 'export const login = () => 1;\nexport const logout = () => 3;\nexport const me = () => 4;\n');
  repo.commit('refactor: rename file, drop the old doc');
  return repo;
}
