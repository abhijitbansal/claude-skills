import { esc, inline } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

export function render(section) {
  const items = section.items.map((t) => `<li class="tl-item">
<span class="tl-date">${esc(t.date)}</span>
<strong class="tl-title">${inline(t.title)}</strong>
${t.text === undefined ? '' : renderMarkdown(t.text)}
</li>`);
  return `<ol class="timeline">\n${items.join('\n')}\n</ol>`;
}
