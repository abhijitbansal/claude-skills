// Soft text caps: warnings only, never errors. They push agents toward short,
// scannable pages. Prose = the strings a reader reads as sentences; code,
// tables, file lists and the like are exempt (see EXEMPT_TYPES).
import { pathJoin } from '../../shared/errors.mjs';

export const SOFT_CAPS = {
  titleWords: 8,
  labelWords: 4,
  paragraphWords: 60,
  paragraphSentences: 3,
  textSectionWords: 120,
  cardWords: 30,
  itemWords: 20,
  pageWords: 900,
  tldrPoints: 3,
};

const EXEMPT_TYPES = new Set(['code', 'table', 'files', 'timeline', 'checklist', 'diagram', 'chart', 'motion', 'image']);
const PROSE_KEYS = new Set(['text', 'lead', 'body', 'note', 'points', 'items']);
const SKIP_KEYS = new Set(['id', 'type', 'tone', 'severity', 'lang', 'src', 'href', 'label', 'title']);
const CARD_TYPES = new Set(['cards', 'steps']);
const ABBREVIATION = /\b(?:e\.g|i\.e|etc|vs|approx)\./gi;

export const words = (s) => (s.match(/\S+/g) ?? []).length;

/** Sentences in a string: terminators followed by space or the end; at least 1. */
export function sentences(s) {
  const n = (s.replace(ABBREVIATION, '').match(/[.!?]+(?=\s|$)/g) ?? []).length;
  return Math.max(1, n);
}

// A blank line separates paragraphs; in a block made only of "- " lines each line is its own paragraph.
function paragraphs(text) {
  return text.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    return lines.length > 0 && lines.every((l) => l.trimStart().startsWith('- ')) ? lines : [block];
  });
}

// Every prose string of a section: { path, text, key, listItem }. A string is prose when its nearest
// object key is a prose key; array elements inherit the key of their array.
function proseStrings(section, at) {
  const out = [];
  const visit = (v, path, key, parentIsArray) => {
    if (typeof v === 'string') {
      if (PROSE_KEYS.has(key)) out.push({ path, text: v, key, listItem: parentIsArray && (key === 'points' || key === 'items') });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, pathJoin(path, i), key, true));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) visit(x, pathJoin(path, k), k, false);
    }
  };
  for (const [k, x] of Object.entries(section)) if (!SKIP_KEYS.has(k)) visit(x, pathJoin(at, k), k, false);
  return out;
}

const warn = (path, message) => ({ path, message });

function headWarnings(section, at) {
  const out = [];
  const n = (k) => (typeof section[k] === 'string' ? words(section[k]) : 0);
  if (n('title') > SOFT_CAPS.titleWords) {
    out.push(warn(pathJoin(at, 'title'), `title is ${n('title')} words; keep it to ${SOFT_CAPS.titleWords} — state the finding, move detail into the text`));
  }
  if (n('label') > SOFT_CAPS.labelWords) {
    out.push(warn(pathJoin(at, 'label'), `label is ${n('label')} words; keep it to ${SOFT_CAPS.labelWords} — name the topic, put the claim in the title`));
  }
  return out;
}

function stringWarnings(section, s) {
  const n = words(s.text);
  if (s.listItem) {
    return n > SOFT_CAPS.itemWords
      ? [warn(s.path, `list item is ${n} words; keep it under ${SOFT_CAPS.itemWords} → cut it, or move the detail into a text section`)]
      : [];
  }
  if (CARD_TYPES.has(section.type) && s.key === 'text') {
    return n > SOFT_CAPS.cardWords
      ? [warn(s.path, `card text is ${n} words; keep it under ${SOFT_CAPS.cardWords} → cut it, or split it across more cards or steps`)]
      : [];
  }
  const out = [];
  for (const p of paragraphs(s.text)) {
    const pw = words(p);
    if (pw > SOFT_CAPS.paragraphWords) {
      out.push(warn(s.path, `paragraph is ${pw} words; keep it under ${SOFT_CAPS.paragraphWords} → split it, or turn it into cards or steps`));
    } else if (sentences(p) > SOFT_CAPS.paragraphSentences) {
      out.push(warn(s.path, `paragraph is ${sentences(p)} sentences; keep it to ${SOFT_CAPS.paragraphSentences} → split it, or turn it into cards or steps`));
    }
  }
  return out;
}

function sectionWarnings(section, i) {
  const at = pathJoin('sections', i);
  const out = headWarnings(section, at);
  if (EXEMPT_TYPES.has(section.type)) return { out, wordCount: 0 };
  const strings = proseStrings(section, at);
  for (const s of strings) out.push(...stringWarnings(section, s));
  if (section.type === 'tldr' && Array.isArray(section.points) && section.points.length > SOFT_CAPS.tldrPoints) {
    out.push(warn(pathJoin(at, 'points'), `tldr has ${section.points.length} points; keep it to ${SOFT_CAPS.tldrPoints} → keep the strongest, move the rest into a section`));
  }
  const wordCount = strings.reduce((sum, s) => sum + words(s.text), 0);
  if (section.type === 'text' && wordCount > SOFT_CAPS.textSectionWords) {
    out.push(warn(at, `text section is ${wordCount} words; keep it under ${SOFT_CAPS.textSectionWords} words → split it into sections, or turn it into cards or steps`));
  }
  return { out, wordCount };
}

/** Soft-cap warnings for a parsed spec -> [{ path, message }]. Never an error. */
export function warnBudget(spec) {
  const out = [];
  let page = 0;
  (spec.sections ?? []).forEach((section, i) => {
    const r = sectionWarnings(section, i);
    out.push(...r.out);
    page += r.wordCount;
  });
  if (page > SOFT_CAPS.pageWords) {
    out.push(warn('', `page has ${page.toLocaleString('en-US')} words of prose; aim for ${SOFT_CAPS.pageWords} → cut, or convert sections to kpis, cards or steps`));
  }
  return out;
}
