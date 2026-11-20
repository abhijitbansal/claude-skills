// A field a shot may leave out must never make a look, kind or format throw. For every look, every kind's registry
// example and both formats, each example field is left out in turn; where the film still validates, it must expand.
// (cosmos chart at 16:9 without a source threw "fitText: need 1 <= min <= max": the claim's floor was three times the
// labels, which were set at 1.7 times the second step for the phone tile, over the title's own maximum.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { registries } from '../../engine/registry.mjs';
import '../../engine/kinds/index.mjs';
import { allLookNames } from '../../engine/looks/index.mjs';
import { validateFilm } from '../../scripts/v2/spec.mjs';
import { prepareFilm } from '../../scripts/v2/prepare/index.mjs';
import { expandIn, filmOf } from './helpers/kinds.mjs';

const SPEC_DIR = fileURLToPath(new URL('../../references/examples/v2', import.meta.url));
const PREPARED = Object.freeze(['map', 'code']); // kinds whose example needs the prepare step
const FORMATS = Object.freeze(['16:9', '9:16']);
const KEPT = Object.freeze(['id', 'show']);

// Every [look, kind, format, omitted field] whose film validates with the field left out.
function leftOutCases() {
  const cases = [];
  for (const lookName of allLookNames()) {
    const look = registries.looks.get(lookName);
    for (const kind of registries.kinds.names()) {
      const { example } = registries.kinds.get(kind);
      if (example === undefined) continue;
      for (const format of FORMATS) {
        for (const omit of Object.keys(example).filter((k) => !KEPT.includes(k))) {
          const shot = Object.fromEntries(Object.entries(example).filter(([k]) => k !== omit));
          const film = filmOf([shot], lookName, format, { mode: look.modes[0] });
          if (validateFilm(film, { specDir: SPEC_DIR }).ok) cases.push({ lookName, kind, format, omit, film });
        }
      }
    }
  }
  return cases;
}

test('every look, kind and format expands with any optional field of its example left out', () => {
  const cases = leftOutCases();
  assert.ok(cases.length > 300, `swept ${cases.length} cases`);
  const crashed = [];
  for (const { lookName, kind, format, omit, film } of cases) {
    try {
      const prepared = PREPARED.includes(kind) ? prepareFilm(film, { filmDir: SPEC_DIR }).prepared : {};
      expandIn(film, 0, { prepared });
    } catch (e) {
      crashed.push(`${lookName} ${kind} ${format} without "${omit}": ${String(e.message).split('\n')[0]}`);
    }
  }
  assert.deepEqual(crashed, []);
});
