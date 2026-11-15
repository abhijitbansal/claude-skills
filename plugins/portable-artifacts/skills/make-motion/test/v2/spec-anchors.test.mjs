// Sync (design 8.5): every anchor resolves inside its shot. One that lands outside is a validation error at its path,
// never a silent clamp; an offset that lands outside by less than one frame (rounding) is clamped. Stub registries, as
// in spec.test.mjs (which is near its size limit).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRegistry } from '../../engine/registry.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';

function stubRegistries() {
  const r = { kinds: createRegistry('kind'), looks: createRegistry('look'), modes: createRegistry('mode'), devices: createRegistry('device') };
  r.kinds.add('statement', { schema: { properties: { text: { type: 'string' } } }, targets: () => ['text'] });
  r.looks.add('desk', { name: 'desk', modes: ['pro'], cuts: ['cut'] });
  r.modes.add('pro', { name: 'pro', defaultLook: 'desk', defaultFormat: '16:9', wpm: 150, tail: 0.6 });
  r.devices.add('circle', { supports: () => true });
  return r;
}

let specDir;
before(() => { specDir = mkdtempSync(path.join(tmpdir(), 'mm-v2-spec-anchors-')); });
after(() => rmSync(specDir, { recursive: true, force: true }));

const check = (shot) => validateFilm({ version: 2, shots: [shot] }, { specDir, registries: stubRegistries() });
const held = (at) => ({ id: 'a', show: 'statement', text: 'One file here', hold: 3, on: [{ at, do: 'circle', target: 'text' }] });
const spoken = (at) => ({ id: 'a', show: 'statement', say: 'One file here.', on: [{ at, do: 'circle', target: 'text' }] });

test('an anchor past the end of its shot is an error at its path that names both times', () => {
  const r = check(held(45));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].on[0].at']);
  assert.match(r.errors[0].message, /45 s/);
  assert.match(r.errors[0].message, /0 to 3 s/);
});

test('a word anchor pushed past the end by its offset is an error too', () => {
  const r = check(spoken('word:file+30'));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].on[0].at']);
  assert.match(r.errors[0].message, /outside the shot/);
});

test('an anchor before the start of its shot is an error', () => {
  const r = check(held('start-1'));
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].on[0].at']);
  assert.match(r.errors[0].message, /-1 s/);
});

test('M13: a hold under the 1 s every shot lasts at least is refused, not silently lengthened', () => {
  const r = check({ id: 'a', show: 'statement', text: 'Hi', hold: 0.5 });
  assert.deepEqual(r.errors.map((e) => e.path), ['shots[0].hold']);
  assert.match(r.errors[0].message, />= 1/);
  assert.deepEqual(check({ id: 'a', show: 'statement', text: 'Hi', hold: 1 }), { ok: true, errors: [] });
});

test('within one frame of either end is rounding: clamped, not an error', () => {
  for (const at of ['end+0.02', 'start-0.02', 'end', 'start', 3]) assert.deepEqual(check(held(at)), { ok: true, errors: [] }, String(at));
  assert.equal(check(held('end+0.05')).ok, false, 'two frames past the end at 30 fps');
});
