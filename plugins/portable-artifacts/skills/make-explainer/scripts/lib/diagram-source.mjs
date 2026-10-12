// Where a diagram section gets its spec: an inline object, or a .json file in
// the spec folder (the same path rules as every other file reference). Shared
// by the validation check and the renderer.
import fs from 'node:fs';
import { resolveRef } from './paths.mjs';

export const DIAGRAM_EXTS = ['.json'];
export const DIAGRAM_MAX_BYTES = 1024 * 1024;

/** Errors whose paths are relative to a section ("diagram.nodes[0].label"); the page builder adds the section's own path. */
export class SectionErrors extends Error {
  constructor(errors) {
    super(errors.map((e) => `${e.path}: ${e.message}`).join('\n'));
    this.name = 'SectionErrors';
    this.errors = errors;
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * -> { spec } for an inline object, { spec, file } for a file, or { error }
 * naming the fix. `dir` is the explainer spec's folder.
 */
export function readDiagramSpec(diagram, dir) {
  if (isObject(diagram)) return { spec: diagram };
  const ref = resolveRef(dir, diagram, { exts: DIAGRAM_EXTS });
  if (ref.error) return { error: ref.error };
  const size = fs.statSync(ref.abs).size;
  if (size > DIAGRAM_MAX_BYTES) {
    return { error: `${JSON.stringify(diagram)} is ${(size / 1024).toFixed(0)} KB; the limit is ${DIAGRAM_MAX_BYTES / 1024} KB — split the diagram` };
  }
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(ref.abs, 'utf8'));
  } catch (e) {
    return { error: `${JSON.stringify(diagram)} is not valid JSON: ${e.message}` };
  }
  if (!isObject(spec)) return { error: `${JSON.stringify(diagram)} must hold one JSON object (a diagram spec)` };
  return { spec, file: diagram };
}

/** A make-diagram error path ("nodes[0].label", or "" for the whole spec) under `base`. */
export const repath = (base, p) => (p ? `${base}${p.startsWith('[') ? '' : '.'}${p}` : base);

/** make-diagram errors as errors under `base`; a file's errors also name the file. */
export function reportDiagramErrors(errors, base, file) {
  return errors.map((e) => ({ path: repath(base, e.path), message: file ? `${e.message} (in ${file})` : e.message }));
}

/** The diagram spec drawn under the page's theme: its own `theme` field is dropped, `theme` (a name) is set when given. */
export function inPageTheme(diagramSpec, theme) {
  const { theme: _embedded, ...rest } = diagramSpec;
  return theme === undefined ? rest : { ...rest, theme };
}
