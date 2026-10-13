// Deterministic prose lint. Errors: placeholders (TODO:, lorem ipsum), emoji,
// banned phrases (references/style.md), headings ending in "!", numbered
// section titles. Warning: paragraphs over PARAGRAPH_WORDS words.
import fs from 'node:fs';

export const PARAGRAPH_WORDS = 120;
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

// Extended_Pictographic, flags (regional indicators) and keycaps. (c) (r) and
// the trade mark sign are in Extended_Pictographic but are ordinary text.
export const EMOJI = /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}+|⃣/gu;

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

function lintBanned(text, path) {
  const errors = [];
  for (const { regexp, advice } of loadBannedPhrases()) {
    regexp.lastIndex = 0;
    const m = regexp.exec(text);
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

const words = (s) => (s.match(/\S+/g) ?? []).length;

// A blank line separates paragraphs; in a block made only of "- " lines each
// line is its own paragraph.
function paragraphs(text) {
  return text.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    return lines.length > 0 && lines.every((l) => l.trimStart().startsWith('- ')) ? lines : [block];
  });
}

function lintLength(text, path) {
  return paragraphs(text)
    .map(words)
    .filter((n) => n > PARAGRAPH_WORDS)
    .map((n) => ({ path, message: `paragraph is ${n} words; the limit is ${PARAGRAPH_WORDS} — split it or cut it` }));
}

/**
 * Lint one prose string. `heading`: the string is a heading (title, summary).
 * `sectionTitle`: it is a section's title (also rejects "01 ..." numbering).
 * -> { errors, warnings }, each [{ path, message }].
 */
export function lintText(text, path, { heading = false, sectionTitle = false } = {}) {
  const errors = [
    ...lintPlaceholders(text, path),
    ...lintEmoji(text, path),
    ...lintBanned(text, path),
    ...(heading ? lintHeading(text, path, sectionTitle) : []),
  ];
  return { errors, warnings: lintLength(text, path) };
}
