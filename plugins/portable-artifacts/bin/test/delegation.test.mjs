import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// No SKILL.md pins a model. The session model is the director (intake, spec, viewing, creative calls) and a cheap
// `artifact-builder` agent is the operator (one command, mechanical fixes). Every skill carries the same section that
// says so, and the text may not drift between skills.
// The list of skills is the skills folder itself: a new sibling is held to the same rule without editing this file.
const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const read = (skill, root = SKILLS) => fs.readFileSync(path.join(root, skill, 'SKILL.md'), 'utf8');
const HEADING = '## Director and operator';
const OLD_NAME = 'Cheaper model';
const OLD_PHRASE = 'on the model named in the frontmatter';
const REQUIRED_PHRASES = [
  'You are the director', 'artifact-builder', 'make.mjs', '--json', 'skill directory', 'spec path', 'mechanical', 'creative',
  'unless you are already artifact-builder', 'run the same command yourself', 'list of available agents', 'take over',
  'shared/shot.mjs', 'sheets',
];

// Every skill folder under `root`: a folder with a SKILL.md.
const skillNames = (root = SKILLS) => fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'SKILL.md'))).sort();
const DELEGATING = skillNames();

// The text under `## Director and operator`, up to the next `## ` heading.
function section(md) {
  const at = md.indexOf(`\n${HEADING}\n`);
  if (at === -1) return null;
  const rest = md.slice(at + HEADING.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// What is wrong with one skill's section; an empty list means it is right.
function problems(md) {
  const body = section(md);
  if (!body) return [`missing "${HEADING}" heading`];
  const found = REQUIRED_PHRASES.filter((p) => !body.includes(p)).map((p) => `section lacks "${p}"`);
  if (md.split(`\n${HEADING}\n`).length !== 2) found.push('not exactly one section');
  if (md.match(/\n(## [^\n]+)/)?.[1] !== HEADING) found.push('not placed right after the intro');
  return found;
}

// The keys of a SKILL.md frontmatter block.
const frontKeys = (md) => (md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '').split('\n').map((l) => l.match(/^([A-Za-z][\w-]*):/)?.[1]).filter(Boolean);
// The pinned-model keys one frontmatter carries.
const pins = (md) => frontKeys(md).filter((k) => k === 'model' || k === 'effort');
// What is left of the old scheme in one SKILL.md.
const oldScheme = (md) => [OLD_NAME, OLD_PHRASE].filter((s) => md.includes(s));

test('the skills folder is the source of the list: the five known skills are all in it', () => {
  for (const skill of ['make-dashboard', 'make-diagram', 'make-explainer', 'make-motion', 'make-scene']) assert.ok(DELEGATING.includes(skill), skill);
  assert.ok(DELEGATING.length >= 5);
});

for (const skill of DELEGATING) {
  test(`${skill}/SKILL.md has one Director and operator section, first after the intro, with the ladder, the report words and the loop guard`, () => {
    assert.deepEqual(problems(read(skill)), []);
  });
}

test('the Director and operator text is identical in every skill', () => {
  const texts = DELEGATING.map((s) => section(read(s)));
  assert.ok(texts[0], 'section exists');
  for (const t of texts.slice(1)) assert.equal(t, texts[0]);
});

for (const skill of DELEGATING) {
  test(`${skill}/SKILL.md frontmatter has no model or effort key`, () => {
    assert.deepEqual(pins(read(skill)), []);
  });

  test(`${skill}/SKILL.md keeps nothing of the Cheaper model scheme`, () => {
    assert.deepEqual(oldScheme(read(skill)), []);
  });

  test(`${skill}/SKILL.md names its own scripts/make.mjs, and the file exists`, () => {
    assert.ok(read(skill).includes('scripts/make.mjs'), 'SKILL.md names scripts/make.mjs');
    assert.ok(fs.existsSync(path.join(SKILLS, skill, 'scripts', 'make.mjs')), `${skill}/scripts/make.mjs exists`);
  });
}

// Guardrail proofs: each rule above fires on a document that breaks it.
test('guardrail proof: a frontmatter with model: haiku or effort: low is caught, one without is not', () => {
  assert.deepEqual(pins('---\nname: make-x\nmodel: haiku\n---\nBody\n'), ['model']);
  assert.deepEqual(pins('---\nname: make-x\neffort: low\n---\nBody\n'), ['effort']);
  assert.deepEqual(pins('---\nname: make-x\ndescription: a model of effort: low\n---\nBody\n'), []);
});

test('guardrail proof: the old heading, a reference to it and the old sentence are caught', () => {
  assert.deepEqual(oldScheme('x\n## Cheaper model\ny\n'), [OLD_NAME]);
  assert.deepEqual(oldScheme('hand off as the Cheaper model section says'), [OLD_NAME]);
  assert.deepEqual(oldScheme('it runs this skill on the model named in the frontmatter'), [OLD_PHRASE]);
  assert.deepEqual(oldScheme(read('make-dashboard')), []);
});

test('guardrail proof: a sibling dropped into the folder is picked up, and the check fails when its section or a phrase is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-delegation-'));
  const copy = (name, body) => {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), body);
  };
  copy('make-dashboard', read('make-dashboard'));
  copy('make-new', '---\nname: make-new\n---\n\nIntro.\n\n## Steps\n\nDo it.\n');
  copy('make-late', read('make-dashboard').replace(`\n${HEADING}\n`, '\n## Other\n\nx\n\n## Director and operator\n'));
  copy('make-dup', `${read('make-dashboard')}\n${HEADING}\n\nAgain.\n`);
  copy('make-thin', read('make-dashboard').replace('take over', 'give up'));
  fs.mkdirSync(path.join(root, 'not-a-skill'));
  assert.deepEqual(skillNames(root), ['make-dashboard', 'make-dup', 'make-late', 'make-new', 'make-thin']);
  assert.deepEqual(problems(read('make-dashboard', root)), []);
  assert.deepEqual(problems(read('make-new', root)), [`missing "${HEADING}" heading`]);
  assert.ok(problems(read('make-late', root)).includes('not placed right after the intro'));
  assert.ok(problems(read('make-dup', root)).includes('not exactly one section'));
  assert.deepEqual(problems(read('make-thin', root)), ['section lacks "take over"']);
});
