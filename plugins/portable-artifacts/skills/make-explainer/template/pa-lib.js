// Pure helpers for the explainer page. Loaded as a classic script in the page
// and through node:vm in tests, so: no imports, no DOM access here.
(function (root) {
  'use strict';
  var THEMES = ['auto', 'light', 'dark'];

  function nextTheme(mode) {
    var i = Math.max(0, THEMES.indexOf(mode)); // junk counts as 'auto'
    return THEMES[(i + 1) % THEMES.length];
  }

  // window.localStorage / sessionStorage, or undefined when merely reading the property throws.
  function safeStorage(name) {
    try { return root[name]; } catch (e) { return undefined; }
  }

  // Storage can be missing or throw (private mode, blocked site data).
  function readStore(storage, key) {
    try { return storage ? storage.getItem(key) : null; } catch (e) { return null; }
  }

  function writeStore(storage, key, value) {
    try { if (storage) storage.setItem(key, value); } catch (e) { /* not remembered; fine */ }
  }

  // Like writeStore, but says whether the write held. A null value removes the key.
  function saveStore(storage, key, value) {
    try {
      if (!storage) return false;
      if (value === null) storage.removeItem(key); else storage.setItem(key, value);
      return true;
    } catch (e) { return false; }
  }

  // Saved checklist ticks: JSON { [id]: true }. Only ids in `ids` that are exactly true
  // survive; anything else (junk, arrays, other types, __proto__) reads as nothing ticked.
  function readChecks(raw, ids) {
    var out = Object.create(null);
    if (typeof raw !== 'string' || raw === '') return out;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return out; }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return out;
    for (var i = 0; i < ids.length; i++) {
      if (Object.prototype.hasOwnProperty.call(data, ids[i]) && data[ids[i]] === true) out[ids[i]] = true;
    }
    return out;
  }

  // The string to store after this page changed its own ticks. `raw` is what is stored now
  // (another tab or page on the same key may have written since this page read it): only
  // this page's `ids` are set or removed, every other stored entry is kept as it was.
  // Returns null when nothing is left (remove the key).
  function mergeChecks(raw, ids, checked) {
    var data = {};
    var stored = null;
    if (typeof raw === 'string' && raw !== '') {
      try { stored = JSON.parse(raw); } catch (e) { stored = null; }
    }
    if (stored !== null && typeof stored === 'object' && !Array.isArray(stored)) {
      Object.keys(stored).forEach(function (k) { if (k !== '__proto__') data[k] = stored[k]; });
    }
    ids.forEach(function (id) {
      if (checked[id] === true) data[id] = true; else delete data[id];
    });
    var keys = Object.keys(data).sort();
    if (!keys.length) return null;
    var out = {};
    keys.forEach(function (k) { out[k] = data[k]; });
    return JSON.stringify(out);
  }

  // Floored, so 100 appears only when every item is done.
  function checkProgress(done, total) {
    return { done: done, total: total, pct: total > 0 ? Math.floor((done * 100) / total) : 0 };
  }

  // Which table-of-contents entry is current. `tops` are the sections' top edges
  // in document order, relative to the viewport; `line` is the reading line
  // (a fraction of the viewport height from the top). The last section whose top
  // has passed the line wins; the first one before any has; at the very end of
  // the page the last one wins, so a short final section can still be reached.
  function activeIndex(tops, line, atEnd) {
    if (!tops.length) return -1;
    if (atEnd) return tops.length - 1;
    var active = 0;
    for (var i = 0; i < tops.length; i++) if (tops[i] <= line) active = i;
    return active;
  }

  // ---- slides (1-based slide numbers throughout) -----------------------------------------

  // A whole number in 1..total; junk and NaN read as the first slide.
  function clampSlide(n, total) {
    if (typeof n !== 'number' || n !== n) return 1;
    var last = Math.max(1, total);
    return Math.min(last, Math.max(1, Math.floor(n)));
  }

  // "#slide-N" -> the slide to open (clamped); "#<id>" -> the slide whose section has that id (ids[n - 1], '' for
  // none); null when the hash is anything else.
  function parseSlideHash(hash, total, ids) {
    if (typeof hash !== 'string') return null;
    var m = /^#slide-(\d+)$/.exec(hash);
    if (m) return clampSlide(Number(m[1]), total);
    var at = ids && hash.length > 1 ? ids.indexOf(hash.slice(1)) : -1;
    return at >= 0 ? clampSlide(at + 1, total) : null;
  }

  // The stored last position: digits only. A stale number past the end clamps; junk reads as null.
  function parseResume(raw, total) {
    return typeof raw === 'string' && /^\d+$/.test(raw) ? clampSlide(Number(raw), total) : null;
  }

  // Key -> { to, paged } or null. "paged" keys (Space, PageUp, PageDown) scroll a tall slide first.
  function slideKey(key, shift) {
    var move = function (to, paged) { return { to: to, paged: paged }; };
    switch (key) {
      case 'ArrowRight': return move('next', false);
      case 'ArrowLeft': return move('prev', false);
      case ' ': case 'Spacebar': return move(shift ? 'prev' : 'next', true);
      case 'PageDown': return move('next', true);
      case 'PageUp': return move('prev', true);
      case 'Home': return move('first', false);
      case 'End': return move('last', false);
      case 'o': case 'O': return move('outline', false);
      default: return null;
    }
  }

  function moveTarget(to, current, total) {
    switch (to) {
      case 'next': return clampSlide(current + 1, total);
      case 'prev': return clampSlide(current - 1, total);
      case 'first': return 1;
      case 'last': return Math.max(1, total);
      default: return current;
    }
  }

  // Does a slide taller than the view have more to show in this direction (1 down, -1 up)?
  // m = { scrollTop, clientHeight, scrollHeight }; a pixel of slack counts as the end.
  function canScroll(m, dir) {
    if (dir > 0) return m.scrollTop + m.clientHeight < m.scrollHeight - 1;
    if (dir < 0) return m.scrollTop > 1;
    return false;
  }

  // Which slide a deck of equal-height slides is scrolled to.
  function slideAtScroll(top, height, total) {
    return height > 0 ? clampSlide(Math.round(top / height) + 1, total) : 1;
  }

  root.PA = {
    nextTheme: nextTheme, safeStorage: safeStorage, readStore: readStore, writeStore: writeStore, saveStore: saveStore,
    readChecks: readChecks, mergeChecks: mergeChecks, checkProgress: checkProgress, activeIndex: activeIndex,
    clampSlide: clampSlide, parseSlideHash: parseSlideHash, parseResume: parseResume, slideKey: slideKey,
    moveTarget: moveTarget, canScroll: canScroll, slideAtScroll: slideAtScroll,
  };
})(typeof window !== 'undefined' ? window : globalThis);
