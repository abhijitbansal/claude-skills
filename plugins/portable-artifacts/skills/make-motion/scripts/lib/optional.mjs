// Loads an optional stack (voice, cutout) from its own locked folder, <skill>/optional/<name>/, which `doctor --fix` fills with
// `npm ci`. The folder's index.mjs is imported by file URL, so its bare imports start their search in that folder. Node then walks
// UP the tree, so a package missing from the folder (a partial install) would load from the skill's own node_modules or any
// ancestor instead. importOptional therefore checks, before loading, that every direct dependency of the folder's package.json is
// installed inside the folder, and refuses with the path Node would have used otherwise. Dependencies of dependencies are not
// checked: they are covered by the lockfile that `npm ci` installs from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError } from './spec.mjs';

export const OPTIONAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../optional');

/** The file URL of <root>/<name>/index.mjs (a URL, not a path: a space, a # or a Windows drive letter would break a path). */
export const optionalEntryUrl = (name, root = OPTIONAL_ROOT) => pathToFileURL(path.join(root, name, 'index.mjs')).href;

const manifestOf = (file, readFile) => {
  try {
    return JSON.parse(readFile(file));
  } catch (e) {
    throw new Error(`cannot read ${file}: ${String(e?.message ?? e).split('\n')[0]}`, { cause: e });
  }
};

// The nearest node_modules above `folder` that holds `dep`, or null: where Node would look next.
function strayCopy(folder, dep, exists) {
  for (let dir = path.dirname(folder); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', dep);
    if (exists(path.join(candidate, 'package.json'))) return candidate;
    if (path.dirname(dir) === dir) return null;
  }
}

// Throws unless every direct dependency of `folder` is installed in `folder`/node_modules.
function requireOwnDependencies({ name, folder, hint, exists, readFile }) {
  const manifest = manifestOf(path.join(folder, 'package.json'), readFile);
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (exists(path.join(folder, 'node_modules', dep, 'package.json'))) continue;
    const stray = strayCopy(folder, dep, exists);
    if (stray === null) throw new UsageError(hint);
    throw new UsageError(`optional/${name}: ${dep} is missing from ${path.join(folder, 'node_modules')}, and Node would load ${stray} instead, which is not the locked copy. Reinstall it. ${hint}`);
  }
}

/**
 * The module of optional stack `name`, or a UsageError carrying `hint` when `pkg` is not installed in its folder, or one that names
 * the stray path when a direct dependency would load from outside the folder. `importer`, `exists` and `readFile` are for tests.
 */
export async function importOptional({ name, pkg, hint, root = OPTIONAL_ROOT, importer = (url) => import(url), exists = fs.existsSync, readFile = (file) => fs.readFileSync(file, 'utf8') }) {
  const folder = path.join(root, name);
  if (!exists(path.join(folder, 'node_modules', pkg, 'package.json'))) throw new UsageError(hint);
  requireOwnDependencies({ name, folder, hint, exists, readFile });
  try {
    return await importer(optionalEntryUrl(name, root));
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(pkg)) throw new UsageError(hint);
    throw e;
  }
}
