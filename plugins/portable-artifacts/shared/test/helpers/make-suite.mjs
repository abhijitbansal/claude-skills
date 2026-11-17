// The tests every page skill's scripts/make.mjs must pass, written once. A skill's test/make.test.mjs calls
// defineMakeSuite({...}) and adds the tests that are its own (its real check, its own finding kinds).
//
// Most tests stand in for the skill's scripts through PA_MAKE_TEST_SCRIPTS (small stub scripts that record their argv and
// print a fixed report), so they start no browser and no dependency; the "real scripts" tests run the skill itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const REAL_TIMEOUT_MS = 120000;
const INTERRUPT_WAIT_MS = 15000;
const POLL_MS = 50;
export const ACCEPTED_BASE_FLAGS = ['--out', '--json', '--no-check', '--theme', '--model', '--effort', '--agent'];

export const tmpDir = (prefix = 'make-run-') => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));

/** Run `node <script> ...args`; resolves { status, stdout, stderr }. */
export function runNode(script, args, { env = {}, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), REAL_TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
  });
}

/** The one JSON object a --json run printed; fails when stdout holds anything else. */
export function oneObject(stdout) {
  const lines = stdout.trim().split('\n');
  assert.equal(lines.length, 1, `stdout must be one line, got: ${stdout}`);
  const body = JSON.parse(lines[0]);
  assert.ok(body !== null && typeof body === 'object' && !Array.isArray(body));
  return body;
}

/**
 * Write a stub script in `dir`: it appends { stage, argv } to $STUB_RECORD, optionally writes `page` (the build's file),
 * optionally sleeps after writing `marker` (so a test can interrupt it), prints `body` as JSON and exits with `status`.
 */
export function stub(dir, stage, { body = { ok: true, errors: [] }, status = 0, page, marker, sleep = false } = {}) {
  const file = path.join(dir, `stub-${stage}.mjs`);
  const lines = [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    `if (process.env.STUB_RECORD) fs.appendFileSync(process.env.STUB_RECORD, JSON.stringify({ stage: ${JSON.stringify(stage)}, argv: process.argv.slice(2) }) + '\\n');`,
    page ? `fs.mkdirSync(path.dirname(${JSON.stringify(page)}), { recursive: true }); fs.writeFileSync(${JSON.stringify(page)}, '<!doctype html><title>stub</title>');` : '',
    marker ? `fs.writeFileSync(${JSON.stringify(marker)}, 'started');` : '',
    sleep ? 'await new Promise((resolve) => setTimeout(resolve, 60000));' : '',
    `process.stdout.write(${JSON.stringify(`${JSON.stringify(body)}\n`)});`,
    `process.exitCode = ${status};`,
  ];
  fs.writeFileSync(file, `${lines.filter(Boolean).join('\n')}\n`);
  return file;
}

const recorded = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

/**
 * cfg: { skill, skillDir, good (a valid spec path), outArg(dir) (the --out value), outputFile(dir) (what the report names),
 * passThrough: [{ args, validate, build }] (the skill's own flags and the stages they reach), accepted: [flag, ...] }.
 */
export function defineMakeSuite(cfg) {
  const make = path.join(cfg.skillDir, 'scripts', 'make.mjs');
  const all = (args, env) => runNode(make, args, { env, cwd: cfg.skillDir });
  const json = async (args, env) => {
    const r = await all([...args, '--json'], env);
    return { ...r, report: oneObject(r.stdout) };
  };
  // A hermetic run: every stage is a stub; returns the report, the recorded argv per stage and the work folder.
  const hermetic = async ({ stubs = {}, args = [], env = {} } = {}) => {
    const dir = tmpDir();
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, '{}');
    const page = path.join(dir, 'out', 'index.html');
    const scripts = {
      doctor: stub(dir, 'doctor', { body: { ok: true, missing: [] }, ...stubs.doctor }),
      validate: stub(dir, 'validate', stubs.validate),
      build: stub(dir, 'build', { body: { ok: true, out: page }, page, ...stubs.build }),
      check: stub(dir, 'check', { body: { ok: true, views: 4, problems: [], errors: [] }, ...stubs.check }),
    };
    const record = path.join(dir, 'record.jsonl');
    const r = await json([spec, ...args], { PA_MAKE_TEST_SCRIPTS: JSON.stringify(scripts), STUB_RECORD: record, ...env });
    return { ...r, dir, page, calls: recorded(record), argvOf: (stage) => recorded(record).find((c) => c.stage === stage)?.argv };
  };

  test(`${cfg.skill}: the real scripts: a valid example exits 0 with ok true, the built page as output, and stages doctor, validate, build ok`, async () => {
    const dir = tmpDir();
    const { status, report } = await json([cfg.good, '--no-check', '--out', cfg.outArg(dir)]);
    assert.equal(status, 0);
    assert.equal(report.ok, true);
    assert.equal(report.output, cfg.outputFile(dir));
    assert.ok(fs.existsSync(report.output), 'the page exists');
    assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['doctor', true], ['validate', true], ['build', true]]);
    assert.equal('error' in report, false);
  });

  test(`${cfg.skill}: the real scripts: an invalid spec exits 1 with a mechanical finding at the validator's path, and no build stage`, async () => {
    const dir = tmpDir();
    const doc = { ...JSON.parse(fs.readFileSync(cfg.good, 'utf8')), titel: 'x' };
    const spec = path.join(dir, 'broken.json');
    fs.writeFileSync(spec, JSON.stringify(doc));
    const { status, report } = await json([spec, '--no-check', '--out', cfg.outArg(dir)]);
    assert.equal(status, 1);
    assert.equal(report.ok, false);
    assert.equal(report.output, null);
    const typo = report.findings.find((f) => f.path === 'titel');
    assert.equal(typo.kind, 'mechanical');
    assert.match(typo.message, /did you mean "title"/);
    assert.equal(typo.fix, 'rename "titel" to "title"', 'a did-you-mean becomes fix');
    assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate']);
    assert.equal(report.stages[1].ok, false);
    assert.equal('error' in report, false, 'a fault in the spec is a finding, not an error');
  });

  test(`${cfg.skill}: an unknown flag exits 2 and the error lists the accepted flags`, async () => {
    const dir = tmpDir();
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, '{}');
    const { status, report, stderr } = await json([spec, '--bogus']);
    assert.equal(status, 2);
    assert.equal(report.ok, false);
    assert.match(report.error.message, /Unknown option '--bogus'/);
    for (const flag of [...ACCEPTED_BASE_FLAGS, ...(cfg.accepted ?? [])]) assert.ok(report.error.hint.includes(flag), `hint lists ${flag}: ${report.error.hint}`);
    assert.deepEqual(report.stages, []);
    assert.equal(stderr, '', 'a usage error under --json says nothing on stderr');
  });

  test(`${cfg.skill}: no spec, or two, exits 2 with the usage line`, async () => {
    for (const args of [[], ['a.json', 'b.json']]) {
      const { status, report } = await json(args);
      assert.equal(status, 2, args.join(' '));
      assert.match(report.error.message, /expected one spec file/);
      assert.match(report.error.hint, /^usage: node scripts\/make\.mjs <spec>/);
    }
  });

  test(`${cfg.skill}: a missing spec file exits 2 with error.message and error.hint, before any stage runs`, async () => {
    const { status, report } = await json([path.join(tmpDir(), 'nope.json')]);
    assert.equal(status, 2);
    assert.equal(report.ok, false);
    assert.match(report.error.message, /^cannot read .*nope\.json/);
    assert.ok(report.error.hint.length > 0);
    assert.deepEqual(report.stages, []);
    assert.equal(report.output, null);
  });

  test(`${cfg.skill}: --help prints the usage line and exits 0`, async () => {
    const { status, report } = await json(['--help']);
    assert.equal(status, 0);
    assert.match(report.usage, /^node scripts\/make\.mjs <spec>/);
  });

  test(`${cfg.skill}: with --json stdout is exactly one JSON object on a good run, a failed run, a usage error and a machine error`, async () => {
    const cases = [
      await hermetic(),
      await hermetic({ stubs: { validate: { status: 1, body: { ok: false, errors: [{ path: 'a', message: 'bad' }] } } } }),
      await hermetic({ args: ['--bogus'] }),
      await hermetic({ stubs: { doctor: { status: 1, body: { ok: false, missing: [{ id: 'node_modules', required: true, why: 'needs npm', fix: { manual: 'run npm ci' } }] } } } }),
    ];
    assert.deepEqual(cases.map((c) => c.status), [0, 1, 2, 2]);
    for (const c of cases) assert.ok('ok' in c.report && 'output' in c.report && 'stages' in c.report && 'findings' in c.report);
  });

  test(`${cfg.skill}: without --json the text form prints one line per finding as kind: path: message`, async () => {
    const dir = tmpDir();
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, '{}');
    const scripts = {
      doctor: stub(dir, 'doctor', { body: { ok: true, missing: [] } }),
      validate: stub(dir, 'validate', { status: 1, body: { ok: false, errors: [{ path: 'charts[0].type', message: 'must be one of bar, line' }], warnings: [{ path: 'title', message: 'a long title' }] } }),
    };
    const r = await all([spec], { PA_MAKE_TEST_SCRIPTS: JSON.stringify(scripts) });
    assert.equal(r.status, 1);
    const lines = r.stdout.trim().split('\n');
    assert.equal(lines[0], 'invalid');
    assert.ok(lines.includes('mechanical: charts[0].type: must be one of bar, line'));
    assert.ok(lines.includes('creative: title: a long title'));
  });

  test(`${cfg.skill}: a validator warning is a creative finding and leaves the exit code 0`, async () => {
    const { status, report } = await hermetic({ stubs: { validate: { body: { ok: true, errors: [], warnings: [{ path: 'generatedBy', message: 'say who made it' }] } } }, args: ['--no-check'] });
    assert.equal(status, 0);
    assert.equal(report.ok, true);
    assert.deepEqual(report.findings, [{ kind: 'creative', path: 'generatedBy', message: 'say who made it' }]);
  });

  test(`${cfg.skill}: the same warning from validate and from build is one finding`, async () => {
    const warning = { path: 'title', message: 'a long title' };
    const { report } = await hermetic({ stubs: { validate: { body: { ok: true, errors: [], warnings: [warning] } }, build: { body: { ok: true, out: '', warnings: [warning] } } }, args: ['--no-check'] });
    assert.equal(report.findings.length, 1);
  });

  test(`${cfg.skill}: a build that fails exits 1 with a mechanical finding at the path it names, and the check does not run`, async () => {
    const { status, report, calls } = await hermetic({ stubs: { build: { status: 1, page: undefined, body: { ok: false, errors: [{ path: 'queries.units', message: 'Binder Error: column "x" not found' }] } } } });
    assert.equal(status, 1);
    assert.equal(report.ok, false);
    assert.deepEqual(report.findings, [{ kind: 'mechanical', path: 'queries.units', message: 'Binder Error: column "x" not found' }]);
    assert.equal(report.stages.at(-1).name, 'build');
    assert.equal(report.stages.at(-1).ok, false);
    assert.equal(calls.some((c) => c.stage === 'check'), false);
    assert.equal(report.output, null);
  });

  test(`${cfg.skill}: a check that finds a problem adds a mechanical finding and exits 1 with the page still written`, async () => {
    const problem = '1280px light: the page scrolls sideways';
    const { status, report, page } = await hermetic({ stubs: { check: { status: 1, body: { ok: false, problems: [problem], errors: [{ path: '', message: problem }] } } } });
    assert.equal(status, 1);
    assert.equal(report.ok, false);
    assert.equal(report.output, page);
    assert.deepEqual(report.findings, [{ kind: 'mechanical', path: '', message: problem }]);
    assert.deepEqual(report.stages.at(-1), { ...report.stages.at(-1), name: 'check', ok: false });
  });

  test(`${cfg.skill}: a check skipped for want of a browser gives a check stage with skipped true and leaves ok true`, async () => {
    const { status, report } = await hermetic({ stubs: { check: { body: { ok: true, skipped: true, reason: 'no browser', hint: 'run doctor' } } } });
    assert.equal(status, 0);
    assert.equal(report.ok, true);
    const check = report.stages.find((s) => s.name === 'check');
    assert.equal(check.skipped, true);
    assert.equal(check.ok, true);
  });

  test(`${cfg.skill}: a check that cannot run (exit 2) is machine trouble: exit 2 with error, the page still named`, async () => {
    const { status, report, page } = await hermetic({ stubs: { check: { status: 2, body: { ok: false, errors: [{ path: '', message: 'another headless browser is running (123). wait for it' }] } } } });
    assert.equal(status, 2);
    assert.equal(report.error.message, 'another headless browser is running (123)');
    assert.equal(report.error.hint, 'wait for it');
    assert.equal(report.output, page);
  });

  test(`${cfg.skill}: a check advisory (a warning from check) is a creative finding`, async () => {
    const { status, report } = await hermetic({ stubs: { check: { body: { ok: true, views: 4, warnings: ['the legend is under the overlay'] } } } });
    assert.equal(status, 0);
    assert.deepEqual(report.findings, [{ kind: 'creative', path: '', message: 'the legend is under the overlay' }]);
  });

  test(`${cfg.skill}: --no-check runs no check stage`, async () => {
    const { report, calls } = await hermetic({ args: ['--no-check'] });
    assert.deepEqual(report.stages.map((s) => s.name), ['doctor', 'validate', 'build']);
    assert.equal(calls.some((c) => c.stage === 'check'), false);
  });

  test(`${cfg.skill}: a doctor that reports a required item missing is exit 2 with error, and nothing else runs`, async () => {
    const missing = [{ id: 'node_modules', required: true, why: "this skill's npm packages are not installed", fix: { manual: 'run npm ci --prefix /x' } }];
    const { status, report, calls } = await hermetic({ stubs: { doctor: { status: 1, body: { ok: false, missing } } } });
    assert.equal(status, 2);
    assert.match(report.error.message, /needs node_modules/);
    assert.equal(report.error.hint, 'run npm ci --prefix /x');
    assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['doctor', false]]);
    assert.deepEqual(calls.map((c) => c.stage), ['doctor']);
  });

  test(`${cfg.skill}: a validate or build that crashes (exit 2) is exit 2 with error`, async () => {
    for (const stage of ['validate', 'build']) {
      const { status, report } = await hermetic({ stubs: { [stage]: { status: 2, body: { ok: false, errors: [{ path: '', message: `${stage} crashed. run the doctor` }] } } } });
      assert.equal(status, 2, stage);
      assert.deepEqual(report.error, { message: `${stage} crashed`, hint: 'run the doctor' });
      assert.equal(report.stages.at(-1).name, stage);
    }
  });

  test(`${cfg.skill}: --out, --theme, --model, --effort and --agent reach build and nothing else`, async () => {
    const { argvOf } = await hermetic({ args: ['--out', '/x/page', '--theme', 'ink', '--model', 'm1', '--effort', 'low', '--agent', 'a1'] });
    const flags = ['--out', '--theme', '--model', '--effort', '--agent'];
    for (const f of flags) assert.ok(argvOf('build').includes(f), `build gets ${f}`);
    for (const stage of ['doctor', 'validate', 'check']) for (const f of flags) assert.equal(argvOf(stage).includes(f), false, `${stage} does not get ${f}`);
    assert.equal(argvOf('build')[argvOf('build').indexOf('--model') + 1], 'm1');
    assert.ok(argvOf('validate').includes('--json') && argvOf('build').includes('--json'));
  });

  for (const extra of cfg.passThrough ?? []) {
    test(`${cfg.skill}: ${extra.args.join(' ')} reaches ${[extra.validate && 'validate', extra.build && 'build'].filter(Boolean).join(' and ')} only`, async () => {
      const { argvOf } = await hermetic({ args: extra.args });
      const has = (stage) => extra.args.every((a) => argvOf(stage).includes(a));
      assert.equal(has('validate'), Boolean(extra.validate), 'validate');
      assert.equal(has('build'), Boolean(extra.build), 'build');
      assert.equal(has('check'), false, 'check');
      assert.equal(has('doctor'), false, 'doctor');
    });
  }

  test(`${cfg.skill}: EVAL_LOG gets one make line per run`, async () => {
    const log = path.join(tmpDir(), 'eval.log');
    await hermetic({ env: { EVAL_LOG: log } });
    await hermetic({ env: { EVAL_LOG: log }, stubs: { validate: { status: 1, body: { ok: false, errors: [{ path: 'a', message: 'bad' }] } } } });
    const lines = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.command === 'make');
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((l) => [l.ok, l.mechanical, l.creative]), [[true, 0, 0], [false, 1, 0]]);
  });

  test(`${cfg.skill}: SIGINT during a stage is exit 130 with one JSON object, error interrupted, and the report keeps the stages so far`, async () => {
    const dir = tmpDir();
    const spec = path.join(dir, 'spec.json');
    fs.writeFileSync(spec, '{}');
    const marker = path.join(dir, 'build-started');
    const scripts = {
      doctor: stub(dir, 'doctor', { body: { ok: true, missing: [] } }),
      validate: stub(dir, 'validate'),
      build: stub(dir, 'build', { marker, sleep: true }),
    };
    const child = spawn(process.execPath, [make, spec, '--json'], { env: { ...process.env, PA_MAKE_TEST_SCRIPTS: JSON.stringify(scripts) }, cwd: cfg.skillDir, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => { stdout += d; });
    const closed = new Promise((resolve) => child.on('close', (code) => resolve(code)));
    const deadline = Date.now() + INTERRUPT_WAIT_MS;
    while (!fs.existsSync(marker) && Date.now() < deadline) await new Promise((r) => setTimeout(r, POLL_MS));
    assert.ok(fs.existsSync(marker), 'the build stage started');
    child.kill('SIGINT');
    assert.equal(await closed, 130);
    const report = oneObject(stdout);
    assert.deepEqual(report.error, { message: 'interrupted', hint: '' });
    assert.deepEqual(report.stages.map((s) => [s.name, s.ok]), [['doctor', true], ['validate', true], ['build', false]]);
    assert.equal(report.ok, false);
  });
}

/** True when a headless browser is live: a real check would refuse to start, so a test that needs one skips itself. */
export function browserBusy(liveBrowsers) {
  return liveBrowsers().length > 0 && process.env.ALLOW_BROWSER_RUN !== '1';
}
