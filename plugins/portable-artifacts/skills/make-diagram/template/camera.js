// make-diagram viewer, camera: zoom, pan, fit and the glide between views for
// one diagram <svg>. The camera is a centre in diagram units and a scale in px
// per unit; the viewBox is derived from it and the stage size. Registered as
// PADiagram.camera and composed by viewer.js. This file comes first in the
// bundle (scripts/lib/runtime.mjs), so it also defines PADiagram.dict.
//
//   var camera = PADiagram.camera(stage, svg, data, { onApply });
//
// onApply runs after every viewBox change (viewer.js emits its state from it).
//
// Fit: a page that shows its own legend over the stage (an element with
// data-pa-legend inside it; the drawn legend is hidden there) fits the drawing
// (data.drawing, the canvas without the legend band and the widening for a wide
// legend row) into the stage below that overlay. Any other stage fits the whole canvas.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 4;
  var MAX_FIT_SCALE = 1.25; // a small diagram is not blown up past this to fill a big stage
  var FIT_MARGIN = 16;
  // On a phone (a viewport inside viewer.html's 719 px breakpoint) the opening view never draws a 14 px node label
  // below the 8 px reading floor (legibility.mjs LABEL_PX and MIN_LABEL_PX): a diagram too big for that opens at the
  // floor (axisFloor places it) and pans; the Fit button still shows the whole drawing. Wider viewports open fitted
  // whole, whatever the text size (scripts/check.mjs warns when that draws labels under the floor).
  var PHONE_QUERY = '(max-width: 719px)';
  var READ_SCALE = 8 / 14;
  var FLOOR_GAP = 16; // px: at the floor a node in view sits at least this far inside the stage
  var OUT_PX = 4; // px: a node out of view sits at least this far past the edge (its outline and lift included)
  var CUE_STEP = 0.75; // a pan cue moves the view this share of the stage
  var FOCUS_PAD = 48;
  var MAX_FOCUS_SCALE = 1.6; // px per diagram unit when a beat zooms in on a few nodes
  var MAX_FOCUS_ZOOM = 2; // and never past this multiple of the fit, unless the fit is tiny: a beat may always reach 100%
  var MIN_FOCUS_CAP = 1; // so on a narrow stage a hop is readable when its box fits at 100%
  var CAMERA_MS = 300;

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };
  var round = function (v) { return Math.round(v * 100) / 100; };
  var easeOut = function (k) { return 1 - Math.pow(1 - k, 3); }; // Fit, Home, a pan cue: quick to respond
  var easeInOut = function (k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }; // a story beat: calm at both ends

  // Ids are model-provided keys: every id-keyed map has no prototype, so an id
  // like "constructor" is just a key (a plain {} would answer for it).
  PADiagram.dict = function (source) {
    var d = Object.create(null);
    Object.keys(source || {}).forEach(function (k) { d[k] = source[k]; });
    return d;
  };

  var toBox = function (b) { return { x: b[0], y: b[1], w: b[2], h: b[3] }; };
  // What the floor view places: every box drawn (`all`), the node boxes (no group, no edge or message), the first
  // group and the first node in the spec's order (data.info), each { x, y, w, h }; null when there is none.
  function contentOf(boxes, info, fallback) {
    var ids = Object.keys(info || boxes).filter(function (id) { return boxes[id] && boxes[id].every(function (v) { return isFinite(v); }); });
    var isGroup = function (id) { return !!info && !!info[id] && info[id].kind === 'group'; };
    var isNode = function (id) { return !isGroup(id) && !(info && info[id] && info[id].style); };
    var all = null;
    Object.keys(boxes).forEach(function (id) {
      var b = boxes[id];
      if (!b.every(function (v) { return isFinite(v); })) return;
      all = all ? { x: Math.min(all.x, b[0]), y: Math.min(all.y, b[1]), r: Math.max(all.r, b[0] + b[2]), b: Math.max(all.b, b[1] + b[3]) } : { x: b[0], y: b[1], r: b[0] + b[2], b: b[1] + b[3] };
    });
    var group = ids.filter(isGroup)[0];
    var first = ids.filter(isNode)[0];
    return {
      all: all ? { x: all.x, y: all.y, w: all.r - all.x, h: all.b - all.y } : fallback,
      nodes: ids.filter(isNode).map(function (id) { return toBox(boxes[id]); }),
      group: group ? toBox(boxes[group]) : null,
      first: first ? toBox(boxes[first]) : null,
    };
  }

  PADiagram.camera = function (stage, svg, data, hooks) {
    hooks = hooks || {};
    var W = Math.max(1, finite(data.width, 1));
    var H = Math.max(1, finite(data.height, 1));
    var boxes = PADiagram.dict(data.boxes);
    var reduceQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = function () { return !!(reduceQuery && reduceQuery.matches); };
    var phoneQuery = global.matchMedia ? global.matchMedia(PHONE_QUERY) : null;
    var phone = function () { return !!(phoneQuery && phoneQuery.matches); };
    var overlay = stage.querySelector('[data-pa-legend]');
    var d = data.drawing;
    // What the fit shows: the drawing when the page covers the drawn legend with its own, else the canvas.
    var fitBox = overlay && d && d.length === 4 && d.every(function (v) { return finite(v, NaN) === v; }) && d[2] > 0 && d[3] > 0 ? { x: d[0], y: d[1], w: d[2], h: d[3] } : { x: 0, y: 0, w: W, h: H };
    var content = contentOf(boxes, data.info, fitBox);
    var cam = { cx: W / 2, cy: H / 2, s: 1 };
    var fitted = true;
    var whole = false; // the fitted view is the whole drawing (Fit) rather than the opening view
    var tween = 0;

    // A stage with no size (hidden, not laid out yet) is treated as the
    // diagram's own size, so nothing divides by zero. `top` is how far the
    // legend overlay reaches down the stage and `right` how far it reaches in
    // from the right edge (both 0 when it is absent or hidden): the fit keeps
    // the drawing below it or beside it.
    function size() {
      var r = stage.getBoundingClientRect();
      var o = overlay ? overlay.getBoundingClientRect() : null;
      var shown = r.height > 0 && r.width > 0 && o && o.height > 0;
      var top = shown ? Math.min(r.height - 1, Math.max(0, Math.ceil(o.bottom - r.top))) : 0;
      var right = shown ? Math.min(r.width - 1, Math.max(0, Math.ceil(r.right - o.left))) : 0;
      return { w: r.width > 0 ? r.width : W, h: r.height > 0 ? r.height : H, top: top, right: right };
    }
    function scaleIn(w, h) {
      var s = Math.min(w / (fitBox.w + 2 * FIT_MARGIN), h / (fitBox.h + 2 * FIT_MARGIN));
      return s > 0 && isFinite(s) ? Math.min(s, MAX_FIT_SCALE) : 1;
    }
    // The overlay holds only the top-right corner, so the drawing fits either in
    // the band below it or the column beside it, whichever draws it larger (below
    // on a tie). dx and dy are how many screen px the centred drawing must move
    // (left, or down) to clear the overlay: 0 when centring already clears it.
    function fitPlace(sz) {
      var below = scaleIn(sz.w, sz.h - sz.top);
      var beside = sz.right ? scaleIn(sz.w - sz.right, sz.h) : 0;
      if (beside > below) {
        var halfW = (fitBox.w / 2 + FIT_MARGIN) * beside;
        return { s: beside, dx: Math.max(0, sz.w / 2 + halfW - (sz.w - sz.right)), dy: 0 };
      }
      var halfH = (fitBox.h / 2 + FIT_MARGIN) * below;
      return { s: below, dx: 0, dy: Math.max(0, sz.top - (sz.h / 2 - halfH)) };
    }
    // ---- the reading floor ------------------------------------------------------------------
    // On a phone a fit below READ_SCALE opens at READ_SCALE instead. On each axis: when everything drawn fits the stage at that
    // scale (FLOOR_GAP to spare on both sides) it is centred; else the view centres on the anchor (the first group
    // when it fits the stage, else the first node), stays within what is drawn, and then moves the least it must so
    // that no node is cut by the stage edge (each is whole in view, FLOOR_GAP in, or wholly out, behind a pan cue).
    // Centring and the anchor use the band past `lead` px (the legend overlay's depth on the y axis); the cut test uses
    // the whole stage length `len`, where a node beside the overlay still shows. Returns the camera centre on the axis.
    function axisFloor(len, lead, s, extent, anchor, spans) {
      var band = len - lead;
      var toFull = lead / (2 * s); // band centre minus this is the stage centre
      if ((extent[1] - extent[0]) * s + 2 * FLOOR_GAP <= band) return (extent[0] + extent[1]) / 2 - toFull;
      var half = band / (2 * s);
      var c = clamp((anchor[0] + anchor[1]) / 2, extent[0] - FLOOR_GAP / s + half, extent[1] + FLOOR_GAP / s - half) - toFull;
      var start = c - len / (2 * s); // the stage's first diagram unit on this axis
      var px = spans.map(function (sp) { return [(sp[0] - start) * s, (sp[1] - start) * s]; });
      var keep = [(anchor[0] - start) * s, (anchor[1] - start) * s];
      var ok = function (d) {
        var anchored = keep[1] - keep[0] > band - 2 * FLOOR_GAP || (keep[0] + d >= lead && keep[1] + d <= len);
        return anchored && px.every(function (p) { var a = p[0] + d, b = p[1] + d; return b <= -OUT_PX || a >= len + OUT_PX || (a >= FLOOR_GAP && b <= len - FLOOR_GAP); });
      };
      var shifts = [0];
      px.forEach(function (p) { shifts.push(FLOOR_GAP - p[0], len - FLOOR_GAP - p[1], -OUT_PX - p[1], len + OUT_PX - p[0]); });
      shifts.sort(function (a, b) { return Math.abs(a) - Math.abs(b); });
      for (var i = 0; i < shifts.length; i++) if (ok(shifts[i])) return c - shifts[i] / s;
      return c;
    }
    function readable(sz) {
      if (!phone() || fitPlace(sz).s >= READ_SCALE) return null;
      var s = READ_SCALE;
      var band = sz.h - sz.top;
      var fitsStage = function (b) { return b.w * s <= sz.w - 2 * FLOOR_GAP && b.h * s <= band - 2 * FLOOR_GAP; };
      var anchor = content.group && fitsStage(content.group) ? content.group : content.first || content.all;
      var x = axisFloor(sz.w, 0, s, [content.all.x, content.all.x + content.all.w], [anchor.x, anchor.x + anchor.w], content.nodes.map(function (b) { return [b.x, b.x + b.w]; }));
      var y = axisFloor(sz.h, sz.top, s, [content.all.y, content.all.y + content.all.h], [anchor.y, anchor.y + anchor.h], content.nodes.map(function (b) { return [b.y, b.y + b.h]; }));
      return { s: s, cx: x, cy: y };
    }
    function fitScale(sz) { var r = readable(sz); return r ? r.s : fitPlace(sz).s; }
    // The whole drawing, readable or not (the Fit button, double-click, 0, and a beat that frames everything).
    function wholeCamera() {
      var p = fitPlace(size());
      return { cx: fitBox.x + fitBox.w / 2 + p.dx / p.s, cy: fitBox.y + fitBox.h / 2 - p.dy / p.s, s: p.s };
    }
    // The opening view: the whole drawing, or on a phone the floor view when that would draw labels under the floor.
    function fitCamera() { return readable(size()) || wholeCamera(); }
    // Pan and zoom keep the centre on the canvas, widened to take in the fit
    // centre, so the first move after a fit never snaps the view.
    function clampCentre(cx, cy) {
      var f = fitCamera();
      return { cx: clamp(cx, Math.min(0, f.cx), Math.max(W, f.cx)), cy: clamp(cy, Math.min(0, f.cy), Math.max(H, f.cy)) };
    }

    function apply() {
      var sz = size();
      var w = sz.w / cam.s;
      var h = sz.h / cam.s;
      svg.setAttribute('viewBox', [cam.cx - w / 2, cam.cy - h / 2, w, h].map(round).join(' '));
      stage.setAttribute('data-zoom', (cam.s / fitScale(sz)).toFixed(3));
      stage.setAttribute('data-fit-scale', fitPlace(sz).s.toFixed(4)); // the whole-drawing fit, read by scripts/check.mjs
      showCues(sz);
      if (hooks.onApply) hooks.onApply();
    }

    // ---- pan cues -------------------------------------------------------------------------
    // A button on each stage edge (viewer.html, [data-pa-cue]) shows while a node lies wholly past that edge (one cut
    // by the edge shows itself); pressing it glides the view CUE_STEP of the stage that way. Its presses never reach
    // the stage (no drag, no deselect).
    var cues = {};
    (stage.querySelectorAll ? Array.prototype.slice.call(stage.querySelectorAll('[data-pa-cue]')) : []).forEach(function (b) {
      var side = b.getAttribute('data-pa-cue');
      cues[side] = b;
      ['pointerdown', 'pointerup', 'dblclick'].forEach(function (t) { b.addEventListener(t, function (e) { e.stopPropagation(); }); });
      b.addEventListener('click', function (e) { e.stopPropagation(); cueTo(side); });
    });
    var CUE_SIDES = {
      left: function (b, v) { return b.x + b.w <= v.x0; }, right: function (b, v) { return b.x >= v.x1; },
      top: function (b, v) { return b.y + b.h <= v.y0; }, bottom: function (b, v) { return b.y >= v.y1; },
    };
    function showCues(sz) {
      var v = { x0: cam.cx - sz.w / (2 * cam.s), x1: cam.cx + sz.w / (2 * cam.s), y0: cam.cy - sz.h / (2 * cam.s), y1: cam.cy + sz.h / (2 * cam.s) };
      Object.keys(cues).forEach(function (side) {
        var more = !!CUE_SIDES[side] && content.nodes.some(function (b) { return CUE_SIDES[side](b, v); });
        if (cues[side].hidden === more) cues[side].hidden = !more;
      });
    }
    function cueTo(side) {
      var sz = size();
      var dx = side === 'left' ? -1 : side === 'right' ? 1 : 0;
      var dy = side === 'top' ? -1 : side === 'bottom' ? 1 : 0;
      fitted = false;
      var c = clampCentre(cam.cx + dx * CUE_STEP * sz.w / cam.s, cam.cy + dy * CUE_STEP * sz.h / cam.s);
      moveTo({ cx: c.cx, cy: c.cy, s: cam.s });
    }
    function cancelTween() {
      if (tween && global.cancelAnimationFrame) global.cancelAnimationFrame(tween);
      tween = 0;
    }
    // Glide to `target` over options.ms (CAMERA_MS by default), ease-out unless options.ease is 'in-out'
    // (a story beat: the camera eases in as well as out); at once when options.instant is set, under
    // reduced motion, or without requestAnimationFrame.
    function moveTo(target, options) {
      options = options || {};
      cancelTween();
      var to = { cx: finite(target.cx, cam.cx), cy: finite(target.cy, cam.cy), s: finite(target.s, cam.s) };
      if (options.instant || reduced() || !global.requestAnimationFrame) { cam = to; apply(); return; }
      var ms = Math.max(1, finite(options.ms, CAMERA_MS));
      var ease = options.ease === 'in-out' ? easeInOut : easeOut;
      var from = { cx: cam.cx, cy: cam.cy, s: cam.s };
      var t0 = null;
      var tick = function (now) {
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        var e = ease(k);
        cam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: from.s * Math.pow(to.s / from.s, e) };
        apply();
        tween = k < 1 ? global.requestAnimationFrame(tick) : 0;
      };
      tween = global.requestAnimationFrame(tick);
    }

    function fit() { fitted = true; whole = true; moveTo(wholeCamera()); }
    // Back to the opening view with a glide (leaving Play, clearing Explore): readable, unlike Fit.
    function home() { fitted = true; whole = false; moveTo(fitCamera()); }
    // The opening view at once, no glide (first paint, and a resize of an untouched view).
    function refit() { fitted = true; whole = false; cam = fitCamera(); apply(); }
    function zoomAt(factor, px, py) {
      cancelTween();
      fitted = false;
      var sz = size();
      var fs = fitScale(sz);
      var ns = clamp(cam.s * factor, Math.min(fs, fitPlace(sz).s) * MIN_ZOOM, fs * MAX_ZOOM);
      var wx = cam.cx + (px - sz.w / 2) / cam.s;
      var wy = cam.cy + (py - sz.h / 2) / cam.s;
      var c = clampCentre(wx - (px - sz.w / 2) / ns, wy - (py - sz.h / 2) / ns);
      cam = { cx: c.cx, cy: c.cy, s: ns };
      apply();
    }
    function zoomBy(factor) { var sz = size(); zoomAt(factor, sz.w / 2, sz.h / 2); }
    function panBy(dx, dy) {
      cancelTween();
      fitted = false;
      var c = clampCentre(cam.cx + dx / cam.s, cam.cy + dy / cam.s);
      cam = { cx: c.cx, cy: c.cy, s: cam.s };
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
      s = clamp(isFinite(s) && s > 0 ? s : fs, fs * MIN_ZOOM, Math.max(fs * MIN_ZOOM, Math.min(Math.max(fs * MAX_FOCUS_ZOOM, MIN_FOCUS_CAP), MAX_FOCUS_SCALE)));
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
    // Runs `change` (it opens or closes the side panel, so the stage changes size) and keeps every diagram
    // point where it was drawn (the stage keeps its left and top edges, so the centre moves with half of the
    // size change). The view is no longer fitted, so the resize that follows does not refit and rescale the
    // drawing under the pointer.
    function holdView(change) {
      var before = size();
      change();
      var after = size();
      if (before.w !== after.w || before.h !== after.h) panBy((after.w - before.w) / 2, (after.h - before.h) / 2);
    }
    // On a resize a fitted view refits (the whole drawing or the opening view, whichever it was); any other view keeps its camera.
    function onResize() {
      if (fitted) cam = whole ? wholeCamera() : fitCamera();
      apply();
    }

    return {
      size: size, fitScale: fitScale, fitCamera: fitCamera, wholeCamera: wholeCamera, apply: apply, moveTo: moveTo, cancelTween: cancelTween,
      fit: fit, home: home, refit: refit, zoomAt: zoomAt, zoomBy: zoomBy, panBy: panBy,
      boxOf: boxOf, unionBox: unionBox, cameraFor: cameraFor, ensureVisible: ensureVisible,
      reduced: reduced, reduceQuery: reduceQuery,
      zoom: function () { return cam.s / fitScale(size()); },
      isFitted: function () { return fitted; },
      unfit: function () { fitted = false; whole = false; },
      onResize: onResize, holdView: holdView,
    };
  };
})(window);
