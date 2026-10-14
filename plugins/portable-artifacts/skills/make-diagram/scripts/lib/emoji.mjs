// What `emoji` may hold: exactly one emoji grapheme. Intl.Segmenter counts the
// graphemes a reader sees; the rest of the rule says what the one grapheme may
// be made of (a pictograph with its modifiers and joins, a two-letter flag, a
// keycap). Symbols Unicode lists as pictographs (©, ™) pass; that is the letter
// of the rule, not a bug.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

// Characters that ride along inside one emoji: ZWJ, variation selector 16, the
// keycap combiner, skin tones and the tag letters of subdivision flags.
const MODIFIER = /^[‍️⃣\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const REGION = /^\p{Regional_Indicator}$/u;
const KEYCAP_BASE = /^[0-9#*]$/;

/** Number of graphemes in `text` (a flag or a family is 1; "ab" is 2). */
export function graphemeCount(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

/** True when `text` is exactly one emoji. */
export function isOneEmoji(text) {
  if (graphemeCount(text) !== 1) return false;
  const base = [...text].filter((c) => !MODIFIER.test(c));
  if (base.length === 0) return false;
  if (base.every((c) => REGION.test(c))) return base.length === 2;
  if (text.includes('⃣')) return base.length === 1 && KEYCAP_BASE.test(base[0]);
  return base.every((c) => PICTO.test(c));
}
