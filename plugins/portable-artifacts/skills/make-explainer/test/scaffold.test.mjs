import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { featureRepo, makeRepo, git } from './helpers/repo.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { LIMITS, KEY_PATTERN } from '../scripts/lib/schema.mjs';
import { fit, cleanText } from '../scripts/lib/fit.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const node = (script, args, env = {}) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', env: { ...process.env, EVAL_LOG: '', ...env } });
const PRESET_NAMES = ['recap', 'checklist', 'concept', 'slides'];

function sandbox() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'explainer-scaffold-')));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** Writes `value` as JSON into `dir` and returns the path. */
function put(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}

function factsOf(repo, ...extra) {
  const r = node('gather.mjs', ['git', '--repo', repo.dir, '--json', ...extra]);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function scaffold(preset, { facts, title, dir } = {}) {
  const args = [preset];
  if (facts) args.push('--facts', put(dir, 'facts.json', facts));
  if (title) args.push('--title', title);
  const r = node('scaffold.mjs', args);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

/** Replaces every "TODO: ..." string with distinct real prose, the way a model would. */
function fillTodos(value, counter = { n: 0 }) {
  if (typeof value === 'string') return value.startsWith('TODO:') ? `Filled ${++counter.n}: this field now holds a real sentence.` : value;
  if (Array.isArray(value)) return value.map((v) => fillTodos(v, counter));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTodos(v, counter)]));
  return value;
}

const todoPaths = (result) => result.errors.filter((e) => /TODO placeholder/.test(e.message)).map((e) => e.path);
const section = (spec, type) => spec.sections.filter((s) => s.type === type);

// ---- every preset: starter fails validation only because of TODOs, then validates and builds ------

for (const preset of PRESET_NAMES) {
  for (const withFacts of [false, true]) {
    test(`${preset}${withFacts ? ' with facts' : ''}: TODO markers fail validation; once replaced it validates and builds`, async () => {
      const { dir, done } = sandbox();
      const repo = featureRepo();
      try {
        const spec = scaffold(preset, { facts: withFacts ? factsOf(repo) : undefined, dir });
        assert.equal(spec.preset, preset);
        const first = await validateSpec(spec, { dir });
        assert.equal(first.ok, false);
        assert.ok(todoPaths(first).length > 0);
        assert.deepEqual(first.errors.filter((e) => !/TODO placeholder/.test(e.message)), [], 'only TODO errors may remain in a starter');

        const filled = fillTodos(spec);
        const specFile = put(dir, 'filled.explainer.json', filled);
        const validated = node('validate.mjs', [specFile]);
        assert.equal(validated.status, 0, validated.stdout);
        const built = node('build.mjs', [specFile, '--out', path.join(dir, 'page.html')]);
        assert.equal(built.status, 0, built.stdout + built.stderr);
        assert.match(fs.readFileSync(path.join(dir, 'page.html'), 'utf8'), /^<!doctype html>/);
      } finally { repo.cleanup(); done(); }
    });
  }
}

// ---- recap ------------------------------------------------------------------------------------

test('recap: tldr, text and risks are TODOs; kpis, files and timeline come from the facts', () => {
  const { dir, done } = sandbox();
  const repo = featureRepo();
  try {
    const facts = factsOf(repo);
    const spec = scaffold('recap', { facts, dir });
    assert.deepEqual(spec.meta, { date: facts.date, branch: 'feat/login', repo: facts.repo });
    assert.ok(spec.title.startsWith('TODO:'));

    const [tldr] = section(spec, 'tldr');
    assert.ok(tldr.title.startsWith('TODO:') && tldr.text.startsWith('TODO:'));
    assert.ok(tldr.points.length >= 2 && tldr.points.every((p) => p.startsWith('TODO:')));
    assert.ok(section(spec, 'text').every((s) => s.text.startsWith('TODO:')));
    const [risks] = section(spec, 'risks');
    assert.ok(risks.items[0].risk.startsWith('TODO:') && risks.items[0].mitigation.startsWith('TODO:'));

    const [kpis] = section(spec, 'kpis');
    const value = (label) => kpis.items.find((k) => k.label === label).value;
    assert.equal(value('Commits'), 2);
    assert.equal(value('Files changed'), facts.files.length);
    assert.equal(value('Lines added'), facts.files.reduce((n, f) => n + (f.add ?? 0), 0));
    assert.equal(value('Lines removed'), facts.files.reduce((n, f) => n + (f.del ?? 0), 0));
    assert.equal(value('Test files touched'), 1);

    const [files] = section(spec, 'files');
    const login = files.items.find((f) => f.path === 'src/auth/login.js');
    assert.deepEqual(login, { path: 'src/auth/login.js', change: 'added', add: 3, del: 0 });
    const moved = files.items.find((f) => f.path === 'src/new name.js');
    assert.equal(moved.change, 'renamed');
    assert.match(moved.note, /renamed from `src\/old name\.js`/);

    const [timeline] = section(spec, 'timeline');
    assert.deepEqual(timeline.items.map((i) => [i.date, i.title]), [['2026-10-02', 'feat: add login'], ['2026-10-03', 'refactor: rename file, drop the old doc']]);
  } finally { repo.cleanup(); done(); }
});

test('recap: a binary file is listed without line counts', () => {
  const { dir, done } = sandbox();
  const facts = { branch: 'topic', base: 'main', commits: [], files: [{ path: 'logo.png', change: 'added', add: null, del: null, binary: true }, { path: 'a.txt', change: 'modified', add: 2, del: 1, binary: false }], tests: [] };
  try {
    const spec = scaffold('recap', { facts, dir });
    const items = section(spec, 'files')[0].items;
    assert.deepEqual(items.find((f) => f.path === 'logo.png'), { path: 'logo.png', change: 'added', note: 'binary file' });
    assert.equal(section(spec, 'kpis')[0].items.find((k) => k.label === 'Lines added').value, 2);
    assert.equal(section(spec, 'timeline').length, 0, 'no commits, no timeline');
  } finally { done(); }
});

test('recap: a branch with no changes drops the empty sections instead of emitting invalid ones', async () => {
  const { dir, done } = sandbox();
  try {
    const spec = scaffold('recap', { facts: { branch: 'main', base: 'main', commits: [], files: [], tests: [] }, dir });
    assert.deepEqual(spec.sections.map((s) => s.type), ['tldr', 'kpis', 'text', 'risks']);
    const result = await validateSpec(fillTodos(spec), { dir });
    assert.deepEqual(result.errors, []);
  } finally { done(); }
});

test('recap: a big branch is capped to what a section can hold, and the totals stay true', async () => {
  const { dir, done } = sandbox();
  const files = Array.from({ length: 230 }, (_, i) => ({ path: `src/f${String(i).padStart(3, '0')}.js`, change: 'modified', add: i, del: 0, binary: false }));
  const commits = Array.from({ length: 45 }, (_, i) => ({ sha: String(i).padStart(40, '0'), subject: `commit ${i}`, date: '2026-10-01' }));
  try {
    const spec = scaffold('recap', { facts: { branch: 'big', base: 'main', commits, files, tests: [] }, dir });
    const listed = section(spec, 'files')[0].items;
    assert.equal(listed.length, 200);
    assert.ok(listed.some((f) => f.path === 'src/f229.js'), 'the busiest files are kept');
    assert.ok(!listed.some((f) => f.path === 'src/f000.js'));
    assert.deepEqual(listed.map((f) => f.path), [...listed.map((f) => f.path)].sort());
    assert.equal(section(spec, 'kpis')[0].items.find((k) => k.label === 'Files changed').value, 230);
    assert.equal(section(spec, 'kpis')[0].items.find((k) => k.label === 'Commits').value, 45);
    assert.equal(section(spec, 'timeline')[0].items.length, 20);
    assert.equal(section(spec, 'timeline')[0].items.at(-1).title, 'commit 44', 'the latest commits are kept');
    assert.deepEqual((await validateSpec(fillTodos(spec), { dir })).errors, []);
  } finally { done(); }
});

test('recap: --title replaces the TODO title', () => {
  const { dir, done } = sandbox();
  try {
    assert.equal(scaffold('recap', { title: 'Login lands', dir }).title, 'Login lands');
  } finally { done(); }
});

// ---- checklist --------------------------------------------------------------------------------

test('checklist: one group per top-level folder of changed files, key from the branch, intro asks for the branch summary', () => {
  const { dir, done } = sandbox();
  const repo = featureRepo();
  try {
    const spec = scaffold('checklist', { facts: factsOf(repo), dir });
    assert.equal(spec.title, 'feat/login: manual test checklist');
    const [check] = section(spec, 'checklist');
    assert.equal(check.key, 'feat-login');
    assert.match(check.intro, /^TODO:.*What's in this branch/);
    assert.match(check.intro, /features/);
    assert.match(check.intro, /review fixes/);
    const titles = check.groups.map((g) => g.title);
    assert.deepEqual(titles.slice(0, -1), ['docs', 'src', 'test']);
    assert.equal(titles.at(-1), 'Regression checks');
    for (const g of check.groups) assert.ok(g.items.every((i) => i.text.startsWith('TODO:')), g.title);
    const src = check.groups.find((g) => g.title === 'src');
    assert.ok(src.items.some((i) => i.tag === 'regression'));
    assert.ok(check.groups.at(-1).items.every((i) => i.tag === 'regression'));
    assert.ok(check.onFail && !check.onFail.includes('TODO'));
  } finally { repo.cleanup(); done(); }
});

test('checklist: root-level files share one group; a deleted-only folder gets no group', () => {
  const { dir, done } = sandbox();
  const facts = { branch: 'Topic/My Branch', base: 'main', commits: [], tests: [], files: [
    { path: 'README.md', change: 'modified', add: 1, del: 0, binary: false },
    { path: 'gone/x.js', change: 'deleted', add: 0, del: 5, binary: false },
    { path: 'app/moved.js', change: 'renamed', oldPath: 'old/moved.js', add: 0, del: 0, binary: false },
  ] };
  try {
    const [check] = section(scaffold('checklist', { facts, dir }), 'checklist');
    assert.equal(check.key, 'topic-my-branch');
    assert.deepEqual(check.groups.map((g) => g.title), ['Repository root', 'app', 'Regression checks']);
  } finally { done(); }
});

test('checklist: more than 10 folders fold the rest into "Other areas"', async () => {
  const { dir, done } = sandbox();
  const files = Array.from({ length: 14 }, (_, i) => ({ path: `dir${String(i).padStart(2, '0')}/f.js`, change: 'added', add: 1, del: 0, binary: false }));
  try {
    const spec = scaffold('checklist', { facts: { branch: 'wide', base: 'main', commits: [], files, tests: [] }, dir });
    const titles = section(spec, 'checklist')[0].groups.map((g) => g.title);
    assert.equal(titles.length, 12);
    assert.deepEqual(titles.slice(-2), ['Other areas', 'Regression checks']);
    assert.deepEqual((await validateSpec(fillTodos(spec), { dir })).errors, []);
  } finally { done(); }
});

test('checklist without facts: one TODO group and a plain key', () => {
  const { dir, done } = sandbox();
  try {
    const [check] = section(scaffold('checklist', { dir }), 'checklist');
    assert.equal(check.key, 'checklist');
    assert.ok(check.groups[0].title.startsWith('TODO:'));
  } finally { done(); }
});

test('checklist: a detached HEAD gets a valid key that stays the same across commits', async () => {
  const { dir, done } = sandbox();
  const repo = featureRepo();
  try {
    git(repo.dir, 'checkout', '-q', '--detach');
    const first = scaffold('checklist', { facts: factsOf(repo), dir });
    const key = section(first, 'checklist')[0].key;
    assert.equal(key, `${path.basename(repo.dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}-detached`);
    repo.write('later.txt', 'x\n');
    repo.commit('another commit while detached');
    const second = scaffold('checklist', { facts: factsOf(repo), dir });
    assert.equal(section(second, 'checklist')[0].key, key, 'new commit, same ticks');
    assert.deepEqual((await validateSpec(fillTodos(second), { dir })).errors, []);
  } finally { repo.cleanup(); done(); }
});

// ---- concept and slides -----------------------------------------------------------------------

test('concept and slides: section skeletons made of TODOs', () => {
  const { dir, done } = sandbox();
  try {
    const concept = scaffold('concept', { dir });
    assert.deepEqual(concept.sections.map((s) => s.type), ['tldr', 'text', 'cards', 'steps']);
    const slides = scaffold('slides', { dir });
    assert.ok(!('mode' in slides), 'preset slides already implies slides mode');
    assert.deepEqual(slides.sections.map((s) => s.type), ['tldr', 'cards', 'steps', 'text']);
    for (const spec of [concept, slides]) {
      const strings = JSON.stringify(spec.sections).match(/"TODO:[^"]*"/g) ?? [];
      assert.ok(strings.length >= 8);
    }
  } finally { done(); }
});

test('concept takes date and repo from the facts but ignores the rest', () => {
  const { dir, done } = sandbox();
  try {
    const spec = scaffold('concept', { facts: { branch: 'b', base: 'main', date: '2026-10-05', repo: 'r', commits: [], files: [], tests: [] }, dir });
    assert.deepEqual(spec.meta, { date: '2026-10-05', repo: 'r' });
  } finally { done(); }
});

// ---- end to end through both scripts -------------------------------------------------------

test('gather -> scaffold -> fill -> validate -> build on a repo with awkward paths and names', async () => {
  const { dir, done } = sandbox();
  const repo = makeRepo();
  try {
    repo.write('a.txt', 'a\n');
    repo.commit('base');
    git(repo.dir, 'checkout', '-q', '-b', 'Topic/with_odd.name');
    repo.write('my docs/read me.md', 'x\n');
    repo.write('logo.png', Buffer.from([0x89, 0x50, 0, 1, 0]));
    repo.commit('feat: "quoted" <b>bold</b> & more');
    const gathered = node('gather.mjs', ['git', '--repo', repo.dir]);
    assert.equal(gathered.status, 0, gathered.stderr);
    const factsFile = put(dir, 'facts.json', gathered.stdout);
    for (const preset of ['recap', 'checklist']) {
      const out = node('scaffold.mjs', [preset, '--facts', factsFile]);
      assert.equal(out.status, 0, out.stderr);
      const specFile = put(dir, `${preset}.explainer.json`, fillTodos(JSON.parse(out.stdout)));
      assert.equal(node('validate.mjs', [specFile]).status, 0, node('validate.mjs', [specFile]).stdout);
      const page = path.join(dir, `${preset}.html`);
      assert.equal(node('build.mjs', [specFile, '--out', page]).status, 0);
      const html = fs.readFileSync(page, 'utf8');
      assert.ok(!html.includes('<b>bold</b>'), 'a commit subject never becomes markup');
    }
  } finally { repo.cleanup(); done(); }
});

// ---- command line -----------------------------------------------------------------------------

test('an unknown or missing preset is refused with the accepted list and a did-you-mean', () => {
  const typo = node('scaffold.mjs', ['recapp']);
  assert.equal(typo.status, 2);
  assert.equal(typo.stdout, '');
  assert.match(typo.stderr, /unknown preset "recapp".*recap, checklist, concept, slides.*did you mean "recap"\?/);
  const none = node('scaffold.mjs', []);
  assert.equal(none.status, 2);
  assert.match(none.stderr, /expected a preset.*recap, checklist, concept, slides/);
  const two = node('scaffold.mjs', ['recap', 'slides']);
  assert.equal(two.status, 2);
  assert.equal(node('scaffold.mjs', ['none']).status, 2);
});

test('unknown flags are refused', () => {
  const r = node('scaffold.mjs', ['recap', '--fact', 'f.json']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: node scripts\/scaffold\.mjs/);
});

test('bad --facts: a missing file, invalid JSON and the wrong shape each name the problem', () => {
  const { dir, done } = sandbox();
  try {
    const cases = [
      [path.join(dir, 'nope.json'), /cannot read .*nope\.json/],
      [put(dir, 'bad.json', '{oops'), /is not valid JSON/],
      [put(dir, 'array.json', '[]'), /must be a JSON object/],
      [put(dir, 'nofiles.json', { commits: [] }), /facts\.files must be an array/],
      [put(dir, 'badfile.json', { commits: [], files: [{ path: 'a', change: 'moved' }], tests: [] }), /facts\.files\[0\]\.change must be one of added, modified, deleted, renamed/],
      [put(dir, 'badcommit.json', { commits: [{ sha: 'x' }], files: [], tests: [] }), /facts\.commits\[0\]\.subject must be a string/],
    ];
    for (const [file, pattern] of cases) {
      const r = node('scaffold.mjs', ['recap', '--facts', file]);
      assert.equal(r.status, 2, file);
      assert.match(r.stderr, pattern);
    }
  } finally { done(); }
});

// ---- fix round 1: facts fit the schema and the lint ------------------------------------------

const LONG_BRANCH = 'feature/this-is-a-very-long-branch-name-describing-the-entire-work-item-1234';
const only = (result) => result.errors.filter((e) => !/TODO placeholder/.test(e.message));

test('a long branch, a long title, an emoji subject and a TODO subject: only real placeholders fail, and filling them validates', async () => {
  const { dir, done } = sandbox();
  const facts = {
    repo: 'a-repository-with-a-name-that-is-longer-than-sixty-characters-for-the-chip',
    branch: LONG_BRANCH,
    date: '2026-10-12',
    base: 'main',
    commits: [
      { sha: 'a'.repeat(40), date: '2026-10-11', subject: '\u2728 add the cache \ud83d\ude80\u2728' },
      { sha: 'b'.repeat(40), date: '2026-10-12', subject: 'TODO: clean this up later' },
      { sha: 'c'.repeat(40), date: '2026-10-12', subject: 'refactor: leverage the cache to utilize fewer reads!' },
      { sha: 'd'.repeat(40), date: '2026-10-12', subject: '\ud83c\udf89' },
    ],
    files: [
      { path: 'src/a.js', change: 'added', add: 1, del: 0, binary: false },
      { path: '\ud83c\udf89 party/b.js', change: 'added', add: 1, del: 0, binary: false },
      { path: 'docs/TODO: notes.md', change: 'added', add: 1, del: 0, binary: false },
    ],
    tests: [],
  };
  try {
    for (const preset of ['recap', 'checklist', 'concept', 'slides']) {
      const spec = scaffold(preset, { facts, dir });
      const first = await validateSpec(spec, { dir });
      assert.deepEqual(only(first), [], `${preset}: only TODO errors may remain`);
      const filled = await validateSpec(fillTodos(spec), { dir });
      assert.deepEqual(filled.errors, [], preset);
    }
    const recap = scaffold('recap', { facts, dir });
    assert.ok(recap.meta.branch.length <= LIMITS.meta && recap.meta.branch.endsWith('…'));
    assert.ok(recap.meta.repo.length <= LIMITS.meta);
    const titles = section(recap, 'timeline')[0].items.map((i) => i.title);
    assert.equal(titles[0], 'add the cache');
    assert.equal(titles[1], 'To do: clean this up later', 'a real subject starting with TODO: is not a placeholder');
    assert.equal(titles[2], 'refactor: use the cache to use fewer reads');
    assert.equal(titles[3], 'Commit ddddddd', 'a subject that was only emoji falls back to the sha');
    assert.ok(!section(recap, 'files')[0].items.some((f) => f.path.includes('TODO:')));
    const checklist = scaffold('checklist', { facts, dir });
    assert.ok(checklist.title.length <= LIMITS.title && checklist.title.endsWith(': manual test checklist'));
  } finally { done(); }
});

test('fit: cuts at a word boundary to the limit with an ellipsis, never over, and leaves short text alone', () => {
  assert.equal(fit('short', 60), 'short');
  const cut = fit('add the cache and then rewrite the whole reader for good measure', 30);
  assert.equal(cut, 'add the cache and then…');
  assert.ok(cut.length <= 30);
  assert.equal(fit('feature/this-is-a-very-long-name', 20), 'feature/this-is-a…');
  assert.ok(fit('x'.repeat(100), 40).length === 40);
  assert.ok(fit('a'.repeat(5) + ' ' + 'b'.repeat(80), 20).length <= 20);
});

test('cleanText: emoji, banned phrases, placeholders and a trailing ! in a heading', () => {
  assert.equal(cleanText('\u2728 shiny \ud83d\udc68\u200d\ud83d\udcbb fix'), 'shiny fix');
  assert.equal(cleanText('leverage and utilize it'), 'use and use it');
  assert.equal(cleanText('TODO: x lorem ipsum'), 'To do: x sample text');
  assert.equal(cleanText('stop the crash!!', { heading: true }), 'stop the crash');
  assert.equal(cleanText('stop the crash!'), 'stop the crash!');
});

test('a truncated recap says so inside the spec: a note after the files and after the timeline', async () => {
  const { dir, done } = sandbox();
  const files = Array.from({ length: 230 }, (_, i) => ({ path: `src/f${i}.js`, change: 'added', add: i, del: 0, binary: false }));
  const commits = Array.from({ length: 45 }, (_, i) => ({ sha: String(i).padStart(40, '0'), subject: `commit ${i}`, date: '2026-10-01' }));
  try {
    const spec = scaffold('recap', { facts: { branch: 'big', commits, files, tests: [] }, dir });
    const types = spec.sections.map((s) => s.type);
    assert.deepEqual(types, ['tldr', 'kpis', 'text', 'files', 'callout', 'timeline', 'callout', 'risks']);
    const [fileNote, commitNote] = section(spec, 'callout');
    assert.match(fileNote.text, /30 of the 230 changed files are not listed/);
    assert.match(commitNote.text, /25 earliest of the 45 commits/);
    assert.deepEqual(only(await validateSpec(spec, { dir })), []);
    const small = scaffold('recap', { facts: { branch: 'b', commits: commits.slice(0, 3), files: files.slice(0, 3), tests: [] }, dir });
    assert.equal(section(small, 'callout').length, 0, 'nothing dropped, nothing to say');
  } finally { done(); }
});

test('checklist: the "Other areas" group names the folders it folds in', () => {
  const { dir, done } = sandbox();
  const files = Array.from({ length: 12 }, (_, i) => ({ path: `dir${String(i).padStart(2, '0')}/f.js`, change: 'added', add: 1, del: 0, binary: false }));
  try {
    const groups = section(scaffold('checklist', { facts: { branch: 'wide', commits: [], files, tests: [] }, dir }), 'checklist')[0].groups;
    const other = groups.find((g) => g.title === 'Other areas');
    assert.equal(other.items[0].note, 'covers dir10, dir11');
  } finally { done(); }
});

test('checklist keys: valid, never shared by different branches, and stable for the same one', () => {
  const { dir, done } = sandbox();
  const key = (branch, extra = {}) => section(scaffold('checklist', { facts: { branch, commits: [], files: [], tests: [], ...extra }, dir }), 'checklist')[0].key;
  try {
    const long1 = key(`${'a'.repeat(70)}-one`);
    const long2 = key(`${'a'.repeat(70)}-two`);
    assert.notEqual(long1, long2, 'a shared prefix must not share ticks');
    const jp = key('機能/ログイン');
    const jp2 = key('機能/ログアウト');
    assert.notEqual(jp, jp2);
    assert.equal(jp, key('機能/ログイン'));
    for (const k of [long1, long2, jp, jp2, key('feat/login')]) {
      assert.match(k, KEY_PATTERN);
      assert.ok(k.length <= LIMITS.checklistKey, k);
    }
    assert.equal(key('feat/login'), 'feat-login');
  } finally { done(); }
});

test('a copied file is noted like a rename', () => {
  const { dir, done } = sandbox();
  try {
    const facts = { branch: 'b', commits: [], tests: [], files: [{ path: 'b.js', oldPath: 'a.js', change: 'added', add: 3, del: 0, binary: false }, { path: 'd.js', oldPath: 'c.js', change: 'renamed', add: 0, del: 0, binary: false }] };
    const items = section(scaffold('recap', { facts, dir }), 'files')[0].items;
    assert.equal(items.find((f) => f.path === 'b.js').note, 'copied from `a.js`');
    assert.equal(items.find((f) => f.path === 'd.js').note, 'renamed from `c.js`');
  } finally { done(); }
});

test('--title "" is refused instead of producing an empty title', () => {
  for (const title of ['', '   ']) {
    const r = node('scaffold.mjs', ['recap', '--title', title]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--title must not be empty/);
    assert.equal(r.stdout, '');
  }
});

test('every titled TODO section carries a label TODO and a short-title prompt', () => {
  for (const preset of ['recap', 'checklist', 'concept', 'slides']) {
    const spec = scaffold(preset);
    for (const s of spec.sections.filter((x) => typeof x.title === 'string' && x.title.startsWith('TODO:'))) {
      assert.equal(s.label, 'TODO: 2-4 word label', `${preset} ${s.type}`);
      assert.match(s.title, /≤ 8 words/, `${preset} ${s.type}`);
    }
  }
});
