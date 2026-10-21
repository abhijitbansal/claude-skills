// verdict: the overall Approve / Approve with changes / Not yet, the reviewer's name and the export controls
// (the answer runtime wires the buttons and the notices). One per page, the last section. Read only in a deck.
import { chip, inline } from './ui.mjs';
import { page, isDeck, planItem, staticItem, kicker, choices } from './plan-ui.mjs';

export { page };

// The radio group name is fixed (a verdict needs no id). Items are "plan-<id>" and the id "verdict" is reserved on
// them, so the groups never meet. The container has no data-id: the runtime finds the verdict by data-kind.
const NAME = 'plan-verdict';
const QUESTION = 'Overall verdict';
const ANSWERS = [
  ['approve', 'Approve', 'check', 'good'],
  ['approve-with-changes', 'Approve with changes', 'edit', 'warn'],
  ['not-yet', 'Not yet', 'bad', 'bad'],
];

const prompt = (section) => (section.text === undefined ? 'Your overall verdict on this plan' : inline(section.text));

const controls = `<div class="plan-verdict-foot">
<label class="plan-field plan-reviewer"><span class="plan-field-label">Your name</span><input type="text" class="plan-input" data-reviewer autocomplete="name" placeholder=" "></label>
<div class="plan-actions">
<button type="button" class="btn plan-btn" data-plan-copy>Copy answers</button>
<button type="button" class="btn plan-btn" data-plan-download>Download plan-answers.json</button>
</div>
</div>
<p class="plan-status" data-plan-status role="status"></p>
<p class="plan-flag" data-plan-unsaved hidden>${chip(["Answers won't be saved in this browser", 'info', 'neutral'])}</p>
<p class="plan-flag" data-plan-stale hidden>${chip(['The plan changed since your last visit; earlier answers were cleared', 'warn', 'warn'])}</p>`;

export function render(section, ctx) {
  if (isDeck(ctx)) {
    const list = ANSWERS.map(([, word]) => `<li>${word}</li>`).join('');
    return staticItem('verdict', `${kicker('Your verdict')}\n<p class="plan-q">${prompt(section)}</p>\n<ul class="plan-verdict-static">${list}</ul>`);
  }
  return planItem('verdict', { question: QUESTION }, `${kicker('Your verdict')}
<fieldset class="plan-set">
<legend class="plan-q">${prompt(section)}</legend>
${choices(NAME, ANSWERS)}
</fieldset>
${controls}`);
}
