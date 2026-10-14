// The legend (scripts/lib/legend.mjs): counts per kind and the edge styles used,
// measured into a row the layouts reserve a band for at the top right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { legendItems, legendLayout, placeLegend, legendSvg, LEGEND_ROW, LEGEND_BAND } from '../scripts/lib/legend.mjs';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { renderSvg } from '../scripts/lib/render.mjs';
import { fonts } from '../scripts/lib/sizes.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('blueprint');
const example = (name) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../references/examples/${name}.diagram.json`, import.meta.url)), 'utf8'));
const kind = (name, family, count) => ({ kind: 'kind', name, family, count });
const WORD = { solid: 'call', dashed: 'optional', async: 'event', sync: 'call', reply: 'reply', self: 'self' };
const style = (name, s = name, seq = false) => ({ kind: 'style', name, style: s, label: seq && name === 'async' ? 'event' : WORD[name] });

test('legendItems: kinds in order of first use with counts, then the edge styles used', () => {
  assert.deepEqual(legendItems(example('story')), [
    kind('user', 'person', 1), kind('client', 'service', 1), kind('gateway', 'service', 1), kind('service', 'service', 1), kind('database', 'data', 1), kind('queue', 'queue', 1), kind('external', 'external', 1),
    style('solid'), style('async'), style('dashed'),
  ]);
  assert.deepEqual(legendItems(example('architecture')), [kind('client', 'service', 1), kind('service', 'service', 1), kind('database', 'data', 1), kind('external', 'external', 1), style('solid'), style('async'), style('dashed')]);
  assert.deepEqual(legendItems(example('flow')).slice(0, 3), [kind('start', 'bare', 1), kind('io', 'service', 1), kind('decision', 'decision', 1)]);
  assert.deepEqual(legendItems(example('flow')).slice(-2), [style('solid'), style('dashed')]);
  assert.deepEqual(legendItems(example('sequence')), [
    kind('actor', 'person', 1), kind('service', 'service', 2), kind('database', 'data', 1), kind('external', 'external', 1),
    style('sync', 'solid'), style('async', 'async'), style('reply', 'dashed'), style('self', 'solid'),
  ]);
  assert.deepEqual(legendItems({ type: 'sequence', participants: [{ id: 'a', label: 'A' }] }), [kind('service', 'service', 1)], 'no messages, no styles');
});

test('legendLayout measures one row with the theme font; placeLegend right-aligns it in the top band', () => {
  const row = legendLayout(example('architecture'), theme);
  assert.equal(row.height, LEGEND_ROW);
  assert.equal(row.items.length, 7);
  assert.ok(row.width > 300 && row.width < 700, `${row.width}`);
  row.items.forEach((it, i) => {
    assert.ok(it.width > 12, it.name);
    if (i) assert.ok(it.dx >= row.items[i - 1].dx + row.items[i - 1].width, 'items do not overlap');
  });
  assert.equal(row.items[0].dx, 0);
  assert.ok(Math.abs(row.width - (row.items.at(-1).dx + row.items.at(-1).width)) < 0.01);
  const placed = placeLegend(row, 1000, 24);
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [Math.round((1000 - 24 - row.width) * 10) / 10, 24, row.width, LEGEND_ROW]);
  assert.equal(placed.items, row.items);
  assert.ok(LEGEND_BAND >= LEGEND_ROW + 8, 'a gap under the row');
});

test('every geometry carries its legend inside the canvas and starts the drawing below the band; a narrow drawing widens for it', async () => {
  for (const name of ['architecture', 'flow', 'state', 'sequence', 'story']) {
    const g = await layoutDiagram(example(name), theme);
    assert.equal(g.legend.y, 24, name);
    assert.ok(g.legend.x >= 24 - 0.05 && g.legend.x + g.legend.width <= g.width - 24 + 0.05, `${name}: inside the canvas`);
    const top = Math.min(...[...(g.nodes ?? []), ...(g.participants ?? []), ...(g.groups ?? [])].map((b) => b.y));
    assert.ok(top >= 24 + LEGEND_BAND - 0.05, `${name}: the drawing starts below the band (${top})`);
  }
  const tall = { title: 't', type: 'flow', direction: 'down', nodes: [{ id: 'a', label: 'A', kind: 'io' }, { id: 'b', label: 'B', kind: 'subprocess' }, { id: 'c', label: 'C', kind: 'wait' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', style: 'dashed' }] };
  const g = await layoutDiagram(tall, theme);
  assert.equal(g.width, Math.ceil(g.legend.width + 48), 'the canvas is as wide as the legend needs, to a whole pixel');
  assert.ok(g.nodes.every((n) => n.x + n.width <= g.width - 24 + 0.05));
});

test('a drawing narrower than its legend is centred in the widened canvas', async () => {
  const tall = { title: 't', type: 'flow', direction: 'down', nodes: [{ id: 'a', label: 'A', kind: 'io' }, { id: 'b', label: 'B', kind: 'subprocess' }, { id: 'c', label: 'C', kind: 'wait' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c', style: 'dashed' }] };
  const g = await layoutDiagram(tall, theme);
  assert.ok(g.width > Math.max(...g.nodes.map((n) => n.x + n.width)) + 24 + 5, 'the canvas really did widen');
  const left = Math.min(...g.nodes.map((n) => n.x));
  const right = g.width - Math.max(...g.nodes.map((n) => n.x + n.width));
  assert.ok(Math.abs(left - right) <= 1, `margins ${left} / ${right}`);
  assert.ok(g.edges.every((e) => e.points.every((p) => p.x >= left - 0.05 && p.x <= g.width - right + 0.05)), 'edges moved with the nodes');
  assert.equal(g.legend.x + g.legend.width, g.width - 24, 'the legend stays top right');
  const seq = await layoutDiagram({ title: 't', type: 'sequence', participants: [{ id: 'a', label: 'A', kind: 'actor' }, { id: 'b', label: 'B', kind: 'database' }], messages: [{ from: 'a', to: 'b', kind: 'reply' }, { from: 'b', to: 'a', kind: 'async' }, { from: 'a', to: 'a', kind: 'self' }] }, theme);
  const sl = Math.min(...seq.participants.map((p) => p.x));
  const sr = seq.width - Math.max(...seq.participants.map((p) => p.x + p.width));
  assert.ok(seq.width > seq.participants.at(-1).x + seq.participants.at(-1).width + 24 + 5, 'the sequence canvas widened too');
  assert.ok(Math.abs(sl - sr) <= 1, `sequence margins ${sl} / ${sr}`);
});

test('the legend names edge styles as words: call, optional, event (sequence: call, event, reply, self)', () => {
  const words = (spec) => legendLayout(spec, theme).items.filter((i) => i.kind === 'style').map((i) => i.label);
  assert.deepEqual(words(example('architecture')), ['call', 'event', 'optional']);
  assert.deepEqual(words(example('sequence')), ['call', 'event', 'reply', 'self']);
});

test('legendSvg: a swatch per kind in its family, a wire sample per style, drawn last', async () => {
  const g = await layoutDiagram(example('architecture'), theme);
  const svg = legendSvg(g.legend, fonts(theme));
  assert.match(svg, /^<g class="pa-legend" aria-hidden="true">/);
  assert.equal((svg.match(/<rect class="pa-swatch pa-family-/g) ?? []).length, 4);
  assert.match(svg, /<rect class="pa-swatch pa-family-data" x="[\d.]+" y="[\d.]+" width="12" height="12" rx="3"\/><text class="pa-legend-text" text-anchor="start"><tspan x="[\d.]+" y="[\d.]+">1 database<\/tspan><\/text>/);
  assert.match(svg, /<g class="pa-legend-sample pa-edge-dashed"><path class="pa-wire" d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+"\/><\/g><text class="pa-legend-text" text-anchor="start"><tspan x="[\d.]+" y="[\d.]+">optional<\/tspan><\/text>/);
  const page = renderSvg(g, example('architecture'), { theme });
  assert.ok(page.endsWith(`${svg}</svg>`), 'the legend is the last thing drawn');
  const seq = await layoutDiagram(example('sequence'), theme);
  const s = legendSvg(seq.legend, fonts(theme));
  assert.match(s, /pa-edge-solid"><path class="pa-wire"[^>]*\/><\/g><text class="pa-legend-text"[^>]*><tspan[^>]*>call</);
  assert.match(s, /pa-edge-dashed"><path class="pa-wire"[^>]*\/><\/g><text class="pa-legend-text"[^>]*><tspan[^>]*>reply</);
  assert.match(s, />2 service</);
  const evil = await layoutDiagram({ title: 't', type: 'architecture', nodes: [{ id: 'a', label: 'A', kind: 'external' }] }, theme);
  assert.ok(!legendSvg(evil.legend, fonts(theme)).includes('<b'), 'nothing but kind names and counts reach the legend');
});
