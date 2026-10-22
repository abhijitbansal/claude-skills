// Finds number-plus-unit tokens ("87%", "1,204 ms", "$4.2k") that must never wrap
// across lines. Pure and dependency-free: the explainer wraps each token in a
// nowrap span at render, motion swaps its space for U+00A0, and the browser probe
// (nowrap-probe.mjs) rebuilds the same regex from TOKEN_PATTERN.
//
// A token is an optional sign or currency, digits with "," or ".", then "%", "×"
// or a unit. A space before the unit is allowed only for "%", "×" and the
// multi-letter units; one-letter units (s h d x k M B) bind only when attached,
// so "5 s" and "4 x 3" stay plain prose. A number followed by an ordinary noun
// ("12 files") is not a token. The lookbehind keeps "v1.2.3" and "H2O" out; its "digit then comma"
// clause stops a long run like "1,1,1,1" from being rescanned from every digit
// (quadratic backtracking). "%" and "×" need no boundary after them, so "50%off"
// and "3×4" still bind "50%" and "3×".
const NBSP = ' ';
const NUMBER = '[+\\-\\u2212]?[$\\u20ac\\u00a3]?\\d+(?:[.,]\\d+)*';
const SPACED_UNIT = '(?:%|\\u00d7|(?:ms|min|KB|MB|GB|TB|px)(?!\\w))';
const ATTACHED_UNIT = '[shdxkMB](?!\\w)';

export const TOKEN_PATTERN = Object.freeze({
  source: `(?<![\\w.])(?<!\\d,)${NUMBER}(?: ?${SPACED_UNIT}|${ATTACHED_UNIT})`,
  flags: 'g',
});

const tokenRegex = () => new RegExp(TOKEN_PATTERN.source, TOKEN_PATTERN.flags);

/** Every token in `text`, in order: [{ start, end, text }]. */
export function findTokens(text) {
  return [...String(text).matchAll(tokenRegex())].map((m) => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
}

/** `text` with the space inside each token replaced by U+00A0; everything else is untouched. */
export function bindWithNbsp(text) {
  return String(text).replace(tokenRegex(), (token) => token.replace(' ', NBSP));
}
