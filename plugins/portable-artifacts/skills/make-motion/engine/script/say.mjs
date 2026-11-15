// Narration markup parser. Pure: no DOM, no clock, no randomness.
//
// Marks inside a `say` line:
//   *word*          emphasis on each enclosed word
//   _word_          aside on each enclosed word (a _ inside a word is literal)
//   ...             pause of ELLIPSIS_PAUSE before the next word
//   (0.4)           pause of that many seconds before the next word; only a
//                   number with a decimal point is a pause, so (2024) is text
//   A pause with no word after it is returned as `trailingPause`.
//   Marks of the same kind cannot nest (*a *b* c* is a SayError).
//   [word](/ipa/)   spoken pronunciation hint, kept on the token as `ipa`

export class SayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SayError';
  }
}

const ELLIPSIS_PAUSE = 0.35;
const PAUSE_MIN = 0.05;
const PAUSE_MAX = 3;

const ELLIPSIS_RE = /\.{3,}/y;
const PAUSE_RE = /\((\d+\.\d+|\.\d+)\)/y;
const IPA_RE = /\[([^\]\s]+)\]\(\/([^/)]+)\/\)/y;
const WHITESPACE_RE = /\s/;
const WORD_CHAR_RE = /[\p{L}\p{N}]/u;
const SENTENCE_END_RE = /[.!?]$/;
const CLOSERS_RE = /["')\]”’]+$/;

function matchAt(re, text, index) {
  re.lastIndex = index;
  return re.exec(text);
}

const isWordChar = (ch) => ch !== undefined && WORD_CHAR_RE.test(ch);

const isSpaceOrEdge = (ch) => ch === undefined || WHITESPACE_RE.test(ch);

// `*` toggles emphasis. While emphasis is open, a `*` that starts a word
// (space or edge before, text after) would open a second one: an error.
function toggleEmphasis(say, i, st) {
  if (st.emphasis && isSpaceOrEdge(say[i - 1]) && !isSpaceOrEdge(say[i + 1])) {
    throw new SayError(`nested * in "${say}"`);
  }
  st.emphasis = !st.emphasis;
}

// `_` opens an aside at the start of a word and closes one at the end of a
// word; anywhere else (snake_case) it is plain text. Returns whether it was
// a mark. An opener-shaped `_` inside an open aside is a nesting error.
function toggleAside(say, i, st) {
  const prev = say[i - 1];
  const next = say[i + 1];
  const closes = !isSpaceOrEdge(prev) && !isWordChar(next);
  const opens = !isWordChar(prev) && !isSpaceOrEdge(next) && next !== '_';
  if (st.aside && !closes && opens) throw new SayError(`nested _ in "${say}"`);
  if (!(st.aside ? closes : opens)) return false;
  st.aside = !st.aside;
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
  st.word.emphasis ||= st.emphasis;
  st.word.aside ||= st.aside;
  if (ipa !== undefined) st.word.ipa = ipa;
}

function finishToken(word) {
  const { text, emphasis, aside, pauseBefore, ipa } = word;
  const sentenceEnd = SENTENCE_END_RE.test(text.replace(CLOSERS_RE, ''));
  const token = { text, emphasis, aside, pauseBefore, sentenceEnd };
  return ipa === undefined ? token : { ...token, ipa };
}

function flush(st) {
  if (!st.word) return;
  st.tokens.push(finishToken(st.word));
  st.word = null;
}

// Pauses and ipa marks. Returns the index after the mark, or 0 when the
// character at `i` does not start one.
function readSpecial(say, i, st) {
  const ch = say[i];
  if (ch === '.') {
    const m = matchAt(ELLIPSIS_RE, say, i);
    if (!m) return 0;
    flush(st);
    st.pause += ELLIPSIS_PAUSE;
    return i + m[0].length;
  }
  if (ch === '(') {
    const m = matchAt(PAUSE_RE, say, i);
    if (!m) return 0;
    flush(st);
    st.pause += parsePause(m[1], say);
    return i + m[0].length;
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
  if (ch === '*') {
    toggleEmphasis(say, i, st);
    return i + 1;
  }
  if (ch === '_' && toggleAside(say, i, st)) return i + 1;
  const end = readSpecial(say, i, st);
  if (end) return end;
  addText(st, ch);
  return i + 1;
}

function scan(say) {
  const st = { tokens: [], word: null, pause: 0, emphasis: false, aside: false };
  let i = 0;
  while (i < say.length) i = readAt(say, i, st);
  flush(st);
  if (st.emphasis) throw new SayError(`unclosed * in "${say}"`);
  if (st.aside) throw new SayError(`unclosed _ in "${say}"`);
  return { tokens: st.tokens, trailingPause: st.pause };
}

export function parseSay(say) {
  if (typeof say !== 'string') throw new SayError(`say must be a string, got ${typeof say}`);
  const { tokens, trailingPause } = scan(say);
  if (tokens.length === 0) throw new SayError(`empty say "${say}"`);
  return { plain: tokens.map((t) => t.text).join(' '), tokens, trailingPause };
}
