// The two atlases the `map` kind draws, read from the pinned world-atlas and us-atlas packages in node_modules once per
// process (the 50m and county files are not used). Node only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const ATLASES = Object.freeze({
  world: Object.freeze({ file: 'world-atlas/countries-110m.json', object: 'countries' }),
  us: Object.freeze({ file: 'us-atlas/states-10m.json', object: 'states' }),
});
const loaded = new Map();

/** The TopoJSON topology of `region` ('world' or 'us') and the name of its object of areas. */
export function atlasOf(region) {
  const atlas = ATLASES[region];
  if (!atlas) throw new Error(`map region must be one of ${Object.keys(ATLASES).join(', ')}, got ${JSON.stringify(region)}`);
  if (!loaded.has(region)) loaded.set(region, JSON.parse(readFileSync(require.resolve(atlas.file), 'utf8')));
  return { topology: loaded.get(region), object: atlas.object };
}
