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

// `resolveAsset` for a path as a spec writes it (an image src, an audio src, the beats file): relative to the spec folder,
// so a URL or an absolute path is refused before anything is looked up.
export function resolveSpecPath(root, src) {
  if (typeof src === 'string' && (/^[a-z][a-z0-9+.-]*:/i.test(src) || path.isAbsolute(src))) return { error: 'must be a path relative to the spec file' };
  return resolveAsset(root, src);
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

/**
 * A key that is the same for two paths a case-insensitive file system (macOS, Windows) would treat as one file: NFC, then
 * upper then lower case, so `ß` and `SS` meet.
 */
export const collisionKey = (file) => file.normalize('NFC').toUpperCase().toLowerCase();

/**
 * Every planned job (`{ index, out }`) whose output is a file the batch reads, as `{ index, path: '--out', message }`:
 * rendering it would replace the spec, the rows file or a clip, image or sound that this row or a later one draws.
 * `inputs`: `[{ file, what }]`, `what` naming it in the message (`the rows file`, or the src as the spec writes it).
 * Paths are compared through their symlinks where they exist, then as collisionKey. `wording`: what reads the file and
 * what to do instead; a single render (render.mjs prepare) passes its own.
 */
export function inputClashes(jobs, inputs, { reader = 'this batch', fix = 'change the value or the --out template' } = {}) {
  const read = new Map(inputs.map(({ file, what }) => [collisionKey(realOrResolved(file)), what]));
  return jobs.flatMap((job) => {
    const what = read.get(collisionKey(path.join(realOrResolved(path.dirname(job.out)), path.basename(job.out))));
    return what === undefined ? [] : [{ index: job.index, path: '--out', message: `${path.basename(job.out)} is a file ${reader} reads (${what}); ${fix}` }];
  });
}
