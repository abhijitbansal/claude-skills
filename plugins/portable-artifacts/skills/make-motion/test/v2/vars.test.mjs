// Root `vars` and substitute() (scripts/v2/vars.mjs): {{name}} in any string value becomes the value, "{{n}}" alone a
// number, {{{{ a literal {{; values are plain text in narration; keys and file paths take no var. No browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSay } from '../../engine/script/say.mjs';
import { substitute, varsErrors, defaultValues, VARS_MAX } from '../../scripts/v2/vars.mjs';
import { SpecError } from '../../scripts/v2/spec-common.mjs';

const VARS = { name: { type: 'string', default: 'Ada' }, count: { type: 'number', default: 3 } };
const film = (shots, extra = {}) => ({ version: 2, vars: VARS, shots, ...extra });
const errorsOf = (fn) => {
  try {
    fn();
  } catch (err) {
    if (err instanceof SpecError) return err.errors;
    throw err;
  }
  return [];
};

test('{{name}} in a string becomes the value; no values means the defaults', () => {
  const out = substitute(film([{ id: 'a', show: 'statement', say: 'Hello, {{name}}.' }]), {});
  assert.equal(out.shots[0].say, 'Hello, Ada.');
  assert.equal(substitute(film([{ id: 'a', show: 'statement', say: 'Hi {{name}}' }]), { name: 'Grace' }).shots[0].say, 'Hi Grace');
});

test('a string that is exactly "{{n}}" for a number var becomes the number; inside a sentence it is its text', () => {
  const out = substitute(film([{ id: 'a', show: 'number', value: '{{count}}', label: '{{count}} rows', hold: 2 }]), { count: 459 });
  assert.equal(out.shots[0].value, 459);
  assert.equal(out.shots[0].label, '459 rows');
});

test('{{{{ is a literal {{', () => {
  assert.equal(substitute(film([{ id: 'a', show: 'statement', say: 'Braces {{{{ stay' }]), {}).shots[0].say, 'Braces {{ stay');
});

test('a value in a say is plain text: its markup is escaped, so its tokens equal the same sentence typed plainly', () => {
  const said = substitute(film([{ id: 'a', show: 'statement', say: 'Hello {{name}} today' }]), { name: '*Ada*_x_' }).shots[0].say;
  const plain = parseSay('Hello \\*Ada\\*\\_x\\_ today').tokens.map((t) => [t.text, t.emphasis, t.aside]);
  assert.deepEqual(parseSay(said).tokens.map((t) => [t.text, t.emphasis, t.aside]), plain);
  assert.ok(parseSay(said).tokens.every((t) => !t.emphasis && !t.aside));
});

test('a value that would add a pause or a pronunciation hint to a say is refused at its path', () => {
  for (const value of ['wait... now', 'a (0.4) b', '[x](/ks/)']) {
    const errors = errorsOf(() => substitute(film([{ id: 'a', show: 'statement', say: 'Hi {{name}}' }]), { name: value }));
    assert.equal(errors[0]?.path, 'shots[0].say', value);
    assert.match(errors[0].message, /"name"/);
  }
});

test('an unknown var is refused at its path with a did-you-mean', () => {
  const errors = errorsOf(() => substitute(film([{ id: 'a', show: 'statement', say: 'x' }, { id: 'b', show: 'statement', say: 'Hi {{nme}}' }]), {}));
  assert.deepEqual(errors, [{ path: 'shots[1].say', message: 'unknown var "nme"; did you mean "name"?' }]);
});

test('a var in a src (or another file path) is refused', () => {
  const errors = errorsOf(() => substitute(film([{ id: 'a', show: 'clipping', src: 'shots/{{name}}.png' }]), {}));
  assert.equal(errors[0].path, 'shots[0].src');
  assert.match(errors[0].message, /file path/);
  assert.equal(errorsOf(() => substitute(film([{ id: 'a', show: 'statement', say: 'x' }], { music: { src: '{{name}}.mp3' } }), {}))[0].path, 'music.src');
});

test('keys are never substituted', () => {
  const out = substitute(film([{ id: 'a', show: 'statement', say: 'x', regions: { '{{name}}': [0, 0, 1, 1] } }]), {});
  assert.deepEqual(Object.keys(out.shots[0].regions), ['{{name}}']);
});

test('a value of the wrong type is refused', () => {
  assert.match(errorsOf(() => substitute(film([{ id: 'a', show: 'statement', say: 'x' }]), { count: 'many' }))[0].message, /count.*number/);
  assert.match(errorsOf(() => substitute(film([{ id: 'a', show: 'statement', say: 'x' }]), { name: 5 }))[0].message, /name.*string/);
});

test('the input film and values are not mutated', () => {
  const input = film([{ id: 'a', show: 'statement', say: 'Hi {{name}}' }]);
  const before = JSON.stringify(input);
  const values = { name: 'Grace' };
  substitute(input, values);
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(values, { name: 'Grace' });
});

test('the vars shape: names, a default of the declared type, at most VARS_MAX', () => {
  assert.deepEqual(varsErrors({ vars: VARS }), []);
  assert.equal(varsErrors({ vars: { '1x': { type: 'string', default: 'a' } } })[0].path, 'vars.1x');
  assert.match(varsErrors({ vars: { n: { type: 'number', default: 'a' } } })[0].message, /number/);
  assert.match(varsErrors({ vars: { n: { type: 'string' } } })[0].message, /default/);
  const many = Object.fromEntries(Array.from({ length: VARS_MAX + 1 }, (_, i) => [`v${i}`, { type: 'string', default: 'a' }]));
  assert.match(varsErrors({ vars: many })[0].message, /at most 30/);
  assert.deepEqual(defaultValues(VARS), { name: 'Ada', count: 3 });
});
