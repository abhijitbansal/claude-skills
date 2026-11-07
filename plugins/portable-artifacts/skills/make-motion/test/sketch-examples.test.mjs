// Task 15: the four hand-drawn starter films and how an agent finds them. Each film validates, passes check.mjs and renders the
// same bytes twice; SKILL.md names them and its description says "hand-drawn" on one line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireRender, assertRendersIdentically } from './helpers/render.mjs';
import { BLANK_BOARD_MESSAGE } from './helpers/blank-board.mjs';
import { loadSpec, validateSpec } from '../scripts/lib/spec.mjs';
import { isSketchScene } from '../template/sketch/style.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = path.join(root, 'scripts/check.mjs');
const EXAMPLES = path.join(root, 'references/examples');
const FILMS = ['sketch-architecture', 'sketch-concept', 'sketch-steps', 'sketch-mixed'];
const filmPath = (name) => path.join(EXAMPLES, `${name}.json`);
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
    // A film that opens on a drawn scene starts with a blank board on purpose, so check.mjs warns about the thumbnail once.
    if (opensDrawn) assert.match(warnings[0].message, BLANK_BOARD_MESSAGE, name);
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

// The scenes that come in over a drawn scene and are drawn themselves: [{ scene, type }] with the transition type they use.
function drawnCuts(spec) {
  return spec.scenes.flatMap((scene, i) => {
    if (i === 0 || !isSketchScene(spec, scene) || !isSketchScene(spec, spec.scenes[i - 1])) return [];
    const written = scene.transition ?? spec.transition;
    return [{ scene: scene.id, type: typeof written === 'string' ? written : written?.type }];
  });
}

test('sketch-architecture clears each drawn board for the next with the erase transition: every drawn-to-drawn cut', () => {
  const { spec } = loadSpec(filmPath('sketch-architecture'));
  const cuts = drawnCuts(spec);
  assert.equal(cuts.length, spec.scenes.length - 1, 'every cut is between two drawn scenes');
  assert.ok(cuts.length >= 2, 'more than one cut');
  assert.deepEqual(cuts.map((cut) => cut.type), cuts.map(() => 'erase'), JSON.stringify(cuts));
  // The guardrail: a cut that is not erase is seen.
  const mutated = { ...spec, scenes: spec.scenes.map((scene, i) => (i === 1 ? { ...scene, transition: 'push' } : scene)) };
  assert.notDeepEqual(drawnCuts(mutated).map((cut) => cut.type), cuts.map(() => 'erase'));
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
