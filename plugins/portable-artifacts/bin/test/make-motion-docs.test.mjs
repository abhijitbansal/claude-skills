// make-motion's own documents (SKILL.md, README.md, references/*.md) hold no claim the code does not: every link resolves,
// every name the pages show for --list, a look, a kind, a root field, a report key or an exit code is the one the code
// returns, and the version 1 to version 2 pair in migrating.md is refused and accepted by the real validator.
// Built-ins only, no browser. Each rule has a guardrail test that feeds it one wrong claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMON_SHOT_FIELDS } from '../../skills/make-motion/scripts/v2/list.mjs'; // also registers the looks, kinds, modes, cuts and devices
import { registries } from '../../skills/make-motion/engine/registry.mjs';
import { isParkedKind, listedKinds, supportsKind } from '../../skills/make-motion/engine/looks/index.mjs';
import { LIST_NAMES, FLAGS, REMOVED_FLAGS, parseMakeArgs } from '../../skills/make-motion/scripts/v2/cli.mjs';
import { ROOT_FIELDS, validateFilm } from '../../skills/make-motion/scripts/v2/spec.mjs';
import { CUES_MAX, AUDIO_MAX } from '../../skills/make-motion/scripts/v2/spec-sound.mjs';
import { VARS_MAX } from '../../skills/make-motion/scripts/v2/vars.mjs';
import { MAX_WORKERS } from '../../skills/make-motion/scripts/v2/workers.mjs';
import { KNOWN_CUES } from '../../skills/make-motion/scripts/v2/sound/synth.mjs';
import { errorReport, reportOf } from '../../skills/make-motion/scripts/v2/report.mjs';

const MOTION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../skills/make-motion');
const read = (...parts) => fs.readFileSync(path.join(MOTION, ...parts), 'utf8');
const DOCS = ['SKILL.md', 'README.md', 'references/schema.md', 'references/story.md', 'references/migrating.md'];
const SECTION_OF = { skill: 'SKILL.md', schema: 'references/schema.md', migrating: 'references/migrating.md' };
const COUNT_WORDS = { 7: 'seven', 16: 'sixteen' };

// The text under "## <heading>" up to the next "## ", or null.
export function section(md, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return md.match(new RegExp(`^## ${escaped}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))?.[1] ?? null;
}

// The backticked words in a piece of text.
const ticks = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
// The rows of the first markdown table in `text`, each as its cells.
const tableRows = (text) => text.split('\n').filter((l) => l.startsWith('|') && !/^\|[-| ]+\|$/.test(l)).slice(1)
  .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const sorted = (list) => [...list].sort();

// ---- links ------------------------------------------------------------------------------------------------------------

/** Every `references/...` path and `scripts/<name>.mjs` a document names that does not exist in the skill folder. */
export function brokenLinks(md) {
  const found = [
    ...[...md.matchAll(/references\/[A-Za-z0-9_./-]+[A-Za-z0-9]/g)].map((m) => m[0]),
    ...[...md.matchAll(/scripts\/[a-z-]+\.mjs/g)].map((m) => m[0]),
  ];
  return [...new Set(found)].filter((rel) => !fs.existsSync(path.join(MOTION, rel)));
}

test('every references/ path and scripts/ file the five documents name exists', () => {
  for (const doc of DOCS) assert.deepEqual(brokenLinks(read(doc)), [], doc);
});

// Every film under references/examples/v2 is one a user can render from an install: it validates against the shipped looks.
// (hand-spike.json used the test-only look "hand-test", so it exited 1 there: it lives in test/v2/fixtures now.)
test('every example film validates with the shipped looks, so it renders from an install', () => {
  const folder = path.join(MOTION, 'references/examples/v2');
  const films = fs.readdirSync(folder).filter((f) => f.endsWith('.json'));
  assert.ok(films.length >= 20, 'the examples are there');
  for (const name of films) {
    const result = validateFilm(JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')), { specDir: folder });
    assert.deepEqual(result.errors, [], name);
  }
});

test('SKILL.md links the three reference files, and each exists', () => {
  const md = read('SKILL.md');
  for (const ref of ['references/schema.md', 'references/story.md', 'references/migrating.md']) {
    assert.ok(md.includes(ref), `SKILL.md links ${ref}`);
    assert.ok(fs.existsSync(path.join(MOTION, ref)), `${ref} exists`);
  }
});

test('the finished films SKILL.md names are in references/examples/v2', () => {
  const lookup = section(read('SKILL.md'), 'Looking things up');
  const films = ticks(lookup).filter((t) => /^[a-z0-9-]+\.json$/.test(t));
  assert.ok(films.length >= 5, 'it names the example films');
  for (const film of films) assert.ok(fs.existsSync(path.join(MOTION, 'references/examples/v2', film)), film);
});

test('guardrail: a link to a missing reference or script is caught', () => {
  assert.deepEqual(brokenLinks('see references/nope.md and scripts/nope.mjs and references/schema.md'), ['references/nope.md', 'scripts/nope.mjs']);
});

// ---- --list names -------------------------------------------------------------------------------------------------------

/** The names a document gives to `--list <name>`, or `--list=<name>`, that are not in LIST_NAMES. */
export function unknownListNames(md) {
  const names = [...md.matchAll(/--list[ =]`?([a-z]+)`?/g)].map((m) => m[1]);
  return [...new Set(names)].filter((name) => !LIST_NAMES.includes(name));
}

test('every --list name a document shows is one the code returns', () => {
  for (const doc of DOCS) assert.deepEqual(unknownListNames(read(doc)), [], doc);
});

test('SKILL.md names all eight --list names, and schema.md has a row for each', () => {
  const lookup = section(read('SKILL.md'), 'Looking things up');
  for (const name of LIST_NAMES) assert.ok(lookup.includes(name), `SKILL.md names ${name}`);
  const rows = tableRows(section(read('references/schema.md'), 'The `--list` names'));
  assert.deepEqual(sorted(rows.map((r) => ticks(r[0])[0])), sorted(LIST_NAMES));
});

test('guardrail: a --list name the code lacks is caught', () => {
  assert.deepEqual(unknownListNames('run `make.mjs --list captions` and --list kinds'), ['captions']);
});

// ---- looks, kinds, parked kinds in SKILL.md ----------------------------------------------------------------------

const lookNames = () => registries.looks.names();
const excludedKinds = (look) => listedKinds().filter((k) => registries.kinds.get(k).lookData === true && !supportsKind(look, k));
const parkedKinds = (look) => listedKinds().filter((k) => isParkedKind(look, k));

/** The rows of the looks table in SKILL.md: `| `desk` | pro | none | none |` -> { look, modes, parked, excluded }. */
export function looksTable(md, heading = 'Looking things up') {
  const text = section(md, heading) ?? '';
  return tableRows(text).map(([look, modes, parked, excluded]) => ({
    look: ticks(look)[0], modes: modes.split(',').map((s) => s.trim()).filter(Boolean),
    parked: parked === 'none' ? [] : ticks(parked), excluded: excluded === 'none' ? [] : ticks(excluded),
  }));
}

/** What the looks table under `heading` claims that the registry does not say; empty when it agrees. */
export function lookRowProblems(md, heading) {
  const out = [];
  const rows = looksTable(md, heading);
  if (JSON.stringify(sorted(rows.map((r) => r.look))) !== JSON.stringify(sorted(lookNames()))) out.push(`the looks table lists ${rows.map((r) => r.look).join(', ')}`);
  for (const row of rows) {
    if (!registries.looks.has(row.look)) { out.push(`unknown look ${row.look}`); continue; }
    const look = registries.looks.get(row.look);
    if (JSON.stringify(sorted(row.modes)) !== JSON.stringify(sorted(look.modes ?? []))) out.push(`${row.look}: modes ${row.modes}`);
    if (JSON.stringify(sorted(row.parked)) !== JSON.stringify(sorted(parkedKinds(look)))) out.push(`${row.look}: parked ${row.parked}`);
    if (JSON.stringify(sorted(row.excluded)) !== JSON.stringify(sorted(excludedKinds(look)))) out.push(`${row.look}: excluded ${row.excluded}`);
  }
  return out;
}

/** What SKILL.md claims about looks and kinds that the registry does not say: its table and its list of kinds. */
export function lookClaimProblems(md) {
  const out = lookRowProblems(md, 'Looking things up');
  const lookup = section(md, 'Looking things up') ?? '';
  const kinds = listedKinds();
  const named = ticks((lookup.match(/The (\w+) kinds are ([^\n]*?)\.(?: |\n)/) ?? [])[2] ?? '');
  if (JSON.stringify(sorted(named)) !== JSON.stringify(sorted(kinds))) out.push(`the kinds it lists: ${named.join(', ')}`);
  const word = (lookup.match(/The (\w+) kinds are/) ?? [])[1];
  if (word !== COUNT_WORDS[kinds.length]) out.push(`it says "${word}" kinds; the code lists ${kinds.length}`);
  return out;
}

test('SKILL.md lists the looks, their modes, the kinds, and the parked and excluded kinds as the code returns them', () => {
  assert.deepEqual(lookClaimProblems(read('SKILL.md')), []);
  assert.equal(lookNames().length, 7);
  assert.equal(listedKinds().length, 16);
});

test('README.md has the same looks table under "Looks", checked against the code', () => {
  const readme = read('README.md');
  assert.deepEqual(lookRowProblems(readme, 'Looks'), []);
  assert.deepEqual(looksTable(readme, 'Looks'), looksTable(read('SKILL.md')));
  assert.match(lookRowProblems(readme.replace('| `ledger` |', '| `lodger` |'), 'Looks').join(), /lodger/);
});

test('SKILL.md says pop has no ripple cut, and the code agrees', () => {
  assert.ok(!registries.looks.get('pop').cuts.includes('ripple'));
  assert.ok(registries.cuts.has('ripple') && registries.looks.get('cosmos').cuts.includes('ripple'));
  assert.match(read('SKILL.md'), /The `pop` look has no `ripple` cut\./);
});

test('the parked kinds the code returns are the ones the decisions record names (a mutation would move one)', () => {
  const byLook = Object.fromEntries(lookNames().map((n) => [n, parkedKinds(registries.looks.get(n))]));
  assert.deepEqual(byLook.ledger, ['number']);
  assert.deepEqual(sorted(byLook.marker), ['chart', 'feed', 'free', 'number', 'timeline']);
  assert.deepEqual(sorted(excludedKinds(registries.looks.get('marker'))), ['code', 'screen']);
});

test('guardrail: a wrong look, mode, parked kind, excluded kind or kind count in SKILL.md is caught', () => {
  const md = read('SKILL.md');
  assert.ok(md.includes('| `ledger` |'));
  const row = md.split('\n').find((l) => l.startsWith('| `marker` |'));
  assert.ok(row, 'the marker row exists');
  assert.match(lookClaimProblems(md.replace('| `ledger` |', '| `lodger` |')).join(), /lodger/);
  assert.match(lookClaimProblems(md.replace(row, row.replace('`chart`, ', ''))).join(), /marker: parked/);
  assert.match(lookClaimProblems(md.replace(row, row.replace('`screen`', '`media`'))).join(), /marker: excluded/);
  assert.match(lookClaimProblems(md.replace('The sixteen kinds are', 'The fifteen kinds are')).join(), /fifteen/);
  assert.match(lookClaimProblems(md.replace('`feed` and `free`', '`free`')).join(), /the kinds it lists/);
});

// ---- schema.md: root fields, shot fields, report, exit codes ---------------------------------------------------------

const firstTicks = (rows) => rows.map((r) => ticks(r[0])[0]);

test('schema.md lists exactly the root fields the validator takes', () => {
  const rows = tableRows(section(read('references/schema.md'), 'Root fields'));
  assert.deepEqual(sorted(firstTicks(rows)), sorted(ROOT_FIELDS));
});

test('schema.md lists exactly the fields every shot takes', () => {
  const rows = tableRows(section(read('references/schema.md'), 'Fields every shot takes'));
  assert.deepEqual(firstTicks(rows), COMMON_SHOT_FIELDS.map((f) => f.name));
});

test('schema.md lists the report keys the code builds, and the keys that appear only sometimes', () => {
  const text = section(read('references/schema.md'), 'The report');
  const always = tableRows(text).flatMap((r) => ticks(r[0]));
  const sometimes = ticks(text.match(/These keys appear only when they apply: ([^\n]*)/)[1]);
  const blank = { validated: false, error: null, stages: [], findings: [], sheets: [], output: null, timed: null, voice: null, audio: null, post: null, capture: null, frames: 0, captured: 0, seconds: null, msPerFrame: null, bytes: null, mbps: null };
  assert.deepEqual(sorted(always), sorted(Object.keys(reportOf(blank))));
  const full = reportOf({ ...blank, poster: {}, workers: 2, subtitles: {}, cuts: { ran: ['x'], replaced: [] }, look: {}, kinds: [{}], error: { message: 'x', hint: '' } });
  assert.deepEqual(sorted(sometimes), sorted(Object.keys(full).filter((k) => !always.includes(k))));
  assert.deepEqual(Object.keys(errorReport({ message: 'x', hint: '' })).filter((k) => !always.includes(k)), ['error']);
});

test('schema.md gives the exit codes make.mjs prints, and the limits the code holds', () => {
  const usage = (() => { try { parseMakeArgs(['--help']); } catch (err) { return err.message; } return ''; })();
  const codes = [...usage.match(/exit codes: ([^\n]*)/)[1].matchAll(/(\d+) /g)].map((m) => Number(m[1]));
  const text = section(read('references/schema.md'), 'Exit codes');
  assert.deepEqual(tableRows(text).map((r) => Number(r[0])), codes);
  const limits = section(read('references/schema.md'), 'Limits');
  const row = (label) => Number(tableRows(limits).find((r) => r[0] === label)[1].match(/\d+/g).at(-1));
  assert.equal(row('Sound cues'), CUES_MAX);
  assert.equal(row('Extra audio files'), AUDIO_MAX);
  assert.equal(row('Variables'), VARS_MAX);
  assert.equal(row('`--workers`'), MAX_WORKERS);
});

test('the cues the schema and migrating pages list are the ones the synth knows', () => {
  const schema = section(read('references/schema.md'), 'Sound').match(/The cue is one of ([^\n]*?)\./)[1];
  assert.deepEqual(sorted(ticks(schema)), sorted(KNOWN_CUES));
  const migrating = read('references/migrating.md').match(/Cues are synthesised: ([^|]*?) \|/)[1];
  assert.deepEqual(sorted(ticks(migrating)), sorted(KNOWN_CUES));
});

test('guardrail: a misspelt root field, a wrong report key, a wrong exit code and a wrong limit are caught', () => {
  const schema = read('references/schema.md');
  const rootNames = (md) => firstTicks(tableRows(section(md, 'Root fields')));
  assert.deepEqual(sorted(rootNames(schema)), sorted(ROOT_FIELDS));
  assert.notDeepEqual(sorted(rootNames(schema.replace('| `accent` |', '| `accnt` |'))), sorted(ROOT_FIELDS));
  const reportKeys = (md) => tableRows(section(md, 'The report')).flatMap((r) => ticks(r[0]));
  assert.ok(reportKeys(schema).includes('bytes'));
  assert.notDeepEqual(sorted(reportKeys(schema.replace('`seconds`, `msPerFrame`, `bytes`, `mbps`', '`seconds`, `msPerFrame`, `byts`, `mbps`'))), sorted(Object.keys(errorReport({ message: 'x', hint: '' })).filter((k) => k !== 'error')));
  const codes = (md) => tableRows(section(md, 'Exit codes')).map((r) => Number(r[0]));
  assert.deepEqual(codes(schema), [0, 1, 2, 130]);
  assert.notDeepEqual(codes(schema.replace('| 130 |', '| 131 |')), [0, 1, 2, 130]);
  const limit = (md, label) => Number(tableRows(section(md, 'Limits')).find((r) => r[0] === label)[1].match(/\d+/g).at(-1));
  assert.equal(limit(schema, 'Sound cues'), CUES_MAX);
  assert.notEqual(limit(schema.replace('| Sound cues | 64 |', '| Sound cues | 99 |'), 'Sound cues'), CUES_MAX);
});

// ---- migrating.md --------------------------------------------------------------------------------------------------------

test('migrating.md names every flag version 2 refuses, and no other flag as removed', () => {
  const md = read('references/migrating.md');
  const line = md.split('\n').find((l) => l.startsWith('- `--contact-sheet`'));
  assert.ok(line, 'the Not in 2.0 list names the removed flags');
  assert.deepEqual(sorted(ticks(line).filter((t) => t.startsWith('--'))), sorted(Object.keys(REMOVED_FLAGS)));
  for (const flag of Object.keys(REMOVED_FLAGS)) assert.throws(() => parseMakeArgs(['film.json', flag]), /not a flag in version 2/);
});

test('migrating.md: the version 1 film is refused and the version 2 film validates', () => {
  const blocks = [...read('references/migrating.md').matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
  assert.equal(blocks.length, 2);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrating-'));
  const before = validateFilm(blocks[0], { specDir: dir });
  assert.equal(before.ok, false);
  assert.match(before.errors[0].message, /version 1 spec; make-motion 2 reads version 2 only\. See references\/migrating\.md/);
  assert.deepEqual(validateFilm(blocks[1], { specDir: dir }), { ok: true, errors: [] });
});

test('migrating.md names the old model folder, the frame cache and the voice packages to delete', () => {
  const text = section(read('references/migrating.md'), 'Old folders to delete');
  for (const word of ['.cache/video', 'onnx-community/Kokoro-82M-v1.0-ONNX', 'kokoro-js', '.cache/cutout', 'doctor.mjs --fix cache', 'doctor.mjs --fix kokoro']) assert.ok(text.includes(word), word);
});

// ---- commands and flags ---------------------------------------------------------------------------------------------------

// Every flag the five scripts and the doctor define, read from their own source.
function knownFlags() {
  const files = ['scripts/make.mjs', 'scripts/v2/cli.mjs', 'scripts/doctor.mjs', 'scripts/cutout.mjs', 'scripts/beats.mjs', 'scripts/storyboard.mjs',
    'scripts/lib/cutout-cli.mjs', 'scripts/lib/beats.mjs', 'scripts/lib/help.mjs', 'scripts/v2/storyboard.mjs', 'shared/doctor.mjs'];
  const text = files.filter((f) => fs.existsSync(path.join(MOTION, f))).map((f) => read(f)).join('\n');
  return new Set([...text.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0]));
}
// Flags of npm and Playwright the install lines use, and two version 1 voice.mjs flags that migrating.md names as gone.
const NPM_AND_TOOL_FLAGS = new Set(['--ignore-scripts', '--prefix', '--with-deps', '--omit', '--parseable', '--audit-level', '--text-file', '--list-voices']);

export function unknownFlags(md, known) {
  return [...new Set([...md.matchAll(/(?<![\w-])--[a-z][a-z-]*/g)].map((m) => m[0]))].filter((f) => !known.has(f) && !NPM_AND_TOOL_FLAGS.has(f));
}

test('every --flag the five documents name is one a script defines', () => {
  const known = knownFlags();
  for (const flag of FLAGS) assert.ok(known.has(flag), flag);
  for (const doc of DOCS) assert.deepEqual(unknownFlags(read(doc), known), [], doc);
});

test('guardrail: a flag no script defines is caught', () => {
  assert.deepEqual(unknownFlags('run make.mjs --render-fast and --json', knownFlags()), ['--render-fast']);
});

// ---- what needs what ---------------------------------------------------------------------------------------------------

// Lines of `md` that call --outline a Node-only step: it needs the skill's npm packages (make.mjs checks for them first).
export function nodeOnlyOutline(md) {
  return md.split('\n').filter((line) => /outline/i.test(line) && /\bNode only\b|needs only Node/i.test(line));
}

test('no document calls --outline "Node only": it needs the skill\'s installed npm packages, not a browser or ffmpeg', () => {
  for (const doc of DOCS) assert.deepEqual(nodeOnlyOutline(read(doc)), [], doc);
  const skill = read('SKILL.md');
  assert.match(skill, /outline[^\n]*npm packages|npm packages[^\n]*outline/i, 'SKILL.md says what the outline needs');
});

test('guardrail: a line that calls the outline Node only is caught', () => {
  assert.equal(nodeOnlyOutline('run the outline (Node only)\nit needs only Node: --outline\nthe doctor needs only Node').length, 2);
});

// Lines that claim no network at render time without saying the voice model is the exception.
export function unqualifiedNoNetwork(md) {
  return md.split('\n').filter((line) => /no network|offline/i.test(line) && !/voice model|\b93 MB\b/i.test(line) && /render/i.test(line));
}

test('the first voiced render fetches the pinned voice model once (93 MB, SHA-256 checked); no document says "no network at render time" without that', () => {
  for (const doc of ['SKILL.md', 'README.md']) {
    const md = read(doc);
    assert.deepEqual(unqualifiedNoNetwork(md), [], doc);
    assert.match(md, /voice model[^\n]*\b93 MB\b|\b93 MB\b[^\n]*voice model/, `${doc} names the one download and its size`);
    assert.match(md, /SHA-256/, `${doc} says the download is checked`);
  }
  assert.match(read('README.md'), /offline/i, 'README says renders are otherwise offline');
});

test('guardrail: an unqualified "no network at render time" is caught', () => {
  assert.equal(unqualifiedNoNetwork('on your machine, with no network at render time.').length, 1);
  assert.equal(unqualifiedNoNetwork('no network at render time except the voice model, once.').length, 0);
});

test('every install command in the skill folder documents carries --ignore-scripts', () => {
  for (const doc of DOCS) {
    for (const line of read(doc).split('\n')) {
      if (/\bnpm (ci|install)\b/.test(line) && !/npm install --package-lock-only/.test(line)) assert.ok(line.includes('--ignore-scripts'), `${doc}: ${line.trim()}`);
    }
  }
});
