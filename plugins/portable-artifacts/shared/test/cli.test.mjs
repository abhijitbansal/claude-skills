import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCli, UsageError } from '../cli.mjs';

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

test('good arguments parse', () => {
  const { values, positionals } = parseCli(['a.json', '--facts', 'f.json'], OPTIONS, USAGE);
  assert.deepEqual({ ...values }, { facts: 'f.json' });
  assert.deepEqual(positionals, ['a.json']);
});
