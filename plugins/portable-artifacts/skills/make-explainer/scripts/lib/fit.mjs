// Fits a fact (a branch name, a commit subject, a folder) into a spec field so the starter passes
// validation on everything except real TODO placeholders: emoji dropped, banned phrases replaced,
// "TODO:" and "lorem ipsum" rewritten so only scaffold's own placeholders carry them, heading
// punctuation fixed, and the text cut at a word boundary to the schema's limit.
import { EMOJI, EMOJI_SEQUENCE, loadBannedPhrases } from './lint.mjs';

const ELLIPSIS = '…';
const WORD_BOUNDARY = /[\s\-_/.,:;]/;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const IS_EMOJI = new RegExp(EMOJI.source, 'u');
const KEYCAP_MARK = /\uFE0F?\u20E3/gu;

const literalReplacement = (advice) => {
  const m = /^replace it with ("[^"]*")$/.exec(advice);
  return m ? JSON.parse(m[1]) : '';
};

/** Rewrites what the prose lint would reject. `heading`: also drops a trailing "!". */
export function cleanText(text, { heading = false } = {}) {
  // A sequence that is only a text symbol (an arrow, play) is not emoji and stays; anything the lint
  // would flag goes, whole. What the sequence pass cannot see (a keycap mark, a stray tag) goes last.
  let out = String(text).replace(EMOJI_SEQUENCE, (m) => (IS_EMOJI.test(m) ? '' : m)).replace(KEYCAP_MARK, '').replace(EMOJI, '');
  for (const { regexp, advice } of loadBannedPhrases()) {
    regexp.lastIndex = 0;
    out = out.replace(regexp, literalReplacement(advice));
  }
  out = out.replace(/TODO:/g, 'To do:').replace(/lorem\s+ipsum/gi, 'sample text').replace(/\s+/g, ' ').trim();
  return heading ? out.replace(/!+$/, '').trimEnd() : out;
}

// The longest prefix of whole grapheme clusters that is at most `max` UTF-16 units long, so a cut never
// splits a surrogate pair, detaches a combining mark or tears a joined emoji.
function graphemePrefix(text, max) {
  let end = 0;
  for (const { segment } of GRAPHEMES.segment(text)) {
    if (end + segment.length > max) break;
    end += segment.length;
  }
  return text.slice(0, end);
}

/** Cuts `text` to at most `limit` characters at a word boundary, ending in "…". The cut falls between graphemes. */
export function fit(text, limit) {
  if (text.length <= limit) return text;
  const room = graphemePrefix(text, limit - ELLIPSIS.length);
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
