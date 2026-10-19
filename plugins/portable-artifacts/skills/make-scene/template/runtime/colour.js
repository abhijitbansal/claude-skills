// ColourRef resolution. Pure (no three, no DOM) so node:test can import it.
// A ColourRef is a theme token, a #rrggbb hex, or { base, tint, share }.
// Resolved on every theme change, so mixed colours follow the toggle.

// Token -> CSS variable. Mirrors VARS in shared/theme.mjs (a test keeps the two in step).
export const TOKEN_VARS = {
  page: '--page', surface: '--surface', text: '--text', text2: '--text-2', text3: '--text-3',
  line: '--line', grid: '--grid', accent: '--accent', accentSoft: '--accent-soft',
  warn: '--warn', good: '--good', bad: '--bad',
  cat1: '--s1', cat2: '--s2', cat3: '--s3', cat4: '--s4', cat5: '--s5', cat6: '--s6', cat7: '--s7', cat8: '--s8',
  seq1: '--seq1', seq2: '--seq2', seq3: '--seq3', seq4: '--seq4', seq5: '--seq5', seq6: '--seq6', seq7: '--seq7',
  kindPerson: '--k-person', kindService: '--k-service', kindData: '--k-data', kindQueue: '--k-queue', kindExternal: '--k-external', kindDecision: '--k-decision',
  glow: '--glow',
};

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX3 = /^#[0-9a-f]{3}$/i;
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/i;
const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** What getPropertyValue returns (padded, #rgb, rgb()) -> '#rrggbb'. */
export function toHex(value) {
  const text = String(value ?? '').trim();
  if (HEX6.test(text)) return text.toLowerCase();
  if (HEX3.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  const rgb = RGB.exec(text);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((n) => hex2(Number(n))).join('')}`;
  throw new TypeError(text === '' ? 'colour is empty' : `unreadable colour ${JSON.stringify(text)}`);
}

/** Same arithmetic as mixHex in shared/contrast.mjs: `a` mixed `share` (0..1) into `b`, per 8-bit channel, rounded. */
export function mixHex(a, b, share) {
  const ch = (c) => [1, 3, 5].map((i) => Number.parseInt(c.slice(i, i + 2), 16));
  const [ca, cb] = [ch(a), ch(b)];
  return `#${ca.map((v, i) => hex2(v * share + cb[i] * (1 - share))).join('')}`;
}

function readToken(token, readVar) {
  if (!Object.hasOwn(TOKEN_VARS, token)) throw new TypeError(`unknown colour token ${JSON.stringify(token)}`);
  const cssVar = TOKEN_VARS[token];
  try {
    return toHex(readVar(cssVar));
  } catch (err) {
    throw new TypeError(`theme variable ${cssVar} (${token}): ${err.message}`);
  }
}

/**
 * ColourRef -> '#rrggbb'. `readVar(cssVar)` returns the computed value of a CSS variable, e.g. '--s1'.
 * In { base, tint, share }, `share` is the share of the theme `tint` mixed INTO the fixed `base`
 * (0 = base, 1 = tint). That keeps a world's identity: the forest meadow is base #4f8a46 with 30% of the
 * page surface; group steps are the category colour at 60% over white (lighter) or black (darker).
 */
export function resolveColour(ref, readVar) {
  if (typeof ref === 'string') {
    if (ref.startsWith('#')) return toHex(ref);
    return readToken(ref, readVar);
  }
  if (ref && typeof ref === 'object' && typeof ref.tint === 'string' && typeof ref.base === 'string') {
    return mixHex(readToken(ref.tint, readVar), toHex(ref.base), ref.share);
  }
  throw new TypeError(`not a colour: ${JSON.stringify(ref)}`);
}
