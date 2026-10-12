// Slides mode: each section is one slide, so each gets a content budget.
// Points: tldr points, "- " list lines in markdown fields, items of list-like
// sections, compare points, checklist items. Words: every prose string of the
// section except its own title and captions (tables and code have their own
// limits).
import { pathJoin } from '../../shared/errors.mjs';
import { SLIDE_LIMITS } from './schema.mjs';
import { collectStrings } from './walk.mjs';

const listLines = (text) => (text ?? '').split('\n').filter((l) => l.trimStart().startsWith('- ')).length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const words = (s) => (s.match(/\S+/g) ?? []).length;

export function codeLines(code) {
  return code.replace(/\n+$/, '').split('\n').length;
}

function pointCount(s) {
  switch (s.type) {
    case 'tldr': return s.points?.length ?? 0;
    case 'text': case 'details': return listLines(s.text);
    case 'kpis': case 'cards': case 'steps': case 'timeline': case 'risks': case 'files': return s.items.length;
    case 'compare': return sum(s.columns.map((c) => c.points.length));
    case 'checklist': return sum(s.groups.map((g) => g.items.length));
    default: return 0;
  }
}

function wordCount(s, path) {
  if (s.type === 'table') return 0;
  return sum(collectStrings(s, path)
    .filter((x) => x.prose && x.path !== pathJoin(path, 'title') && x.key !== 'caption')
    .map((x) => words(x.text)));
}

export function slideBudget(spec) {
  const errors = [];
  spec.sections.forEach((s, i) => {
    const at = pathJoin('sections', i);
    const points = pointCount(s);
    if (points > SLIDE_LIMITS.points) {
      errors.push({ path: at, message: `slide has ${points} points; the limit is ${SLIDE_LIMITS.points} — split this section into two slides` });
    }
    if (s.type === 'table' && s.rows.length > SLIDE_LIMITS.tableRows) {
      errors.push({ path: pathJoin(at, 'rows'), message: `slide has ${s.rows.length} table rows; the limit is ${SLIDE_LIMITS.tableRows} — split the table across slides` });
    }
    if (s.type === 'code' && codeLines(s.code) > SLIDE_LIMITS.codeLines) {
      errors.push({ path: pathJoin(at, 'code'), message: `slide has ${codeLines(s.code)} code lines; the limit is ${SLIDE_LIMITS.codeLines} — show the key lines or split the section` });
    }
    const w = wordCount(s, at);
    if (w > SLIDE_LIMITS.words) {
      errors.push({ path: at, message: `slide has ${w} words; the limit is ${SLIDE_LIMITS.words} — cut text or split this section into two slides` });
    }
  });
  return errors;
}
