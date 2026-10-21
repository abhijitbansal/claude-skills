// Starter specs for the four presets. Facts (from gather.mjs) fill what a script can know:
// numbers, files, commits, folders. Every sentence is a "TODO: ..." string that validate
// rejects until the model replaces it with prose.
import { createHash } from 'node:crypto';
import { PRESETS, LIMITS } from './schema.mjs';
import { prose, fit, pathText } from './fit.mjs';
import { slugify } from '../../shared/output.mjs';

const MAX_FILES = 200;
const MAX_TIMELINE = 20;
const MAX_FOLDERS = 10;
const ROOT_FOLDER = 'Repository root';
const OTHER_FOLDER = 'Other areas';
const REGRESSION_GROUP = 'Regression checks';
const SHORT_SHA = 7;
const KEY_HASH = 6;
const TITLE_SUFFIX = ': manual test checklist';

const todo = (hint) => `TODO: ${hint}`;
const LABEL = todo('2-4 word label');
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (files, key) => files.reduce((n, f) => n + (f[key] ?? 0), 0);

const ON_FAIL = [
  '- Leave the box unticked and write down the step, what you saw and what you expected.',
  '- Check the open issues for the same symptom before filing a new one.',
  '- After the fix, re-run the failed item and every **Regression** item in its group.',
].join('\n');

const tldr = (points) => ({
  type: 'tldr',
  title: todo('the verdict as one finding, ≤ 8 words'),
  label: LABEL,
  text: todo('one sentence: what this is and why it matters'),
  points: points.map(todo),
  tone: 'good',
});

// meta values are short chips: fitted to the schema's meta limit.
function meta(facts, keys) {
  const picked = Object.fromEntries(keys.filter((k) => facts?.[k]).map((k) => [k, prose(facts[k], { limit: LIMITS.meta })]).filter(([, v]) => v !== ''));
  return Object.keys(picked).length > 0 ? { meta: picked } : {};
}

// A section that says what the cap left out, so neither the model nor the reader mistakes a slice for the whole.
const omission = (title, text) => ({ type: 'callout', tone: 'info', title, text });

function kpisSection(facts) {
  const { commits, files, tests } = facts;
  return {
    type: 'kpis',
    title: 'The branch in numbers',
    items: [
      { label: 'Commits', value: commits.length },
      { label: 'Files changed', value: files.length },
      { label: 'Lines added', value: sum(files, 'add') },
      { label: 'Lines removed', value: sum(files, 'del') },
      { label: 'Test files touched', value: tests.length },
    ],
  };
}

function fileNote(f) {
  if (f.oldPath) return `${f.change === 'renamed' ? 'renamed' : 'copied'} from \`${pathText(f.oldPath)}\``;
  return f.binary ? 'binary file' : undefined;
}

function fileItem(f) {
  const note = fileNote(f);
  return { path: pathText(f.path), change: f.change, ...(f.add == null ? {} : { add: f.add }), ...(f.del == null ? {} : { del: f.del }), ...(note ? { note } : {}) };
}

// A files section holds 200 entries: keep the busiest ones, listed by path. The kpis carry the true total.
function filesSection(files) {
  const busiest = [...files].sort((a, b) => ((b.add ?? 0) + (b.del ?? 0)) - ((a.add ?? 0) + (a.del ?? 0)) || byCodeUnit(a.path, b.path));
  const kept = busiest.slice(0, MAX_FILES).sort((a, b) => byCodeUnit(a.path, b.path));
  return { type: 'files', title: 'Files changed', items: kept.map(fileItem) };
}

const filesOmission = (total) => (total > MAX_FILES
  ? [omission('Files not listed', `${total - MAX_FILES} of the ${total} changed files are not listed. The ${MAX_FILES} with the most changed lines are shown; the numbers above count all of them.`)]
  : []);

function timelineSection(commits) {
  const items = commits.slice(-MAX_TIMELINE).map((c, i) => {
    const label = c.date || c.sha?.slice(0, SHORT_SHA) || `Commit ${i + 1}`;
    return { date: prose(label, { fallback: `Commit ${i + 1}` }), title: prose(c.subject, { heading: true, fallback: `Commit ${c.sha?.slice(0, SHORT_SHA) ?? i + 1}` }) };
  });
  return { type: 'timeline', title: 'How the branch got here', items };
}

const timelineOmission = (total) => (total > MAX_TIMELINE
  ? [omission('Earlier commits not shown', `The ${total - MAX_TIMELINE} earliest of the ${total} commits are left out; the latest ${MAX_TIMELINE} are listed.`)]
  : []);

function recap(facts, title) {
  return {
    title: title ?? todo('what this branch achieves; aim for ≤ 8 words'),
    subtitle: todo('one line: what it adds, what it leaves alone'),
    preset: 'recap',
    ...meta(facts, ['date', 'branch', 'repo']),
    sections: [
      tldr(['first supporting fact, ≤ 20 words', 'second supporting fact', 'what to review first']),
      ...(facts ? [kpisSection(facts)] : []),
      { type: 'text', title: todo('how the change works, ≤ 8 words'), label: LABEL, text: todo('how it works, ≤ 3 short sentences; read the changed files first') },
      ...(facts && facts.files.length > 0 ? [filesSection(facts.files), ...filesOmission(facts.files.length)] : []),
      ...(facts && facts.commits.length > 0 ? [timelineSection(facts.commits), ...timelineOmission(facts.commits.length)] : []),
      {
        type: 'risks',
        title: todo('what could still go wrong, ≤ 8 words'),
        label: LABEL,
        items: [{ risk: todo('a risk this change carries'), severity: 'medium', mitigation: todo('how it is handled or checked') }],
      },
    ],
  };
}

const topFolder = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : ROOT_FOLDER);

// Folders of the files a tester can still touch (deleted files are gone): the busiest ten, the rest named in `others`.
function areas(files) {
  const counts = new Map();
  for (const f of files) if (f.change !== 'deleted') counts.set(topFolder(f.path), (counts.get(topFolder(f.path)) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0])).map(([name]) => name);
  const named = ranked.slice(0, MAX_FOLDERS).sort(byCodeUnit);
  const others = ranked.slice(MAX_FOLDERS).sort(byCodeUnit);
  return { folders: others.length > 0 ? [...named, OTHER_FOLDER] : named, others };
}

const checkGroup = (title, where, note) => ({
  title,
  items: [
    { text: todo(`manual check for ${where}: what to do and what you should see`), tag: 'manual', ...(note ? { note } : {}) },
    { text: todo(`regression check for ${where}: a bug fixed during review, or delete this item`), tag: 'regression' },
  ],
});

const sha1 = (text) => createHash('sha1').update(text).digest('hex').slice(0, KEY_HASH);

// The localStorage namespace: the branch as a slug. A name with no ASCII letters, or one too long for the
// key limit, gets a short hash so two different branches never share ticks. A detached HEAD has no name and
// a new sha per commit, so it is keyed by the repository instead and the ticks survive new commits.
function checklistKey(facts) {
  if (!facts?.branch) return 'checklist';
  const name = facts.detached ? `${facts.repo ?? 'repo'}-detached` : facts.branch;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const room = LIMITS.checklistKey - KEY_HASH - 1;
  if (slug === '') return `checklist-${sha1(name)}`;
  return slug.length > room ? `${slug.slice(0, room).replace(/-+$/, '')}-${sha1(name)}` : slug;
}

function checklistTitle(facts, title) {
  if (title !== undefined) return title;
  if (!facts?.branch) return todo('name the branch or feature this checklist covers');
  const branch = prose(facts.branch, { limit: LIMITS.title - TITLE_SUFFIX.length, fallback: 'this branch' });
  return `${branch}${TITLE_SUFFIX}`;
}

// One group per area. Two folder names that clean to the same title get a number so group titles stay unique.
function areaGroups(folders, facts) {
  const used = new Set([REGRESSION_GROUP]);
  return folders.map((folder) => {
    const synthetic = folder === ROOT_FOLDER || folder === OTHER_FOLDER;
    const clean = synthetic ? folder : prose(folder, { heading: true, fallback: 'Area' });
    let title = clean;
    for (let n = 2; used.has(title); n++) title = `${clean} (${n})`;
    used.add(title);
    const where = synthetic ? folder.toLowerCase() : `${clean}/`;
    return checkGroup(title, where, folder === OTHER_FOLDER ? `covers ${facts.otherAreas.map((n) => prose(n, { fallback: 'an unnamed folder' })).join(', ')}` : undefined);
  });
}

function checklist(facts, title) {
  const { folders, others } = facts ? areas(facts.files) : { folders: [], others: [] };
  const groups = folders.length > 0 ? areaGroups(folders, { otherAreas: others }) : [checkGroup(todo('name the first area to test'), 'this area')];
  groups.push({ title: REGRESSION_GROUP, items: [{ text: todo('one item per bug fixed during review, naming the symptom to look for'), tag: 'regression' }] });
  return {
    title: checklistTitle(facts, title),
    subtitle: 'What automated tests and the headless browser could not cover',
    preset: 'checklist',
    ...meta(facts, ['date', 'branch', 'repo']),
    sections: [{
      type: 'checklist',
      title: todo('what the tester confirms, ≤ 8 words'),
      label: LABEL,
      key: checklistKey(facts),
      intro: todo("the \"What's in this branch\" summary: features, review fixes, what tests already cover"),
      groups,
      onFail: ON_FAIL,
    }],
  };
}

function concept(facts, title) {
  return {
    title: title ?? todo('the idea as one finding; aim for ≤ 8 words'),
    subtitle: todo('one line on what the reader will understand'),
    preset: 'concept',
    ...meta(facts, ['date', 'repo']),
    sections: [
      tldr(['the first thing to remember', 'the second thing to remember', 'where the idea stops']),
      { type: 'text', title: todo('why it works this way, ≤ 8 words'), label: LABEL, text: todo('why it works this way, ≤ 3 short sentences') },
      {
        type: 'cards',
        title: todo('the claim the parts support, ≤ 8 words'),
        label: LABEL,
        columns: 3,
        items: [1, 2, 3].map((n) => ({ title: todo(`name part ${n}`), text: todo(`what part ${n} does, ≤ 30 words`) })),
      },
      {
        type: 'steps',
        title: todo('how to apply it, ≤ 8 words'),
        label: LABEL,
        items: [1, 2, 3].map((n) => ({ title: todo(`step ${n}`), text: todo(`what to do in step ${n}, ≤ 30 words`) })),
      },
    ],
  };
}

function slides(facts, title) {
  return {
    title: title ?? todo('the deck as one finding; aim for ≤ 8 words'),
    subtitle: todo('one line on what the audience leaves knowing'),
    preset: 'slides',
    ...meta(facts, ['date', 'repo']),
    sections: [
      tldr(['the first point', 'the second point', 'the third point']),
      { type: 'cards', title: todo('the cards slide as one finding, ≤ 8 words'), label: LABEL, columns: 3, items: [1, 2, 3].map((n) => ({ title: todo(`card ${n}`), text: todo(`one line for card ${n}`) })) },
      { type: 'steps', title: todo('the steps slide as one finding, ≤ 8 words'), label: LABEL, items: [1, 2, 3].map((n) => ({ title: todo(`step ${n}`) })) },
      { type: 'text', title: todo('closing finding, ≤ 8 words'), label: LABEL, text: todo('two short sentences: what to do next') },
    ],
  };
}

const BUILDERS = { recap, checklist, concept, slides };

// The presets scaffold can start: a preset is listed once it has a builder.
export const PRESET_NAMES = PRESETS.filter((p) => Object.hasOwn(BUILDERS, p));

/** Starter spec for a preset: facts is gather.mjs output (or null), title overrides the TODO title. */
export function scaffold(preset, { facts = null, title } = {}) {
  return BUILDERS[preset](facts, title);
}
