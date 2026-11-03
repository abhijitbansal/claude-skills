// Node side of template/maps.mjs: the pinned atlas files, read from node_modules for the validator (the page fetches the
// same files from /vendor). Read once per process; an atlas the table does not name throws.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { didYouMean } from '../../shared/errors.mjs';
import { ATLASES, ATLAS_NAMES, atlasUrl, bundledMaps, atlasesIn, withAtlases } from '../../template/maps.mjs';

const NODE_MODULES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules');
const cache = new Map();

/** The parsed TopoJSON topology of atlas `name` (see ATLASES). */
export function readAtlas(name) {
  atlasUrl(name); // throws on an unknown name
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(path.join(NODE_MODULES, ATLASES[name].pkg, ATLASES[name].file), 'utf8')));
  return cache.get(name);
}

/** `vl` with every atlas it names replaced by the real file's topology, as the page compiles it. */
export function withAtlasFiles(vl) {
  const names = atlasesIn(vl);
  return names.length ? withAtlases(vl, Object.fromEntries(names.map((name) => [name, readAtlas(name)]))) : vl;
}

/** The message for a `data.name` that is neither a `datasets` entry nor an atlas: what is bundled, and the closest atlas for a near miss. */
export function unknownDatasetMessage(name) {
  const near = didYouMean(name, ATLAS_NAMES);
  return `dataset "${name}" not found in vegaLite.datasets; ${bundledMaps()}${near ? `; did you mean "${near}"?` : ''}`;
}
