// Fits a fact (a branch name, a commit subject, a folder) into a spec field so the starter passes
// validation on everything except real TODO placeholders: emoji dropped, banned phrases replaced,
// "TODO:" and "lorem ipsum" rewritten so only scaffold's own placeholders carry them, heading
// punctuation fixed, and the text cut at a word boundary to the schema's limit.
import { EMOJI, loadBannedPhrases } from './lint.mjs';

const ELLIPSIS = '…';
const WORD_BOUNDARY = /[\s\-_/.,:;]/;
// Variation selectors and joiners left behind when an emoji is removed.
const EMOJI_DEBRIS = /[‍︎️]/g;

const literalReplacement = (advice) => {
  const m = /^replace it with ("[^"]*")$/.exec(advice);
  return m ? JSON.parse(m[1]) : '';
};

/** Rewrites what the prose lint would reject. `heading`: also drops a trailing "!". */
export function cleanText(text, { heading = false } = {}) {
  let out = String(text).replace(EMOJI, '').replace(EMOJI_DEBRIS, '');
  for (const { regexp, advice } of loadBannedPhrases()) {
    regexp.lastIndex = 0;
    out = out.replace(regexp, literalReplacement(advice));
  }
  out = out.replace(/TODO:/g, 'To do:').replace(/lorem\s+ipsum/gi, 'sample text').replace(/\s+/g, ' ').trim();
  return heading ? out.replace(/!+$/, '').trimEnd() : out;
}

/** Cuts `text` to at most `limit` characters at a word boundary, ending in "…". */
export function fit(text, limit) {
  if (text.length <= limit) return text;
  const room = text.slice(0, limit - ELLIPSIS.length);
  let cut = room.length;
  for (let i = room.length - 1; i > room.length / 2; i--) {
    if (WORD_BOUNDARY.test(text[i])) { cut = i; break; }
  }
  return `${room.slice(0, cut).trimEnd().replace(/[-_/.,:;]+$/, '')}${ELLIPSIS}`;
}

/** A fact as prose: cleaned, fitted, and `fallback` when nothing is left. */
export function prose(text, { limit = Infinity, heading = false, fallback = '' } = {}) {
  const cleaned = cleanText(text ?? '', { heading });
  return cleaned === '' ? fallback : fit(cleaned, limit);
}

/** A path fact: only the placeholder marker is neutralised (emoji and punctuation in a path are real). */
export const pathText = (text) => String(text).replace(/TODO:/g, 'To do:').replace(/lorem\s+ipsum/gi, 'sample text');
