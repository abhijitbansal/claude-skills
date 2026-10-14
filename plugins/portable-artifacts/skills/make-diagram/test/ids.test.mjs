// Ids are model-provided keys. Every one the id pattern allows must work, including
// names that exist on Object.prototype (`constructor`); the rest of those names
// (toString, hasOwnProperty, __proto__) are rejected by the pattern.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { PROTOTYPE_NAMED_SPECS } from './helpers/prototype-ids.mjs';

for (const [name, spec] of Object.entries(PROTOTYPE_NAMED_SPECS)) {
  test(`${name} validates and builds, and its data maps answer for it`, async () => {
    assert.deepEqual((await validateSpec(spec)).errors, []);
    const built = await buildDiagram(spec);
    const { data } = built;
    for (const map of [data.adjacency, data.edges, data.parents, data.boxes, data.info, data.directed]) assert.equal(Object.getPrototypeOf(map), Object.prototype, 'plain JSON-shaped objects');
    for (const id of built.ids) assert.ok(Object.hasOwn(data.boxes, id), `a box for ${id}`);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(data)).boxes).sort(), [...built.ids].sort());
  });
}

test('ids named like other Object.prototype members are rejected by the id pattern', async () => {
  for (const id of ['toString', 'hasOwnProperty', 'valueOf', '__proto__']) {
    const spec = { title: 'T', type: 'flow', nodes: [{ id, label: 'X' }] };
    const { ok, errors } = await validateSpec(spec);
    assert.equal(ok, false, id);
    assert.match(errors[0].message, /invalid/, id);
  }
});

test('an unknown kind named like an Object.prototype member gets one kind error, not an icon one', async () => {
  const spec = { title: 'T', type: 'flow', nodes: [{ id: 'a', label: 'A', kind: 'constructor', icon: 'lucide:clock' }] };
  const { errors } = await validateSpec(spec);
  assert.deepEqual(errors.map((e) => e.path), ['nodes[0].kind']);
});
