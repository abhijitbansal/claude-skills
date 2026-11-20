// Nothing branches on a look's or a mode's name (looks-four plan, Engine rules): everything that differs between looks
// is look data or a named style a look selects. This reads every .mjs under engine/ and scripts/v2/ and fails on a
// comparison of a look's or mode's name. It is not a grep for the words: 'desk' is also a camera style, 'pop' a move
// and a cue, 'cosmos' a field, 'marker' a cue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '../..');
const ROOTS = Object.freeze(['engine', 'scripts/v2']);

// a comparison on look.name or mode.name (optional chaining allowed), a switch on a look's name, or a comparison on
// the name of a resolved look
const PATTERNS = Object.freeze([
  /look\??\.name\s*[!=]==/,
  /mode\??\.name\s*[!=]==/,
  /switch \([^)]*look\??\.name/,
  /resolveLook\([^)]*\)\.name\s*[!=]==/,
]);

// Every .mjs file under `dir`, recursively, as paths relative to the skill.
function moduleFiles(dir) {
  return readdirSync(path.join(SKILL, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return moduleFiles(rel);
    return entry.name.endsWith('.mjs') ? [rel] : [];
  });
}

// The lines of `source` that compare a look's or mode's name, as "line: text".
function nameComparisons(source) {
  return source.split('\n').flatMap((line, i) => (PATTERNS.some((re) => re.test(line)) ? [`${i + 1}: ${line.trim()}`] : []));
}

test('no engine or script file compares a look\'s name', () => {
  const files = ROOTS.flatMap(moduleFiles);
  assert.ok(files.length > 100, `read the engine and scripts (${files.length} files)`);
  const sites = files.flatMap((file) => nameComparisons(readFileSync(path.join(SKILL, file), 'utf8')).map((hit) => `${file}:${hit}`));
  assert.deepEqual(sites, [], 'a comparison on a look or mode name: make it look data or a named style instead');
});

test('the guard fires on a planted comparison', () => {
  const planted = [
    "if (ctx.look.name === 'ledger') return 1;",
    "const tall = film.mode?.name !== 'viral';",
    'switch (ctx.look.name) {',
    "if (resolveLook(film).name === 'pop') x();",
  ];
  for (const line of planted) assert.equal(nameComparisons(line).length, 1, `fires on: ${line}`);
  // the words alone are not comparisons: a camera style, a move, a field and a cue share the names
  const plain = ["camera: { style: 'desk' }", "moves.pop", "field: 'cosmos'", "cue: 'marker'", "look.name"];
  for (const line of plain) assert.deepEqual(nameComparisons(line), [], `quiet on: ${line}`);
});
