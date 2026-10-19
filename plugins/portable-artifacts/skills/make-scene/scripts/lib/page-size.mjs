// The page cap, one rule for build.mjs and validate.mjs: build the page exactly as a build does (graph, fragment,
// themed page) and compare its bytes with the cap. validate.mjs uses it so "valid" means "builds".
import { buildScene } from './api.mjs';
import { MAX_PAGE_BYTES } from './bundle.mjs';
import { renderPage } from './page.mjs';
import { themeFor } from './theme.mjs';

const KB = 1024;
const ID_PREFIX = 'sc';

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
