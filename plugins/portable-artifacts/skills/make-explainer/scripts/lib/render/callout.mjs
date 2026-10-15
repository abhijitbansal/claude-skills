import { chip, inline, CALLOUT, lookup } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

// The callout title is its own heading, so the page wrapper adds none.
export const ownHeading = true;

export function render(section) {
  const entry = lookup(CALLOUT, section.tone, 'info');
  return `<aside class="callout tone-${entry[2]}">
<p class="callout-head">${chip(entry)}<strong class="callout-title">${inline(section.title)}</strong></p>
${renderMarkdown(section.text)}
</aside>`;
}
