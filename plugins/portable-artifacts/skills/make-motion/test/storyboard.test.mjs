// The storyboard step: a film over 20 s gets a make-explainer `plan` page the user answers before the film is
// written; the step is skipped (one stdout line, exit 0, no file) when the film is short, make-explainer is not beside
// this skill, or the run cannot pause for an answer. scripts/storyboard.mjs reads a draft version 2 film (the brief
// interface of version 1 was deleted at cut-over; the film-to-plan cases live in test/v2/storyboard.test.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

function tmp() {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'storyboard-')));
  made.push(dir);
  return dir;
}

function run(cli, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// The skip rules, exit codes, overwrite rules and build line; the input is a film, whose length is its estimated timeline.
// `main` takes the make-explainer folder, so the sibling can be absent or fake.

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
