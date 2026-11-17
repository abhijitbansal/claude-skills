// The prepare step: a kind that needs a library the render page cannot load (the page is served only engine/*.mjs,
// fonts and the film's pictures) declares `prepared: true`, and its preparer here turns each of its shots into plain
// JSON in Node, before the page opens. The server sends that JSON with the film (/film.json `prepared`), buildFilm puts a
// shot's entry on ctx.prepared, and the kind reads it there. Libraries are imported only under this folder. Node only.
import { registries } from '../../../engine/registry.mjs';
import '../../../engine/kinds/index.mjs';
import { pathJoin } from '../../../shared/errors.mjs';
import { prepareMap } from './map.mjs';
import { prepareCode } from './code.mjs';

/**
 * The preparer of each kind that declares `prepared: true`, by kind name:
 * (shot, { filmDir, index }) -> { data: object | null, problems: { path, message }[] }, `path` relative to the shot
 * (`places[1].at`). It must be deterministic (same shot, same JSON) and never touch the network.
 */
export const PREPARERS = Object.freeze({ map: prepareMap, code: prepareCode });

// A preparer's path ("places[1].at", "word") under the shot's: shots[3].places[1].at.
const fullPath = (index, rel) => String(rel).split('.').reduce((acc, part) => {
  const [key, ...indices] = part.split(/\[(\d+)\]/).filter((s) => s !== '');
  return indices.reduce((p, i) => pathJoin(p, Number(i)), pathJoin(acc, /^\d+$/.test(key) ? Number(key) : key));
}, pathJoin('shots', index));

/**
 * @param {object} film a validated film
 * @param {{ filmDir: string, preparers?: Record<string, Function>, kinds?: object }} options filmDir: the folder the
 *   film's paths are relative to; preparers and kinds: the tables to use (default PREPARERS and the shared registry)
 * @returns {{ prepared: Record<string, object>, problems: { path: string, message: string }[] }} prepared: each prepared
 *   shot's data by shot id, in shot order; problems: the preparers' problems with full paths (shots[i]...)
 */
export function prepareFilm(film, { filmDir, preparers = PREPARERS, kinds = registries.kinds } = {}) {
  const prepared = {};
  const problems = [];
  film.shots.forEach((shot, index) => {
    if (!kinds.has(shot.show) || kinds.get(shot.show).prepared !== true) return;
    const preparer = preparers[shot.show];
    if (typeof preparer !== 'function') throw new Error(`kind "${shot.show}" needs prepared data, but scripts/v2/prepare has no preparer for it`);
    const out = preparer(shot, { filmDir, index });
    problems.push(...(out.problems ?? []).map(({ path, message }) => ({ path: fullPath(index, path), message })));
    if (out.data !== null && out.data !== undefined) prepared[shot.id] = out.data;
  });
  return { prepared, problems };
}
