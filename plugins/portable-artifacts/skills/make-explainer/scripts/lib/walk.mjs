// Every string in a spec (or a part of it) with its JSON path and what kind of
// text it is. Prose is what a reader sees; the rest (ids, paths, code, enums,
// inline sub-specs, data) is exempt from the style lint but not from placeholder
// detection.
import { pathJoin } from '../../shared/errors.mjs';

const NON_PROSE = new Set([
  'type', 'id', 'key', 'src', 'path', 'code', 'language', 'diagram', 'scene', 'dashboard', 'chart', 'video', 'spec', 'poster',
  'data', 'kind', 'x', 'y', 'color', 'format', 'icon', 'tone', 'tag', 'status', 'change', 'severity', 'align',
  'theme', 'preset', 'mode', 'meta', 'recommended', 'target',
]);
// A field that is prose in one section type and not in another: a decision's default names an option label;
// a question's default is a sentence the reader sees.
const NON_PROSE_IN = { default: new Set(['decision']) };
const isNonProse = (key, owner) => NON_PROSE.has(key) || (Object.hasOwn(NON_PROSE_IN, key) && NON_PROSE_IN[key].has(owner?.type));
const HEADING_KEYS = new Set(['title', 'summary']);

/**
 * -> [{ path, text, prose, heading, key }]. `key` is the nearest object key.
 */
export function collectStrings(value, path = '') {
  const out = [];
  const visit = (v, p, state) => {
    if (typeof v === 'string') {
      out.push({ path: p, text: v, ...state });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, pathJoin(p, i), state));
    } else if (v && typeof v === 'object') {
      for (const [key, x] of Object.entries(v)) {
        const prose = state.prose && !isNonProse(key, v);
        visit(x, pathJoin(p, key), { prose, heading: prose && HEADING_KEYS.has(key), key });
      }
    }
  };
  visit(value, path, { prose: true, heading: false, key: '' });
  return out;
}
