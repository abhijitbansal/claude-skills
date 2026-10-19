import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costTable } from '../scripts/lib/cost.mjs';

const SKILL = '/abs/skills/make-scene';
const alt = (world, extra = {}) => ({ world, eligible: true, needs: undefined, estBytes: 600000, weight: 'light', ...extra });
const table = (over = {}) =>
  costTable({
    specText: 'x'.repeat(401),
    current: 'city',
    pageBytes: 612345,
    skillDir: SKILL,
    specPath: 'scene.json',
    alternatives: [alt('city'), alt('forest'), alt('galaxy'), alt('terrain', { eligible: false, needs: 'terrain needs t on every row', estBytes: 0 })],
    ...over,
  });
const lineOf = (t, world) => t.split('\n').find((l) => l.startsWith(world) || l.includes(`| ${world} `) || l.trimStart().startsWith(world));

test('cost table switch tokens are zero', () => {
  const t = table();
  for (const w of ['forest', 'galaxy']) {
    const cells = lineOf(t, w).split('|').map((c) => c.trim());
    assert.equal(cells[2], '0');
  }
});

test('cost table estimates authoring tokens as ceil(chars/4) and says estimated', () => {
  assert.match(table().split('\n')[0], /^spec authoring ≈ 101 tokens \(estimated\)$/);
  assert.match(table({ specText: 'x'.repeat(400) }).split('\n')[0], /≈ 100 tokens/);
});

test('ineligible rows have no command', () => {
  const line = lineOf(table(), 'terrain');
  assert.match(line, /not available: needs t on every row/);
  assert.doesNotMatch(line, /build\.mjs/);
});

test('command text is node <skill-dir>/scripts/build.mjs <spec> --world <w>', () => {
  const line = lineOf(table(), 'forest');
  assert.ok(line.includes(`node ${SKILL}/scripts/build.mjs scene.json --world forest`));
});

test('flags the build was given are repeated, quoted, after --world', () => {
  const t = table({ flags: { out: '/tmp/my pages', theme: 'press', allowOutside: true } });
  assert.ok(lineOf(t, 'forest').includes(`scene.json --world forest --out '/tmp/my pages' --theme press --allow-outside`));
  assert.ok(lineOf(table(), 'forest').trimEnd().endsWith('--world forest'));
});

test('the current world is marked and has no switch command', () => {
  const line = lineOf(table(), 'city');
  assert.match(line, /current/);
  assert.doesNotMatch(line, /build\.mjs/);
  assert.match(line, /598\.0 KB/); // measured pageBytes, not the estimate
});

test('alternative page sizes are marked approximate', () => {
  assert.match(lineOf(table(), 'forest'), /~585\.9 KB/);
});

test('heavy rows add the phone warning, light rows do not', () => {
  const t = table({ alternatives: [alt('city'), alt('forest', { weight: 'heavy' }), alt('galaxy', { weight: 'medium' })] });
  assert.match(lineOf(t, 'forest'), /heavy.*may be slow on phones/);
  assert.doesNotMatch(lineOf(t, 'galaxy'), /slow on phones/);
});

test('a spec path with spaces is shell-quoted', () => {
  const t = table({ specPath: 'my scenes/a.json' });
  assert.ok(lineOf(t, 'forest').includes("build.mjs 'my scenes/a.json' --world forest"));
});

test('header columns are named', () => {
  const header = table().split('\n')[1];
  assert.equal(header.split('|').map((c) => c.trim()).join('|'), 'world|fit|switch tokens|page size|render|command');
});

test('a skill dir with a space is quoted as part of the script path', () => {
  const t = table({ skillDir: '/Users/Jane Doe/skills/make-scene' });
  assert.ok(lineOf(t, 'forest').includes("node '/Users/Jane Doe/skills/make-scene/scripts/build.mjs' scene.json --world forest"));
});

test('arguments starting with a dash are quoted', () => {
  const t = table({ specPath: '-x.json' });
  assert.ok(lineOf(t, 'forest').includes("build.mjs '-x.json' --world forest"));
});
