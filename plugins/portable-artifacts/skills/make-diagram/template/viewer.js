// make-diagram viewer core: PADiagram.mount wires the camera (camera.js), the
// trace (explore.js), the story (story.js) and the transport (transport.js)
// around one rendered diagram, and owns pointer and keyboard handling, edge
// animation and the controller's state. No toolbar or page chrome in here: the
// page's own script (toolbar.js) and make-explainer drive it through the
// controller that mount returns.
//
//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, onChange });
//
// stageElement  holds the diagram <svg> (from buildDiagram) and sizes it.
// data          buildDiagram(spec).data (scripts/lib/data.mjs); nothing is fetched.
// keys          element that receives the keyboard shortcuts (default: stageElement).
// caption       element with [data-pa-title] [data-pa-note] [data-pa-count] [data-pa-prev]
//               [data-pa-next] [data-pa-exit] children; every one is optional.
// onChange      called with ctl.state() after any change.
//
// Every state class (pa-dim, pa-on, pa-hl, pa-hidden, pa-animate) is styled by
// diagramCss(); the modules only toggle them.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var DOUBLE_CLICK_MS = 300; // a second click this soon after one that stepped is part of a double click
  var DRAG_PX = 4;
  var PAN_PX = 80;
  var KEY_ZOOM = 1.25;

  // The drawn elements by id (nodes, groups, edges, labels) and in lists (lifelines, frames, notes).
  function elementsOf(svg) {
    var els = { nodes: PADiagram.dict(), groups: PADiagram.dict(), edges: PADiagram.dict(), labels: PADiagram.dict() };
    svg.querySelectorAll('.pa-node[data-id]').forEach(function (el) { els.nodes[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-group[data-id]').forEach(function (el) { els.groups[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge[data-id]').forEach(function (el) { els.edges[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge-label[data-edge]').forEach(function (el) { els.labels[el.getAttribute('data-edge')] = el; });
    els.lifelines = Array.prototype.slice.call(svg.querySelectorAll('.pa-lifeline[data-for]'));
    els.frames = Array.prototype.slice.call(svg.querySelectorAll('.pa-frame[data-messages]'));
    els.notes = Array.prototype.slice.call(svg.querySelectorAll('.pa-seq-note[data-over]'));
    return els;
  }

  function mount(stage, data, options) {
    options = options || {};
    var svg = stage.querySelector('svg');
    if (!svg) return null;
    var els = elementsOf(svg);
    var camera = PADiagram.camera(stage, svg, data, { onApply: emit });
    var trace = PADiagram.trace(svg, data, els);
    var story = PADiagram.story(stage, svg, data, els, camera, { onStep: function () { transport.paint(); trace.refresh(); emit(); } });
    var transport = PADiagram.transport({ caption: options.caption || null }, data, story);

    // ---- animation ----------------------------------------------------------------------
    var animateOn = !!data.animate && !camera.reduced();
    function syncAnimate() {
      if (camera.reduced()) animateOn = false;
      svg.classList.toggle('pa-animate', animateOn);
    }
    function setAnimate(on) { animateOn = !!on && !camera.reduced(); syncAnimate(); emit(); }
    function toggleAnimate() { setAnimate(!animateOn); }
    if (camera.reduceQuery) {
      var onMotion = function () { syncAnimate(); emit(); };
      if (camera.reduceQuery.addEventListener) camera.reduceQuery.addEventListener('change', onMotion); else camera.reduceQuery.addListener(onMotion);
    }

    // ---- state -----------------------------------------------------------------------------
    function state() {
      return {
        zoom: camera.zoom(),
        presenting: story.isPresenting(),
        step: story.index(),
        steps: story.count(),
        animate: animateOn,
        reducedMotion: camera.reduced(),
        pinned: trace.pinned(),
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
        if (lastPinch > 0 && dist > 0) camera.zoomAt(dist / lastPinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
        lastPinch = dist;
        dragging = true;
        return;
      }
      if (!dragging && downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > DRAG_PX) {
        dragging = true;
        stage.classList.add('pa-grabbing');
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer: no capture */ }
        trace.hover(null);
      }
      if (dragging) camera.panBy(-dx, -dy);
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
      if (story.isPresenting()) {
        var now = Date.now();
        if (now - lastStepClick < DOUBLE_CLICK_MS) return; // the second click of a double click
        lastStepClick = now;
        story.next();
        return;
      }
      trace.pin(trace.idAt(target));
      emit();
    }
    stage.addEventListener('dblclick', function () { if (!story.isPresenting()) camera.fit(); });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      camera.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('pointerover', function (e) { if (!dragging) trace.hover(trace.idAt(e.target)); });
    svg.addEventListener('pointerleave', function () { trace.hover(null); });
    svg.addEventListener('focusin', function (e) {
      var id = trace.idAt(e.target);
      if (!id) return;
      if (!story.isPresenting()) camera.ensureVisible(id);
      trace.focus(id);
    });
    svg.addEventListener('focusout', function () { trace.focus(null); });

    // ---- keyboard --------------------------------------------------------------------------
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      var onButton = !!t && t.tagName === 'BUTTON';
      var k = e.key;
      var presenting = story.isPresenting();
      var handled = true;
      if (k === 'f' || k === 'F') camera.fit();
      else if (k === '+' || k === '=') camera.zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') camera.zoomBy(1 / KEY_ZOOM);
      else if (k === 'p' || k === 'P') story.togglePresent();
      else if (k === 'a' || k === 'A') { if (!camera.reduced()) toggleAnimate(); }
      else if (k === 'Escape') {
        if (presenting) story.exit();
        else if (trace.active()) {
          var hadFocus = trace.hasFocus();
          trace.clear();
          if (hadFocus && t && t.blur) t.blur(); // focusout clears the focus trace
          emit();
        } else handled = false;
      } else if (presenting && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !onButton))) story.next();
      else if (presenting && (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp')) story.prev();
      else if (k === 'ArrowLeft') camera.panBy(-PAN_PX, 0);
      else if (k === 'ArrowRight') camera.panBy(PAN_PX, 0);
      else if (k === 'ArrowUp') camera.panBy(0, -PAN_PX);
      else if (k === 'ArrowDown') camera.panBy(0, PAN_PX);
      else if ((k === 'Enter' || k === ' ') && t && t.classList && t.classList.contains('pa-node')) click(t);
      else handled = false;
      if (handled) e.preventDefault();
    }
    (options.keys || stage).addEventListener('keydown', onKey);

    // ---- resize ----------------------------------------------------------------------------
    function onResize() {
      if (story.isPresenting()) story.goTo(story.index()); else camera.onResize();
    }
    if (global.ResizeObserver) new global.ResizeObserver(onResize).observe(stage);
    else global.addEventListener('resize', onResize);

    syncAnimate();
    camera.refit();

    return {
      svg: svg, stage: stage, state: state,
      fit: camera.fit, zoomBy: camera.zoomBy, panBy: camera.panBy,
      present: story.present, goTo: story.goTo, next: story.next, prev: story.prev, exit: story.exit, togglePresent: story.togglePresent,
      setAnimate: setAnimate, toggleAnimate: toggleAnimate,
    };
  }

  PADiagram.mount = mount;
})(window);
