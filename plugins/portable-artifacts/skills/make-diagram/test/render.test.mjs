import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layoutDiagram } from '../scripts/lib/layout.mjs';
import { renderSvg, diagramCss } from '../scripts/lib/render.mjs';
import { anchorEdges } from '../scripts/lib/edges.mjs';
import { shapeParts, pathD } from '../scripts/lib/shapes.mjs';
import { ICON_DRAW } from '../scripts/lib/svg.mjs';
import { CYLINDER_CAP } from '../scripts/lib/sizes.mjs';
import { loadTheme } from '../shared/theme.mjs';

const theme = loadTheme('paper');
const NAMES = ['architecture', 'flow', 'state', 'sequence'];
const here = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const example = (name) => JSON.parse(fs.readFileSync(here(`../references/examples/${name}.diagram.json`), 'utf8'));
const draw = async (spec, opts = {}) => {
  const geometry = await layoutDiagram(spec, theme);
  return { geometry, svg: renderSvg(geometry, spec, { theme, ...opts }) };
};
const ids = (svg) => [...svg.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
const attr = (tag, name) => tag.match(new RegExp(` ${name}="([^"]*)"`))?.[1];
const tagsOf = (svg, re) => [...svg.matchAll(re)].map((m) => m[0]);

// A tiny path-data reader: the end point of every command (M, L, Q, A, H, V).
function pathPoints(d) {
  const pts = [];
  let cur = { x: 0, y: 0 };
  for (const [, cmd, args] of d.matchAll(/([MLQAHVZ])([^MLQAHVZ]*)/g)) {
    const n = args.trim() === '' ? [] : args.trim().split(/[\s,]+/).map(Number);
    if (cmd === 'H') cur = { x: n[0], y: cur.y };
    else if (cmd === 'V') cur = { x: cur.x, y: n[0] };
    else if (cmd === 'A') cur = { x: n[5], y: n[6] };
    else if (cmd === 'Q') cur = { x: n[2], y: n[3] };
    else if (cmd !== 'Z') cur = { x: n[0], y: n[1] };
    if (cmd !== 'Z') pts.push(cur);
  }
  return pts;
}

// ---- goldens ----------------------------------------------------------------

for (const name of NAMES) {
  test(`${name} example: SVG matches the golden file`, async () => {
    const { svg } = await draw(example(name));
    const file = here(`./golden/${name}.svg`);
    if (process.env.PA_WRITE_GOLDEN === '1') {
      fs.mkdirSync(here('./golden'), { recursive: true });
      fs.writeFileSync(file, `${svg}\n`);
    }
    assert.equal(`${svg}\n`, fs.readFileSync(file, 'utf8'));
  });

  test(`${name} example: two renders are byte-identical and carry no timestamp`, async () => {
    const a = (await draw(example(name))).svg;
    assert.equal(a, (await draw(example(name))).svg);
    assert.ok(!/20\d\d-\d\d-\d\d|Date|timestamp/i.test(a));
  });
}

// ---- structure --------------------------------------------------------------

test('the root is one accessible <svg> with title, description and the canvas viewBox', async () => {
  for (const name of NAMES) {
    const spec = example(name);
    const { svg, geometry } = await draw(spec);
    assert.equal(svg.match(/<svg /g).length, 1);
    const root = svg.match(/^<svg [^>]*>/)[0];
    assert.equal(attr(root, 'viewBox'), `0 0 ${geometry.width} ${geometry.height}`);
    assert.equal(attr(root, 'role'), 'img');
    const [t, d] = attr(root, 'aria-labelledby').split(' ');
    assert.ok(svg.includes(`<title id="${t}">${spec.title}</title>`), name);
    assert.match(svg, new RegExp(`<desc id="${d}">[^<]+</desc>`));
    assert.ok(svg.endsWith('</svg>'));
  }
});

test('every url(#...) reference has a target, and idPrefix namespaces the ids', async () => {
  for (const name of NAMES) {
    for (const idPrefix of [undefined, 'chart-2']) {
      const { svg } = await draw(example(name), idPrefix ? { idPrefix } : {});
      const defined = new Set(ids(svg));
      const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
      assert.ok(refs.length > 0, name);
      for (const r of refs) assert.ok(defined.has(r), `${name}: ${r} is defined`);
      const expected = idPrefix ?? 'd';
      assert.ok([...defined].every((id) => id.startsWith(`${expected}-`)), `${name}: ids are prefixed ${expected}-`);
    }
  }
});

test('every node is a focusable group with classes, data-id and an accessible name', async () => {
  for (const name of ['architecture', 'flow', 'state']) {
    const spec = example(name);
    const { svg } = await draw(spec);
    const opens = tagsOf(svg, /<g class="pa-node [^>]*>/g);
    assert.equal(opens.length, spec.nodes.length, name);
    spec.nodes.forEach((n, i) => {
      const tag = opens[i];
      assert.match(attr(tag, 'class'), new RegExp(`^pa-node pa-kind-${n.kind ?? (spec.type === 'flow' ? 'step' : spec.type === 'state' ? 'state' : 'service')} pa-tone-${n.tone ?? 'neutral'}$`), `${name}.${n.id}`);
      assert.equal(attr(tag, 'data-id'), n.id);
      assert.equal(attr(tag, 'tabindex'), '0');
      assert.equal(attr(tag, 'aria-label'), `${n.label}: ${n.kind ?? (spec.type === 'flow' ? 'step' : spec.type === 'state' ? 'state' : 'service')}`);
    });
  }
});

test('every edge is a group with style class and data-id/from/to', async () => {
  const spec = example('architecture');
  const { svg } = await draw(spec);
  const edges = tagsOf(svg, /<g class="pa-edge [^>]*>/g);
  assert.equal(edges.length, spec.edges.length);
  spec.edges.forEach((e, i) => {
    assert.equal(attr(edges[i], 'class'), `pa-edge pa-edge-${e.style ?? 'solid'}`);
    assert.equal(attr(edges[i], 'data-id'), `e${i}`);
    assert.equal(attr(edges[i], 'data-from'), e.from);
    assert.equal(attr(edges[i], 'data-to'), e.to);
  });
});

test('z-order: groups, then edges, then nodes, then edge labels', async () => {
  const { svg } = await draw(example('architecture'));
  const at = (s) => svg.indexOf(s);
  assert.ok(at('class="pa-group"') < at('class="pa-edge ') && at('class="pa-edge ') < at('class="pa-node ') && at('class="pa-node ') < at('class="pa-edge-label"'));
  assert.ok(svg.lastIndexOf('class="pa-edge ') < at('class="pa-node '), 'all edges are under all nodes');
  assert.ok(at('data-depth="0"') < at('data-depth="1"'), 'outer groups first');
});

test('both: true draws arrow heads at both ends; async edges use the open head', async () => {
  const { svg } = await draw(example('architecture'));
  const both = tagsOf(svg, /<g class="pa-edge[^>]*data-to="vpc"[^>]*>.*?<\/g>/g)[0];
  assert.match(both, /marker-start="url\(#d-arrow\)"/);
  assert.match(both, /marker-end="url\(#d-arrow\)"/);
  const asyncEdge = tagsOf(svg, /<g class="pa-edge pa-edge-async[^>]*>.*?<\/g>/g)[0];
  assert.match(asyncEdge, /marker-end="url\(#d-arrow-open\)"/);
  assert.ok(!/marker-start/.test(asyncEdge));
});

// ---- the drawn geometry -------------------------------------------------------

test('an edge path ends where the anchored route ends, on the drawn outline', async () => {
  const spec = example('flow');
  const { svg, geometry } = await draw(spec);
  const anchored = anchorEdges(geometry);
  const paths = tagsOf(svg, /<g class="pa-edge [^>]*><path d="[^"]*"/g).map((t) => t.match(/ d="([^"]*)"/)[1]);
  assert.equal(paths.length, anchored.edges.length);
  paths.forEach((d, i) => {
    const pts = pathPoints(d);
    assert.deepEqual(pts[0], anchored.edges[i].points[0]);
    assert.deepEqual(pts.at(-1), anchored.edges[i].points.at(-1));
  });
  assert.ok(anchored.edges.some((e, i) => JSON.stringify(e.points) !== JSON.stringify(geometry.edges[i].points)), 'the example has ends that moved');
});

test('node outlines are the shared shape primitives', async () => {
  const { svg, geometry } = await draw(example('flow'));
  const diamond = geometry.nodes.find((n) => n.shape === 'diamond');
  const d = pathD(shapeParts('diamond', diamond).outline);
  assert.ok(svg.includes(`<path class="pa-shape pa-shape-diamond" d="${d}"/>`));
  for (const shape of new Set(geometry.nodes.map((n) => n.shape))) assert.ok(svg.includes(`pa-shape-${shape}"`), shape);
});

test('icons are drawn 18 px wide and a two-line label has two lines', async () => {
  const { svg } = await draw(example('architecture'));
  assert.ok(svg.includes(`scale(${ICON_DRAW / 24})`));
  assert.equal(tagsOf(svg, /<g class="pa-icon /g).length, 4, 'client, service (brand), database (brand), external');
  const long = { title: 't', type: 'flow', nodes: [{ id: 'a', label: 'Authentication and authorization gateway service' }] };
  const { svg: two } = await draw(long);
  const label = two.match(/<text class="pa-label"[^>]*>(.*?)<\/text>/)[1];
  assert.equal(label.match(/<tspan /g).length, 2);
});

test('a dot label is drawn in its reserved box', async () => {
  const { svg, geometry } = await draw(example('state'));
  const begin = geometry.nodes.find((n) => n.id === 'begin');
  const x = begin.labelBox.x + begin.labelBox.width / 2;
  assert.ok(svg.includes(`<text class="pa-label" text-anchor="middle"><tspan x="${Math.round(x * 100) / 100}"`), 'centred under the dot');
});

test('a single node with no edges renders', async () => {
  const { svg } = await draw({ title: 'one', type: 'architecture', nodes: [{ id: 'solo', label: 'Solo' }] });
  assert.match(svg, /data-id="solo"/);
  assert.ok(!/NaN|Infinity|undefined/.test(svg));
});

// ---- sequence ------------------------------------------------------------------

test('sequence: paint order puts label plates above lifelines, and the frame label sits at its box without brackets', async () => {
  const spec = example('sequence');
  const { svg, geometry } = await draw(spec);
  assert.ok(svg.lastIndexOf('class="pa-lifeline"') < svg.indexOf('class="pa-edge-label"'), 'plates after lifelines');
  assert.ok(svg.lastIndexOf('class="pa-lifeline"') < svg.indexOf('class="pa-seq-note"'), 'notes after lifelines');
  assert.ok(svg.indexOf('class="pa-frame ') < svg.indexOf('class="pa-lifeline"'), 'frames behind lifelines');
  for (const fr of geometry.frames) {
    assert.ok(svg.includes(`<text class="pa-frame-label" text-anchor="start"><tspan x="${fr.labelBox.x}"`), fr.label);
    assert.ok(svg.includes(`<text class="pa-frame-kind"`) && svg.includes(`>${fr.kind}</tspan>`));
    assert.ok(!svg.includes(`[${fr.label}]`) && !svg.includes(`>[`));
  }
});

test('sequence: every header has the uniform height, a cylinder included, with its icon', async () => {
  const spec = example('sequence');
  const { svg, geometry } = await draw(spec);
  const heights = new Set(geometry.participants.map((p) => p.height));
  assert.equal(heights.size, 1);
  const [h] = heights;
  const y = geometry.participants[0].y;
  const cyl = geometry.participants.find((p) => p.shape === 'cylinder');
  const d = svg.match(/<path class="pa-shape pa-shape-cylinder" d="([^"]*)"/)[1];
  const ys = pathPoints(d).map((p) => p.y);
  // the outline's arcs end CYLINDER_CAP inside the top and bottom of the box
  assert.equal(Math.max(...ys) - Math.min(...ys) + 2 * CYLINDER_CAP, h, 'the cylinder is drawn at the header height');
  assert.equal(Math.min(...ys), y + CYLINDER_CAP);
  assert.equal(cyl.height, h);
  const opens = tagsOf(svg, /<g class="pa-node [^>]*>/g);
  assert.equal(opens.length, spec.participants.length);
  assert.equal(tagsOf(svg, /<g class="pa-icon /g).length, spec.participants.length, 'every participant draws its icon');
  assert.equal(attr(opens[0], 'aria-label'), 'Shopper: actor');
});

test('sequence: messages carry kind classes, endpoints and open/filled heads', async () => {
  const { svg } = await draw(example('sequence'));
  const m = (id) => tagsOf(svg, new RegExp(`<g class="pa-edge[^>]*data-id="${id}"[^>]*>.*?</g>`, 'g'))[0];
  assert.match(m('m2'), /pa-edge-solid pa-msg-sync/);
  assert.match(m('m4'), /pa-edge-async pa-msg-async/);
  assert.match(m('m5'), /pa-edge-dashed pa-msg-reply/);
  assert.match(m('m5'), /url\(#d-arrow-open\)/);
  assert.match(m('m6'), /pa-msg-self/);
  assert.equal(attr(m('m3'), 'data-from'), 'orders');
  assert.equal(attr(m('m3'), 'data-to'), 'db');
});

// ---- escaping (Review Focus 1) --------------------------------------------------

const EVIL = '<b>&"x"';
const EVIL_ESCAPED = '&lt;b&gt;&amp;&quot;x&quot;';
const ALLOWED_TAGS = new Set(['svg', 'title', 'desc', 'defs', 'marker', 'path', 'g', 'rect', 'text', 'tspan', 'line']);

function assertNoMarkupFromText(svg, name) {
  const tags = new Set([...svg.matchAll(/<\/?([a-zA-Z][\w-]*)/g)].map((m) => m[1]));
  for (const t of tags) assert.ok(ALLOWED_TAGS.has(t), `${name}: unexpected <${t}> element`);
  assert.ok(!svg.includes('<b>') && !svg.includes('<script'), name);
  // every attribute value is closed inside its tag: no raw quote leaks out of one
  for (const tag of svg.match(/<[^>]*>/g)) assert.equal(tag.split('"').length % 2, 1, `${name}: unbalanced quotes in ${tag.slice(0, 80)}`);
}

test('labels with <, & and " render as text in every position, never as markup', async () => {
  const graph = {
    title: EVIL, subtitle: EVIL, type: 'architecture',
    groups: [{ id: 'g', label: EVIL }],
    nodes: [{ id: 'a', label: EVIL, note: EVIL, group: 'g' }, { id: 'b', label: EVIL }],
    edges: [{ from: 'a', to: 'b', label: EVIL }],
  };
  const { svg } = await draw(graph);
  assertNoMarkupFromText(svg, 'graph');
  assert.ok(svg.includes(`<title id="d-title">${EVIL_ESCAPED}</title>`));
  assert.ok(svg.includes(`aria-label="${EVIL_ESCAPED}: service"`));
  assert.ok((svg.match(new RegExp(EVIL_ESCAPED.replace(/[&;]/g, '\\$&'), 'g')) ?? []).length >= 8, 'title, subtitle, group, 2 labels, note, edge label, aria-label');

  const seq = {
    title: EVIL, type: 'sequence',
    participants: [{ id: 'a', label: EVIL }, { id: 'b', label: EVIL }],
    messages: [{ id: 'm1', from: 'a', to: 'b', label: EVIL }],
    frames: [{ kind: 'loop', label: EVIL, messages: ['m1'] }],
    notes: [{ over: ['a'], text: EVIL }],
  };
  const { svg: s2 } = await draw(seq);
  assertNoMarkupFromText(s2, 'sequence');
  assert.ok(s2.includes(`>${EVIL_ESCAPED}</tspan>`));
});

test('ids and idPrefix cannot break out of an attribute; control characters are dropped', async () => {
  const spec = { title: 'x\u0001y', type: 'architecture', nodes: [{ id: 'a', label: 'A\u0007' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] };
  const geometry = await layoutDiagram(spec, theme);
  geometry.nodes[0].id = '"><script>alert(1)</script>';
  geometry.edges[0].from = geometry.nodes[0].id;
  geometry.edges[0].id = 'e"onload="x';
  const svg = renderSvg(geometry, { ...spec, nodes: [{ ...spec.nodes[0], id: geometry.nodes[0].id }, spec.nodes[1]] }, { theme, idPrefix: 'p"><x' });
  assert.ok(!svg.includes('<script') && !svg.includes('<x'));
  assert.ok(svg.includes('data-id="&quot;&gt;&lt;script&gt;'));
  assert.ok(svg.includes('id="p&quot;&gt;&lt;x-title"'));
  assert.ok(!/[\u0000-\u0008]/.test(svg));
  assert.ok(svg.includes('<title id="p&quot;&gt;&lt;x-title">xy</title>'));
});

// ---- CSS ------------------------------------------------------------------------

test('diagramCss uses theme variables only and animates inside the reduced-motion guard', () => {
  const css = diagramCss();
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(/.test(css), 'no literal colours');
  assert.ok(!/gradient|shadow|blur|filter|drop-shadow/.test(css));
  for (const v of ['--page', '--surface', '--text', '--text-2', '--text-3', '--line', '--accent', '--warn', '--good', '--bad', '--font']) assert.ok(css.includes(`var(${v})`), v);
  const media = css.slice(css.indexOf('@media'));
  assert.match(media, /^@media \(prefers-reduced-motion: no-preference\)\{[^]*\.pa-animate \.pa-edge path[^]*@keyframes pa-flow[^]*\}$/);
  assert.ok(!css.slice(0, css.indexOf('@media')).includes('animation'));
});

test('every non-dynamic class the renderers emit has a rule', async () => {
  const css = diagramCss();
  const dynamic = /^pa-(kind|tone|shape|edge-(solid|dashed|async)|msg|frame-(loop|alt|opt|par)|type|animate)/;
  const hooks = new Set(['pa-edge', 'pa-edge-label', 'pa-group', 'pa-frame', 'pa-seq-note']); // structure for the viewer, nothing to style
  for (const name of NAMES) {
    const { svg } = await draw(example(name));
    for (const cls of new Set([...svg.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(' ')))) {
      if (dynamic.test(cls) || hooks.has(cls)) continue;
      assert.ok(css.includes(`.${cls}`), `${name}: .${cls} has a rule`);
    }
  }
  for (const tone of ['accent', 'good', 'warn', 'bad']) assert.ok(css.includes(`.pa-tone-${tone} .pa-shape{stroke:var(--${tone});stroke-width:1.5}`));
  for (const shape of ['stadium', 'diamond', 'cylinder']) assert.ok(css.includes('.pa-shape{'), shape);
});

test('the SVG carries no literal colours, styles, gradients or filters', async () => {
  for (const name of NAMES) {
    const { svg } = await draw(example(name));
    assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(|style=|<style|gradient|filter|<image|<foreignObject|href=/.test(svg), name);
  }
});

test('renderSvg needs a theme', async () => {
  const spec = example('flow');
  const geometry = await layoutDiagram(spec, theme);
  assert.throws(() => renderSvg(geometry, spec), /needs \{ theme \}/);
});
