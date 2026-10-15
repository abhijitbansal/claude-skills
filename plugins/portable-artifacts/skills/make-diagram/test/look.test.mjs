// The look: kind families, the card (tile, emoji, type line, note), family-tinted
// edges, and the CSS that paints them. Lanes, pills and the legend join in Task 4.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { renderSvg, diagramCss } from '../scripts/lib/render.mjs';
import { nodeSize, textRoom, fonts, tileOf, trackedWidth, groupMinSize, TILE_SIZE, TILE_GAP, TILE_PAD_Y, TYPE_TRACK, GROUP_TRACK, GROUP_LABEL_INSET } from '../scripts/lib/sizes.mjs';
import { KINDS, FAMILIES, family } from '../scripts/lib/kinds.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('blueprint');
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));
const draw = async (spec) => renderSvg(await layoutDiagram(spec, theme), spec, { theme });
const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);
// A node's whole <g>: it ends with its last <text>, after any <g class="pa-icon"> inside it.
const nodeOf = (svg, id) => tagsOf(svg, new RegExp(`<g class="pa-node [^>]*data-id="${id}"[^>]*>[\\s\\S]*?</text></g>`, 'g'))[0];
const yOf = (node, cls) => Number(node.match(new RegExp(`<text class="${cls}"[^>]*><tspan x="[\\d.]+" y="([\\d.]+)"`))[1]);

test('family: one hue per kind family across the four types; bare shapes have none', () => {
  assert.deepEqual(FAMILIES, ['person', 'service', 'data', 'queue', 'external', 'decision']);
  assert.equal(family('architecture', 'user'), 'person');
  assert.equal(family('sequence', 'actor'), 'person');
  for (const k of ['service', 'client', 'function', 'gateway', 'cache', 'other']) assert.equal(family('architecture', k), 'service', k);
  for (const k of ['step', 'io', 'subprocess', 'wait']) assert.equal(family('flow', k), 'service', k);
  assert.equal(family('architecture', undefined), 'service', 'the default kind');
  assert.equal(family('architecture', 'database'), 'data');
  assert.equal(family('architecture', 'storage'), 'data');
  assert.equal(family('sequence', 'queue'), 'queue');
  assert.equal(family('architecture', 'external'), 'external');
  assert.equal(family('flow', 'decision'), 'decision');
  assert.equal(family('state', 'choice'), 'decision');
  assert.equal(family('state', undefined), 'decision', 'a state card is indigo');
  for (const [t, k] of [['flow', 'start'], ['flow', 'end'], ['state', 'start'], ['state', 'end']]) assert.equal(family(t, k), 'bare', `${t}.${k}`);
  assert.deepEqual(KINDS.architecture.kinds.database, { name: 'database', shape: 'cylinder', icon: 'lucide:database', family: 'data' });
});

test('a card has a tile (icon, or the emoji instead), the kind in spaced capitals and the label; a bare shape has none', () => {
  const service = KINDS.architecture.kinds.service;
  const plain = nodeSize({ id: 'a', label: 'Orders' }, service, theme);
  assert.deepEqual([plain.icon, plain.emoji, plain.typeLine], ['lucide:server', null, 'SERVICE']);
  assert.ok(plain.height >= TILE_SIZE + 2 * TILE_PAD_Y, 'the tile fits');
  const emoji = nodeSize({ id: 'a', label: 'Orders', emoji: '📦', icon: 'brand:postgresql' }, service, theme);
  assert.deepEqual([emoji.icon, emoji.emoji, emoji.typeLine], [null, '📦', 'SERVICE'], 'the emoji replaces the icon');
  assert.equal(emoji.width, plain.width, 'one tile size, icon or emoji');
  assert.deepEqual(tileOf({ emoji: '🚚' }, KINDS.flow.kinds.step), { icon: null, emoji: '🚚' });
  const step = nodeSize({ id: 's', label: 'Ship the parcel to the warehouse' }, KINDS.flow.kinds.step, theme); // wider than the 80 px minimum, so the tile shows in the width
  assert.deepEqual([step.icon, step.emoji, step.typeLine], [null, null, null], 'a plain step: no tile, no type line');
  const stepEmoji = nodeSize({ id: 's', label: 'Ship the parcel to the warehouse', emoji: '🚚' }, KINDS.flow.kinds.step, theme);
  assert.equal(stepEmoji.typeLine, 'STEP');
  assert.ok(stepEmoji.width - step.width >= TILE_SIZE + TILE_GAP - 2, 'an emoji on a step reserves the tile');
  const dot = nodeSize({ id: 'd', label: 'Begin' }, KINDS.state.kinds.start, theme);
  assert.deepEqual([dot.icon, dot.emoji, dot.typeLine, dot.width], [null, null, null, 20]);
  const decision = nodeSize({ id: 'q', label: 'Known?', emoji: '🤔' }, KINDS.flow.kinds.decision, theme);
  assert.deepEqual([decision.emoji, decision.typeLine], [null, null], 'a diamond has no tile even if the spec slipped an emoji past validation');
  assert.equal(textRoom('rounded-rect', 200, true), 200 - 28 - (TILE_SIZE + TILE_GAP));
  assert.equal(textRoom('rounded-rect', 200, false), 172);
});

test('the card is at least as wide as its type line; notes are measured in the theme mono font at 11 px', () => {
  const f = fonts(theme);
  assert.deepEqual([f.note.family, f.note.weight, f.note.size], ['Geist Mono', 400, 11]);
  assert.deepEqual([f.type.family, f.type.weight, f.type.size], ['Geist', 600, 10]);
  assert.equal(fonts(loadTheme('ink')).note.family, 'Geist Mono');
  assert.deepEqual([f.legend.size, f.legend.weight], [11, 400]);
  const narrow = nodeSize({ id: 'x', label: 'Io' }, KINDS.architecture.kinds.external, theme);
  assert.ok(narrow.width >= trackedWidth('EXTERNAL', f.type, TYPE_TRACK) + 28 + TILE_SIZE + TILE_GAP - 2, `${narrow.width} holds the type line`);
  assert.ok(trackedWidth('ab', f.type, TYPE_TRACK) > trackedWidth('AB', f.type, 0), 'tracking adds width; the measurement is of the capitals');
});

test('the SVG card: family class, rect.pa-tile, the icon or the emoji inside it, text.pa-type above the label, the note below', async () => {
  const svg = await draw(example('story'));
  const orders = nodeOf(svg, 'orders');
  assert.match(orders, /^<g class="pa-node pa-kind-service pa-family-service pa-tone-neutral"/);
  assert.match(orders, /<rect class="pa-tile" x="[\d.]+" y="[\d.]+" width="28" height="28" rx="7"\/>/);
  assert.match(orders, /<text class="pa-emoji" text-anchor="middle" x="[\d.]+" y="[\d.]+">📦<\/text>/);
  assert.ok(!orders.includes('pa-icon'), 'the emoji replaces the icon');
  assert.match(orders, /<text class="pa-type" text-anchor="middle"><tspan [^>]*>SERVICE<\/tspan><\/text>/);
  const gateway = nodeOf(svg, 'gateway');
  assert.match(gateway, /pa-kind-gateway pa-family-service/);
  assert.match(gateway, /<rect class="pa-tile"/);
  assert.match(gateway, /<g class="pa-icon pa-icon-lucide"/);
  assert.match(gateway, />GATEWAY<\/tspan>/);
  assert.match(gateway, /<text class="pa-note"[^>]*><tspan[^>]*>auth, rate limits<\/tspan>/);
  assert.ok(yOf(gateway, 'pa-type') < yOf(gateway, 'pa-label') && yOf(gateway, 'pa-label') < yOf(gateway, 'pa-note'), 'type, label, note from top to bottom');
  assert.match(nodeOf(svg, 'warehouse'), /pa-kind-external pa-family-external pa-tone-warn/);
  assert.match(nodeOf(svg, 'shopper'), /pa-kind-user pa-family-person/);
  assert.match(nodeOf(svg, 'db'), /pa-kind-database pa-family-data/);
  assert.match(nodeOf(svg, 'bus'), /pa-kind-queue pa-family-queue/);

  const flow = await draw(example('flow'));
  const begin = nodeOf(flow, 'begin');
  assert.match(begin, /pa-kind-start pa-family-bare/);
  assert.ok(!begin.includes('pa-tile') && !begin.includes('pa-type'), 'a pill carries no tile or type line');
  const known = nodeOf(flow, 'known');
  assert.match(known, /pa-kind-decision pa-family-decision/);
  assert.ok(!known.includes('pa-tile'));
  assert.match(nodeOf(flow, 'ask'), /pa-kind-io pa-family-service[\s\S]*<rect class="pa-tile"[\s\S]*>IO<\/tspan>/);

  const seq = await draw(example('sequence'));
  const shopper = nodeOf(seq, 'shopper');
  assert.match(shopper, /pa-kind-actor pa-family-person/);
  assert.match(shopper, /<rect class="pa-tile"[\s\S]*>ACTOR<\/tspan>/);
  const withEmoji = await draw({ ...example('sequence'), participants: example('sequence').participants.map((p) => (p.id === 'web' ? { ...p, emoji: '🌐' } : p)) });
  assert.match(nodeOf(withEmoji, 'web'), /<text class="pa-emoji"[^>]*>🌐<\/text>/);
});

test('an edge carries its from-node family and one path.pa-wire; an edge leaving a group has no family', async () => {
  const svg = await draw(example('story'));
  const edges = tagsOf(svg, /<g class="pa-edge [^>]*>/g);
  const byId = (id) => edges.find((e) => attr(e, 'data-id') === id);
  assert.equal(attr(byId('edge-0'), 'data-family'), 'person', 'shopper (user) -> app');
  assert.equal(attr(byId('place'), 'data-family'), 'service', 'app (client) -> gateway');
  assert.equal(attr(byId('edge-4'), 'data-family'), 'service', 'orders -> bus');
  assert.equal(attr(byId('edge-5'), 'data-family'), 'queue', 'bus -> warehouse');
  assert.equal(tagsOf(svg, /<g class="pa-edge [^>]*><path class="pa-wire" d="[^"]*" fill="none" marker-end=/g).length, 7, 'every edge: one wire');
  const fromGroup = await draw({ title: 't', type: 'architecture', groups: [{ id: 'g', label: 'G' }], nodes: [{ id: 'a', label: 'A', group: 'g' }, { id: 'b', label: 'B' }], edges: [{ from: 'g', to: 'b' }] });
  assert.equal(attr(tagsOf(fromGroup, /<g class="pa-edge [^>]*>/g)[0], 'data-family'), undefined);
  const seq = await draw(example('sequence'));
  assert.equal(attr(tagsOf(seq, /<g class="pa-edge [^>]*data-id="m1"[^>]*>/g)[0], 'data-family'), 'person');
  assert.equal(attr(tagsOf(seq, /<g class="pa-edge [^>]*data-id="m5"[^>]*>/g)[0], 'data-family'), 'external', 'psp replies');
});

test('diagramCss: family rules tint the card and colour the tile, icon, type line and outgoing wires; tones come after and win; heads follow the wire', () => {
  const css = diagramCss();
  for (const f of FAMILIES) {
    const plain = `.pa-family-${f} .pa-shape{fill:var(--surface);stroke:var(--k-${f})}`;
    const tint = `@supports (color: color-mix(in srgb, red, red)){`;
    assert.ok(css.includes(plain), f);
    assert.ok(css.includes(`.pa-family-${f} .pa-tile{fill:var(--surface)}`), `${f} plain tile`);
    assert.ok(css.indexOf(`.pa-family-${f} .pa-shape{fill:color-mix(in srgb,var(--k-${f}) 10%,var(--surface))}`) > css.indexOf(tint), `${f} tint is inside @supports`);
    assert.ok(css.indexOf(`.pa-family-${f} .pa-tile{fill:color-mix(in srgb,var(--k-${f}) `) > css.indexOf(plain), `${f} tile tint after the plain rules`);
    assert.ok(css.includes(`.pa-family-${f} .pa-icon{color:var(--k-${f})}`), `${f} icon`);
    assert.ok(css.includes(`.pa-family-${f} .pa-type{fill:var(--k-${f})}`), `${f} type line`);
    assert.ok(css.includes(`.pa-edge[data-family="${f}"] .pa-wire{stroke:var(--k-${f})}`), `${f} wire`);
  }
  assert.ok(css.includes('.pa-family-bare .pa-shape{fill:var(--surface);stroke:var(--line)}'));
  const after = (a, b) => assert.ok(css.indexOf(a) > css.lastIndexOf(b), `${a} comes after ${b}`);
  after('.pa-tone-warn .pa-shape{', '.pa-family-decision .pa-shape{');
  after('.pa-node .pa-shape-filled-dot{', '.pa-family-bare .pa-shape{');
  after('.pa-tone-good .pa-shape-filled-dot{', '.pa-node .pa-shape-filled-dot{');
  after('.pa-hl .pa-shape,', '.pa-tone-bad .pa-shape{');
  assert.ok(!/\.pa-tone-[a-z]+ \.pa-type\b/.test(css), 'a tone does not repaint the kind label: its colour is not gated against the card tint');
  assert.match(css, /\.pa-arrow-fill\{fill:var\(--text-3\);fill:context-stroke;stroke:none\}/);
  assert.match(css, /\.pa-arrow-open\{fill:none;stroke:var\(--text-3\);stroke:context-stroke;/);
  assert.ok(!/\.pa-edge[^{]* path\{/.test(css), 'no rule strokes a bare path inside an edge group');
  assert.ok(!/\.pa-arrow-fill\{fill:var\([^)]*\);stroke/.test(css) && !/\.pa-edge\.pa-[a-z]+ \.pa-arrow/.test(css), 'no dead marker rules: markers are not descendants of the edge');
  assert.match(css, /\.pa-wire\{fill:none;stroke:var\(--text-3\);stroke-width:1\.25;stroke-linejoin:round\}/);
  assert.match(css, /\.pa-edge\.pa-active \.pa-wire\{stroke:var\(--accent\);stroke-width:3\}/);
  assert.match(css, /\.pa-emoji\{font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif;font-size:18px\}/);
  assert.match(css, /\.pa-note\{fill:var\(--text-2\);font-family:var\(--mono\);font-size:11px;font-weight:400\}/);
  assert.match(css, /\.pa-seq-note-text\{fill:var\(--text-2\);font-family:var\(--mono\);font-size:11px;font-weight:400\}/, 'sequence notes are measured with f.note too');
  assert.match(css, /\.pa-type\{font-size:10px;font-weight:600;letter-spacing:\.08em;text-transform:uppercase\}/);
  assert.match(css, /\.pa-tile\{stroke:none\}/);
  assert.match(css, /\.pa-dim\{opacity:\.25\}/);
});

test('groups: a top-level group is a lane with a numbered bar and a spaced-caps label kept in its source case; nested groups have no bar', async () => {
  const svg = await draw(example('architecture'));
  const aws = tagsOf(svg, /<g class="pa-group" data-id="aws"[^>]*>.*?<\/g>/g)[0];
  assert.match(aws, /^<g class="pa-group" data-id="aws" data-depth="0" data-lane="0">/);
  assert.match(aws, /<rect class="pa-group-box" [^>]*rx="6"\/><rect class="pa-lane" x="[\d.]+" y="[\d.]+" width="4" height="[\d.]+" rx="2"\/>/);
  assert.match(aws, /<text class="pa-group-label" text-anchor="start"><tspan [^>]*>AWS us-east-1<\/tspan>/, 'source case; CSS sets the capitals');
  const vpc = tagsOf(svg, /<g class="pa-group" data-id="vpc"[^>]*>.*?<\/g>/g)[0];
  assert.match(vpc, /^<g class="pa-group" data-id="vpc" data-depth="1">/);
  assert.ok(!vpc.includes('pa-lane'));
  const many = { title: 't', type: 'flow', direction: 'down', groups: Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, label: `Lane ${i}` })), nodes: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: `N${i}`, group: `g${i}` })), edges: Array.from({ length: 8 }, (_, i) => ({ from: `n${i}`, to: `n${i + 1}` })) };
  const lanes = tagsOf(await draw(many), /<g class="pa-group" [^>]*>/g).map((t) => attr(t, 'data-lane'));
  assert.deepEqual(lanes.sort(), ['0', '0', '1', '2', '3', '4', '5', '6', '7'], 'the ninth lane reuses the first colour');
});

test('pills: an edge label plate is fully rounded; the group label is measured in capitals with tracking', async () => {
  const svg = await draw(example('story'));
  const plate = tagsOf(svg, /<rect class="pa-edge-plate" [^>]*>/g)[0];
  assert.equal(attr(plate, 'rx'), String(Number(attr(plate, 'height')) / 2));
  const f = fonts(theme);
  const min = groupMinSize({ id: 'g', label: 'core services' }, theme);
  assert.ok(min.width >= trackedWidth('core services', f.group, GROUP_TRACK) + 2 * GROUP_LABEL_INSET - 2, `${min.width}`);
  assert.equal(f.group.size, 11);
});

test('diagramCss: lane, pill and legend rules', () => {
  const css = diagramCss();
  for (let i = 0; i < 8; i++) assert.ok(css.includes(`.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`), `lane ${i}`);
  assert.match(css, /\.pa-lane\{stroke:none\}/);
  assert.match(css, /\.pa-group-box\{fill:var\(--surface\);stroke:var\(--line\);stroke-width:1\}\n@supports \(color: color-mix\(in srgb, red, red\)\)\{\.pa-group-box\{fill:color-mix\(in srgb,var\(--text-3\) 7%,transparent\)\}\}/);
  assert.match(css, /\.pa-group-label\{fill:var\(--text-2\);font-size:11px;font-weight:600;letter-spacing:\.08em;text-transform:uppercase\}/);
  assert.match(css, /\.pa-edge-plate\{fill:var\(--surface\);stroke:var\(--line\);stroke-width:1\}/);
  assert.match(css, /\.pa-frame-kind\{fill:var\(--text-2\);font-size:11px;font-weight:600\}/, 'the frame tab word is measured with f.group: plain, no tracking');
  assert.match(css, /\.pa-legend-text\{fill:var\(--text-2\);font-size:11px\}/);
  assert.match(css, /\.pa-swatch\{stroke-width:1\}/);
  for (const f of FAMILIES) {
    assert.ok(css.includes(`.pa-swatch.pa-family-${f}{fill:var(--surface);stroke:var(--k-${f})}`), f);
    assert.ok(css.includes(`.pa-swatch.pa-family-${f}{fill:color-mix(in srgb,var(--k-${f}) 10%,var(--surface))}`), `${f} tint`);
  }
  assert.match(css, /\.pa-swatch\.pa-family-bare\{fill:var\(--surface\);stroke:var\(--line\)\}/);
  assert.match(css, /\.pa-legend-sample \.pa-wire\{stroke-width:1\.5\}/);
});

test('diagramCss: flow animation rules only reach real edges, never the legend samples', () => {
  const css = diagramCss();
  const animated = css.split('\n').filter((l) => /^\.pa-animate .*\{(animation:pa-flow|stroke-dasharray)/.test(l));
  assert.equal(animated.length, 2);
  for (const l of animated) assert.match(l, /^\.pa-animate \.pa-edge[. ][^{]*\.pa-wire\{/, l);
  assert.ok(!/\.pa-animate \.pa-wire/.test(css));
});

test('diagramCss: the dark block glows the active edge and the dot in both selector forms; light stays thick and matte', () => {
  const css = diagramCss();
  const media = css.match(/@media \(prefers-color-scheme: dark\)\{([^]*?)\}\n/)[1];
  for (const form of [media, css.slice(css.indexOf(':root[data-theme="dark"]'))]) {
    assert.match(form, /\.pa-edge\.pa-active \.pa-wire\{stroke-width:2\.5;filter:drop-shadow\(0 0 6px var\(--glow\)\)\}/);
    assert.match(form, /\.pa-dot\{fill:var\(--glow\);filter:drop-shadow\(0 0 6px var\(--glow\)\)\}/);
  }
  assert.match(media, /^:root:not\(\[data-theme="light"\]\) \.pa-edge/);
  assert.ok(!/drop-shadow/.test(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)'))), 'no glow outside the dark block');
  assert.ok(css.indexOf('@media (prefers-reduced-motion') < css.indexOf('@media (prefers-color-scheme: dark)'), 'the motion guard comes first');
});
