// --batch rows.json --out "<folder>/{name}.mp4" (scripts/v2/batch.mjs): the rows file, the file name each row gets,
// and the rule that every row is checked before the first one renders. A stub stands in for the renderer. No browser.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import '../../scripts/v2/list.mjs';
import { BATCH_MAX_ROWS, BatchError, outPathFor, readRows, runBatch } from '../../scripts/v2/batch.mjs';

const VARS = { name: { type: 'string', default: 'Ada' } };
const FILM = { version: 2, vars: VARS, shots: [{ id: 'hi', show: 'statement', say: 'Welcome, {{name}}.' }] };

let dir;
before(() => { dir = mkdtempSync(path.join(tmpdir(), 'mm-batch-')); });
after(() => rmSync(dir, { recursive: true, force: true }));
const write = (name, value) => {
  const file = path.join(dir, name);
  writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

test('outPathFor fills {index} (from 1) and a var, inside the template folder', () => {
  assert.equal(outPathFor('renders/{name}.mp4', { name: 'Grace' }, 1, VARS), path.join('renders', 'Grace.mp4'));
  assert.equal(outPathFor('renders/{index}-{name}.mp4', {}, 3, VARS), path.join('renders', '3-Ada.mp4'));
});

test('outPathFor refuses every file-name value that could leave the folder or misname a file, naming the row', () => {
  const bad = ['../../x', '/abs', 'a/b', 'a\\b', 'x\u0000y', 'tab\there', '.hidden', 'CON', 'nul.txt', 'com1', 'LPT9', '..', ''];
  for (const value of bad) {
    assert.throws(() => outPathFor('renders/{name}.mp4', { name: value }, 4, VARS), (err) => err instanceof BatchError && /^row 4: /.test(err.message), JSON.stringify(value));
  }
});

test('outPathFor refuses a placeholder that is not {index} or a var of the film', () => {
  assert.throws(() => outPathFor('renders/{nme}.mp4', {}, 1, VARS), /\{nme\}.*not a var/);
});

test('readRows: a JSON array of objects, at most BATCH_MAX_ROWS; anything else is refused', () => {
  assert.deepEqual(readRows(write('ok.json', [{ name: 'A' }])), [{ name: 'A' }]);
  assert.throws(() => readRows(write('obj.json', { name: 'A' })), /array/);
  assert.throws(() => readRows(write('row.json', [5])), /row 1/);
  assert.throws(() => readRows(write('many.json', Array.from({ length: BATCH_MAX_ROWS + 1 }, () => ({})))), new RegExp(`at most ${BATCH_MAX_ROWS}`));
  assert.throws(() => readRows(write('bad.json', '[{')), /not valid JSON/);
});

const stubIo = (calls) => ({ log: () => {}, launch: async () => ({ close: async () => {} }), runRow: async (options) => { calls.push(options); throw new Error('the stub renderer was called'); } });

test('every row is checked before the first renders: a bad row 5 of 5 means the renderer is never called', async () => {
  const film = write('film.json', FILM);
  const rows = write('five.json', [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: '../E' }]);
  const calls = [];
  const { report, exitCode } = await runBatch({ specPath: film, batch: rows, out: path.join(dir, 'r', '{name}.mp4') }, stubIo(calls));
  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
  assert.ok(report.errors.some((e) => /^row 5: /.test(e)), JSON.stringify(report.errors));
});

test('a row whose substituted film is invalid is named with its row and path', async () => {
  const film = write('film-say.json', FILM);
  const rows = write('markup.json', [{ name: 'fine' }, { name: 'wait... no' }]);
  const calls = [];
  const { report, exitCode } = await runBatch({ specPath: film, batch: rows, out: path.join(dir, 's', '{name}.mp4') }, stubIo(calls));
  assert.equal(exitCode, 1);
  assert.equal(calls.length, 0);
  assert.ok(report.errors.some((e) => /^row 2: shots\[0\]\.say: /.test(e)), JSON.stringify(report.errors));
});

test('two rows that give one file name both rows (case folded, as a Mac or Windows disk would)', async () => {
  const film = write('film-dup.json', FILM);
  const rows = write('dup.json', [{ name: 'Ada' }, { name: 'Bo' }, { name: 'ada' }]);
  const { report } = await runBatch({ specPath: film, batch: rows, out: path.join(dir, 'd', '{name}.mp4') }, stubIo([]));
  assert.ok(report.errors.some((e) => /rows 1 and 3/.test(e)), JSON.stringify(report.errors));
});

test('an output folder that is a symbolic link to elsewhere is refused', async () => {
  const elsewhere = path.join(dir, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, path.join(dir, 'linked'));
  const { report, exitCode } = await runBatch({ specPath: write('film-link.json', FILM), batch: write('one.json', [{ name: 'A' }]), out: path.join(dir, 'linked', '{name}.mp4') }, stubIo([]));
  assert.equal(exitCode, 1);
  assert.ok(report.errors.some((e) => /symbolic link/.test(e)), JSON.stringify(report.errors));
});

test('an unknown column is ignored with one warning per column, and the rows still render with their values', async () => {
  const lines = [];
  const rendered = [];
  const io = {
    log: (line) => lines.push(line),
    launch: async () => ({ close: async () => {} }),
    runRow: async (options) => {
      rendered.push(options);
      mkdirSync(path.dirname(options.out), { recursive: true });
      writeFileSync(options.out, `video of ${options.values.name}`);
      return { report: { ok: true, findings: [] }, exitCode: 0 };
    },
  };
  const rows = write('cols.json', [{ name: 'A', colour: 'red' }, { name: 'B', colour: 'blue', size: 2 }]);
  const out = path.join(dir, 'w', '{name}.mp4');
  const { report, exitCode } = await runBatch({ specPath: write('film-cols.json', FILM), batch: rows, out }, io);
  assert.equal(exitCode, 0);
  assert.deepEqual(lines.filter((l) => /column/.test(l)).length, 2, lines.join('\n'));
  assert.deepEqual(rendered.map((o) => o.values), [{ name: 'A' }, { name: 'B' }]);
  const manifest = JSON.parse(readFileSync(path.join(dir, 'w', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.rows.map((r) => [r.index, r.status, path.basename(r.file)]), [[1, 'ok', 'A.mp4'], [2, 'ok', 'B.mp4']]);
  assert.match(manifest.rows[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(report.manifest, path.join(dir, 'w', 'manifest.json'));
  assert.ok(existsSync(manifest.rows[1].file));
});
