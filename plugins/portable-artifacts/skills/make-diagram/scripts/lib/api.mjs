// Embedding API: spec -> drawable diagram, for make-diagram's own builder and
// for other skills (make-explainer). Stable contract; see test/api.test.mjs.
import { loadTheme, DEFAULT_THEME } from '../../shared/theme.mjs';
import { validateSpec } from './spec.mjs';
import { layoutDiagram } from './layout.mjs';
import { lintGeometry } from './lint.mjs';
import { renderSvg, diagramCss } from './render.mjs';
import { DiagramError } from './diagram-error.mjs';

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

const MAX_STEPS = 25;

function stepsOf(spec, geometry) {
  if (spec.steps?.length) return spec.steps.map((s) => ({ ...s }));
  if (spec.type === 'sequence') return messageSteps(spec, MAX_STEPS);
  return layerSteps(spec, geometry);
}

// Ids a step can name: groups and nodes, or participants and messages.
const idsOf = (spec) => (spec.type === 'sequence'
  ? [...spec.participants.map((p) => p.id), ...(spec.messages ?? []).map((m) => m.id)]
  : [...(spec.groups ?? []).map((g) => g.id), ...spec.nodes.map((n) => n.id)]);

/**
 * Build a diagram from a spec.
 *
 * `theme` is a theme name or a loaded theme object (default: the spec's theme,
 * else paper). Resolves to { svg, css, width, height, steps, ids, geometry }:
 * `svg` uses classes and CSS variables only (no fonts, no <style>; include
 * `css` once per page), `steps` is the spec's steps or ones built from the
 * layout, `ids` lists every id a step can name. Throws DiagramError when the
 * spec is invalid or the layout fails the geometry lint.
 */
export async function buildDiagram(spec, { theme, idPrefix } = {}) {
  const semantic = await validateSpec(spec, { layout: false });
  if (!semantic.ok) throw new DiagramError(semantic.errors);
  const resolved = typeof theme === 'object' && theme !== null ? theme : loadTheme(theme ?? spec.theme ?? DEFAULT_THEME);
  const geometry = await layoutDiagram(spec, resolved);
  const lint = lintGeometry(geometry, { theme: resolved });
  if (lint.length > 0) throw new DiagramError(lint);
  return {
    svg: renderSvg(geometry, spec, { theme: resolved, ...(idPrefix ? { idPrefix } : {}) }),
    css: diagramCss(),
    width: geometry.width,
    height: geometry.height,
    steps: stepsOf(spec, geometry),
    ids: idsOf(spec),
    geometry,
  };
}
