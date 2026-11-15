// Narration markup parser. Pure: no DOM, no clock, no randomness.
//
// Marks inside a `say` line:
//   *word*          emphasis on each enclosed word
//   _word_          aside on each enclosed word
//   ...  or the ellipsis character (U+2026)
//                   pause of ELLIPSIS_PAUSE before the next word
//   (0.4)           pause of that many seconds before the next word; only a
//                   number with a decimal point is a pause, so (2024) is text
//   [word](/ipa/)   spoken pronunciation hint, kept on the token as `ipa`
//
// Rule for * and _. A run is one or two adjacent marks of different kinds
// (*_ or _*); each mark in it is decided on its own from the same context.
//   - A mark OPENS when the character before it is the line start, whitespace,
//     an opening bracket or quote ( [ { " ' (curly quotes too), a hyphen, en
//     dash, em dash, a slash, or the end of a pause mark; AND the character
//     after it is not whitespace (and not the end of the line).
//   - A mark CLOSES when the character before it is not whitespace and not an
//     opening bracket or curly opening quote; AND the character after it is
//     the line end, whitespace, closing punctuation . , ; : ! ? ) ] } " '
//     (curly quotes too), a hyphen, en dash, em dash, a slash, or the start of
//     a pause mark.
//   - When a mark can do both, it closes if its kind is open, otherwise it
//     opens. A mark that can do neither (mid-word: snake_case, a*b, 2 * 3) is
//     literal, and so is a closer with nothing open (foo*).
//   - A run with the same mark twice (**bold**, __init__) is literal.
//   - An opener of a kind that is already open is a SayError ("nested"). The
//     "not an opening bracket" clause on closers is what makes *a (*"b"*) c*
//     nested: otherwise the mark after ( would close the outer emphasis.
//   - A backslash escapes: \* and \_ are a literal * or _, and \\ is a literal
//     backslash. Any other backslash is plain text.
//   - Errors say how to fix the line (escape the mark, or close it).
//
// Pauses: closing punctuation right after a pause mark joins the word before
// it when it is followed by the end, whitespace, or consists only of . , ; : !
// ? (Really...? is one token); quotes and brackets followed by more text are
// not glued (x(0.4)"y" is two tokens). A pause moves to the next word's
// `pauseBefore`; with no word after it, it is returned as `trailingPause`.
// A token of only closing punctuation (a spaced "ok (0.4), then") is merged
// into the previous token as a final pass, handing its pause on the same way.

export class SayError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'SayError';
  }
}

const ELLIPSIS_PAUSE = 0.35;
const PAUSE_MIN = 0.05;
const PAUSE_MAX = 3;

// Non-ASCII characters are built from code points so the source stays ASCII.
const fromCode = (code) => String.fromCharCode(code);
const ELLIPSIS = fromCode(0x2026);
const EN_DASH = fromCode(0x2013);
const EM_DASH = fromCode(0x2014);
const LEFT_DOUBLE = fromCode(0x201c);
const LEFT_SINGLE = fromCode(0x2018);
const RIGHT_DOUBLE = fromCode(0x201d);
const RIGHT_SINGLE = fromCode(0x2019);

// Body of a regex character class: closing punctuation.
const CLOSE_CLASS = `.,;:!?)\\]}"'${RIGHT_DOUBLE}${RIGHT_SINGLE}`;

const ELLIPSIS_RE = new RegExp(`(?:\\.{3,}|${ELLIPSIS})+`, 'y');
const PAUSE_RE = /\((\d+\.\d+|\.\d+)\)/y;
// The word excludes `[`, so a failed attempt never rescans past the next `[`.
const IPA_RE = /\[([^\][\s]+)\]\(\/([^/)]+)\/\)/y;
const CLOSE_RUN_RE = new RegExp(`[${CLOSE_CLASS}]+`, 'y');
const ORPHAN_RE = new RegExp(`^[${CLOSE_CLASS}]+$`);
const SENTENCE_PUNCT_RE = /^[.,;:!?]+$/;
const WHITESPACE_RE = /\s/;

const DASHES_AND_SLASH = new Set(['-', EN_DASH, EM_DASH, '/']);
const OPENING_CONTEXT = new Set(['(', '[', '{', '"', "'", LEFT_DOUBLE, LEFT_SINGLE, ...DASHES_AND_SLASH]);
const CLOSING_PUNCT = new Set([...CLOSE_CLASS.replace('\\]', ']')]);
// Characters that can only open something, so a mark right after one cannot close.
const UNAMBIGUOUS_OPENERS = new Set(['(', '[', '{', LEFT_DOUBLE, LEFT_SINGLE]);
const MARK_CHARS = new Set(['*', '_']);
const ESCAPABLE = new Set(['*', '_', '\\']);
const MAX_RUN = 2;
const MARK_HELP = {
  '*': { noun: 'asterisk', nested: 'emphasis cannot contain emphasis' },
  _: { noun: 'underscore', nested: 'an aside cannot contain an aside' },
};
// Quotes and brackets that may trail a sentence end: done."), and the ends.
const TRAILING_CLOSERS = new Set(['"', "'", ')', ']', RIGHT_DOUBLE, RIGHT_SINGLE]);
const SENTENCE_END_CHARS = new Set(['.', '!', '?']);

function matchAt(re, text, index) {
  re.lastIndex = index;
  return re.exec(text);
}

const isSpaceOrEdge = (ch) => ch === undefined || WHITESPACE_RE.test(ch);

const NO_CONTEXT = { opens: false, closes: false };

// Whether the run say[s, e) of `marks` can open and/or close. See the header.
function runContext(say, s, e, st, marks) {
  const prev = say[s - 1];
  const next = say[e];
  const beforeOpens = isSpaceOrEdge(prev) || OPENING_CONTEXT.has(prev) || st.pauseEnd === s;
  const beforeCloses = s > 0 && !WHITESPACE_RE.test(prev) && !UNAMBIGUOUS_OPENERS.has(prev) && !marks.includes(prev);
  const afterCloses = isSpaceOrEdge(next) || CLOSING_PUNCT.has(next) || DASHES_AND_SLASH.has(next)
    || next === ELLIPSIS || matchAt(PAUSE_RE, say, e) !== null;
  return {
    opens: beforeOpens && !isSpaceOrEdge(next) && !marks.includes(next),
    closes: beforeCloses && afterCloses,
  };
}

const unclosedError = (mark, say) => new SayError(
  `unclosed ${mark} in "${say}"; close it, or write \\${mark} for a literal ${MARK_HELP[mark].noun}`,
);
const nestedError = (mark, say) => new SayError(`nested ${mark} in "${say}"; ${MARK_HELP[mark].nested}`);

function parsePause(raw, say) {
  const seconds = Number(raw);
  if (!(seconds >= PAUSE_MIN && seconds <= PAUSE_MAX)) {
    throw new SayError(`pause (${raw}) out of range ${PAUSE_MIN}-${PAUSE_MAX} s in "${say}"`);
  }
  return seconds;
}

function addText(st, text, ipa) {
  if (!st.word) {
    st.word = { text: '', emphasis: false, aside: false, pauseBefore: st.pause, ipa: undefined };
    st.pause = 0;
  }
  st.word.text += text;
  st.word.emphasis ||= st.open['*'];
  st.word.aside ||= st.open._;
  if (ipa !== undefined) st.word.ipa = ipa;
}

// Closes, opens or (when it can do neither) writes out one mark.
function applyMark(mark, ctx, st, say) {
  const isOpen = st.open[mark];
  if (ctx.closes && isOpen) {
    st.open[mark] = false;
  } else if (ctx.opens) {
    if (isOpen) throw nestedError(mark, say);
    st.open[mark] = true;
  } else {
    addText(st, mark);
  }
}

// Handles a maximal run of mark characters starting at `s`. Returns the index
// after it.
function readMarkRun(say, s, st) {
  let e = s;
  while (MARK_CHARS.has(say[e])) e++;
  const marks = [...say.slice(s, e)];
  const wellFormed = marks.length <= MAX_RUN && new Set(marks).size === marks.length;
  const ctx = wellFormed ? runContext(say, s, e, st, marks) : NO_CONTEXT;
  for (const mark of marks) applyMark(mark, ctx, st, say);
  return e;
}

// Scans back from the end (no end-anchored regex: those are quadratic on a
// long run of closers followed by one other character).
function endsSentence(text) {
  let j = text.length - 1;
  while (j >= 0 && TRAILING_CLOSERS.has(text[j])) j--;
  return j >= 0 && SENTENCE_END_CHARS.has(text[j]);
}

function finishToken(word) {
  const { text, emphasis, aside, pauseBefore, ipa } = word;
  const token = { text, emphasis, aside, pauseBefore, sentenceEnd: endsSentence(text) };
  return ipa === undefined ? token : { ...token, ipa };
}

function flush(st) {
  if (!st.word) return;
  st.tokens.push(finishToken(st.word));
  st.word = null;
}

// Records a pause whose mark ends at index `end`. Closing punctuation right
// after it joins the current word only when it truly closes it (see header).
// Returns the index to continue from.
function addPause(st, say, end, seconds) {
  st.pause += seconds;
  st.pauseEnd = end;
  const run = matchAt(CLOSE_RUN_RE, say, end);
  const stop = run ? end + run[0].length : end;
  const atBoundary = isSpaceOrEdge(say[stop]);
  if (!run || !(atBoundary || SENTENCE_PUNCT_RE.test(run[0]))) {
    flush(st);
    return end;
  }
  addText(st, run[0]);
  if (!atBoundary) flush(st);
  return stop;
}

// Pauses and ipa marks. Returns the index after the mark, or 0 when the
// character at `i` does not start one.
function readSpecial(say, i, st) {
  const ch = say[i];
  if (ch === '.' || ch === ELLIPSIS) {
    const m = matchAt(ELLIPSIS_RE, say, i);
    return m ? addPause(st, say, i + m[0].length, ELLIPSIS_PAUSE) : 0;
  }
  if (ch === '(') {
    const m = matchAt(PAUSE_RE, say, i);
    return m ? addPause(st, say, i + m[0].length, parsePause(m[1], say)) : 0;
  }
  if (ch === '[') {
    const m = matchAt(IPA_RE, say, i);
    if (!m) return 0;
    addText(st, m[1], m[2]);
    return i + m[0].length;
  }
  return 0;
}

function readAt(say, i, st) {
  const ch = say[i];
  if (WHITESPACE_RE.test(ch)) {
    flush(st);
    return i + 1;
  }
  if (ch === '\\' && ESCAPABLE.has(say[i + 1])) {
    addText(st, say[i + 1]);
    return i + 2;
  }
  if (MARK_CHARS.has(ch)) return readMarkRun(say, i, st);
  const end = readSpecial(say, i, st);
  if (end) return end;
  addText(st, ch);
  return i + 1;
}

function scan(say) {
  const st = { tokens: [], word: null, pause: 0, pauseEnd: -1, open: { '*': false, _: false } };
  let i = 0;
  while (i < say.length) i = readAt(say, i, st);
  flush(st);
  for (const mark of MARK_CHARS) {
    if (st.open[mark]) throw unclosedError(mark, say);
  }
  return { tokens: st.tokens, trailingPause: st.pause };
}

// A token of only closing punctuation never stands alone: it joins the
// previous token (text, emphasis, aside and sentenceEnd are merged, the
// previous ipa is kept) and its pause moves on to the next token, or to
// trailingPause. With no previous token it is left as it is.
export function mergeOrphans({ tokens, trailingPause }) {
  const out = [];
  let carry = 0;
  for (const token of tokens) {
    const prev = out.at(-1);
    if (prev && ORPHAN_RE.test(token.text)) {
      out[out.length - 1] = {
        ...prev,
        text: prev.text + token.text,
        emphasis: prev.emphasis || token.emphasis,
        aside: prev.aside || token.aside,
        sentenceEnd: prev.sentenceEnd || endsSentence(token.text),
      };
      carry += token.pauseBefore;
    } else {
      out.push(carry ? { ...token, pauseBefore: token.pauseBefore + carry } : token);
      carry = 0;
    }
  }
  return { tokens: out, trailingPause: trailingPause + carry };
}

export function parseSay(say) {
  if (typeof say !== 'string') throw new SayError(`say must be a string, got ${typeof say}`);
  const { tokens, trailingPause } = mergeOrphans(scan(say));
  if (tokens.length === 0) throw new SayError(`empty say "${say}"`);
  return { plain: tokens.map((t) => t.text).join(' '), tokens, trailingPause };
}
