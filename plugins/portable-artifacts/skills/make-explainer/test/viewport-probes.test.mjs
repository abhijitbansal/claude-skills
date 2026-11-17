// G-07 and G-08: the two region probes the page check runs. They run in a page, so here they get a stubbed
// `document` and `getComputedStyle`; the real measurement is a browser test listed for the serial browser run.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tableScrollProbe, diagramCueProbe, tableScrollMessage, diagramCueMessage, PHONE_MAX_WIDTH } from '../scripts/lib/viewport-probes.mjs';

const saved = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
afterEach(() => { globalThis.document = saved.document; globalThis.getComputedStyle = saved.getComputedStyle; });

const wrap = (scrollHeight, clientHeight, overflowY = 'auto') => ({ scrollHeight, clientHeight, overflowY });
const slide = (...wraps) => ({ querySelectorAll: (sel) => (sel === '.tablewrap' ? wraps : []) });
function stubDeck(slides) {
  globalThis.document = { querySelectorAll: (sel) => (sel === '[data-deck] .slide' ? slides : []) };
  globalThis.getComputedStyle = (el) => ({ overflowY: el.overflowY });
}

test('a table region 15 px taller than its frame is reported with its slide number and sizes (the dogfood case: 525 in 510)', () => {
  stubDeck([slide(), slide(wrap(525, 510)), slide(wrap(300, 300))]);
  assert.deepEqual(tableScrollProbe(), [{ slide: 2, scroll: 525, shown: 510 }]);
});

test('a table that fits, a 1 px rounding difference and a region that does not scroll are not reported', () => {
  stubDeck([slide(wrap(400, 400), wrap(401, 400), wrap(900, 300, 'visible'), wrap(900, 300, 'hidden'))]);
  assert.deepEqual(tableScrollProbe(), []);
});

test('every scrolling table on every slide is listed, in slide order', () => {
  stubDeck([slide(wrap(700, 500)), slide(wrap(800, 500), wrap(900, 500, 'scroll'))]);
  assert.deepEqual(tableScrollProbe().map((f) => f.slide), [1, 2, 2]);
});

test('the table message names the slide, the hidden height and what to do', () => {
  assert.equal(
    tableScrollMessage({ slide: 6, scroll: 525, shown: 510 }, '390px'),
    '390px: slide 6: its table needs 15 px of vertical scrolling inside a frame that shows 510 px, with nothing marking that, so the last rows look cut off; use fewer rows or split the table across slides',
  );
  assert.equal(PHONE_MAX_WIDTH, 640);
});

const figure = (slot, cue) => ({ querySelector: (sel) => (sel === '[data-dg-slot]' ? slot : sel === '[data-dg-cue]' ? cue : null) });
const cue = (shown) => ({ hidden: !shown, getClientRects: () => (shown ? [{}] : []) });
const stubFigures = (figures) => { globalThis.document = { querySelectorAll: (sel) => (sel === '[data-diagram]' ? figures : []) }; };

test('a diagram that scrolls sideways with its cue showing is fine; with the cue hidden or missing it is reported', () => {
  stubFigures([
    figure({ scrollWidth: 927, clientWidth: 356 }, cue(true)),
    figure({ scrollWidth: 927, clientWidth: 356 }, cue(false)),
    figure({ scrollWidth: 927, clientWidth: 356 }, null),
  ]);
  assert.deepEqual(diagramCueProbe(), [{ n: 2, scroll: 927, shown: 356 }, { n: 3, scroll: 927, shown: 356 }]);
});

test('a diagram that fits its slot needs no cue, whatever the cue does', () => {
  stubFigures([figure({ scrollWidth: 356, clientWidth: 356 }, cue(false)), figure({ scrollWidth: 357, clientWidth: 356 }, null), figure(null, null)]);
  assert.deepEqual(diagramCueProbe(), []);
});

test('the diagram message names the figure and both widths', () => {
  assert.equal(
    diagramCueMessage({ n: 2, scroll: 927, shown: 356 }, '390px'),
    '390px: diagram 2 scrolls sideways (927px of drawing in a 356px frame) but shows no cue; its "Scrolls sideways" line is hidden or missing',
  );
});
