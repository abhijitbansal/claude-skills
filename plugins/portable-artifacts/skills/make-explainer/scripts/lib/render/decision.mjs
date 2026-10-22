// decision: a question, 2 to 5 options with pros and cons, the recommendation and why. On a page the reader
// picks an option (or writes an override in the comment); in a deck it is shown read only.
import { chip, esc, glyph, inline, plain } from './ui.mjs';
import { renderMarkdown } from '../markdown.mjs';
import { page, isDeck, planItem, staticItem, kicker, commentBox, radioName, partId } from './plan-ui.mjs';

export { page };

const RECOMMENDED = chip(['Recommended', 'check', 'accent']);

// Pros and cons: a + or − glyph, and the word for screen readers. The text is one span: the row is a flex box, and
// bare text beside a nowrap span would split into separate flex items with a gap between them.
function prosCons(option, id) {
  const rows = [
    ...(option.pros ?? []).map((p) => `<li class="plan-pro">${glyph('plus')}<span><span class="sr-only">Pro: </span>${inline(p)}</span></li>`),
    ...(option.cons ?? []).map((c) => `<li class="plan-con">${glyph('minus')}<span><span class="sr-only">Con: </span>${inline(c)}</span></li>`),
  ];
  return rows.length === 0 ? '' : `<ul class="plan-pc" id="${id}">\n${rows.join('\n')}\n</ul>`;
}

// The radio's name is the label (plus "Recommended"); the pros and cons describe it.
function optionRow(section, option, n) {
  const rec = option.label === section.recommended;
  const labelId = partId(section.id, n, 'label');
  const recId = partId(section.id, n, 'rec');
  const pcId = partId(section.id, n, 'pc');
  const pc = prosCons(option, pcId);
  const named = rec ? `${labelId} ${recId}` : labelId;
  const described = pc === '' ? '' : ` aria-describedby="${pcId}"`;
  const badge = rec ? `<span id="${recId}">${RECOMMENDED}</span>` : '';
  return `<label class="plan-opt${rec ? ' is-rec' : ''}"><input type="radio" name="${esc(radioName(section.id))}" value="${esc(option.label)}" data-recommended="${rec}" aria-labelledby="${named}"${described}><span class="plan-opt-body"><span class="plan-opt-head"><span class="plan-opt-label" id="${labelId}">${inline(option.label)}</span>${badge}</span>${pc}</span></label>`;
}

const why = (section) => `<details class="plan-why" open>
<summary>Why ${inline(section.recommended)}</summary>
<div class="plan-why-body prose">
${renderMarkdown(section.why)}
</div>
</details>`;

const fallback = (section) => (section.default === undefined
  ? ''
  : `\n<p class="plan-default"><span class="plan-default-k">If nobody answers:</span> ${inline(section.default)}</p>`);

function readOnly(section) {
  const options = section.options.map((o) => {
    const rec = o.label === section.recommended;
    return `<li class="plan-opt-static${rec ? ' is-rec' : ''}"><span class="plan-opt-label">${inline(o.label)}</span>${rec ? RECOMMENDED : ''}</li>`;
  });
  return staticItem('decision', `${kicker('Decision needed')}
<p class="plan-q">${inline(section.question)}</p>
<ol class="plan-opts-static">
${options.join('\n')}
</ol>
<div class="plan-why-body prose">
${renderMarkdown(section.why)}
</div>${fallback(section)}`);
}

export function render(section, ctx) {
  if (isDeck(ctx)) return readOnly(section);
  const attrs = { id: section.id, question: section.question, default: section.default };
  return planItem('decision', attrs, `${kicker('Decision needed')}
<fieldset class="plan-set">
<legend class="plan-q">${inline(section.question)}</legend>
<div class="plan-opts">
${section.options.map((o, n) => optionRow(section, o, n + 1)).join('\n')}
</div>
</fieldset>
${why(section)}${fallback(section)}
${commentBox('Comment or override (optional)', plain(section.question))}`);
}
