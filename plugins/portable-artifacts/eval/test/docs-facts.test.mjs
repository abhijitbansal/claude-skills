// PA-58: the plugin README and USAGE state facts that the code defines: how many section types, blocks, chart kinds
// and themes there are, which skills take which doctor `--for` target, what each skill installs and weighs, what ships
// under which licence, which flags exist. This test reads those facts from the code and checks the two docs against them,
// so a count or a list that drifts fails here instead of in a user's terminal. It reads README.md and USAGE.md only:
// each skill's SKILL.md and references are checked by their own tests.
// The guardrail proofs at the bottom show each check failing on a wrong sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../lib.mjs';

const PLUGIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILLS_DIR = path.join(PLUGIN, 'skills');
const read = (rel) => fs.readFileSync(path.join(PLUGIN, rel), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const README = squash(read('README.md'));
const USAGE_RAW = read('USAGE.md');
const USAGE = squash(USAGE_RAW);
const skillNames = fs.readdirSync(SKILLS_DIR).filter((d) => d.startsWith('make-')).sort();

const { TYPES: SECTION_TYPES } = await import('../../skills/make-explainer/scripts/lib/schema.mjs');
const { KIND_NAMES } = await import('../../skills/make-dashboard/scripts/lib/kinds.mjs');
const { listThemes } = await import('../../shared/theme.mjs');
const { INSTALL_SIZES } = await import('../../shared/doctor.mjs');

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const words = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
const capitalised = (s) => s[0].toUpperCase() + s.slice(1);
const alnum = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// ---- facts read from the code ---------------------------------------------------------------------------------

// The `--for` keywords each skill's doctor takes: `export const targets` in scripts/lib/requirements.mjs.
async function doctorTargets() {
  const byTarget = {};
  for (const skill of skillNames) {
    const { targets } = await import(`../../skills/${skill}/scripts/lib/requirements.mjs`);
    for (const t of targets) (byTarget[t] ??= []).push(skill);
  }
  return byTarget;
}

// The skills a doc sentence names for a target, from "`check` (every skill: …)" or "`voiceover` or `cutout` (make-motion)".
// null when the sentence is missing.
function documentedSkills(text, target) {
  const m = new RegExp(`\`${target}\`(?: or \`\\w+\`)* \\(([^)]*)\\)`).exec(text);
  if (!m) return null;
  if (/every skill/.test(m[1])) return [...skillNames];
  return [...new Set(m[1].match(/make-[a-z]+/g) ?? [])].sort();
}

// ---- doctor targets ---------------------------------------------------------------------------------------------

test('README says which skills take each doctor --for keyword, as the code defines them', async () => {
  const byTarget = await doctorTargets();
  assert.deepEqual(Object.keys(byTarget).sort(), ['check', 'cutout', 'voiceover']);
  for (const [target, skills] of Object.entries(byTarget)) {
    assert.deepEqual(documentedSkills(README, target), [...skills].sort(), `README, \`--for ${target}\``);
  }
});

test('USAGE says which skills take each doctor --for keyword, in its prose and in its command list', async () => {
  const byTarget = await doctorTargets();
  for (const [target, skills] of Object.entries(byTarget)) {
    assert.deepEqual(documentedSkills(USAGE, target), [...skills].sort(), `USAGE prose, \`--for ${target}\``);
    const line = USAGE_RAW.split('\n').find((l) => new RegExp(`doctor\\.mjs --json --for ${target}\\b`).test(l));
    assert.ok(line, `USAGE has a command line for --for ${target}`);
    const comment = line.split('#')[1]?.split(':')[0] ?? '';
    const named = /every skill/.test(comment) ? [...skillNames] : [...new Set(comment.match(/make-[a-z]+/g) ?? [])].sort();
    assert.deepEqual(named, [...skills].sort(), `USAGE command list, --for ${target}`);
  }
});

// ---- counts and lists -----------------------------------------------------------------------------------------

test('USAGE counts the explainer section types and lists every one', () => {
  const m = /\*\*Sections\*\* \((\d+)\):([^]*?)\*\*Plan mode/.exec(USAGE_RAW);
  assert.ok(m, 'USAGE has a "**Sections** (N): …" paragraph');
  assert.equal(Number(m[1]), SECTION_TYPES.length);
  for (const t of SECTION_TYPES) assert.ok(m[2].includes(`\`${t}\``), `USAGE lists the \`${t}\` section`);
});

test('README counts the dashboard chart kinds in digits', () => {
  assert.ok(README.includes(`${KIND_NAMES.length} kinds`), `README says "${KIND_NAMES.length} kinds"`);
});

test('USAGE lists every dashboard chart kind', () => {
  const m = /\*\*Chart kinds:\*\*([^]*?)Reference:/.exec(USAGE_RAW);
  assert.ok(m, 'USAGE has a "**Chart kinds:**" bullet');
  for (const k of KIND_NAMES) assert.ok(m[1].includes(k), `USAGE lists the ${k} chart`);
});

test('README counts the themes and names each one in its themes table', () => {
  const themes = listThemes();
  assert.ok(README.includes(`${capitalised(words(themes.length))} themes`), `README says "${capitalised(words(themes.length))} themes"`);
  const table = /\| Theme \| Display[^]*?\n\n/.exec(read('README.md'))?.[0] ?? '';
  for (const t of themes) assert.ok(table.includes(`\`${t}\``), `the themes table names \`${t}\``);
});

test('README gives the Node floor every skill declares', () => {
  const floors = new Set(skillNames.map((s) => JSON.parse(read(`skills/${s}/package.json`)).engines.node));
  assert.equal(floors.size, 1, `skills disagree on engines.node: ${[...floors]}`);
  const min = /(\d+)/.exec([...floors][0])[1];
  assert.ok(README.includes(`Node.js ≥ ${min}`), `README says "Node.js ≥ ${min}"`);
});

// ---- sizes ---------------------------------------------------------------------------------------------------------

test('README has a per-skill install-size row that matches the doctor, and names how it was measured', () => {
  const row = read('README.md').split('\n').find((l) => /^\| Installed size/.test(l));
  assert.ok(row, 'README requirements table has an "Installed size" row');
  const cells = row.split('|').map((c) => c.trim()).slice(2, -1);
  assert.deepEqual(cells.map((c) => /≈[\d–]+ MB/.exec(c)?.[0]), skillNames.map((s) => INSTALL_SIZES[s]), 'one measured figure per skill, in table order');
  assert.match(README, /npm ls --omit=dev --all --parseable/, 'the measuring command is named');
  assert.match(README, /not (?:on )?a (?:fresh|cache) install|dev checkout/, 'the figures say they come from a checkout');
});

test('README and USAGE give the on-demand voiceover install as the doctor does, not the old 250 MB', () => {
  const doctor = read('shared/doctor.mjs');
  const size = /size: '(≈\d+ MB), plus a 90 MB model on first use'/.exec(doctor)?.[1];
  assert.ok(size, 'the doctor states a kokoro size');
  for (const [name, text] of [['README', README], ['USAGE', USAGE]]) {
    assert.ok(text.includes(size) || text.includes(size.replace('≈', 'about ')), `${name} states ${size}`);
    assert.doesNotMatch(text, /(?:≈|about )250 MB/, `${name} still says 250 MB`);
  }
});

// ---- licences -------------------------------------------------------------------------------------------------------

test('every production dependency of every skill is named in the README licence table', () => {
  const section = alnum(/## Licences[^]*$/.exec(README)?.[0] ?? '');
  assert.ok(section.length > 500, 'README has a Licences section');
  const missing = [];
  for (const skill of skillNames) {
    const deps = Object.keys(JSON.parse(read(`skills/${skill}/package.json`)).dependencies ?? {});
    for (const dep of deps) {
      const full = alnum(dep);
      const bare = alnum(dep.replace(/^@[^/]+\//, ''));
      if (!section.includes(full) && !section.includes(bare)) missing.push(`${skill}: ${dep}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test('the README licence table names what the repo bundles without an npm dependency: three.js', () => {
  const section = /## Licences[^]*$/.exec(README)?.[0] ?? '';
  const notices = [
    ['three.js', 'skills/make-scene/THIRD_PARTY_NOTICES.md', /bundles \*\*three\.js/],
  ];
  for (const [name, file, marker] of notices) {
    assert.match(read(file), marker, `${file} still says it ships ${name}`);
    assert.ok(section.toLowerCase().includes(name.toLowerCase()), `the README licence table names ${name}`);
  }
});

// ---- flags ---------------------------------------------------------------------------------------------------------

// Flags of tools this plugin only tells the user to run (npm, the browser installer, git, the host CLIs, the skills CLI). The eval
// harness's own flags come from run-eval.mjs below.
const EXTERNAL_FLAGS = new Set([
  '--omit', '--no-save', '--with-deps', '--prefix', '--version', '--help', '--skill', '--oss', '--local-provider',
  '--allow-all-tools', '--yolo', '--permission-mode', '--allowedtools',
]);
const FLAG = /(?<![\w-])--[a-z][a-z0-9]*(?:-[a-z0-9]+)*/g;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test' || e.name === 'vendor' || e.name === 'results') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(mjs|js)$/.test(e.name) && !/\.min\./.test(e.name)) out.push(full);
  }
  return out;
}

function flagsInCode() {
  const files = [...walk(SKILLS_DIR), ...walk(path.join(PLUGIN, 'shared')), ...walk(path.join(PLUGIN, 'bin')), path.join(PLUGIN, 'eval/run-eval.mjs')];
  const flags = new Set(EXTERNAL_FLAGS);
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(FLAG)) flags.add(m[0].toLowerCase());
  return flags;
}

const unknownFlags = (text, known) => [...new Set([...text.matchAll(FLAG)].map((m) => m[0].toLowerCase()))].filter((f) => !known.has(f)).sort();

test('every --flag the README and USAGE name exists in a script', () => {
  const known = flagsInCode();
  assert.ok(known.has('--theme') && known.has('--strict') && known.has('--shots'), 'the scan found the scripts\' flags');
  assert.deepEqual(unknownFlags(README, known), [], 'README names a flag no script has');
  assert.deepEqual(unknownFlags(USAGE_RAW, known), [], 'USAGE names a flag no script has');
});

// USAGE says every entry script takes --help. An entry script is a top-level .mjs in a skill's scripts folder.
const entryScripts = () => skillNames.flatMap((s) => fs.readdirSync(path.join(SKILLS_DIR, s, 'scripts'), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.mjs')).map((e) => path.join(SKILLS_DIR, s, 'scripts', e.name)));

async function helpProblems(files) {
  const problems = [];
  const BATCH = 8;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => run(['node', f, '--help'], { cwd: os.tmpdir(), timeoutMs: 30000, env: { PA_NO_BROWSER: '1' } })));
    results.forEach((r, j) => {
      const name = path.relative(SKILLS_DIR, batch[j]);
      if (r.timedOut) problems.push(`${name}: --help did not return`);
      else if (r.code !== 0) problems.push(`${name}: --help exited ${r.code}`);
      else if (!/^usage:/i.test(r.out.trim())) problems.push(`${name}: --help printed no usage line`);
    });
  }
  return problems;
}

test('every entry script takes --help: a usage line on stdout and exit 0 (USAGE says so)', async () => {
  const files = entryScripts();
  assert.ok(files.length >= 34, `${files.length} entry scripts found`); // 34 measured after version 1's seven entry scripts were deleted (41 before)
  assert.match(USAGE, /Every entry script takes `--help`/);
  assert.deepEqual(await helpProblems(files), []);
});

// ...and that an unknown flag exits 2 with a message that names the accepted ones (a usage line, or "(accepted: …)").
async function unknownFlagProblems(files) {
  const problems = [];
  const BATCH = 8;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((f) => run(['node', f, '--no-such-flag-xyz'], { cwd: os.tmpdir(), timeoutMs: 30000, env: { PA_NO_BROWSER: '1' } })));
    results.forEach((r, j) => {
      const name = path.relative(SKILLS_DIR, batch[j]);
      if (r.timedOut) problems.push(`${name}: an unknown flag did not return`);
      else if (r.code !== 2) problems.push(`${name}: an unknown flag exited ${r.code}, expected 2`);
      else if (!/usage:|\(accepted: /i.test(r.out)) problems.push(`${name}: an unknown flag printed neither a usage line nor the accepted flags`);
    });
  }
  return problems;
}

test('every entry script rejects an unknown flag with exit 2 and a usage line (USAGE says so)', async () => {
  assert.match(USAGE, /an unknown flag exits 2 with the flags it does accept/);
  assert.deepEqual(await unknownFlagProblems(entryScripts()), []);
});

// ---- guardrail proofs: each check fails on a wrong sentence ------------------------------------------------------

test('guardrail proof: a script that does not handle --help is reported', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-help-'));
  try {
    fs.writeFileSync(path.join(dir, 'silent.mjs'), 'console.error("unknown flag"); process.exit(2);');
    fs.writeFileSync(path.join(dir, 'mute.mjs'), 'console.log("");');
    const problems = await helpProblems([path.join(dir, 'silent.mjs'), path.join(dir, 'mute.mjs')]);
    assert.equal(problems.length, 2);
    assert.match(problems[0], /silent\.mjs: --help exited 2$/);
    assert.match(problems[1], /mute\.mjs: --help printed no usage line$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('guardrail proof: documentedSkills reads the sentence and a wrong list or a missing sentence is caught', () => {
  assert.deepEqual(documentedSkills('add `check` (make-scene and make-diagram: the browser)', 'check'), ['make-diagram', 'make-scene']);
  assert.deepEqual(documentedSkills('add `check` (every skill: the browser)', 'check'), skillNames);
  assert.deepEqual(documentedSkills('`voiceover` or `cutout` (make-motion)', 'cutout'), ['make-motion']);
  assert.equal(documentedSkills('nothing about it', 'check'), null);
  assert.notDeepEqual(documentedSkills('add `check` (make-diagram and make-scene)', 'check'), skillNames, 'a short list is not "every skill"');
});

test('guardrail proof: a wrong section count, an unknown flag and a missing licence are each reported', () => {
  assert.notEqual(Number(/\*\*Sections\*\* \((\d+)\)/.exec('**Sections** (24): `tldr`')[1]), SECTION_TYPES.length);
  assert.deepEqual(unknownFlags('run it with --preset or --theme', new Set(['--theme'])), ['--preset']);
  const section = alnum('| three.js | MIT |');
  assert.equal(section.includes(alnum('@fontsource/jetbrains-mono')), false);
  assert.equal(section.includes(alnum('three.js')), true);
});
