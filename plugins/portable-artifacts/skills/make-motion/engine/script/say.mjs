// Narration markup parser. Pure: no DOM, no clock, no randomness.
//
// Marks inside a `say` line:
//   *word*          emphasis on each enclosed word
//   _word_          aside on each enclosed word
//   ...  or  the ellipsis character
//                   pause of ELLIPSIS_PAUSE before the next word
//   (0.4)           pause of that many seconds before the next word; only a
//                   number with a decimal point is a pause, so (2024) is text
//   [word](/ipa/)   spoken pronunciation hint, kept on the token as `ipa`
//
// Word-boundary rule for * and _ (anything else is literal text, so
// snake_case, __init__ and a*b are plain):
//   - A mark OPENS when the character before it is the start of the line,
//     whitespace or an opening bracket or quote, and the character after it
//     is not whitespace.
//   - A mark CLOSES when the character before it is not whitespace and the
//     character after it is the end of the line, whitespace, or closing
//     punctuation (including the start of an ellipsis).
//   - A mark next to the same mark character is literal (runs like __).
//   - An opener of a type that is already open is a SayError ("nested").
//
// Pauses: punctuation glued right after a pause stays on the word before it
// (Really...? is one token). A pause moves to the next word's `pauseBefore`;
// with no word after it, it is returned as `trailingPause`.
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

const ELLIPSIS = '…';
const ELLIPSIS_RE = /(?:\.{3,}|…)+/y;
const PAUSE_RE = /\((\d+\.\d+|\.\d+)\)/y;
const IPA_RE = /\[([^\]\s]+)\]\(\/([^/)]+)\/\)/y;
const WHITESPACE_RE = /\s/;
const SENTENCE_END_RE = /[.!?]$/;
const CLOSERS_RE = /["')\]”’]+$/;
const ORPHAN_RE = /^[,.;:!?)\]}"'”’]+$/;
const OPEN_BEFORE = new Set(['(', '[', '{', '"', "'", '“', '‘']);
const CLOSE_AFTER = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '"', "'", '”', '’', ELLIPSIS]);
const MARK_CHARS = new Set(['*', '_']);

function matchAt(re, text, index) {
  re.lastIndex = index;
  return re.exec(text);
}

const isSpaceOrEdge = (ch) => ch === undefined || WHITESPACE_RE.test(ch);

// What a `*` or `_` at `i` does: 'open', 'close', 'nested' (an opener while
// this type is already open) or 'literal'. See the file header for the rule.
function markAction(say, i, isOpen) {
  const ch = say[i];
  const prev = say[i - 1];
  const next = say[i + 1];
  if (prev === ch || next === ch) return 'literal';
  const opens = (isSpaceOrEdge(prev) || OPEN_BEFORE.has(prev)) && !isSpaceOrEdge(next);
  const closes = !isSpaceOrEdge(prev) && (isSpaceOrEdge(next) || CLOSE_AFTER.has(next));
  if (isOpen) {
    if (closes) return 'close';
    return opens ? 'nested' : 'literal';
  }
  return opens ? 'open' : 'literal';
}

// Applies a `*` or `_` mark. Returns false when it is literal text.
function toggleMark(say, i, st) {
  const ch = say[i];
  const action = markAction(say, i, st.open[ch]);
  if (action === 'nested') throw new SayError(`nested ${ch} in "${say}"`);
  if (action === 'literal') return false;
  st.open[ch] = !st.open[ch];
  return true;
}

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

const endsSentence = (text) => SENTENCE_END_RE.test(text.replace(CLOSERS_RE, ''));

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

// Records a pause that ends at index `end`. Closing punctuation glued right
// after it stays on the current word; otherwise the word ends here.
function addPause(st, say, end, seconds) {
  if (!CLOSE_AFTER.has(say[end])) flush(st);
  st.pause += seconds;
  return end;
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
  if (MARK_CHARS.has(ch) && toggleMark(say, i, st)) return i + 1;
  const end = readSpecial(say, i, st);
  if (end) return end;
  addText(st, ch);
  return i + 1;
}

function scan(say) {
  const st = { tokens: [], word: null, pause: 0, open: { '*': false, _: false } };
  let i = 0;
  while (i < say.length) i = readAt(say, i, st);
  flush(st);
  for (const mark of MARK_CHARS) {
    if (st.open[mark]) throw new SayError(`unclosed ${mark} in "${say}"`);
  }
  return { tokens: st.tokens, trailingPause: st.pause };
}

// A token of only closing punctuation never stands alone: it joins the
// previous token and its pause moves on to the next token (or trailingPause).
// With no previous token it is left as it is.
function mergeOrphans({ tokens, trailingPause }) {
  const out = [];
  let carry = 0;
  for (const token of tokens) {
    const prev = out.at(-1);
    if (prev && ORPHAN_RE.test(token.text)) {
      const sentenceEnd = prev.sentenceEnd || endsSentence(token.text);
      out[out.length - 1] = { ...prev, text: prev.text + token.text, sentenceEnd };
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
