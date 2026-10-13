// Facts about a branch, read from git. Git always runs through spawnSync with an
// argument array (never a shell string) and with `-z` output, so paths with spaces,
// quotes, tabs, newlines or non-ASCII letters come back exact. Every failure that a
// user can fix (not a repository, a base that does not exist, no commits, no shared
// history) is a UsageError that names the fix.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { UsageError } from '../../shared/cli.mjs';

const MAX_BUFFER = 256 * 1024 * 1024;
const DEFAULT_BASES = ['main', 'master', 'origin/main', 'origin/master'];
const SHOWN_BRANCHES = 10;
const SHORT_SHA = 7;
const CHANGES = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', T: 'modified' };
const SCRUBBED_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_PAGER'];

// Paths that look like tests: a test folder, or a test-shaped file name.
const TEST_DIR = /(^|\/)(tests?|__tests__|specs?|e2e)\/|(^|\/)[^/]*Tests\//i;
const TEST_FILE = /(^|\/)test_[^/]*$|[._-]tests?\.[A-Za-z0-9]+$|[._-]spec\.[A-Za-z0-9]+$|[A-Za-z0-9]Tests?\.[A-Za-z0-9]+$/;

const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function run(cwd, args) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
  for (const key of SCRUBBED_ENV) delete env[key];
  const r = spawnSync('git', ['--no-pager', '-c', 'core.quotepath=off', '-c', 'log.showSignature=false', ...args], {
    cwd, encoding: 'utf8', env, maxBuffer: MAX_BUFFER,
  });
  if (r.error) {
    if (r.error.code === 'ENOENT') throw new UsageError('git is not installed or not on PATH; install it, then retry');
    throw new UsageError(`cannot run git: ${r.error.code ?? r.error.message}`);
  }
  return { ok: r.status === 0, out: r.stdout, err: r.stderr.trim() };
}

const nulFields = (text) => text.split('\0').filter((f) => f !== '');

/** The repository's work-tree root for a folder inside it. */
export function repoRoot(dir) {
  let stat;
  try {
    stat = fs.statSync(dir);
  } catch {
    throw new UsageError(`--repo ${dir}: no such folder; pass a folder inside a git repository`);
  }
  if (!stat.isDirectory()) throw new UsageError(`--repo ${dir}: not a folder; pass a folder inside a git repository`);
  const top = run(dir, ['rev-parse', '--show-toplevel']);
  if (!top.ok) throw new UsageError(`${dir} is not a git repository; pass --repo <a folder inside one>`);
  return top.out.trim();
}

const commitExists = (repo, ref) => run(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok;

function existingBranches(repo) {
  const refs = run(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes']);
  // A remote's default-branch pointer shows up as "origin/HEAD" or plain "origin"; neither is a branch.
  const names = refs.ok ? refs.out.split('\n').filter((n) => n && !n.endsWith('/HEAD') && n !== 'origin') : [];
  const shown = names.slice(0, SHOWN_BRANCHES);
  return shown.length === names.length ? shown.join(', ') : `${shown.join(', ')}, …`;
}

function resolveBase(repo, requested) {
  if (requested !== undefined) {
    if (requested.startsWith('-')) throw new UsageError(`--base ${requested}: a branch name cannot start with "-"; pass --base <branch>`);
    if (commitExists(repo, requested)) return requested;
    throw new UsageError(`base "${requested}" does not exist; branches that do: ${existingBranches(repo)}; pass --base <branch>`);
  }
  const found = DEFAULT_BASES.find((b) => commitExists(repo, b));
  if (found) return found;
  throw new UsageError(`no main or master branch found; branches that do exist: ${existingBranches(repo)}; pass --base <branch>`);
}

function currentBranch(repo) {
  const named = run(repo, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (named.ok && named.out.trim()) return { branch: named.out.trim(), detached: false };
  const sha = run(repo, ['rev-parse', 'HEAD']).out.trim();
  return { branch: `detached-${sha.slice(0, SHORT_SHA)}`, detached: true };
}

function readCommits(repo, range) {
  const log = run(repo, ['log', '-z', '--reverse', '--no-color', '--format=%H%x1f%cs%x1f%s', range, '--']);
  if (!log.ok) throw new UsageError(`cannot read the commit list: ${log.err}`);
  return nulFields(log.out).map((record) => {
    const [sha, date, ...subject] = record.split('\x1f');
    return { sha, date, subject: subject.join('\x1f') };
  });
}

// `--name-status -z`: status NUL path NUL [new path NUL for a rename].
function readStatuses(text) {
  const fields = nulFields(text);
  const rows = [];
  for (let i = 0; i < fields.length;) {
    const code = fields[i][0];
    if (code === 'R' || code === 'C') {
      rows.push({ code, oldPath: fields[i + 1], path: fields[i + 2] });
      i += 3;
    } else {
      rows.push({ code, path: fields[i + 1] });
      i += 2;
    }
  }
  return rows;
}

// `--numstat -z`: "add\tdel\tpath" NUL; a rename is "add\tdel\t" NUL old NUL new NUL. A binary file has "-" counts.
function readCounts(text) {
  const fields = text.split('\0');
  const counts = new Map();
  for (let i = 0; i < fields.length; i++) {
    const m = /^([^\t]*)\t([^\t]*)\t([\s\S]*)$/.exec(fields[i]);
    if (!m) continue;
    let file = m[3];
    if (file === '') {
      file = fields[i + 2];
      i += 2;
    }
    const binary = m[1] === '-' || m[2] === '-';
    counts.set(file, binary ? { add: null, del: null, binary: true } : { add: Number(m[1]), del: Number(m[2]), binary: false });
  }
  return counts;
}

function readFiles(repo, from) {
  const flags = ['diff', '-z', '-M', '--no-ext-diff', '--no-color'];
  const status = run(repo, [...flags, '--name-status', from, 'HEAD', '--']);
  const numstat = run(repo, [...flags, '--numstat', from, 'HEAD', '--']);
  if (!status.ok || !numstat.ok) throw new UsageError(`cannot read the changed files: ${status.err || numstat.err}`);
  const counts = readCounts(numstat.out);
  return readStatuses(status.out)
    .map(({ code, path: file, oldPath }) => ({
      path: file,
      ...(oldPath === undefined ? {} : { oldPath }),
      change: CHANGES[code] ?? 'modified',
      ...(counts.get(file) ?? { add: 0, del: 0, binary: false }),
    }))
    .sort((a, b) => byCodeUnit(a.path, b.path));
}

export const isTestPath = (p) => TEST_DIR.test(p) || TEST_FILE.test(p);

/**
 * Facts for the branch checked out in `dir`, measured against `base` (default: main, master,
 * origin/main, origin/master). Committed work only; the working tree is never read.
 * -> { repo, branch, detached, base, mergeBase, commits: [{ sha, date, subject }],
 *      files: [{ path, oldPath?, change, add, del, binary }], tests: [path], date }
 */
export function gatherGit({ repo: dir = '.', base } = {}) {
  const root = repoRoot(path.resolve(dir));
  if (!commitExists(root, 'HEAD')) throw new UsageError(`${root} has no commits yet; commit something, then retry`);
  const baseRef = resolveBase(root, base);
  const merge = run(root, ['merge-base', baseRef, 'HEAD']);
  if (!merge.ok || !merge.out.trim()) {
    throw new UsageError(`this branch and "${baseRef}" have no common history; pass --base <the branch this one started from>`);
  }
  const mergeBase = merge.out.trim();
  const files = readFiles(root, mergeBase);
  const tip = run(root, ['log', '-1', '--format=%cs', 'HEAD', '--']);
  return {
    repo: path.basename(root),
    ...currentBranch(root),
    base: baseRef,
    mergeBase,
    commits: readCommits(root, `${mergeBase}..HEAD`),
    files,
    tests: files.filter((f) => f.change !== 'deleted' && isTestPath(f.path)).map((f) => f.path),
    date: tip.out.trim(),
  };
}
