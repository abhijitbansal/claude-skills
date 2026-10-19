// scene section: a make-scene 3D scene inline, in a 16:9 frame. The page ships make-scene's runtime and
// css once, plus a small script (template/scene.js) that mounts each scene when it scrolls into view.
// Until then, and whenever WebGL is unavailable, the frame shows the scene's semantic table. A deck and
// print show that table only: a deck ships no runtime at all.
// The scene is built before rendering (render is synchronous): prepare() runs in buildPage, keeps the
// result in ctx.scenes.items, and render() reads it.
import fs from 'node:fs';
import { loadSibling } from '../siblings.mjs';
import { readSceneSpec, reportSceneErrors } from '../scene-source.mjs';
import { inPageTheme } from '../diagram-source.mjs';
import { SectionErrors } from '../section-errors.mjs';
import { inline } from './ui.mjs';

const OWN_CSS = new URL('../../../template/scene.css', import.meta.url);
const OWN_JS = new URL('../../../template/scene.js', import.meta.url);

// Per-page state, created by the first prepare: the built scenes by section, make-scene's css and runtime.
const state = (ctx) => (ctx.scenes ??= { items: new Map(), css: '', runtime: '' });

// Ids are prefixed per section index; "_" keeps them apart from section and heading ids.
const idPrefix = (i) => `sc_${i}`;

// A visual section: every second one on a page sits on the surface band.
export const band = true;

export async function prepare(section, ctx, i) {
  const source = readSceneSpec(section.scene, ctx.dir);
  if (source.error) throw new SectionErrors([{ path: 'scene', message: source.error }]);
  const api = await loadSibling('make-scene', 'scripts/lib/api.mjs');
  const spec = inPageTheme(source.spec);
  const checked = await api.validateSpec(spec, { dir: source.dir });
  if (!checked.ok) throw new SectionErrors(reportSceneErrors(checked.errors, 'scene', source.file));
  let built;
  try {
    built = await api.buildScene(spec, { dir: source.dir, theme: ctx.theme, idPrefix: idPrefix(i) });
  } catch (e) {
    if (e.name === 'SceneError' && Array.isArray(e.errors)) throw new SectionErrors(reportSceneErrors(e.errors, 'scene', source.file));
    throw e;
  }
  const scenes = state(ctx);
  scenes.items.set(section, { built });
  scenes.css ||= built.css;
  scenes.runtime ||= built.runtime;
}

/** make-scene's stylesheet, then ours; its runtime and the lazy-mount script too, except in a deck (the table only). */
export function page(ctx) {
  const { css, runtime } = state(ctx);
  const own = fs.readFileSync(OWN_CSS, 'utf8').replace(/\n$/, '');
  return { css: `${css}\n${own}`, js: ctx.mode === 'slides' ? [] : [runtime, fs.readFileSync(OWN_JS, 'utf8')] };
}

export function render(section, ctx) {
  const entry = state(ctx).items.get(section);
  if (!entry) throw new Error('scene was not prepared; build the page with buildPage');
  const { built } = entry;
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  const body = ctx.mode === 'slides'
    ? `<div class="sc-fallback sc-fb-static" role="region" aria-label="Scene data as text">${built.fallbackHtml}</div>`
    : `<div class="sc-frame">${built.html}</div>`;
  return `<figure class="sc-fig">\n${body}${caption}\n</figure>`;
}
