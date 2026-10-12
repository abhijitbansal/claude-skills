// Where a built explainer goes: --out (file.html or directory), else
// ${PA_OUTPUT_DIR or ~/.agent/diagrams}/<slug-of-title>.html. The logic is
// shared (shared/output.mjs); the fallback slug here is "explainer".
import { slugify as baseSlugify, resolveOutput as baseResolve } from '../../shared/output.mjs';

const FALLBACK = 'explainer';

export const slugify = (title) => baseSlugify(title, FALLBACK);
export const resolveOutput = (opts) => baseResolve({ fallback: FALLBACK, ...opts });
