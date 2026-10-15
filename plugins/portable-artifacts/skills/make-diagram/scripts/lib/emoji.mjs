// What `emoji` may hold: exactly one emoji grapheme. Intl.Segmenter counts the
// graphemes a reader sees; the rest of the rule says what the one grapheme may
// be made of (a pictograph with its modifiers and joins, a two-letter flag, a
// keycap) and how much: a grapheme has no upper size, so a 50-part ZWJ chain
// or a doubled skin tone would otherwise pass. Symbols Unicode lists as
// pictographs (©, ™) pass; that is the letter of the rule, not a bug.
// The invisible characters are spelled as escapes: a literal one cannot be seen
// in an editor.
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

const ZWJ = '\u200d';
const KEYCAP = '\u20e3';
// Characters that ride along inside one emoji: ZWJ, variation selector 16, the
// keycap combiner, skin tones and the tag letters of subdivision flags.
const MODIFIER = /^[\u200d\ufe0f\u20e3\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]$/u;
const SKIN = /^[\u{1f3fb}-\u{1f3ff}]$/u;
const PICTO = /^\p{Extended_Pictographic}$/u;
const REGION = /^\p{Regional_Indicator}$/u;
const KEYCAP_BASE = /^[0-9#*]$/;
const MAX_POINTS = 10; // the longest common emoji (two people, a heart and a kiss, each with a skin tone)
const MAX_PARTS = 4; // joined by ZWJ: a family of four

/** Number of graphemes in `text` (a flag or a family is 1; "ab" is 2). */
export function graphemeCount(text) {
  let n = 0;
  for (const _ of segmenter.segment(text)) n += 1;
  return n;
}

const VS16 = '\ufe0f';
const TAG_ANY = /[\u{e0020}-\u{e007f}]/u;
// The only tag sequence emoji use: a black flag, tag letters, the cancel tag.
const TAGGED_FLAG = /^\u{1f3f4}[\u{e0020}-\u{e007e}]+\u{e007f}$/u;

// One ZWJ-joined part: one base (a flag's two regional indicators count as one),
// at most one skin tone and one VS16; tag letters only as a tagged flag.
function partWellFormed(part) {
  if (part === '') return false;
  const points = [...part];
  if (TAG_ANY.test(part)) return TAGGED_FLAG.test(part);
  if (points.filter((c) => SKIN.test(c)).length > 1) return false;
  if (points.filter((c) => c === VS16).length > 1) return false;
  const base = points.filter((c) => !MODIFIER.test(c));
  return base.length === 1 || (base.length === 2 && base.every((c) => REGION.test(c)));
}

function wellFormed(text) {
  const parts = text.split(ZWJ);
  return parts.length <= MAX_PARTS && parts.every(partWellFormed);
}

/** True when `text` is exactly one emoji. */
export function isOneEmoji(text) {
  if (graphemeCount(text) !== 1) return false;
  const points = [...text];
  if (points.length > MAX_POINTS || !wellFormed(text)) return false;
  const base = points.filter((c) => !MODIFIER.test(c));
  if (base.length === 0) return false;
  if (base.every((c) => REGION.test(c))) return base.length === 2;
  if (text.includes(KEYCAP)) return base.length === 1 && KEYCAP_BASE.test(base[0]);
  return base.every((c) => PICTO.test(c));
}
