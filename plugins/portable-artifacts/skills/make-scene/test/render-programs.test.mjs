// How many shader programs a built scene needs. A page's first draw is mostly shader compile (50 to 70 ms per program on
// software WebGL, and about the same on a slow CI runner), so every look feature that got a program of its own made opening
// a page slower: the edge band, the fresnel rim, the pool of light and the lone tube together added two programs to a lifted
// diagram (2 -> 4) and one to a city and a forest (2 -> 3), and opening a page took 40 to 75 % longer. three compiles one
// program per distinct combination of the things below, so counting the combinations counts the programs without a GPU.
// programs-browser.test.mjs counts the real ones in a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadTheme } from '../shared/theme.mjs';
import { TOKEN_VARS } from '../template/runtime/colour.js';
import { buildObjects } from '../template/runtime/render.js';
import { buildScene } from '../scripts/lib/api.mjs';
import { citySpec } from './helpers/scene-fixtures.mjs';

const theme = loadTheme('dusk');
const VAR_TOKEN = Object.fromEntries(Object.entries(TOKEN_VARS).map(([token, cssVar]) => [cssVar, token]));
const palette = (dark) => ({ dark, readVar: (cssVar) => theme[dark ? 'dark' : 'light'][VAR_TOKEN[cssVar]] });
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** The most programs a first draw may compile, per scene: what the scene cost before the look work (counted in a browser). */
const BUDGET = { city: 2, forest: 2, terrain: 2, galaxy: 5, story: 2 };

async function graphFor(name) {
  if (name === 'story') return (await buildScene({ title: 'Lifted', lift: { diagram: 'story.diagram.json' } }, { dir: FIXTURES, theme })).graph;
  return (await buildScene(citySpec({ world: name, links: name === 'galaxy' ? [{ from: 'api', to: 'web', value: 5 }] : [] }), { dir: process.cwd(), theme })).graph;
}

/** What three's program key depends on for a mesh: the kinds of vertex and fragment shader it needs. */
const programKey = (o) => {
  const m = o.material;
  return [o.isInstancedMesh ? 'instanced' : o.isPoints ? 'points' : 'mesh', m.type, m.transparent, m.fog, m.flatShading, m.vertexColors, m.side, m.customProgramCacheKey()].join('|');
};

const shown = (key) => key.replace(/\s+/g, ' ').slice(0, 110); // a patch's default key is its function's source: show the start of it

/** The distinct program keys of everything a frame draws (an invisible object, or one under an invisible group, is not compiled). */
function programsOf(root) {
  const keys = new Set();
  root.traverse((o) => {
    if (!o.material) return;
    for (let at = o; at; at = at.parent) if (!at.visible) return;
    keys.add(programKey(o));
  });
  return [...keys];
}

for (const [name, budget] of Object.entries(BUDGET)) {
  for (const dark of [false, true]) {
    test(`${name}, ${dark ? 'dark' : 'light'}: a first draw needs at most ${budget} programs`, async () => {
      const built = buildObjects(await graphFor(name), palette(dark));
      const keys = programsOf(built.root);
      assert.ok(keys.length <= budget, `${keys.length} programs, at most ${budget}:\n${keys.map(shown).join('\n')}`);
      built.dispose();
    });
  }
}

test('the edge band, the fresnel rim and the pool share programs with the masses and the ground', async () => {
  // A lifted diagram draws boxes with an edge band, tubes and arrowheads with a fresnel rim: all one instanced program.
  const built = buildObjects(await graphFor('story'), palette(true));
  const lit = new Set();
  built.root.traverse((o) => { if (o.material?.isMeshStandardMaterial && o.visible) lit.add(programKey(o)); });
  assert.equal(lit.size, 1, `the lit meshes of a lifted diagram are one program:\n${[...lit].map(shown).join('\n')}`);
  built.dispose();
});
