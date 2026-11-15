import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, UsageError, exitUsage } from '../cli.mjs';

const USAGE = 'node scripts/x.mjs <file> [--facts <file>] [--json]';
const OPTIONS = { facts: { type: 'string' }, json: { type: 'boolean' }, out: { type: 'string' } };
const failure = (argv) => {
  try {
    parseCli(argv, OPTIONS, USAGE);
  } catch (e) {
    assert.ok(e instanceof UsageError);
    return e.message;
  }
  throw new Error('parseCli did not throw');
};

test('an unknown flag close to a real one suggests it and keeps the usage line', () => {
  assert.equal(failure(['--fact', 'f.json']), `Unknown option '--fact'; did you mean '--facts'; usage: ${USAGE}`);
  assert.match(failure(['--jsno']), /^Unknown option '--jsno'; did you mean '--json'; usage: /);
});

test('an unknown flag with no close match is reported as before, with no suggestion', () => {
  assert.equal(failure(['--bogus']), `Unknown option '--bogus'; usage: ${USAGE}`);
});

test('the suggestion is for long flags; a stray short flag has none', () => {
  assert.equal(failure(['-q']), `Unknown option '-q'; usage: ${USAGE}`);
});

test('other parse problems keep their one-line message', () => {
  assert.match(failure(['--out']), /^Option '--out <value>' argument missing; usage: /);
});

// Run exitUsage with stdout/stderr captured and exitCode restored.
function captureExit(error, opts) {
  let out = '';
  let err = '';
  const w = process.stdout.write.bind(process.stdout);
  const e = process.stderr.write.bind(process.stderr);
  const prev = process.exitCode;
  process.exitCode = undefined;
  process.stdout.write = (s) => { out += s; return true; };
  process.stderr.write = (s) => { err += s; return true; };
  try { exitUsage(error, opts); } finally { process.stdout.write = w; process.stderr.write = e; }
  const code = process.exitCode ?? 0;
  process.exitCode = prev;
  return { out, err, code };
}

test('--help and -h are not errors: parseCli throws a help request carrying the usage line', () => {
  for (const flag of ['--help', '-h']) {
    let caught;
    try {
      parseCli(['a.json', flag], OPTIONS, USAGE);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof UsageError, flag);
    assert.equal(caught.help, true, flag);
    assert.equal(caught.message, USAGE, flag);
  }
});

test('exitUsage turns a help request into usage on stdout and exit 0; a real error stays exit 2 on stderr', () => {
  let help;
  try { parseCli(['--help'], OPTIONS, USAGE); } catch (e) { help = e; }
  assert.deepEqual(captureExit(help), { out: `usage: ${USAGE}\n`, err: '', code: 0 });
  assert.deepEqual(JSON.parse(captureExit(help, { json: true }).out), { ok: true, usage: USAGE });
  assert.equal(captureExit(help, { json: true }).code, 0);
  assert.deepEqual(captureExit(new UsageError('bad flag')), { out: '', err: 'bad flag\n', code: 2 });
});

test('a script that declares its own help option keeps it', () => {
  const { values } = parseCli(['--help'], { help: { type: 'boolean' } }, USAGE);
  assert.equal(values.help, true);
});

test('good arguments parse', () => {
  const { values, positionals } = parseCli(['a.json', '--facts', 'f.json'], OPTIONS, USAGE);
  assert.deepEqual({ ...values }, { facts: 'f.json' });
  assert.deepEqual(positionals, ['a.json']);
});
