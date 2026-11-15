// Loads an optional stack (voice, cutout) from its own locked folder, <skill>/optional/<name>/, which `doctor --fix` fills with
// `npm ci`. The folder's index.mjs is imported by file URL, so its bare imports resolve inside that folder; the skill's own
// node_modules is never consulted, so an old unlocked install tree there cannot supply an unpinned copy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { UsageError } from './spec.mjs';

export const OPTIONAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../optional');

/** The file URL of <root>/<name>/index.mjs (a URL, not a path: a space, a # or a Windows drive letter would break a path). */
export const optionalEntryUrl = (name, root = OPTIONAL_ROOT) => pathToFileURL(path.join(root, name, 'index.mjs')).href;

/**
 * The module of optional stack `name`, or a UsageError carrying `hint` when `pkg` is not installed in its folder.
 * `importer` and `exists` are for tests.
 */
export async function importOptional({ name, pkg, hint, root = OPTIONAL_ROOT, importer = (url) => import(url), exists = fs.existsSync }) {
  if (!exists(path.join(root, name, 'node_modules', pkg, 'package.json'))) throw new UsageError(hint);
  try {
    return await importer(optionalEntryUrl(name, root));
  } catch (e) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' && e.message.includes(pkg)) throw new UsageError(hint);
    throw e;
  }
}
