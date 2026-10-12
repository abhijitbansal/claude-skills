// File references in an explainer spec: a path resolves relative to the spec's
// folder, must stay inside it, must not go through a symlink, and must exist.
import fs from 'node:fs';
import path from 'node:path';

// -> { abs } (the real path) or { error } (a message that names the fix).
// `exts` (optional) is a list like ['.png', '.svg']; matching is case-insensitive.
export function resolveRef(dir, p, { exts } = {}) {
  if (typeof p !== 'string' || p.trim() === '') return { error: 'must be a path to a file in the spec folder' };
  if (path.isAbsolute(p)) return { error: `${JSON.stringify(p)} is absolute; use a path relative to the spec folder` };
  if (exts && !exts.includes(path.extname(p).toLowerCase())) {
    return { error: `must be a ${exts.join(', ')} file; got ${JSON.stringify(path.extname(p) || p)}` };
  }
  const base = path.resolve(dir);
  const wanted = path.resolve(base, p);
  const rel = path.relative(base, wanted);
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`)) {
    return { error: `${JSON.stringify(p)} is outside the spec folder; move the file under ${base} and use a relative path` };
  }
  let real;
  let root;
  try {
    root = fs.realpathSync(base);
    real = fs.realpathSync(wanted);
  } catch {
    return { error: `file not found: ${JSON.stringify(p)} (relative to ${base})` };
  }
  if (real !== path.join(root, rel)) {
    return { error: `${JSON.stringify(p)} goes through a symlink; symlinks are not followed — copy the file into ${base}` };
  }
  if (!fs.statSync(real).isFile()) return { error: `${JSON.stringify(p)} is not a regular file` };
  return { abs: real };
}
