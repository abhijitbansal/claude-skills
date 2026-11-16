// The move registry (engine/moves/index.mjs): the seven named moves, a look's entry for each (a Move, or null where the
// look does not use it), moveOf with did-you-mean, and --list moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registries, createRegistry } from '../../engine/registry.mjs';
import { MOVE_NAMES, moveOf } from '../../engine/moves/index.mjs';
import { validateLook } from '../../engine/looks/index.mjs';
import { listEntries, formatList } from '../../scripts/v2/list.mjs';

const MAKE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/make.mjs');
const make = (args) => spawnSync(process.execPath, [MAKE, ...args], { encoding: 'utf8' });
const SEVEN = ['rise', 'wipe', 'slam', 'pop', 'draw', 'count', 'settle'];

test('the seven moves are registered, each with a summary', () => {
  assert.deepEqual(MOVE_NAMES, SEVEN);
  assert.deepEqual(registries.moves.names(), SEVEN);
  for (const name of SEVEN) assert.ok(registries.moves.get(name).summary.length > 10, `${name} has a summary`);
});

test('desk and pop name a move for every registered move; the first five keep their values', () => {
  for (const look of ['desk', 'pop']) {
    const moves = registries.looks.get(look).moves;
    for (const name of SEVEN) assert.equal(typeof moves[name]?.ease, 'string', `${look}.${name}`);
  }
  assert.deepEqual(registries.looks.get('desk').moves.rise, registries.looks.get('desk').moves.enter, 'desk rise is its enter');
  assert.deepEqual(registries.looks.get('desk').moves.pop, registries.looks.get('desk').moves.enter, 'desk pop is its rise');
  assert.equal(registries.looks.get('desk').moves.slam.dur, 0, 'desk does not slam: a hard arrival');
  assert.deepEqual(registries.looks.get('pop').moves.pop, registries.looks.get('pop').moves.enter, 'pop pop is its enter');
});

const desk = () => registries.looks.get('desk');
const withMoves = (moves) => ({ ...desk(), name: 'moves-test', moves });

test('a look missing a registered move fails validateLook naming the look and the move', () => {
  const { settle, ...rest } = desk().moves;
  assert.ok(settle);
  assert.throws(() => validateLook(withMoves(rest)), /look "moves-test": moves\.settle must be a move \{ ease, dur \} or null/);
});

test('a move entry of null passes (the look does not use it); a malformed one fails', () => {
  assert.doesNotThrow(() => validateLook(withMoves({ ...desk().moves, slam: null })));
  assert.throws(() => validateLook(withMoves({ ...desk().moves, wipe: { dur: 0.2 } })), /moves\.wipe must be a move/);
  assert.throws(() => validateLook(withMoves({ ...desk().moves, wipe: { ease: 'linear', dur: -1 } })), /moves\.wipe must be a move/);
});

test('validateLook checks the moves of the registry it is given', () => {
  const moves = createRegistry('move');
  moves.add('glide', { summary: 'a test move that no look has' });
  assert.throws(() => validateLook(desk(), { moves }), /moves\.glide/);
});

test('moveOf returns the look entry, did-you-means an unknown name and refuses a null entry naming the look', () => {
  assert.deepEqual(moveOf(desk(), 'settle'), desk().moves.settle);
  assert.throws(() => moveOf(desk(), 'rse'), /unknown move "rse"; did you mean "rise"\?/);
  assert.throws(() => moveOf(withMoves({ ...desk().moves, wipe: null }), 'wipe'), /look "moves-test" does not use the move "wipe"/);
});

test('--list moves gives seven entries with each listed look values', () => {
  const entries = listEntries('moves');
  assert.deepEqual(entries.map((e) => e.name), SEVEN);
  for (const entry of entries) assert.deepEqual(Object.keys(entry.looks), registries.looks.names(), entry.name);
  assert.deepEqual(entries.find((e) => e.name === 'settle').looks.desk, desk().moves.settle);
  const text = formatList('moves', entries);
  assert.match(text, /^moves \(7\)/);
  assert.match(text, /^settle {2}/m);
  assert.match(text, /^ {2}desk: outCubic 0\.6 s/m);
});

test('make --list moves exits 0; --list movs exits 2 naming the accepted lists', () => {
  const ok = make(['--list', 'moves']);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^moves \(7\)/);
  const bad = make(['--list', 'movs']);
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /kinds, looks, modes, devices, moves, cuts, fields/);
});
