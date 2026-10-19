// Diagram lift: a make-diagram diagram.json (inline object or a .json file in the spec folder) as a scene
// graph, built from make-diagram's own layout. Importing this module registers the `lift.diagram` check
// with the validator; make-diagram itself is loaded lazily, only when a spec lifts from it.
//
//   graph layouts (architecture, flow, state): diagram-flat.mjs      sequence: diagram-sequence.mjs
//   tour: spec.tour wins; otherwise the diagram's `stories` (capped at the scene's beat limit) become beats
//         { focus: the node the light ends at, path: the edge's tube id, reverse }.
import fs from 'node:fs';
import path from 'node:path';
import { emptyGraph } from '../lib/graph.mjs';
import { q, suggestion } from '../lib/checks.mjs';
import { SceneError } from '../lib/scene-error.mjs';
import { LIMITS } from '../lib/schema.mjs';
import { SCENE_THEME, themeFor } from '../lib/theme.mjs';
import { registerLiftCheck } from '../lib/spec.mjs';
import { loadSibling } from '../lib/siblings.mjs';
import { flatGraph } from './diagram-flat.mjs';
import { sequenceGraph } from './diagram-sequence.mjs';

export const DIAGRAM_MAX_BYTES = 1024 * 1024;
const AT = 'lift.diagram';
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** -> { spec, file? } for an inline object or a .json file in `dir`, or { error } naming the fix. Both are capped at 1 MB. */
function readSource(source, dir) {
  const tooBig = (what, bytes) => `${what} is ${Math.ceil(bytes / 1024)} KB; the limit is ${DIAGRAM_MAX_BYTES / 1024} KB; split the diagram`;
  if (isObject(source)) {
    const bytes = Buffer.byteLength(JSON.stringify(source));
    return bytes > DIAGRAM_MAX_BYTES ? { error: tooBig('the inline diagram', bytes) } : { spec: source };
  }
  const abs = path.resolve(dir, source);
  let bytes;
  let text;
  try {
    bytes = fs.statSync(abs).size;
    if (bytes <= DIAGRAM_MAX_BYTES) text = fs.readFileSync(abs, 'utf8');
  } catch (e) {
    return { error: `cannot read ${q(source)}: ${e.code ?? e.message}` };
  }
  if (text === undefined) return { error: tooBig(q(source), bytes) };
  let spec;
  try {
    spec = JSON.parse(text);
  } catch (e) {
    return { error: `${q(source)} is not valid JSON: ${e.message}` };
  }
  return isObject(spec) ? { spec, file: source } : { error: `${q(source)} must hold one JSON object (a diagram spec)` };
}

// make-diagram error paths ("nodes[0].label", or "" for the whole spec) under lift.diagram; a file's errors name the file.
const repath = (p) => (p ? `${AT}${p.startsWith('[') ? '' : '.'}${p}` : AT);
const reported = (errors, file) => errors.map((e) => ({ path: repath(e.path), message: file ? `${e.message} (in ${file})` : e.message }));

const sibling = (siblingRoot) => loadSibling('make-diagram', 'scripts/lib/api.mjs', siblingRoot === undefined ? {} : { root: siblingRoot });
const isSiblingError = (e) => e?.name === 'SiblingError';
const withoutTheme = ({ theme: _own, ...rest }) => rest; // the scene's theme draws it, as in make-explainer

// ---- tour -----------------------------------------------------------------

// A hop plays along its edge; the camera goes to the end the light reaches. A focus beat goes to its first id.
function tourOf(beats, focus) {
  return beats.slice(0, LIMITS.beats).map((beat) => {
    const ids = beat.ids.map((id) => id.toLowerCase());
    const target = beat.kind === 'hop' ? (beat.reverse ? ids[0] : ids.at(-1)) : ids.find((id) => Object.hasOwn(focus, id)) ?? ids[0];
    return {
      title: beat.title,
      caption: beat.caption ?? '',
      focus: target,
      path: beat.kind === 'hop' ? beat.edge : null,
      reverse: beat.kind === 'hop' && beat.reverse === true,
    };
  });
}

// ---- the lift --------------------------------------------------------------

/**
 * liftDiagram(source, { dir, theme, idPrefix, siblingRoot }) -> scene graph v1 (kind "diagram").
 * `source` is a diagram spec object or a .json path in `dir`; `theme` the loaded page theme. `idPrefix` namespaces the
 * 2D fallback's SVG ids. `siblingRoot` points at another folder of skills (tests). Throws SceneError with
 * paths under lift.diagram for an unreadable, too-big or invalid diagram, and for a missing make-diagram.
 */
export async function liftDiagram(source, { dir = process.cwd(), theme, idPrefix, siblingRoot } = {}) {
  const read = readSource(source, dir);
  if (read.error) throw new SceneError([{ path: AT, message: read.error }]);
  let api;
  try {
    api = await sibling(siblingRoot);
  } catch (e) {
    if (isSiblingError(e)) throw new SceneError([{ path: AT, message: e.message }]);
    throw e;
  }
  let built;
  try {
    built = await api.buildDiagram(withoutTheme(read.spec), { theme: themeFor({}, theme), ...(idPrefix ? { idPrefix } : {}) });
  } catch (e) {
    if (e?.name === 'DiagramError' && Array.isArray(e.errors)) throw new SceneError(reported(e.errors, read.file));
    throw e;
  }
  const graph = read.spec.type === 'sequence' ? sequenceGraph(built, read.spec) : flatGraph(built, read.spec);
  const tour = read.spec.stories?.length ? tourOf(built.data.beats, graph.focus) : [];
  return { ...graph, tour, fallback: { ...emptyGraph('diagram').fallback, kind: 'svg', svg: built.svg, css: built.css } };
}

// ---- the validator hook -------------------------------------------------------

const idsOf = (diagram) => (diagram.type === 'sequence'
  ? (diagram.participants ?? []).map((p) => p.id)
  : [...(diagram.nodes ?? []).map((n) => n.id), ...(diagram.groups ?? []).map((g) => g.id)]);

function checkTourFocus(scene, diagram) {
  const ids = idsOf(diagram).map((id) => id.toLowerCase());
  const what = diagram.type === 'sequence' ? 'a participant id' : 'a node or group id';
  const errors = [];
  (scene.tour ?? []).forEach((beat, i) => {
    beat.focus.forEach((f, j) => {
      if (ids.includes(f.toLowerCase())) return;
      errors.push({ path: `tour[${i}].focus[${j}]`, message: `${q(f)} is not ${what}; ${suggestion(f.toLowerCase(), ids)}` });
    });
  });
  return errors;
}

/**
 * The lift.diagram check: make-diagram's own validation (schema, semantics, layout lint) under lift.diagram.<path>,
 * then the tour's focus entries against the diagram's node, group and participant ids. `siblingRoot` is for tests.
 */
export async function diagramLiftCheck(scene, { dir }, { siblingRoot } = {}) {
  const read = readSource(scene.lift.diagram, dir);
  if (read.error) return [{ path: AT, message: read.error }];
  let api;
  try {
    api = await sibling(siblingRoot);
  } catch (e) {
    if (isSiblingError(e)) return [{ path: AT, message: e.message }];
    throw e;
  }
  // Checked under the theme the build will use: text widths, so the layout lint, depend on it.
  const result = await api.validateSpec({ ...withoutTheme(read.spec), theme: scene.theme ?? SCENE_THEME }, { layout: true });
  if (!result.ok) return reported(result.errors, read.file);
  return checkTourFocus(scene, read.spec);
}

registerLiftCheck('diagram', (scene, ctx) => diagramLiftCheck(scene, ctx));
