// PA-22: a diagram that fits at an unreadable size is warned about (validate) and failed (check), long chains wrap,
// and a long note cannot stretch its card. Nothing here needs a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateSpec } from '../scripts/lib/spec.mjs';
import { buildDiagram } from '../scripts/lib/api.mjs';
import { layoutGraph } from '../scripts/lib/layout-graph.mjs';
import { LABEL_SIZE, MAX_NOTE_WIDTH, nodeSize, fonts } from '../scripts/lib/sizes.mjs';
import { STAGE_WIDTH, STAGE_HEIGHT, MIN_LABEL_PX, LABEL_PX, estimateFitScale, labelPx, isLegible, legibilityMessage } from '../scripts/lib/legibility.mjs';
import { KINDS } from '../scripts/lib/kinds.mjs';
import { loadTheme } from '../shared/theme.mjs';
import { measure } from '../shared/text.mjs';

const theme = loadTheme('blueprint');
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));
const fitOf = (g) => estimateFitScale(g.drawing.width, g.drawing.height);

const chain = (n, extra = {}) => ({
  title: `chain of ${n}`,
  type: 'architecture',
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Service number ${i}` })),
  edges: Array.from({ length: n - 1 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}`, label: 'calls' })),
  ...extra,
});

test('LABEL_PX is the size sizes.mjs draws a label at', () => {
  assert.equal(LABEL_PX, LABEL_SIZE);
});

test('estimateFitScale: a drawing that fills the stage fits at about 1, a long one at its width ratio, a tiny one is capped', () => {
  const full = estimateFitScale(STAGE_WIDTH - 32, STAGE_HEIGHT - 32);
  assert.ok(Math.abs(full - 1) < 1e-9, String(full));
  assert.ok(Math.abs(estimateFitScale(2 * STAGE_WIDTH - 32, 100) - 0.5) < 1e-9);
  assert.equal(estimateFitScale(10, 10), 1.25);
  assert.equal(estimateFitScale(0, 0) > 0, true);
});

test('the message names direction only where a direction exists', () => {
  assert.match(legibilityMessage(0.3), /direction down for a long chain/);
  assert.doesNotMatch(legibilityMessage(0.3, undefined, { direction: false }), /direction/);
});

test('isLegible follows the label floor', () => {
  assert.equal(isLegible(MIN_LABEL_PX / LABEL_PX), true);
  assert.equal(isLegible(MIN_LABEL_PX / LABEL_PX - 0.01), false);
  assert.equal(labelPx(0.5), LABEL_PX / 2);
  assert.match(legibilityMessage(0.2), /^fits on a 1440 px screen at 20% zoom, so labels draw about 2\.8 px \(the floor is 8 px\): split it/);
});

// ---- the validate warning ---------------------------------------------------------------------------

test('a 60-node chain validates (exit 0 material) but warns that its labels cannot be read, at the root', async () => {
  const r = await validateSpec(chain(60));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, []);
  const warning = r.warnings?.find((w) => /labels draw about/.test(w.message));
  assert.ok(warning, `no legibility warning in ${JSON.stringify(r.warnings)}`);
  assert.equal(warning.path, '');
  assert.match(warning.message, /split it into several diagrams/);
});

test('cloud-architecture is the shipped example the gate reports: tall and grouped, so it is never wrapped (update when it is reshaped)', async () => {
  const r = await validateSpec(example('cloud-architecture'));
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const w = r.warnings?.find((x) => /labels draw about/.test(x.message));
  assert.ok(w, JSON.stringify(r.warnings));
  assert.match(w.message, /labels draw about 6\.\d px/);
});

test('the shipped examples carry no legibility warning', async () => {
  for (const name of ['architecture', 'flow', 'state', 'sequence', 'story']) {
    const r = await validateSpec(example(name));
    const bad = (r.warnings ?? []).filter((w) => /labels draw about/.test(w.message));
    assert.deepEqual(bad, [], name);
  }
});

test('a small diagram has no warnings key at all', async () => {
  const r = await validateSpec(chain(3));
  assert.equal('warnings' in r, false, JSON.stringify(r));
});

// ---- ELK wrapping ----------------------------------------------------------------------------------------

test('a chain too long for one row wraps into rows: it is far more legible than the single row, and nothing overlaps', async () => {
  const g = await layoutGraph(chain(12), theme);
  assert.ok(isLegible(fitOf(g)), `fit ${fitOf(g)} (label ${labelPx(fitOf(g)).toFixed(1)} px) for ${g.width}x${g.height}`);
  const rows = new Set(g.nodes.map((n) => n.y));
  assert.ok(rows.size > 1, 'more than one row');
  for (const [i, a] of g.nodes.entries()) {
    for (const b of g.nodes.slice(i + 1)) {
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart, `${a.id} overlaps ${b.id}`);
    }
  }
  for (const e of g.edges) assert.ok(e.points.length >= 2, e.id);
});

test('a 60-node chain wraps too and still lays out', async () => {
  const g = await layoutGraph(chain(60), theme);
  assert.ok(new Set(g.nodes.map((n) => n.y)).size > 4, 'many rows');
  assert.equal(g.nodes.length, 60);
});

test('a diagram that already fits is not wrapped: the examples keep one row of layers', async () => {
  const g = await layoutGraph(example('architecture'), theme);
  assert.ok(isLegible(fitOf(g)));
  assert.ok(Math.max(...g.nodes.map((n) => n.y)) - Math.min(...g.nodes.map((n) => n.y)) < 300);
});

test('a spec with groups lays out as before (no wrapping is tried across group boundaries)', async () => {
  const spec = chain(14, { groups: [{ id: 'g', label: 'All' }] });
  spec.nodes.forEach((n) => { n.group = 'g'; });
  const g = await layoutGraph(spec, theme);
  assert.equal(g.nodes.length, 14);
  assert.equal(g.groups.length, 1);
});

// ---- notes ------------------------------------------------------------------------------------------------------

test('a 60-character note is clipped on the card so the card stays within the note cap, and validate says so', async () => {
  const note = 'a note that runs all the way to the sixty character limit..';
  assert.equal(note.length, 59);
  const spec = { title: 'Note', type: 'architecture', nodes: [{ id: 'a', label: 'A', note }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] };
  const kindInfo = KINDS.architecture.kinds[KINDS.architecture.default];
  const size = nodeSize(spec.nodes[0], kindInfo, theme);
  assert.ok(measure(size.noteLine, fonts(theme).note) <= MAX_NOTE_WIDTH, `${size.noteLine} is ${measure(size.noteLine, fonts(theme).note)} px`);
  assert.ok(size.noteLine.endsWith('…'), size.noteLine);
  assert.ok(size.width < 260, `card is ${size.width} px wide`);
  const r = await validateSpec(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const w = r.warnings?.find((x) => x.path === 'nodes[0].note');
  assert.ok(w, JSON.stringify(r.warnings));
  assert.match(w.message, /clipped on the card/);
});

test('a short note is drawn whole and draws no warning', async () => {
  const spec = { title: 'Note', type: 'architecture', nodes: [{ id: 'a', label: 'A', note: 'primary + replica' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] };
  const size = nodeSize(spec.nodes[0], KINDS.architecture.kinds[KINDS.architecture.default], theme);
  assert.equal(size.noteLine, 'primary + replica');
  assert.equal((await validateSpec(spec)).warnings, undefined);
});

// ---- wrapping keeps the walkthrough and never turns a valid spec invalid ------------------------------------------------

test('a wrapped chain keeps one layer per node and the walkthrough steps in chain order', async () => {
  const g = await layoutGraph(chain(12), theme);
  assert.deepEqual(g.layers, Array.from({ length: 12 }, (_, i) => [`n${i}`]), 'rows that share a band are not merged into false layers');
  const built = await buildDiagram(chain(12));
  assert.deepEqual(built.steps.map((s) => s.title), Array.from({ length: 12 }, (_, i) => `Service number ${i}`));
  assert.deepEqual(built.warnings, []);
});

// A branching flow, direction down, with back edges: long enough to need wrapping. ELK's wrapping leaves one of its edges
// with no route (measured: 'ELK routed edge 39 in 0 sections'), so the plain layout stands and the spec still validates.
function branchingFlow(n) {
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, label: `Step number ${i}`, ...(i === 10 ? { kind: 'decision', label: 'Ready?' } : {}) }));
  const edges = Array.from({ length: n - 1 }, (_, i) => ({ from: `s${i}`, to: `s${i + 1}`, ...(i === 10 ? { label: 'yes' } : {}) }));
  edges.push({ from: 's10', to: 's3', label: 'no' }, { from: 's30', to: 's8', label: 'retry' });
  return { title: 'Branching', type: 'flow', direction: 'down', nodes, edges };
}

test('a long branching flow with back edges keeps its plain layout when the wrapped one cannot be routed: it still validates, with the legibility warning', async () => {
  const spec = branchingFlow(40);
  const r = await validateSpec(spec);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(r.warnings?.some((w) => /labels draw about/.test(w.message)), JSON.stringify(r.warnings));
  const g = await layoutGraph(spec, theme);
  for (const e of g.edges) assert.ok(e.points.length >= 2, e.id);
  assert.equal(g.nodes.length, 40);
  assert.deepEqual(g.layers.flat().slice(0, 4), ['s0', 's1', 's2', 's3']);
});
