// Slides mode: each section is one slide, so each gets a content budget.
// Points: tldr points, "- " list lines in markdown fields, items of list-like
// sections, compare points, checklist items. Words: every prose string of the
// section except its own title and captions (tables and code have their own
// limits).
// The deck: a title slide from the spec head, then one slide per section, plus
// the progress bar, counter, outline dialog and the live region the runtime uses.
import { pathJoin } from '../../shared/errors.mjs';
import { SLIDE_LIMITS } from './schema.mjs';
import { collectStrings } from './walk.mjs';
import { esc, inline, plain } from './render/ui.mjs';

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

/** True when the spec renders as a deck. */
export const isSlides = (spec) => spec.mode === 'slides' || spec.preset === 'slides';

// A section without a title is named after its type ("Text", "Table") in labels and the outline.
const typeLabel = (type) => `${type[0].toUpperCase()}${type.slice(1)}`;
export const slideTitle = (section) => (section.title === undefined ? typeLabel(section.type) : plain(section.title));

function slide(n, total, title, classes, inner) {
  return `<section class="slide ${classes}" id="slide-${n}" aria-label="Slide ${n} of ${total}: ${title}">
<div class="slide-inner">
${inner}
</div>
</section>`;
}

function cover(spec, total, metaHtml) {
  const subtitle = spec.subtitle === undefined ? '' : `\n<p class="subtitle">${inline(spec.subtitle)}</p>`;
  return slide(1, total, plain(spec.title), 'slide-cover', `<h1>${inline(spec.title)}</h1>${subtitle}${metaHtml ? `\n${metaHtml}` : ''}`);
}

function sectionSlide({ section, body, ownHeading }, n, total) {
  const heading = section.title !== undefined && !ownHeading ? `<h2 class="slide-title" id="slide-${n}-title">${inline(section.title)}</h2>\n` : '';
  return slide(n, total, slideTitle(section), `slide-${section.type}`, `${heading}${body}`);
}

function outline(titles) {
  const items = titles.map((t, i) => `<li><a href="#slide-${i + 1}" data-slide="${i + 1}">${t}</a></li>`);
  return `<dialog class="outline" data-outline aria-labelledby="outline-title">
<div class="outline-head"><h2 id="outline-title">Outline</h2><button type="button" class="btn" data-outline-close>Close</button></div>
<ol class="outline-list">
${items.join('\n')}
</ol>
</dialog>`;
}

function chrome(total) {
  return `<div class="deck-bar">
<div class="deck-progress" role="progressbar" aria-label="Slide progress" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="1" aria-valuetext="Slide 1 of ${total}"><span data-progress></span></div>
<div class="deck-controls">
<button type="button" class="btn" data-outline-open aria-haspopup="dialog" aria-keyshortcuts="O">Outline <span class="key" aria-hidden="true">O</span></button>
<button type="button" class="theme-toggle" data-theme-toggle aria-label="Theme: Auto. Change theme">Theme: Auto</button>
<span class="deck-count" aria-hidden="true"><span data-count>1</span> / ${total}</span>
</div>
</div>`;
}

/**
 * The deck markup for the template's DECK marker.
 * `rendered` = [{ section, body, ownHeading }] in order (bodies already rendered),
 * `metaHtml` = the title slide's meta list ('' when none), `slug` keys the saved position.
 */
export function renderDeck({ spec, rendered, metaHtml, slug }) {
  const total = rendered.length + 1;
  const slides = [cover(spec, total, metaHtml), ...rendered.map((r, i) => sectionSlide(r, i + 2, total))];
  const titles = [plain(spec.title), ...rendered.map((r) => slideTitle(r.section))];
  return `<main id="content" class="deck" data-deck data-slug="${esc(slug)}" data-total="${total}" data-current="1">
${slides.join('\n')}
</main>
${chrome(total)}
${outline(titles)}
<div class="sr-only" role="status" data-live></div>`;
}
