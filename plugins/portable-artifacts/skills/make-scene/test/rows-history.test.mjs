import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { historyRows } from '../scripts/lib/history-rows.mjs';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';

const ROWS_CLI = fileURLToPath(new URL('../scripts/rows.mjs', import.meta.url));
// 2026-10-19 is a Monday: ISO week 2026-W43. W42 starts 10-12, W41 starts 10-05.
const NOW = new Date('2026-10-19T12:00:00Z');

const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

// A repo whose commits carry fixed dates. Git runs with argument arrays and a scrubbed environment,
// the same approach as PA/eval/lib.mjs createFixtureRepo, so the developer's git config cannot interfere.
function fixtureRepo() {
  const dir = tmp('scene-rows-');
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull,
    GIT_AUTHOR_NAME: 'Test Author', GIT_AUTHOR_EMAIL: 'author@example.com',
    GIT_COMMITTER_NAME: 'Test Author', GIT_COMMITTER_EMAIL: 'author@example.com',
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  const git = (...args) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', '-c', `core.hooksPath=${os.devNull}`, ...args], { cwd: dir, encoding: 'utf8', env });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  };
  git('init', '-q', '-b', 'main');
  let n = 0;
  // commit(isoDate, ...paths): touch every path (unique content) and commit at that date.
  const commit = (when, ...paths) => {
    for (const rel of paths) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.appendFileSync(path.join(dir, rel), `line ${n++}\n`);
    }
    git('add', '-A');
    env.GIT_AUTHOR_DATE = when;
    env.GIT_COMMITTER_DATE = when;
    git('commit', '-q', '-m', `c${n}`);
  };
  return { dir, commit, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const valueOf = (rows, group, t) => rows.find((r) => r.group === group && r.t === t)?.value;
const groupsOf = (rows) => [...new Set(rows.map((r) => r.group))];
const runCli = (args, opts = {}) => spawnSync(process.execPath, [ROWS_CLI, ...args], { encoding: 'utf8', ...opts });

test('counts commits per folder per week', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-07T10:00:00Z', 'src/a.js', 'docs/x.md'); // W41, touches two groups
    repo.commit('2026-10-08T10:00:00Z', 'src/b.js'); // W41
    repo.commit('2026-10-14T10:00:00Z', 'src/a.js'); // W42
    const rows = historyRows({ repo: repo.dir, weeks: 3, depth: 1, now: NOW });
    assert.equal(valueOf(rows, 'src', '2026-W41'), 2);
    assert.equal(valueOf(rows, 'src', '2026-W42'), 1);
    assert.equal(valueOf(rows, 'docs', '2026-W41'), 1);
    assert.equal(valueOf(rows, 'docs', '2026-W42'), 0);
    assert.deepEqual(rows.find((r) => r.group === 'src' && r.t === '2026-W41'), {
      group: 'src', t: '2026-W41', value: 2, label: 'src · 2026-W41',
    });
  } finally { repo.cleanup(); }
});

test('one commit touching several files in a folder counts once', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-14T10:00:00Z', 'src/a.js', 'src/b.js', 'src/c.js');
    const rows = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW });
    assert.equal(valueOf(rows, 'src', '2026-W42'), 1);
  } finally { repo.cleanup(); }
});

test('root files group as (root)', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-14T10:00:00Z', 'README.md');
    repo.commit('2026-10-15T10:00:00Z', 'src/a.js');
    const rows = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW });
    assert.equal(valueOf(rows, '(root)', '2026-W42'), 1);
    assert.equal(valueOf(rows, 'src', '2026-W42'), 1);
  } finally { repo.cleanup(); }
});

test('zero weeks are filled', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-14T10:00:00Z', 'src/a.js'); // W42 only
    repo.commit('2026-10-15T10:00:00Z', 'docs/x.md'); // W42 only
    const rows = historyRows({ repo: repo.dir, weeks: 4, depth: 1, now: NOW });
    assert.equal(rows.length, 2 * 4, 'every group has a row for every week');
    const weeks = [...new Set(rows.map((r) => r.t))].sort();
    assert.deepEqual(weeks, ['2026-W40', '2026-W41', '2026-W42', '2026-W43']);
    assert.equal(valueOf(rows, 'src', '2026-W40'), 0);
    assert.equal(valueOf(rows, 'src', '2026-W43'), 0);
  } finally { repo.cleanup(); }
});

test('commits older than the window are ignored', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-01-05T10:00:00Z', 'old/a.js');
    repo.commit('2026-10-14T10:00:00Z', 'src/a.js');
    const rows = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW });
    assert.deepEqual(groupsOf(rows), ['src']);
  } finally { repo.cleanup(); }
});

test('week numbers use the ISO year at a year boundary and stay zero-padded', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-01-01T10:00:00Z', 'src/a.js'); // Thursday: ISO 2026-W01
    repo.commit('2025-12-29T10:00:00Z', 'src/b.js'); // Monday: still 2026-W01
    const rows = historyRows({ repo: repo.dir, weeks: 3, depth: 1, now: new Date('2026-01-14T12:00:00Z') });
    assert.deepEqual(rows.map((r) => r.t), ['2026-W01', '2026-W02', '2026-W03']);
    assert.equal(valueOf(rows, 'src', '2026-W01'), 2);
  } finally { repo.cleanup(); }
});

test('depth 2 splits subfolders', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-14T10:00:00Z', 'src/api/a.js');
    repo.commit('2026-10-15T10:00:00Z', 'src/ui/b.js', 'src/ui/deep/c.js');
    repo.commit('2026-10-16T10:00:00Z', 'src/top.js');
    const one = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW });
    assert.deepEqual(groupsOf(one), ['src']);
    assert.equal(valueOf(one, 'src', '2026-W42'), 3);
    const two = historyRows({ repo: repo.dir, weeks: 2, depth: 2, now: NOW });
    assert.deepEqual(groupsOf(two).sort(), ['src', 'src/api', 'src/ui']);
    assert.equal(valueOf(two, 'src/ui', '2026-W42'), 1, 'two files in one subfolder are one commit');
    assert.equal(valueOf(two, 'src', '2026-W42'), 1, 'src/top.js sits directly in src');
  } finally { repo.cleanup(); }
});

test('more than 24 groups: top 23 by commits plus (other), counted per commit', () => {
  const repo = fixtureRepo();
  try {
    // Commit j (1..30) touches folders d00..d(j-1), so folder i is touched by 30-i commits.
    for (let j = 1; j <= 30; j++) {
      const dirs = Array.from({ length: j }, (_, i) => `d${String(i).padStart(2, '0')}/f.js`);
      repo.commit('2026-10-14T10:00:00Z', ...dirs);
    }
    const notes = [];
    const rows = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW, warn: (m) => notes.push(m) });
    const groups = groupsOf(rows);
    assert.equal(groups.length, 24);
    assert.ok(groups.includes('d00') && groups.includes('d22'));
    assert.ok(!groups.includes('d23'), 'folders beyond the top 23 are folded');
    assert.equal(groups.at(-1), '(other)');
    // Folders d23..d29 are touched by commits 24..30: seven distinct commits, not the 28 folder hits.
    assert.equal(valueOf(rows, '(other)', '2026-W42'), 7);
    assert.match(notes.join('\n'), /30 groups.*23.*\(other\)/);
  } finally { repo.cleanup(); }
});

test('more than 2000 rows: keep the most recent weeks that fit', () => {
  const repo = fixtureRepo();
  try {
    for (let i = 0; i < 24; i++) repo.commit('2026-10-14T10:00:00Z', `d${String(i).padStart(2, '0')}/f.js`);
    const notes = [];
    const rows = historyRows({ repo: repo.dir, weeks: 100, depth: 1, now: NOW, warn: (m) => notes.push(m) });
    assert.equal(groupsOf(rows).length, 24);
    assert.ok(rows.length <= 2000);
    const weeks = [...new Set(rows.map((r) => r.t))].sort();
    assert.equal(weeks.length, Math.floor(2000 / 24));
    assert.equal(weeks.at(-1), '2026-W43', 'the newest week survives');
    assert.match(notes.join('\n'), /2000/);
  } finally { repo.cleanup(); }
});

test('long folder names are cut to the 48-character group limit', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-14T10:00:00Z', `${'x'.repeat(60)}/f.js`);
    const rows = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW });
    assert.equal([...groupsOf(rows)[0]].length, 48);
  } finally { repo.cleanup(); }
});

test('output validates as a data.file for the scene validator', async () => {
  const repo = fixtureRepo();
  const out = tmp('scene-rows-out-');
  try {
    repo.commit('2026-10-14T10:00:00Z', 'src/a.js', 'README.md');
    const rows = historyRows({ repo: repo.dir, weeks: 4, depth: 1, now: NOW });
    fs.writeFileSync(path.join(out, 'scene-rows.json'), JSON.stringify({ rows }));
    const result = await validateSpec({ title: 'History', data: { file: 'scene-rows.json' } }, { dir: out });
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  } finally { repo.cleanup(); fs.rmSync(out, { recursive: true, force: true }); }
});

test('a folder that is not a git repository is a usage error', () => {
  const dir = tmp('scene-rows-nogit-');
  try {
    assert.throws(() => historyRows({ repo: dir, weeks: 4, depth: 1, now: NOW }), /not a git repository/);
    const r = runCli(['git', '--repo', dir, '--out', path.join(dir, 'o.json')]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /not a git repository/);
    assert.equal(fs.existsSync(path.join(dir, 'o.json')), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a repo with no commits in the window is a usage error, not an empty file', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2020-01-06T10:00:00Z', 'src/a.js');
    assert.throws(() => historyRows({ repo: repo.dir, weeks: 4, depth: 1, now: NOW }), /no commits/);
  } finally { repo.cleanup(); }
});

test('unknown flag lists accepted flags', () => {
  const r = runCli(['git', '--week', '4']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown option '--week'/);
  assert.match(r.stderr, /did you mean '--weeks'/);
  for (const flag of ['--weeks', '--depth', '--repo', '--out']) assert.ok(r.stderr.includes(flag), `lists ${flag}`);
});

test('bad subcommand, extra positionals and bad numbers are usage errors', () => {
  for (const args of [[], ['svn'], ['git', 'extra'], ['git', '--weeks', '0'], ['git', '--weeks', 'abc'], ['git', '--depth', '1.5'], ['git', '--depth', '0']]) {
    const r = runCli(args);
    assert.equal(r.status, 2, `args: ${JSON.stringify(args)}`);
    assert.match(r.stderr, /usage: node scripts\/rows\.mjs git/);
  }
});

test('CLI writes { rows } and the pasted data line validates beside scene.json', async () => {
  const repo = fixtureRepo();
  const outDir = tmp('scene-rows-abs-');
  try {
    repo.commit(new Date().toISOString(), 'src/a.js');
    const out = path.join(outDir, 'nested-rows.json');
    const r = runCli(['git', '--repo', repo.dir, '--weeks', '2', '--out', out]);
    assert.equal(r.status, 0, r.stderr);
    const written = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.deepEqual(Object.keys(written), ['rows']);
    assert.equal(written.rows.length, 2);
    assert.ok(r.stdout.includes(out), 'prints the path it wrote');
    assert.ok(r.stdout.includes(outDir), 'says which folder scene.json must be in');
    // The pasted line is relative to the scene's folder, so it validates for a scene.json next to the output.
    const pasted = /"data": (\{ "file": "[^"]+" \})/.exec(r.stdout);
    assert.ok(pasted, 'prints a data line');
    assert.equal(JSON.parse(pasted[1]).file, 'nested-rows.json');
    fs.writeFileSync(path.join(outDir, 'scene.json'), JSON.stringify({ title: 'History', data: JSON.parse(pasted[1]) }));
    const { spec, dir } = loadSpec(path.join(outDir, 'scene.json'));
    const result = await validateSpec(spec, { dir });
    assert.deepEqual(result.errors, []);
  } finally { repo.cleanup(); fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('CLI --out with .. prints the bare file name, not the .. path', () => {
  const repo = fixtureRepo();
  const outDir = tmp('scene-rows-up-');
  fs.mkdirSync(path.join(outDir, 'sub'));
  try {
    repo.commit(new Date().toISOString(), 'src/a.js');
    const r = runCli(['git', '--repo', repo.dir, '--weeks', '2', '--out', '../up-rows.json'], { cwd: path.join(outDir, 'sub') });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(outDir, 'up-rows.json')));
    assert.match(r.stdout, /"data": \{ "file": "up-rows\.json" \}/);
    assert.doesNotMatch(r.stdout, /"file": "[^"]*\.\./);
  } finally { repo.cleanup(); fs.rmSync(outDir, { recursive: true, force: true }); }
});

test('CLI default output is ./scene-rows.json in the current directory', () => {
  const repo = fixtureRepo();
  const cwd = tmp('scene-rows-cwd-');
  try {
    repo.commit(new Date().toISOString(), 'src/a.js');
    const r = runCli(['git', '--repo', repo.dir], { cwd });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(cwd, 'scene-rows.json')));
    assert.match(r.stdout, /"data": \{ "file": "scene-rows\.json" \}/);
    assert.match(r.stdout, /scene\.json must sit in the same folder as scene-rows\.json/);
  } finally { repo.cleanup(); fs.rmSync(cwd, { recursive: true, force: true }); }
});

test('folders named with quotes, backslashes and tabs come back exact', () => {
  const repo = fixtureRepo();
  try {
    repo.commit('2026-10-14T10:00:00Z', 'we"ird/a.js', 'tab\tdir/b.js', 'back\\slash/c.js', 'sp ace/d.js', 'caf\u00e9/e.js');
    const rows = historyRows({ repo: repo.dir, weeks: 2, depth: 1, now: NOW });
    assert.deepEqual(groupsOf(rows).sort(), ['back\\slash', 'caf\u00e9', 'sp ace', 'tab\tdir', 'we"ird']);
    assert.equal(valueOf(rows, 'we"ird', '2026-W42'), 1);
    assert.equal(valueOf(rows, 'tab\tdir', '2026-W42'), 1);
  } finally { repo.cleanup(); }
});

test('inherited GIT_DIR and GIT_CONFIG_PARAMETERS do not change the result', () => {
  const repo = fixtureRepo();
  const decoy = fixtureRepo();
  try {
    repo.commit(new Date().toISOString(), 'src/a.js');
    decoy.commit(new Date().toISOString(), 'decoy/z.js');
    const hostile = {
      GIT_DIR: path.join(decoy.dir, '.git'),
      GIT_WORK_TREE: decoy.dir,
      // makes any git that reads it refuse to run: "repository version 99"
      GIT_CONFIG_PARAMETERS: "'core.repositoryformatversion=99'",
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.repositoryformatversion', GIT_CONFIG_VALUE_0: '99',
    };
    const out = path.join(repo.dir, 'o.json');
    const r = runCli(['git', '--repo', repo.dir, '--weeks', '2', '--out', out], { env: { ...process.env, ...hostile } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(groupsOf(JSON.parse(fs.readFileSync(out, 'utf8')).rows), ['src']);
  } finally { repo.cleanup(); decoy.cleanup(); }
});
