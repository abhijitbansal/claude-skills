// Task 25: the storyboard step. A clip over 20 s gets a make-explainer `plan` page the user answers before the spec is
// written; the step is skipped (one stdout line, exit 0, no file) when the clip is short, make-explainer is not beside
// this skill, or the run cannot pause for an answer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { STORYBOARD_MIN_SECONDS, storyboardDecision, storyboardPlan, checkBrief } from '../scripts/lib/storyboard.mjs';
import '../scripts/v2/list.mjs'; // registers the kinds the films below use, as make.mjs does
import { loadFilm } from '../scripts/v2/pipeline.mjs';
import { storyboardPlan as filmPlan } from '../scripts/v2/storyboard.mjs';
import { main } from '../scripts/storyboard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'scripts/storyboard.mjs');
const REAL_EXPLAINER = path.resolve(root, '..', 'make-explainer');
const REAL_VALIDATE = path.join(REAL_EXPLAINER, 'scripts/validate.mjs');
// validate.mjs imports ajv from make-explainer's own node_modules: without them the check cannot run (CI installs them first).
const REAL_SIBLING_SKIP = !existsSync(REAL_VALIDATE) ? 'make-explainer is not beside this skill'
  : !existsSync(path.join(REAL_EXPLAINER, 'node_modules/ajv')) && 'make-explainer has no node_modules (run npm ci there)';
const made = [];
after(() => made.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const scene = (id, beat, seconds) => ({ id, beat, seconds });
const LONG = {
  title: 'Q3 revenue up 18%',
  seconds: 30,
  scenes: [
    scene('intro', 'Revenue grew 18% in Q3', 6),
    scene('number', 'The number counts up to 4.2 million', 8),
    scene('chart', 'Bars show Q1 to Q3', 10),
    scene('close', 'Ask the reader to read the report', 6),
  ],
};
const SHORT = { title: 'Quick update', seconds: 12, scenes: [scene('a', 'Say hello', 4), scene('b', 'Show one number', 4), scene('c', 'Say goodbye', 4)] };

function tmp() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'storyboard-')));
  made.push(dir);
  return dir;
}

// A temp copy of the skill (only what storyboard.mjs imports), with or without a fake make-explainer beside it.
function skillCopy({ withExplainer }) {
  const base = tmp();
  const skill = path.join(base, 'make-motion');
  mkdirSync(path.join(skill, 'scripts/lib'), { recursive: true });
  cpSync(path.join(root, 'shared'), path.join(skill, 'shared'), { recursive: true });
  cpSync(CLI, path.join(skill, 'scripts/storyboard.mjs'));
  cpSync(path.join(root, 'scripts/lib/storyboard.mjs'), path.join(skill, 'scripts/lib/storyboard.mjs'));
  const explainer = path.join(base, 'make-explainer');
  if (withExplainer) {
    mkdirSync(explainer);
    writeFileSync(path.join(explainer, 'SKILL.md'), '---\nname: make-explainer\n---\n');
  }
  return { base, skill, explainer, cli: path.join(skill, 'scripts/storyboard.mjs') };
}

function run(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function writeBrief(dir, brief) {
  const file = path.join(dir, 'brief.json');
  writeFileSync(file, JSON.stringify(brief));
  return file;
}

// ---- storyboardDecision ------------------------------------------------------------------------------------------

test('STORYBOARD_MIN_SECONDS is 20', () => assert.equal(STORYBOARD_MIN_SECONDS, 20));

test('storyboardDecision skips a clip of 20 s or less, and says so in the exact words', () => {
  assert.deepEqual(storyboardDecision({ seconds: 12, explainerDir: REAL_EXPLAINER, nonInteractive: false }), { action: 'skip', reason: 'not needed (12s is 20s or less)' });
  assert.deepEqual(storyboardDecision({ seconds: 20, explainerDir: REAL_EXPLAINER, nonInteractive: false }), { action: 'skip', reason: 'not needed (20s is 20s or less)' });
});

test('storyboardDecision writes for a clip over 20 s when the sibling is there and someone can answer', () => {
  const { explainer } = skillCopy({ withExplainer: true });
  assert.deepEqual(storyboardDecision({ seconds: 20.5, explainerDir: explainer, nonInteractive: false }), { action: 'write' });
});

test('storyboardDecision skips when make-explainer is not beside make-motion, naming where it looked', () => {
  const { explainer } = skillCopy({ withExplainer: false });
  assert.deepEqual(storyboardDecision({ seconds: 30, explainerDir: explainer, nonInteractive: false }), {
    action: 'skip',
    reason: `make-explainer is not installed beside make-motion (looked in ${path.join(explainer, 'SKILL.md')})`,
  });
});

test('storyboardDecision skips a non-interactive run', () => {
  const { explainer } = skillCopy({ withExplainer: true });
  assert.deepEqual(storyboardDecision({ seconds: 30, explainerDir: explainer, nonInteractive: true }), { action: 'skip', reason: 'no one to ask (non-interactive run)' });
});

test('storyboardDecision checks length first, then the sibling, then whether anyone can answer', () => {
  const { explainer } = skillCopy({ withExplainer: false });
  assert.match(storyboardDecision({ seconds: 5, explainerDir: explainer, nonInteractive: true }).reason, /^not needed/);
  assert.match(storyboardDecision({ seconds: 30, explainerDir: explainer, nonInteractive: true }).reason, /^make-explainer is not installed/);
});

// ---- storyboardPlan ----------------------------------------------------------------------------------------------

test('storyboardPlan emits a plan page with the sections in the specified order', () => {
  const plan = storyboardPlan(LONG);
  assert.equal(plan.preset, 'plan');
  assert.equal(plan.key, 'q3-revenue-up-18');
  assert.deepEqual(plan.sections.map((s) => s.type), ['tldr', 'timeline', 'steps', 'decision', 'approval', 'question', 'verdict']);
  assert.deepEqual(plan.sections.filter((s) => s.id).map((s) => s.id), ['decision-1', 'approval-1', 'question-1', 'verdict']);
});

test('storyboardPlan: the timeline has one event per scene, dated "<seconds>s · <id>", text = the beat', () => {
  const [, timeline, steps] = storyboardPlan(LONG).sections;
  assert.deepEqual(timeline.items.map((i) => i.date), ['6s · intro', '8s · number', '10s · chart', '6s · close']);
  assert.deepEqual(timeline.items.map((i) => i.text), LONG.scenes.map((s) => s.beat));
  assert.equal(steps.items.length, LONG.scenes.length);
  assert.deepEqual(steps.items.map((i) => i.title), LONG.scenes.map((s) => s.beat));
});

test('storyboardPlan: the tldr says what the clip says in one line', () => {
  const [tldr] = storyboardPlan(LONG).sections;
  assert.match(tldr.text, /Q3 revenue up 18%/);
  assert.ok(!tldr.text.includes('\n'));
});

test('storyboardPlan: the theme decision offers dusk, press and poster and defaults to dusk', () => {
  const decision = storyboardPlan(LONG).sections[3];
  assert.deepEqual(decision.options.map((o) => o.label), ['dusk', 'press', 'poster']);
  assert.equal(decision.default, 'dusk');
  assert.equal(decision.recommended, 'dusk');
});

test('storyboardPlan recommends a theme by the SKILL.md rules: press for docs and recaps, poster for launches and demos', () => {
  const press = storyboardPlan({ ...LONG, title: 'Changelog for the 2.0 release' }).sections[3];
  assert.equal(press.recommended, 'press');
  assert.equal(press.default, 'dusk');
  const poster = storyboardPlan({ ...LONG, title: 'Launch day demo' }).sections[3];
  assert.equal(poster.recommended, 'poster');
  assert.equal(poster.default, 'dusk');
});

test('storyboardPlan: a theme named in the brief wins, and is the default too', () => {
  const decision = storyboardPlan({ ...LONG, theme: 'poster' }).sections[3];
  assert.equal(decision.recommended, 'poster');
  assert.equal(decision.default, 'poster');
  const other = storyboardPlan({ ...LONG, theme: 'blueprint' }).sections[3];
  assert.deepEqual(other.options.map((o) => o.label), ['dusk', 'press', 'poster', 'blueprint']);
  assert.equal(other.recommended, 'blueprint');
});

test('storyboardPlan: key is a slug of the title, safe for the answers file', () => {
  assert.equal(storyboardPlan({ ...LONG, title: '  Café: Q3 — "Big" Win!!  ' }).key, 'cafe-q3-big-win');
  assert.equal(storyboardPlan({ ...LONG, title: '!!!' }).key, 'storyboard');
  assert.match(storyboardPlan({ ...LONG, title: 'x'.repeat(78) }).key, /^[a-z0-9][a-z0-9._-]*$/);
});

test('storyboardPlan does not change the brief it is given', () => {
  const brief = structuredClone(LONG);
  storyboardPlan(brief);
  assert.deepEqual(brief, LONG);
});

// ---- checkBrief --------------------------------------------------------------------------------------------------

test('checkBrief accepts a good brief', () => assert.deepEqual(checkBrief(LONG), []));

test('a storyboard brief of 150 s is accepted', () => {
  const brief = { title: 'Long walkthrough', seconds: 150, scenes: [scene('a', 'Open', 50), scene('b', 'Middle', 50), scene('c', 'Close', 50)] };
  assert.deepEqual(checkBrief(brief), []);
});

test('checkBrief names the field and the fix for each problem', () => {
  const bad = (brief) => checkBrief(brief).join('\n');
  assert.match(bad(null), /brief: must be a JSON object/);
  assert.match(bad({ ...LONG, title: '' }), /brief\.title: /);
  assert.match(bad({ ...LONG, seconds: 'x' }), /brief\.seconds: must be a number/);
  assert.match(bad({ ...LONG, scenes: [] }), /brief\.scenes: /);
  assert.match(bad({ ...LONG, scenes: [scene('a', '', 30)] }), /brief\.scenes\[0\]\.beat: /);
  assert.match(bad({ ...LONG, scenes: [scene('a', 'x', 15), scene('a', 'y', 15)] }), /brief\.scenes\[1\]\.id: duplicate scene id "a"/);
  assert.match(bad({ ...LONG, scenes: [scene('a', 'x', 0), scene('b', 'y', 30)] }), /brief\.scenes\[0\]\.seconds: /);
  assert.match(bad({ ...LONG, seconds: 40 }), /brief\.seconds: 40 does not match the scenes, which add up to 30/);
  assert.match(bad({ ...LONG, theme: 'duskk' }), /brief\.theme: unknown theme "duskk"; did you mean "dusk"\?/);
  assert.match(bad({ ...LONG, extra: 1 }), /brief\.extra: unknown field/);
});

// ---- the CLI: scripts/storyboard.mjs now reads a draft version 2 film (v1-gaps plan Task 9) -------------------------
// The skip rules, exit codes, overwrite rules and build line are the ones the brief interface had; the input is a film,
// whose length is its estimated timeline. `main` takes the make-explainer folder, so the sibling can be absent or fake.

const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const still = (id, hold) => ({ id, show: 'free', hold, background: '#f3eee3', nodes: [BAR] });
const LONG_FILM = { version: 2, shots: [still('intro', 10), still('number', 10), still('close', 10)] };
const SHORT_FILM = { version: 2, shots: [still('a', 6), still('b', 6)] };

function writeFilm(dir, film, name = 'film.json') {
  const file = path.join(dir, name);
  writeFileSync(file, JSON.stringify(film));
  return file;
}

// A folder with a fake make-explainer (its SKILL.md only), or none.
function explainerIn(base, { present }) {
  const explainer = path.join(base, 'make-explainer');
  if (present) {
    mkdirSync(explainer);
    writeFileSync(path.join(explainer, 'SKILL.md'), '---\nname: make-explainer\n---\n');
  }
  return explainer;
}

// main() in process with its output captured: { status, stdout, stderr }.
function call(args, explainerDir) {
  const out = [];
  const err = [];
  const status = main(args, { explainerDir, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { status, stdout: out.join(''), stderr: err.join('') };
}

test('CLI skips a film of 20 s or less: one stdout line, exit 0, no file', () => {
  const base = tmp();
  const out = path.join(base, 'plan.json');
  const result = call([writeFilm(base, SHORT_FILM), '--out', out], explainerIn(base, { present: true }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'storyboard: skipped (not needed (12 s is 20 s or less))\n');
  assert.equal(result.stderr, '');
  assert.equal(existsSync(out), false);
});

test('CLI skips when make-explainer is not beside the skill', () => {
  const base = tmp();
  const explainer = explainerIn(base, { present: false });
  const out = path.join(base, 'plan.json');
  const result = call([writeFilm(base, LONG_FILM), '--out', out], explainer);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, `storyboard: skipped (make-explainer is not installed beside make-motion (looked in ${path.join(explainer, 'SKILL.md')}))\n`);
  assert.equal(existsSync(out), false);
});

test('CLI skips under --non-interactive even when the sibling is there', () => {
  const base = tmp();
  const out = path.join(base, 'plan.json');
  const result = call([writeFilm(base, LONG_FILM), '--out', out, '--non-interactive'], explainerIn(base, { present: true }));
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'storyboard: skipped (no one to ask (non-interactive run))\n');
  assert.equal(existsSync(out), false);
});

test('CLI writes plan.json for a 30 s film with the sibling beside it and no --non-interactive', () => {
  const base = tmp();
  const explainer = explainerIn(base, { present: true });
  const film = writeFilm(base, LONG_FILM);
  const out = path.join(base, 'plan.json');
  const result = call([film, '--out', out], explainer);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${out}\nbuild: node ${path.join(explainer, 'scripts/build.mjs')} ${out}\n`);
  const loaded = loadFilm(film);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), filmPlan(loaded.film, loaded.timeline, { name: 'film' }));
});

test('CLI creates the folder of --out', () => {
  const base = tmp();
  const out = path.join(base, 'deep/er/plan.json');
  assert.equal(call([writeFilm(base, LONG_FILM), '--out', out], explainerIn(base, { present: true })).status, 0);
  assert.equal(existsSync(out), true);
});

test('CLI exit 2 with the accepted options for an unknown or misspelt option', () => {
  const base = tmp();
  const explainer = explainerIn(base, { present: true });
  const film = writeFilm(base, LONG_FILM);
  for (const flag of ['--bogus', '--non-interactve']) {
    const result = call([film, '--out', path.join(base, 'plan.json'), flag], explainer);
    assert.equal(result.status, 2, flag);
    assert.match(result.stderr, /accepted options: --out <file>, --non-interactive/);
    assert.equal(result.stdout, '');
  }
  assert.equal(existsSync(path.join(base, 'plan.json')), false);
});

test('CLI exit 2 for missing --out, a missing film, two films, or --out pointing at the film', () => {
  const base = tmp();
  const explainer = explainerIn(base, { present: true });
  const film = writeFilm(base, LONG_FILM);
  assert.equal(call([film], explainer).status, 2);
  assert.match(call([film], explainer).stderr, /--out/);
  assert.equal(call([path.join(base, 'nope.json'), '--out', path.join(base, 'plan.json')], explainer).status, 2);
  assert.equal(call([film, film, '--out', path.join(base, 'plan.json')], explainer).status, 2);
  const clash = call([film, '--out', film], explainer);
  assert.equal(clash.status, 2);
  assert.match(clash.stderr, /--out/);
  assert.deepEqual(JSON.parse(readFileSync(film, 'utf8')), LONG_FILM);
});

test('CLI refuses to overwrite a file that is not a storyboard plan, but refreshes one that is', () => {
  const base = tmp();
  const explainer = explainerIn(base, { present: true });
  const film = writeFilm(base, LONG_FILM);
  const other = path.join(base, 'other.json');
  const spec = JSON.stringify({ version: 2, shots: [] });
  writeFileSync(other, spec);
  const clash = call([film, '--out', other], explainer);
  assert.equal(clash.status, 2);
  assert.match(clash.stderr, /--out: other\.json exists and is not a storyboard plan/);
  assert.equal(readFileSync(other, 'utf8'), spec);
  const out = path.join(base, 'plan.json');
  assert.equal(call([film, '--out', out], explainer).status, 0);
  assert.equal(call([film, '--out', out], explainer).status, 0, 'a rerun replaces its own plan');
});

test('CLI quotes the path in the build line it prints', () => {
  const base = tmp();
  const out = path.join(base, 'my plan;x.json');
  const result = call([writeFilm(base, LONG_FILM), '--out', out], explainerIn(base, { present: true }));
  assert.equal(result.status, 0);
  assert.match(result.stdout, /build: node \S+build\.mjs '[^']*my plan;x\.json'\n/);
});

test('CLI exit 2 for a film that is not JSON, exit 1 with the validator lines for one that breaks the rules', () => {
  const base = tmp();
  const explainer = explainerIn(base, { present: true });
  const out = path.join(base, 'plan.json');
  const notJson = path.join(base, 'bad.json');
  writeFileSync(notJson, '{ nope');
  assert.equal(call([notJson, '--out', out], explainer).status, 2);
  const wrong = call([writeFilm(base, { version: 2, shots: [{ id: 'a', show: 'nope', hold: 1 }] }, 'wrong.json'), '--out', out], explainer);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /^shots\[0\]\.show: /m);
  assert.equal(existsSync(out), false);
});

test('the command runs as a script: a 30 s film prints the plan path and the build line naming the real sibling', () => {
  const base = tmp();
  const out = path.join(base, 'plan.json');
  const written = run(CLI, [writeFilm(base, LONG_FILM), '--out', out]);
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /^build: node .*make-explainer\/scripts\/build\.mjs /m);
});

test('a plan from a 30 s film passes make-explainer validate.mjs with no warnings (real sibling)', { skip: REAL_SIBLING_SKIP }, () => {
  const base = tmp();
  const out = path.join(base, 'plan.json');
  assert.equal(run(CLI, [writeFilm(base, LONG_FILM), '--out', out]).status, 0);
  const validated = spawnSync(process.execPath, [REAL_VALIDATE, out, '--json'], { encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  const report = JSON.parse(validated.stdout);
  assert.deepEqual(report.errors, []);
  // The generatedBy provenance warning is the agent's to answer (build --model/--effort/--agent);
  // the storyboard's own content must raise no other warning.
  assert.deepEqual(report.warnings.filter((w) => w.path !== 'generatedBy'), []);
});

test('a plan from a film with narration and an experimental look still validates (real sibling)', { skip: REAL_SIBLING_SKIP }, () => {
  const base = tmp();
  const out = path.join(base, 'plan.json');
  const film = { version: 2, look: 'cosmos', shots: [{ id: 'hook', show: 'statement', say: 'A one-line hook that names the problem the customer has today and why it costs real money.' }, still('proof', 20)] };
  assert.equal(run(CLI, [writeFilm(base, film), '--out', out]).status, 0);
  const validated = spawnSync(process.execPath, [REAL_VALIDATE, out], { encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
});
