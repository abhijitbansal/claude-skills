// What the film validator's modules share (spec.mjs and spec-sound.mjs): the error a bad film throws, the rules for a
// path the film names (relative, inside the film's folder, an existing file), and how a user's value is repeated in a
// message. Pure apart from the file system checks of a path.
import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { showValue } from '../../engine/script/anchors.mjs';
import { formatAjvErrors, pathJoin } from '../../shared/errors.mjs';

// A scheme with "//" is a URL; so are these opaque ones. A name such as "clip:1.png" is a file.
const URL_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/|(?:data|blob|file|javascript):)/i;
const DRIVE_RE = /^[a-z]:/i; // "C:\x", "C:/x" and the drive-relative "C:x"
const UNC_RE = /^\\\\/;
export const SRC_EXAMPLE = '"assets/photo.png"';
const NOT_FOUND_CODES = new Set(['ENOENT', 'ENOTDIR']);

// A user's value as a message repeats it: a string in quotes, anything else as
// plain JSON, cut to a length a message can hold.
export const quote = showValue;

export class SpecError extends Error {
  constructor(errors) {
    super(errors.map(({ path: at, message }) => `${at || '(root)'}: ${message}`).join('\n'));
    this.name = 'SpecError';
    this.errors = errors;
  }
}

export const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Ajv errors for a value at `base`, as { path, message } with full paths.
export function schemaErrors(check, value, base) {
  if (check(value)) return [];
  return formatAjvErrors(check.errors).map(({ path: at, message }) => ({ path: at ? pathJoin(base, at) : base, message }));
}

// What is wrong with a `src` as written, or null. Checked by hand so the
// message can say which rule it broke: relative, inside the folder, exists.
export function srcProblem(src, specDir) {
  const quoted = quote(src);
  const relative = `write a path relative to the spec folder, such as ${SRC_EXAMPLE}`;
  if (DRIVE_RE.test(src)) return `${quoted} is an absolute path (a single letter and a colon at the start looks like a Windows drive); ${relative}`;
  if (path.isAbsolute(src) || UNC_RE.test(src)) return `${quoted} is an absolute path; ${relative}`;
  if (URL_RE.test(src)) return `${quoted} is a URL; ${relative}`;
  if (src.includes('\\')) return `${quoted} contains a backslash; use forward slashes, as in ${SRC_EXAMPLE}`;
  if (leavesFolder(specDir, path.resolve(specDir, src))) return outsideMessage(quoted);
  return resolveOnDisk(src, specDir, quoted) ?? null;
}

const outsideMessage = (quoted) => `${quoted} is outside the spec folder; move the file inside it and write its path relative to the spec file, such as ${SRC_EXAMPLE}`;

// Why the file cannot be used, or undefined when it can. Every filesystem call
// is guarded: a file can vanish between two checks, and only a missing file is
// "not found"; any other failure is reported with its code.
function resolveOnDisk(src, specDir, quoted) {
  let realRoot;
  try {
    realRoot = realpathSync(specDir);
  } catch (err) {
    return `the spec folder ${quote(specDir)} cannot be read: ${errorCode(err)}`;
  }
  let real;
  try {
    real = realpathSync(path.resolve(specDir, src));
    if (leavesFolder(realRoot, real)) return outsideMessage(quoted);
    if (statSync(real).isDirectory()) return `${quoted} is a folder, not a file; name the file inside it`;
  } catch (err) {
    if (NOT_FOUND_CODES.has(err.code)) return `file not found: ${quoted} (paths are relative to the spec folder)`;
    return `cannot read ${quoted}: ${errorCode(err)}`;
  }
  return undefined;
}

export const errorCode = (err) => err.code ?? err.message;

function leavesFolder(root, target) {
  const rel = path.relative(root, target);
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

