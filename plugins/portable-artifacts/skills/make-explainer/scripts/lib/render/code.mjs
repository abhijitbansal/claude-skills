import { esc, inline } from './ui.mjs';

export function render(section) {
  const lang = section.language === undefined ? '' : `<span class="code-lang">${esc(section.language)}</span>`;
  const caption = section.caption === undefined ? '' : `\n<figcaption>${inline(section.caption)}</figcaption>`;
  return `<figure class="code">
<div class="code-bar">${lang}<button type="button" class="btn copy" data-copy aria-label="Copy code">Copy</button></div>
<pre tabindex="0"><code>${esc(section.code.replace(/\n+$/, ''))}</code></pre>${caption}
</figure>`;
}
