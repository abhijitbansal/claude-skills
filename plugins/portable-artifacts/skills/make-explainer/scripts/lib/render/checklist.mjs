import crypto from 'node:crypto';
import { chip, esc, inline, plain } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';

const ID_HEX = 10;
const DEFAULT_FAIL = '- Leave the box unticked.\n- Note the step, what you saw and what you expected.\n- Re-test after the fix, then re-run the regression checks.';

// Tags are a glyph and a word, like every other status on the page.
const TAGS = {
  regression: ['Regression', 'warn', 'warn'],
  device: ['Device', 'square', 'neutral'],
  manual: ['Manual', 'edit', 'neutral'],
  visual: ['Visual', 'diamond', 'accent'],
};

/** Stable item id: ticks follow the item through reordering; editing its text or group title starts it over. */
export const itemKey = (groupTitle, itemText) => `${groupTitle}\u0000${itemText}`;
export const itemId = (groupTitle, itemText) => crypto.createHash('sha256').update(itemKey(groupTitle, itemText)).digest('hex').slice(0, ID_HEX);

// Free tags are the author's own words, so they carry no meaning of their own: one neutral chip each, escaped by chip().
const freeTags = (tags = []) => tags.map((t) => chip([t, 'square', 'neutral']));

function chips(it) {
  const known = Object.hasOwn(TAGS, it.tag) ? [chip(TAGS[it.tag])] : [];
  const all = [...known, ...freeTags(it.tags)];
  return all.length === 0 ? '' : `<span class="cl-item-chip">${all.join('')}</span>`;
}

// Steps and the expected result sit under the item, outside its label, so a tester can select a command without ticking the box.
function detail(it) {
  const steps = it.steps === undefined || it.steps.length === 0 ? '' : `<ol class="cl-steps">${it.steps.map((s) => `<li>${inline(s)}</li>`).join('')}</ol>`;
  const expect = it.expect === undefined ? '' : `<p class="cl-expect"><strong>You should see</strong> ${inline(it.expect)}</p>`;
  return steps + expect === '' ? '' : `<div class="cl-detail">${steps}${expect}</div>`;
}

function item(group, it) {
  const note = it.note === undefined ? '' : `<span class="cl-note">${inline(it.note)}</span>`;
  return `<li class="cl-item"><label class="cl-label"><input type="checkbox" class="cl-box" data-id="${itemId(group.title, it.text)}"><span class="cl-main"><span class="cl-line"><span class="cl-text">${inline(it.text)}</span>${chips(it)}</span>${note}</span></label>${detail(it)}</li>`;
}

function renderGroup(group) {
  const items = group.items.map((it) => item(group, it));
  const intro = group.intro === undefined ? '' : `<div class="cl-group-intro prose">\n${renderMarkdown(group.intro)}\n</div>\n`;
  return `<div class="cl-group" role="group" aria-label="${plain(group.title)}" data-group>
<div class="cl-group-head"><h3>${inline(group.title)}</h3><span class="cl-tally"><span data-group-done>0</span> / ${group.items.length}<span class="sr-only"> done</span></span></div>
${intro}<ul class="cl-items">
${items.join('\n')}
</ul>
</div>`;
}

export function render(section) {
  const total = section.groups.reduce((n, g) => n + g.items.length, 0);
  const label = section.title === undefined ? 'Checklist progress' : `Progress: ${plain(section.title)}`;
  const context = section.intro === undefined ? '' : `<details class="det cl-context" open>
<summary>What&#39;s in this branch</summary>
<div class="det-body prose">
${renderMarkdown(section.intro)}
</div>
</details>
`;
  return `<div class="checklist" data-checklist data-key="${esc(section.key)}" data-total="${total}">
${context}<div class="cl-bar">
<div class="cl-bar-row">
<span class="cl-count"><strong><span data-done>0</span> / ${total}</strong> done</span>
<span class="cl-pct" data-pct>0%</span>
<span class="cl-flag" data-complete hidden>${chip(['Complete', 'check', 'good'])}</span>
<button type="button" class="btn cl-reset" data-reset aria-disabled="true">Reset</button>
</div>
<div class="cl-meter" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="0" aria-valuetext="0 of ${total} done"><span data-fill></span></div>
<div class="cl-confirm" data-confirm hidden>
<span class="cl-confirm-q" data-confirm-text>Reset all ticks?</span>
<button type="button" class="btn" data-reset-yes>Yes, reset</button>
<button type="button" class="btn" data-reset-no>No</button>
</div>
<span class="cl-flag" data-unsaved hidden>${chip(["Progress won't be saved in this browser", 'info', 'neutral'])}</span>
</div>
${section.groups.map(renderGroup).join('\n')}
<div class="cl-fail">
<h3 class="cl-fail-title">If something fails</h3>
${renderMarkdown(section.onFail ?? DEFAULT_FAIL)}
</div>
</div>`;
}
