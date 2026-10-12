// Per-section-type checks that need more than the schema (files on disk, other
// skills). A check is (ctx) => array of { path, message } | Promise<same>, where
// ctx = { section, path, dir, spec } and path is the section's JSON path
// ("sections[3]"). validateSpec runs every check registered for the section's
// type. Later tasks add theirs with registerCheck(type, fn).
import { resolveRef } from './paths.mjs';
import { pathJoin } from '../../shared/errors.mjs';

const CHECKS = new Map();

export function registerCheck(type, fn) {
  if (typeof fn !== 'function') throw new TypeError('a check must be a function');
  CHECKS.set(type, [...(CHECKS.get(type) ?? []), fn]);
}

export function checksFor(type) {
  return CHECKS.get(type) ?? [];
}

export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];

// image.src: a local file inside the spec folder. (Size limits: a later task.)
registerCheck('image', ({ section, path: at, dir }) => {
  const r = resolveRef(dir, section.src, { exts: IMAGE_EXTS });
  return r.error ? [{ path: pathJoin(at, 'src'), message: r.error }] : [];
});
