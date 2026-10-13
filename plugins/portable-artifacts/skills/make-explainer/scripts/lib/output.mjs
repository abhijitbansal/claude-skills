// Where a built explainer goes: --out (file.html or directory), else
// ${PA_OUTPUT_DIR or ~/.agent/diagrams}/<slug-of-title>.html. The logic is
// shared (shared/output.mjs); the fallback slug here is "explainer".
import path from 'node:path';
import { slugify as baseSlugify, resolveOutput as baseResolve } from '../../shared/output.mjs';

const FALLBACK = 'explainer';

export const slugify = (title) => baseSlugify(title, FALLBACK);
export const resolveOutput = (opts) => baseResolve({ fallback: FALLBACK, ...opts });

/** The page's name without its extension (`.html` or `.htm`, any case): <name>.assets/ sits next to the page. */
export const pageSlug = (target) => path.basename(target, path.extname(target));

/** The folder a page's files (a video, an interactive chart) go in. */
export const assetsFolder = (target) => path.join(path.dirname(target), `${pageSlug(target)}.assets`);
