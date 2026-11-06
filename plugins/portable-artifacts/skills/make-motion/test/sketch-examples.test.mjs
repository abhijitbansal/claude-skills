// Task 15: the four hand-drawn starter films and how an agent finds them. Each film validates, passes check.mjs and renders the
// same bytes twice; SKILL.md names them and its description says "hand-drawn" on one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, assertRendersIdentically } from './helpers/render.mjs';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { isSketchScene } from '../template/sketch/style.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const EXAMPLES = path.join(root, 'references/examples');
const FILMS = ['sketch-architecture', 'sketch-concept', 'sketch-steps', 'sketch-mixed'];
const filmPath = (name) => path.join(EXAMPLES, `${name}.json`);
// A film that opens on a sketch scene starts with a blank board on purpose, so check.mjs warns about the thumbnail once.
const BLANK_BOARD = /^scene "[^"]+" shows nothing at 0\.00s: the first frame, the video's thumbnail, is blank; a hand-drawn scene starts as an empty board/;
const SKILL_MD = readFileSync(path.join(root, 'SKILL.md'), 'utf8');

test('each starter validates', () => {
  for (const name of FILMS) {
    const { spec, dir } = loadSpec(filmPath(name));
    const { errors } = validateSpec(spec, { dir });
    assert.deepEqual(errors.map((e) => `${e.path}: ${e.message}`), [], name);
  }
});

test('each starter has a drawn scene', () => {
  for (const name of FILMS) {
    const { spec } = loadSpec(filmPath(name));
    assert.ok(spec.scenes.some((scene) => isSketchScene(spec, scene)), `${name} has a sketch scene`);
  }
});

test('each starter: check.mjs reports no problems, and only a sketch opening may warn, once, about the blank board', async (t) => {
  if (!await requireRender(t)) return;
  for (const name of FILMS) {
    const { spec } = loadSpec(filmPath(name));
    const r = spawnSync(process.execPath, [CHECK, filmPath(name), '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${name}: ${r.stdout}${r.stderr}`);
    const found = JSON.parse(r.stdout);
    assert.equal(found.ok, true, name);
    assert.equal(found.errors, undefined, `${name}: a passing check lists no errors`);
    const warnings = found.warnings ?? [];
    const opensDrawn = isSketchScene(spec, spec.scenes[0]);
    assert.equal(warnings.length, opensDrawn ? 1 : 0, `${name}: ${JSON.stringify(warnings)}`);
    if (opensDrawn) assert.match(warnings[0].message, BLANK_BOARD, name);
  }
});

test('each starter renders byte-identically twice', async (t) => {
  if (!await requireRender(t)) return;
  for (const name of FILMS) await assertRendersIdentically(t, filmPath(name), ['--fps', '10', '--size', '480x270']);
});

test('sketch-mixed has both standard and sketch scenes', () => {
  const { spec } = loadSpec(filmPath('sketch-mixed'));
  const drawn = spec.scenes.map((scene) => isSketchScene(spec, scene));
  assert.ok(drawn.includes(true), 'a drawn scene');
  assert.ok(drawn.includes(false), 'a standard scene');
  assert.equal(drawn[0], false, 'it opens on a standard scene, so its thumbnail is not blank');
});

test('sketch-architecture ends each drawn scene into the next with the erase transition', () => {
  const { spec } = loadSpec(filmPath('sketch-architecture'));
  assert.ok(spec.scenes.length > 1, 'more than one scene');
  assert.ok(spec.scenes.slice(1).some((scene) => scene.transition === 'erase'), 'uses erase');
});

test('the description is one line and contains "hand-drawn"', () => {
  const frontmatter = SKILL_MD.split('\n---\n')[0].split('\n');
  const at = frontmatter.findIndex((line) => line.startsWith('description:'));
  assert.ok(at > -1, 'a description line');
  const value = frontmatter[at].slice('description:'.length).trim();
  assert.ok(!/^[>|]/.test(value), 'not a folded or literal scalar: the registry parser truncates it to ">-"');
  assert.ok(value.length > 40, 'the text is on the same line');
  assert.ok(!/^\s/.test(frontmatter[at + 1]), 'the next line is another key, not a continuation');
  assert.match(value, /hand-drawn/);
  assert.match(value, /short animated explainer video/, 'the old trigger meaning stays');
});

test('SKILL.md names every starter file and points at references/sketch.md', () => {
  for (const name of FILMS) assert.ok(SKILL_MD.includes(`references/examples/${name}.json`), `${name} named`);
  assert.ok(SKILL_MD.includes('references/sketch.md'));
  assert.match(SKILL_MD, /\n## Hand-drawn style\n/);
});
