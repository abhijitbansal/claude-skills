// Dashboard page behaviour: chart rendering (the theme toggle is the shared one in the page).
// Data comes from <script id="dash-data">; nothing is fetched.
(function () {
  var PA = window.PA;
  var data = JSON.parse(document.getElementById('dash-data').textContent);
  var root = document.documentElement;
  var css = function (name) { return getComputedStyle(root).getPropertyValue(name).trim(); };
  var safeStorage = function (name) { try { return window[name]; } catch (e) { return undefined; } };

  // Local-time display for refresh stamps (server text is UTC fallback).
  document.querySelectorAll('time[data-t]').forEach(function (el) {
    var d = new Date(el.getAttribute('datetime'));
    if (isNaN(d)) return;
    el.textContent = el.getAttribute('data-t') === 'hm'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  });

  // ---- charts --------------------------------------------------------------
  // Vega config built from the CSS tokens, so charts follow the theme.
  // PAVegaConfig is scripts/lib/vega-config.mjs, inlined by html.mjs.
  function config() {
    var cat = [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return css('--s' + i); });
    var seq = [1, 2, 3, 4, 5, 6, 7].map(function (i) { return css('--seq' + i); });
    return window.PAVegaConfig({
      surface: css('--surface'), text2: css('--text-2'), text3: css('--text-3'), grid: css('--grid'), cat: cat, seq: seq
    }, css('--font'));
  }

  // Each pane has a render token. Every paint takes a fresh one, and an async
  // embed only lands if its token is still current; a stale embed is
  // finalized and discarded, so a slow chart never overwrites a later Table.
  var paneState = {}; // pane id -> { token, result }
  function pane(el) { return paneState[el.id] || (paneState[el.id] = { token: 0, result: null }); }
  function release(p) {
    if (p.result) { try { p.result.finalize(); } catch (e) { /* already gone */ } p.result = null; }
  }

  function embed(el, vl, rows, cfg) {
    var unit = !('hconcat' in vl || 'vconcat' in vl || 'concat' in vl || 'repeat' in vl || 'facet' in vl);
    // The theme config wins over a view's own; only a number format may come from the view
    // (it is how a boxplot formats its summary tooltips).
    var own = vl.config && vl.config.numberFormat ? { numberFormat: vl.config.numberFormat } : {};
    var spec = Object.assign({ height: 260 }, vl, { data: { values: rows }, config: Object.assign({}, cfg, own) });
    if (unit) {
      spec.width = 'container';
      spec.autosize = { type: typeof spec.height === 'object' ? 'fit-x' : 'fit', contains: 'padding' };
    }
    var p = pane(el);
    var token = ++p.token;
    // Render into a hidden sibling (still laid out, so 'container' width works);
    // the previous content stays until the new chart is ready.
    var box = document.createElement('div');
    box.className = 'pa-pending';
    el.appendChild(box);
    function land(content) {
      release(p);
      while (el.firstChild && el.firstChild !== box) el.removeChild(el.firstChild);
      box.className = '';
      if (content) { box.textContent = ''; box.appendChild(content); }
    }
    // ast: true uses the bundled expression interpreter, so the strict CSP
    // needs no 'unsafe-eval'. Actions (export, editor links) stay off.
    return window.vegaEmbed(box, spec, { renderer: 'svg', ast: true, actions: false }).then(function (result) {
      if (token !== p.token) { result.finalize(); if (box.parentNode) box.parentNode.removeChild(box); return; }
      land(null);
      p.result = result;
    }, function (err) {
      if (token !== p.token) { if (box.parentNode) box.parentNode.removeChild(box); return; }
      var msg = document.createElement('p');
      msg.className = 'chart-error';
      msg.textContent = 'Chart failed to render: ' + (err && err.message ? err.message : err);
      land(msg);
    });
  }

  // ---- views ---------------------------------------------------------------
  // Active view per chart lives in sessionStorage (per tab); blocked storage
  // just means the choice is forgotten on reload.
  var session = safeStorage('sessionStorage');
  var saved = {};
  try { saved = JSON.parse(PA.readStore(session, 'pa-views') || '{}') || {}; } catch (e) { saved = {}; }
  // A paired card keeps pane 1 on its primary view; the tabs and `active` drive pane 2 (views[1..]).
  function switchable(c) { return c.pair ? c.views.slice(1) : c.views; }
  var active = {};
  data.charts.forEach(function (c) {
    var names = switchable(c).map(function (v) { return v.name; });
    active[c.id] = names.indexOf(saved[c.id]) >= 0 ? saved[c.id] : names[0];
  });
  var tableSort = {}; // pane id -> { col, dir }, kept across redraws

  function tableView(el, c) {
    var q = data.queries[c.query];
    var p = pane(el);
    p.token += 1; // cancels any chart embed still in flight for this pane
    release(p);
    var state = tableSort[el.id] || (tableSort[el.id] = { col: null, dir: 'asc' });
    var rows = state.col ? PA.sortRows(q.rows, state.col, state.dir) : q.rows;
    var shown = rows.slice(0, PA.TABLE_LIMIT);
    var wrap = document.createElement('div');
    wrap.className = 'table-view';
    var table = document.createElement('table');
    var head = table.createTHead().insertRow();
    q.columns.forEach(function (col) {
      var th = document.createElement('th');
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = col;
      if (state.col === col) {
        th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
        b.setAttribute('data-arrow', state.dir === 'asc' ? '\u2191' : '\u2193');
      }
      b.addEventListener('click', function () {
        state.dir = state.col === col && state.dir === 'asc' ? 'desc' : 'asc';
        state.col = col;
        tableView(el, c);
      });
      th.appendChild(b);
      head.appendChild(th);
    });
    var body = table.createTBody();
    shown.forEach(function (r) {
      var tr = body.insertRow();
      q.columns.forEach(function (col) { tr.insertCell().textContent = r[col] === null || r[col] === undefined ? '' : String(r[col]); });
    });
    wrap.appendChild(table);
    el.textContent = '';
    el.appendChild(wrap);
    if (rows.length > shown.length) {
      var note = document.createElement('p');
      note.className = 'meta';
      note.textContent = 'Showing ' + shown.length + ' of ' + rows.length + ' rows';
      el.appendChild(note);
    }
    return Promise.resolve();
  }

  function paint(el, c, view, cfg) {
    if (!view.vegaLite) {
      el.removeAttribute('role'); // a table is not an image
      return tableView(el, c);
    }
    el.setAttribute('role', 'img');
    return embed(el, view.vegaLite, data.queries[c.query].rows, cfg);
  }

  function renderChart(c, cfg) {
    var first = document.getElementById('chart-' + c.id);
    if (!first) return null;
    var view = switchable(c).filter(function (v) { return v.name === active[c.id]; })[0] || switchable(c)[0];
    if (c.pair) {
      return Promise.all([paint(first, c, c.views[0], cfg), paint(document.getElementById('chart-' + c.id + '-2'), c, view, cfg)]);
    }
    return paint(first, c, view, cfg);
  }

  function render() {
    var cfg = config();
    return Promise.all(data.charts.map(function (c) { return renderChart(c, cfg); }));
  }
  // The shared toggle (in the page) announces a theme change; charts take their colours from the CSS tokens.
  document.addEventListener('pa:theme', function () { render(); });

  function select(c, name, focus) {
    active[c.id] = name;
    saved[c.id] = name;
    PA.writeStore(session, 'pa-views', JSON.stringify(saved));
    document.querySelectorAll('#card-' + c.id + ' [role=tab]').forEach(function (b) {
      var on = b.getAttribute('data-view') === name;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    syncExport(c);
    renderChart(c, config());
  }

  // ---- export --------------------------------------------------------------
  // Images come from the first pane's live Vega view (see paneState); the Table
  // view has none, so PNG/SVG hide there. CSV is the query's rows as loaded.
  function firstView(c) {
    return c.pair ? c.views[0] : c.views.filter(function (v) { return v.name === active[c.id]; })[0] || c.views[0];
  }

  function syncExport(c) {
    var menu = document.querySelector('#card-' + c.id + ' details.export');
    if (!menu) return;
    var isTable = !firstView(c).vegaLite;
    menu.querySelectorAll('[data-export=png],[data-export=svg]').forEach(function (b) { b.hidden = isTable; });
  }

  // The chart itself is transparent; fill it with the page surface so the file
  // reads the same as on screen (dark-theme text vanishes on white otherwise).
  function imageHref(view, kind) {
    var surface = css('--surface');
    if (kind === 'svg') {
      return view.toSVG().then(function (svg) {
        var filled = svg.replace(/<svg[^>]*>/, function (tag) { return tag + '<rect width="100%" height="100%" fill="' + surface + '"/>'; });
        return URL.createObjectURL(new Blob([filled], { type: 'image/svg+xml;charset=utf-8' }));
      });
    }
    return view.toCanvas(2).then(function (chart) {
      var flat = document.createElement('canvas');
      flat.width = chart.width;
      flat.height = chart.height;
      var ctx = flat.getContext('2d');
      ctx.fillStyle = surface;
      ctx.fillRect(0, 0, flat.width, flat.height);
      ctx.drawImage(chart, 0, 0);
      return flat.toDataURL('image/png');
    });
  }

  // A failed image export would otherwise be a dead click: say so in the card (text only).
  function showExportError(c, message) {
    var card = document.getElementById('card-' + c.id);
    var line = card && card.querySelector('.export-error');
    if (!message) { if (line) line.remove(); return; }
    if (!line) {
      line = document.createElement('p');
      line.className = 'chart-error export-error';
      line.setAttribute('role', 'alert');
      var head = card.querySelector('.card-head');
      head.parentNode.insertBefore(line, head.nextSibling);
    }
    line.textContent = 'Export failed: ' + message;
  }

  function download(href, name) {
    var a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  data.charts.forEach(function (c) {
    var menu = document.querySelector('#card-' + c.id + ' details.export');
    if (!menu) return;
    syncExport(c);
    menu.addEventListener('click', function (e) {
      var kind = e.target && e.target.getAttribute && e.target.getAttribute('data-export');
      if (!kind) return;
      var stem = PA.fileStem(c.title);
      menu.open = false;
      showExportError(c, null);
      if (kind === 'csv') {
        var q = data.queries[c.query];
        var url = URL.createObjectURL(new Blob([PA.toCsv(q.columns, q.rows)], { type: 'text/csv;charset=utf-8' }));
        download(url, stem + '.csv');
        setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        return;
      }
      var first = document.getElementById('chart-' + c.id);
      var result = first && pane(first).result;
      if (!result) return; // Table view, or the chart has not landed yet
      imageHref(result.view, kind).then(function (href) { download(href, stem + '.' + kind); }).catch(function (err) {
        showExportError(c, err && err.message ? err.message : String(err));
      });
    });
  });

  data.charts.forEach(function (c) {
    var list = document.querySelector('#card-' + c.id + ' [role=tablist]');
    if (!list) return;
    var buttons = Array.prototype.slice.call(list.querySelectorAll('[role=tab]'));
    buttons.forEach(function (b) {
      var on = b.getAttribute('data-view') === active[c.id];
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      b.addEventListener('click', function () { select(c, b.getAttribute('data-view'), false); });
    });
    list.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var i = buttons.map(function (b) { return b.getAttribute('data-view'); }).indexOf(active[c.id]);
      var next = buttons[(i + (e.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length];
      select(c, next.getAttribute('data-view'), true);
      e.preventDefault();
    });
  });

  // First render waits for the embedded fonts so Vega measures labels with them.
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
    .catch(function () {})
    .then(render)
    .then(function () { window.paReady = true; });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(render);
  }
})();
