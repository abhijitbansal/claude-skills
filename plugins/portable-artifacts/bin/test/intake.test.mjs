import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../skills/make-motion/scripts/v2/list.mjs'; // registers the looks, modes and kinds
import { registries } from '../../skills/make-motion/engine/registry.mjs';
import { FORMATS } from '../../skills/make-motion/scripts/v2/spec.mjs';
import { KNOWN_CUES } from '../../skills/make-motion/scripts/v2/sound/synth.mjs';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/make-motion');
const HEADING = 'Intake (one round)';
const read = (file) => fs.readFileSync(path.join(MOTION, file), 'utf8');

// The "## Intake (one round)" section: from its heading to the next "## " heading.
export function intakeSection(md) {
  const m = md.match(new RegExp(`^## ${HEADING.replace(/[()]/g, '\\$&')}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  return m ? m[1] : null;
}

// One option per list line: a bold name, then text that must carry a default.
const OPTIONS = ['mode', 'look', 'format', 'length', 'assets', 'voice', 'music', 'sound', 'ask'];
// The voice install is disclosed without a size until the doctor's figures are measured (cut-over Task 4 fills them in): the
// line says what is installed and that the doctor reports its size.
const VOICE_DISCLOSURE = 'a one-time install of the voice package and its model';
const TRIGGERS = ['`claude -p`', '`codex exec`', '`copilot -p`', 'the eval'];
export const optionLine = (section, name) => section.split('\n').find((l) => l.startsWith(`- **${name}**`));

// The look names the section lists, as sub-bullets of the look option: "  - `desk`: …".
export const listedLooks = (section) => [...section.matchAll(/^ {2}- `([a-z]+)`:/gm)].map((m) => m[1]);

export function problems(section) {
  const out = [];
  for (const name of OPTIONS) {
    const line = optionLine(section, name);
    if (!line) out.push(`no line for option ${name}`);
    else if (!/default/i.test(line)) out.push(`option ${name} names no default`);
  }
  for (const phrase of [VOICE_DISCLOSURE, 'reports their size', ...TRIGGERS, 'any run that cannot pause for an answer', 'intake: skipped (', 'values used: mode <mode>, look <look>, format <format>, length <seconds> s', 'voice <on or off>, music <bed, file or none>, sound <on or off>, ask <text or none>']) {
    if (!section.includes(phrase)) out.push(`missing "${phrase}"`);
  }
  const voice = optionLine(section, 'voice') ?? '';
  if (/\d\s*(MB|GB)\b/i.test(voice)) out.push('the voice line states a size');
  const sound = optionLine(section, 'sound') ?? '';
  for (const cue of KNOWN_CUES) if (!sound.includes(cue)) out.push(`sound line lacks cue ${cue}`);
  const looks = listedLooks(section);
  for (const name of registries.looks.names()) if (!looks.includes(name)) out.push(`look ${name} is not listed`);
  for (const name of looks) if (!registries.looks.names().includes(name)) out.push(`lists a look that does not exist: ${name}`);
  return out;
}

test('make-motion/SKILL.md has an Intake (one round) section with every option, a default for each, every look and the fallback', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(section, `missing "## ${HEADING}"`);
  assert.deepEqual(problems(section), []);
});

test('the intake section sits before Workflow, and the heading is unique', () => {
  const md = read('SKILL.md');
  assert.equal(md.split(`\n## ${HEADING}\n`).length, 2, 'exactly one section');
  assert.ok(md.indexOf(`## ${HEADING}`) < md.indexOf('\n## Workflow\n'), 'before ## Workflow');
});

test('the intake look names are the registry\'s, each with its one-line feel, and the defaults are the modes\' own', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.deepEqual(listedLooks(section).sort(), [...registries.looks.names()].sort());
  const line = optionLine(section, 'look');
  for (const mode of ['pro', 'viral']) {
    const own = registries.modes.get(mode).defaultLook;
    assert.ok(line.includes(`\`${own}\` for \`${mode}\``), `the default look of ${mode} is ${own}`);
  }
  for (const m of section.matchAll(/^ {2}- `[a-z]+`: (.+)$/gm)) assert.ok(m[1].length > 20, 'a look gets a line of its feel');
});

test('the intake format option lists the format names of the validator, with 16:9 the default of pro, and no pixel sizes', () => {
  const line = optionLine(intakeSection(read('SKILL.md')), 'format');
  for (const name of FORMATS) assert.ok(line.includes(`\`${name}\``), `names ${name}`);
  assert.match(line, /`16:9` \(default for `pro`\)/);
  assert.match(line, /`9:16` \(default for `viral`\)/);
  assert.equal(registries.modes.get('pro').defaultFormat, '16:9');
  assert.equal(registries.modes.get('viral').defaultFormat, '9:16');
  assert.ok(!/\d{3,4}x\d{3,4}/.test(line), 'no 1920x1080-style sizes: the preset names replace them');
});

test('the intake mode option names pro and viral and the field it sets, and a platform sets viral', () => {
  const line = optionLine(intakeSection(read('SKILL.md')), 'mode');
  assert.deepEqual([...registries.modes.names()].sort(), ['pro', 'viral']);
  for (const name of ['pro', 'viral']) assert.ok(line.includes(`\`${name}\``), `names ${name}`);
  assert.ok(line.includes('"mode": "viral"'), 'says which field it sets');
  for (const name of ['Reels', 'TikTok', 'Shorts']) assert.ok(line.includes(name), `names ${name}`);
  assert.match(line, /`pro` \(default\)/);
});

test('the intake lists only what make-motion can do today: the cues the synth knows, the beds it makes, no plan reference', () => {
  const section = intakeSection(read('SKILL.md'));
  const sound = optionLine(section, 'sound');
  for (const cue of KNOWN_CUES) assert.ok(sound.includes(cue), `the sound option offers ${cue}`);
  assert.ok(!sound.includes('kenney:'), 'the recorded samples are gone');
  for (const bed of ['pulse', 'drift', 'tape']) assert.ok(optionLine(section, 'music').includes(bed), `the music option offers the ${bed} bed`);
  for (const re of [/\bTask \d+[a-c]?\b/, /\bPhase 0b\b/, /\bGate \d\b/]) assert.ok(!re.test(section), `no plan reference ${re}`);
});

test('the skipped line carries all nine values, and the nothing-settled line reports the defaults', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.match(section, /values used: mode <mode>, look <look>, format <format>, length <seconds> s, assets <files or none>, voice <on or off>, music <bed, file or none>, sound <on or off>, ask <text or none>`/);
  assert.match(section, /`mode pro, look desk, format 16:9, length 30 s, assets none, voice off, music none, sound off, ask none`/);
});

test('the Audio is opt-in paragraph still says never add audio, and points at the intake', () => {
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
  assert.match(optionLine(intakeSection(md), 'music'), /counts as asking for that track/);
  assert.ok(md.split('\n').find((l) => l.startsWith('**Audio is opt-in.**')).includes('counts as asking for that track'));
});

test('the fallback line reports the values used, not a fixed template', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(!section.includes('no assets, no voiceover, no sound'), 'no fixed list of defaults');
  assert.match(section, /not the defaults/);
});

test('SKILL.md names a look, never a theme: no theme flag, no theme section', () => {
  const md = read('SKILL.md');
  assert.ok(!md.includes('--theme'));
  assert.ok(!/^## Choosing a theme$/m.test(md));
  assert.ok(optionLine(intakeSection(md), 'look').includes('`look`'), 'the option names the film field it writes');
});

test('README Quick start mentions the intake round', () => {
  const readme = read('README.md');
  const quick = readme.match(/^## Quick start\n([\s\S]*?)(?=^## )/m)[1];
  assert.match(quick, /intake/i);
  assert.match(quick, /defaults/i);
});

test('guardrail: a missing option, a missing default, a missing look, a size or a missing fallback is caught', () => {
  const section = intakeSection(read('SKILL.md'));
  assert.ok(section.includes('**voice**'));
  assert.deepEqual(problems(section.replace('**voice**', '**narration**')), ['no line for option voice']);
  assert.deepEqual(problems(section.replace('any run that cannot pause for an answer', 'x')), ['missing "any run that cannot pause for an answer"']);
  assert.deepEqual(problems(section.replaceAll('reports their size', 'knows')), ['missing "reports their size"']);
  assert.deepEqual(problems(section.replace('`codex exec`', 'x')), ['missing "`codex exec`"']);
  assert.deepEqual(problems(section.replace('erase)', 'x)')), ['sound line lacks cue erase']);
  assert.deepEqual(problems(section.replace('  - `ledger`:', '  - `lodger`:')), ['look ledger is not listed', 'lists a look that does not exist: lodger']);
  assert.deepEqual(problems(section.replace('and its model, and', 'and its model (440 MB), and')), ['the voice line states a size']);
  const noDefault = section.split('\n').map((l) => (l.includes('**ask**') ? l.replace(/default/gi, 'usually') : l)).join('\n');
  assert.deepEqual(problems(noDefault), ['option ask names no default']);
});
