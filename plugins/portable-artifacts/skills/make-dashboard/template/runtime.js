// Dashboard page behaviour: theme toggle and chart rendering.
// Data comes from <script id="dash-data">; nothing is fetched.
(function () {
  var PA = window.PA;
  var data = JSON.parse(document.getElementById('dash-data').textContent);
  var root = document.documentElement;
  var css = function (name) { return getComputedStyle(root).getPropertyValue(name).trim(); };
  var safeStorage = function (name) { try { return window[name]; } catch (e) { return undefined; } };
  var local = safeStorage('localStorage');

  // Local-time display for refresh stamps (server text is UTC fallback).
  document.querySelectorAll('time[data-t]').forEach(function (el) {
    var d = new Date(el.getAttribute('datetime'));
    if (isNaN(d)) return;
    el.textContent = el.getAttribute('data-t') === 'hm'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  });

  // ---- theme ---------------------------------------------------------------
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var toggle = document.querySelector('[data-theme-toggle]');
  function currentTheme() { return root.getAttribute('data-theme') || 'auto'; }
  function applyTheme(mode) {
    if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    if (toggle) { toggle.textContent = LABEL[mode]; toggle.setAttribute('aria-label', 'Theme: ' + LABEL[mode] + '. Change theme'); }
  }
  applyTheme(currentTheme());
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = PA.nextTheme(currentTheme());
      PA.writeStore(local, 'pa-theme', next);
      applyTheme(next);
      render();
    });
  }

  // ---- charts --------------------------------------------------------------
  // Vega config built from the CSS tokens, so charts follow the theme.
  function config() {
    var surface = css('--surface'), ink2 = css('--text-2'), ink3 = css('--text-3'), grid = css('--grid');
    var font = css('--font');
    var cat = [1, 2, 3, 4, 5, 6, 7, 8].map(function (i) { return css('--s' + i); });
    var seq = [1, 2, 3, 4, 5, 6, 7].map(function (i) { return css('--seq' + i); });
    return {
      background: null,
      font: font,
      view: { stroke: null },
      range: { category: cat, ordinal: seq, ramp: seq, heatmap: seq },
      axis: {
        labelColor: ink3, titleColor: ink2, labelFont: font, titleFont: font,
        labelFontSize: 11, titleFontSize: 12, titleFontWeight: 'normal', labelPadding: 6,
        gridColor: grid, gridWidth: 1, domainColor: grid, tickColor: grid
      },
      axisX: { grid: false, labelAngle: 0, labelOverlap: 'greedy' },
      legend: {
        labelColor: ink2, titleColor: ink2, labelFont: font, titleFont: font,
        labelFontSize: 12, titleFontSize: 12, titleFontWeight: 'normal', symbolType: 'circle', orient: 'top', direction: 'horizontal', padding: 0
      },
      title: { color: ink2, font: font },
      bar: { cornerRadiusEnd: 4, stroke: surface, strokeWidth: 2, fill: cat[0] },
      line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round', stroke: cat[0] },
      point: { size: 64, filled: true, stroke: surface, strokeWidth: 2, fill: cat[0] },
      area: { opacity: 0.85, line: { strokeWidth: 2 }, fill: cat[0] },
      rect: { stroke: surface, strokeWidth: 2 },
      arc: { stroke: surface, strokeWidth: 2 },
      text: { color: ink2, font: font, fontSize: 11 }
    };
  }

  // Hover layer by default: tooltips on every mark that did not ask for its own.
  function withTooltip(node) {
    if (Array.isArray(node)) return node.map(withTooltip);
    if (!node || typeof node !== 'object') return node;
    var out = {};
    Object.keys(node).forEach(function (k) { out[k] = k === 'data' ? node[k] : withTooltip(node[k]); });
    if (typeof node.mark === 'string') out.mark = { type: node.mark, tooltip: true };
    else if (node.mark && typeof node.mark === 'object' && node.mark.tooltip === undefined) out.mark = Object.assign({}, node.mark, { tooltip: true });
    return out;
  }

  function embed(el, vl, rows, cfg) {
    var unit = !('hconcat' in vl || 'vconcat' in vl || 'concat' in vl || 'repeat' in vl || 'facet' in vl);
    var spec = Object.assign({ height: 260 }, vl, { data: { values: rows }, config: cfg });
    if (unit) {
      spec.width = 'container';
      spec.autosize = { type: typeof spec.height === 'object' ? 'fit-x' : 'fit', contains: 'padding' };
    }
    el.textContent = '';
    // ast: true uses the bundled expression interpreter, so the strict CSP
    // needs no 'unsafe-eval'. Actions (export, editor links) stay off.
    return window.vegaEmbed(el, spec, { renderer: 'svg', ast: true, actions: false }).catch(function (err) {
      el.innerHTML = '';
      var p = document.createElement('p');
      p.className = 'chart-error';
      p.textContent = 'Chart failed to render: ' + (err && err.message ? err.message : err);
      el.appendChild(p);
    });
  }

  function render() {
    var cfg = config();
    return Promise.all(data.charts.map(function (c) {
      var el = document.getElementById('chart-' + c.id);
      return el ? embed(el, withTooltip(c.vegaLite), data.queries[c.query].rows, cfg) : null;
    }));
  }

  render().then(function () { window.paReady = true; });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(render);
  }
})();
