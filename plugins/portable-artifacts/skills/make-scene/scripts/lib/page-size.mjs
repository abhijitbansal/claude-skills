// The page cap, one rule for build.mjs and validate.mjs: build the page exactly as a build does (graph, fragment,
// themed page) and compare its bytes with the cap. validate.mjs uses it so "valid" means "builds": it measures the
// page in every theme build.mjs --theme accepts and keeps the heaviest, with headroom for the provenance stamp.
import { buildScene } from './api.mjs';
import { MAX_PAGE_BYTES } from './bundle.mjs';
import { renderPage } from './page.mjs';
import { eligibility, recommend } from './recommend.mjs';
import { loadData } from './rows.mjs';
import { loadTheme, listThemes } from '../../shared/theme.mjs';
import { themeFor } from './theme.mjs';
import { SceneError } from './scene-error.mjs';

const KB = 1024;
const ID_PREFIX = 'sc';
// build.mjs --model/--effort/--agent stamp the page (footer, its title attribute and the generator meta); validate
// cannot see them. Longest stamp (three 60-character fields) vs none, measured on a dusk city page: +408 bytes.
export const PROVENANCE_HEADROOM_BYTES = 1024;

/**
 * The spec error for a page of `bytes` over `maxBytes`, else null. `measure` (validate's) names how the size was found:
 * the heaviest theme's page plus provenance headroom, so a reader can tell it from a build's own page.
 */
export function capError(bytes, maxBytes = MAX_PAGE_BYTES, { measure, fits = [] } = {}) {
  if (bytes <= maxBytes) return null;
  const how = measure ? ` in the heaviest theme (${measure.theme}, with room for provenance)` : '';
  const instead = fits.length > 0 ? `, or pick a world that fits these rows (${fits.join(', ')})` : '';
  return { path: '', message: `the page is ${Math.round(bytes / KB)} KB${how}; the limit is ${Math.round(maxBytes / KB)} KB - use fewer rows or fewer groups${instead}` };
}

/**
 * The other worlds whose page fits `maxBytes` for the same data (heaviest theme, as validate measures it), in the
 * recommended order: names for the over-cap message. Only a data scene has other worlds, and only an eligible one can
 * be built (terrain needs one row per group and t); a world that cannot be built is simply not named. Call it on the
 * over-cap path only, because it builds each of them.
 */
export async function fittingWorlds(spec, { dir, allowOutside = false, env = process.env, maxBytes = MAX_PAGE_BYTES } = {}) {
  if (spec.data === undefined) return [];
  let data;
  try {
    data = loadData(spec, dir);
  } catch {
    return [];
  }
  const { ranked } = recommend(data);
  const own = spec.world ?? ranked[0];
  const eligible = eligibility(data);
  const fits = [];
  for (const world of ranked) {
    if (world === own || !eligible[world].ok) continue;
    try {
      const { bytes } = await heaviestPage({ ...spec, world }, { dir, allowOutside, env });
      if (bytes <= maxBytes) fits.push(world);
    } catch {
      // a world that fails to build for this data is not one to suggest
    }
  }
  return fits;
}

/**
 * The page for a validated spec: { built, html, bytes, theme }. Throws SceneError for a content problem found while
 * building (the same ones build.mjs reports).
 */
export async function buildPage(spec, { dir, allowOutside = false, env = process.env } = {}) {
  const theme = themeFor(spec);
  const built = await buildScene(spec, { dir, theme, idPrefix: ID_PREFIX, allowOutside });
  const html = renderPage(spec, built, { theme, env });
  return { built, html, bytes: Buffer.byteLength(html), theme };
}

/**
 * The size validate compares with the cap: { bytes, theme }, the page in the heaviest theme (every theme `build.mjs
 * --theme` takes) plus PROVENANCE_HEADROOM_BYTES, and that theme's name. A world ignores the theme, so it is built
 * once and rendered in each theme; a lift's 2D fallback is drawn in the theme's colours, so a lift is built once per theme.
 */
export async function heaviestPage(spec, { dir, allowOutside = false, env = process.env } = {}) {
  const sizes = [];
  if (spec.lift === undefined) {
    const built = await buildScene(spec, { dir, theme: themeFor(spec), idPrefix: ID_PREFIX, allowOutside });
    for (const name of listThemes()) sizes.push({ theme: name, bytes: Buffer.byteLength(renderPage(spec, built, { theme: loadTheme(name), env })) });
  } else {
    for (const name of listThemes()) sizes.push({ theme: name, bytes: (await buildPage({ ...spec, theme: name }, { dir, allowOutside, env })).bytes });
  }
  const heaviest = sizes.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  return { bytes: heaviest.bytes + PROVENANCE_HEADROOM_BYTES, theme: heaviest.theme };
}

/** { ok, errors } for the page the spec builds: the cap, or a content problem only the build finds. */
export async function pageErrors(spec, { dir, allowOutside = false, env = process.env, maxBytes = MAX_PAGE_BYTES } = {}) {
  try {
    const heaviest = await heaviestPage(spec, { dir, allowOutside, env });
    const measure = capError(heaviest.bytes, maxBytes, { measure: heaviest });
    if (measure === null) return { ok: true, errors: [] };
    const fits = await fittingWorlds(spec, { dir, allowOutside, env, maxBytes });
    return { ok: false, errors: [capError(heaviest.bytes, maxBytes, { measure: heaviest, fits })] };
  } catch (e) {
    if (e instanceof SceneError) return { ok: false, errors: e.errors };
    throw e;
  }
}
