// What the schema cannot say about a `code` element (spec.mjs runs it with the other element checks): its `lang` is one
// of CODE_LANGS, with the closest one named (a common name such as "js" first), and every `highlight` line exists.
import { pathJoin, didYouMean } from '../../shared/errors.mjs';
import { CODE_LANGS, isCodeLang, langAlias, codeLines } from '../../template/code-theme.mjs';

function checkLang(el, base, errors) {
  if (typeof el.lang !== 'string' || isCodeLang(el.lang)) return;
  const near = langAlias(el.lang.toLowerCase()) ?? didYouMean(el.lang, CODE_LANGS);
  errors.push({ path: pathJoin(base, 'lang'), message: `unknown lang ${JSON.stringify(el.lang)}${near ? `; did you mean ${JSON.stringify(near)}?` : ''} (langs: ${CODE_LANGS.join(', ')})` });
}

function checkHighlight(el, base, errors) {
  if (!Array.isArray(el.highlight) || typeof el.code !== 'string') return;
  const count = codeLines(el.code).length;
  el.highlight.forEach((line, i) => {
    if (line > count) errors.push({ path: pathJoin(pathJoin(base, 'highlight'), i), message: `line ${line} is past the end; the code has ${count} line${count === 1 ? '' : 's'}` });
  });
}

/** Pushes the errors of code element `el` at `base` (its path) onto `errors`. */
export function checkCode(el, base, errors) {
  checkLang(el, base, errors);
  checkHighlight(el, base, errors);
}
