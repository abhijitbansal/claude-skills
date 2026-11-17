// PA-43: `npm test` runs the test files in parallel (CI pins that exact string and shards the files itself); a
// browser-heavy local run needs the one-browser-at-a-time script beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('test:serial runs every test file with concurrency 1, and test is the string CI pins', () => {
  assert.equal(pkg.scripts['test:serial'], 'node --test --test-concurrency=1 "test/**/*.test.mjs"');
  assert.equal(pkg.scripts.test, 'node --test "test/**/*.test.mjs"');
});
