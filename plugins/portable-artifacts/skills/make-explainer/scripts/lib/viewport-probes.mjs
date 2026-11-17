// Two probes for check.mjs that look at regions which scroll on their own. The page-level overflow probe exempts a
// scrolling region on purpose (a table wrapper and a diagram slot scroll by design), so a region that scrolls with
// nothing telling the reader needs its own rule: a visible cue, or a warning.
// The probe functions run in the page (no closures: they are serialised); the message builders are pure and
// tested without a browser.

export const PHONE_MAX_WIDTH = 640;

/**
 * Runs in the page. Deck slides whose table region needs vertical scrolling: [{ slide, scroll, shown }] (px).
 * A slide's table is wrapped in .tablewrap (overflow: auto), so rows past the visible height scroll inside it and
 * nothing marks that: the last row looks cut off.
 */
export const tableScrollProbe = () => {
  const found = [];
  [...document.querySelectorAll('[data-deck] .slide')].forEach((slide, i) => {
    for (const wrap of slide.querySelectorAll('.tablewrap')) {
      const overflowY = getComputedStyle(wrap).overflowY;
      if (!['auto', 'scroll'].includes(overflowY)) continue;
      if (wrap.scrollHeight > wrap.clientHeight + 1) found.push({ slide: i + 1, scroll: wrap.scrollHeight, shown: wrap.clientHeight });
    }
  });
  return found;
};

/**
 * Runs in the page. Inline diagrams whose slot scrolls sideways without the cue line showing: [{ n, scroll, shown }].
 * diagram.js shows [data-dg-cue] while the slot scrolls; a figure that scrolls with the cue hidden or missing has
 * lost it (script blocked, markup changed).
 */
export const diagramCueProbe = () => {
  const found = [];
  [...document.querySelectorAll('[data-diagram]')].forEach((figure, i) => {
    const slot = figure.querySelector('[data-dg-slot]');
    if (!slot || slot.scrollWidth <= slot.clientWidth + 1) return;
    const cue = figure.querySelector('[data-dg-cue]');
    if (!cue || cue.hidden || cue.getClientRects().length === 0) found.push({ n: i + 1, scroll: slot.scrollWidth, shown: slot.clientWidth });
  });
  return found;
};

/** The warning for one slide's table that scrolls vertically at phone width. */
export const tableScrollMessage = ({ slide, scroll, shown }, label) =>
  `${label}: slide ${slide}: its table needs ${scroll - shown} px of vertical scrolling inside a frame that shows ${shown} px, with nothing marking that, so the last rows look cut off; use fewer rows or split the table across slides`;

/** The problem for one diagram that scrolls sideways with no cue showing. */
export const diagramCueMessage = ({ n, scroll, shown }, label) =>
  `${label}: diagram ${n} scrolls sideways (${scroll}px of drawing in a ${shown}px frame) but shows no cue; its "Scrolls sideways" line is hidden or missing`;
