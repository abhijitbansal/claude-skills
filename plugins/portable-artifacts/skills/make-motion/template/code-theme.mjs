// Browser-safe (no Node imports): what a `code` element may say and how it is coloured. The validator reads CODE_LANGS
// and the aliases; the renderer (template/code-view.mjs) reads codeTheme. shiki itself is loaded only by the page, and
// only when a spec has a code element.

// The languages a code element may name: `text` draws the code in one colour, every other one has its shiki grammar
// served from /vendor/@shikijs/langs/ (server.mjs, template/index.html).
export const CODE_LANGS = Object.freeze(['text', 'javascript', 'typescript', 'json', 'bash', 'python', 'diff', 'go', 'rust', 'swift', 'yaml', 'html', 'css', 'markdown']);

// Common names for those languages, for the validator's "did you mean". A null-prototype object: a lang such as
// `__proto__` or `constructor` is never an alias.
export const LANG_ALIASES = Object.freeze(Object.assign(Object.create(null), {
  js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash',
  py: 'python', golang: 'go', rs: 'rust', yml: 'yaml', htm: 'html', md: 'markdown', txt: 'text', plaintext: 'text', patch: 'diff',
}));

export const isCodeLang = (lang) => CODE_LANGS.includes(lang);
/** The language `lang` is a common name for, or undefined. Own keys only. */
export const langAlias = (lang) => (typeof lang === 'string' && Object.hasOwn(LANG_ALIASES, lang) ? LANG_ALIASES[lang] : undefined);

export const DEFAULT_CODE_SIZE = 28; // px: the text-floor audit's limit at 1080, so a default code element passes it exactly
export const CODE_LINE_HEIGHT = 1.4;
export const MONO_EM = 0.7; // the widest advance of the bundled mono fonts (Martian Mono), as a share of the font size
export const CODE_TAB_SIZE = 2;
export const CODE_ROW_PAD_EM = 0.3; // a row's padding at each end, so a highlight or diff tint reaches past the glyphs
export const DIFF_TINT_PERCENT = 15; // a diff row's good or bad tint

/** The lines of `code`, as the page draws them (one row each, wrapping inside the width). */
export const codeLines = (code) => String(code).split('\n');

/**
 * The TextMate theme a code element is highlighted with, from the active theme's dark colour tokens: keywords in accent,
 * strings in good, comments in text3, numbers and constants in warn, functions in cat1, types in cat2, everything else
 * in text; a diff's inserted and deleted lines in good and bad. The background is transparent (the scene shows through).
 */
export function codeTheme(colors) {
  const rule = (scope, token) => ({ scope, settings: { foreground: colors[token] } });
  return {
    name: 'make-motion',
    type: 'dark',
    fg: colors.text,
    bg: 'transparent',
    settings: [
      { settings: { foreground: colors.text, background: 'transparent' } },
      rule(['keyword', 'storage', 'storage.type', 'entity.name.tag', 'markup.heading', 'entity.name.section'], 'accent'),
      rule(['string', 'markup.inline.raw', 'markup.raw'], 'good'),
      rule(['comment', 'punctuation.definition.comment'], 'text3'),
      rule(['constant', 'constant.numeric', 'constant.language', 'constant.character', 'support.constant'], 'warn'),
      rule(['entity.name.function', 'support.function', 'meta.function-call'], 'cat1'),
      rule(['entity.name.type', 'support.type', 'entity.other.inherited-class', 'entity.other.attribute-name'], 'cat2'),
      rule(['markup.inserted'], 'good'),
      rule(['markup.deleted'], 'bad'),
    ],
  };
}
