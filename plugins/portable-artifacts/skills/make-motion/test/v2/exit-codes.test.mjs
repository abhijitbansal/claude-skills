// Every way scripts/make.mjs can end, pinned as (exit code, whether the --json report carries `error`). Written before
// the cut-over unified the two UsageError classes (cut-over plan, Task 1 step 3) and run again after: the codes are
// 0 ok, 1 an invalid film or a finding, 2 usage or machine trouble, 130 interrupted (scripts/make.mjs header). The
// stop (130), the uncaught exception and the ffmpeg that exits non-zero are pinned in make.test.mjs; the voice
// package missing is pinned in make-voice.test.mjs (through run.mjs) and here (through the worker's own classifier).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_HINT, classifyError, loadRuntime } from '../../scripts/v2/voice/worker.mjs';

const MAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/make.mjs');
const BARE = { PATH: '', FFMPEG_PATH: '/nonexistent/ffmpeg', PLAYWRIGHT_BROWSERS_PATH: '/nonexistent' }; // no ffmpeg, no browser
const STILL = { id: 'held', show: 'free', hold: 1, background: '#f3eee3', nodes: [{ type: 'path', id: 'bar', props: { d: 'M300 500H1620V580H300Z', fill: '#15130f' } }] };
const FILMS = {
  held: { version: 2, shots: [STILL] },
  invalid: { version: 2, shots: [{ id: 'a', show: 'nope', hold: 1 }] },
  v1: { version: 1, scenes: [] },
};

let dir;
before(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mm-v2-exit-'));
  for (const [name, film] of Object.entries(FILMS)) writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(film));
  writeFileSync(path.join(dir, 'broken.json'), '{ "version": 2, "shots": [');
  writeFileSync(path.join(dir, 'rows.json'), '{ "not": "an array" }');
  mkdirSync(path.join(dir, 'a-folder.json'));
});
after(() => rmSync(dir, { recursive: true, force: true }));

const film = (name) => path.join(dir, `${name}.json`);
const run = (args, env = {}) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120_000 });

// One row per way to end. `error`: whether the --json report holds an `error` (true), or not (false). Text mode
// is the same run without --json: the same exit code, and the first stderr line is the error's message.
const ROWS = [
  { name: 'a valid listing', args: () => ['--list', 'kinds'], exit: 0, error: false },
  { name: 'a film path with --outline', args: () => [film('held'), '--outline'], env: BARE, exit: 0, error: false },
  { name: 'an unknown flag', args: () => [film('held'), '--fast'], exit: 2, error: true },
  { name: 'a misspelled flag', args: () => [film('held'), '--outlin'], exit: 2, error: true },
  { name: 'a removed version 1 flag', args: () => [film('held'), '--fps', '60'], exit: 2, error: true, hint: true },
  { name: 'a removed version 1 flag with no value', args: () => [film('held'), '--theme'], exit: 2, error: true, hint: true },
  { name: 'a flag that needs a value, given none', args: () => [film('held'), '--out', '--outline'], exit: 2, error: true },
  { name: 'no film path', args: () => [], exit: 2, error: true },
  { name: 'two film paths', args: () => [film('held'), film('invalid')], exit: 2, error: true },
  { name: 'an --out that is not an .mp4', args: () => [film('held'), '--out', 'film.mov'], exit: 2, error: true },
  { name: 'an unknown --list name', args: () => ['--list', 'movs'], exit: 2, error: true },
  { name: '--all without --list', args: () => [film('held'), '--all'], exit: 2, error: true },
  { name: '--poster-out without --poster', args: () => [film('held'), '--poster-out', 'p.png'], exit: 2, error: true },
  { name: '--open without --preview', args: () => [film('held'), '--open'], exit: 2, error: true },
  { name: 'a film file that is missing', args: () => [path.join(dir, 'missing.json'), '--no-render'], exit: 2, error: true },
  { name: 'a film path that is a folder', args: () => [film('a-folder'), '--no-render'], exit: 2, error: true },
  { name: 'a film file that is not JSON', args: () => [film('broken'), '--no-render'], exit: 2, error: true },
  { name: 'a film that does not validate', args: () => [film('invalid'), '--no-render'], exit: 1, error: false },
  { name: 'a version 1 spec', args: () => [film('v1'), '--no-render'], exit: 1, error: false },
  { name: 'a film that does not validate, previewed', args: () => [film('invalid'), '--preview'], exit: 1, error: false },
  // A batch reports its refusals as `errors` (a list), never `error`: it has no single stage to blame.
  { name: 'a batch rows file of the wrong shape', args: () => [film('held'), '--batch', film('rows'), '--out', path.join(dir, 'b', '{index}.mp4')], exit: 2, error: false, errors: true },
  { name: 'a batch rows file that is missing', args: () => [film('held'), '--batch', path.join(dir, 'no-rows.json'), '--out', path.join(dir, 'b', '{index}.mp4')], exit: 2, error: false, errors: true },
  { name: 'no ffmpeg on the machine', args: () => [film('held'), '--out', path.join(dir, 'no-ffmpeg', 'film.mp4')], env: BARE, exit: 2, error: true, hint: true },
];

for (const row of ROWS) {
  test(`exit ${row.exit}, ${row.error ? 'with' : 'without'} an error in the report: ${row.name}`, () => {
    const json = run([...row.args(), '--json'], row.env);
    assert.equal(json.status, row.exit, `${json.stdout}\n${json.stderr}`);
    const report = JSON.parse(json.stdout);
    assert.equal(report.error !== undefined, row.error, json.stdout);
    if (row.error) assert.ok(typeof report.error.message === 'string' && report.error.message !== '', 'the error has a message');
    if (row.hint) assert.ok(report.error.hint !== '', 'the error carries a hint');
    if (row.errors) assert.ok(Array.isArray(report.errors) && report.errors.length > 0, 'the refusals are listed');
    const text = run(row.args(), row.env);
    assert.equal(text.status, row.exit, `text mode: ${text.stderr}`);
    if (row.error || row.errors) assert.ok(text.stderr.trim() !== '', 'text mode says why on stderr');
  });
}

test('--help is not a problem: the usage on stdout and exit 0, with or without --json', () => {
  const plain = run(['--help']);
  assert.equal(plain.status, 0, plain.stderr);
  assert.match(plain.stdout, /^usage: /);
  const json = run(['--help', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.error, undefined);
  assert.ok(report.usage.length > 0);
});

test('a usage error under --json is the report of a usage error: ok false, message and hint apart, no stage ran', () => {
  const report = JSON.parse(run([film('held'), '--fps', '60', '--json']).stdout);
  assert.equal(report.ok, false);
  assert.match(report.error.message, /^--fps is not a flag in version 2/);
  assert.match(report.error.hint, /exit codes: 0 ok/, 'a removed flag ends with the accepted flags and the exit codes');
});

// The voice package missing, seen where the two UsageError classes meet: optional.mjs throws it, worker.mjs classifies it.
// A real run reaches this only after a ~90 MB model check, so it is driven here without the model: the runtime folder
// holds no package, loadRuntime refuses with the install hint, and the classifier calls that machine trouble with the
// same hint, which synth.mjs and run.mjs turn into exit 2 and `error.message` "the optional voice package is not installed".
test('a voice runtime folder with no package is machine trouble with the install hint, as classified by the worker', async () => {
  const runtime = path.join(dir, 'optional', 'voice');
  mkdirSync(runtime, { recursive: true });
  const err = await loadRuntime(runtime).then(() => null, (e) => e);
  assert.ok(err instanceof Error, 'loadRuntime refused');
  assert.equal(err.message, INSTALL_HINT);
  assert.deepEqual(classifyError(err, 'runtime'), { kind: 'machine', message: INSTALL_HINT, hint: INSTALL_HINT });
});

test('an install from before version 2 voice (a package that does not export the runtime) is machine trouble with the install hint too', async () => {
  const runtime = path.join(dir, 'old-optional', 'voice');
  mkdirSync(path.join(runtime, 'node_modules', 'onnxruntime-node'), { recursive: true });
  writeFileSync(path.join(runtime, 'node_modules', 'onnxruntime-node', 'package.json'), '{ "name": "onnxruntime-node", "version": "1.21.0" }');
  writeFileSync(path.join(runtime, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/onnxruntime-node': { version: '1.21.0' } } }));
  writeFileSync(path.join(runtime, 'package.json'), '{ "type": "module" }');
  writeFileSync(path.join(runtime, 'index.mjs'), 'export const ort = {};\n');
  const err = await loadRuntime(runtime).then(() => null, (e) => e);
  assert.ok(err instanceof Error, 'loadRuntime refused');
  assert.match(err.message, /does not export ort and phonemize/);
  const classified = classifyError(err, 'runtime');
  assert.equal(classified.kind, 'machine');
  assert.equal(classified.hint, INSTALL_HINT);
});
