// Source file resolution. A model writes the spec, so a source path is only
// accepted when its realpath is a regular file inside the spec folder, unless
// the person running the CLI passes --allow-outside (never a spec field).
import fs from 'node:fs';
import path from 'node:path';

export const RESERVED_SOURCE_NAMES = ['main', 'temp', 'system'];

// -> { abs } (the realpath) or { error }.
export function checkSource(src, dir, { allowOutside = false, folderLabel = 'spec folder' } = {}) {
  const wanted = path.resolve(dir, src.path);
  let real;
  try {
    real = fs.realpathSync(wanted);
  } catch {
    return { error: `file not found: ${wanted}` };
  }
  if (!allowOutside) {
    const root = fs.realpathSync(dir);
    const rel = path.relative(root, real);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return { error: `resolves outside the ${folderLabel} (${real}); move the data under ${root} or pass --allow-outside` };
    }
  }
  if (!fs.statSync(real).isFile()) return { error: `not a regular file: ${real}` };
  return { abs: real };
}
