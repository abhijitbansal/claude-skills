// Pure helpers for the dashboard page. Loaded as a classic script in the page
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

  var TABLE_LIMIT = 500;
  var collator = typeof Intl !== 'undefined' ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }) : null;

  // New array; NULLs last in both directions; ties keep their order.
  function sortRows(rows, column, dir) {
    var sign = dir === 'desc' ? -1 : 1;
    return rows
      .map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) {
        var x = a.r[column], y = b.r[column];
        var xn = x === null || x === undefined, yn = y === null || y === undefined;
        if (xn || yn) return xn === yn ? a.i - b.i : xn ? 1 : -1;
        var c = typeof x === 'number' && typeof y === 'number' ? x - y : collator ? collator.compare(String(x), String(y)) : String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
        return c === 0 ? a.i - b.i : sign * c;
      })
      .map(function (e) { return e.r; });
  }

  var FORMULA = /^[=+\-@\t\r]/;

  function csvCell(v) {
    if (v === null || v === undefined) return '';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Text a spreadsheet would run as a formula gets a leading quote.
    if (typeof v === 'string' && FORMULA.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(columns, rows) {
    var lines = [columns.map(csvCell).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (c) { return csvCell(r[c]); }).join(',')); });
    return lines.join('\r\n') + '\r\n';
  }

  function fileStem(title) {
    var s = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
    return s || 'chart';
  }

  root.PA = {
    nextTheme: nextTheme, readStore: readStore, writeStore: writeStore, sortRows: sortRows, TABLE_LIMIT: TABLE_LIMIT,
    csvCell: csvCell, toCsv: toCsv, fileStem: fileStem
  };
})(typeof window !== 'undefined' ? window : globalThis);
