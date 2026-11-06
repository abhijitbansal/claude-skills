// "Simple English": an eligible section may carry `simple`, a second version of its prose that the page's
// toggle shows in place of the normal text. The agent writes both; this file checks the second one.
// Rules are our own, based on ideas from ASD-STE100 (references/simple-english.md); this is not a compliant
// document and it does not check the standard's approved dictionary.
//
// Errors (simpleErrors): `simple` on a section type that cannot have it, or a simple list longer than the normal one.
// Warnings (simpleWarnings, never blocking): the writing rules below, and a page with some simple text that
// leaves an eligible section without any. Banned phrases and placeholders in simple text are already errors:
// spec.mjs lints every string of the spec, `simple` included, with lintBanned.
import { pathJoin } from '../../shared/errors.mjs';
import { SIMPLE_SECTIONS } from './schema.mjs';
import { proseOnly } from './markdown.mjs';
import { ABBREVIATION, blocks } from './budget.mjs';

export { SIMPLE_SECTIONS };

const q = (v) => JSON.stringify(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isEligible = (section) => SIMPLE_SECTIONS.includes(section?.type);

// ---- merging ------------------------------------------------------------

// `over` laid on `base`: an object field by field, a list by position, anything else replaced. A part `over`
// leaves out keeps `base`'s. An `over` list entry past the end of `base`'s list has nothing to match (simpleErrors
// reports it) and is dropped. Always builds new values.
function overlay(base, over) {
  if (over === undefined) return structuredClone(base);
  if (Array.isArray(base) && Array.isArray(over)) return base.map((b, i) => overlay(b, over[i]));
  if (isObject(base) && isObject(over)) {
    const merged = Object.fromEntries(Object.entries(base).map(([key, value]) => [key, overlay(value, over[key])]));
    for (const [key, value] of Object.entries(over)) if (!Object.hasOwn(base, key)) merged[key] = structuredClone(value);
    return merged;
  }
  return structuredClone(over);
}

/** The section as the simple view shows it: `simple`'s fields over the section's, without the `simple` key. A pure copy. */
export function withSimple(section) {
  const { simple, ...normal } = section;
  return simple === undefined ? structuredClone(normal) : overlay(normal, simple);
}

const hasText = (value) => {
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.some(hasText);
  return isObject(value) && Object.values(value).some(hasText);
};

const hasSimpleText = (section) => isEligible(section) && hasText(section.simple);

/** True when any section of the spec carries simple text (the page shows its toggle then). */
export const hasSimple = (spec) => (spec?.sections ?? []).some(hasSimpleText);

// ---- errors -------------------------------------------------------------

function listOverflow(normal, simple, at, out) {
  if (Array.isArray(simple)) {
    const have = Array.isArray(normal) ? normal : [];
    if (simple.length > have.length) {
      out.push({ path: at, message: `simple has ${simple.length} entries but the normal list has ${have.length}; lists match by position, so cut the extra entries` });
    }
    simple.slice(0, have.length).forEach((entry, i) => listOverflow(have[i], entry, pathJoin(at, i), out));
  } else if (isObject(simple)) {
    for (const [key, value] of Object.entries(simple)) listOverflow(normal?.[key], value, pathJoin(at, key), out);
  }
}

/** Errors for a parsed spec whose shapes already passed the schema -> [{ path, message }]. */
export function simpleErrors(spec) {
  const out = [];
  spec.sections.forEach((section, i) => {
    if (section.simple === undefined) return;
    const at = pathJoin(pathJoin('sections', i), 'simple');
    if (!isEligible(section)) {
      out.push({ path: at, message: `simple is not available on a ${section.type} section; it works on ${SIMPLE_SECTIONS.map(q).join(', ')} — remove it` });
      return;
    }
    listOverflow(section, section.simple, at, out);
  });
  return out;
}

// ---- lint ---------------------------------------------------------------

const MAX_STEP_SENTENCE_WORDS = 20;
const MAX_SENTENCE_WORDS = 25;
const MAX_PARAGRAPH_SENTENCES = 6;
// A step's title is the part that must be an action: it is `items[n].title` of a steps section.
const STEP_TITLE = /\.items\[\d+\]\.title$/;

// Openers a step must not have: a step starts with a verb. Only these common non-verbs are refused.
const NON_VERB_OPENERS = new Set(['the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'there', 'we', 'you', 'they', 'he', 'she', 'i', 'and', 'but', 'or', 'so']);

// Short word swaps, in our own words: [what to find, what to write instead].
const SWAPS = [
  [/\bin order to\b/i, 'in order to', 'to'],
  [/\butili[sz](?:e|es|ed|ing)\b/i, 'utilize', 'use'],
  [/\bprior to\b/i, 'prior to', 'before'],
  [/\bsubsequent to\b/i, 'subsequent to', 'after'],
  [/\bin the event that\b/i, 'in the event that', 'if'],
  [/\bdue to the fact that\b/i, 'due to the fact that', 'because'],
  [/\bapproximately\b/i, 'approximately', 'about'],
  [/\bnumerous\b/i, 'numerous', 'many'],
  [/\bsufficient\b/i, 'sufficient', 'enough'],
  [/\bcommence[sd]?\b/i, 'commence', 'start'],
];

// "was deployed", "are not shown", "is quickly built": a form of "be" and a past participle. Likely, not certain,
// so the few common words that end in "ed" without being a participle are skipped.
const IRREGULAR_PARTICIPLES = 'made|done|given|shown|seen|taken|written|built|sent|kept|held|found|known|chosen|broken|begun|driven|lost|left|put|set';
const NOT_PARTICIPLES = 'indeed|speed|need|hundred|exceed|proceed|succeed';
const PASSIVE = new RegExp(
  `\\b(?:is|are|was|were|be|been|being)(?:\\s+not)?\\s+(?:\\w+ly\\s+)?(?:(?!(?:${NOT_PARTICIPLES})\\b)\\w{3,}ed|${IRREGULAR_PARTICIPLES})\\b`,
  'i',
);

const CODE_MARK = '';
const SENTENCE = /\S.*?(?:[.!?]+["'”’)\]]*(?=\s|$)|$)/gs;
const WORD = new RegExp(`[\\p{L}\\p{N}${CODE_MARK}]`, 'u');

// The words a reader reads: code spans become one mark each (their insides are not prose and no rule looks in
// them), and a link keeps its label only.
const readable = (text) => proseOnly(text).replace(/`\s+`/g, CODE_MARK).replace(/\]\(\s+\)/g, ']');

const wordCount = (s) => (s.match(/\S+/g) ?? []).filter((token) => WORD.test(token)).length;

function sentencesOf(paragraph) {
  const flat = paragraph.replace(/\.{2,}/g, ' ').replace(ABBREVIATION, (m) => m.replaceAll('.', ''));
  return flat.match(SENTENCE) ?? [];
}

function sentenceWarnings(sentence, at, maxWords) {
  const out = [];
  const n = wordCount(sentence);
  if (n > maxWords) out.push({ path: at, message: `sentence is ${n} words; keep it to ${maxWords} — split it into shorter sentences` });
  const passive = PASSIVE.exec(sentence);
  if (passive) out.push({ path: at, message: `likely passive voice (${q(passive[0])}); say who or what does the action` });
  return out;
}

// Rules for one string of simple text.
function stringWarnings(text, at, maxWords) {
  const prose = readable(text);
  const out = [];
  for (const block of blocks(prose)) {
    const sentences = sentencesOf(block.text);
    if (!block.bullet && sentences.length > MAX_PARAGRAPH_SENTENCES) {
      out.push({ path: at, message: `${block.name} is ${sentences.length} sentences; keep it to ${MAX_PARAGRAPH_SENTENCES} — split it` });
    }
    for (const sentence of sentences) out.push(...sentenceWarnings(sentence, at, maxWords));
  }
  if (prose.includes(';')) out.push({ path: at, message: 'semicolon; write two sentences instead' });
  for (const [regexp, phrase, use] of SWAPS) {
    if (regexp.test(prose)) out.push({ path: at, message: `${q(phrase)} is wordy; use ${q(use)}` });
  }
  return out;
}

function openerWarning(text, at) {
  const first = /^[\s*_"'(\[]*([\p{L}]+)/u.exec(readable(text))?.[1];
  if (first === undefined || !NON_VERB_OPENERS.has(first.toLowerCase())) return [];
  return [{ path: at, message: `a step starts with a verb; this one starts with ${q(first)} — start with a word such as "Run", "Open" or "Check"` }];
}

// Every string of a `simple` object: [{ path, text }].
function simpleStrings(value, at) {
  if (typeof value === 'string') return [{ path: at, text: value }];
  if (Array.isArray(value)) return value.flatMap((v, i) => simpleStrings(v, pathJoin(at, i)));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([k, v]) => simpleStrings(v, pathJoin(at, k)));
}

/**
 * Writing-rule warnings for one section's `simple` text -> [{ path, message }]; [] when it has none.
 * `path` is the section's own path ("sections[3]").
 */
export function lintSimple(section, path) {
  if (!isObject(section?.simple)) return [];
  const isSteps = section.type === 'steps';
  const maxWords = isSteps ? MAX_STEP_SENTENCE_WORDS : MAX_SENTENCE_WORDS;
  return simpleStrings(section.simple, pathJoin(path, 'simple')).flatMap(({ path: at, text }) => [
    ...stringWarnings(text, at, maxWords),
    ...(isSteps && STEP_TITLE.test(at) ? openerWarning(text, at) : []),
  ]);
}

/** All simple-text warnings for a parsed spec -> [{ path, message }]. Never blocks a build. */
export function simpleWarnings(spec) {
  const out = [];
  const pageHasSimple = hasSimple(spec);
  spec.sections.forEach((section, i) => {
    const at = pathJoin('sections', i);
    out.push(...lintSimple(section, at));
    if (pageHasSimple && isEligible(section) && !hasSimpleText(section)) {
      out.push({ path: at, message: `this page has simple text elsewhere; add a "simple" version to this ${section.type} section too` });
    }
  });
  return out;
}
