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

  root.PA = {
    nextTheme: nextTheme, readStore: readStore, writeStore: writeStore, saveStore: saveStore,
    readChecks: readChecks, mergeChecks: mergeChecks, checkProgress: checkProgress, activeIndex: activeIndex,
  };
})(typeof window !== 'undefined' ? window : globalThis);
