// Embedding API: spec -> drawable diagram, for make-diagram's own builder and
// for other skills (make-explainer). Stable contract; see test/api.test.mjs.
import { loadTheme, DEFAULT_THEME } from '../../shared/theme.mjs';
import { validateSpec } from './spec.mjs';
import { layoutDiagram } from './layout.mjs';
import { lintGeometry } from './lint.mjs';
import { renderSvg, diagramCss } from './render.mjs';
import { DiagramError } from './diagram-error.mjs';
import { LIMITS } from './schema.mjs';
import { revealedBy } from './steps.mjs';
import { viewerData } from './data.mjs';
import { beatsOf } from './stories.mjs';
import { runtimeSource } from './runtime.mjs';

// validateSpec(spec, { layout }) -> { ok, errors }: the same checks buildDiagram runs, for callers that only validate.
export { validateSpec } from './spec.mjs';

const ID_PREFIX = /^[A-Za-z0-9_-]+$/;

const first = (items, fallback) => items[0] ?? fallback;

// One step per layer of a graph, in layer order; a layer's title names its first node.
function layerSteps(spec, geometry) {
  const label = new Map(spec.nodes.map((n) => [n.id, n.label.replace(/\s+/g, ' ').trim()]));
  return geometry.layers.map((ids) => ({
    title: ids.length === 1 ? label.get(ids[0]) : `${label.get(first(ids))} and ${ids.length - 1} more`,
    show: [...ids],
    focus: [...ids],
  }));
}

// A sequence has no layers: one step per message (or per chunk of messages
// when there are more than the step limit), the first step also showing every participant.
function messageSteps(spec, limit) {
  const messages = spec.messages ?? [];
  const per = Math.max(1, Math.ceil(messages.length / limit));
  if (messages.length === 0) {
    const ids = spec.participants.map((p) => p.id);
    return [{ title: 'Participants', show: ids, focus: [...ids] }];
  }
  const label = new Map(spec.participants.map((p) => [p.id, p.label.replace(/\s+/g, ' ').trim()]));
  const steps = [];
  for (let i = 0; i < messages.length; i += per) {
    const chunk = messages.slice(i, i + per);
    const [head] = chunk;
    const name = head.label ?? `${label.get(head.from)} to ${label.get(head.to)}`;
    const ids = chunk.map((m) => m.id);
    steps.push({
      title: chunk.length === 1 ? name : `${name} and ${chunk.length - 1} more`,
      show: i === 0 ? [...spec.participants.map((p) => p.id), ...ids] : ids,
      focus: [...new Set(chunk.flatMap((m) => [m.id, m.from, m.to]))],
    });
  }
  return steps;
}

const copyList = (list) => (list ? [...list] : undefined);

// A spec's steps as fresh objects and arrays (nothing shared with the caller).
function copySteps(steps) {
  return steps.map((s) => {
    const copy = { ...s };
    for (const key of ['show', 'focus', 'highlight']) if (s[key]) copy[key] = copyList(s[key]);
    return copy;
  });
}

// Authored steps may leave ids out. The viewer hides what no step has revealed,
// so a final step ("Everything") shows the rest and fits the whole diagram.
// At the step limit the rest joins the last step instead of adding a 26th.
function withEverything(spec, steps, ids) {
  const revealed = revealedBy(spec, steps);
  const rest = ids.filter((id) => !revealed.has(id));
  if (rest.length === 0) return steps;
  if (steps.length >= LIMITS.steps) {
    const last = steps.at(-1);
    return [...steps.slice(0, -1), { ...last, show: [...(last.show ?? []), ...rest] }];
  }
  return [...steps, { title: 'Everything', show: rest, focus: [...ids] }];
}

function stepsOf(spec, geometry, ids) {
  let steps;
  if (spec.steps?.length) steps = copySteps(spec.steps);
  else if (spec.type === 'sequence') steps = messageSteps(spec, LIMITS.steps);
  else steps = layerSteps(spec, geometry);
  // Built steps too: a group with no nodes is revealed by no layer.
  return withEverything(spec, steps, ids);
}

// Ids a step can name: groups and nodes, or participants and messages.
const idsOf = (spec) => (spec.type === 'sequence'
  ? [...spec.participants.map((p) => p.id), ...(spec.messages ?? []).map((m) => m.id)]
  : [...(spec.groups ?? []).map((g) => g.id), ...spec.nodes.map((n) => n.id)]);

/** The viewer's core script (camera, trace, story, transport and the mount that wires them) without toolbar chrome, for embedding. */
export function viewerRuntime() {
  return runtimeSource();
}

/**
 * Build a diagram from a spec.
 *
 * `theme` is a theme name or a loaded theme object (default: the spec's theme,
 * else paper). Resolves to { svg, css, width, height, steps, ids, data, geometry }:
 * `svg` uses classes and CSS variables only (no fonts, no <style>; include
 * `css` once per page), `steps` is the spec's steps (copied; ids it never
 * reveals get a final "Everything" step) or ones built from the layout, `ids`
 * lists every id a step can name, `data` is what `PADiagram.mount`
 * (viewerRuntime()) takes along with the `svg` (it also carries the story timeline
 * `beats` and `chapters`, per-id `info`, `directed` out-edges and `autoplay`), and `idPrefix`
 * (^[A-Za-z0-9_-]+$) namespaces the SVG's ids when several diagrams share a page. Throws DiagramError when the
 * spec is invalid or the layout fails the geometry lint.
 */
export async function buildDiagram(spec, { theme, idPrefix } = {}) {
  if (idPrefix !== undefined && !ID_PREFIX.test(idPrefix)) {
    throw new TypeError(`idPrefix must match ${ID_PREFIX} (letters, digits, "_" and "-"), got ${JSON.stringify(idPrefix)}`);
  }
  const semantic = await validateSpec(spec, { layout: false });
  if (!semantic.ok) throw new DiagramError(semantic.errors);
  const resolved = typeof theme === 'object' && theme !== null ? theme : loadTheme(theme ?? spec.theme ?? DEFAULT_THEME);
  const geometry = await layoutDiagram(spec, resolved);
  const lint = lintGeometry(geometry, { theme: resolved });
  if (lint.length > 0) throw new DiagramError(lint);
  const ids = idsOf(spec);
  const steps = stepsOf(spec, geometry, ids);
  const { beats, chapters } = beatsOf(spec, steps);
  const width = geometry.width;
  const height = geometry.height;
  return {
    svg: renderSvg(geometry, spec, { theme: resolved, ...(idPrefix ? { idPrefix } : {}) }),
    css: diagramCss(),
    width,
    height,
    steps,
    ids,
    data: viewerData(spec, { geometry, steps, ids, width, height, beats, chapters }),
    geometry,
  };
}
