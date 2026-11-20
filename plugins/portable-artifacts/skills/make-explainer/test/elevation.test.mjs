// The shared elevation scale (--elev-1..3, shared/theme.mjs) on the explainer's blocks: classic themes lift their
// cards with --elev-1, the flavored print looks stay flat, and print drops every shadow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8');
const BLOCKS = ['.tldr', '.kpi', '.card', '.files', '.cmp-col', '.det', '.sec-alt'];
// The declaration block of the first top-level rule whose selector is exactly `sel` (no @media wrapper).
const topRule = (css, sel) => new RegExp(`(?:^|\\n)${sel.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';

test('classic blocks lift with the shared --elev-1, not an ad-hoc shadow', () => {
  const base = read('base.css');
  for (const sel of BLOCKS) assert.match(topRule(base, sel), /box-shadow: var\(--elev-1\)/, sel);
});

test('print drops the shadow on every lifted block', () => {
  const print = read('base.css').split('@media print {')[1] ?? '';
  const line = print.split('\n').find((l) => /box-shadow: none/.test(l)) ?? '';
  for (const sel of BLOCKS) assert.ok(line.includes(sel), `${sel} keeps its shadow in print`);
});

test('the flavored print looks keep their blocks flat (no soft classic elevation)', () => {
  const rule = /html\[data-flavor\] :is\(([^)]*)\) \{ box-shadow: none; \}/.exec(read('flavors.css'));
  assert.ok(rule, 'flavors.css resets the classic elevation');
  const selectors = rule[1].split(',').map((s) => s.trim());
  for (const sel of BLOCKS) assert.ok(selectors.includes(sel), `${sel} under a flavor`);
});
