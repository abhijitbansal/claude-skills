import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Hosts cannot pin a model from SKILL.md, so four skills tell the running agent to hand
// the work to the cheap `artifact-builder` agent. make-motion is decided in a later task.
const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const read = (skill) => fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
const HEADING = '## Cheaper model';
const DELEGATING = ['make-dashboard', 'make-diagram', 'make-explainer', 'make-scene'];

// The text under `## Cheaper model`, up to the next `## ` heading.
function section(md) {
  const at = md.indexOf(`\n${HEADING}\n`);
  if (at === -1) return null;
  const rest = md.slice(at + HEADING.length + 2);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

for (const skill of DELEGATING) {
  test(`${skill}/SKILL.md has a Cheaper model section that names the agent, the brief and the loop guard`, () => {
    const md = read(skill);
    const body = section(md);
    assert.ok(body, `missing "${HEADING}" heading`);
    for (const phrase of ['artifact-builder', 'self-contained brief', 'skill directory', 'unless you are already artifact-builder', 'spec path', 'output folder', 'Claude Code', 'list of available agents']) {
      assert.ok(body.includes(phrase), `${skill}: section lacks "${phrase}"`);
    }
    assert.equal(md.split(`\n${HEADING}\n`).length, 2, 'exactly one section');
    // After the intro: it is the first ## heading in the file.
    assert.equal(md.match(/\n(## [^\n]+)/)[1], HEADING, 'placed right after the intro');
  });
}

test('the Cheaper model text is identical in all four skills', () => {
  const texts = DELEGATING.map((s) => section(read(s)));
  assert.ok(texts[0], 'section exists');
  for (const t of texts.slice(1)) assert.equal(t, texts[0]);
});

test('make-motion has no Cheaper model section yet (its gate decides)', () => {
  assert.equal(section(read('make-motion')), null);
});
