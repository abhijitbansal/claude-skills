import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import lucide from '../template/sketch/lucide.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'scripts/sketch-icons.mjs');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const USAGE = 'node scripts/sketch-icons.mjs search <word> | list';

test('search server finds server, exact match first', () => {
  const r = run('search', 'server');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines[0], 'server');
  assert.ok(lines.includes('server-cog'), r.stdout);
  assert.ok(lines.every((name) => name.includes('server')), r.stdout);
});

test('search is case-insensitive and says so when nothing matches, with the closest name', () => {
  assert.equal(run('search', 'SERVER').stdout.split('\n')[0], 'server');
  const none = run('search', 'sever');
  assert.equal(none.status, 0, none.stderr);
  assert.match(none.stdout, /no icon name contains "sever"; did you mean "server"\?/);
});

test('search caps a long answer and says how many it left out', () => {
  const r = run('search', 'a');
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 51);
  assert.match(lines.at(-1), /^\.\.\. \d+ more; narrow the search$/);
});

test('list prints every icon name, one per line', () => {
  const r = run('list');
  assert.equal(r.status, 0, r.stderr);
  const names = r.stdout.trim().split('\n');
  assert.deepEqual(names, Object.keys(lucide).sort());
  assert.ok(names.length > 1000, `${names.length} icons`);
});

test('unknown flag exits 2 listing accepted ones', () => {
  const r = run('search', 'server', '--bogus');
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.includes("Unknown option '--bogus'"), r.stderr);
  assert.ok(r.stderr.includes(`usage: ${USAGE}`), r.stderr);
});

test('a missing or unknown command, an extra argument and a missing word exit 2 with the usage', () => {
  for (const [args, want] of [
    [[], 'no command'],
    [['serch', 'x'], 'unknown command "serch"; did you mean "search"?'],
    [['list', 'x'], 'list takes no arguments'],
    [['search'], 'search takes one word'],
    [['search', 'a', 'b'], 'search takes one word'],
  ]) {
    const r = run(...args);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(want) && r.stderr.includes(USAGE), `${args.join(' ')}: ${r.stderr}`);
  }
});

test('the vendored set is polylines in the 24-unit box', () => {
  const server = lucide.server;
  assert.ok(Array.isArray(server) && server.length >= 4, 'a server is two boxes and two dots');
  for (const [name, lines] of Object.entries(lucide)) {
    for (const line of lines) {
      assert.ok(line.length >= 2, `${name} has a one-point line`);
      for (const [x, y] of line) assert.ok(x >= -0.5 && x <= 24.5 && y >= -0.5 && y <= 24.5, `${name}: ${x},${y}`);
    }
  }
});
