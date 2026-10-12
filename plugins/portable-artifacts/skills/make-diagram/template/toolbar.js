// make-diagram page chrome: toolbar buttons, theme toggle, export and the
// #step-N deep link. The diagram itself is driven by PADiagram (viewer.js).
// Data comes from the JSON block with id pa-data; nothing is fetched.
(function () {
  'use strict';
  var data = JSON.parse(document.getElementById('pa-data').textContent);
  var root = document.documentElement;
  var stage = document.getElementById('pa-stage');
  var one = function (sel) { return document.querySelector(sel); };
  var safeStorage = function () { try { return window.localStorage; } catch (e) { return undefined; } };
  var local = safeStorage();

  // ---- theme ---------------------------------------------------------------------
  var ORDER = ['auto', 'light', 'dark'];
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var themeButton = one('[data-theme-toggle]');
  function currentTheme() { return root.getAttribute('data-theme') || 'auto'; }
  function applyTheme(mode) {
    if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    if (themeButton) { themeButton.textContent = 'Theme: ' + LABEL[mode]; themeButton.setAttribute('aria-label', 'Theme: ' + LABEL[mode] + '. Change theme'); }
  }
  applyTheme(currentTheme());
  if (themeButton) {
    themeButton.addEventListener('click', function () {
      var next = ORDER[(ORDER.indexOf(currentTheme()) + 1) % ORDER.length];
      try { if (local) local.setItem('pa-theme', next); } catch (e) { /* not remembered; fine */ }
      applyTheme(next);
    });
  }

  // ---- diagram ---------------------------------------------------------------------
  var buttons = {};
  document.querySelectorAll('[data-act]').forEach(function (b) { buttons[b.getAttribute('data-act')] = b; });
  var zoomLabel = one('[data-zoom-label]');
  var stepRe = /^#step-(\d+)$/;

  var wasPresenting = false;
  function setHash(state) {
    try {
      if (state.presenting) history.replaceState(null, '', '#step-' + (state.step + 1));
      else if (wasPresenting) history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* file:// without history: the deep link just is not updated */ }
    wasPresenting = state.presenting;
  }

  function sync(state) {
    document.body.classList.toggle('pa-presenting', state.presenting);
    if (zoomLabel) zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    if (buttons.present) {
      buttons.present.textContent = state.presenting ? 'Exit' : 'Present';
      buttons.present.setAttribute('aria-pressed', String(state.presenting));
      buttons.present.disabled = state.steps === 0;
    }
    if (buttons.animate) {
      if (state.reducedMotion) {
        buttons.animate.textContent = 'Reduced motion';
        buttons.animate.disabled = true;
        buttons.animate.setAttribute('aria-pressed', 'false');
      } else {
        buttons.animate.textContent = 'Animate: ' + (state.animate ? 'On' : 'Off');
        buttons.animate.disabled = false;
        buttons.animate.setAttribute('aria-pressed', String(state.animate));
      }
    }
    setHash(state);
  }

  var ctl = window.PADiagram.mount(stage, data, { keys: document, caption: one('[data-pa-caption]'), onChange: sync });
  var act = {
    fit: function () { ctl.fit(); },
    'zoom-in': function () { ctl.zoomBy(1.25); },
    'zoom-out': function () { ctl.zoomBy(0.8); },
    present: function () { ctl.togglePresent(); },
    animate: function () { ctl.toggleAnimate(); },
  };
  Object.keys(act).forEach(function (name) { if (buttons[name]) buttons[name].addEventListener('click', act[name]); });

  function fromHash() {
    var m = stepRe.exec(location.hash);
    if (m) ctl.goTo(Number(m[1]) - 1);
  }
  window.addEventListener('hashchange', fromHash);

  // ---- export ----------------------------------------------------------------------
  var VARS = ['--page', '--surface', '--text', '--text-2', '--text-3', '--line', '--accent', '--accent-soft', '--warn', '--good', '--bad', '--font'];
  var MAX_PX = 8192;
  var PNG_SCALE = 2;
  var surface = function () { return getComputedStyle(root).getPropertyValue('--surface').trim(); };
  var styleText = function (id) { var el = document.getElementById(id); return el ? el.textContent : ''; };

  // A standalone copy of the diagram: every state class removed, the full canvas,
  // the theme's variables, fonts and diagram CSS inside, and a surface-coloured
  // background (dark-theme text vanishes on a transparent one).
  function standaloneSvg() {
    var clone = ctl.svg.cloneNode(true);
    clone.querySelectorAll('.pa-hidden,.pa-dim,.pa-on,.pa-hl').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-dim', 'pa-on', 'pa-hl'); });
    clone.classList.remove('pa-animate', 'pa-tracing');
    clone.querySelectorAll('[tabindex]').forEach(function (el) { el.removeAttribute('tabindex'); });
    clone.setAttribute('viewBox', '0 0 ' + data.width + ' ' + data.height);
    clone.setAttribute('width', String(data.width));
    clone.setAttribute('height', String(data.height));
    var vars = VARS.map(function (v) { return v + ':' + getComputedStyle(root).getPropertyValue(v).trim(); }).join(';');
    var fonts = (styleText('pa-theme-css').match(/@font-face\{[^}]*\}/g) || []).join('\n');
    var ns = clone.namespaceURI;
    var style = document.createElementNS(ns, 'style');
    style.textContent = fonts + '\n.pa-diagram{' + vars + '}\n' + styleText('pa-diagram-css');
    var bg = document.createElementNS(ns, 'rect');
    bg.setAttribute('width', '100%');
    bg.setAttribute('height', '100%');
    bg.setAttribute('fill', surface());
    var defs = clone.querySelector('defs');
    clone.insertBefore(style, defs || clone.firstChild);
    clone.insertBefore(bg, defs ? defs.nextSibling : style.nextSibling);
    return new XMLSerializer().serializeToString(clone);
  }

  function rasterise(svgText) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }));
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(PNG_SCALE, MAX_PX / Math.max(data.width, data.height));
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(data.width * scale);
          canvas.height = Math.round(data.height * scale);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = surface();
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(function (blob) { return blob ? resolve(URL.createObjectURL(blob)) : reject(new Error('the browser could not encode a PNG')); }, 'image/png');
        } catch (err) { reject(err); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('the browser could not draw the diagram as an image')); };
      img.src = url;
    });
  }

  function download(href, name) {
    var a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 10000);
  }

  // A failed export would otherwise be a dead click: say so on the page (text only).
  var errorLine = one('[data-export-error]');
  function showExportError(message) {
    if (!errorLine) return;
    errorLine.textContent = message ? 'Export failed: ' + message : '';
    errorLine.hidden = !message;
  }
  var stem = data.stem || 'diagram'; // built once, with the .html file name (scripts/lib/output.mjs)

  function exportAs(kind) {
    showExportError(null);
    try {
      var svgText = standaloneSvg();
      if (kind === 'svg') {
        download(URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' })), stem + '.svg');
        return;
      }
      rasterise(svgText).then(function (href) { download(href, stem + '.png'); }).catch(function (err) {
        showExportError(err && err.message ? err.message : String(err));
      });
    } catch (err) {
      showExportError(err && err.message ? err.message : String(err));
    }
  }
  document.querySelectorAll('[data-export]').forEach(function (b) {
    b.addEventListener('click', function () { exportAs(b.getAttribute('data-export')); });
  });

  // ---- ready -------------------------------------------------------------------------
  // Fonts first, so a test (or a user) measuring text sees the embedded face.
  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
    .catch(function () {})
    .then(function () {
      fromHash();
      window.paReady = true;
    });
})();
