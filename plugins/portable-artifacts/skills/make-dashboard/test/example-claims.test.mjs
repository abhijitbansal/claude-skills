// The shipped example reads as a newsroom page: chart titles are claims a reader can check, not implementation notes,
// and no series is plotted twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'references/examples/sales-overview.json'), 'utf8'));
// The value field a chart plots: a kind chart's y, else a raw chart's y encoding (top level or its first layer).
const yOf = (c) => c.y ?? c.vegaLite?.encoding?.y?.field ?? c.vegaLite?.layer?.[0]?.encoding?.y?.field;

test('no example chart title carries implementation words', () => {
  const jargon = spec.charts.filter((c) => /vega|raw|\(with /i.test(c.title)).map((c) => c.title);
  assert.deepEqual(jargon, []);
});

test('no two example charts plot the same series', () => {
  const seen = new Map();
  const twice = [];
  for (const c of spec.charts) {
    const key = `${c.query}:${yOf(c)}:${c.color ?? ''}`;
    if (seen.has(key)) twice.push(`${seen.get(key)} and ${c.id} both plot ${key}`);
    seen.set(key, c.id);
  }
  assert.deepEqual(twice, []);
});
