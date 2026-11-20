// The languages a `code` shot may name, and common names for them. Copied from version 1's code theme
// (CODE_LANGS and LANG_ALIASES in template/code-theme.mjs, deleted at cut-over); `text` is drawn in one colour. Pure and DOM-free.

export const CODE_LANGS = Object.freeze(['text', 'javascript', 'typescript', 'json', 'bash', 'python', 'diff', 'go', 'rust', 'swift', 'yaml', 'html', 'css', 'markdown']);

// A null-prototype object: a lang such as `__proto__` or `constructor` is never an alias.
export const LANG_ALIASES = Object.freeze(Object.assign(Object.create(null), {
  js: 'javascript', mjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash',
  py: 'python', golang: 'go', rs: 'rust', yml: 'yaml', htm: 'html', md: 'markdown', txt: 'text', plaintext: 'text', patch: 'diff',
}));

/** The language `lang` names (itself or by an alias), or null. */
export function resolveLang(lang) {
  if (typeof lang !== 'string') return null;
  if (CODE_LANGS.includes(lang)) return lang;
  return Object.hasOwn(LANG_ALIASES, lang) ? LANG_ALIASES[lang] : null;
}

/** Every name a shot may give as `lang`: the languages and their aliases. */
export const LANG_NAMES = Object.freeze([...CODE_LANGS, ...Object.keys(LANG_ALIASES)]);
