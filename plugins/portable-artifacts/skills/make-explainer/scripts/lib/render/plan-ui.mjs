// Building blocks shared by the plan section renderers (decision, approval, question, verdict).
// The answer runtime (template/plan.js) reads the markup these write, so the attribute names are a contract:
// a container [data-plan-item] with data-kind, data-question, data-id (not on the verdict: the runtime finds it by
// data-kind) and data-default (decision and question), radios named "plan-<id>" (the verdict's are "plan-verdict";
// the id "verdict" is reserved on items, so the groups never meet), and <textarea data-answer> /
// <textarea data-comment> for free text. Attribute values hold the raw spec text
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

/**
 * The answerable item: what the runtime binds and exports. `attrs` = { id?, question, default? }; `default` is
 * written (empty when the spec has none) only when the key is present, so decision and question always carry it.
 */
export function planItem(kind, attrs, inner) {
  const id = attrs.id === undefined ? '' : ` data-id="${esc(attrs.id)}"`;
  const fallback = Object.hasOwn(attrs, 'default') ? ` data-default="${esc(attrs.default ?? '')}"` : '';
  return `<div class="plan-item plan-${kind}" data-plan-item${id} data-kind="${kind}" data-question="${esc(attrs.question)}"${fallback}>
${inner}
</div>`;
}

/** An item's radio group name. Prefixed, so an item id never meets another radio group on the page. */
export const radioName = (id) => `plan-${id}`;

/** An element id inside an item. The underscore keeps it apart from section and heading ids (ID_PATTERN has none). */
export const partId = (id, ...parts) => esc(['pl', id, ...parts].join('_'));

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

/**
 * An optional free-text comment, exported with the item. `about` (escaped plain text, the item's question) is read
 * to screen readers only, so a form-field list tells the comment boxes apart. The blank placeholder lets print hide
 * an empty box (:placeholder-shown).
 */
export const commentBox = (label, about) => `<label class="plan-field"><span class="plan-field-label">${label}<span class="sr-only">: ${about}</span></span><textarea class="plan-text" data-comment rows="2" placeholder=" "></textarea></label>`;
