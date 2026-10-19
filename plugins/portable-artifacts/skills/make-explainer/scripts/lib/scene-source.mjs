// Where a scene section gets its spec: an inline object, or a .json file in
// the spec folder (the same path rules as every other file reference). Shared
// by the validation check and the renderer.
import fs from 'node:fs';
import path from 'node:path';
import { resolveRef } from './paths.mjs';
import { repath } from './diagram-source.mjs';

export const SCENE_EXTS = ['.json'];
export const SCENE_MAX_BYTES = 1024 * 1024;
/** WebGL contexts are scarce (a phone keeps about eight alive); each scene section holds one. */
export const MAX_SCENE_SECTIONS = 4;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * -> { spec, dir } for an inline object (dir = the explainer's folder), { spec, dir, file } for a file (dir = the
 * file's folder, where the scene's own data paths resolve), or { error } naming the fix. `dir` is the explainer
 * spec's folder.
 */
export function readSceneSpec(scene, dir) {
  if (isObject(scene)) return { spec: scene, dir };
  const ref = resolveRef(dir, scene, { exts: SCENE_EXTS });
  if (ref.error) return { error: ref.error };
  const size = fs.statSync(ref.abs).size;
  if (size > SCENE_MAX_BYTES) {
    return { error: `${JSON.stringify(scene)} is ${(size / 1024).toFixed(0)} KB; the limit is ${SCENE_MAX_BYTES / 1024} KB — split the scene` };
  }
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(ref.abs, 'utf8'));
  } catch (e) {
    return { error: `${JSON.stringify(scene)} is not valid JSON: ${e.message}` };
  }
  if (!isObject(spec)) return { error: `${JSON.stringify(scene)} must hold one JSON object (a scene spec)` };
  return { spec, dir: path.dirname(ref.abs), file: scene };
}

/** make-scene errors ([{ path, message }], "" for the whole spec) under `base`; a file's errors also name the file. */
export function reportSceneErrors(errors, base, file) {
  return errors.map((e) => ({ path: repath(base, e.path), message: file ? `${e.message} (in ${file})` : e.message }));
}
