// Pure helpers for the explainer page. Loaded as a classic script in the page
// and through node:vm in tests, so: no imports, no DOM access here.
(function (root) {
  'use strict';
  var THEMES = ['auto', 'light', 'dark'];

  function nextTheme(mode) {
    var i = Math.max(0, THEMES.indexOf(mode)); // junk counts as 'auto'
    return THEMES[(i + 1) % THEMES.length];
  }

  // Storage can be missing or throw (private mode, blocked site data).
  function readStore(storage, key) {
    try { return storage ? storage.getItem(key) : null; } catch (e) { return null; }
  }

  function writeStore(storage, key, value) {
    try { if (storage) storage.setItem(key, value); } catch (e) { /* not remembered; fine */ }
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

  root.PA = { nextTheme: nextTheme, readStore: readStore, writeStore: writeStore, activeIndex: activeIndex };
})(typeof window !== 'undefined' ? window : globalThis);
