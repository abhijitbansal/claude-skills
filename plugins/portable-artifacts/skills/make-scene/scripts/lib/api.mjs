// Embedding API: spec -> scene (graph, embeddable fragment, CSS, runtime), for make-scene's own build and
// for other skills (make-explainer). No process.exit, no file writes; the page theme is the caller's.
import fs from 'node:fs';
import { assertGraph } from './graph.mjs';
import { readBundle } from './bundle.mjs';
import { fallbackHtml, inlineCss, jsonForScript } from './markup.mjs';
import { recommend } from './recommend.mjs';
import { DataError, loadData } from './rows.mjs';
import { themeFor } from './theme.mjs';
import { WORLDS } from '../worlds/index.mjs';
import { liftDashboard, liftDiagram } from '../lifts/index.mjs';
import { SceneError } from './scene-error.mjs';

// validateSpec(spec, { dir, allowOutside }) -> { ok, errors }: the same checks a build runs, for callers that only validate.
export { validateSpec } from './spec.mjs';

const CHROME_CSS = new URL('../../template/page.css', import.meta.url);
const ID_PREFIX = /^[A-Za-z0-9_-]+$/;

/** A problem with the scene's content (not a bug): errors are [{ path, message }], like the validator's. */
export { SceneError };

// Spec tour beats -> graph tour entries. A beat flies to the first focus that names a group or label
// of the graph; a beat that names none keeps its first entry (the chrome shows its caption and stays put).
function tourFrom(spec, graph) {
  return (spec.tour ?? []).map((beat) => {
    const keys = beat.focus.map((f) => f.toLowerCase());
    return {
      title: beat.title,
      caption: beat.caption ?? '',
      focus: keys.find((k) => Object.hasOwn(graph.focus, k)) ?? keys[0],
      path: null,
      reverse: false,
    };
  });
}

/** The CSS the fragment needs: the chrome, plus a lift's own fallback css (once). */
export function sceneCss(graph) {
  const own = graph.fallback?.css;
  return `${fs.readFileSync(CHROME_CSS, 'utf8')}${own ? `\n${inlineCss(own)}` : ''}`;
}

/**
 * Assemble the embeddable pieces for a finished graph (any world or lift).
 * `html` is the fragment: the host div, the semantic fallback and the graph as a JSON data block.
 * The fallback is not repeated in the data block (the runtime never reads it).
 */
export function sceneFromGraph(graph, { idPrefix = 'sc', autoplay = false } = {}) {
  if (!ID_PREFIX.test(String(idPrefix))) throw new TypeError(`idPrefix must be letters, digits, "_" or "-"; got ${JSON.stringify(idPrefix)}`);
  const fallback = fallbackHtml(graph);
  const data = jsonForScript({ ...graph, fallback: undefined });
  const attrs = `id="${idPrefix}" data-pa-scene data-scene-state="loading"${autoplay && graph.tour.length > 0 ? ' data-autoplay' : ''}`;
  const html = [
    `<div class="pa-scene" ${attrs}>`,
    '<div class="sc-stage" data-scene-canvas></div>',
    `<div class="sc-fallback" data-scene-fallback role="region" aria-label="Scene data as text">${fallback}</div>`,
    `<script type="application/json" id="${idPrefix}-data">${data}</script>`,
    '</div>',
  ].join('');
  return { graph, html, css: sceneCss(graph), runtime: readBundle(), fallbackHtml: fallback, bytes: Buffer.byteLength(html) };
}

// A lift's graph: a diagram's own stories play as the tour unless the spec gives one; the scene's title names it.
async function liftGraph(spec, { dir, theme, idPrefix, allowOutside }) {
  const fallbackPrefix = `${idPrefix}-fb`;
  const lifted = spec.lift.diagram !== undefined
    ? await liftDiagram(spec.lift.diagram, { dir, theme, idPrefix: fallbackPrefix })
    : await liftDashboard({ dashboard: spec.lift.dashboard, chart: spec.lift.chart }, { dir, theme, idPrefix: fallbackPrefix, allowOutside, units: spec.units });
  assertGraph(lifted);
  const withTitle = { ...lifted, title: spec.title };
  return { world: null, graph: (spec.tour ?? []).length > 0 ? { ...withTitle, tour: tourFrom(spec, withTitle) } : withTitle };
}

async function graphFor(spec, ctx) {
  if (spec.lift !== undefined) return liftGraph(spec, ctx);
  const { dir } = ctx;
  let data;
  try {
    data = loadData(spec, dir);
  } catch (e) {
    if (e instanceof DataError) throw new SceneError(e.errors);
    throw e;
  }
  const world = spec.world ?? recommend(data).ranked[0];
  if (!Object.hasOwn(WORLDS, world)) throw new SceneError([{ path: 'world', message: `unknown world ${JSON.stringify(world)}; use one of ${Object.keys(WORLDS).join(', ')}` }]);
  const built = WORLDS[world](data, spec);
  assertGraph(built);
  return { world, graph: { ...built, tour: tourFrom(spec, built) } };
}

/**
 * buildScene(spec, { dir, theme, idPrefix }) -> { graph, html, css, runtime, fallbackHtml, bytes, world }
 * (`world` is null for a lift)
 * `spec` is a validated scene spec; `dir` is its folder (data paths resolve there). `theme` is the page's
 * theme (name or loaded) and is checked here so a bad one fails before any work; the 3D view reads its
 * colours from the page's CSS variables at runtime. `idPrefix` namespaces the ids, so several scenes can
 * share a page. `allowOutside` lets a lifted dashboard read data from outside its folder. Throws SceneError for content problems.
 */
export async function buildScene(spec, { dir = process.cwd(), theme, idPrefix = 'sc', allowOutside = false } = {}) {
  const loaded = themeFor(spec, theme);
  const { world, graph } = await graphFor(spec, { dir, theme: loaded, idPrefix, allowOutside });
  return { ...sceneFromGraph(graph, { idPrefix, autoplay: spec.autoplay === true }), world };
}
