// question: an open question with a free-text answer; a blank answer means the default applies. Read only
// in a deck.
import { inline, plain } from './ui.mjs';
import { page, isDeck, planItem, staticItem, kicker } from './plan-ui.mjs';

export { page };

const fallback = (section) => (section.default === undefined
  ? '<p class="plan-default">A blank answer leaves it open.</p>'
  : `<p class="plan-default"><span class="plan-default-k">A blank answer means the default applies:</span> ${inline(section.default)}</p>`);

export function render(section, ctx) {
  const head = `${kicker('Open question')}\n<p class="plan-q">${inline(section.text)}</p>`;
  if (isDeck(ctx)) return staticItem('question', `${head}\n${fallback(section)}`);
  return planItem('question', section.id, section.text, `${head}
<textarea class="plan-text" data-answer rows="3" aria-label="Answer: ${plain(section.text)}"></textarea>
${fallback(section)}`);
}
