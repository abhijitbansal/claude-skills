// Loads an optional stack (voice, cutout) from its own locked folder, <skill>/optional/<name>/, which `doctor --fix` fills with
// `npm ci`. The folder's index.mjs is imported by file URL, so its bare imports start their search in that folder. Node then walks
// UP the tree, so a package missing from the folder (a partial install) would load from the skill's own node_modules or any
// ancestor instead. importOptional therefore checks, before loading, that every direct dependency of the folder's package.json is
// installed inside the folder (refusing with the path Node would have used otherwise), and that every package the folder's
// lockfile lists is there too, so an interrupted install cannot be completed by an old unlocked tree. It checks that the
// packages exist, not their contents or versions: the lockfile's integrity is checked by `npm ci` when it installs.
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

// npm's "os" and "cpu" lists: empty means everywhere; `!x` excludes x; otherwise the current value must be listed.
function platformAllows(list, current) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes(`!${current}`)) return false;
  const listed = list.filter((item) => !item.startsWith('!'));
  return listed.length === 0 || listed.includes(current);
}

// Throws unless every package the folder's lockfile lists (the whole tree, not only the direct dependencies) is installed in the
// folder. Entries npm may legitimately leave out are skipped: `optional` ones, and ones whose os or cpu exclude this machine.
// An interrupted install leaves holes, and a hole is filled from any old tree above the folder.
function requireLockedPackages({ name, folder, hint, exists, readFile, platform }) {
  const lockFile = path.join(folder, 'package-lock.json');
  const { packages } = manifestOf(lockFile, readFile);
  if (packages === null || typeof packages !== 'object') throw new Error(`${lockFile} has no "packages" map (an old lockfile format), so the install cannot be checked`);
  for (const [key, entry] of Object.entries(packages)) {
    if (!key.includes('node_modules/') || entry.link || entry.optional) continue;
    if (!platformAllows(entry.os, platform.os) || !platformAllows(entry.cpu, platform.cpu)) continue;
    if (exists(path.join(folder, key, 'package.json'))) continue;
    throw new UsageError(`optional/${name}: ${key} (listed in package-lock.json) is missing from ${path.join(folder, key)}, so the install is incomplete and Node could load an old copy from above the folder. Re-run the doctor fix. ${hint}`);
  }
}

/**
 * The module of optional stack `name`, or a UsageError carrying `hint` when `pkg` is not installed in its folder, or one that names
 * the stray path when a direct dependency would load from outside the folder. `importer`, `exists` and `readFile` are for tests.
 */
export async function importOptional({
  name, pkg, hint, root = OPTIONAL_ROOT, importer = (url) => import(url), exists = fs.existsSync,
  readFile = (file) => fs.readFileSync(file, 'utf8'), platform = { os: process.platform, cpu: process.arch },
}) {
  const folder = path.join(root, name);
  if (!exists(path.join(folder, 'node_modules', pkg, 'package.json'))) throw new UsageError(hint);
  requireOwnDependencies({ name, folder, hint, exists, readFile });
  requireLockedPackages({ name, folder, hint, exists, readFile, platform });
  try {
    return await importer(optionalEntryUrl(name, root));
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(pkg)) throw new UsageError(hint);
    throw e;
  }
}
