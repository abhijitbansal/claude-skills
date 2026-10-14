// make-diagram viewer, full screen: asks the browser for full screen on `root`
// and, where that is refused or absent (a sandboxed iframe, an old browser),
// falls back to the class pa-fill on root, which the page styles as a
// window-filling layer. Registered as PADiagram.fullscreen and composed by
// viewer.js.
//
//   var fs = PADiagram.fullscreen(root, { onChange });
//   // -> { enter, exit, toggle, isOn, isFill }
//
// onChange runs after every change, the browser's own exit included (Esc in
// real full screen never reaches the page as a key; fullscreenchange does).
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  PADiagram.fullscreen = function (root, hooks) {
    hooks = hooks || {};
    var doc = global.document;
    var fill = false;
    root.setAttribute('data-pa-full-root', ''); // the page's :fullscreen hide rules key on it
    var changed = function () { if (hooks.onChange) hooks.onChange(); };
    var real = function () { return !!doc.fullscreenElement && doc.fullscreenElement === root; };
    var isOn = function () { return fill || real(); };

    function fallback() {
      if (fill || real()) return;
      fill = true;
      root.classList.add('pa-fill');
      changed();
    }
    function enter() {
      if (isOn()) return;
      if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== 'function') { fallback(); return; }
      var p;
      try { p = root.requestFullscreen(); } catch (e) { fallback(); return; }
      if (p && typeof p.then === 'function') p.then(null, fallback);
      else global.setTimeout(function () { if (!real()) fallback(); }, 0); // no promise (an old browser): look after a tick
    }
    function exit() {
      if (fill) {
        fill = false;
        root.classList.remove('pa-fill');
        changed();
      }
      if (real() && typeof doc.exitFullscreen === 'function') {
        var p;
        try { p = doc.exitFullscreen(); } catch (e) { /* already out */ }
        if (p && typeof p.then === 'function') p.then(null, function () {});
      }
    }
    function toggle() { if (isOn()) exit(); else enter(); }
    doc.addEventListener('fullscreenchange', changed);

    return { enter: enter, exit: exit, toggle: toggle, isOn: isOn, isFill: function () { return fill; } };
  };
})(window);
