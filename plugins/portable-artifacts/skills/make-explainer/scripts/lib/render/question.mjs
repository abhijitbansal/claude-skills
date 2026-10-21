// question: an open question with a free-text answer; a blank answer means the default applies. Read only
// in a deck.
import { inline, plain } from './ui.mjs';
import { page, isDeck, planItem, staticItem, kicker } from './plan-ui.mjs';

export { page };

// A blank answer means the default applies; with no default it leaves the question open (said on a page only:
// a deck takes no answers).
const fallback = (section, deck) => {
  if (section.default !== undefined) return `\n<p class="plan-default"><span class="plan-default-k">A blank answer means the default applies:</span> ${inline(section.default)}</p>`;
  return deck ? '' : '\n<p class="plan-default">A blank answer leaves it open.</p>';
};

export function render(section, ctx) {
  const head = `${kicker('Open question')}\n<p class="plan-q">${inline(section.text)}</p>`;
  if (isDeck(ctx)) return staticItem('question', `${head}${fallback(section, true)}`);
  return planItem('question', { id: section.id, question: section.text, default: section.default }, `${head}
<textarea class="plan-text" data-answer rows="3" placeholder=" " aria-label="Answer: ${plain(section.text)}"></textarea>${fallback(section, false)}`);
}
