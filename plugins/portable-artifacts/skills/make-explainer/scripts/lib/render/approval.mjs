// approval: one item to approve, ask changes on, or reject, with why, impact and owner. Read only in a deck.
import { inline, plain } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';
import { page, isDeck, planItem, staticItem, kicker, choices, commentBox, radioName } from './plan-ui.mjs';

export { page };

// value, word, glyph, tone: the runtime exports the value.
const ANSWERS = [
  ['approve', 'Approve', 'check', 'good'],
  ['changes', 'Needs changes', 'edit', 'warn'],
  ['reject', 'Reject', 'bad', 'bad'],
];

function facts(section) {
  const rows = [['Impact', section.impact], ['Owner', section.owner]]
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${inline(v)}</dd></div>`);
  return rows.length === 0 ? '' : `\n<dl class="plan-facts">${rows.join('')}</dl>`;
}

const body = (section) => `<div class="plan-body prose">
${renderMarkdown(section.why)}
</div>${facts(section)}`;

export function render(section, ctx) {
  if (isDeck(ctx)) return staticItem('approval', `${kicker('Approval needed')}\n<p class="plan-q">${inline(section.item)}</p>\n${body(section)}`);
  return planItem('approval', { id: section.id, question: section.item }, `${kicker('Approval needed')}
<fieldset class="plan-set">
<legend class="plan-q">${inline(section.item)}</legend>
${body(section)}
${choices(radioName(section.id), ANSWERS)}
</fieldset>
${commentBox('Comment (optional)', plain(section.item))}`);
}
