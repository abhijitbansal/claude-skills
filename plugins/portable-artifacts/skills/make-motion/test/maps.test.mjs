// Task 22: bundled world and US atlases (a chart's `data: { "name": "world-110m" }`) and the two map blocks built on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATLASES, ATLAS_NAMES, atlasUrl, atlasesIn, withAtlases, themeColours, bundledMaps } from '../template/maps.mjs';
import { WORLD_NAMES, US_NAMES, MAP_NAMES } from '../template/map-names.mjs';
import { readAtlas } from '../scripts/lib/atlas-files.mjs';
import { BLOCKS, BLOCK_NAMES, expandBlocks } from '../template/blocks/index.mjs';
import { flattenElements } from '../template/groups.mjs';
import { validateSpec, loadSpec } from '../scripts/lib/spec.mjs';
import { startServer } from '../scripts/lib/server.mjs';
import { launchBrowser, guardNetwork } from '../scripts/lib/browser.mjs';
import { requireRender, BROWSER_ONLY, assertRendersIdentically } from './helpers/render.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORLD_MAP = path.join(root, 'references/examples/world-map.json');
const HIGHLIGHT = path.join(root, 'references/examples/blocks/map-highlight.json');
const FLOW = path.join(root, 'references/examples/blocks/flow-map.json');
const CHECK = path.join(root, 'scripts/check.mjs');
const SMALL = ['--fps', '10', '--size', '320x180'];
const PLAN_ATLASES = {
  'world-110m': { pkg: 'world-atlas', file: 'countries-110m.json', feature: 'countries' },
  'world-50m': { pkg: 'world-atlas', file: 'countries-50m.json', feature: 'countries' },
  'us-states-10m': { pkg: 'us-atlas', file: 'states-10m.json', feature: 'states' },
  'us-counties-10m': { pkg: 'us-atlas', file: 'counties-10m.json', feature: 'counties' },
};
const one = (vegaLite, extra = {}) => ({ size: [320, 180], background: '#000000', scenes: [{ id: 's', duration: 2, elements: [{ id: 'm', type: 'chart', x: 160, y: 90, width: 300, height: 150, vegaLite, ...extra }] }] });
const errs = (motion) => validateSpec(motion, { dir: root }).errors.map((e) => `${e.path}: ${e.message}`);
const geo = (data, extra = {}) => ({ data, projection: { type: 'equalEarth' }, mark: { type: 'geoshape', fill: '#335', stroke: '#99a' }, ...extra });
const block = (name, params, extra = {}) => ({ id: 'b', type: 'block', x: 960, y: 540, block: name, params, ...extra });
const oneScene = (elements, extra = {}, duration = 6) => ({ ...extra, scenes: [{ id: 's', duration, elements }] });
const partsOf = (spec) => flattenElements(spec.scenes[0].elements).map(({ el }) => el).filter((el) => el.type !== 'group');

// ---- the table ------------------------------------------------------------------------------------------------------------

test('ATLASES is the four named datasets, each a package file and the feature to draw; atlasUrl is the vendor path', () => {
  assert.deepEqual(ATLASES, PLAN_ATLASES);
  assert.deepEqual(ATLAS_NAMES, ['world-110m', 'world-50m', 'us-states-10m', 'us-counties-10m']);
  assert.equal(atlasUrl('world-110m'), '/vendor/world-atlas/countries-110m.json');
  assert.equal(atlasUrl('us-counties-10m'), '/vendor/us-atlas/counties-10m.json');
  assert.throws(() => atlasUrl('mars'), /unknown atlas "mars"/);
  assert.throws(() => atlasUrl('constructor'), /unknown atlas "constructor"/, 'a name is a table key only');
  assert.ok(Object.isFrozen(ATLASES));
});

test('every atlas file exists in the pinned packages and holds the feature the table names', () => {
  for (const name of ATLAS_NAMES) {
    const topology = readAtlas(name);
    assert.equal(topology.type, 'Topology', name);
    assert.ok(topology.objects[ATLASES[name].feature], `${name} has objects.${ATLASES[name].feature}`);
  }
});

test('the name lists the blocks offer are the atlases\' own names (a version bump that moves one fails here)', () => {
  const world = readAtlas('world-110m').objects.countries.geometries.map((g) => g.properties.name);
  assert.deepEqual([...WORLD_NAMES].sort(), [...world].sort());
  const states = readAtlas('us-states-10m').objects.states.geometries.map((g) => g.properties.name);
  assert.deepEqual([...US_NAMES].sort(), states.filter((n) => !['American Samoa', 'Guam', 'Commonwealth of the Northern Mariana Islands', 'Puerto Rico', 'United States Virgin Islands'].includes(n)).sort());
  assert.equal(new Set(MAP_NAMES).size, MAP_NAMES.length, 'the combined list has no repeats');
  assert.deepEqual(MAP_NAMES.slice(0, WORLD_NAMES.length), [...WORLD_NAMES], 'world names first');
  assert.ok(MAP_NAMES.slice(-20).every((n) => US_NAMES.includes(n)), 'the last twenty are US states (the block table\'s "last" params)');
});

// ---- the data substitution --------------------------------------------------------------------------------------------------

test('atlasesIn lists the atlas names a spec uses, at the top and in any layer, once; a datasets entry of the same name wins', () => {
  assert.deepEqual(atlasesIn(geo({ name: 'world-110m' })), ['world-110m']);
  assert.deepEqual(atlasesIn({ layer: [geo({ name: 'world-110m' }), geo({ name: 'us-states-10m' }), geo({ name: 'world-110m' })] }), ['world-110m', 'us-states-10m']);
  assert.deepEqual(atlasesIn(geo({ name: 'mine' })), []);
  assert.deepEqual(atlasesIn(geo({ values: [{ name: 'world-110m' }] })), [], 'a row with a "name" column is data, not a reference');
  assert.deepEqual(atlasesIn({ ...geo({ name: 'world-110m' }), datasets: { 'world-110m': [{ a: 1 }] } }), []);
  assert.deepEqual(atlasesIn({ data: { name: 'constructor' } }), []);
});

test('withAtlases swaps each named atlas for { values: <topojson>, format: { type: "topojson", feature } } and leaves the input alone', () => {
  const topology = { type: 'Topology', objects: {}, arcs: [] };
  const vl = { layer: [geo({ name: 'world-110m' }), { data: { name: 'mine' }, mark: 'point' }], datasets: { mine: [] } };
  const before = structuredClone(vl);
  const out = withAtlases(vl, { 'world-110m': topology });
  assert.deepEqual(vl, before);
  assert.deepEqual(out.layer[0].data, { values: topology, format: { type: 'topojson', feature: 'countries' } });
  assert.deepEqual(out.layer[1].data, { name: 'mine' });
  assert.equal(out.layer[0].data.values, topology, 'the topology is shared, not copied per chart');
});

test('themeColours turns a theme token in a mark\'s fill, stroke or color into the theme colour, and touches nothing else', () => {
  const colours = { surface: '#101828', accent: '#5b8def', line: '#334', text: '#fff' };
  const vl = { mark: { type: 'geoshape', fill: 'surface', stroke: 'line' }, encoding: { color: { value: 'accent' }, text: { value: 'text' } }, config: { mark: { color: 'accent' } }, data: { values: [{ fill: 'surface' }] } };
  const out = themeColours(vl, colours);
  assert.deepEqual(out.mark, { type: 'geoshape', fill: '#101828', stroke: '#334' });
  assert.deepEqual(out.config.mark, { color: '#5b8def' });
  assert.deepEqual(out.encoding, vl.encoding, 'a { value } is a literal (a text mark\'s label may be the word "text")');
  assert.deepEqual(out.data, vl.data, 'rows are data');
  assert.deepEqual(themeColours({ mark: { fill: '#ff0000', stroke: 'red' } }, colours).mark, { fill: '#ff0000', stroke: 'red' });
  assert.equal(vl.mark.fill, 'surface', 'the input is not mutated');
});

test('bundledMaps lists the four names for the error message', () => {
  assert.equal(bundledMaps(), 'bundled maps: world-110m, world-50m, us-states-10m, us-counties-10m');
});

// ---- the validator ------------------------------------------------------------------------------------------------------------

test('a chart whose vegaLite.data is { name: <atlas> } validates with no datasets, for each of the four atlases', () => {
  for (const name of ATLAS_NAMES) assert.deepEqual(errs(one(geo({ name }))), [], name);
});

test('an atlas name works in a layer too, and a geoshape chart with its own datasets entry still validates', () => {
  assert.deepEqual(errs(one({ data: { values: [{ a: 1 }] }, projection: { type: 'equalEarth' }, layer: [{ data: { name: 'world-110m' }, mark: { type: 'geoshape' } }] })), []);
  assert.deepEqual(errs(one({ ...geo({ name: 'rows' }), datasets: { rows: [{ a: 1 }] } })), []);
});

test('an unknown dataset name lists the bundled maps, and names the closest when it is a near miss', () => {
  assert.deepEqual(errs(one(geo({ name: 'mars' }))), ['scenes[0].elements[0].vegaLite.data.name: dataset "mars" not found in vegaLite.datasets; bundled maps: world-110m, world-50m, us-states-10m, us-counties-10m']);
  assert.deepEqual(errs(one(geo({ name: 'world-110' }))), ['scenes[0].elements[0].vegaLite.data.name: dataset "world-110" not found in vegaLite.datasets; bundled maps: world-110m, world-50m, us-states-10m, us-counties-10m; did you mean "world-110m"?']);
});

test('the chart is compiled with the real atlas, so a Vega-Lite error in a map surfaces at validate', () => {
  const e = errs(one(geo({ name: 'world-110m' }, { encoding: { color: { field: 'properties.name', type: 'nonsense' } } })));
  assert.equal(e.length, 1);
  assert.match(e[0], /^scenes\[0\]\.elements\[0\]\.vegaLite: Vega-Lite compile error: /);
});

test('a url key is still refused beside an atlas name, and remote data stays remote', () => {
  const e = errs(one({ data: { name: 'world-110m' }, layer: [{ mark: 'geoshape' }, { data: { url: 'https://example.com/x.json' }, mark: 'point' }] }));
  assert.deepEqual(e, ['scenes[0].elements[0].vegaLite.layer[1].data.url: remote data is not allowed — inline data.values']);
});

// ---- the server -----------------------------------------------------------------------------------------------------------------

function get(url, rawPath) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    http.get({ host: u.hostname, port: u.port, path: rawPath }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}
async function withServer(fn) {
  const srv = await startServer({ specPath: WORLD_MAP, mode: 'render' });
  try { await fn(srv); } finally { await srv.close(); }
}

test('the server serves the four atlas files as locked-down JSON and nothing else of either package', () => withServer(async (srv) => {
  for (const name of ATLAS_NAMES) {
    const got = await get(srv.url, atlasUrl(name));
    assert.equal(got.status, 200, name);
    assert.match(got.headers['content-type'], /^application\/json/);
    assert.equal(got.headers['x-content-type-options'], 'nosniff');
    assert.equal(got.headers['content-security-policy'], "default-src 'none'");
    assert.equal(JSON.parse(got.body).type, 'Topology');
  }
  for (const p of ['/vendor/world-atlas/countries-10m.json', '/vendor/world-atlas/land-110m.json', '/vendor/world-atlas/package.json', '/vendor/world-atlas/README.md', '/vendor/world-atlas/LICENSE',
    '/vendor/us-atlas/nation-10m.json', '/vendor/us-atlas/states-albers-10m.json', '/vendor/us-atlas/package.json', '/vendor/world-atlas/', '/vendor/world-atlas/..%2fus-atlas%2fstates-10m.json',
    '/vendor/world-atlas/countries%2D110m.json', '/vendor/world-atlas/%2e%2e/package.json', '/vendor/us-atlas/../world-atlas/countries-110m.json/']) {
    assert.equal((await get(srv.url, p)).status, 404, p);
  }
}));

test('an atlas file can be read as a cross-origin-free fetch by the page (CSP connect-src self) and nothing else widened', () => withServer(async (srv) => {
  const page = await get(srv.url, '/');
  const csp = page.headers['content-security-policy'];
  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval|wasm-unsafe-eval/);
}));

// ---- the blocks: params ------------------------------------------------------------------------------------------------------------

const blockErrs = (name, params, extra = {}) => errs(oneScene([block(name, params)], extra)).map((line) => line.replace(/^scenes\[0\]\.elements\[0\]\.params\./, ''));

test('both blocks are registered with a summary, describe lines for every param, an example and a place', () => {
  for (const name of ['map-highlight', 'flow-map']) {
    assert.ok(BLOCK_NAMES.includes(name), name);
    const def = BLOCKS[name];
    assert.equal(typeof def.summary, 'string');
    assert.deepEqual(Object.keys(def.describe).sort(), Object.keys(def.params.properties).sort(), `${name}: every param is described`);
    assert.equal(typeof def.place, 'function');
  }
});

test('map-highlight: highlight takes 1 to 20 distinct atlas names; the error lists the names and names a near miss', () => {
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['France', 'Brazil'] }), []);
  assert.deepEqual(blockErrs('map-highlight', { highlight: [] }), ['highlight: must NOT have fewer than 1 items']);
  assert.deepEqual(blockErrs('map-highlight', { highlight: WORLD_NAMES.slice(0, 21) }), ['highlight: must NOT have more than 20 items']);
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['France', 'France'] }), ['highlight: must NOT have duplicate items (items ## 0 and 1 are identical)']);
  assert.deepEqual(blockErrs('map-highlight', {}), ['highlight: required']);
  const [bad] = blockErrs('map-highlight', { highlight: ['Frnace'] });
  assert.match(bad, /^highlight\[0\]: must be one of "Afghanistan", .*"Wyoming"; did you mean "France"\?$/);
  const [usa] = blockErrs('map-highlight', { highlight: ['USA'] });
  assert.match(usa, /^highlight\[0\]: must be one of .*"United States of America".*/);
});

test('map-highlight: a state on the world map, a country on the US map, and albersUsa on the world are each one error naming the fix', () => {
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['Texas'] }), ['highlight[0]: "Texas" is not on the world map; set "map": "us" to highlight a US state']);
  assert.deepEqual(blockErrs('map-highlight', { map: 'us', highlight: ['France'] }), ['highlight[0]: "France" is not on the US map; set "map": "world" to highlight a country, or name a US state']);
  assert.deepEqual(blockErrs('map-highlight', { map: 'world', highlight: ['France'], projection: 'albersUsa' }), ['projection: albersUsa draws only the United States; use "map": "us", or projection equalEarth or mercator']);
  assert.deepEqual(blockErrs('map-highlight', { map: 'us', highlight: ['Texas', 'Georgia'] }), []);
  assert.deepEqual(blockErrs('map-highlight', { map: 'world', highlight: ['Georgia'] }), [], 'Georgia is a country and a state');
});

test('map-highlight: label is capped, and hostile text is a param error rather than markup', () => {
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['France'], label: 'x'.repeat(81) }), ['label: must NOT have more than 80 characters']);
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['France'], label: '</script><img src=x onerror=alert(1)>' }), []);
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['France'], extra: 1 }), ['extra: unknown property; allowed: map, highlight, label, projection']);
  assert.deepEqual(blockErrs('map-highlight', { highlight: ['France'], map: 'moon' }), ['map: must be one of "world", "us"']);
});

test('flow-map: 1 to 12 flows, each end a { lon, lat } in range, a label up to 40 characters', () => {
  const flow = { from: { lon: -74, lat: 40.7 }, to: { lon: -0.13, lat: 51.5 }, label: 'New York to London' };
  assert.deepEqual(blockErrs('flow-map', { flows: [flow] }), []);
  assert.deepEqual(blockErrs('flow-map', { flows: [] }), ['flows: must NOT have fewer than 1 items']);
  assert.deepEqual(blockErrs('flow-map', { flows: Array.from({ length: 13 }, () => flow) }), ['flows: must NOT have more than 12 items']);
  assert.deepEqual(blockErrs('flow-map', {}), ['flows: required']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: -74 }, to: { lon: 0, lat: 0 } }] }), ['flows[0].from.lat: required']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: 200, lat: 0 }, to: { lon: 0, lat: 0 } }] }), ['flows[0].from.lon: must be <= 180']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: 0, lat: 90 }, to: { lon: 0, lat: 0 } }] }), ['flows[0].from.lat: must be <= 83']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: 0, lat: -86 }, to: { lon: 0, lat: 0 } }] }), ['flows[0].from.lat: must be >= -85']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: 0, lat: 0 }, to: { lon: 1, lat: 1 }, label: 'x'.repeat(41) }] }), ['flows[0].label: must NOT have more than 40 characters']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: 0, lat: 0 }, to: { lon: 1, lat: 1 }, colour: 'red' }] }), ['flows[0].colour: unknown property; allowed: from, to, label']);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: [-74, 40.7], to: { lon: 1, lat: 1 } }] }), ['flows[0].from: must be object'], 'the older [lon, lat] form is not accepted: an object names which is which');
  assert.deepEqual(blockErrs('flow-map', { flows: [flow], map: 'us' }), []);
  assert.deepEqual(blockErrs('flow-map', { flows: [{ from: { lon: 0, lat: 0 }, to: { lon: 1, lat: 1 }, label: '</script><b>' }] }), []);
});

// ---- the blocks: expansion ---------------------------------------------------------------------------------------------------------

const EXPANDED_SIZE = { format: '16:9' };

test('map-highlight expands to one chart (all features surface, the named ones accent) with a fade and a wipe, and a label under it', () => {
  const motion = oneScene([block('map-highlight', { map: 'world', highlight: ['France', 'Brazil'], label: 'Where we operate' })], EXPANDED_SIZE, 4);
  const parts = partsOf(expandBlocks(motion));
  assert.deepEqual(parts.map((p) => p.id), ['b/map', 'b/label']);
  const chart = parts[0];
  assert.equal(chart.type, 'chart');
  assert.deepEqual(chart.vegaLite.data, { name: 'world-110m' });
  assert.equal(chart.vegaLite.projection.type, 'equalEarth');
  assert.equal(chart.vegaLite.layer.length, 2);
  assert.equal(chart.vegaLite.layer[0].mark.fill, 'surface');
  assert.equal(chart.vegaLite.layer[1].mark.fill, 'accent');
  assert.deepEqual(chart.vegaLite.layer[1].transform, [{ filter: { field: 'properties.name', oneOf: ['France', 'Brazil'] } }]);
  assert.equal(chart.vegaLite.config?.view?.stroke ?? null, null);
  const [from, to, wipe] = chart.keyframes;
  assert.deepEqual([from.t, from.opacity, from.reveal], [0, 0, 0]);
  assert.deepEqual([to.opacity, to.ease], [1, 'enter']);
  assert.ok(Math.abs(to.t - 0.6) < 1e-9);
  assert.equal(wipe.reveal, 1);
  assert.ok(wipe.t > to.t);
  assert.equal(parts[1].text, 'Where we operate');
  assert.ok(parts[1].y > chart.y, 'the label is under the map');
});

test('map-highlight: the US map uses the states and albersUsa; no label means no label part', () => {
  const parts = partsOf(expandBlocks(oneScene([block('map-highlight', { map: 'us', highlight: ['Texas', 'Ohio'] })], EXPANDED_SIZE, 4)));
  assert.deepEqual(parts.map((p) => p.id), ['b/map']);
  assert.deepEqual(parts[0].vegaLite.data, { name: 'us-states-10m' });
  assert.equal(parts[0].vegaLite.projection.type, 'albersUsa');
  const mercator = partsOf(expandBlocks(oneScene([block('map-highlight', { highlight: ['France'], projection: 'mercator' })], EXPANDED_SIZE, 4)))[0];
  assert.equal(mercator.vegaLite.projection.type, 'mercator');
});

test('map-highlight: the chart fits the canvas, the safe area and the caption zone on every format', () => {
  for (const format of ['16:9', '9:16', '1:1', '4:5']) {
    const [chart] = partsOf(expandBlocks(oneScene([block('map-highlight', { highlight: ['France'], label: 'Where' }, { x: 540, y: 960 })], { format }, 4)));
    assert.ok(chart.width >= 1 && chart.height >= 1, format);
    assert.ok(chart.width <= (format === '9:16' ? 1080 : 1920), format);
  }
});

const FLOWS = [
  { from: { lon: -74, lat: 40.7 }, to: { lon: -0.13, lat: 51.5 }, label: 'New York to London' },
  { from: { lon: -0.13, lat: 51.5 }, to: { lon: 77.2, lat: 28.6 }, label: 'London to Delhi' },
  { from: { lon: 77.2, lat: 28.6 }, to: { lon: 139.7, lat: 35.7 }, label: 'Delhi to Tokyo' },
];

test('flow-map expands to the map, one chart per flow and one label per flow, flows revealed in the order written', () => {
  const parts = partsOf(expandBlocks(oneScene([block('flow-map', { map: 'world', flows: FLOWS })], EXPANDED_SIZE, 8)));
  assert.deepEqual(parts.map((p) => p.id), ['b/map', 'b/flow-1', 'b/flow-2', 'b/flow-3', 'b/label-1', 'b/label-2', 'b/label-3']);
  const starts = ['b/flow-1', 'b/flow-2', 'b/flow-3'].map((id) => parts.find((p) => p.id === id).keyframes.find((k) => k.opacity === 0).t);
  assert.ok(starts[0] > 0 && starts[1] - starts[0] >= 0.2 && starts[2] - starts[1] >= 0.2, `flow starts ${starts}`);
  for (const id of ['b/map', 'b/flow-1']) {
    const chart = parts.find((p) => p.id === id);
    assert.deepEqual([chart.x, chart.y, chart.width, chart.height], [parts[0].x, parts[0].y, parts[0].width, parts[0].height], `${id} lies exactly over the map`);
  }
  const map = parts[0].vegaLite;
  assert.deepEqual(map.layer[0].mark.fill, 'surface');
  const flow = parts[1].vegaLite;
  assert.equal(flow.projection.type, map.projection.type);
  const lines = flow.layer.filter((l) => l.mark?.type === 'geoshape' && l.data?.values);
  assert.equal(lines.length, 1, 'one arc layer');
  assert.deepEqual(JSON.stringify(lines[0].data.values).includes('LineString'), true);
});

test('flow-map: every chart is fitted to the same data (the map and all flow ends), so the arcs lie on the map', () => {
  const parts = partsOf(expandBlocks(oneScene([block('flow-map', { flows: FLOWS })], EXPANDED_SIZE, 8)));
  const anchors = (chart) => JSON.stringify(chart.vegaLite.layer.filter((l) => l.mark?.opacity === 0 && l.data?.values).map((l) => l.data.values));
  const first = anchors(parts[0]);
  assert.ok(first.length > 2);
  for (const chart of parts.filter((p) => p.type === 'chart')) assert.equal(anchors(chart), first, chart.id);
});

test('flow-map: a label shows while its flow is the newest and fades as the next arrives; the last stays; no labels means no label parts', () => {
  const parts = partsOf(expandBlocks(oneScene([block('flow-map', { flows: FLOWS })], EXPANDED_SIZE, 12)));
  const [one1, two, three] = ['b/label-1', 'b/label-2', 'b/label-3'].map((id) => parts.find((p) => p.id === id));
  const flow2 = parts.find((p) => p.id === 'b/flow-2').keyframes[0].t;
  assert.ok(one1.keyframes.at(-1).opacity === 0 && one1.keyframes.at(-1).t >= flow2, 'label 1 is gone once flow 2 arrives');
  assert.ok(two.keyframes.at(-1).opacity === 0);
  assert.equal(three.keyframes.at(-1).opacity, 1, 'the last label stays');
  const bare = partsOf(expandBlocks(oneScene([block('flow-map', { flows: [{ from: { lon: 0, lat: 0 }, to: { lon: 10, lat: 10 } }] })], EXPANDED_SIZE, 6)));
  assert.deepEqual(bare.map((p) => p.id), ['b/map', 'b/flow-1']);
});

test('flow-map: the US map uses the states and albersUsa', () => {
  const [map] = partsOf(expandBlocks(oneScene([block('flow-map', { map: 'us', flows: [{ from: { lon: -122.4, lat: 37.8 }, to: { lon: -74, lat: 40.7 } }] })], EXPANDED_SIZE, 6)));
  assert.deepEqual(map.vegaLite.data, { name: 'us-states-10m' });
  assert.equal(map.vegaLite.projection.type, 'albersUsa');
});

test('no keyframe of either block lands after 85 % of a short scene, and keyframes stay in order', () => {
  for (const [name, params] of [['map-highlight', { highlight: ['France'], label: 'x' }], ['flow-map', { flows: FLOWS }]]) {
    for (const duration of [0.2, 1, 3]) {
      for (const el of partsOf(expandBlocks(oneScene([block(name, params)], EXPANDED_SIZE, duration)))) {
        const times = (el.keyframes ?? []).map((k) => k.t);
        assert.deepEqual(times, [...times].sort((a, b) => a - b), `${name} ${el.id} @${duration}s: ascending`);
        assert.ok(times.every((t) => t <= 0.85 * duration + 1e-9), `${name} ${el.id} @${duration}s: ${times}`);
      }
    }
  }
});

// ---- examples and the page -----------------------------------------------------------------------------------------------------------

test('world-map.json, map-highlight.json and flow-map.json validate, are 15 s or less, and the blocks have golden sheets', () => {
  for (const file of [WORLD_MAP, HIGHLIGHT, FLOW]) {
    const { spec, dir } = loadSpec(file);
    assert.deepEqual(validateSpec(spec, { dir }).errors, [], path.basename(file));
    assert.ok(spec.scenes.reduce((n, s) => n + s.duration, 0) <= 15, path.basename(file));
  }
  const usesAtlas = JSON.stringify(readJson(WORLD_MAP)).match(/"name": ?"(world|us)-/g);
  assert.ok(usesAtlas && usesAtlas.length >= 2, 'world-map.json names at least a world and a US atlas');
  for (const name of ['map-highlight', 'flow-map']) assert.ok(readFileSync(path.join(root, 'references/blocks', `${name}.png`)).length > 1000, `${name}.png`);
});
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

for (const [label, file] of [['world-map.json', WORLD_MAP], ['map-highlight.json', HIGHLIGHT], ['flow-map.json', FLOW]]) {
  test(`${label} renders byte-identical twice`, async (t) => {
    if (!(await requireRender(t))) return;
    await assertRendersIdentically(t, file, SMALL);
  });
}

for (const [label, file] of [['world-map.json', WORLD_MAP], ['map-highlight.json', HIGHLIGHT], ['flow-map.json', FLOW]]) {
  test(`${label} passes check.mjs`, async (t) => {
    if (!(await requireRender(t, BROWSER_ONLY))) return;
    const r = spawnSync(process.execPath, [CHECK, file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^check: ok \(\d+ scenes?, \d+ moments\)\n$/);
    if (file === WORLD_MAP) assert.equal(r.stderr, '', 'an examples/ spec has nothing on stderr');
    else for (const line of r.stderr.split('\n').filter(Boolean)) assert.match(line, /^warning: scenes\[0\]: scene "[^"]+" shows nothing at 0\.00s/);
  });
}

// Opens `file` on the render page with guardNetwork on; returns every request path, the blocked URLs, page errors, CSP
// violations, and what `probe` found.
async function inPage(file, probe = () => null) {
  const srv = await startServer({ specPath: file, mode: 'render' });
  const browser = await launchBrowser({ quiet: true });
  try {
    const page = await browser.newPage();
    const seen = { requests: [], blocked: [], failed: [], errors: [] };
    await guardNetwork(page, new URL(srv.url).origin, (url) => seen.blocked.push(url));
    await page.addInitScript(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`)); });
    page.on('request', (r) => seen.requests.push(r.url().startsWith(srv.url) ? `/${r.url().slice(srv.url.length)}` : r.url()));
    page.on('requestfailed', (r) => seen.failed.push(r.url()));
    page.on('pageerror', (e) => seen.errors.push(e.message));
    await page.goto(srv.url);
    await page.waitForFunction(() => window.__motion);
    const ready = await page.evaluate(() => window.__motion.ready.then(() => true, (e) => String(e?.message ?? e)));
    const found = await page.evaluate(probe);
    const csp = await page.evaluate(() => window.__csp);
    return { ...seen, ready, found, csp };
  } finally { await browser.close(); await srv.close(); }
}

test('the render page makes no blocked request: the maps come from /vendor, once per atlas, and nothing else is fetched', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  for (const [file, atlases] of [[WORLD_MAP, ['world-110m', 'us-states-10m']], [HIGHLIGHT, ['world-110m']], [FLOW, ['world-110m']]]) {
    const got = await inPage(file);
    const label = path.basename(file);
    assert.equal(got.ready, true, label);
    assert.deepEqual(got.errors, [], label);
    assert.deepEqual(got.blocked, [], `${label}: guardNetwork blocked nothing`);
    assert.deepEqual(got.failed, [], label);
    assert.deepEqual(got.csp, [], label);
    const fetched = got.requests.filter((r) => r.startsWith('/vendor/world-atlas/') || r.startsWith('/vendor/us-atlas/'));
    assert.deepEqual(fetched.sort(), atlases.map(atlasUrl).sort(), `${label}: each atlas is fetched once, however many charts use it`);
  }
});

test('map-highlight draws the named countries in the accent colour and every other one in surface', async (t) => {
  if (!(await requireRender(t, BROWSER_ONLY))) return;
  const got = await inPage(HIGHLIGHT, () => {
    window.__motion.seek(3.9);
    const fills = {};
    for (const p of document.querySelectorAll('#stage .el[data-id="markets/map"] svg path[fill]')) fills[p.getAttribute('fill')] = (fills[p.getAttribute('fill')] ?? 0) + 1;
    return { fills, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent') };
  });
  assert.equal(got.ready, true);
  const spec = readJson(HIGHLIGHT);
  const named = spec.scenes[0].elements[0].params.highlight.length;
  const counts = Object.entries(got.found.fills).sort((a, b) => b[1] - a[1]);
  assert.equal(counts.length, 2, `two fills, accent and surface: ${JSON.stringify(got.found.fills)}`);
  assert.equal(counts[1][1], named, `${named} highlighted countries in one colour: ${JSON.stringify(got.found.fills)}`);
  assert.equal(counts[0][1], 177, 'every country of world-110m is drawn once in the land layer');
  assert.deepEqual(counts.map(([colour]) => colour).sort(), ['#241a38', '#ff7f61'], 'dusk surface and accent, resolved from the theme tokens');
});

// ---- docs, licences, audit ---------------------------------------------------------------------------------------------------------------

test('docs: schema.md names the atlases and both blocks, SKILL.md and both READMEs list them, the licences table names both packages', () => {
  const schema = readFileSync(path.join(root, 'references/schema.md'), 'utf8');
  const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const readme = readFileSync(path.join(root, 'README.md'), 'utf8');
  const pa = readFileSync(path.join(root, '../../README.md'), 'utf8');
  for (const name of ATLAS_NAMES) assert.ok(schema.includes(name), `schema.md names ${name}`);
  for (const name of ['map-highlight', 'flow-map']) {
    assert.match(schema, new RegExp(`\\| \`${name}\` \\|`), `schema.md block table: ${name}`);
    assert.ok(skill.includes(name), `SKILL.md: ${name}`);
    assert.ok(readme.includes(name), `README.md: ${name}`);
  }
  assert.ok(pa.includes('map highlight, flow map'), '<pa>/README.md lists the two blocks by name, as it lists the others');
  assert.match(pa, /twenty-eight blocks/);
  assert.match(pa, /\| \[world-atlas\]\(https:\/\/github\.com\/topojson\/world-atlas\) 2\.0\.2 .*\| ISC \|/);
  assert.match(pa, /\| \[us-atlas\]\(https:\/\/github\.com\/topojson\/us-atlas\) 3\.0\.1 .*\| ISC \|/);
  const pkg = readJson(path.join(root, 'package.json'));
  assert.equal(pkg.dependencies['world-atlas'], '2.0.2');
  assert.equal(pkg.dependencies['us-atlas'], '3.0.1');
});

test('npm audit reports no vulnerabilities (skipped when the registry cannot be reached)', (t) => {
  const r = spawnSync('npm', ['--prefix', root, 'audit', '--json'], { encoding: 'utf8', timeout: 60_000 });
  let report;
  try { report = JSON.parse(r.stdout); } catch { report = null; }
  if (!report || report.error) return t.skip(`npm audit unavailable: ${report?.error?.summary ?? r.stderr.split('\n')[0] ?? 'no output'}`);
  assert.equal(report.metadata.vulnerabilities.total, 0, JSON.stringify(report.vulnerabilities));
});
