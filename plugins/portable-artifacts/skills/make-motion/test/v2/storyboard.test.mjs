// The storyboard step for a version 2 film: scripts/storyboard.mjs reads a draft film and, for one longer than 20 s,
// writes a make-explainer `plan` page (one timeline event per shot, a look decision, an approval, an open question).
// Skipped, with one stdout line, exit 0 and no file, when the film is short, make-explainer is not beside this skill, or
// the run cannot pause for an answer. No browser, no ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import { loadFilm } from '../../scripts/v2/pipeline.mjs';
import { listEntries } from '../../scripts/v2/list.mjs';
import { STORYBOARD_MIN_SECONDS, storyboardPlan } from '../../scripts/v2/storyboard.mjs';
import { main } from '../../scripts/storyboard.mjs';

const SKILL = path.resolve(HERE, '../../..'); // HERE is test/v2/helpers
const CLI = path.join(SKILL, 'scripts/storyboard.mjs');
const EXPLAINER = path.resolve(SKILL, '..', 'make-explainer');
const VALIDATE = path.join(EXPLAINER, 'scripts/validate.mjs');
const EXPLAINER_SKIP = !existsSync(VALIDATE) ? `make-explainer is not beside this skill (looked for ${VALIDATE})`
  : !existsSync(path.join(EXPLAINER, 'node_modules/ajv')) && 'make-explainer has no node_modules (run npm ci there)';

const BAR = { type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } };
const free = (id, hold) => ({ id, show: 'free', hold, background: '#f3eee3', nodes: [BAR] });
const LONG = { version: 2, look: 'desk', shots: [
  { id: 'hook', show: 'statement', say: 'Most dashboards cannot tell you *where a number came from*.' },
  free('proof', 12),
  { id: 'markup', show: 'statement', say: 'Type <b>bold</b> and _mean_ it.' },
  free('close', 12),
] };
const SHORT = { version: 2, shots: [free('a', 5), free('b', 5)] };
const INVALID = { version: 2, shots: [{ id: 'a', show: 'nope', hold: 1 }] };

let dir;
before(() => { dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'mm-storyboard-'))); });
after(() => rmSync(dir, { recursive: true, force: true }));
const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });

// ---- storyboardPlan, pure ----

test('one timeline event per shot, in order, with its id, kind, seconds and plain narration', () => {
  const { film, timeline } = loadFilm(writeFilm('long-pure', LONG));
  const plan = storyboardPlan(film, timeline, { name: 'long-pure' });
  const events = plan.sections.find((s) => s.type === 'timeline').items;
  assert.deepEqual(events.map((e) => e.title), ['hook', 'proof', 'markup', 'close']);
  timeline.shots.forEach((shot, i) => {
    assert.ok(events[i].date.includes(film.shots[i].show), events[i].date);
    assert.ok(events[i].date.includes(`${shot.start.toFixed(1)}`), events[i].date);
  });
  assert.equal(events[0].text, 'Most dashboards cannot tell you where a number came from.');
  assert.equal(events[2].text, 'Type <b>bold</b> and mean it.', 'markup characters stay text; emphasis marks are dropped');
});

test('a look decision offers the listed looks with their feel, recommends the film\'s own, an approval and one question', () => {
  const { film, timeline } = loadFilm(writeFilm('long-look', LONG));
  const plan = storyboardPlan(film, timeline, { name: 'long-look' });
  const decision = plan.sections.find((s) => s.type === 'decision');
  const looks = listEntries('looks');
  assert.deepEqual(decision.options.map((o) => o.label), looks.map((l) => l.name));
  assert.deepEqual(decision.options.map((o) => o.pros), looks.map((l) => [l.summary]));
  assert.equal(decision.recommended, 'desk');
  assert.equal(decision.default, 'desk');
  assert.equal(plan.sections.filter((s) => s.type === 'approval').length, 1);
  assert.equal(plan.sections.filter((s) => s.type === 'question').length, 1);
  assert.equal(plan.sections.at(-1).type, 'verdict');
  assert.equal(plan.preset, 'plan');
  assert.match(plan.key, /^[a-z0-9][a-z0-9._-]*$/);
});

test('the film and timeline passed in are not changed', () => {
  const { film, timeline } = loadFilm(writeFilm('long-frozen', LONG));
  const before = JSON.stringify({ film, timeline });
  storyboardPlan(film, timeline, { name: 'x' });
  assert.equal(JSON.stringify({ film, timeline }), before);
});

// ---- the command ----

test('a 30 s film writes a plan make-explainer\'s own validator accepts, and prints the build line', (t) => {
  const film = writeFilm('long', LONG);
  const { timeline } = loadFilm(film);
  assert.ok(timeline.duration > STORYBOARD_MIN_SECONDS, `the film is ${timeline.duration} s`);
  const out = path.join(dir, 'plan.json');
  const r = run(film, '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const [printed, build] = r.stdout.trim().split('\n');
  assert.equal(printed, out);
  assert.equal(build, `build: node ${path.join(EXPLAINER, 'scripts/build.mjs')} ${out}`);
  if (EXPLAINER_SKIP) return t.skip(EXPLAINER_SKIP);
  const check = spawnSync(process.execPath, [VALIDATE, out, '--json'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  // The generatedBy provenance warning (make-explainer 1.3.0) is the agent's to answer (build --model/--effort/--agent);
  // the storyboard's own content must raise no other warning (as main's version 1 storyboard test does).
  assert.deepEqual((JSON.parse(check.stdout).warnings ?? []).filter((w) => w.path !== 'generatedBy'), [], 'no warning either');
  return undefined;
});

test('a film of 20 s or less is skipped: one line, exit 0, no file', () => {
  const out = path.join(dir, 'short-plan.json');
  const r = run(writeFilm('short', SHORT), '--out', out);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^storyboard: skipped \(not needed \(10 s is 20 s or less\)\)\n$/);
  assert.equal(existsSync(out), false);
});

test('--non-interactive is skipped: one line, exit 0, no file', () => {
  const out = path.join(dir, 'ni-plan.json');
  const r = run(writeFilm('long-ni', LONG), '--out', out, '--non-interactive');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'storyboard: skipped (no one to ask (non-interactive run))\n');
  assert.equal(existsSync(out), false);
});

test('make-explainer not beside this skill is skipped, naming where it looked: exit 0, no file', () => {
  const out = path.join(dir, 'absent-plan.json');
  const lines = [];
  const missing = path.join(dir, 'no-explainer');
  const code = main([writeFilm('long-absent', LONG), '--out', out], { explainerDir: missing, out: (s) => lines.push(s), err: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.deepEqual(lines, [`storyboard: skipped (make-explainer is not installed beside make-motion (looked in ${path.join(missing, 'SKILL.md')}))\n`]);
  assert.equal(existsSync(out), false);
});

test('an invalid film exits 1 with the validator\'s line', () => {
  const r = run(writeFilm('invalid', INVALID), '--out', path.join(dir, 'invalid-plan.json'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^shots\[0\]\.show: /m);
  assert.equal(r.stdout, '');
});

test('--out missing, an unknown flag, or --out naming the film itself is exit 2', () => {
  const film = writeFilm('long-usage', LONG);
  assert.equal(run(film).status, 2);
  assert.match(run(film).stderr, /--out <file> is required/);
  const unknown = run(film, '--out', path.join(dir, 'p.json'), '--fast');
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /--out <file>, --non-interactive/);
  const self = run(film, '--out', film);
  assert.equal(self.status, 2);
  assert.deepEqual(JSON.parse(readFileSync(film, 'utf8')), LONG, 'the film is untouched');
});
