// The code kind's prepare step (plan 2026-11-16-pa2-shot-kinds-b, Task 8): shiki's fine-grained core with the JavaScript
// regex engine turns each code string into lines of { text, role } tokens in Node, against a theme whose colours are role
// markers, so no shiki colour reaches the frame. Deterministic, never runs the code. Also the language list and its
// aliases (copied from version 1's code theme) and the line diff (code-diff.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCode, ROLES } from '../../scripts/v2/prepare/code.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { CODE_LANGS, resolveLang } from '../../engine/kinds/code-langs.mjs';
import { diffLines } from '../../engine/kinds/code-diff.mjs';

// The language list and its aliases as version 1's template/code-theme.mjs held them at 2e505594 (before the cut-over
// deleted that file), recorded by running it (.scratch/co1/record-before.mjs).
const V1_LANGS = Object.freeze(['text', 'javascript', 'typescript', 'json', 'bash', 'python', 'diff', 'go', 'rust', 'swift', 'yaml', 'html', 'css', 'markdown']);
const V1_ALIASES = Object.freeze({
  js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', py: 'python',
  golang: 'go', rs: 'rust', yml: 'yaml', htm: 'html', md: 'markdown', txt: 'text', plaintext: 'text', patch: 'diff',
});

const roles = (line) => line.filter((t) => t.text.trim() !== '').map((t) => [t.text.trim(), t.role]);
const textOf = (line) => line.map((t) => t.text).join('');

test('three lines of JavaScript tokenise to the hand-written roles', () => {
  const { data, problems } = prepareCode({ id: 'c', show: 'code', lang: 'js', code: 'const total = 42;\n// sum the rows\nreturn "done";' });
  assert.deepEqual(problems, []);
  const [a, b, c] = data.code;
  assert.deepEqual(roles(a), [['const', 'keyword'], ['total', 'plain'], ['=', 'punct'], ['42', 'number'], [';', 'punct']]);
  assert.deepEqual(roles(b), [['// sum the rows', 'comment']]);
  assert.deepEqual(roles(c), [['return', 'keyword'], ['"done"', 'string'], [';', 'punct']]);
  assert.ok(data.code.flat().every((t) => ROLES.includes(t.role)), 'every role is one of the seven');
});

test('the text of every line is kept exactly, tabs as two spaces; text code is one plain token a line', () => {
  const code = 'if (x) {\n\treturn  a+b\n}\n\nend';
  const { data } = prepareCode({ id: 'c', show: 'code', lang: 'javascript', code });
  assert.deepEqual(data.code.map(textOf), ['if (x) {', '  return  a+b', '}', '', 'end']);
  const plain = prepareCode({ id: 'c', show: 'code', code: 'any = text\nhere' }).data.code;
  assert.deepEqual(plain, [[{ text: 'any = text', role: 'plain' }], [{ text: 'here', role: 'plain' }]]);
});

test('diff and run modes prepare before, after, command and output; nothing is executed', () => {
  const diff = prepareCode({ id: 'd', show: 'code', mode: 'diff', lang: 'python', before: 'x = 1', after: 'x = 2' }).data;
  assert.deepEqual(Object.keys(diff).sort(), ['after', 'before']);
  const run = prepareCode({ id: 'r', show: 'code', mode: 'run', command: 'rm -rf / --no-preserve-root', output: 'deleted nothing\nok' }).data;
  assert.deepEqual(Object.keys(run).sort(), ['command', 'output']);
  assert.equal(textOf(run.command[0]), 'rm -rf / --no-preserve-root');
  assert.deepEqual(run.output.map(textOf), ['deleted nothing', 'ok']);
  assert.ok(run.output.flat().every((t) => t.role === 'plain'), 'output is drawn as written');
});

test('the same film prepares to byte-identical JSON twice, through prepareFilm', () => {
  const film = { version: 2, shots: [{ id: 'c', show: 'code', lang: 'ts', code: 'export const a: number = 1;\nfunction f() { return a }' }] };
  const one = JSON.stringify(prepareFilm(film, { filmDir: '.' }));
  const two = JSON.stringify(prepareFilm(film, { filmDir: '.' }));
  assert.equal(one, two);
  assert.ok(JSON.parse(one).prepared.c.code.length === 2);
});

test('every language of the list tokenises a line; aliases resolve; the list and aliases equal version 1\'s', () => {
  assert.deepEqual([...CODE_LANGS], [...V1_LANGS]);
  assert.equal(Object.keys(V1_ALIASES).length, 17);
  for (const [alias, lang] of Object.entries(V1_ALIASES)) assert.equal(resolveLang(alias), lang, alias);
  assert.equal(resolveLang('pyhton'), null);
  assert.equal(resolveLang('constructor'), null, 'an inherited name is never an alias');
  for (const lang of CODE_LANGS) {
    const { data } = prepareCode({ id: 'c', show: 'code', lang, code: 'x = 1 # y' });
    assert.equal(textOf(data.code[0]), 'x = 1 # y', lang);
  }
});

// ---- code-diff ----

const signs = (rows) => rows.map((r) => `${r.type[0]}${r.text}`);
test('diffLines: all added, all removed, a change in the middle, identical, a moved line', () => {
  assert.deepEqual(signs(diffLines([], ['a', 'b'])), ['aa', 'ab']);
  assert.deepEqual(signs(diffLines(['a', 'b'], [])), ['ra', 'rb']);
  assert.deepEqual(signs(diffLines(['a', 'b', 'c'], ['a', 'x', 'c'])), ['sa', 'rb', 'ax', 'sc']);
  assert.deepEqual(signs(diffLines(['a', 'b'], ['a', 'b'])), ['sa', 'sb']);
  assert.deepEqual(signs(diffLines(['a', 'b', 'c'], ['b', 'c', 'a'])), ['ra', 'sb', 'sc', 'aa'], 'a moved line is a removal and an addition');
  const rows = diffLines(['a', 'b', 'c'], ['a', 'x', 'c']);
  assert.deepEqual(rows.map((r) => [r.from, r.to]), [[0, 0], [1, null], [null, 1], [2, 2]], 'each row keeps its line numbers before and after');
});
