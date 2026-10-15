import { chip, inline, STATUS, lookup } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

export function render(section) {
  const items = section.items.map((s) => `<li class="step">
<div class="step-head"><strong class="step-title">${inline(s.title)}</strong>${s.status === undefined ? '' : chip(lookup(STATUS, s.status, 'todo'))}</div>
${s.text === undefined ? '' : renderMarkdown(s.text)}
</li>`);
  return `<ol class="steps">\n${items.join('\n')}\n</ol>`;
}
