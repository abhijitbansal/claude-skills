import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUE_NAMES } from '../../skills/make-motion/template/audio.mjs';

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
const VOICEOVER_DISCLOSURE = 'a one-time install of about 250 MB plus a 90 MB voice model';
const TRIGGERS = ['`claude -p`', '`codex exec`', '`copilot -p`', 'the eval'];
export const optionLine = (section, name) => section.split('\n').find((l) => l.includes(`**${name}**`));

export function problems(section) {
  const out = [];
  for (const name of OPTIONS) {
    const line = optionLine(section, name);
    if (!line) out.push(`no line for option ${name}`);
    else if (!/default/i.test(line)) out.push(`option ${name} names no default`);
  }
  for (const phrase of [VOICEOVER_DISCLOSURE, ...TRIGGERS, 'any run that cannot pause for an answer', 'intake: skipped (', 'values used: format <format>']) {
    if (!section.includes(phrase)) out.push(`missing "${phrase}"`);
  }
  const sound = optionLine(section, 'sound') ?? '';
  for (const cue of CUE_NAMES) if (!sound.includes(cue)) out.push(`sound line lacks cue ${cue}`);
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

test('the intake format option lists the four format names, with 16:9 the default, and no pixel sizes', () => {
  const line = optionLine(intakeSection(read('SKILL.md')), 'format');
  for (const name of ['16:9', '9:16', '1:1', '4:5']) assert.ok(line.includes(`\`${name}\``), `names ${name}`);
  assert.match(line, /`16:9` \(default\)/);
  assert.ok(!/\d{3,4}x\d{3,4}/.test(line), 'no 1920x1080-style sizes: the preset names replace them');
});

test('the intake lists only options make-motion can do today', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(!/kenney/i.test(section), 'no Kenney samples until they land');
  for (const re of [/\bTask \d+[a-c]?\b/, /\bPhase 0b\b/, /\bGate \d\b/]) assert.ok(!re.test(section), `no plan reference ${re}`);
});

test('the Audio is opt-in paragraph still says never add audio, and now points at the intake', () => {
  const md = read('SKILL.md');
  const para = md.split('\n').find((l) => l.startsWith('**Audio is opt-in.**'));
  assert.ok(para, 'paragraph exists');
  assert.ok(para.includes('Never add audio'), 'the opt-in rule stands');
  assert.ok(para.includes('Intake (one round)'), 'the ask-one-question sentence points at the intake');
});

test('the opening paragraph sends the agent to the intake before Cheaper model, and the intake says when to skip it', () => {
  const md = read('SKILL.md');
  const pointer = md.indexOf('Intake (one round)');
  assert.ok(pointer > -1 && pointer < md.indexOf('\n## Cheaper model\n'), 'pointer before ## Cheaper model');
  assert.ok(md.slice(0, md.indexOf('\n## ')).includes('Intake (one round)'), 'pointer is in the opening text');
  assert.ok(md.slice(0, md.indexOf('\n## ')).includes('hand-off brief'), 'answers go in the hand-off brief');
  assert.match(intakeSection(md), /already settles every option that matters, skip the round/);
});

test('naming a music or voice file counts as asking for that track', () => {
  const md = read('SKILL.md');
  assert.match(optionLine(intakeSection(md), 'assets'), /counts as asking for that track/);
  assert.ok(md.split('\n').find((l) => l.startsWith('**Audio is opt-in.**')).includes('counts as asking for that track'));
});

test('the fallback line reports the values used, not a fixed template', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(!section.includes('no assets, no voiceover, no sound'), 'no fixed list of defaults');
  assert.match(section, /not the defaults/);
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
  assert.deepEqual(problems(section.replaceAll('250 MB', 'big')), [`missing "${VOICEOVER_DISCLOSURE}"`]);
  assert.deepEqual(problems(section.replace('`codex exec`', 'x')), ['missing "`codex exec`"']);
  assert.deepEqual(problems(section.replace('ding)', 'x)')), ['sound line lacks cue ding']);
  const noDefault = section.split('\n').map((l) => (l.includes('**CTA**') ? l.replace(/default/gi, 'usually') : l)).join('\n');
  assert.deepEqual(problems(noDefault), ['option CTA names no default']);
});
