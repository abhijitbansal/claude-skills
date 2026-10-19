import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listThemes } from '../../shared/theme.mjs';

const SKILLS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills');
const HEADING = 'Choosing a theme';

// The "## Choosing a theme" section: from its heading to the next "## " heading.
export function guidanceSection(md) {
  const m = md.match(new RegExp(`^## ${HEADING}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : null;
}

// Every backticked single lowercase word; flags (--theme <name>) and phrases do not match.
export const themeLikeNames = (text) => [...text.matchAll(/`([a-z][a-z0-9-]*)`/g)].map((m) => m[1]);

export function problems(section, themes = listThemes()) {
  const out = [];
  for (const name of new Set(themeLikeNames(section))) if (!themes.includes(name)) out.push(`names unknown theme ${JSON.stringify(name)}`);
  if (!/fallback|cannot ask|can't ask/i.test(section) || !/use `dusk`/.test(section)) out.push('does not name `dusk` as the fallback');
  return out;
}

for (const skill of ['make-explainer', 'make-motion']) {
  const md = fs.readFileSync(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
  test(`${skill}/SKILL.md has a "${HEADING}" section naming only real themes, with dusk as the fallback`, () => {
    const section = guidanceSection(md);
    assert.ok(section, `missing "## ${HEADING}"`);
    assert.deepEqual(problems(section), []);
    for (const t of ['dusk', 'press', 'poster']) assert.ok(themeLikeNames(section).includes(t), `${t} not named`);
  });
}

test('guardrail: a bogus theme name or a missing dusk fallback is caught', () => {
  const md = fs.readFileSync(path.join(SKILLS, 'make-explainer/SKILL.md'), 'utf8');
  const section = guidanceSection(md);
  assert.deepEqual(problems(`${section}\nTry \`neon\` too.\n`), ['names unknown theme "neon"']);
  assert.deepEqual(problems(section.replace('use `dusk`', 'stop')), ['does not name `dusk` as the fallback']);
});
