// Browser-safe (no Node imports): the named atlases a chart's Vega-Lite spec may use as its data, and the two rewrites the
// renderer and the validator make before compiling. A chart whose `data` is `{ "name": "world-110m" }` draws the pinned
// world-atlas / us-atlas TopoJSON of that name: the page fetches it from /vendor (server.mjs VENDOR_ONLY) and the validator
// reads the same file from node_modules (scripts/lib/atlas-files.mjs), then both compile the spec with
// `withAtlases`, which turns each such `data` into `{ values: <topology>, format: { type: 'topojson', feature } }`.
// `themeColours` lets a spec say `"fill": "surface"` and get the active theme's colour, as the other element types do.
// Imports nothing: the page loads this module as it is.

export const ATLASES = Object.freeze({
  'world-110m': Object.freeze({ pkg: 'world-atlas', file: 'countries-110m.json', feature: 'countries' }),
  'world-50m': Object.freeze({ pkg: 'world-atlas', file: 'countries-50m.json', feature: 'countries' }),
  'us-states-10m': Object.freeze({ pkg: 'us-atlas', file: 'states-10m.json', feature: 'states' }),
  'us-counties-10m': Object.freeze({ pkg: 'us-atlas', file: 'counties-10m.json', feature: 'counties' }),
});
export const ATLAS_NAMES = Object.freeze(Object.keys(ATLASES));

const isAtlas = (name) => typeof name === 'string' && Object.hasOwn(ATLASES, name);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const DATA_ROWS = new Set(['values', 'datasets']); // row contents are data: never read for references or colours

/** The vendor path the page fetches atlas `name` from. Throws on a name that is not in ATLASES. */
export function atlasUrl(name) {
  if (!isAtlas(name)) throw new Error(`unknown atlas "${name}"; bundled maps: ${ATLAS_NAMES.join(', ')}`);
  return `/vendor/${ATLASES[name].pkg}/${ATLASES[name].file}`;
}

/** `bundled maps: world-110m, …`: the tail of the unknown-dataset message (spec.mjs adds the did-you-mean). */
export const bundledMaps = () => `bundled maps: ${ATLAS_NAMES.join(', ')}`;
export const isAtlasName = isAtlas;

// Walks the spec's non-row parts; `visit(node, key, parent)` sees every `data` object.
function dataObjects(node, datasets, found) {
  if (Array.isArray(node)) { for (const child of node) dataObjects(child, datasets, found); return found; }
  if (!isPlain(node)) return found;
  for (const [key, child] of Object.entries(node)) {
    if (DATA_ROWS.has(key)) continue;
    if (key === 'data' && isPlain(child) && isAtlas(child.name) && !Array.isArray(datasets?.[child.name])) found.push(child.name);
    else dataObjects(child, datasets, found);
  }
  return found;
}

/**
 * The atlas names Vega-Lite spec `vl` draws, in order of first use: every `data: { name }` (top level, a layer, a concat,
 * a lookup's `from`) whose name is an atlas and has no `datasets` entry of its own (that entry wins).
 */
export function atlasesIn(vl) {
  return [...new Set(dataObjects(vl, vl?.datasets, []))];
}

function rebuild(node, visit) {
  if (Array.isArray(node)) return node.map((child) => rebuild(child, visit));
  if (!isPlain(node)) return node;
  const out = {};
  for (const [key, child] of Object.entries(node)) out[key] = DATA_ROWS.has(key) ? child : visit(key, child, node, (c) => rebuild(c, visit));
  return out;
}

/**
 * A copy of `vl` with each atlas `data: { name }` replaced by `{ values: topologies[name], format: { type: 'topojson',
 * feature, ...the spec's own format } }`. The topology objects are shared, not copied; `vl` is not mutated. A name
 * missing from `topologies` is left as it was.
 */
export function withAtlases(vl, topologies) {
  const datasets = vl?.datasets;
  return rebuild(vl, (key, child, _parent, recur) => {
    if (key === 'data' && isPlain(child) && isAtlas(child.name) && !Array.isArray(datasets?.[child.name]) && Object.hasOwn(topologies, child.name)) {
      return { values: topologies[child.name], format: { type: 'topojson', feature: ATLASES[child.name].feature, ...child.format } };
    }
    return recur(child);
  });
}

const COLOUR_KEYS = new Set(['fill', 'stroke', 'color']);

/**
 * A copy of `vl` where a `fill`, `stroke` or `color` that is the name of a theme colour (`surface`, `accent`, `line`, `text`…;
 * `colours` is the theme's dark colour table) becomes that colour. Only those three keys with a string value: a `{ value }`
 * in an encoding is a literal (a text mark's label may be the word "text"), and data rows are never read.
 */
export function themeColours(vl, colours) {
  return rebuild(vl, (key, child, _parent, recur) => {
    if (COLOUR_KEYS.has(key) && typeof child === 'string' && Object.hasOwn(colours, child) && typeof colours[child] === 'string') return colours[child];
    return recur(child);
  });
}
