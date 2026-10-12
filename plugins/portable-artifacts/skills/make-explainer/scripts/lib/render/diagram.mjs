// diagram section: make-diagram's SVG inline (hover tracing), a Present button
// and a full-screen overlay that runs the diagram's own step-by-step viewer.
// The SVG is built before rendering (render is synchronous): prepare() runs in
// buildPage, keeps the result in ctx.diagrams.items, and render() reads it.
// The page ships make-diagram's css and viewer script once (see page.mjs).
import { loadSibling } from '../siblings.mjs';
import { readDiagramSpec, reportDiagramErrors, inPageTheme, SectionErrors } from '../diagram-source.mjs';
import { esc, inline } from './ui.mjs';

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
  ctx.diagrams.items.set(section, { built, title: source.spec.title });
  ctx.diagrams.css ||= built.css;
  ctx.diagrams.runtime ||= api.viewerRuntime();
}

// JSON for a <script type="application/json"> block: "<" can never start a tag or a comment.
const jsonBlock = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const num = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n) : 1);

function overlay(title) {
  return `<dialog class="dg-overlay" data-dg-dialog aria-label="Diagram presentation: ${esc(title)}">
<div class="dg-top"><span class="dg-top-title">${esc(title)}</span><button type="button" class="btn" data-dg-close>Close <span class="dg-key" aria-hidden="true">Esc</span></button></div>
<div class="dg-body" data-dg-body></div>
<div class="dg-cap" data-pa-caption hidden>
<div class="dg-cap-text" aria-live="polite">
<p class="dg-cap-count" data-pa-count></p>
<p class="dg-cap-title" data-pa-title></p>
<p class="dg-cap-note" data-pa-note hidden></p>
</div>
<div class="dg-cap-nav"><button type="button" class="btn" data-pa-prev>Back</button><button type="button" class="btn" data-pa-next>Next</button></div>
</div>
</dialog>`;
}

export function render(section, ctx) {
  const entry = ctx.diagrams.items.get(section);
  if (!entry) throw new Error('diagram was not prepared; build the page with buildPage');
  const { built, title } = entry;
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  return `<figure class="dg" data-diagram>
<div class="dg-slot" data-dg-slot style="--dg-w: ${num(built.width)}; --dg-h: ${num(built.height)}; aspect-ratio: var(--dg-w) / var(--dg-h)">
<div class="dg-stage" data-dg-stage>${built.svg}</div>
</div>${caption}
<button type="button" class="btn dg-present" data-dg-present aria-haspopup="dialog" aria-label="Present diagram: ${esc(title)}">Present</button>
${overlay(title)}
<script type="application/json" data-dg-data>${jsonBlock(built.data)}</script>
</figure>`;
}
