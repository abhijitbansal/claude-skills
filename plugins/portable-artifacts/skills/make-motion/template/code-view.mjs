// Browser: the DOM of a `code` element. shiki (the fine-grained core, the JavaScript regex engine, no wasm) is imported
// only when a spec has a code element, with only the grammars it names; it tokenises each element once at load, and
// the tokens become text nodes in coloured spans (never markup), one row per line. `highlight` rows get the surface
// colour, a `diff` row starting with + or - a good or bad tint, and a `typing` element shows its first n characters with
// a caret, the rest kept in the layout but not drawn, so its box never changes.
import { graphemes, typingLength, resolveColor } from './defaults.mjs';
import { flattenElements } from './groups.mjs';
import { codeTheme, codeLines, isCodeLang, DEFAULT_CODE_SIZE, DIFF_TINT_PERCENT } from './code-theme.mjs';

const THEME = 'make-motion';
const DIFF_MARKER = /^[+\- ]/;
const MISSING = 'code elements need shiki, which did not load; reinstall the skill\'s packages (npm ci in the make-motion folder, or node scripts/doctor.mjs --fix node_modules)';

async function loadHighlighter(langs, look) {
  let modules;
  try {
    modules = await Promise.all([import('shiki/core'), import('shiki/engine/javascript'), ...langs.map((lang) => import(`@shikijs/langs/${lang}`))]);
  } catch (e) {
    throw new Error(`${MISSING} (${e.message})`);
  }
  const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, ...grammars] = modules;
  return createHighlighterCore({ themes: [codeTheme(look.colors)], langs: grammars.map((m) => m.default), engine: createJavaScriptRegexEngine() });
}

/**
 * `(el) => Promise<lines>` for the code elements of `spec`, where each line is { marker, tokens: [{ content, color }] }.
 * The highlighter is created on the first call, once per stage, with every language the spec's code elements name.
 */
export function codeHighlighter(spec, look) {
  const codes = spec.scenes.flatMap((s) => flattenElements(s.elements)).map(({ el }) => el).filter((el) => el.type === 'code');
  const langs = [...new Set(codes.map((el) => el.lang))].filter((lang) => lang !== 'text' && isCodeLang(lang));
  let ready = null;
  return async (el) => {
    ready ??= loadHighlighter(langs, look);
    const highlighter = await ready;
    const lines = codeLines(el.code);
    const markers = lines.map((line) => (el.diff && DIFF_MARKER.test(line) ? line[0] : ''));
    const body = lines.map((line, i) => line.slice(markers[i].length)).join('\n');
    const lang = isCodeLang(el.lang) ? el.lang : 'text';
    const { tokens } = highlighter.codeToTokens(body, { lang, theme: THEME });
    return lines.map((_, i) => ({ marker: markers[i], tokens: tokens[i] ?? [] }));
  };
}

const px = (n) => `${n}px`;

/** Styles the empty node of code element `el` (font, colour, width); fillCode adds the rows once the tokens are in. */
export function styleCode(node, el, look) {
  node.style.fontSize = px(el.fontSize ?? DEFAULT_CODE_SIZE);
  node.style.fontWeight = String(look.weight('mono', 400));
  node.style.color = look.text;
  node.style.width = px(el.width);
  if (el.height !== undefined) node.style.minHeight = px(el.height);
}

// A run of characters drawn in one colour: as is, or (typing) split into what is typed and the hidden rest.
function inkSpan(text, color, typing, pieces) {
  const span = document.createElement('span');
  span.style.color = color;
  span.dataset.ink = '';
  if (!typing) {
    span.textContent = text;
    return span;
  }
  const typed = document.createElement('span');
  typed.className = 'typed';
  const rest = document.createElement('span');
  rest.className = 'rest';
  rest.style.visibility = 'hidden';
  rest.textContent = text;
  span.append(typed, rest);
  pieces.push({ chars: graphemes(text), typed, rest });
  return span;
}

/**
 * Fills `node` with one row per line of `lines` (from codeHighlighter). -> the typing state for setCodeTyping, or null.
 */
export function fillCode(node, el, lines, look) {
  const colors = look.colors;
  const tint = (token) => `color-mix(in srgb, ${resolveColor(token, colors)} ${DIFF_TINT_PERCENT}%, transparent)`;
  const marks = { '+': 'good', '-': 'bad', ' ': 'text3' };
  const highlighted = new Set(el.highlight ?? []);
  const typing = el.typing === true;
  const pieces = [];
  const rows = lines.map(({ marker, tokens }, i) => {
    const row = document.createElement('div');
    row.className = 'line';
    if (marker === '+' || marker === '-') row.style.background = tint(marks[marker]);
    else if (highlighted.has(i + 1)) row.style.background = colors.surface;
    if (marker) row.append(inkSpan(marker, colors[marks[marker]], typing, pieces));
    for (const token of tokens) row.append(inkSpan(token.content, token.color ?? look.text, typing, pieces));
    if (i < lines.length - 1) pieces.push({ chars: ['\n'], next: i + 1 }); // the newline: counted, not drawn
    return row;
  });
  node.append(...rows);
  if (!typing) return null;
  const caret = document.createElement('span');
  caret.className = 'caret';
  return { node, rows, pieces, caret, total: typingLength(el.code), shown: -1 };
}

/**
 * Shows the first `n` characters of a typing code element (state from fillCode) with the caret after them; `caretOn`:
 * whether the caret is drawn (it blinks once the code is complete, as a text's does).
 */
export function setCodeTyping(state, n, caretOn) {
  const { node, rows, pieces, caret, total } = state;
  caret.style.visibility = n < total || caretOn ? 'visible' : 'hidden';
  node.dataset.typed = String(n); // check.mjs: a code element with nothing typed is not drawn yet
  if (n === state.shown) return;
  state.shown = n;
  let left = n >= total ? Infinity : n; // complete shows every piece, even where a grapheme was split between tokens
  let after = null; // where the caret goes: after the typed part of the last piece reached
  for (const piece of pieces) {
    const k = Math.max(0, Math.min(piece.chars.length, left));
    left -= piece.chars.length;
    if (piece.typed) {
      piece.typed.textContent = piece.chars.slice(0, k).join('');
      piece.rest.textContent = piece.chars.slice(k).join('');
    }
    if (k > 0) after = piece;
  }
  if (!after) rows[0].prepend(caret);
  else if (after.typed) after.typed.after(caret);
  else rows[after.next].prepend(caret);
}
