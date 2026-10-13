// Starter specs for the four presets. Facts (from gather.mjs) fill what a script can know:
// numbers, files, commits, folders. Every sentence is a "TODO: ..." string that validate
// rejects until the model replaces it with prose.
import { PRESETS } from './schema.mjs';
import { slugify } from '../../shared/output.mjs';

export const PRESET_NAMES = PRESETS.filter((p) => p !== 'none');

const MAX_FILES = 200;
const MAX_TIMELINE = 20;
const MAX_FOLDERS = 10;
const ROOT_FOLDER = 'Repository root';
const OTHER_FOLDER = 'Other areas';
const REGRESSION_GROUP = 'Regression checks';
const SHORT_SHA = 7;

const todo = (hint) => `TODO: ${hint}`;
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sum = (files, key) => files.reduce((n, f) => n + (f[key] ?? 0), 0);

const ON_FAIL = [
  '- Leave the box unticked and write down the step, what you saw and what you expected.',
  '- Check the open issues for the same symptom before filing a new one.',
  '- After the fix, re-run the failed item and every **Regression** item in its group.',
].join('\n');

const tldr = (points) => ({
  type: 'tldr',
  title: todo('state the verdict as a claim a reader can agree or disagree with'),
  text: todo('one or two sentences: what this is and why it matters'),
  points: points.map(todo),
  tone: 'good',
});

function meta(facts, keys) {
  const picked = Object.fromEntries(keys.filter((k) => facts?.[k]).map((k) => [k, facts[k]]));
  return Object.keys(picked).length > 0 ? { meta: picked } : {};
}

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

function fileItem(f) {
  const note = f.change === 'renamed' && f.oldPath ? `renamed from \`${f.oldPath}\`` : f.binary ? 'binary file' : undefined;
  return { path: f.path, change: f.change, ...(f.add == null ? {} : { add: f.add }), ...(f.del == null ? {} : { del: f.del }), ...(note ? { note } : {}) };
}

// A files section holds 200 entries: keep the busiest ones, listed by path. The kpis carry the true total.
function filesSection(files) {
  const busiest = [...files].sort((a, b) => ((b.add ?? 0) + (b.del ?? 0)) - ((a.add ?? 0) + (a.del ?? 0)) || byCodeUnit(a.path, b.path));
  const kept = busiest.slice(0, MAX_FILES).sort((a, b) => byCodeUnit(a.path, b.path));
  return { type: 'files', title: 'Files changed', items: kept.map(fileItem) };
}

function timelineSection(commits) {
  const items = commits.slice(-MAX_TIMELINE).map((c, i) => ({ date: c.date || c.sha?.slice(0, SHORT_SHA) || `Commit ${i + 1}`, title: c.subject }));
  return { type: 'timeline', title: 'How the branch got here', items };
}

function recap(facts, title) {
  return {
    title: title ?? todo('say what this branch achieves'),
    subtitle: todo('one line on scope: what it adds and what it leaves alone'),
    preset: 'recap',
    ...meta(facts, ['date', 'branch', 'repo']),
    sections: [
      tldr(['the first fact that supports the verdict', 'the second fact that supports the verdict', 'what a reviewer should look at first']),
      ...(facts ? [kpisSection(facts)] : []),
      { type: 'text', title: todo('claim about how the change works'), text: todo('explain how it works in plain prose; read the changed files first') },
      ...(facts && facts.files.length > 0 ? [filesSection(facts.files)] : []),
      ...(facts && facts.commits.length > 0 ? [timelineSection(facts.commits)] : []),
      {
        type: 'risks',
        title: todo('say what could still go wrong'),
        items: [{ risk: todo('a risk this change carries'), severity: 'medium', mitigation: todo('how it is handled or checked') }],
      },
    ],
  };
}

const topFolder = (p) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : ROOT_FOLDER);

// Folders of the files a tester can still touch (deleted files are gone), busiest first when there are too many.
function areas(files) {
  const counts = new Map();
  for (const f of files) if (f.change !== 'deleted') counts.set(topFolder(f.path), (counts.get(topFolder(f.path)) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0])).map(([name]) => name);
  const named = ranked.slice(0, MAX_FOLDERS).sort(byCodeUnit);
  return ranked.length > MAX_FOLDERS ? [...named, OTHER_FOLDER] : named;
}

const checkGroup = (title, where) => ({
  title,
  items: [
    { text: todo(`manual check for ${where}: what to do and what you should see`), tag: 'manual' },
    { text: todo(`regression check for ${where}: a bug fixed during review, or delete this item`), tag: 'regression' },
  ],
});

function checklist(facts, title) {
  const folders = facts ? areas(facts.files) : [];
  const groups = folders.length > 0 ? folders.map((f) => checkGroup(f, f === ROOT_FOLDER || f === OTHER_FOLDER ? f.toLowerCase() : `${f}/`)) : [checkGroup(todo('name the first area to test'), 'this area')];
  groups.push({ title: REGRESSION_GROUP, items: [{ text: todo('one item per bug fixed during review, naming the symptom to look for'), tag: 'regression' }] });
  return {
    title: title ?? (facts?.branch ? `${facts.branch}: manual test checklist` : todo('name the branch or feature this checklist covers')),
    subtitle: 'What automated tests and the headless browser could not cover',
    preset: 'checklist',
    ...meta(facts, ['date', 'branch', 'repo']),
    sections: [{
      type: 'checklist',
      title: todo('claim about what the tester is confirming'),
      key: slugify(facts?.branch, 'checklist'),
      intro: todo("write the \"What's in this branch\" summary: every feature and every review-cycle fix this branch delivers, and what automated tests already cover, so a tester needs no PR"),
      groups,
      onFail: ON_FAIL,
    }],
  };
}

function concept(facts, title) {
  return {
    title: title ?? todo('state the idea as a claim'),
    subtitle: todo('one line on what the reader will understand'),
    preset: 'concept',
    ...meta(facts, ['date', 'repo']),
    sections: [
      tldr(['the first thing to remember', 'the second thing to remember', 'where the idea stops']),
      { type: 'text', title: todo('claim about why it works this way'), text: todo('explain the idea in plain prose, one example at a time') },
      {
        type: 'cards',
        title: todo('claim that the parts below support'),
        columns: 3,
        items: [1, 2, 3].map((n) => ({ title: todo(`name part ${n}`), text: todo(`what part ${n} does`) })),
      },
      {
        type: 'steps',
        title: todo('claim about how to apply it'),
        items: [1, 2, 3].map((n) => ({ title: todo(`step ${n}`), text: todo(`what to do in step ${n}`) })),
      },
    ],
  };
}

function slides(facts, title) {
  return {
    title: title ?? todo('state the deck as one claim'),
    subtitle: todo('one line on what the audience leaves knowing'),
    preset: 'slides',
    ...meta(facts, ['date', 'repo']),
    sections: [
      tldr(['the first point', 'the second point', 'the third point']),
      { type: 'cards', title: todo('claim for the cards slide'), columns: 3, items: [1, 2, 3].map((n) => ({ title: todo(`card ${n}`), text: todo(`one line for card ${n}`) })) },
      { type: 'steps', title: todo('claim for the steps slide'), items: [1, 2, 3].map((n) => ({ title: todo(`step ${n}`) })) },
      { type: 'text', title: todo('closing claim'), text: todo('two sentences: what to do next') },
    ],
  };
}

const BUILDERS = { recap, checklist, concept, slides };

/** Starter spec for a preset: facts is gather.mjs output (or null), title overrides the TODO title. */
export function scaffold(preset, { facts = null, title } = {}) {
  return BUILDERS[preset](facts, title);
}
