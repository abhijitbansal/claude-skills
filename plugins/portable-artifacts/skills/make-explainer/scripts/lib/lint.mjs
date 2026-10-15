// Deterministic prose lint. Errors: placeholders (TODO:, lorem ipsum), emoji,
// banned phrases (references/style.md), headings ending in "!", numbered
// section titles. Length is not linted here: soft caps live in budget.mjs.
import fs from 'node:fs';
import { proseOnly } from './markdown.mjs';

const STYLE_FILE = new URL('../../references/style.md', import.meta.url);
const q = (v) => JSON.stringify(v);

// ---- placeholders (checked on every string in a spec, prose or not) ----

export function lintPlaceholders(text, path) {
  const errors = [];
  if (text.includes('TODO:')) errors.push({ path, message: 'still has a TODO placeholder — replace it with real content' });
  if (/lorem\s+ipsum/i.test(text)) errors.push({ path, message: 'still has lorem ipsum placeholder text — replace it with real content' });
  return errors;
}

// ---- emoji ------------------------------------------------------------

// Emoji only. Characters that default to emoji presentation (rockets, check-mark buttons, flags, skin-tone
// modifiers), any pictograph the author forced into emoji form with VS16 (U+FE0F), astral pictographs, tag
// characters and keycaps. Symbols that default to text presentation (arrows, play, info, hearts, check marks)
// are ordinary typography and pass, as do the copyright, registered and trade mark signs.
export const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|(?=[\u{10000}-\u{10FFFF}])\p{Extended_Pictographic}|[\u{E0020}-\u{E007F}]|\u20E3/gu;

function lintEmoji(text, path) {
  const found = [...new Set(text.match(EMOJI) ?? [])];
  if (found.length === 0) return [];
  const shown = found.slice(0, 3).map(q).join(', ');
  return [{ path, message: `contains emoji ${shown}${found.length > 3 ? ', …' : ''}; remove ${found.length > 1 ? 'them' : 'it'} and say it in words` }];
}

// ---- banned phrases ---------------------------------------------------

let banned;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function phraseRegExp(phrase) {
  const body = escapeRegExp(phrase.trim())
    .replace(/\s+/g, '\\s+')
    .replace(/-/g, '[-\\s]')
    .replace(/['’]/g, "['’]");
  return new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'giu');
}

// references/style.md lines "phrase → replacement"; other lines are ignored.
export function loadBannedPhrases() {
  if (banned) return banned;
  banned = [];
  for (const line of fs.readFileSync(STYLE_FILE, 'utf8').split('\n')) {
    const m = /^(?:- )?(.+?)\s+→\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const advice = /^\((.+)\)$/.exec(m[2]);
    banned.push({ phrase: m[1], regexp: phraseRegExp(m[1]), advice: advice ? advice[1] : `replace it with ${q(m[2])}` });
  }
  return banned;
}

// Only the words a reader reads count: an identifier in `backticks`, a link's URL or a bare URL is
// not prose, and the fix the message gives ("replace it with ...") would corrupt it.
function lintBanned(text, path) {
  const errors = [];
  const prose = proseOnly(text);
  for (const { regexp, advice } of loadBannedPhrases()) {
    regexp.lastIndex = 0;
    const m = regexp.exec(prose);
    if (m) errors.push({ path, message: `banned phrase ${q(m[0])}; ${advice}` });
  }
  return errors;
}

// ---- headings, paragraphs ---------------------------------------------

const NUMBERED = /^\s*(0\d)(?=[\s.):\-–—])/;

function lintHeading(text, path, sectionTitle) {
  const errors = [];
  if (text.trimEnd().endsWith('!')) {
    errors.push({ path, message: 'heading ends with "!"; drop the exclamation mark and state the claim plainly' });
  }
  const m = sectionTitle ? NUMBERED.exec(text) : null;
  if (m) errors.push({ path, message: `title starts with the number ${q(m[1])}; drop it — the page already orders sections` });
  return errors;
}

/**
 * Lint one prose string. `heading`: the string is a heading (title, summary).
 * `sectionTitle`: it is a section's title (also rejects "01 ..." numbering).
 * `banned: false`: the string is data written as the reader should see it (a table cell), so the
 * banned-phrase rule is skipped; placeholders and emoji still apply.
 * -> { errors, warnings }, each [{ path, message }].
 */
export function lintText(text, path, { heading = false, sectionTitle = false, banned: checkBanned = true } = {}) {
  const errors = [
    ...lintPlaceholders(text, path),
    ...lintEmoji(text, path),
    ...(checkBanned ? lintBanned(text, path) : []),
    ...(heading ? lintHeading(text, path, sectionTitle) : []),
  ];
  return { errors, warnings: [] };
}
