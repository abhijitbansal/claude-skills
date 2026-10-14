// diagram section: make-diagram's SVG inline (hover tracing), a Present button
// and an overlay that runs make-diagram's whole viewer (Play story, Explore, full screen).
// The SVG is built before rendering (render is synchronous): prepare() runs in
// buildPage, keeps the result in ctx.diagrams.items, and render() reads it.
// The page ships make-diagram's css and viewer script, plus ours, once (page()).
import fs from 'node:fs';
import { loadSibling } from '../siblings.mjs';
import { readDiagramSpec, reportDiagramErrors, inPageTheme } from '../diagram-source.mjs';
import { SectionErrors } from '../section-errors.mjs';
import { esc, inline } from './ui.mjs';

const OWN_CSS = new URL('../../../template/diagram.css', import.meta.url);
const OWN_JS = new URL('../../../template/diagram.js', import.meta.url);

// Per-page state, created by the first prepare: the built figures by section, make-diagram's css and viewer.
const state = (ctx) => (ctx.diagrams ??= { items: new Map(), css: '', runtime: '' });

// SVG ids are prefixed per section index; "_" keeps them apart from section and heading ids.
const idPrefix = (i) => `dg_${i}`;

export async function prepare(section, ctx, i) {
  const source = readDiagramSpec(section.diagram, ctx.dir);
  if (source.error) throw new SectionErrors([{ path: 'diagram', message: source.error }]);
  const api = await loadSibling('make-diagram', 'scripts/lib/api.mjs');
  let built;
  try {
    built = await api.buildDiagram(inPageTheme(source.spec), { theme: ctx.theme, idPrefix: idPrefix(i) });
  } catch (e) {
    if (e.name === 'DiagramError' && Array.isArray(e.errors)) throw new SectionErrors(reportDiagramErrors(e.errors, 'diagram', source.file));
    throw e;
  }
  const diagrams = state(ctx);
  diagrams.items.set(section, { built, title: source.spec.title, prefix: idPrefix(i) });
  diagrams.css ||= built.css;
  diagrams.runtime ||= api.viewerRuntime();
}

/** make-diagram's stylesheet and viewer, then ours; the page includes them once. */
export function page(ctx) {
  const { css, runtime } = state(ctx);
  return { css: `${css}\n${fs.readFileSync(OWN_CSS, 'utf8').replace(/\n$/, '')}`, js: [runtime, fs.readFileSync(OWN_JS, 'utf8')] };
}

// JSON for a <script type="application/json"> block: "<" can never start a tag or a comment.
const jsonBlock = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const num = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 1);

// The side panel, with the hooks panel.js paints (make-diagram's viewer.html has the same ones).
function panel() {
  return `<aside class="dg-panel" data-pa-panel aria-label="Details">
<div class="dg-panel-head"><h2 class="dg-panel-title" data-pa-panel-title tabindex="-1" aria-live="polite">Map</h2><button type="button" class="btn" data-pa-panel-close aria-label="Close details (Esc)" hidden>Close</button></div>
<div class="dg-panel-empty" data-pa-empty><div class="dg-counts" data-pa-tally role="list" aria-label="What the map holds"></div><p class="dg-hint">Click a node or edge. Shift-click a second node to trace a path.</p></div>
<div class="dg-panel-body" data-pa-panel-body hidden></div>
</aside>`;
}

// The transport, with the hooks transport.js paints. The scrubber's datalist id is prefixed per figure.
function transport(prefix) {
  return `<div class="dg-cap" data-pa-caption aria-label="Story player" hidden>
<p class="dg-cap-line" data-pa-line aria-live="polite"></p>
<div class="dg-beats" data-pa-beats role="group" aria-label="Beats"></div>
<div class="dg-transport" role="group" aria-label="Transport">
<button type="button" class="btn" data-pa-prev-chapter title="Previous chapter">Prev chapter</button>
<button type="button" class="btn" data-pa-prev title="Previous beat (Left)">Prev</button>
<button type="button" class="btn" data-pa-play title="Play or pause (Space)">Play</button>
<button type="button" class="btn" data-pa-next title="Next beat (Right)">Next</button>
<button type="button" class="btn" data-pa-next-chapter title="Next chapter">Next chapter</button>
<input type="range" class="dg-scrub" data-pa-scrub min="0" max="0" step="1" value="0" aria-label="Beat" list="${prefix}-ticks">
<datalist id="${prefix}-ticks" data-pa-ticks></datalist>
<span class="dg-cap-count">Beat <span data-pa-count></span></span>
<button type="button" class="btn" data-pa-speed aria-label="Speed 1×; change speed" title="Playback speed">1×</button>
<button type="button" class="btn" data-pa-loop aria-pressed="false" title="Loop the story">Loop</button>
</div>
</div>`;
}

// The Present overlay: a <dialog> can never be fullscreen (browsers refuse it), so the whole viewer
// sits in a wrapper div, data-dg-root, which is the element full screen is asked for. The viewer: (tabs, Find, full screen, chapters, the stage with its
// tooltip, the panel, the transport) around the stage that diagram.js moves in while it is open.
function overlay(title, prefix) {
  return `<dialog class="dg-overlay" data-dg-dialog aria-label="Diagram presentation: ${esc(title)}">
<div class="dg-fs" data-dg-root>
<div class="dg-top">
<span class="dg-top-title">${esc(title)}</span>
<span class="dg-tools">
<span class="dg-modes" role="group" aria-label="Mode"><button type="button" class="btn" data-pa-mode="play" aria-pressed="true" title="Play the story (P)">Play story</button><button type="button" class="btn" data-pa-mode="explore" aria-pressed="false" title="Explore the diagram (E)">Explore</button></span>
<input type="search" class="dg-find" data-pa-find placeholder="Find a node" aria-label="Find a node" aria-keyshortcuts="/" autocomplete="off" spellcheck="false">
<button type="button" class="btn" data-pa-full aria-pressed="false" title="Full screen (F)">Full screen</button>
<button type="button" class="btn" data-dg-close>Close <span class="dg-key" aria-hidden="true">Esc</span></button>
</span>
</div>
<div class="dg-chapters" data-pa-chapters role="group" aria-label="Chapters" hidden></div>
<div class="dg-found" data-pa-found role="group" aria-label="Matching nodes" aria-live="polite" hidden></div>
<div class="dg-main">
<div class="dg-body" data-dg-body><div class="dg-tip" data-pa-tip role="tooltip" hidden></div></div>
${panel()}
</div>
${transport(prefix)}
</div>
</dialog>`;
}

export function render(section, ctx) {
  const entry = state(ctx).items.get(section);
  if (!entry) throw new Error('diagram was not prepared; build the page with buildPage');
  const { built, title, prefix } = entry;
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  // The figcaption is the figure's last child; the stylesheet's grid puts it beside the Present button.
  return `<figure class="dg" data-diagram style="--dg-w: ${num(built.width)}; --dg-h: ${num(built.height)}">
<div class="dg-slot" data-dg-slot data-dg-label="Diagram: ${esc(title)}">
<div class="dg-stage" data-dg-stage>${built.svg}</div>
</div>
<button type="button" class="btn dg-present" data-dg-present aria-haspopup="dialog" aria-label="Present diagram: ${esc(title)}">Present</button>
${overlay(title, prefix)}
<script type="application/json" data-dg-data>${jsonBlock(built.data)}</script>${caption}
</figure>`;
}
