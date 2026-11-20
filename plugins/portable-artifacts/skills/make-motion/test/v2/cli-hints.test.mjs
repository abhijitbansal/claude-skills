// The flags version 1 had and version 2 does not: each is a usage error (exit 2) that says what to do instead, then the
// accepted flags. Also what Task 1 of the v1-gaps plan settled: --list voices, and doctor --for <film.json> asking for
// the voice package only when the film is narrated by the synthesiser. No browser, no ffmpeg.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HERE } from './helpers/session.mjs';
import { FLAGS, REMOVED_FLAGS, parseMakeArgs } from '../../scripts/v2/cli.mjs';
import { UsageError } from '../../shared/cli.mjs';
import { ACCEPTED_VOICES } from '../../scripts/v2/voice/kokoro.mjs';
import { requirementsFor } from '../../scripts/lib/requirements.mjs';

const MAKE = path.resolve(HERE, '../../../scripts/make.mjs');
const FILM = path.resolve(HERE, '../../../references/examples/v2/kinds-desk.json');
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', timeout: 60_000 });

// The sentences the plan fixes, verbatim.
const EXPECTED = Object.freeze({
  '--contact-sheet': 'sheets are written on every run; use --sheets-only for sheets alone',
  '--quality': 'use --preview for a quick look at the film (--sheets-only writes the stills alone)',
  '--fps': 'set fps and format in the film',
  '--size': 'set fps and format in the film',
  '--theme': 'a film has a look; see --list looks',
  '--loudness': "a film is mastered to its mode's level",
  '--true-peak': "a film is mastered to its mode's level",
});

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-cli-hints-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const writeFilm = (name, film) => {
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify(film));
  return file;
};

test('REMOVED_FLAGS holds the plan\'s sentences, frozen, and none of them is an accepted flag', () => {
  assert.deepEqual({ ...REMOVED_FLAGS }, EXPECTED);
  assert.ok(Object.isFrozen(REMOVED_FLAGS));
  for (const flag of Object.keys(REMOVED_FLAGS)) assert.ok(!FLAGS.includes(flag), `${flag} is both removed and accepted`);
});

test('the caption files and audio[] that will be ported are not listed as removed', () => {
  const sentences = Object.values(REMOVED_FLAGS).join(' ');
  assert.doesNotMatch(sentences, /srt|vtt|audio\[\]/);
});

for (const [flag, sentence] of Object.entries(EXPECTED)) {
  test(`${flag} exits 2 with its sentence and the accepted flags`, () => {
    const run = make([FILM, flag, 'x']);
    assert.equal(run.status, 2, run.stderr);
    assert.equal(run.stdout, '');
    assert.ok(run.stderr.includes(sentence), run.stderr);
    assert.match(run.stderr, /--out, --json, --sheets-only, --outline, --list/);
  });
}

test('a removed flag written with = is caught the same way', () => {
  const run = make([FILM, '--quality=draft']);
  assert.equal(run.status, 2);
  assert.ok(run.stderr.includes(EXPECTED['--quality']), run.stderr);
});

test('with --json the report\'s error.hint holds the sentence', () => {
  const run = make([FILM, '--theme', 'paper', '--json']);
  assert.equal(run.status, 2);
  const report = JSON.parse(run.stdout);
  assert.equal(report.ok, false);
  assert.match(report.error.message, /--theme/);
  assert.ok(report.error.hint.includes(EXPECTED['--theme']), report.error.hint);
  assert.match(report.error.hint, /accepted flags/);
});

test('an unknown flag that is not in the map still gets the plain accepted list and no removal sentence', () => {
  const run = make([FILM, '--sparkle']);
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Unknown option '--sparkle'/);
  assert.match(run.stderr, /--out, --json, --sheets-only, --outline, --list/);
  for (const sentence of Object.values(EXPECTED)) assert.ok(!run.stderr.includes(sentence));
});

// Merge regression: main (1.3.0) made every entry script answer --help (eval/test/docs-facts.test.mjs); make.mjs exited 2.
test('--help prints the usage line on stdout and exits 0, in text and under --json', () => {
  const text = make(['--help']);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^usage: node scripts\/make\.mjs <film\.json>; accepted flags: --out,/);
  assert.equal(text.stderr, '');
  const json = make(['--help', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, true);
  assert.match(parsed.usage, /accepted flags: --out,/);
});

test('parseMakeArgs throws a UsageError that carries the sentence as its hint', () => {
  assert.throws(() => parseMakeArgs([FILM, '--fps', '60']), (err) => err instanceof UsageError && err.hint.startsWith(EXPECTED['--fps']));
});

test('a value that happens to spell a removed flag after --out is not mistaken for it', () => {
  assert.throws(() => parseMakeArgs([FILM, '--out', '--fps']), (err) => err instanceof UsageError && err.hint === undefined);
});

// ---- Step 1 (c): the voices the validator accepts can be listed ----

test('--list voices prints the voices the validator accepts', () => {
  const run = make(['--list', 'voices']);
  assert.equal(run.status, 0, run.stderr);
  for (const name of ACCEPTED_VOICES) assert.match(run.stdout, new RegExp(`^${name} `, 'm'));
  const json = JSON.parse(make(['--list', 'voices', '--json']).stdout);
  assert.deepEqual(json.entries.map((e) => e.name), [...ACCEPTED_VOICES]);
  assert.ok(json.entries.every((e) => e.summary.length > 0));
});

// ---- Step 1 (b): doctor --for <film.json> ----

const ids = (spec) => requirementsFor(spec).map((r) => r.id);

test('doctor --for a synthesised-voice film asks for the voice package, as required', () => {
  const file = writeFilm('voiced', { version: 2, voice: { name: 'af_heart' }, shots: [{ id: 'a', show: 'statement', say: 'Hello.' }] });
  assert.ok(ids(file).includes('kokoro'));
  assert.equal(requirementsFor(file).find((r) => r.id === 'kokoro').required, true);
});

test('doctor --for a silent film, or one with a recording of its own, asks for nothing extra', () => {
  const silent = writeFilm('silent', { version: 2, shots: [{ id: 'a', show: 'statement', say: 'Hello.' }] });
  const recorded = writeFilm('recorded', { version: 2, voice: { src: 'vo.wav', words: 'vo.json' }, shots: [{ id: 'a', show: 'statement', say: 'Hello.' }] });
  assert.ok(!ids(silent).includes('kokoro'));
  assert.ok(!ids(recorded).includes('kokoro'));
  assert.deepEqual(ids(silent), ids('render'));
});

test('doctor --for a film that is not JSON says so instead of guessing', () => {
  const file = path.join(dir, 'broken.json');
  writeFileSync(file, '{ not json');
  assert.throws(() => requirementsFor(file), /broken\.json/);
});
