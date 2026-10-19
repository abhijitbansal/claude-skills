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
const MAX_BUFFER = 256 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const HEADER = /^[0-9a-f]{40,64}\t(\S+)$/;
const NUMSTAT = /^(?:\d+|-)\t(?:\d+|-)\t(.+)$/;

function gitEnv() {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull,
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_TERMINAL_PROMPT: '0',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
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

function runGitLog(repo, sinceIso) {
  if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) throw new UsageError(`${repo} is not a folder`);
  const args = [
    '-c', 'core.quotePath=false',
    'log', '--numstat', '--no-renames', '--no-merges', '--format=%H%x09%cI', `--since=${sinceIso}`,
  ];
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

// The folder a changed file counts under: its first `depth` folders, or (root) for a top-level file.
function groupOf(file, depth) {
  const folders = file.split('/').slice(0, -1);
  if (folders.length === 0) return ROOT_GROUP;
  const name = folders.slice(0, depth).join('/');
  const chars = [...name];
  return chars.length > LIMITS.group ? `${chars.slice(0, LIMITS.group - 1).join('')}…` : name;
}

// -> [{ week, groups: Set<string> }], one entry per commit with at least one changed file.
function parseCommits(log, depth) {
  const commits = [];
  let current = null;
  for (const line of log.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      const when = new Date(header[1]);
      current = Number.isNaN(when.getTime()) ? null : { when, groups: new Set() };
      if (current) commits.push(current);
      continue;
    }
    const file = NUMSTAT.exec(line)?.[1];
    if (file !== undefined && current) current.groups.add(groupOf(file, depth));
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
 * Over the scene limits the busiest 23 groups stay, the rest fold into "(other)", and the oldest weeks
 * are dropped; `warn(message)` is told. Throws UsageError for a folder that is not a repo or has no
 * commits in the window.
 */
export function historyRows({ repo, weeks = 12, depth = 1, now = new Date(), warn = () => {} }) {
  const thisWeek = weekStart(now);
  const first = new Date(thisWeek.getTime() - (weeks - 1) * WEEK_MS);
  // A day of slack: git compares --since with its own timezone view; the exact week filter is below.
  const log = runGitLog(repo, new Date(first.getTime() - DAY_MS).toISOString());
  const inWindow = parseCommits(log, depth)
    .filter((c) => c.when >= first && c.when < new Date(thisWeek.getTime() + WEEK_MS))
    .map((c) => ({ week: isoWeek(c.when), groups: c.groups }));
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
