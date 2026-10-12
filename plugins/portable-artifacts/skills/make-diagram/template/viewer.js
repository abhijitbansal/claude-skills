// make-diagram viewer core: zoom, pan, fit, hover trace, presentation and edge
// animation for one rendered diagram. No toolbar or page chrome in here: the
// page's own script (toolbar.js) and make-explainer drive it through the
// controller that PADiagram.mount returns.
//
//   const ctl = PADiagram.mount(stageElement, data, { keys, caption, onChange });
//
// stageElement  holds the diagram <svg> (from buildDiagram) and sizes it.
// data          buildDiagram(spec).data: { type, title, stem, animate, width, height, steps, ids,
//               adjacency, edges, parents, boxes, frames } (scripts/lib/data.mjs); nothing is fetched.
// keys          element that receives the keyboard shortcuts (default: stageElement).
// caption       element with [data-pa-title] [data-pa-note] [data-pa-count] [data-pa-prev]
//               [data-pa-next] [data-pa-exit] children; every one is optional.
// onChange      called with ctl.state() after any change.
//
// Every state class (pa-dim, pa-on, pa-hl, pa-hidden, pa-animate) is styled by
// diagramCss(); this file only toggles them.
(function (global) {
  'use strict';

  var MIN_ZOOM = 0.25;
  var MAX_ZOOM = 4;
  var MAX_FIT_SCALE = 1.25; // a small diagram is not blown up past this to fill a big stage
  var FIT_MARGIN = 16;
  var FOCUS_PAD = 48;
  var MAX_FOCUS_SCALE = 1.6; // px per diagram unit when a step zooms in on a few nodes
  var MAX_FOCUS_ZOOM = 2; // and never past this multiple of the fit
  var DOUBLE_CLICK_MS = 300; // a second click this soon after one that stepped is part of a double click
  var CAMERA_MS = 300;
  var DRAG_PX = 4;
  var PAN_PX = 80;
  var KEY_ZOOM = 1.25;

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };
  var round = function (v) { return Math.round(v * 100) / 100; };

  function mount(stage, data, options) {
    options = options || {};
    var svg = stage.querySelector('svg');
    if (!svg) return null;
    var W = Math.max(1, finite(data.width, 1));
    var H = Math.max(1, finite(data.height, 1));
    var steps = data.steps || [];
    var adjacency = data.adjacency || {};
    var edgeEnds = data.edges || {};
    var parents = data.parents || {};
    var boxes = data.boxes || {};
    var isSequence = data.type === 'sequence';
    var reduceQuery = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = function () { return !!(reduceQuery && reduceQuery.matches); };

    // ---- elements, by id -----------------------------------------------------
    var nodes = {};
    var groups = {};
    var edges = {};
    var labels = {};
    svg.querySelectorAll('.pa-node[data-id]').forEach(function (el) { nodes[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-group[data-id]').forEach(function (el) { groups[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge[data-id]').forEach(function (el) { edges[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge-label[data-edge]').forEach(function (el) { labels[el.getAttribute('data-edge')] = el; });
    var lifelines = Array.prototype.slice.call(svg.querySelectorAll('.pa-lifeline[data-for]'));
    var frames = Array.prototype.slice.call(svg.querySelectorAll('.pa-frame[data-messages]'));
    var frameData = data.frames || [];
    var notes = Array.prototype.slice.call(svg.querySelectorAll('.pa-seq-note[data-over]'));
    var words = function (el, name) { var v = el.getAttribute(name); return v ? v.split(' ') : []; };

    // ---- camera ----------------------------------------------------------------
    // The camera is a centre in diagram units and a scale in px per unit; the
    // viewBox is derived from it and the stage size. A stage with no size (hidden,
    // not laid out yet) is treated as the diagram's own size, so nothing divides by zero.
    var cam = { cx: W / 2, cy: H / 2, s: 1 };
    var fitted = true;
    var tween = 0;

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
      emit();
    }
    function cancelTween() {
      if (tween && global.cancelAnimationFrame) global.cancelAnimationFrame(tween);
      tween = 0;
    }
    function moveTo(target, instant) {
      cancelTween();
      var to = { cx: finite(target.cx, cam.cx), cy: finite(target.cy, cam.cy), s: finite(target.s, cam.s) };
      if (instant || reduced() || !global.requestAnimationFrame) { cam = to; apply(); return; }
      var from = { cx: cam.cx, cy: cam.cy, s: cam.s };
      var t0 = null;
      var tick = function (now) {
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / CAMERA_MS);
        var e = 1 - Math.pow(1 - k, 3); // ease-out
        cam = { cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, s: from.s * Math.pow(to.s / from.s, e) };
        apply();
        tween = k < 1 ? global.requestAnimationFrame(tick) : 0;
      };
      tween = global.requestAnimationFrame(tick);
    }

    function fit() { fitted = true; moveTo(fitCamera()); }
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

    // The union of the boxes of `ids` as [x, y, w, h], or null when none has a box.
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
      if (!b || presenting) return;
      var sz = size();
      var halfW = sz.w / cam.s / 2;
      var halfH = sz.h / cam.s / 2;
      var inside = b[0] >= cam.cx - halfW && b[0] + b[2] <= cam.cx + halfW && b[1] >= cam.cy - halfH && b[1] + b[3] <= cam.cy + halfH;
      if (!inside) { fitted = false; moveTo({ cx: b[0] + b[2] / 2, cy: b[1] + b[3] / 2, s: cam.s }, true); }
    }

    // ---- trace: hover, focus, pin ---------------------------------------------------
    var hoverId = null;
    var focusId = null;
    var pinId = null;
    var traced = []; // elements carrying pa-dim / pa-on, to reset cheaply

    function relation(id) {
      if (edgeEnds[id]) return { nodes: edgeEnds[id].slice(), edges: [id], on: [] };
      var a = adjacency[id] || { nodes: [], edges: [] };
      return { nodes: [id].concat(a.nodes), edges: a.edges, on: [id] };
    }
    function paint(el, dim, on) {
      el.classList.toggle('pa-dim', dim);
      el.classList.toggle('pa-on', on);
      traced.push(el);
    }
    function refreshTrace() {
      traced.forEach(function (el) { el.classList.remove('pa-dim', 'pa-on'); });
      traced = [];
      var id = pinId || hoverId || focusId;
      svg.classList.toggle('pa-tracing', !!id);
      if (!id) return;
      var rel = relation(id);
      Object.keys(nodes).forEach(function (n) { paint(nodes[n], rel.nodes.indexOf(n) < 0, rel.on.indexOf(n) >= 0); });
      Object.keys(edges).forEach(function (e) {
        var incident = rel.edges.indexOf(e) >= 0;
        paint(edges[e], !incident, incident);
        if (labels[e]) paint(labels[e], !incident, false);
      });
    }
    function idAt(target) {
      var el = target && target.closest ? target.closest('.pa-node,.pa-edge,.pa-edge-label') : null;
      if (!el) return null;
      return el.getAttribute('data-id') || el.getAttribute('data-edge');
    }

    // ---- presentation ------------------------------------------------------------------
    var presenting = false;
    var stepIndex = 0;

    // What the steps up to `n` reveal: their show, focus and highlight ids, each node's
    // ancestor groups, and the participants of a revealed message. (scripts/lib/steps.mjs
    // applies the same rules when it builds the closing "Everything" step.)
    function revealedThrough(n) {
      var seen = {};
      var add = function (id) {
        for (var at = id; at !== undefined && !seen[at]; at = parents[at]) seen[at] = true;
      };
      for (var i = 0; i <= n; i++) {
        var s = steps[i];
        [].concat(s.show || [], s.focus || [], s.highlight || []).forEach(add);
      }
      Object.keys(edgeEnds).forEach(function (e) {
        if (isSequence && seen[e]) { add(edgeEnds[e][0]); add(edgeEnds[e][1]); }
      });
      return seen;
    }
    function applyReveal() {
      var seen = revealedThrough(stepIndex);
      var step = steps[stepIndex];
      var hide = function (el, hidden) { if (el) el.classList.toggle('pa-hidden', hidden); };
      Object.keys(nodes).forEach(function (id) { hide(nodes[id], !seen[id]); });
      Object.keys(groups).forEach(function (id) { hide(groups[id], !seen[id]); });
      Object.keys(edges).forEach(function (id) {
        var ends = edgeEnds[id] || [];
        var shown = isSequence ? !!seen[id] : !!seen[ends[0]] && !!seen[ends[1]];
        hide(edges[id], !shown);
        hide(labels[id], !shown);
      });
      lifelines.forEach(function (el) { hide(el, !seen[el.getAttribute('data-for')]); });
      frames.forEach(function (el) { hide(el, !words(el, 'data-messages').some(function (m) { return seen[m]; })); });
      notes.forEach(function (el) {
        var after = el.getAttribute('data-after');
        hide(el, after ? !seen[after] : !words(el, 'data-over').every(function (p) { return seen[p]; }));
      });
      var hl = {};
      (step.highlight || []).forEach(function (id) { hl[id] = true; });
      [nodes, groups, edges, labels].forEach(function (group) {
        Object.keys(group).forEach(function (id) { group[id].classList.toggle('pa-hl', !!hl[id]); });
      });
      return seen;
    }
    function clearReveal() {
      svg.querySelectorAll('.pa-hidden,.pa-hl').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-hl'); });
    }
    // A step with no focus fits what it shows. In a sequence that also keeps the
    // headers of every shown message's participants and the frames around the
    // messages in view, so the reader still knows who is talking.
    function defaultFocus(step) {
      var ids = (step.show || []).slice();
      if (!isSequence) return { ids: ids, boxes: [] };
      var framed = [];
      (step.show || []).forEach(function (id) {
        if (edgeEnds[id]) ids.push(edgeEnds[id][0], edgeEnds[id][1]);
        frameData.forEach(function (f) { if (f.messages.indexOf(id) >= 0) framed.push(f.box); });
      });
      return { ids: ids, boxes: framed };
    }
    function stepFocusBox(seen) {
      var step = steps[stepIndex];
      var box;
      if (step.focus && step.focus.length) box = boxOf(step.focus);
      else {
        var d = defaultFocus(step);
        box = boxOf(d.ids);
        d.boxes.forEach(function (b) { box = unionBox(box, { x: b[0], y: b[1], w: b[2], h: b[3] }); });
      }
      if (!box) box = boxOf(step.highlight);
      return box || boxOf(Object.keys(seen));
    }
    // A step that frames every id (the closing "Everything" step) shows the whole
    // diagram, which is the fit camera, not a padded focus box.
    function framesEverything(step) {
      var named = step.focus && step.focus.length ? step.focus : (step.show || []);
      var all = data.ids || [];
      return all.length > 0 && all.every(function (id) { return named.indexOf(id) >= 0; });
    }
    var caption = options.caption || null;
    var part = function (name) { return caption ? caption.querySelector('[' + name + ']') : null; };
    function paintCaption() {
      if (!caption) return;
      caption.hidden = !presenting;
      if (!presenting) return;
      var step = steps[stepIndex];
      var title = part('data-pa-title');
      var note = part('data-pa-note');
      var count = part('data-pa-count');
      var prev = part('data-pa-prev');
      var next = part('data-pa-next');
      if (title) title.textContent = step.title || '';
      if (note) { note.textContent = step.note || ''; note.hidden = !step.note; }
      if (count) count.textContent = (stepIndex + 1) + ' / ' + steps.length;
      if (prev) prev.disabled = stepIndex === 0;
      if (next) next.disabled = stepIndex === steps.length - 1;
    }
    function goTo(i) {
      if (!steps.length) return;
      presenting = true;
      stepIndex = clamp(Math.round(finite(i, 0)), 0, steps.length - 1);
      stage.classList.add('pa-presenting');
      var seen = applyReveal();
      paintCaption();
      fitted = false;
      refreshTrace();
      emit();
      moveTo(framesEverything(steps[stepIndex]) ? fitCamera() : cameraFor(stepFocusBox(seen)));
    }
    function present(i) { goTo(i || 0); }
    function next() { if (presenting) goTo(stepIndex + 1); }
    function prev() { if (presenting) goTo(stepIndex - 1); }
    function exit() {
      if (!presenting) return;
      presenting = false;
      stage.classList.remove('pa-presenting');
      clearReveal();
      paintCaption();
      emit();
      fit();
    }
    function togglePresent() { if (presenting) exit(); else present(0); }

    // ---- animation ----------------------------------------------------------------------
    var animateOn = !!data.animate && !reduced();
    function syncAnimate() {
      if (reduced()) animateOn = false;
      svg.classList.toggle('pa-animate', animateOn);
    }
    function setAnimate(on) { animateOn = !!on && !reduced(); syncAnimate(); emit(); }
    function toggleAnimate() { setAnimate(!animateOn); }
    if (reduceQuery) {
      var onMotion = function () { syncAnimate(); emit(); };
      if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onMotion); else reduceQuery.addListener(onMotion);
    }

    // ---- state -----------------------------------------------------------------------------
    function state() {
      return {
        zoom: cam.s / fitScale(size()),
        presenting: presenting,
        step: stepIndex,
        steps: steps.length,
        animate: animateOn,
        reducedMotion: reduced(),
        pinned: pinId,
      };
    }
    function emit() { if (options.onChange) options.onChange(state()); }

    // ---- pointer: pan, pinch, click, hover ------------------------------------------------
    var pointers = {};
    var dragging = false;
    var downAt = null;
    var downTarget = null;
    var lastPinch = 0;

    function pointerCount() { return Object.keys(pointers).length; }
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pointerCount() === 1) { downAt = { x: e.clientX, y: e.clientY }; downTarget = e.target; dragging = false; }
      lastPinch = 0;
    });
    stage.addEventListener('pointermove', function (e) {
      var p = pointers[e.pointerId];
      if (!p) return;
      var dx = e.clientX - p.x;
      var dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointerCount() === 2) {
        var ids = Object.keys(pointers);
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dist = Math.hypot(a.x - b.x, a.y - b.y);
        var r = stage.getBoundingClientRect();
        if (lastPinch > 0 && dist > 0) zoomAt(dist / lastPinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        lastPinch = dist;
        dragging = true;
        return;
      }
      if (!dragging && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_PX) {
        dragging = true;
        stage.classList.add('pa-grabbing');
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer: no capture */ }
        hoverId = null;
        refreshTrace();
      }
      if (dragging) panBy(-dx, -dy);
    });
    function release(e, cancelled) {
      if (!pointers[e.pointerId]) return;
      delete pointers[e.pointerId];
      if (pointerCount() > 0) return;
      var wasDrag = dragging;
      dragging = false;
      stage.classList.remove('pa-grabbing');
      if (!wasDrag && !cancelled) click(downTarget);
      downAt = null;
      downTarget = null;
    }
    stage.addEventListener('pointerup', function (e) { release(e, false); });
    stage.addEventListener('pointercancel', function (e) { release(e, true); });

    var lastStepClick = 0;
    function click(target) {
      if (presenting) {
        var now = Date.now();
        if (now - lastStepClick < DOUBLE_CLICK_MS) return; // the second click of a double click
        lastStepClick = now;
        next();
        return;
      }
      var id = idAt(target);
      pinId = id && id !== pinId ? id : null;
      refreshTrace();
      emit();
    }
    stage.addEventListener('dblclick', function () { if (!presenting) fit(); });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('pointerover', function (e) {
      if (dragging) return;
      var id = idAt(e.target);
      if (id === hoverId) return;
      hoverId = id;
      refreshTrace();
    });
    svg.addEventListener('pointerleave', function () { if (hoverId) { hoverId = null; refreshTrace(); } });
    svg.addEventListener('focusin', function (e) {
      var id = idAt(e.target);
      if (!id) return;
      focusId = id;
      ensureVisible(id);
      refreshTrace();
    });
    svg.addEventListener('focusout', function () { focusId = null; refreshTrace(); });

    // ---- keyboard --------------------------------------------------------------------------
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      var onButton = !!t && t.tagName === 'BUTTON';
      var k = e.key;
      var handled = true;
      if (k === 'f' || k === 'F') fit();
      else if (k === '+' || k === '=') zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') zoomBy(1 / KEY_ZOOM);
      else if (k === 'p' || k === 'P') togglePresent();
      else if (k === 'a' || k === 'A') { if (!reduced()) toggleAnimate(); }
      else if (k === 'Escape') {
        if (presenting) exit();
        else if (pinId || hoverId || focusId) {
          pinId = null; hoverId = null;
          if (focusId && t && t.blur) t.blur(); // focusout clears focusId
          refreshTrace(); emit();
        } else handled = false;
      } else if (presenting && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !onButton))) next();
      else if (presenting && (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp')) prev();
      else if (k === 'ArrowLeft') panBy(-PAN_PX, 0);
      else if (k === 'ArrowRight') panBy(PAN_PX, 0);
      else if (k === 'ArrowUp') panBy(0, -PAN_PX);
      else if (k === 'ArrowDown') panBy(0, PAN_PX);
      else if ((k === 'Enter' || k === ' ') && t && t.classList && t.classList.contains('pa-node')) click(t);
      else handled = false;
      if (handled) e.preventDefault();
    }
    (options.keys || stage).addEventListener('keydown', onKey);

    // ---- resize ----------------------------------------------------------------------------
    function onResize() {
      if (presenting) goTo(stepIndex);
      else if (fitted) { cam = fitCamera(); apply(); } else apply();
    }
    if (global.ResizeObserver) new global.ResizeObserver(onResize).observe(stage);
    else global.addEventListener('resize', onResize);

    syncAnimate();
    cam = fitCamera();
    apply();
    paintCaption();
    if (caption) {
      var wire = function (name, fn) { var b = caption.querySelector('[' + name + ']'); if (b) b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); };
      wire('data-pa-prev', prev);
      wire('data-pa-next', next);
      wire('data-pa-exit', exit);
    }

    return {
      svg: svg, stage: stage, state: state,
      fit: fit, zoomBy: zoomBy, panBy: panBy,
      present: present, goTo: goTo, next: next, prev: prev, exit: exit, togglePresent: togglePresent,
      setAnimate: setAnimate, toggleAnimate: toggleAnimate,
    };
  }

  global.PADiagram = { mount: mount };
})(window);
