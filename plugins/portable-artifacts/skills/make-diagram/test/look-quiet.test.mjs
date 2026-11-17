// The quiet canvas, round 4: one edge-label style in dark, cards that stand off their group in every theme, toned
// lane bars, each theme's kind palette visible on the tile, flow's start and end keyed as the pills they are, and no
// unexplained status colour in the shipped examples. Colours are computed from the theme tokens the CSS mixes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { diagramCss } from '../scripts/lib/render.mjs';
import { FAMILIES } from '../scripts/lib/kinds.mjs';
import { buildPage, example } from './helpers/browser.mjs';
import { loadTheme, listThemes } from '../shared/theme.mjs';
import { contrastRatio, mixHex } from '../shared/contrast.mjs';

const css = diagramCss();
const KIND_TOKEN = { person: 'kindPerson', service: 'kindService', data: 'kindData', queue: 'kindQueue', external: 'kindExternal', decision: 'kindDecision' };
const pct = (re) => { const m = css.match(re); assert.ok(m, `rule ${re} present`); return Number(m[1]) / 100; };
const modes = () => listThemes().flatMap((name) => ['light', 'dark'].map((mode) => ({ name, mode, c: loadTheme(name)[mode] })));

const MIN_PILL = 1.25; // a dark plate stands off the page and the group box it may sit on
const MIN_CARD_STEP = 1.07; // a card stands off the group box around it
const MIN_ICON = 3; // the kind icon (a graphic) on its tile

test('dark edge labels: one plate, a mix of --text-3 into the surface, a pill on the page and on a group box alike', () => {
  const share = pct(/:root\[data-theme="dark"\] \.pa-edge-plate\{fill:color-mix\(in srgb,var\(--text-3\) (\d+)%,var\(--surface\)\)\}/);
  assert.match(css, /prefers-color-scheme: dark[^\n]*:root:not\(\[data-theme="light"\]\) \.pa-edge-plate\{fill:color-mix/, 'the OS-dark form too');
  const group = pct(/:root\[data-theme="dark"\] \.pa-group-box\{fill:color-mix\(in srgb,var\(--text-3\) (\d+)%,transparent\)\}/);
  for (const { name, c } of modes().filter((m) => m.mode === 'dark')) {
    const plate = mixHex(c.text3, c.surface, share);
    const box = mixHex(c.text3, c.page, group);
    const nested = mixHex(c.text3, box, group); // a group inside a group: the translucent fills stack
    assert.ok(contrastRatio(plate, c.page) >= MIN_PILL, `${name}: plate on the page ${contrastRatio(plate, c.page).toFixed(2)}`);
    assert.ok(contrastRatio(plate, box) >= MIN_PILL, `${name}: plate on a group ${contrastRatio(plate, box).toFixed(2)}`);
    assert.ok(contrastRatio(plate, nested) >= MIN_PILL, `${name}: plate on a nested group ${contrastRatio(plate, nested).toFixed(2)}`);
    assert.ok(contrastRatio(c.text2, plate) >= 4.5, `${name}: label text on the plate ${contrastRatio(c.text2, plate).toFixed(2)}`);
  }
});

test('a card stands off its group box in every theme and mode (press light was beige on beige)', () => {
  const light = pct(/@supports[^\n]*\.pa-group-box\{fill:color-mix\(in srgb,var\(--text-3\) (\d+)%,var\(--surface\)\)\}/);
  const dark = pct(/:root\[data-theme="dark"\] \.pa-group-box\{fill:color-mix\(in srgb,var\(--text-3\) (\d+)%,transparent\)\}/);
  for (const { name, mode, c } of modes()) {
    const box = mode === 'light' ? mixHex(c.text3, c.surface, light) : mixHex(c.text3, c.page, dark);
    const r = contrastRatio(c.surface, box);
    assert.ok(r >= MIN_CARD_STEP, `${name} ${mode}: card ${c.surface} on group ${box} is ${r.toFixed(3)}:1`);
  }
});

test('lane bars are toned: the series colour mixed at most half into the surface, a plain rule first', () => {
  for (let i = 0; i < 8; i++) {
    assert.ok(css.includes(`.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`), `plain lane ${i}`);
    const share = pct(new RegExp(`\\.pa-group\\[data-lane="${i}"\\] \\.pa-lane\\{fill:color-mix\\(in srgb,var\\(--s${i + 1}\\) (\\d+)%,var\\(--surface\\)\\)\\}`));
    assert.ok(share <= 0.5, `lane ${i} at ${share}`);
    assert.ok(css.indexOf(`.pa-lane{fill:color-mix(in srgb,var(--s${i + 1})`) > css.indexOf(`.pa-group[data-lane="${i}"] .pa-lane{fill:var(--s${i + 1})}`), 'mix after the plain rule');
  }
});

test("each theme's kind palette shows on the tile: a stronger tint, the icon still 3:1 on it", () => {
  const share = pct(/\.pa-family-service \.pa-tile\{fill:color-mix\(in srgb,var\(--k-service\) (\d+)%,var\(--surface\)\)\}/);
  assert.ok(share >= 0.25, `tile tint ${share}`);
  for (const { name, mode, c } of modes()) {
    for (const f of FAMILIES.filter((x) => KIND_TOKEN[x])) {
      const hue = c[KIND_TOKEN[f]];
      const r = contrastRatio(hue, mixHex(hue, c.surface, share));
      assert.ok(r >= MIN_ICON, `${name} ${mode} ${f}: icon on tile ${r.toFixed(2)}:1`);
    }
  }
});

test("flow's start and end are keyed as pills, the shape of their nodes, with a visible outline", () => {
  const { html } = buildPage(example('flow'), { name: 'quiet-flow-legend' });
  const svg = html.match(/<g class="pa-legend" aria-hidden="true">[\s\S]*?<\/g>(?=<\/svg>|<g class="pa-(?!legend))/)?.[0] ?? html;
  const pills = [...svg.matchAll(/<rect class="pa-swatch pa-swatch-stadium[^"]*" [^>]*>/g)].map((m) => m[0]);
  assert.equal(pills.length, 2, 'start and end');
  for (const p of pills) {
    const h = Number(p.match(/ height="([\d.]+)"/)[1]);
    assert.ok(Number(p.match(/ width="([\d.]+)"/)[1]) > h, 'wider than tall');
    assert.equal(Number(p.match(/ rx="([\d.]+)"/)[1]), h / 2, 'fully rounded');
  }
  assert.match(css, /\.pa-swatch-stadium\{stroke:var\(--text-3\)\}/);
  const legendCss = html.match(/<style id="pa-legend-css">([\s\S]*?)<\/style>/)[1];
  assert.match(legendCss, /\.lg-shape-stadium\{[^}]*border-radius:999px[^}]*border-color:var\(--text-3\)/, 'the overlay swatch is a pill too');
});

test('no shipped example colours a node with a status tone the legend does not key', () => {
  const dir = fileURLToPath(new URL('../references/examples/', import.meta.url));
  const toned = fs.readdirSync(dir).filter((f) => f.endsWith('.diagram.json')).flatMap((f) => {
    const spec = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    return [...(spec.nodes ?? []), ...(spec.participants ?? [])].filter((n) => n.tone && n.tone !== 'neutral').map((n) => `${f} ${n.id} (${n.tone})`);
  });
  assert.deepEqual(toned, []);
});
