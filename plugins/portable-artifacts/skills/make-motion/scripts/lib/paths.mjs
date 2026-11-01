// Shared by the validator and the server so both agree on what a spec may reference; and the two file helpers render
// --batch uses for its temp files and its outputs.
import { closeSync, openSync, realpathSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

const OUTSIDE = 'must stay inside the spec folder';

// Resolve `rel` (already URL-decoded) inside `root`. Returns { file } with a real,
// regular, non-hidden file, or { error } naming the problem.
export function resolveAsset(root, rel) {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) return { error: 'invalid path' };
  const normalized = path.posix.normalize(rel.replaceAll('\\', '/'));
  if (path.isAbsolute(rel) || normalized === '..' || normalized.startsWith('../')) return { error: OUTSIDE };
  if (normalized.split('/').some((seg) => seg.startsWith('.') && seg !== '.')) {
    return { error: 'hidden files are not allowed' };
  }
  let realRoot;
  try { realRoot = realpathSync(root); } catch { return { error: `file not found: ${rel}` }; }
  let real;
  try { real = realpathSync(path.resolve(realRoot, normalized)); } catch { return { error: `file not found: ${rel}` }; }
  if (!real.startsWith(realRoot + path.sep)) return { error: OUTSIDE };
  if (!statSync(real).isFile()) return { error: `not a regular file: ${rel}` };
  return { file: real };
}

/**
 * Makes `file` a new, empty regular file before a tool writes it: whatever is at that name (a stale temp from an
 * interrupted run, or a symlink planted there) is removed first, the link itself and never what it points to, and the
 * file is then created exclusively. A tool that reopens the file by name (ffmpeg -y) gets this new file unless something
 * replaces it in between: it closes the case of a link left there beforehand, not a race.
 */
export function freshFile(file) {
  rmSync(file, { force: true });
  closeSync(openSync(file, 'wx'));
}

/** `file` with its symlinks resolved when it exists, else its absolute path as written. */
export function realOrResolved(file) {
  try { return realpathSync(file); } catch { return path.resolve(file); }
}

// Same check for URL paths: decodes, then returns the real file or null.
export function resolveUrlPath(root, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return null; }
  return resolveAsset(root, decoded).file ?? null;
}
