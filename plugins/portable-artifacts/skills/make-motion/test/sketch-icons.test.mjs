import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import lucide from '../template/sketch/lucide.mjs';
import { ICON_ALIASES, suggestIcon } from '../scripts/lib/icon-names.mjs';

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

test('an empty or blank word is a usage error, not a list of every icon', () => {
  for (const word of ['', '  ']) {
    const r = run('search', word);
    assert.equal(r.status, 2, JSON.stringify(word));
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes('search takes a word that is not empty') && r.stderr.includes(USAGE), r.stderr);
  }
});

test('search puts the new name of an old one first: home finds house, not dome', () => {
  const home = run('search', 'home');
  assert.equal(home.status, 0, home.stderr);
  assert.equal(home.stdout.split('\n')[0], 'house');
  assert.ok(!home.stdout.includes('dome'), home.stdout);
  assert.equal(run('search', 'Edit').stdout.split('\n')[0], 'pencil');
});

test('every alias points at an icon that exists, and no alias is itself an icon name', () => {
  for (const [from, to] of Object.entries(ICON_ALIASES)) {
    assert.ok(Object.hasOwn(lucide, to), `${from} -> ${to}: no such icon`);
    assert.ok(!Object.hasOwn(lucide, from), `${from} is an icon; it needs no alias`);
  }
  for (const [from, to] of [['home', 'house'], ['edit', 'pencil'], ['check-circle', 'circle-check'], ['bar-chart', 'chart-column'], ['x-circle', 'circle-x']]) assert.equal(suggestIcon(from), to);
  assert.equal(suggestIcon('sever'), 'server');
});

// The page runs template/ for every spec, standard ones too: the whole Lucide set (about 1 MB) is loaded there by a dynamic
// import() only, when a spec has a sketch scene. A static import, a re-export or a side-effect import loads it always.
const STATIC_LUCIDE = /(?:^|\n)\s*(?:import\b[^;'"]*?(?:from\s*)?|export\b[^;'"]*?from\s*)['"][^'"]*lucide\.mjs['"]/;
const hasStaticLucideImport = (source) => STATIC_LUCIDE.test(source);

function templateFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return templateFiles(file);
    return entry.name.endsWith('.mjs') ? [file] : [];
  });
}

test('guardrail proof: the scan catches a static, a multi-line, a side-effect and a re-export import, and lets a dynamic one through', () => {
  assert.ok(hasStaticLucideImport("import lucide from './lucide.mjs';"));
  assert.ok(hasStaticLucideImport("import { a,\n  b } from '../sketch/lucide.mjs'"));
  assert.ok(hasStaticLucideImport("import './lucide.mjs';"));
  assert.ok(hasStaticLucideImport("// x\nexport { default } from './lucide.mjs';"));
  assert.ok(!hasStaticLucideImport("const lucide = (await import('./lucide.mjs')).default;"));
  assert.ok(!hasStaticLucideImport("const load = () => import('../template/sketch/lucide.mjs');"));
  assert.ok(!hasStaticLucideImport("import caveat from './caveat-metrics.mjs';"));
});

test('nothing under template/ imports lucide.mjs statically', () => {
  const files = templateFiles(path.join(root, 'template'));
  assert.ok(files.length > 30, `${files.length} template files scanned`);
  const offenders = files.filter((file) => hasStaticLucideImport(readFileSync(file, 'utf8'))).map((file) => path.relative(root, file));
  assert.deepEqual(offenders, []);
});

test('the dots of a divide sign survive flattening: a zero-length line is a short polyline, not dropped', () => {
  for (const name of ['circle-divide', 'square-divide']) {
    assert.equal(lucide[name].length, 4, `${name}: outline, bar and two dots`);
    const dots = lucide[name].filter((line) => line.length === 2 && Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) < 0.05);
    assert.deepEqual(dots.map((line) => line[0]).sort((a, b) => a[1] - b[1]), [[12, 8], [12, 16]], name);
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
