// The look contract (helpers/look-contract.mjs) proven on a synthetic look registered only here: desk's data under
// another name with experimental: true passes every check, and each of three broken copies fails the check that should
// catch it. It is not run against cosmos, whose sun.base and sun.color repeat its accent hex (docs/decisions-pending.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { contractChecks, lookContract } from './helpers/look-contract.mjs';

const NAME = 'contract-desk';
const ACCENT_COPY = 'contract-desk-accent';
const desk = registries.looks.get('desk');
const freezeTop = (look) => Object.freeze(look);
if (!registries.looks.has(NAME)) registries.looks.add(NAME, freezeTop({ ...desk, name: NAME, experimental: true }));

const OPTS = Object.freeze({
  modes: ['pro'],
  grounds: [desk.palette.paper],
  pairs: [['ink', 'paper', 4.5], ['ink2', 'paper', 4.5]],
  banned: [['rule', 'paper']],
  secondaryMin: 0,
  kinds: Object.keys(desk.kinds),
  parked: {},
});

const check = (key, name = NAME, opts = OPTS, env) => contractChecks(name, opts, env).find((c) => c.key === key);

lookContract(NAME, OPTS);

test('the contract fails on (e) for a copy with one sound removed', () => {
  const { slide, ...cut } = desk.sounds.cut;
  assert.ok(slide !== undefined || 'slide' in desk.sounds.cut, 'desk names a sound for slide');
  const broken = Object.freeze({ ...desk, name: 'contract-no-slide', experimental: true, sounds: Object.freeze({ ...desk.sounds, cut: Object.freeze(cut) }) });
  // validateLook refuses it, so it cannot be registered: the check reads it from a stub registry
  assert.throws(() => registries.looks.add('contract-no-slide', broken), /sounds\.cut\.slide/);
  const stub = { get: () => broken, has: () => true };
  assert.throws(() => check('e', 'contract-no-slide', OPTS, { looks: stub }).run(), /sounds\.cut/);
});

test('the contract fails on (i) for a copy that repeats the accent hex under a key applyAccent does not move', () => {
  const card = Object.freeze({ ...desk.devices.card, shadow: desk.palette.accent });
  if (!registries.looks.has(ACCENT_COPY)) {
    registries.looks.add(ACCENT_COPY, freezeTop({ ...desk, name: ACCENT_COPY, experimental: true, devices: Object.freeze({ ...desk.devices, card }) }));
  }
  assert.doesNotThrow(() => check('i').run(), 'the plain copy passes (i)');
  assert.throws(() => check('i', ACCENT_COPY).run(), /look\.devices\.card\.shadow/);
});

test('the contract fails on (b) for an experimental look claimed as listed', () => {
  assert.throws(() => check('b', NAME, { ...OPTS, listed: true }).run(), /lists it/);
});

test('the contract fails on (g) when a banned pair clears 3:1', () => {
  assert.throws(() => check('g', NAME, { ...OPTS, banned: [['ink', 'paper']] }).run(), /decorative/);
});
