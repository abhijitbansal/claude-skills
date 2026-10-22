// review: the 1 to 5 places a reviewer should look hardest, each with why and an in-page link to the section
// it points at (an explicit section id). The link is named by ctx.targets (id -> the link text as escaped HTML,
// built by page.mjs from the target's title, label or question), else by the id. Same markup in a deck: the deck
// follows #<id> links itself. It ships plan.css (no script: nothing to answer), shared with the answerable types.
import { esc, glyph, inline } from './ui.mjs';
import { page as planPage } from './plan-ui.mjs';

export const page = (ctx) => ({ css: planPage(ctx).css, js: [] });

function link(target, ctx) {
  if (target === undefined) return '';
  const known = ctx.targets?.get(target);
  const name = known === undefined ? `<code>#${esc(target)}</code>` : known;
  return `<a class="plan-review-go" href="#${esc(target)}"><span>Go to ${name}</span>${glyph('arrow')}</a>`;
}

export function render(section, ctx) {
  const items = section.items.map((item) => `<li class="plan-review-item">
<p class="plan-review-point">${inline(item.point)}</p>
<p class="plan-review-why">${inline(item.why)}</p>${item.target === undefined ? '' : `\n${link(item.target, ctx)}`}
</li>`);
  return `<ol class="plan-review">\n${items.join('\n')}\n</ol>`;
}
