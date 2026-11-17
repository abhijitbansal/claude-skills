// Page assembly: one self-contained HTML file around a built diagram. Theme CSS
// and fonts, diagram CSS, the SVG, a hidden text alternative, a JSON data block
// and the inlined runtime (template/*.js in the order scripts/lib/runtime.mjs fixes, then template/toolbar.js chrome).
// No network, no LLM. Every string from the spec goes through esc().
import fs from 'node:fs';
import { themeCss } from '../../shared/theme.mjs';
import { esc } from './svg.mjs';
import { runtimeSource } from './runtime.mjs';
import { legendItems } from './legend.mjs';
import { FAMILIES, KINDS } from './kinds.mjs';
import { faviconLink } from '../../shared/icons.mjs';
import { generatorMeta, provenanceHtml, buildDate } from '../../shared/provenance.mjs';
import { toggleIcons, TOGGLE_CSS, TOGGLE_JS } from '../../shared/theme-toggle.mjs';

const TEMPLATE = new URL('../../template/viewer.html', import.meta.url);
const CHROME = new URL('../../template/toolbar.js', import.meta.url);

// Covers the worst page a spec that passes validation can make (test/helpers/limit-specs.mjs):
// 60 nodes with the 60 largest brand icons, 400-char details, 8 stories and "&" in every text
// field builds about 920 KB (ordinary text, about 540 KB); the limit adds ~10%. Brand icons are
// drawn once per page (svg.mjs shareBrandIcons), so they cost at most the 60 largest paths, ~120 KB.
// make-explainer's DIAGRAM_MAX_BYTES bounds the spec file, not this page, so the two stay independent.
export const MAX_PAGE_BYTES = 1024 * 1024;

// JSON that is safe inside <script type="application/json">.
export function jsonForScript(obj) {
  return JSON.stringify(obj)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

// Inline script text must not close its tag or open an HTML comment.
const inlineCode = (code) => code.replace(/<\/(script)/gi, '<\\/$1').replaceAll('<!--', '<\\!--');
const oneLine = (text) => String(text).replace(/\s+/g, ' ').trim();
// ---- hidden text alternative --------------------------------------------------------

const li = (text) => `<li>${esc(text)}</li>`;

function graphText(spec) {
  const label = new Map([...(spec.groups ?? []), ...spec.nodes].map((x) => [x.id, oneLine(x.label)]));
  const nodeLine = (n) => `${oneLine(n.label)}${n.kind ? ` (${n.kind})` : ''}${n.note ? `: ${oneLine(n.note)}` : ''}`;
  const level = (parent) => {
    const groups = (spec.groups ?? []).filter((g) => (g.parent ?? null) === parent);
    const members = spec.nodes.filter((n) => (n.group ?? null) === parent);
    return [
      ...members.map((n) => li(nodeLine(n))),
      ...groups.map((g) => `<li>${esc(`Group ${oneLine(g.label)}`)}<ul>${level(g.id)}</ul></li>`),
    ].join('');
  };
  const edges = (spec.edges ?? []).map((e) => {
    const arrow = e.both ? '↔' : '→';
    return li(`${label.get(e.from)} ${arrow} ${label.get(e.to)}${e.label ? `: ${oneLine(e.label)}` : ''}`);
  });
  return `<h3>Nodes</h3><ul>${level(null)}</ul>${edges.length ? `<h3>Connections</h3><ul>${edges.join('')}</ul>` : ''}`;
}

function sequenceText(spec) {
  const label = new Map(spec.participants.map((p) => [p.id, oneLine(p.label)]));
  const position = new Map((spec.messages ?? []).map((m, i) => [m.id, i + 1]));
  const people = spec.participants.map((p) => li(`${oneLine(p.label)}${p.kind ? ` (${p.kind})` : ''}`));
  const messages = (spec.messages ?? []).map((m) => li(`${label.get(m.from)} → ${label.get(m.to)}${m.label ? `: ${oneLine(m.label)}` : ''}${m.kind && m.kind !== 'sync' ? ` (${m.kind})` : ''}`));
  const frames = (spec.frames ?? []).map((f) => {
    const nums = f.messages.map((id) => position.get(id));
    return li(`${f.kind}${f.label ? ` ${oneLine(f.label)}` : ''}: messages ${Math.min(...nums)} to ${Math.max(...nums)}`);
  });
  const notes = (spec.notes ?? []).map((n) => {
    const over = n.over.map((id) => label.get(id)).join(' and ');
    const after = n.after === undefined ? '' : `, after message ${position.get(n.after)}`;
    return li(`${oneLine(n.text)} (over ${over}${after})`);
  });
  return `<h3>Participants</h3><ul>${people.join('')}</ul>${messages.length ? `<h3>Messages in order</h3><ol>${messages.join('')}</ol>` : ''}${frames.length ? `<h3>Frames</h3><ul>${frames.join('')}</ul>` : ''}${notes.length ? `<h3>Notes</h3><ul>${notes.join('')}</ul>` : ''}`;
}

function textAlternative(spec) {
  const body = spec.type === 'sequence' ? sequenceText(spec) : graphText(spec);
  const subtitle = spec.subtitle ? `<p>${esc(oneLine(spec.subtitle))}</p>` : '';
  return `<section class="sr-only" aria-label="Diagram as text"><h2>${esc(spec.title)}</h2>${subtitle}${body}</section>`;
}

// ---- legend overlay ---------------------------------------------------------------------
// The key as HTML in the stage's corner: the in-SVG legend scales with the camera and
// is unreadable at fit on a wide diagram. Same items as the drawn one (legend.mjs).

const WIRE_LOOK = { solid: 'solid', dashed: 'dashed', async: 'dotted' };

const legendWord = (it) => (it.kind === 'kind' ? `${it.count} ${it.name}` : it.label);

function legendMark(it, type) {
  if (it.kind === 'style') return `<i class="lg-wire lg-wire-${WIRE_LOOK[it.style]}"></i>`;
  const shape = KINDS[type].kinds[it.name]?.shape ?? 'rounded-rect';
  return `<i class="lg-sw lg-sw-${esc(it.family)} lg-shape-${esc(shape)}"></i>`;
}

// On a phone the keys fold behind a labelled toggle (viewer.html, toolbar.js); on a desktop the toggle is not shown.
// The overlay stays decorative (the text alternative names every node), so the toggle is a pointer control only.
function legendHtml(spec) {
  const items = legendItems(spec).map((it) => `<span class="lg">${legendMark(it, spec.type)}${esc(legendWord(it))}</span>`);
  const toggle = `<button type="button" class="lg-toggle" data-pa-legend-toggle tabindex="-1" aria-expanded="false" aria-controls="pa-legend-keys">Legend <span class="lg-count">${items.length}</span></button>`;
  return `<div class="legend" data-pa-legend aria-hidden="true">${toggle}<div class="lg-keys" id="pa-legend-keys">${items.join('')}</div></div>`;
}

// The overlay swatches match the nodes as the drawn legend does (css.mjs legendRules): a neutral box with the hue as
// its centre inside a surface ring (a card's tile and icon), dashed for external, a bare neutral diamond for a
// decision or choice, dots for start and end; the box edge follows the card outline, --text-3 in dark.
const legendCss = () => [
  '@media (prefers-color-scheme: dark){:where(:root:not([data-theme="light"])) .lg-sw{border-color:var(--text-3)}}',
  ':where(:root[data-theme="dark"]) .lg-sw{border-color:var(--text-3)}',
  ...FAMILIES.map((f) => `.lg-sw-${f}{background:var(--k-${f});box-shadow:inset 0 0 0 3px var(--surface)}`),
  '.lg-sw-external{border-style:dashed;border-color:var(--text-3)}',
  '.lg-shape-diamond,.lg-shape-small-diamond{background:var(--surface);box-shadow:none;border-color:var(--text-3);transform:rotate(45deg) scale(.75)}',
  '.lg-shape-stadium{width:14px;height:8px;border-radius:999px;border-color:var(--text-3)}',
  '.lg-shape-filled-dot{width:9px;height:9px;border-radius:50%;border-color:var(--text-2);background:var(--text-2)}',
  '.lg-shape-ringed-dot{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--text-2);background:var(--surface)}',
].join('\n');

// ---- build record ----------------------------------------------------------------------------

// What a rebuild needs: the spec's file name, the theme and the flags that chose it. File names only, never a folder.
function buildMeta(build, theme) {
  if (!build) return '';
  const flags = (build.flags ?? []).join(' ') || 'none';
  const content = [`spec=${build.spec}`, `theme=${theme.name}`, `out=${build.out}`, `flags=${flags}`].join('; ');
  return `<meta name="pa-build" content="${esc(content)}">`;
}

// ---- page ---------------------------------------------------------------------------------

/**
 * The finished page for `spec`. `built` is buildDiagram's result and `theme`
 * the loaded theme it was built with. `build` ({ spec, out, flags }, file names only) is
 * recorded in the page's pa-build meta when given.
 */
export function renderViewer(spec, built, { theme, env = process.env, build }) {
  const parts = {
    TITLE: esc(spec.title),
    SUBTITLE: spec.subtitle ? `<p class="sub">${esc(spec.subtitle)}</p>` : '',
    PROVENANCE: provenanceHtml('make-diagram', spec.generatedBy, buildDate(env)),
    FAVICON: faviconLink('make-diagram', theme),
    GENERATOR: generatorMeta('make-diagram', spec.generatedBy),
    BUILD_META: buildMeta(build, theme),
    TOGGLE_ICONS: toggleIcons(),
    TOGGLE_CSS,
    TOGGLE_JS: inlineCode(TOGGLE_JS),
    THEME: themeCss(theme),
    DIAGRAM_CSS: built.css,
    LEGEND_CSS: legendCss(),
    LEGEND: legendHtml(spec),
    SVG: built.svg,
    TEXT: textAlternative(spec),
    DATA: jsonForScript(built.data),
    CORE: inlineCode(runtimeSource()),
    CHROME: inlineCode(fs.readFileSync(CHROME, 'utf8')),
  };
  return fs.readFileSync(TEMPLATE, 'utf8').replace(/<!--@(\w+)-->/g, (_, key) => parts[key] ?? '');
}
