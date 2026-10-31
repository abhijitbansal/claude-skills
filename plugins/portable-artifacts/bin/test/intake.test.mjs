import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/make-motion');
const HEADING = 'Intake (one round)';
const read = (file) => fs.readFileSync(path.join(MOTION, file), 'utf8');

// The "## Intake (one round)" section: from its heading to the next "## " heading.
export function intakeSection(md) {
  const m = md.match(new RegExp(`^## ${HEADING.replace(/[()]/g, '\\$&')}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : null;
}

// One option per list line: a bold name, then text that must carry a default.
const OPTIONS = ['format', 'length', 'assets', 'voiceover', 'sound', 'theme', 'CTA'];
export const optionLine = (section, name) => section.split('\n').find((l) => l.includes(`**${name}**`));

export function problems(section) {
  const out = [];
  for (const name of OPTIONS) {
    const line = optionLine(section, name);
    if (!line) out.push(`no line for option ${name}`);
    else if (!/default/i.test(line)) out.push(`option ${name} names no default`);
  }
  for (const phrase of ['250 MB', '90 MB', 'any run that cannot pause for an answer', 'intake: skipped (']) {
    if (!section.includes(phrase)) out.push(`missing "${phrase}"`);
  }
  return out;
}

test('make-motion/SKILL.md has an Intake (one round) section with every option, a default for each, and the fallback', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(section, `missing "## ${HEADING}"`);
  assert.deepEqual(problems(section), []);
});

test('the intake section sits before Workflow, and the heading is unique', () => {
  const md = read('SKILL.md');
  assert.equal(md.split(`\n## ${HEADING}\n`).length, 2, 'exactly one section');
  assert.ok(md.indexOf(`## ${HEADING}`) < md.indexOf('\n## Workflow\n'), 'before ## Workflow');
});

test('the intake lists only options make-motion can do today', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(!/kenney/i.test(section), 'no Kenney samples until they land');
  for (const word of ['0b', 'Task ']) assert.ok(!section.includes(word), `no plan reference "${word}"`);
});

test('the Audio is opt-in paragraph still says never add audio, and now points at the intake', () => {
  const md = read('SKILL.md');
  const para = md.split('\n').find((l) => l.startsWith('**Audio is opt-in.**'));
  assert.ok(para, 'paragraph exists');
  assert.ok(para.includes('Never add audio'), 'the opt-in rule stands');
  assert.ok(para.includes('Intake (one round)'), 'the ask-one-question sentence points at the intake');
});

test('Choosing a theme rule 3 points at the intake', () => {
  const md = read('SKILL.md');
  const rule = md.split('\n').find((l) => l.startsWith('3. If the prompt is genuinely split'));
  assert.ok(rule && rule.includes('Intake (one round)'), 'rule 3 mentions the intake');
});

test('README Quick start mentions the intake round', () => {
  const readme = read('README.md');
  const quick = readme.match(/^## Quick start\n([\s\S]*?)(?=^## )/m)[1];
  assert.match(quick, /intake/i);
  assert.match(quick, /defaults/i);
});

test('guardrail: a missing option, a missing default or a missing fallback is caught', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(section.includes('**voiceover**'));
  assert.deepEqual(problems(section.replace('**voiceover**', '**narration**')), ['no line for option voiceover']);
  assert.deepEqual(problems(section.replace('any run that cannot pause for an answer', 'x')), ['missing "any run that cannot pause for an answer"']);
  assert.deepEqual(problems(section.replaceAll('250 MB', 'big')), ['missing "250 MB"']);
  const noDefault = section.split('\n').map((l) => (l.includes('**CTA**') ? l.replace(/default/gi, 'usually') : l)).join('\n');
  assert.deepEqual(problems(noDefault), ['option CTA names no default']);
});
