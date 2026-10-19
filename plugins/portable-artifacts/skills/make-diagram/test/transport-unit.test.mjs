// PADiagram.transport (template/transport.js) in Node: a bare `window` with a
// fake document, so what the painter does to the chip row and to focus can be
// asserted without a browser. camera.js comes along for PADiagram.dict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = ['camera.js', 'transport.js'].map((f) => fs.readFileSync(new URL(`../template/${f}`, import.meta.url), 'utf8')).join('\n');

// An element that records its children, attributes, listeners and scrolling.
function fakeEl(doc, tag) {
  const e = {
    tag, children: [], attrs: {}, listeners: {}, textContent: '', hidden: false, disabled: false,
    scrollLeft: 0, scrollIntoViewCalls: 0, rect: { left: 0, width: 0 }, clientWidth: 0,
    innerHTML: '', style: {},
  };
  const classes = new Set();
  e.classList = { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) };
  e.appendChild = (c) => { e.children.push(c); return c; };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.removeAttribute = (k) => { delete e.attrs[k]; };
  e.getAttribute = (k) => e.attrs[k] ?? null;
  e.addEventListener = (n, fn) => { e.listeners[n] = fn; };
  e.scrollIntoView = () => { e.scrollIntoViewCalls += 1; };
  e.getBoundingClientRect = () => ({ left: e.rect.left, width: e.rect.width, right: e.rect.left + e.rect.width });
  e.focus = () => { doc.activeElement = e; };
  e.querySelector = () => null;
  return e;
}

const beat = (title) => ({ kind: 'hop', chapter: 0, title, edge: 'edge-0', reverse: false, ids: ['a', 'b'], reveal: [], highlight: [] });
const DATA = { beats: ['One', 'Two', 'Three', 'Four', 'Five'].map(beat), chapters: [{ id: 's', title: 'S', start: 0, end: 5 }] };

// Loads camera.js and transport.js on a bare window and mounts a transport over a
// caption holder whose data-pa-* parts are fake elements. `at` is the current beat.
function load({ playing = () => false } = {}) {
  const doc = { activeElement: null };
  doc.createElement = (tag) => fakeEl(doc, tag);
  const win = { document: doc };
  new Function('window', src)(win);
  const parts = {};
  for (const name of ['data-pa-beats', 'data-pa-prev', 'data-pa-next', 'data-pa-play', 'data-pa-scrub', 'data-pa-count', 'data-pa-line']) parts[name] = fakeEl(doc, 'div');
  // The play button as the page ships it: an icon span inside, and a textContent that records writes.
  const playIcon = fakeEl(doc, 'span');
  parts['data-pa-play'].querySelector = (sel) => (sel === '.pa-playicon' ? playIcon : null);
  parts['data-pa-play'].textWrites = 0;
  Object.defineProperty(parts['data-pa-play'], 'textContent', { get: () => '', set: () => { parts['data-pa-play'].textWrites += 1; } });
  const row = parts['data-pa-beats'];
  row.rect = { left: 0, width: 200 }; // a row 200 px wide showing about two chips
  row.clientWidth = 200;
  const caption = fakeEl(doc, 'aside');
  caption.querySelector = (sel) => parts[sel.slice(1, -1)] ?? null;
  const state = { at: 0 };
  const noop = () => {};
  const story = {
    isPresenting: () => true, index: () => state.at, count: () => DATA.beats.length, current: () => DATA.beats[state.at], chapter: () => 0,
    isPlaying: () => playing(), speed: () => 1, loop: () => false,
    goTo: noop, prev: noop, next: noop, exit: noop, prevChapter: noop, nextChapter: noop, togglePlay: noop, cycleSpeed: noop, toggleLoop: noop, pause: noop,
  };
  // The row clamps scrollLeft at 0 as a browser does, and a chip's rect moves with the row's scroll:
  // chips are 100 px wide, 120 px apart.
  let scrolled = 0;
  Object.defineProperty(row, 'scrollLeft', { get: () => scrolled, set: (v) => { scrolled = Math.max(0, v); } });
  const transport = win.PADiagram.transport({ caption, chapters: null }, DATA, story);
  row.children.forEach((chip, i) => { chip.getBoundingClientRect = () => ({ left: 120 * i - scrolled, width: 100, right: 120 * i - scrolled + 100 }); });
  return { transport, parts, row, doc, state, playIcon };
}

test('the active chip is brought into its row by scrolling the row, never with scrollIntoView', () => {
  const { transport, row, state } = load();
  state.at = 3;
  transport.paint();
  assert.ok(row.children.every((c) => c.scrollIntoViewCalls === 0), 'scrollIntoView would scroll the document too');
  // chip 3 spans 360..460, centre 410; the row's centre is 100: the row scrolls by 310
  assert.equal(row.scrollLeft, 310);
  state.at = 0;
  transport.paint();
  assert.equal(row.scrollLeft, 0, 'back to chip 0 (centre now at -260): 310 - 360 clamps at zero');
});

test('disabling the focused Next (or Prev) moves focus to Play first, so the keys keep reaching the viewer', () => {
  const { transport, parts, doc, state } = load();
  parts['data-pa-next'].focus();
  state.at = DATA.beats.length - 1;
  transport.paint();
  assert.equal(parts['data-pa-next'].disabled, true);
  assert.equal(doc.activeElement, parts['data-pa-play'], 'focus moved to Play before Next was disabled');
  parts['data-pa-prev'].focus();
  state.at = 0;
  transport.paint();
  assert.equal(parts['data-pa-prev'].disabled, true);
  assert.equal(doc.activeElement, parts['data-pa-play']);
  parts['data-pa-next'].focus();
  state.at = 2;
  transport.paint();
  assert.equal(doc.activeElement, parts['data-pa-next'], 'an enabled button keeps its focus');
});

test('the play button shows the paused icon and aria-label Play, then the pause icon and Pause when playing', () => {
  let on = false;
  const { transport, parts, playIcon } = load({ playing: () => on });
  transport.paint();
  assert.equal(parts['data-pa-play'].getAttribute('aria-label'), 'Play');
  assert.match(playIcon.innerHTML, /^<svg [^>]*fill="currentColor"[^>]*><path d="M[^"]*"\/><\/svg>$/, 'a triangle: one path');
  const paused = playIcon.innerHTML;
  on = true;
  transport.paint();
  assert.equal(parts['data-pa-play'].getAttribute('aria-label'), 'Pause');
  assert.match(playIcon.innerHTML, /^<svg [^>]*fill="currentColor"[^>]*>(<rect [^>]*\/>){2}<\/svg>$/, 'two bars');
  assert.notEqual(playIcon.innerHTML, paused);
  on = false;
  transport.paint();
  assert.equal(playIcon.innerHTML, paused, 'back to the paused icon');
  assert.equal(parts['data-pa-play'].getAttribute('aria-label'), 'Play');
});

test('paint() never writes textContent on the play button', () => {
  let on = false;
  const { transport, parts } = load({ playing: () => on });
  transport.paint();
  on = true;
  transport.paint();
  assert.equal(parts['data-pa-play'].textWrites, 0);
});
