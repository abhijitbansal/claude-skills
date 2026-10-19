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
  e.parentNode = null;
  e.appendChild = (c) => {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = e;
    e.children.push(c);
    return c;
  };
  e.removeChild = (c) => { e.children = e.children.filter((x) => x !== c); c.parentNode = null; return c; };
  // The hold ring: its svg arrives as markup; the arc inside records WAAPI animate() calls.
  e.animations = [];
  e.animate = (frames, opts) => {
    const a = { frames, opts, cancelled: false, cancel() { a.cancelled = true; } };
    e.animations.push(a);
    return a;
  };
  e.setAttribute = (k, v) => { e.attrs[k] = v; };
  e.removeAttribute = (k) => { delete e.attrs[k]; };
  e.getAttribute = (k) => e.attrs[k] ?? null;
  e.addEventListener = (n, fn) => { e.listeners[n] = fn; };
  e.scrollIntoView = () => { e.scrollIntoViewCalls += 1; };
  e.getBoundingClientRect = () => ({ left: e.rect.left, width: e.rect.width, right: e.rect.left + e.rect.width });
  e.focus = () => { doc.activeElement = e; };
  let arc = null;
  e.querySelector = (sel) => {
    if (sel !== '.pa-ring-arc' || !e.innerHTML.includes('pa-ring-arc')) return null;
    return (arc ??= fakeEl(doc, 'circle'));
  };
  return e;
}

const beat = (title) => ({ kind: 'hop', chapter: 0, title, edge: 'edge-0', reverse: false, ids: ['a', 'b'], reveal: [], highlight: [] });
const DATA = { beats: ['One', 'Two', 'Three', 'Four', 'Five'].map(beat), chapters: [{ id: 's', title: 'S', start: 0, end: 5 }] };

// Loads camera.js and transport.js on a bare window and mounts a transport over a
// caption holder whose data-pa-* parts are fake elements. `at` is the current beat.
function load({ playing = () => false, reduced = false } = {}) {
  const doc = { activeElement: null };
  doc.createElement = (tag) => fakeEl(doc, tag);
  const win = { document: doc };
  if (reduced) win.matchMedia = (q) => ({ matches: /reduce\)/.test(q) });
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
  const state = { at: 0, loop: false };
  const noop = () => {};
  const story = {
    isPresenting: () => true, index: () => state.at, count: () => DATA.beats.length, current: () => DATA.beats[state.at], chapter: () => 0,
    isPlaying: () => playing(), speed: () => 1, loop: () => state.loop,
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

// ---- the hold-progress ring ---------------------------------------------------------------
const ringOf = (parent) => parent.children.find((c) => c.className === 'pa-ring');
const arcOf = (ring) => ring.querySelector('.pa-ring-arc');
const live = (arc) => arc.animations.filter((a) => !a.cancelled);

test('no ring until a hold is reported', () => {
  const { transport, parts } = load();
  transport.paint();
  assert.equal(ringOf(parts['data-pa-next']), undefined);
  assert.equal(ringOf(parts['data-pa-play']), undefined);
});

test('hold(ms) creates a ring under data-pa-next and animates over ms', () => {
  const { transport, parts } = load({ playing: () => true });
  transport.hold(1800);
  const ring = ringOf(parts['data-pa-next']);
  assert.ok(ring, 'a ring child of Next');
  assert.equal(ring.getAttribute('aria-hidden'), 'true', 'decorative');
  const arc = arcOf(ring);
  assert.equal(arc.animations.length, 1);
  const [a] = arc.animations;
  assert.equal(a.opts.duration, 1800);
  assert.equal(a.opts.easing, 'linear');
  assert.equal(a.opts.fill, 'forwards');
  assert.equal(a.cancelled, false);
  assert.match(ring.innerHTML, /stroke-dasharray/, 'an svg circle drawn with a dash array');
});

test('the ring survives paint() and a speed change mid-hold', () => {
  const { transport, parts, state } = load({ playing: () => true });
  state.at = 1;
  transport.hold(1800);
  const ring = ringOf(parts['data-pa-next']);
  const arc = arcOf(ring);
  transport.paint(); // what a speed or loop change calls (via onStep)
  state.at = 2; // a beat later with the hold still running is impossible, but paint must not care
  transport.paint();
  assert.equal(arcOf(ring), arc);
  assert.equal(arc.animations.length, 1, 'no restart');
  assert.equal(live(arc).length, 1, 'not cancelled');
  assert.equal(parts['data-pa-next'].children.filter((c) => c === ring).length, 1, 'one ring, still under Next');
  assert.equal(parts['data-pa-play'].textWrites, 0);
});

test('last beat, loop on: the ring moves to data-pa-play without restarting', () => {
  const { transport, parts, state } = load({ playing: () => true });
  state.at = 4;
  state.loop = true;
  transport.hold(1800);
  const ring = ringOf(parts['data-pa-play']);
  assert.ok(ring, 'the ring lives in Play');
  assert.equal(ringOf(parts['data-pa-next']), undefined, 'and not in Next');
  // loop toggled while the last beat holds
  state.loop = false;
  transport.paint();
  assert.equal(ring.parentNode, null, 'loop off: nothing follows the hold, no ring');
  const arc = arcOf(ring);
  state.loop = true;
  transport.paint();
  assert.equal(ring.parentNode, parts['data-pa-play'], 'loop back on: the same ring returns');
  assert.equal(arc.animations.length, 1, 'the animation was never restarted');
  assert.equal(live(arc).length, 1);
});

test('last beat, loop off: no ring', () => {
  const { transport, parts, state } = load({ playing: () => true });
  state.at = 4;
  state.loop = false;
  transport.hold(1800);
  transport.paint();
  assert.equal(ringOf(parts['data-pa-next']), undefined);
  assert.equal(ringOf(parts['data-pa-play']), undefined);
});

test('a ring in Next moves to Play when the beat becomes the last with loop on, and keeps animating', () => {
  const { transport, parts, state } = load({ playing: () => true });
  state.at = 3;
  transport.hold(1800);
  const ring = ringOf(parts['data-pa-next']);
  const arc = arcOf(ring);
  state.at = 4;
  state.loop = true;
  transport.paint();
  assert.equal(ring.parentNode, parts['data-pa-play']);
  assert.equal(arc.animations.length, 1);
  assert.equal(live(arc).length, 1);
});

test('holdEnd removes the animation and the ring, and does not paint', () => {
  const { transport, parts } = load({ playing: () => true });
  transport.hold(1800);
  const ring = ringOf(parts['data-pa-next']);
  const arc = arcOf(ring);
  const before = parts['data-pa-count'].textContent;
  transport.holdEnd();
  assert.equal(arc.animations[0].cancelled, true, 'cancel() was called');
  assert.equal(ring.parentNode, null);
  assert.equal(ringOf(parts['data-pa-next']), undefined);
  assert.equal(parts['data-pa-count'].textContent, before, 'holdEnd leaves the painting to onStep');
  transport.holdEnd(); // a second end is harmless
});

test('the next hold animates afresh, and a hold that overlaps one cancels the old', () => {
  const { transport, parts } = load({ playing: () => true });
  transport.hold(1800);
  const arc = arcOf(ringOf(parts['data-pa-next']));
  transport.holdEnd();
  transport.hold(3300);
  assert.equal(arc.animations.length, 2);
  assert.equal(arc.animations[1].opts.duration, 3300);
  assert.equal(live(arc).length, 1);
  transport.hold(900); // no holdEnd between: the old one must not linger
  assert.equal(live(arc).length, 1);
  assert.equal(live(arc)[0].opts.duration, 900);
});

test('reduced motion: a static half-filled ring, no animation', () => {
  const { transport, parts } = load({ playing: () => true, reduced: true });
  transport.hold(1800);
  const ring = ringOf(parts['data-pa-next']);
  assert.ok(ring, 'the ring still shows');
  const arc = arcOf(ring);
  assert.equal(arc.animations.length, 0, 'nothing animates');
  assert.equal(arc.getAttribute('stroke-dashoffset'), '50', 'half filled of a pathLength of 100');
  transport.holdEnd();
  assert.equal(ring.parentNode, null);
});

test('paint() after holdEnd (what pause does through onStep) does not bring the ring back', () => {
  const { transport, parts } = load({ playing: () => true });
  transport.hold(1800);
  transport.holdEnd();
  transport.paint();
  assert.equal(ringOf(parts['data-pa-next']), undefined);
  assert.equal(ringOf(parts['data-pa-play']), undefined);
});
