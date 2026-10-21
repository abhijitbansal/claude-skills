// review: the 1 to 5 places a reviewer should look hardest, each with why and an in-page link to the section
// it points at (an explicit section id). The link is named after that section's title when the page knows it
// (ctx.targets: id -> title), else after the id. Same markup in a deck: the deck follows #<id> links itself.
import { esc, glyph, headingInline, inline } from './ui.mjs';

function link(target, ctx) {
  if (target === undefined) return '';
  const title = ctx.targets?.get(target);
  const name = title === undefined ? `<code>#${esc(target)}</code>` : headingInline(title);
  return `<a class="plan-review-go" href="#${esc(target)}"><span>Go to ${name}</span>${glyph('arrow')}</a>`;
}

export function render(section, ctx) {
  const items = section.items.map((item) => `<li class="plan-review-item">
<p class="plan-review-point">${inline(item.point)}</p>
<p class="plan-review-why">${inline(item.why)}</p>${item.target === undefined ? '' : `\n${link(item.target, ctx)}`}
</li>`);
  return `<ol class="plan-review">\n${items.join('\n')}\n</ol>`;
}
