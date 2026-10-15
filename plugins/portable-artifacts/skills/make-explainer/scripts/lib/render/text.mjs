import { renderMarkdown } from '../markdown.mjs';

export function render(section) {
  return `<div class="prose">\n${renderMarkdown(section.text)}\n</div>`;
}
