// Names every JS object inherits (constructor, __proto__, toString, hasOwnProperty) as keys and as lookup values of a film.
// A validator that looks a name up with `in` or a bare `obj[name]` accepts them as a real look, mode or kind, or crashes on
// them. Each hostile film must come back ok:false with an error, and never throw. This is version 1's validate-fuzz guarantee
// (eval/test/validate-fuzz.test.mjs held a make-motion case through version 1's validate.mjs), carried to the film validator
// when version 1 was deleted at cut-over. The proof at the bottom feeds the same walker a scratch validator that uses `in`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import '../../scripts/v2/list.mjs'; // registers the kinds, looks, modes and cuts, as make.mjs does
import { registries } from '../../engine/registry.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';

const EXAMPLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../references/examples/v2');
const HOSTILE_KEYS = ['constructor', '__proto__', 'toString'];
const HOSTILE_VALUES = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];

const clone = (o) => JSON.parse(JSON.stringify(o));
// `__proto__` written as an assignment sets the prototype and never reaches a validator; defineProperty makes it a real own
// key, which is what JSON.parse gives a validator reading a hostile file.
const withOwnKey = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
const at = (root, p) => p.reduce((o, k) => o?.[k], root);

/** The hostile variants of `base`: { label, film }. `lookups` are paths to a string looked up in a registry or a closed set; `nested` are paths to an object with a closed key set. */
export function hostileFilms(base, { lookups, nested }) {
  const out = [];
  for (const key of HOSTILE_KEYS) {
    for (const p of [[], ...nested]) {
      const film = clone(base);
      const target = at(film, p);
      assert.ok(target && typeof target === 'object', `base has no object at ${p.join('.') || 'the root'}`);
      withOwnKey(target, key, { x: 1 });
      out.push({ label: `${p.join('.') || 'root'} key ${key}`, film });
    }
  }
  for (const value of HOSTILE_VALUES) {
    for (const p of lookups) {
      const film = clone(base);
      const parent = at(film, p.slice(0, -1));
      assert.ok(parent && typeof parent === 'object', `base has no object at ${p.slice(0, -1).join('.')}`);
      parent[p.at(-1)] = value;
      out.push({ label: `${p.join('.')} = ${value}`, film });
    }
  }
  return out;
}

/** What went wrong across the variants (empty: every one was rejected cleanly). `validate(film) -> { ok, errors }`. */
export function fuzz(base, spec, validate) {
  const problems = [];
  for (const { label, film } of hostileFilms(base, spec)) {
    let result;
    try { result = validate(film); } catch (err) { problems.push(`${label}: threw ${err?.message}`); continue; }
    if (result.ok !== false) problems.push(`${label}: accepted`);
    else if (!Array.isArray(result.errors) || result.errors.length === 0) problems.push(`${label}: rejected with no error`);
  }
  return problems;
}

const validate = (film) => validateFilm(film, { specDir: EXAMPLES, registries });
const desk = JSON.parse(readFileSync(path.join(EXAMPLES, 'gate-desk.json'), 'utf8'));
const SPEC = { lookups: [['look'], ['mode'], ['format'], ['shots', 0, 'show']], nested: [['shots', 0]] };

test('the example film this test fuzzes is valid, so every rejection below is the hostile name\'s doing', () => {
  assert.equal(validate(clone(desk)).ok, true);
});

test('a hostile key at the root or on a shot, and a hostile look, mode, format or kind name, is rejected with an error and never throws', () => {
  assert.deepEqual(fuzz(desk, SPEC, validate), []);
});

test('guardrail proof: a scratch validator that looks a look up with `in` is caught accepting constructor, and one that throws is caught', () => {
  const LOOKS = { desk: 1, pop: 1 };
  const loose = (film) => ({ ok: film.look === undefined || film.look in LOOKS, errors: [{ path: 'look', message: 'unknown look' }] });
  const caught = fuzz({ look: 'desk', shots: [{ id: 'a' }] }, { lookups: [['look']], nested: [['shots', 0]] }, loose);
  assert.ok(caught.includes('look = constructor: accepted'), caught.join('\n'));
  assert.ok(caught.includes('root key constructor: accepted'), 'an unknown root key is not rejected either');
  const crashing = fuzz({ look: 'desk', shots: [{ id: 'a' }] }, { lookups: [['look']], nested: [] }, () => { throw new TypeError('boom'); });
  assert.ok(crashing.every((p) => p.includes('threw boom')) && crashing.length > 0, crashing.join('\n'));
});
