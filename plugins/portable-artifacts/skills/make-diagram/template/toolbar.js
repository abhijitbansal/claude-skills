// make-diagram page chrome: toolbar buttons, export and the
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

  // ---- diagram ---------------------------------------------------------------------
  var buttons = {};
  document.querySelectorAll('[data-act]').forEach(function (b) { buttons[b.getAttribute('data-act')] = b; });
  var modes = {};
  document.querySelectorAll('[data-pa-mode]').forEach(function (b) { modes[b.getAttribute('data-pa-mode')] = b; });
  var zoomLabel = one('[data-zoom-label]');
  var fullButton = one('[data-pa-full]');
  var stepRe = /^#step-(\d+)$/;

  var hashAt = null; // the beat the hash names (null outside Play): a camera frame does not rewrite it
  function setHash(state) {
    var want = state.presenting ? state.step : null;
    if (want === hashAt) return;
    try {
      if (want !== null) history.replaceState(null, '', '#step-' + (want + 1));
      else history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* file:// without history: the deep link just is not updated */ }
    hashAt = want;
  }

  function sync(state) {
    document.body.classList.toggle('pa-presenting', state.presenting);
    if (zoomLabel) zoomLabel.textContent = Math.round(state.zoom * 100) + '%';
    if (modes.play) {
      modes.play.setAttribute('aria-pressed', String(state.presenting));
      modes.play.disabled = state.steps === 0;
    }
    if (modes.explore) modes.explore.setAttribute('aria-pressed', String(!state.presenting));
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
    if (fullButton) {
      fullButton.setAttribute('aria-pressed', String(state.fullscreen));
    }
    setHash(state);
  }

  var ctl = window.PADiagram.mount(stage, data, { keys: document, caption: one('[data-pa-caption]'), chapters: one('[data-pa-chapters]'), panel: one('[data-pa-panel]'), tip: one('[data-pa-tip]'), find: one('[data-pa-find]'), found: one('[data-pa-found]'), onChange: sync });
  var act = {
    fit: function () { ctl.fit(); },
    'zoom-in': function () { ctl.zoomBy(1.25); },
    'zoom-out': function () { ctl.zoomBy(0.8); },
    animate: function () { ctl.toggleAnimate(); },
  };
  Object.keys(act).forEach(function (name) { if (buttons[name]) buttons[name].addEventListener('click', act[name]); });
  // The tabs: Play story enters the player on its first beat (the transport's Play starts it); Explore leaves it.
  if (modes.play) modes.play.addEventListener('click', function () { if (!ctl.state().presenting) ctl.present(0); });
  if (modes.explore) modes.explore.addEventListener('click', function () { ctl.exit(); });
  if (fullButton) fullButton.addEventListener('click', function () { ctl.toggleFullscreen(); });

  function fromHash() {
    var m = stepRe.exec(location.hash);
    if (m) ctl.goTo(Number(m[1]) - 1);
  }
  window.addEventListener('hashchange', fromHash);

  // ---- export ----------------------------------------------------------------------
  // Every variable the diagram stylesheet reads, so an exported file carries its colours.
  var VARS = ['--page', '--surface', '--text', '--text-2', '--text-3', '--line', '--grid', '--accent', '--accent-soft', '--warn', '--good', '--bad', '--glow',
    '--k-person', '--k-service', '--k-data', '--k-queue', '--k-external', '--k-decision', '--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8', '--font', '--mono'];
  var MAX_PX = 8192;
  var PNG_SCALE = 2;
  var surface = function () { return getComputedStyle(root).getPropertyValue('--surface').trim(); };
  var styleText = function (id) { var el = document.getElementById(id); return el ? el.textContent : ''; };

  // A standalone copy of the diagram: every state class removed, the full canvas,
  // the theme's variables, fonts and diagram CSS inside, and a surface-coloured
  // background (dark-theme text vanishes on a transparent one).
  function standaloneSvg() {
    var clone = ctl.svg.cloneNode(true);
    clone.querySelectorAll('.pa-hidden,.pa-dim,.pa-on,.pa-hl,.pa-active,.pa-selected,.pa-route').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-dim', 'pa-on', 'pa-hl', 'pa-active', 'pa-selected', 'pa-route'); });
    clone.querySelectorAll('.pa-dot,.pa-hit').forEach(function (el) { el.remove(); });
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
      // autoplay starts the story by itself, unless a deep link picked a beat or motion is reduced.
      if (data.autoplay && !stepRe.test(location.hash) && !ctl.state().reducedMotion) ctl.play();
      window.paReady = true;
    });
})();
