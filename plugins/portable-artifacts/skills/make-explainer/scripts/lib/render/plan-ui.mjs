// Building blocks shared by the plan section renderers (decision, approval, question, verdict).
// The answer runtime (template/plan.js) reads the markup these write, so the attribute names are a contract:
// a container [data-plan-item] with data-id, data-kind and data-question, radios named after the item, and
// <textarea data-answer> / <textarea data-comment> for free text. Attribute values hold the raw spec text
// escaped with esc(), so getAttribute() and input.value give back the exact string the spec holds.
import fs from 'node:fs';
import { esc, glyph } from './ui.mjs';

const PLAN_CSS = new URL('../../../template/plan.css', import.meta.url);
const PLAN_JS = new URL('../../../template/plan.js', import.meta.url);

/** plan.css for a page and a deck; plan.js (the answer runtime) only on a page, because a deck is read only. */
export function page(ctx) {
  const css = fs.readFileSync(PLAN_CSS, 'utf8').replace(/\n$/, '');
  return { css, js: isDeck(ctx) ? [] : [fs.readFileSync(PLAN_JS, 'utf8')] };
}

export const isDeck = (ctx) => ctx.mode === 'slides';

/** The answerable item: what the runtime binds and exports. */
export function planItem(kind, id, question, inner) {
  return `<div class="plan-item plan-${kind}" data-plan-item data-id="${esc(id)}" data-kind="${kind}" data-question="${esc(question)}">
${inner}
</div>`;
}

/** The deck form: the same content, no controls, and where to answer instead. */
export function staticItem(kind, inner) {
  return `<div class="plan-item plan-${kind} plan-static">
${inner}
<p class="plan-note">${glyph('info')}<span>Answers are collected in the page version.</span></p>
</div>`;
}

/** The line above an item: its running number (CSS counter) and what the reader is asked to do. */
export const kicker = (word) => `<p class="plan-kicker"><span class="plan-num" aria-hidden="true"></span><span class="plan-kind">${word}</span></p>`;

/**
 * A row of radios, each a glyph and a word (status is never colour alone).
 * `options` = [[value, word, glyphName, tone]]; values and words are fixed strings, never spec text.
 */
export function choices(name, options) {
  const rows = options.map(([value, word, glyphName, tone]) => `<label class="plan-choice tone-${tone}"><input type="radio" name="${esc(name)}" value="${value}">${glyph(glyphName)}<span>${word}</span></label>`);
  return `<div class="plan-choices">\n${rows.join('\n')}\n</div>`;
}

/** An optional free-text comment, exported with the item. */
export const commentBox = (label) => `<label class="plan-field"><span class="plan-field-label">${label}</span><textarea class="plan-text" data-comment rows="2"></textarea></label>`;
