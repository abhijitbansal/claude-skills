// Agent-facing documents stay small enough for the Haiku-class agents the five skills are pinned to (PA-35), and the
// rules every make-* SKILL.md carries do not drift out (PA-15, PA-16, PA-21, PA-06). Built-ins only, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS = fileURLToPath(new URL('../../skills/', import.meta.url));
const read = (skill, ...rest) => fs.readFileSync(path.join(SKILLS, skill, ...(rest.length ? rest : ['SKILL.md'])), 'utf8');

// A SKILL.md grows only on purpose: raise a budget in the same commit that adds the text, and say why.
// Bytes are UTF-8 bytes of the file; lines are counted as `trimEnd().split('\n').length`.
// Measured after the PA-35 cut, with about 3% headroom. make-motion was 62,596 bytes and 229 lines before the block
// tables, the voiceover notes and the storyboard step moved to references/, and 50,154 bytes and 183 lines when the
// version 1 file stood. The version 2 rewrite (cut-over Task 2) was 19,495 bytes and 111 lines. Task 5's final pass
// (the looks table, the sixteen kinds) measured 20,059 bytes and 125 lines (`wc -c -l`), and the budget is that plus
// about 3 percent.
const BUDGETS = {
  'make-dashboard': { bytes: 14000, lines: 145 },
  'make-diagram': { bytes: 15200, lines: 145 },
  'make-explainer': { bytes: 21800, lines: 150 },
  'make-motion': { bytes: 20700, lines: 129 },
  'make-scene': { bytes: 11700, lines: 110 },
};
const SKILL_NAMES = fs.readdirSync(SKILLS).filter((d) => fs.existsSync(path.join(SKILLS, d, 'SKILL.md'))).sort();

/** The ways a document is over its budget, as sentences; empty when it fits. */
export function overBudget(md, { bytes, lines }) {
  const out = [];
  const size = Buffer.byteLength(md, 'utf8');
  const count = md.trimEnd().split('\n').length;
  if (size > bytes) out.push(`${size} bytes; the budget is ${bytes}`);
  if (count > lines) out.push(`${count} lines; the budget is ${lines}`);
  return out;
}

test('every skill folder has a budget, and every budget names a skill folder', () => {
  assert.deepEqual(Object.keys(BUDGETS).sort(), SKILL_NAMES);
});

for (const skill of Object.keys(BUDGETS)) {
  test(`${skill}/SKILL.md stays within its byte and line budget`, () => {
    assert.deepEqual(overBudget(read(skill), BUDGETS[skill]), []);
  });
}

test('guardrail proof: a document one byte or one line over is named, one at the limit passes', () => {
  const budget = { bytes: 10, lines: 2 };
  assert.deepEqual(overBudget('abcdefghij', budget), []);
  assert.match(overBudget('abcdefghijk', budget)[0], /11 bytes; the budget is 10/);
  assert.match(overBudget('a\nb\nc', budget)[0], /3 lines; the budget is 2/);
  assert.equal(overBudget('a\nb\nc'.padEnd(40, 'x'), budget).length, 2);
});

// The version 2 SKILL.md points at the three reference files that hold the field tables and the writing guide, and each
// exists (cut-over Task 5; the validator's version 1 refusal names migrating.md too).
test('make-motion SKILL.md points at the three reference files of version 2, each exists, and it keeps the Cheaper model heading', () => {
  const md = read('make-motion');
  for (const ref of ['references/schema.md', 'references/story.md', 'references/migrating.md']) {
    assert.ok(md.includes(ref), `SKILL.md points at ${ref}`);
    assert.ok(fs.existsSync(path.join(SKILLS, 'make-motion', ref)), `${ref} exists`);
  }
  assert.match(md, /^## Cheaper model$/m);
  for (const gone of ['references/storyboard.md', 'references/voiceover.md', 'references/block-tables.md', 'blocks.mjs', 'render.mjs', 'validate.mjs', 'check.mjs', 'preview.mjs', 'voice.mjs']) {
    assert.ok(!md.includes(gone), `SKILL.md no longer names the version 1 file ${gone}`);
  }
});

// ---- the rules every make-* SKILL.md carries ------------------------------------------------------------------

// Shell forms the permission layer and the worktree guard refuse: a variable set then used, a chained exit-code echo, a heredoc.
const COMPOUND_FORMS = [/;\s*echo\b/, /\bS=\S+\s*(&&|;)/, /\$S\//, /<<-?\s*'?EOF/, /\bSKILL=\S/];

for (const skill of SKILL_NAMES) {
  test(`${skill}/SKILL.md has a Running the commands block and teaches no compound shell form`, () => {
    const md = read(skill);
    assert.match(md, /^## Running the commands$/m);
    const block = md.split(/^## Running the commands$/m)[1].split(/^## /m)[0];
    assert.match(block, /one plain command per call/i);
    assert.match(block, /literal absolute path/i);
    assert.match(block, /no heredoc/i);
    assert.match(block, /no shell variable/i);
    for (const re of COMPOUND_FORMS) assert.ok(!re.test(md.replace(block, '')), `${skill}: ${re}`);
  });

  test(`${skill}/SKILL.md names the literal generatedBy keys with a JSON example`, () => {
    const md = read(skill);
    assert.match(md, /"generatedBy": \{ "model": "[^"]+", "effort": "[^"]+", "agent": "[^"]+" \}/);
  });

  test(`${skill}/SKILL.md has one Sharing line`, () => {
    const md = read(skill);
    assert.equal((md.match(/^Sharing: /gm) ?? []).length, 1);
  });
}

for (const skill of SKILL_NAMES.filter((s) => s !== 'make-motion')) {
  test(`${skill}/SKILL.md ends the workflow by looking at the page: check with --shots, view the PNG, say passed, failed or skipped`, () => {
    const md = read(skill);
    assert.match(md, /check\.mjs[^\n]*--shots/);
    assert.match(md, /view (every|each|the) (screenshot|PNG)/i);
    assert.match(md, /passed, failed or skipped/i);
  });
}

test('guardrail proof: each compound-form rule fires on its own sample', () => {
  const samples = ['node validate.mjs x.json; echo done', 'S=/p/skill && node run.mjs', 'node $S/validate.mjs', 'cat <<EOF', 'SKILL=/p/skill'];
  assert.equal(samples.length, COMPOUND_FORMS.length);
  COMPOUND_FORMS.forEach((re, i) => assert.ok(re.test(samples[i]), `rule ${re} fires on ${samples[i]}`));
});

test('make-dashboard no longer claims valid means buildable without saying what validate runs', () => {
  const md = read('make-dashboard');
  assert.ok(!/valid means buildable/i.test(md));
  assert.match(md, /--bind-only/);
  assert.match(md, /query\.mjs/);
});
