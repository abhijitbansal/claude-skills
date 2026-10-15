import { inline } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

export function render(section) {
  return `<details class="det">
<summary>${inline(section.summary)}</summary>
<div class="det-body prose">
${renderMarkdown(section.text)}
</div>
</details>`;
}
