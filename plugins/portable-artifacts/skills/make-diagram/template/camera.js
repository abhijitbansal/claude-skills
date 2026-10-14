// make-diagram viewer, camera: zoom, pan, fit and the glide between views for
// one diagram <svg>. The camera is a centre in diagram units and a scale in px
// per unit; the viewBox is derived from it and the stage size. Registered as
// PADiagram.camera and composed by viewer.js. This file comes first in the
// bundle (scripts/lib/runtime.mjs), so it also defines PADiagram.dict.
//
//   var camera = PADiagram.camera(stage, svg, data, { onApply });
//
// onApply runs after every viewBox change (viewer.js emits its state from it).
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 4;
  var MAX_FIT_SCALE = 1.25; // a small diagram is not blown up past this to fill a big stage
  var FIT_MARGIN = 16;
  var FOCUS_PAD = 48;
  var MAX_FOCUS_SCALE = 1.6; // px per diagram unit when a beat zooms in on a few nodes
  var MAX_FOCUS_ZOOM = 2; // and never past this multiple of the fit
  var CAMERA_MS = 300;

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };
  var round = function (v) { return Math.round(v * 100) / 100; };

  // Ids are model-provided keys: every id-keyed map has no prototype, so an id
  // like "constructor" is just a key (a plain {} would answer for it).
  PADiagram.dict = function (source) {
    var d = Object.create(null);
    Object.keys(source || {}).forEach(function (k) { d[k] = source[k]; });
    return d;
  };

  PADiagram.camera = function (stage, svg, data, hooks) {
    hooks = hooks || {};
    var W = Math.max(1, finite(data.width, 1));
    var H = Math.max(1, finite(data.height, 1));
    var boxes = PADiagram.dict(data.boxes);
    var reduceQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = function () { return !!(reduceQuery && reduceQuery.matches); };
    var cam = { cx: W / 2, cy: H / 2, s: 1 };
    var fitted = true;
    var tween = 0;

    // A stage with no size (hidden, not laid out yet) is treated as the
    // diagram's own size, so nothing divides by zero.
    function size() {
      var r = stage.getBoundingClientRect();
      return { w: r.width > 0 ? r.width : W, h: r.height > 0 ? r.height : H };
    }
    function fitScale(sz) {
      var s = Math.min(sz.w / (W + 2 * FIT_MARGIN), sz.h / (H + 2 * FIT_MARGIN));
      return s > 0 && isFinite(s) ? Math.min(s, MAX_FIT_SCALE) : 1;
    }
    function fitCamera() { return { cx: W / 2, cy: H / 2, s: fitScale(size()) }; }

    function apply() {
      var sz = size();
      var w = sz.w / cam.s;
      var h = sz.h / cam.s;
      svg.setAttribute('viewBox', [cam.cx - w / 2, cam.cy - h / 2, w, h].map(round).join(' '));
      stage.setAttribute('data-zoom', (cam.s / fitScale(sz)).toFixed(3));
      if (hooks.onApply) hooks.onApply();
    }
    function cancelTween() {
      if (tween && global.cancelAnimationFrame) global.cancelAnimationFrame(tween);
      tween = 0;
    }
    // Glide to `target` over options.ms (CAMERA_MS by default); at once when
    // options.instant is set, under reduced motion, or without requestAnimationFrame.
    function moveTo(target, options) {
      options = options || {};
      cancelTween();
      var to = { cx: finite(target.cx, cam.cx), cy: finite(target.cy, cam.cy), s: finite(target.s, cam.s) };
      if (options.instant || reduced() || !global.requestAnimationFrame) { cam = to; apply(); return; }
      var ms = Math.max(1, finite(options.ms, CAMERA_MS));
      var from = { cx: cam.cx, cy: cam.cy, s: cam.s };
      var t0 = null;
      var tick = function (now) {
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        var e = 1 - Math.pow(1 - k, 3); // ease-out
        cam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: from.s * Math.pow(to.s / from.s, e) };
        apply();
        tween = k < 1 ? global.requestAnimationFrame(tick) : 0;
      };
      tween = global.requestAnimationFrame(tick);
    }

    function fit() { fitted = true; moveTo(fitCamera()); }
    // The fit view at once, no glide (first paint, and a resize of a fitted view).
    function refit() { fitted = true; cam = fitCamera(); apply(); }
    function zoomAt(factor, px, py) {
      cancelTween();
      fitted = false;
      var sz = size();
      var fs = fitScale(sz);
      var ns = clamp(cam.s * factor, fs * MIN_ZOOM, fs * MAX_ZOOM);
      var wx = cam.cx + (px - sz.w / 2) / cam.s;
      var wy = cam.cy + (py - sz.h / 2) / cam.s;
      cam = { cx: clamp(wx - (px - sz.w / 2) / ns, 0, W), cy: clamp(wy - (py - sz.h / 2) / ns, 0, H), s: ns };
      apply();
    }
    function zoomBy(factor) { var sz = size(); zoomAt(factor, sz.w / 2, sz.h / 2); }
    function panBy(dx, dy) {
      cancelTween();
      fitted = false;
      cam = { cx: clamp(cam.cx + dx / cam.s, 0, W), cy: clamp(cam.cy + dy / cam.s, 0, H), s: cam.s };
      apply();
    }

    // The union of the boxes of `ids` as { x, y, w, h }, or null when none has a box.
    function boxOf(ids) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      (ids || []).forEach(function (id) {
        var b = boxes[id];
        if (!b || !b.every(function (v) { return isFinite(v); })) return;
        x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]);
        x1 = Math.max(x1, b[0] + b[2]); y1 = Math.max(y1, b[1] + b[3]);
      });
      return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
    function unionBox(a, b) {
      if (!a) return b;
      var x0 = Math.min(a.x, b.x);
      var y0 = Math.min(a.y, b.y);
      return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    }
    // Camera showing `box` with FOCUS_PAD around it. A box of zero width or height
    // (one message line, a lone dot) still has the padding, so the scale is finite.
    function cameraFor(box) {
      if (!box) return fitCamera();
      var sz = size();
      var fs = fitScale(sz);
      var s = Math.min(sz.w / (box.w + 2 * FOCUS_PAD), sz.h / (box.h + 2 * FOCUS_PAD));
      s = clamp(isFinite(s) && s > 0 ? s : fs, fs * MIN_ZOOM, Math.max(fs * MIN_ZOOM, Math.min(fs * MAX_FOCUS_ZOOM, MAX_FOCUS_SCALE)));
      return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, s: s };
    }
    // Keyboard focus on a node scrolled out of view brings it to the middle.
    function ensureVisible(id) {
      var b = boxes[id];
      if (!b) return;
      var sz = size();
      var halfW = sz.w / cam.s / 2;
      var halfH = sz.h / cam.s / 2;
      var inside = b[0] >= cam.cx - halfW && b[0] + b[2] <= cam.cx + halfW && b[1] >= cam.cy - halfH && b[1] + b[3] <= cam.cy + halfH;
      if (!inside) { fitted = false; moveTo({ cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2, s: cam.s }, { instant: true }); }
    }
    // On a resize a fitted view refits; any other view keeps its camera.
    function onResize() {
      if (fitted) cam = fitCamera();
      apply();
    }

    return {
      size: size, fitScale: fitScale, fitCamera: fitCamera, apply: apply, moveTo: moveTo, cancelTween: cancelTween,
      fit: fit, refit: refit, zoomAt: zoomAt, zoomBy: zoomBy, panBy: panBy,
      boxOf: boxOf, unionBox: unionBox, cameraFor: cameraFor, ensureVisible: ensureVisible,
      reduced: reduced, reduceQuery: reduceQuery,
      zoom: function () { return cam.s / fitScale(size()); },
      isFitted: function () { return fitted; },
      unfit: function () { fitted = false; },
      onResize: onResize,
      glideMs: function () { return CAMERA_MS; },
    };
  };
})(window);
