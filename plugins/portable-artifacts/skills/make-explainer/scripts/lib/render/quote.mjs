// quote section: one line set large, with who said it. Display face, a hanging opening mark and the attribution in
// the shared caps style (quote.css, shipped once per page by page()). The tone only picks the rule's colour.
import fs from 'node:fs';
import { inline, toneClass } from './ui.mjs';

const CSS = new URL('../../../template/quote.css', import.meta.url);

/** The quote stylesheet; the page (and the deck) includes it once, only when it has a quote. */
export function page() {
  return { css: fs.readFileSync(CSS, 'utf8').replace(/\n$/, ''), js: [] };
}

export function render(section) {
  const by = section.by === undefined ? '' : `\n<figcaption class="quote-by pa-caps">${inline(section.by)}</figcaption>`;
  return `<figure class="quote ${toneClass(section.tone)}">\n<blockquote>${inline(section.text)}</blockquote>${by}\n</figure>`;
}
