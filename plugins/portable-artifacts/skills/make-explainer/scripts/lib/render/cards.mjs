import { esc, inline, toneChip, toneClass } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

const COLUMNS = [2, 3, 4];

// ctx.icons is make-diagram's icon module, loaded by buildPage only when a card has an icon.
function icon(ref, icons) {
  if (ref === undefined || !icons) return '';
  const { kind, markup, viewBox } = icons.iconSvg(ref);
  const paint = kind === 'brand' ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="card-icon" viewBox="${esc(viewBox)}" width="22" height="22" ${paint} aria-hidden="true" focusable="false">${markup}</svg>`;
}

// A visual section: every second one on a page sits on the surface band.
export const band = true;

export function render(section, ctx) {
  const cols = COLUMNS.includes(section.columns) ? ` cols-${section.columns}` : '';
  const cards = section.items.map((c) => `<li class="card ${toneClass(c.tone)}">
<div class="card-head">${icon(c.icon, ctx?.icons)}<h3>${inline(c.title)}</h3>${c.tag === undefined ? '' : `<span class="tag">${esc(c.tag)}</span>`}${toneChip(c.tone)}</div>
${renderMarkdown(c.text)}
</li>`);
  return `<ul class="cards${cols}">\n${cards.join('\n')}\n</ul>`;
}
