// Slides mode: each section is one slide, so each gets a content budget.
// Points: tldr points, "- " list lines in markdown fields, items of list-like
// sections, compare points, checklist items, decision options and review items.
// Words: every prose string of the section except its own title, its label and
// captions (tables and code have their own limits).
// The deck: a title slide from the spec head, then one slide per section, plus
// the progress bar, counter, outline dialog and the live region the runtime uses.
import { pathJoin } from '../../shared/errors.mjs';
import { SLIDE_LIMITS } from './schema.mjs';
import { collectStrings } from './walk.mjs';
import { words } from './budget.mjs';
import { toggleIcons } from '../../shared/theme-toggle.mjs';
import { esc, inline, plain } from './render/ui.mjs';
import { withSimple, hasSimpleText } from './simple.mjs';
import { dualText, titleHtml, simpleToggle } from './simple-view.mjs';

const listLines = (text) => (text ?? '').split('\n').filter((l) => l.trimStart().startsWith('- ')).length;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export function codeLines(code) {
  return code.replace(/\n+$/, '').split('\n').length;
}

export function pointCount(s) {
  switch (s.type) {
    case 'tldr': return s.points?.length ?? 0;
    case 'text': case 'details': return listLines(s.text);
    case 'kpis': case 'cards': case 'steps': case 'timeline': case 'risks': case 'files': return s.items.length;
    case 'compare': return sum(s.columns.map((c) => c.points.length));
    case 'checklist': return sum(s.groups.map((g) => g.items.length));
    case 'decision': return s.options.length;
    case 'review': return s.items.length;
    default: return 0;
  }
}

function wordCount(s, path) {
  if (s.type === 'table') return 0;
  const simple = pathJoin(path, 'simple');
  // A slide shows one version of its text, so `simple` text is not counted on top of the normal text.
  return sum(collectStrings(s, path)
    .filter((x) => x.prose && x.path !== pathJoin(path, 'title') && x.path !== pathJoin(path, 'label') && x.key !== 'caption')
    .filter((x) => !x.path.startsWith(`${simple}.`))
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

/**
 * Warnings for a deck's simple text: a slide shows one version of its text, so `simple` is exempt from the word
 * error above, but a simple view that overruns the budget overruns the slide just the same.
 */
export function slideSimpleWarnings(spec) {
  const out = [];
  spec.sections.forEach((s, i) => {
    if (!hasSimpleText(s)) return;
    const at = pathJoin('sections', i);
    const w = wordCount(withSimple(s), at);
    if (w > SLIDE_LIMITS.words) {
      out.push({ path: pathJoin(at, 'simple'), message: `the simple view of this slide has ${w} words; the slide limit is ${SLIDE_LIMITS.words} — cut the simple text or split the slide` });
    }
  });
  return out;
}

/** True when the spec renders as a deck. */
export const isSlides = (spec) => spec.mode === 'slides' || spec.preset === 'slides';

// A section without a title is named after its type in labels and the outline.
const TYPE_LABELS = {
  tldr: 'TL;DR', text: 'Text', kpis: 'KPIs', cards: 'Cards', table: 'Table', risks: 'Risks', files: 'Files', steps: 'Steps',
  timeline: 'Timeline', compare: 'Comparison', callout: 'Note', code: 'Code', details: 'Details', checklist: 'Checklist',
  diagram: 'Diagram', scene: 'Scene', chart: 'Chart', motion: 'Video', image: 'Image',
  decision: 'Decision', approval: 'Approval', question: 'Open question', verdict: 'Verdict', review: 'Review these first',
};
const typeLabel = (type) => TYPE_LABELS[type] ?? `${type[0].toUpperCase()}${type.slice(1)}`;
export const slideTitle = (section) => (section.title === undefined ? typeLabel(section.type) : plain(section.title));

// A section's own id is a deep link (#<id>), kept in data-sid: the element id stays slide-N.
// `art` is a decorative full-bleed drawing (flavored decks, first and last slide only), '' for none.
// `simpleTitle` is the slide's title in the simple view when it differs: it becomes data-simple-label, the slide's
// name while the toggle is on.
function slide(n, total, title, classes, inner, sid, footer = '', art = '', simpleTitle = undefined) {
  const link = sid === undefined ? '' : ` data-sid="${esc(sid)}"`;
  const simpleName = simpleTitle === undefined ? '' : ` data-simple-label="Slide ${n} of ${total}: ${simpleTitle}"`;
  const cls = art ? `${classes} slide-has-art` : classes;
  const layer = art ? `\n<div class="slide-art" aria-hidden="true">${art}</div>` : '';
  return `<section class="slide ${cls}" id="slide-${n}"${link}${simpleName} tabindex="-1" aria-label="Slide ${n} of ${total}: ${title}">${layer}
<div class="slide-inner">
${inner}
</div>${footer}
</section>`;
}

function cover(spec, total, metaHtml, art) {
  const subtitle = spec.subtitle === undefined ? '' : `\n<p class="subtitle">${inline(spec.subtitle)}</p>`;
  return slide(1, total, plain(spec.title), 'slide-cover', `<h1>${inline(spec.title)}</h1>${subtitle}${metaHtml ? `\n${metaHtml}` : ''}`, undefined, '', art);
}

// `simple` = { view, body } is the section as the simple view shows it (withSimple) and its rendered body; present
// only for a section with simple text.
function sectionSlide({ section, body, simple, ownHeading }, n, total, footer = '', art = '') {
  const view = simple === undefined ? null : simple.view;
  const hasHeading = section.title !== undefined && !ownHeading;
  const eyebrow = hasHeading && section.label !== undefined ? `<p class="slide-eyebrow pa-label">${plain(section.label)}</p>\n` : '';
  const heading = hasHeading ? `${eyebrow}<h2 class="slide-title" id="slide-${n}-title">${titleHtml(section, view)}</h2>\n` : '';
  const text = view === null ? body : dualText(body, simple.body);
  const simpleTitle = hasHeading && view !== null && view.title !== undefined && view.title !== section.title ? slideTitle(view) : undefined;
  return slide(n, total, slideTitle(section), `slide-${section.type}`, `${heading}${text}`, section.id, footer, art, simpleTitle);
}

function outline(titles, sids) {
  const items = titles.map((t, i) => `<li><a href="#${esc(sids[i] ?? `slide-${i + 1}`)}" data-slide="${i + 1}">${t}</a></li>`);
  return `<dialog class="outline" data-outline aria-labelledby="outline-title">
<div class="outline-head"><h2 id="outline-title">Outline</h2><button type="button" class="btn" data-outline-close>Close</button></div>
<ol class="outline-list">
${items.join('\n')}
</ol>
</dialog>`;
}

function chrome(total, withToggle) {
  return `<div class="deck-bar">
<div class="deck-progress" role="progressbar" aria-label="Slide progress" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="1" aria-valuetext="Slide 1 of ${total}"><span data-progress></span></div>
<div class="deck-controls">
<button type="button" class="btn" data-outline-open aria-haspopup="dialog" aria-keyshortcuts="O">Outline <span class="key" aria-hidden="true">O</span></button>
<button type="button" class="theme-toggle" data-theme-toggle data-mode="auto" aria-label="Theme: Auto. Switch to Light" title="Theme: Auto. Switch to Light">${toggleIcons()}</button>${withToggle ? `\n${simpleToggle()}` : ''}
<span class="deck-count" aria-hidden="true"><span data-count>1</span> / ${total}</span>
</div>
<div class="sr-only" role="status" data-live></div>
</div>`;
}

/**
 * The deck markup for the template's DECK marker.
 * `rendered` = [{ section, body, ownHeading, simple? }] in order (bodies already rendered; `simple` = { view, body } for a section with simple text),
 * `metaHtml` = the title slide's meta list ('' when none), `slug` keys the saved position.
 * `artFor(n)` = the decorative drawing for slide n (only asked for the first and the last slide); omit it for no art.
 */
export function renderDeck({ spec, rendered, metaHtml, slug, footerHtml = '', artFor = () => '' }) {
  const total = rendered.length + 1;
  const last = (i) => i === rendered.length - 1;
  const slides = [
    cover(spec, total, metaHtml, artFor(1)),
    ...rendered.map((r, i) => sectionSlide(r, i + 2, total, last(i) ? `\n${footerHtml}` : '', last(i) ? artFor(total) : '')),
  ];
  const titles = [plain(spec.title), ...rendered.map((r) => slideTitle(r.section))];
  const sids = [undefined, ...rendered.map((r) => r.section.id)];
  return `<main id="content" class="deck" data-deck data-slug="${esc(slug)}" data-total="${total}" data-current="1">
${slides.join('\n')}
</main>
${chrome(total, rendered.some((r) => r.simple !== undefined))}
${outline(titles, sids)}`;
}
