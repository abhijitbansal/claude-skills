import { esc, inline, toneChip, toneClass } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

const COLUMNS = [2, 3, 4];

// A cloud icon keeps its own colours, so its svg carries no paint of its own; a pack icon that paints in
// currentColor gets this fixed grey, as in make-diagram (tone and theme never tint a cloud icon). `.card-icon` sets
// `color` to the accent and a CSS rule beats a presentation attribute, so the grey is pinned on a nested <svg>,
// which fills the outer one (100% of its viewBox) and has no class of its own.
const CLOUD_CURRENT_COLOUR = '#6b7280';

// A cloud icon's gradient and mask ids are short; each drawn card icon gets its own prefix ("ci_" apart from section ids),
// numbered in render order, so two cards (or the normal and simple copies of one) never share an id.
function cloudIcon({ markup, viewBox }, icons, ctx) {
  const n = (ctx.cloudIcons = (ctx.cloudIcons ?? 0) + 1);
  const scoped = icons.scopeIds(markup, `ci_${n}`);
  const body = markup.includes('currentColor') ? `<svg width="100%" height="100%" color="${CLOUD_CURRENT_COLOUR}">${scoped}</svg>` : scoped;
  return `<svg class="card-icon" viewBox="${esc(viewBox)}" width="22" height="22" aria-hidden="true" focusable="false">${body}</svg>`;
}

// ctx.icons is make-diagram's icon module, loaded by buildPage only when a card has an icon.
function icon(ref, icons, ctx) {
  if (ref === undefined || !icons) return '';
  const { kind, markup, viewBox } = icons.iconSvg(ref);
  if (kind === 'cloud') return cloudIcon({ markup, viewBox }, icons, ctx);
  const paint = kind === 'brand' ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="card-icon" viewBox="${esc(viewBox)}" width="22" height="22" ${paint} aria-hidden="true" focusable="false">${markup}</svg>`;
}

// A visual section: every second one on a page sits on the surface band.
export const band = true;

export function render(section, ctx) {
  const cols = COLUMNS.includes(section.columns) ? ` cols-${section.columns}` : '';
  const cards = section.items.map((c) => `<li class="card ${toneClass(c.tone)}">
<div class="card-head">${icon(c.icon, ctx?.icons, ctx)}<h3>${inline(c.title)}</h3>${c.tag === undefined ? '' : `<span class="tag">${esc(c.tag)}</span>`}${toneChip(c.tone)}</div>
${renderMarkdown(c.text)}
</li>`);
  return `<ul class="cards${cols}">\n${cards.join('\n')}\n</ul>`;
}
