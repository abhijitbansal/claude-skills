// "not valid JSON" with a place: the line and column of the first character the JSON grammar
// refuses, the line itself (trimmed) and a caret under the column. The engine's own message
// varies by Node version and often has no position, so the position comes from a small
// scanner of the JSON grammar; it runs only after JSON.parse has already failed.
import { UsageError } from '../../shared/cli.mjs';

const MAX_LINE = 120;
const CONTEXT_BEFORE = MAX_LINE / 2;
const ESCAPES = '"\\/bfnrtu';
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}/;
const BOM = '﻿';

/** A UsageError that also carries `snippet`: the offending line and a caret line. */
export class JsonSyntaxError extends UsageError {
  constructor(message, snippet) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.snippet = snippet;
  }
}

class Refusal {
  constructor(pos, expected) {
    this.pos = pos;
    this.expected = expected;
  }
}

// -> the first refusal in `text`, or null when the scanner finds none.
function scan(text) {
  let i = 0;
  const refuse = (expected) => { throw new Refusal(i, expected); };
  const skipSpace = () => { while (i < text.length && ' \t\n\r'.includes(text[i])) i++; };

  function string() {
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') { i++; return; }
      if (c < ' ') refuse('no raw line break or tab inside a string (write \\n or \\t)');
      if (c === '\\') {
        i++;
        if (!ESCAPES.includes(text[i] ?? '')) refuse('an escape such as \\n, \\" or \\\\');
        if (text[i] === 'u' && !HEX4.test(text.slice(i + 1, i + 5))) { i++; refuse('four hex digits after \\u'); }
      }
      i++;
    }
    refuse('a closing quote');
  }

  function members(open, close, item) {
    i++;
    skipSpace();
    if (text[i] === close) { i++; return; }
    for (;;) {
      item();
      skipSpace();
      if (text[i] === ',') { i++; skipSpace(); continue; }
      if (text[i] === close) { i++; return; }
      refuse(`"," or "${close}"`);
    }
  }

  function property() {
    if (text[i] !== '"') refuse('a property name in double quotes');
    string();
    skipSpace();
    if (text[i] !== ':') refuse('":" after the property name');
    i++;
    value();
  }

  function value() {
    skipSpace();
    const c = text[i];
    if (c === '{') return members('{', '}', property);
    if (c === '[') return members('[', ']', value);
    if (c === '"') return string();
    for (const word of ['true', 'false', 'null']) {
      if (text.startsWith(word, i)) { i += word.length; return undefined; }
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m) { i += m[0].length; return undefined; }
    return refuse('a value (string, number, true, false, null, [ or {)');
  }

  try {
    value();
    skipSpace();
    if (i < text.length) refuse('the end of the file');
  } catch (e) {
    if (e instanceof Refusal) return e;
    if (e instanceof RangeError) return new Refusal(text.length, 'shallower nesting'); // absurdly deep
    throw e;
  }
  return null;
}

// -> [what was found, advice or '']
function describe(text, { pos, expected }) {
  if (pos >= text.length) return ['unexpected end of input', ''];
  const c = text[pos];
  if (c === BOM) return ['unexpected byte order mark', 'save the file as UTF-8 without a BOM'];
  const shown = c < ' ' || c === '\u007f' ? `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : JSON.stringify(c);
  const trailing = (c === '}' || c === ']') && text.slice(0, pos).trimEnd().endsWith(',');
  return [`unexpected ${shown}`, trailing ? 'remove the trailing comma before it' : `expected ${expected}`];
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemesOf = (text) => Array.from(GRAPHEMES.segment(text), (g) => g.segment);

// Terminal cells in the East Asian wide and fullwidth blocks, and emoji, take two columns.
const WIDE = /^[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]|\p{Emoji_Presentation}/u;
const cells = (grapheme) => (WIDE.test(grapheme) ? 2 : 1);

// The line holding `pos`, without its indentation, cut to MAX_LINE characters around the column. The column and the
// caret are in characters as a reader sees them (grapheme clusters), and the caret is padded by terminal cells.
function snippetAt(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const newline = text.indexOf('\n', pos);
  const raw = text.slice(lineStart, newline === -1 ? text.length : newline).replace(/\r$/, '').replaceAll('\t', ' ');
  let chars = graphemesOf(raw);
  let offset = Math.min(graphemesOf(text.slice(lineStart, pos)).length, chars.length);
  const indent = Math.min(chars.findIndex((c) => !/^\s$/.test(c)) === -1 ? chars.length : chars.findIndex((c) => !/^\s$/.test(c)), offset);
  chars = chars.slice(indent);
  offset -= indent;
  if (chars.length > MAX_LINE) {
    const start = Math.max(0, Math.min(offset - CONTEXT_BEFORE, chars.length - MAX_LINE));
    const end = Math.min(chars.length, start + MAX_LINE);
    const head = start > 0 ? ['…'] : [];
    const tail = end < chars.length ? ['…'] : [];
    offset = offset - start + head.length;
    chars = [...head, ...chars.slice(start, end), ...tail];
  }
  const pad = chars.slice(0, offset).reduce((n, c) => n + cells(c), 0);
  return `  ${chars.join('')}\n  ${' '.repeat(pad)}^`;
}

/** The error for `file`, whose `text` JSON.parse refused. */
export function jsonSyntaxError(file, text, parseError) {
  const found = scan(text);
  const refusal = found ?? new Refusal(text.length, 'more input');
  // Running out of input points at the end of the last line that has anything on it, not at the blank lines after.
  const pos = refusal.pos >= text.length ? text.trimEnd().length : refusal.pos;
  const before = text.slice(0, pos);
  const line = (before.match(/\n/g)?.length ?? 0) + 1;
  const column = graphemesOf(before.slice(before.lastIndexOf('\n') + 1)).length + 1;
  // The scanner found nothing (the engine is stricter than the grammar): fall back to the engine's words.
  const [what, advice] = found ? describe(text, refusal) : [parseError.message.split('\n')[0], ''];
  const where = found ? ` at line ${line}, column ${column}` : ` (line ${line}, column ${column})`;
  return new JsonSyntaxError(`${file} is not valid JSON: ${what}${where}${advice ? `; ${advice}` : ''}`, snippetAt(text, pos));
}
