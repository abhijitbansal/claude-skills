// The page cap, one rule for build.mjs and validate.mjs: build the page exactly as a build does (graph, fragment,
// themed page) and compare its bytes with the cap. validate.mjs uses it so "valid" means "builds": it measures the
// page in every theme build.mjs --theme accepts and keeps the heaviest, with headroom for the provenance stamp.
import { buildScene } from './api.mjs';
import { MAX_PAGE_BYTES } from './bundle.mjs';
import { renderPage } from './page.mjs';
import { loadTheme, listThemes } from '../../shared/theme.mjs';
import { themeFor } from './theme.mjs';
import { SceneError } from './scene-error.mjs';

const KB = 1024;
const ID_PREFIX = 'sc';
// build.mjs --model/--effort/--agent stamp the page (footer, its title attribute and the generator meta); validate
// cannot see them. Longest stamp (three 60-character fields) vs none, measured on a dusk city page: +408 bytes.
export const PROVENANCE_HEADROOM_BYTES = 1024;

/** The spec error for a page of `bytes` over `maxBytes`, else null. */
export function capError(bytes, maxBytes = MAX_PAGE_BYTES) {
  if (bytes <= maxBytes) return null;
  return { path: '', message: `the page is ${Math.round(bytes / KB)} KB; the limit is ${Math.round(maxBytes / KB)} KB - use fewer rows or fewer groups` };
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
 * The size validate compares with the cap: the page in the heaviest theme (every theme `build.mjs --theme` takes)
 * plus PROVENANCE_HEADROOM_BYTES. A world ignores the theme, so it is built once and rendered in each theme; a lift's
 * 2D fallback is drawn in the theme's colours, so a lift is built once per theme.
 */
export async function heaviestPageBytes(spec, { dir, allowOutside = false, env = process.env } = {}) {
  const sizes = [];
  if (spec.lift === undefined) {
    const built = await buildScene(spec, { dir, theme: themeFor(spec), idPrefix: ID_PREFIX, allowOutside });
    for (const name of listThemes()) sizes.push(Buffer.byteLength(renderPage(spec, built, { theme: loadTheme(name), env })));
  } else {
    for (const name of listThemes()) sizes.push((await buildPage({ ...spec, theme: name }, { dir, allowOutside, env })).bytes);
  }
  return Math.max(...sizes) + PROVENANCE_HEADROOM_BYTES;
}

/** { ok, errors } for the page the spec builds: the cap, or a content problem only the build finds. */
export async function pageErrors(spec, { dir, allowOutside = false, env = process.env, maxBytes = MAX_PAGE_BYTES } = {}) {
  try {
    const over = capError(await heaviestPageBytes(spec, { dir, allowOutside, env }), maxBytes);
    return { ok: over === null, errors: over === null ? [] : [over] };
  } catch (e) {
    if (e instanceof SceneError) return { ok: false, errors: e.errors };
    throw e;
  }
}
