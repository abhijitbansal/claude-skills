import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPES, KINDS } from '../scripts/lib/kinds.mjs';
import { DEFAULT_ICON } from '../scripts/lib/icons.mjs';

test('TYPES is the closed set of diagram types', () => {
  assert.deepEqual(TYPES, ['architecture', 'flow', 'sequence', 'state']);
  assert.deepEqual(Object.keys(KINDS).sort(), [...TYPES].sort());
});

test('each type lists its default first and the spec kinds exactly', () => {
  const kinds = (t) => Object.keys(KINDS[t].kinds);
  assert.deepEqual(kinds('architecture'),
    ['service', 'client', 'user', 'database', 'storage', 'queue', 'cache', 'function', 'gateway', 'external', 'other']);
  assert.deepEqual(kinds('flow'), ['step', 'start', 'end', 'decision', 'io', 'subprocess', 'wait']);
  assert.deepEqual(kinds('state'), ['state', 'start', 'end', 'choice']);
  assert.deepEqual(kinds('sequence'), ['service', 'actor', 'database', 'queue', 'external']);
  for (const t of TYPES) assert.equal(KINDS[t].default, kinds(t)[0], `${t} default`);
});

test('every kind has a shape', () => {
  for (const t of TYPES) {
    for (const [kind, def] of Object.entries(KINDS[t].kinds)) {
      assert.equal(typeof def.shape, 'string', `${t}.${kind}`);
      assert.ok(def.shape.length > 0, `${t}.${kind}`);
    }
  }
});

test('KINDS and DEFAULT_ICON cover exactly the same kind names', () => {
  const fromKinds = new Set(TYPES.flatMap((t) => Object.keys(KINDS[t].kinds)));
  assert.deepEqual([...fromKinds].sort(), Object.keys(DEFAULT_ICON).sort());
});

test('each kind icon is the DEFAULT_ICON entry', () => {
  for (const t of TYPES) {
    for (const [kind, def] of Object.entries(KINDS[t].kinds)) {
      assert.equal(def.icon, DEFAULT_ICON[kind], `${t}.${kind}`);
    }
  }
});
