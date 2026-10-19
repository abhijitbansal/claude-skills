// Soft text caps: warnings only, never errors. They push agents toward short,
// scannable pages. Prose = the strings a reader reads as sentences; code,
// tables, file lists and the like are exempt (see EXEMPT_TYPES).
import { pathJoin } from '../../shared/errors.mjs';
import { EMOJI, EMOJI_SEQUENCE } from './lint.mjs';
import { proseOnly } from './markdown.mjs';

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

// Counted prose: what a reader reads as sentences in these section types. It counts toward the page total.
const COUNTED_TYPES = new Set(['tldr', 'text', 'kpis', 'cards', 'risks', 'steps', 'compare', 'callout', 'details']);
const COUNTED_KEYS = new Set(['text', 'lead', 'body', 'note', 'points', 'items', 'risk', 'mitigation', 'verdict', 'summary']);
// Backstop prose: long-form fields of the other types, captions and alt text. A lenient per-paragraph warning
// (BACKSTOP_WORDS); never counted toward the page total. Tables, code, ids, paths and hrefs are never prose.
const BACKSTOP_KEYS = new Set(['text', 'intro', 'onFail', 'note', 'caption', 'alt']);
const ALWAYS_BACKSTOP = new Set(['caption', 'alt']);
const BACKSTOP_WORDS = 120;
const NO_TITLE_CAP = new Set(['diagram', 'chart', 'motion', 'scene']);
const SECTION_CAP_TYPES = new Set(['text', 'details', 'callout']);
const CARD_TYPES = new Set(['cards', 'steps']);
const LIST_KEYS = new Set(['points', 'items', 'risk', 'mitigation']);
const ABBREVIATION = /\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|St|vs|approx)\.|\b[A-Z]\.(?=\s+[A-Z][a-z])|\b(?:[A-Za-z]\.){2,}|\betc\.(?=\s+[a-z])/g;

// Emoji are allowed; these keep a page from turning into confetti. Warn when emoji exceed 1 in
// EMOJI_DENSITY_CHARS characters of a prose string (and the string has at least MIN_EMOJI_FOR_DENSITY, so a
// short line with one emoji stays quiet), or when one title holds more than MAX_TITLE_EMOJI.
export const EMOJI_DENSITY_CHARS = 40;
export const MAX_TITLE_EMOJI = 3;
export const MIN_EMOJI_FOR_DENSITY = 3;
const IS_EMOJI = new RegExp(EMOJI.source, 'u');
const KEYCAP_MARK = /\uFE0F?\u20E3/gu;
// One emoji = one glyph: a ZWJ family, a flag pair, a skin-toned hand and a keycap each count once.
// Text-presentation symbols (arrows, check marks, hearts) are not emoji and count 0.
const FLAG = /\p{Regional_Indicator}{2}/gu;
const countEmoji = (s) => {
  const flags = s.match(FLAG) ?? [];
  const rest = s.replace(FLAG, ' ');
  return flags.length + (rest.match(EMOJI_SEQUENCE) ?? []).filter((m) => IS_EMOJI.test(m)).length + (rest.match(KEYCAP_MARK) ?? []).length;
};

export const words = (s) => (s.match(/\S+/g) ?? []).length;

/** Sentences in a string: terminators (a closing quote or bracket may follow) before space or the end; at least 1. */
export function sentences(s) {
  const clean = s.replace(/\.{2,}/g, ' ').replace(ABBREVIATION, ' ');
  const n = (clean.match(/[.!?]+["'”’)\]]*(?=\s|$)/g) ?? []).length;
  return Math.max(1, n);
}

// A blank line separates paragraphs; "- " lines are each their own list item.
// Each block carries `name`: "paragraph 2 of 3" or "list item 1 of 2" (numbered apart; plain when only one).
function blocks(text) {
  const raw = text.split(/\n\s*\n/).flatMap((block) => {
    const lines = block.split('\n').filter((l) => l.trim() !== '');
    return lines.length > 0 && lines.every((l) => l.trimStart().startsWith('- '))
      ? lines.map((t) => ({ text: t.trimStart().slice(2), bullet: true }))
      : [{ text: block, bullet: false }];
  });
  const total = { true: raw.filter((b) => b.bullet).length, false: raw.filter((b) => !b.bullet).length };
  const seen = { true: 0, false: 0 };
  return raw.map((b) => {
    const noun = b.bullet ? 'list item' : 'paragraph';
    const n = ++seen[b.bullet];
    return { ...b, name: total[b.bullet] > 1 ? `${noun} ${n} of ${total[b.bullet]}` : noun };
  });
}

// Prose strings of a section: { path, text, key, kind, counted }. Array elements inherit their array's key.
function proseStrings(section, at) {
  const counted = COUNTED_TYPES.has(section.type);
  const out = [];
  const classify = (key) => {
    if (ALWAYS_BACKSTOP.has(key)) return false;
    if (counted && COUNTED_KEYS.has(key)) return true;
    return BACKSTOP_KEYS.has(key) ? false : null;
  };
  const visit = (v, path, key, inList) => {
    if (typeof v === 'string') {
      const isCounted = classify(key);
      if (isCounted === null) return;
      const isList = LIST_KEYS.has(key) && (inList || key === 'risk' || key === 'mitigation');
      const kind = isList ? 'item' : CARD_TYPES.has(section.type) && key === 'text' ? 'card' : 'paragraph';
      out.push({ path, text: v, kind, counted: isCounted });
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, pathJoin(path, i), key, true));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, pathJoin(path, k), k, false);
    }
  };
  visit(section, at, '', false);
  return out;
}

const warn = (path, message) => ({ path, message });

// Titles at any depth (section, card, step, compare column ...) and the section label.
function titleWarnings(section, at) {
  const out = [];
  const visit = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, pathJoin(path, i)));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && k === 'title' && words(x) > SOFT_CAPS.titleWords) {
          out.push(warn(pathJoin(path, k), `title is ${words(x)} words; keep it to ${SOFT_CAPS.titleWords} — state the finding, move detail into the text`));
        } else if (typeof x === 'object') visit(x, pathJoin(path, k));
      }
    }
  };
  // An embedded diagram, chart, motion or scene spec has its own title; only the section's own title is capped.
  if (NO_TITLE_CAP.has(section.type)) {
    if (typeof section.title === 'string' && words(section.title) > SOFT_CAPS.titleWords) {
      out.push(warn(pathJoin(at, 'title'), `title is ${words(section.title)} words; keep it to ${SOFT_CAPS.titleWords} — state the finding, move detail into the text`));
    }
  } else visit(section, at);
  if (typeof section.label === 'string' && words(section.label) > SOFT_CAPS.labelWords) {
    out.push(warn(pathJoin(at, 'label'), `label is ${words(section.label)} words; keep it to ${SOFT_CAPS.labelWords} — name the topic, put the claim in the title`));
  }
  return out;
}

const listItemWarning = (path, n, name = 'list item') => warn(path, `${name} is ${n} words; keep it to ${SOFT_CAPS.itemWords} → cut it, or move the detail into a text section`);

function backstopWarnings(s) {
  const parts = blocks(s.text);
  return parts.flatMap((p) => {
    const n = words(p.text);
    if (n <= BACKSTOP_WORDS) return [];
    return [warn(s.path, `${p.name} is ${n} words; keep it to ${BACKSTOP_WORDS} → split it, or cut it`)];
  });
}

function stringWarnings(s) {
  if (!s.counted) return backstopWarnings(s);
  const n = words(s.text);
  if (s.kind === 'item') return n > SOFT_CAPS.itemWords ? [listItemWarning(s.path, n)] : [];
  if (s.kind === 'card') {
    return n > SOFT_CAPS.cardWords
      ? [warn(s.path, `card text is ${n} words; keep it to ${SOFT_CAPS.cardWords} → cut it, or split it across more cards or steps`)]
      : [];
  }
  const parts = blocks(s.text);
  return parts.flatMap((p) => {
    const pw = words(p.text);
    const which = p.name;
    if (p.bullet) return pw > SOFT_CAPS.itemWords ? [listItemWarning(s.path, pw, which)] : [];
    if (pw > SOFT_CAPS.paragraphWords) return [warn(s.path, `${which} is ${pw} words; keep it to ${SOFT_CAPS.paragraphWords} → split it, or turn it into cards or steps`)];
    const sc = sentences(p.text);
    return sc > SOFT_CAPS.paragraphSentences
      ? [warn(s.path, `${which} is ${sc} sentences; keep it to ${SOFT_CAPS.paragraphSentences} → split it, or turn it into cards or steps`)]
      : [];
  });
}

function sectionWarnings(section, i) {
  const at = pathJoin('sections', i);
  const out = titleWarnings(section, at);
  const strings = proseStrings(section, at);
  for (const s of strings) out.push(...stringWarnings(s));
  if (section.type === 'tldr' && Array.isArray(section.points) && section.points.length > SOFT_CAPS.tldrPoints) {
    out.push(warn(pathJoin(at, 'points'), `tldr has ${section.points.length} points; keep it to ${SOFT_CAPS.tldrPoints} → keep the strongest, move the rest into a section`));
  }
  const wordCount = strings.filter((s) => s.counted).reduce((sum, s) => sum + words(s.text), 0);
  if (SECTION_CAP_TYPES.has(section.type) && wordCount > SOFT_CAPS.textSectionWords) {
    out.push(warn(at, `${section.type} section is ${wordCount} words; keep it to ${SOFT_CAPS.textSectionWords} → split it into sections, or turn it into cards or steps`));
  }
  return { out, wordCount };
}

// Titles at any depth, same reach as titleWarnings: [{ path, text }].
function titleStrings(section, at) {
  const out = [];
  const visit = (v, path) => {
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, pathJoin(path, i)));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (typeof x === 'string' && k === 'title') out.push({ path: pathJoin(path, k), text: x });
        else if (typeof x === 'object') visit(x, pathJoin(path, k));
      }
    }
  };
  if (NO_TITLE_CAP.has(section.type)) {
    if (typeof section.title === 'string') out.push({ path: pathJoin(at, 'title'), text: section.title });
  } else visit(section, at);
  return out;
}

/** Emoji-density warnings for a parsed spec -> [{ path, message }]. Never an error. Code spans and URLs are not counted. */
export function emojiDensityWarnings(spec) {
  const out = [];
  (spec.sections ?? []).forEach((section, i) => {
    const at = pathJoin('sections', i);
    for (const t of titleStrings(section, at)) {
      const n = countEmoji(t.text);
      if (n > MAX_TITLE_EMOJI) out.push(warn(t.path, `title has ${n} emoji; keep it to ${MAX_TITLE_EMOJI} → one is plenty, say the rest in words`));
    }
    for (const str of proseStrings(section, at)) {
      const text = proseOnly(str.text);
      const emoji = countEmoji(text);
      const chars = [...text].length;
      if (emoji >= MIN_EMOJI_FOR_DENSITY && emoji * EMOJI_DENSITY_CHARS > chars) {
        out.push(warn(str.path, `${emoji} emoji in ${chars} characters of prose; keep it under 1 per ${EMOJI_DENSITY_CHARS} → cut some, say it in words`));
      }
    }
  });
  return out;
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
  out.push(...emojiDensityWarnings(spec));
  return out;
}
