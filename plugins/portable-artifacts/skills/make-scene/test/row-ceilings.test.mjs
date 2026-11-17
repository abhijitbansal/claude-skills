// The per-world row ceilings that references/schema.md prints are measured, not remembered: this rebuilds the rows
// the table describes and checks each claim against the same size validate.mjs compares with the page cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { heaviestPage } from '../scripts/lib/page-size.mjs';
import { MAX_PAGE_BYTES } from '../scripts/lib/bundle.mjs';

const SCHEMA = fs.readFileSync(new URL('../references/schema.md', import.meta.url), 'utf8');
const GROUPS = 24;
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ group: `g${i % GROUPS}`, t: `w${String(Math.floor(i / GROUPS)).padStart(4, '0')}`, value: (i * 7) % 50 }));
const fits = async (world, n) => (await heaviestPage({ title: 'T', world, data: { rows: rowsOf(n) } }, { dir: process.cwd() })).bytes <= MAX_PAGE_BYTES;

test('schema.md prints the measured ceilings: forest about 1,250 (1,248 with 24 groups), the others all 2000', () => {
  assert.match(SCHEMA, /### Row ceilings by world/);
  assert.match(SCHEMA, /\| forest \| about 1,250 \|.*1,248 rows \(24 groups\)/);
  for (const world of ['city', 'galaxy', 'terrain']) assert.match(SCHEMA, new RegExp(`\\| ${world} \\| 2000 \\|`));
});

test('forest: 1,248 rows in 24 groups fit the page cap and 1,344 do not', async () => {
  assert.equal(await fits('forest', 1248), true);
  assert.equal(await fits('forest', 1344), false);
});

for (const world of ['city', 'galaxy', 'terrain']) {
  test(`${world}: all 2000 rows in 24 groups fit the page cap`, async () => {
    assert.equal(await fits(world, 2000), true);
  });
}
