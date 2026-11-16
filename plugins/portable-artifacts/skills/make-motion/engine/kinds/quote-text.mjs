// The `quote` kind's words as its compositions read them (quote.mjs, quote-desk.mjs, quote-pop.mjs): the quotation
// without the marks an author typed, the kind's own marks, the attribution line and the shared timing. Pure, DOM-free.
import { endTimes, plainSay } from './shared.mjs';

export const OPEN_MARK = '“';
export const CLOSE_MARK = '”';
export const BY_SEPARATOR = ' · ';
// The quote mark pairs an author may type around a quotation: each opening mark and the closing marks that answer it.
const PAIRS = Object.freeze({ '"': '"“”', "'": "'’", '“': '”"', '„': '“”"', '‚': '‘’', '‘': '’\'', '«': '»', '‹': '›', '»': '«', '”': '”' });
const TRAILING = /[.,!?;:…]+$/u; // sentence punctuation an author may type after the closing mark

/**
 * The quotation without a matched pair of marks the author typed around it: an opening mark at the start and its closing
 * mark at the end, or before trailing sentence punctuation (`"Ship it".` -> `Ship it.`). A lone mark is kept, so an
 * apostrophe at either end stays (`the players'`, `'Tis`).
 */
export function quoteBody(text) {
  const plain = text.trim();
  const open = plain[0];
  if (PAIRS[open] === undefined) return plain;
  const tail = plain.match(TRAILING)?.[0] ?? '';
  const body = plain.slice(0, plain.length - tail.length);
  const close = body.at(-1);
  if (body.length < 2 || !PAIRS[open].includes(close)) return plain;
  return `${body.slice(1, -1).trim()}${tail}`;
}

/** The quotation the shot quotes: its `text`, else its say, without typed marks. */
export const quotationOf = (shot) => quoteBody(shot.text ?? plainSay(shot.say));

/** The attribution as one line: who, and their role after a separator. */
export const attributionOf = (shot) => (shot.role === undefined ? shot.by : `${shot.by}${BY_SEPARATOR}${shot.role}`);

/** When the quotation's words land and when the attribution does (end.mjs endTimes: on its own spoken words, else just
 *  after the quotation's last word): { words: [{ at, spoken }], by }. */
export function quoteTimes(shot, timing) {
  const times = endTimes({ say: shot.say, title: quotationOf(shot), ask: attributionOf(shot) }, timing);
  return { words: times.title, by: times.ask };
}
