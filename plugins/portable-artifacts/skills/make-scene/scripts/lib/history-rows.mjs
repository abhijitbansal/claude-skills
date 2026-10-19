// Commit history -> scene rows: commits per folder per ISO week, read with a local
// `git log --numstat`. Git runs with argument arrays and a scrubbed environment (the
// approach of PA/eval/lib.mjs createFixtureRepo), so the user's own git config
// (signing, hooks, templates) cannot change the result.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { UsageError } from '../../shared/cli.mjs';
import { LIMITS } from './schema.mjs';

export const ROOT_GROUP = '(root)';
export const OTHER_GROUP = '(other)';
const ELLIPSIS = '…';
const MAX_BUFFER = 256 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HEADER = /^[0-9a-f]{40,64}\t(\S+)$/;
const NUMSTAT = /^(?:\d+|-)\t(?:\d+|-)\t([\s\S]+)$/;
// These GIT_* variables point git at another repository, object store, index, discovery root or config than --repo
// names, so the child gets none of them (the same set as make-explainer's git.mjs, plus the config injectors).
const REDIRECTING_ENV = new Set([
  'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_COMMON_DIR', 'GIT_NAMESPACE', 'GIT_CEILING_DIRECTORIES', 'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
]);
const CONFIG_PAIR_ENV = /^GIT_CONFIG_(?:KEY|VALUE)_\d+$/;

function gitEnv() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !REDIRECTING_ENV.has(k) && !CONFIG_PAIR_ENV.test(k)));
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_CONFIG_SYSTEM = os.devNull;
  env.GIT_OPTIONAL_LOCKS = '0';
  env.GIT_TERMINAL_PROMPT = '0';
  return env;
}

// The ISO week of a date, in UTC: "2026-W43". The ISO year belongs to the Thursday of the week.
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// The Monday (00:00 UTC) that starts the ISO week holding `date`.
function weekStart(date) {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(day.getTime() - (((day.getUTCDay() + 6) % 7) * DAY_MS));
}

// Runs a scrubbed git in `repo` and returns its stdout.
function runGit(repo, args) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv(), maxBuffer: MAX_BUFFER });
  if (r.error) {
    if (r.error.code === 'ENOBUFS') throw new UsageError(`git log output in ${repo} is over 256 MB; use a smaller --weeks`);
    throw new UsageError(`git could not run: ${r.error.code ?? r.error.message}`);
  }
  if (r.status !== 0) {
    const why = r.stderr.trim().split('\n')[0] || `exit ${r.status}`;
    throw new UsageError(`${repo} is not a git repository with commits (${why})`);
  }
  return r.stdout;
}

// Where `repo` sits inside its repository: "plugins/x" for a subfolder, "" at the repository root.
const folderWithin = (repo) => runGit(repo, ['rev-parse', '--show-prefix']).trim().replace(/\/$/, '');

function runGitLog(repo, sinceIso, { subfolder }) {
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UsageError(`${repo} is not a folder`);
  // -z: paths come back exact (no C-quoting of quotes, backslashes, tabs or newlines), NUL-separated.
  // In a subfolder, --relative keeps only that folder's changes and names them from it; the pathspec limits the walk too.
  const args = [
    '--no-pager', '-c', 'log.showSignature=false',
    'log', '-z', '--numstat', '--no-renames', '--no-merges', '--no-textconv', '--no-ext-diff',
    '--format=%H%x09%cI', `--since=${sinceIso}`,
    ...(subfolder ? ['--relative', '--', '.'] : []),
  ];
  return runGit(repo, args);
}

// The folder a changed file counts under: its first `depth` folders (whole, never cut), or (root) for a top-level file.
function groupOf(file, depth) {
  const folders = file.split('/').slice(0, -1);
  return folders.length === 0 ? ROOT_GROUP : folders.slice(0, depth).join('/');
}

// A group name that fits the scene's limit: a long path loses its leading folders (…/make-scene/test), never its tail.
function shortened(name) {
  const chars = [...name];
  if (chars.length <= LIMITS.group) return name;
  const folders = name.split('/');
  for (let from = 1; from < folders.length; from++) {
    const tail = `${ELLIPSIS}/${folders.slice(from).join('/')}`;
    if ([...tail].length <= LIMITS.group) return tail;
  }
  return `${ELLIPSIS}${chars.slice(-(LIMITS.group - 1)).join('')}`; // one folder name longer than the limit: its end
}

// The display name of every group, by full name. Distinct folders keep distinct names: when two shortened names
// collide, the folders (in sorted order) after the first take " (2)", " (3)"... and are cut further to make room.
function displayNames(fullNames) {
  const byShort = new Map();
  for (const full of [...fullNames].sort()) {
    const short = shortened(full);
    byShort.set(short, [...(byShort.get(short) ?? []), full]);
  }
  const names = new Map();
  for (const [short, fulls] of byShort) {
    fulls.forEach((full, i) => {
      if (i === 0) return names.set(full, short);
      const suffix = ` (${i + 1})`;
      const room = [...short].slice(0, LIMITS.group - [...suffix].length).join('');
      return names.set(full, `${room}${suffix}`);
    });
  }
  return names;
}

// `log -z --numstat --format=%H%x09%cI`: NUL-separated fields, a header "hash<TAB>date" then one "add<TAB>del<TAB>path"
// per file (the first of them behind a newline). -> [{ when, groups: Set<string> }], commits with changed files only.
function parseCommits(log, depth) {
  const commits = [];
  let current = null;
  for (const raw of log.split('\0')) {
    const field = raw.startsWith('\n') ? raw.slice(1) : raw;
    const file = NUMSTAT.exec(field)?.[1];
    if (file !== undefined) {
      if (current) current.groups.add(groupOf(file, depth));
      continue;
    }
    const header = HEADER.exec(field);
    if (!header) continue;
    const when = new Date(header[1]);
    current = Number.isNaN(when.getTime()) ? null : { when, groups: new Set() };
    if (current) commits.push(current);
  }
  return commits.filter((c) => c.groups.size > 0);
}

// Keep the LIMITS.groups - 1 busiest groups; every other group becomes OTHER_GROUP, counted once per commit.
function foldGroups(commits, warn) {
  const totals = new Map();
  for (const c of commits) for (const g of c.groups) totals.set(g, (totals.get(g) ?? 0) + 1);
  if (totals.size <= LIMITS.groups) return { commits, order: [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a) || (a < b ? -1 : 1)) };
  const keep = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a) || (a < b ? -1 : 1)).slice(0, LIMITS.groups - 1);
  const kept = new Set(keep);
  warn(`${totals.size} groups; the limit is ${LIMITS.groups}: kept the ${keep.length} busiest and folded the rest into ${OTHER_GROUP}`);
  const folded = commits.map((c) => ({ ...c, groups: new Set([...c.groups].map((g) => (kept.has(g) ? g : OTHER_GROUP))) }));
  return { commits: folded, order: [...keep, OTHER_GROUP] };
}

/**
 * Commits per folder per ISO week for the last `weeks` weeks (the current week included).
 * -> [{ group, t, value, label }], busiest group first, every group for every week (empty weeks are 0).
 * `repo` inside a larger repository counts that folder alone, grouped by paths from it (`warn` is told).
 * Over the scene limits the busiest 23 groups stay, the rest fold into "(other)", and the oldest weeks
 * are dropped; `warn(message)` is told. Group names over 48 characters lose their leading folders (…/make-scene/test). Throws UsageError for a folder that is not a repo or has no
 * commits in the window.
 */
export function historyRows({ repo, weeks = 12, depth = 1, now = new Date(), warn = () => {} }) {
  const thisWeek = weekStart(now);
  const first = new Date(thisWeek.getTime() - (weeks - 1) * WEEK_MS);
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UsageError(`${repo} is not a folder`);
  // A --repo inside a larger repository counts that folder alone (paths from it); say so once.
  const within = folderWithin(repo);
  if (within !== '') warn(`counts cover only the folder ${within} of its repository (commits that change files in it), grouped by the folders inside it`);
  // A day of slack: git compares --since with its own timezone view; the exact week filter is below.
  const log = runGitLog(repo, new Date(first.getTime() - DAY_MS).toISOString(), { subfolder: within !== '' });
  const parsed = parseCommits(log, depth);
  const names = displayNames(new Set(parsed.flatMap((c) => [...c.groups])));
  const inWindow = parsed
    .filter((c) => c.when >= first && c.when < new Date(thisWeek.getTime() + WEEK_MS))
    .map((c) => ({ week: isoWeek(c.when), groups: new Set([...c.groups].map((g) => names.get(g))) }));
  if (inWindow.length === 0) throw new UsageError(`no commits in the last ${weeks} week${weeks === 1 ? '' : 's'} in ${repo}; try a larger --weeks`);

  const { commits, order } = foldGroups(inWindow, warn);
  let allWeeks = Array.from({ length: weeks }, (_, i) => isoWeek(new Date(first.getTime() + i * WEEK_MS)));
  const fits = Math.floor(LIMITS.rows / order.length);
  if (allWeeks.length > fits) {
    warn(`${order.length} groups x ${allWeeks.length} weeks is over ${LIMITS.rows} rows: kept the most recent ${fits} weeks`);
    allWeeks = allWeeks.slice(-fits);
  }

  const counts = new Map(); // "group\tweek" -> commits
  for (const c of commits) for (const g of c.groups) counts.set(`${g}\t${c.week}`, (counts.get(`${g}\t${c.week}`) ?? 0) + 1);
  return order.flatMap((group) => allWeeks.map((t) => ({
    group, t, value: counts.get(`${group}\t${t}`) ?? 0, label: `${group} · ${t}`,
  })));
}
