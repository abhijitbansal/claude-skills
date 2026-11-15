import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry, registries } from '../../engine/registry.mjs';

test('get of an unknown name lists what exists', () => {
  const r = createRegistry('look'); r.add('desk', {}); r.add('pop', {});
  assert.throws(() => r.get('dsk'), /unknown look "dsk"; did you mean "desk"\? \(have: desk, pop\)/);
  assert.throws(() => r.add('desk', {}), /already registered/);
});

test('get omits the suggestion when nothing is close', () => {
  const r = createRegistry('look'); r.add('desk', {});
  assert.throws(() => r.get('zzzzzzzz'), { message: 'unknown look "zzzzzzzz" (have: desk)' });
});

test('get on an empty registry says nothing is registered', () => {
  const r = createRegistry('cut');
  assert.throws(() => r.get('wipe'), /unknown cut "wipe" \(have: \)/);
});

test('add, get, has and names round-trip in insertion order', () => {
  const r = createRegistry('move'); const def = { run() {} };
  r.add('b', def); r.add('a', {});
  assert.equal(r.get('b'), def);
  assert.equal(r.has('a'), true);
  assert.equal(r.has('c'), false);
  assert.deepEqual(r.names(), ['b', 'a']);
});

test('names returns a copy that cannot mutate the registry', () => {
  const r = createRegistry('field'); r.add('x', {});
  r.names().push('hacked');
  assert.deepEqual(r.names(), ['x']);
});

test('prototype keys are not names', () => {
  const r = createRegistry('kind');
  assert.equal(r.has('constructor'), false);
  assert.equal(r.has('__proto__'), false);
  assert.throws(() => r.get('toString'), /unknown kind "toString"/);
});

test('add rejects an empty or non-string name', () => {
  const r = createRegistry('kind');
  assert.throws(() => r.add('', {}), /name must be a non-empty string/);
  assert.throws(() => r.add(7, {}), /name must be a non-empty string/);
});

test('registries holds one registry per extension point, each labelled', () => {
  assert.deepEqual(Object.keys(registries), ['kinds', 'looks', 'modes', 'devices', 'moves', 'cuts', 'fields']);
  assert.throws(() => registries.looks.get('nope'), /unknown look "nope"/);
  assert.throws(() => registries.kinds.get('nope'), /unknown kind "nope"/);
  assert.throws(() => registries.devices.get('nope'), /unknown device "nope"/);
  assert.notEqual(registries.looks, registries.moves);
});
