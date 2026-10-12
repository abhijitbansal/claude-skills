// Where a built diagram goes: --out (file or directory), else
// ${PA_OUTPUT_DIR or ~/.agent/diagrams}/<slug-of-title>.html. Never anywhere implicit but those.
import os from 'node:os';
import path from 'node:path';

const MAX_SLUG = 60;
const FALLBACK_SLUG = 'diagram';

/** Title -> lowercase [a-z0-9-], at most 60 characters, "diagram" when nothing is left. */
export function slugify(title) {
  const slug = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+/, '').slice(0, MAX_SLUG).replace(/-+$/, '');
  return slug || FALLBACK_SLUG;
}

/** Absolute .html path for a build. `out` ending in .html is the file; any other `out` is a directory. */
export function resolveOutput({ out, title, env = process.env, home = os.homedir() }) {
  if (out && /\.html$/i.test(out)) return path.resolve(out);
  const dir = out || env.PA_OUTPUT_DIR || path.join(home, '.agent', 'diagrams');
  return path.join(path.resolve(dir), `${slugify(title)}.html`);
}
