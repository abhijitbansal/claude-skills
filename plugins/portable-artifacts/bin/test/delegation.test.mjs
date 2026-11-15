import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Hosts cannot pin a model from SKILL.md, so every skill tells the running agent to hand
// the work to the cheap `artifact-builder` agent (make-motion joined after its Copilot gate passed).
// The list of skills is the skills folder itself: a new sibling is held to the same rule without editing this file.
const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const read = (skill, root = SKILLS) => fs.readFileSync(path.join(root, skill, 'SKILL.md'), 'utf8');
const HEADING = '## Cheaper model';
const REQUIRED_PHRASES = ['artifact-builder', 'self-contained brief', 'skill directory', 'unless you are already artifact-builder', 'spec path', 'output folder', 'Claude Code', 'list of available agents'];

// Every skill folder under `root`: a folder with a SKILL.md.
const skillNames = (root = SKILLS) => fs.readdirSync(root).filter((d) => fs.existsSync(path.join(root, d, 'SKILL.md'))).sort();
const DELEGATING = skillNames();

// The text under `## Cheaper model`, up to the next `## ` heading.
function section(md) {
  const at = md.indexOf(`\n${HEADING}\n`);
  if (at === -1) return null;
  const rest = md.slice(at + HEADING.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

// What is wrong with one skill's delegation section; an empty list means it is right.
function problems(md) {
  const body = section(md);
  if (!body) return [`missing "${HEADING}" heading`];
  const found = REQUIRED_PHRASES.filter((p) => !body.includes(p)).map((p) => `section lacks "${p}"`);
  if (md.split(`\n${HEADING}\n`).length !== 2) found.push('not exactly one section');
  if (md.match(/\n(## [^\n]+)/)?.[1] !== HEADING) found.push('not placed right after the intro');
  return found;
}

test('the skills folder is the source of the list: the five known skills are all in it', () => {
  for (const skill of ['make-dashboard', 'make-diagram', 'make-explainer', 'make-motion', 'make-scene']) assert.ok(DELEGATING.includes(skill), skill);
  assert.ok(DELEGATING.length >= 5);
});

for (const skill of DELEGATING) {
  test(`${skill}/SKILL.md has a Cheaper model section that names the agent, the brief and the loop guard`, () => {
    assert.deepEqual(problems(read(skill)), []);
  });
}

test('the Cheaper model text is identical in every skill', () => {
  const texts = DELEGATING.map((s) => section(read(s)));
  assert.ok(texts[0], 'section exists');
  for (const t of texts.slice(1)) assert.equal(t, texts[0]);
});

test('make-motion runs on the cheap model: frontmatter model: haiku', () => {
  const front = read('make-motion').match(/^---\n([\s\S]*?)\n---/)[1];
  assert.match(front, /^model: haiku$/m);
  assert.match(front, /^effort: low$/m);
});

// Guardrail proof: a sibling dropped into the folder is picked up, and one without the section fails.
test('a new sibling in the skills folder is checked too, and the check fails when its section is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-delegation-'));
  const copy = (name, body) => {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), body);
  };
  copy('make-dashboard', read('make-dashboard'));
  copy('make-new', '---\nname: make-new\n---\n\nIntro.\n\n## Steps\n\nDo it.\n');
  fs.mkdirSync(path.join(root, 'not-a-skill'));
  assert.deepEqual(skillNames(root), ['make-dashboard', 'make-new']);
  assert.deepEqual(problems(read('make-dashboard', root)), []);
  assert.deepEqual(problems(read('make-new', root)), [`missing "${HEADING}" heading`]);
});
