// Page assembly: one self-contained HTML file around a built scene. Theme CSS and fonts, the scene CSS,
// the embeddable fragment, the runtime inlined once, the theme toggle and the provenance footer.
// No network, no LLM. Every string from the spec goes through esc().
import fs from 'node:fs';
import { themeCss } from '../../shared/theme.mjs';
import { faviconLink } from '../../shared/icons.mjs';
import { generatorMeta, provenanceHtml, buildDate } from '../../shared/provenance.mjs';
import { toggleIcons, TOGGLE_CSS, TOGGLE_JS } from '../../shared/theme-toggle.mjs';
import { esc, inlineCode, inlineCss } from './markup.mjs';

const TEMPLATE = new URL('../../template/page.html', import.meta.url);

/**
 * The finished page for `spec`. `built` is buildScene's (or sceneFromGraph's) result and `theme` the loaded
 * theme the page uses.
 */
export function renderPage(spec, built, { theme, env = process.env }) {
  const parts = {
    TITLE: esc(spec.title),
    SUBTITLE: spec.subtitle ? `<p class="sub">${esc(spec.subtitle)}</p>` : '',
    PROVENANCE: provenanceHtml('make-scene', spec.generatedBy, buildDate(env)),
    FAVICON: faviconLink('make-scene', theme),
    GENERATOR: generatorMeta('make-scene', spec.generatedBy),
    TOGGLE_ICONS: toggleIcons(),
    TOGGLE_CSS,
    TOGGLE_JS: inlineCode(TOGGLE_JS),
    THEME: inlineCss(themeCss(theme)),
    SCENE_CSS: inlineCss(built.css),
    SCENE: built.html,
    RUNTIME: inlineCode(built.runtime),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
}
