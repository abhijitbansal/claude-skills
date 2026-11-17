// Advice the validator gives without failing a spec: rules the documentation states that no error enforces, and data
// the build drops quietly. Each warning is { path, message } like an error; validate prints it as
// "path: warning: message" and still exits 0 (shared/errors.mjs makeResult / printResult).
import { pathJoin } from '../../shared/errors.mjs';
import { recommend } from './recommend.mjs';

const MAX_LABEL_WARNINGS = 10;
const q = (v) => JSON.stringify(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const squash = (text) => String(text).replace(/\s+/g, ' ').trim().toLowerCase();
const isBlank = (text) => typeof text === 'string' && text.trim() === '';

// A title nobody can read: the schema wants at least one character, and a space is one.
function blankText(spec) {
  const fields = [['title', spec.title], ['subtitle', spec.subtitle]];
  (spec.tour ?? []).forEach((beat, i) => fields.push([pathJoin(pathJoin('tour', i), 'title'), beat.title], [pathJoin(pathJoin('tour', i), 'caption'), beat.caption]));
  return fields.filter(([, text]) => isBlank(text)).map(([path]) => ({ path, message: `${path.replace(/^tour\[\d+\]\./, 'the beat ')} is blank; write it or leave it out` }));
}

// Links belong to the galaxy: any other world draws none of them.
function droppedLinks(spec, links, world) {
  if (links.length === 0 || world === 'galaxy') return [];
  return [{
    path: spec.links !== undefined && spec.links.length > 0 ? 'links' : 'data.file',
    message: `${plural(links.length, 'link')} will not be drawn: only the galaxy draws links, and this scene builds as the ${world}; set world to "galaxy" or remove them`,
  }];
}

// A parent builds a tree: any other world ignores it.
function ignoredParents(rows, base, world) {
  const at = rows.map((r, i) => (r.parent !== undefined ? i : -1)).filter((i) => i >= 0);
  if (at.length === 0 || world === 'forest') return [];
  return [{
    path: pathJoin(pathJoin(base, at[0]), 'parent'),
    message: `${plural(at.length, 'row')} ${at.length === 1 ? 'has' : 'have'} a parent, but only the forest draws one and this scene builds as the ${world}; set world to "forest" or remove parent`,
  }];
}

// Two groups whose names differ only in capitals or spacing read as one on the page but are two to the data.
function groupCollisions(rows, base) {
  const first = new Map();
  const seen = new Set();
  return rows.flatMap((r, i) => {
    const key = squash(r.group);
    if (!first.has(key)) {
      first.set(key, r.group);
      return [];
    }
    const earlier = first.get(key);
    if (earlier === r.group || seen.has(r.group)) return [];
    seen.add(r.group);
    return [{ path: pathJoin(pathJoin(base, i), 'group'), message: `group ${q(r.group)} differs from ${q(earlier)} only by case or spacing, so it is a separate group that reads as the same one; use one name` }];
  });
}

function allZero(rows, base) {
  return rows.length > 0 && rows.every((r) => r.value === 0) ? [{ path: base, message: 'every value is 0, so nothing stands up; check that value is the column you meant' }] : [];
}

// A tour focus resolves a label to its first row. One warning per repeated label, however many rows repeat it, at
// the first repeat: 500 rows sharing a label are one thing to fix, not 499 lines of output.
function sharedLabels(rows, base) {
  const seen = new Map();
  rows.forEach((r, i) => {
    if (typeof r.label !== 'string' || r.label === '') return;
    const key = r.label.toLowerCase();
    const entry = seen.get(key) ?? { first: i, label: r.label, repeats: [] };
    if (entry.first !== i) entry.repeats.push(i);
    seen.set(key, entry);
  });
  const found = [...seen.values()].filter((e) => e.repeats.length > 0);
  const shown = found.slice(0, MAX_LABEL_WARNINGS).map(({ first, label, repeats }) => ({
    path: pathJoin(pathJoin(base, repeats[0]), 'label'),
    message: `${repeats.length === 1 ? 'this row has' : `${repeats.length} rows have`} the same label as ${pathJoin(base, first)} (${q(label)}); a tour focus reaches only the first, so give each label a name of its own`,
  }));
  const more = found.length - shown.length;
  return more > 0 ? [...shown, { path: base, message: `${plural(more, 'more repeated label')}; give each label a name of its own` }] : shown;
}

/**
 * Warnings for a spec that has passed validation. `data` is { rows, links, base } of a data scene (base: where its
 * rows sit in the spec, for the paths), absent for a lift, which has only the text warnings.
 */
export function sceneWarnings(spec, data) {
  const text = blankText(spec);
  if (!data) return text;
  const { rows, links, base } = data;
  const world = spec.world ?? recommend({ rows, links }).ranked[0];
  return [
    ...text,
    ...droppedLinks(spec, links, world),
    ...ignoredParents(rows, base, world),
    ...groupCollisions(rows, base),
    ...allZero(rows, base),
    ...sharedLabels(rows, base),
  ];
}
