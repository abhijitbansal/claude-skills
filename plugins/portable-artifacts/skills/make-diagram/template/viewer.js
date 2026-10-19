// make-diagram viewer core: PADiagram.mount wires the camera (camera.js), the
// trace (explore.js), the panel (panel.js), the story (story.js) and the
// transport (transport.js) around one rendered diagram, and owns pointer and
// keyboard handling, edge animation and the controller's state. No toolbar or
// page chrome in here: the page's own script (toolbar.js) and make-explainer
// drive it through the controller that mount returns.
//
//   var ctl = PADiagram.mount(stageElement, data, { keys, caption, chapters, panel, tip, find, found, root, onChange });
//
// stageElement  holds the diagram <svg> (from buildDiagram) and sizes it.
// data          buildDiagram(spec).data (scripts/lib/data.mjs); nothing is fetched.
// keys          element that receives the keyboard shortcuts (default: stageElement).
// caption       the transport element (see transport.js for its data-pa-* children; every one optional).
// chapters      element the chapter chips are appended to (optional).
// panel         the Explore side panel (see panel.js; optional).
// tip           the hover tooltip element, inside the stage (optional).
// find          the Find <input> (optional); found: the row its matches go in (optional).
// root          element full screen is asked for, and that carries pa-fill when the browser refuses (default: the document element).
// onChange      called with ctl.state() after any change.
//
// Keys: Space plays and pauses, arrows step the beats, P enters Play, E leaves
// it, F is full screen, 0 fits, / focuses Find, Escape closes the panel, else
// leaves full screen, else leaves Play, else clears.
// Every state class (pa-dim, pa-on, pa-hl, pa-hidden, pa-active, pa-selected,
// pa-route, pa-animate, and pa-playing on the stage) is styled by diagramCss()
// or the page; the modules only toggle them.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var DRAG_PX = 4;
  var PAN_PX = 80;
  var KEY_ZOOM = 1.25;

  // A wide, invisible copy of the wire right after it (css.mjs .pa-hit: a fixed screen width),
  // so a real mouse can land on a 1 px edge. Added here, not drawn: the export drops it anyway.
  function addHitPath(edge) {
    var wire = edge.querySelector('.pa-wire');
    if (!wire || edge.querySelector('.pa-hit')) return;
    var hit = wire.cloneNode(false);
    hit.setAttribute('class', 'pa-hit');
    ['marker-end', 'marker-start'].forEach(function (a) { hit.removeAttribute(a); });
    wire.parentNode.insertBefore(hit, wire.nextSibling);
  }

  // The drawn elements by id (nodes, groups, edges, labels) and in lists (lifelines, frames, notes).
  function elementsOf(svg) {
    var els = { nodes: PADiagram.dict(), groups: PADiagram.dict(), edges: PADiagram.dict(), labels: PADiagram.dict() };
    svg.querySelectorAll('.pa-node[data-id]').forEach(function (el) { els.nodes[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-group[data-id]').forEach(function (el) { els.groups[el.getAttribute('data-id')] = el; });
    svg.querySelectorAll('.pa-edge[data-id]').forEach(function (el) { els.edges[el.getAttribute('data-id')] = el; addHitPath(el); });
    svg.querySelectorAll('.pa-edge-label[data-edge]').forEach(function (el) { els.labels[el.getAttribute('data-edge')] = el; });
    els.lifelines = Array.prototype.slice.call(svg.querySelectorAll('.pa-lifeline[data-for]'));
    els.frames = Array.prototype.slice.call(svg.querySelectorAll('.pa-frame[data-messages]'));
    els.notes = Array.prototype.slice.call(svg.querySelectorAll('.pa-seq-note[data-over]'));
    return els;
  }

  var within = function (el, holder) { return !!(holder && el && holder.contains(el)); };
  // Arrows inside the panel scroll it only along an axis it overflows; otherwise they still pan.
  var panelScrolls = function (p, k) {
    if (!p) return false;
    return (k === 'ArrowUp' || k === 'ArrowDown') ? p.scrollHeight > p.clientHeight : p.scrollWidth > p.clientWidth;
  };
  var isField = function (el) { return !!(el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)); };

  function mount(stage, data, options) {
    options = options || {};
    var svg = stage.querySelector('svg');
    if (!svg) return null;
    var doc = global.document;
    var root = options.root || doc.documentElement;
    var fs = PADiagram.fullscreen(root, { onChange: emit });
    var els = elementsOf(svg);
    var findEl = options.find || null;
    var edgeEnds = PADiagram.dict(data.edges);
    var camera = PADiagram.camera(stage, svg, data, { onApply: emit });
    var trace = PADiagram.trace(svg, data, els, { isOff: function () { return story.isPresenting(); } });
    // Entering Play drops the selection and the route (the panel hides with them); each beat repaints the chrome.
    var story = PADiagram.story(stage, svg, data, els, camera, {
      onStep: function () {
        if (story.isPresenting()) { keepFocus([options.panel], 'play'); trace.clear(); } else keepFocus([options.caption, options.chapters], 'explore');
        transport.paint(); trace.refresh(); panel.paint(); emit();
      },
      // the transport shows the hold as a progress ring (hold/holdEnd arrive with it)
      onHold: function (ms) { if (transport.hold) transport.hold(ms); },
      onHoldEnd: function () { if (transport.holdEnd) transport.holdEnd(); },
    });
    var transport = PADiagram.transport({ caption: options.caption || null, chapters: options.chapters || null }, data, story);
    var panel = PADiagram.panel({ panel: options.panel || null, tip: options.tip || null, found: options.found || null }, data, els, trace, {
      isOff: function () { return story.isPresenting(); },
      onPick: pick,
      onBeat: function (i) { story.present(i); },
      onClose: function (byKeyboard) { closeSelection(null, byKeyboard); },
    });

    // A control that holds focus must not hide with it: focus would drop to the page, outside the element
    // that takes the keys in an embedder's dialog, and every shortcut would go dead. Before the holders
    // hide, focus moves to the tab of the mode being entered (found under `root`).
    function keepFocus(holders, mode) {
      var active = doc.activeElement;
      if (!holders.some(function (h) { return within(active, h); })) return;
      var tab = root.querySelector('[data-pa-mode="' + mode + '"]');
      if (tab && !tab.disabled) tab.focus();
    }

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
    // The route as plain values, so a caller cannot change what the trace holds.
    function routeCopy(r) {
      if (!r) return null;
      return { from: r.from, to: r.to, directed: r.directed, hops: r.hops.map(function (h) { return { from: h.from, to: h.to, edge: h.edge }; }) };
    }
    function state() {
      return {
        zoom: camera.zoom(),
        presenting: story.isPresenting(),
        step: story.index(),
        steps: story.count(),
        chapter: story.chapter(),
        playing: story.isPlaying(),
        speed: story.speed(),
        loop: story.loop(),
        animate: animateOn,
        reducedMotion: camera.reduced(),
        fullscreen: fs.isOn(),
        fill: fs.isFill(),
        selected: trace.selected(),
        route: routeCopy(trace.routed()),
      };
    }
    function emit() { if (options.onChange) options.onChange(state()); }

    // ---- explore: select, close ---------------------------------------------------------------
    // Select `id` (a node, or a group named in a panel row) and bring the camera to it; leaves Play first.
    function pick(id) {
      if (story.isPresenting()) story.exit();
      trace.select(id);
      camera.unfit();
      camera.moveTo(camera.cameraFor(camera.boxOf([id])));
      panel.paint();
      emit();
    }
    // Drop the selection or route. Closed from the keyboard while focus is in the
    // panel, focus goes back to the node it described (a mouse click on Close does
    // not move focus); a focused node under the keyboard blurs, as before, so its
    // focus trace ends too.
    // Where focus lands when the panel's subject goes: a node itself, an edge's first end, else (a
    // group has no focus stop) the panel title, which the page makes focusable.
    function focusTarget(id) {
      var ends = edgeEnds[id];
      var title = options.panel ? options.panel.querySelector('[data-pa-panel-title]') : null;
      return els.nodes[id] || (ends ? els.nodes[ends[0]] : null) || title;
    }
    function closeSelection(target, keyboard) {
      var id = trace.selected();
      var r = trace.routed();
      var back = id ? focusTarget(id) : (r ? els.nodes[r.from] : null);
      var inPanel = within(doc.activeElement, options.panel);
      var hadFocus = trace.hasFocus();
      trace.clear();
      if (keyboard && inPanel && back && back.focus) back.focus();
      else if (hadFocus && target && target.blur) target.blur(); // focusout clears the focus trace
      panel.paint();
      emit();
    }

    // Back to the resting view an embedder starts from: out of Play, nothing selected, traced or found, the
    // panel closed, the camera fitted.
    function reset() {
      story.exit();
      trace.clear();
      clearFind();
      panel.paint();
      camera.fit();
      emit();
    }

    // Typing a query drops the selection and route, or their painting would hide the filter.
    function applyFind() {
      if (findEl.value.trim() && (trace.selected() || trace.routed())) { trace.clear(); panel.paint(); }
      var hits = trace.find(findEl.value);
      panel.found(hits, findEl.value, trace.findCount() - hits.length);
      emit();
    }
    function clearFind() {
      if (findEl) findEl.value = '';
      trace.find('');
      panel.found([], '');
      emit();
    }
    if (findEl) {
      findEl.addEventListener('input', applyFind);
      // The field keeps its own keys: onKey below steps aside for form fields.
      findEl.addEventListener('keydown', function (e) {
        if (e.isComposing) return;
        if (e.key === 'Enter') {
          var hits = trace.find(findEl.value);
          if (hits.length) { e.preventDefault(); pick(hits[0].id); }
        } else if (e.key === 'Escape') { e.preventDefault(); story.pause(); clearFind(); findEl.blur(); }
      });
    }

    // ---- pointer: pan, pinch, click, hover ------------------------------------------------
    var pointers = {};
    var dragging = false;
    var downAt = null;
    var downTarget = null;
    var downShift = false;
    var lastPinch = 0;

    function pointerCount() { return Object.keys(pointers).length; }
    var stagePoint = function (e) { var r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      story.pause(); // a hand on the canvas stops the story (nothing happens when it is not running)
      if (pointerCount() === 1) { downAt = { x: e.clientX, y: e.clientY }; downTarget = e.target; downShift = e.shiftKey; dragging = false; }
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
        panel.tipFor(null);
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
      if (!wasDrag && !cancelled) click(downTarget, downShift);
      downAt = null;
      downTarget = null;
    }
    stage.addEventListener('pointerup', function (e) { release(e, false); });
    stage.addEventListener('pointercancel', function (e) { release(e, true); });

    // In Play a click on the canvas selects nothing (its pointerdown paused the
    // story). In Explore it selects the node or edge under it (again: deselects;
    // empty canvas: deselects); with Shift and a node already selected, it asks
    // for the route from that node to this one.
    function click(target, shift) {
      if (story.isPresenting()) return;
      var id = trace.idAt(target);
      var from = trace.selected() || (trace.routed() && trace.routed().from);
      if (shift && id && from && id !== from && els.nodes[id] && els.nodes[from]) trace.route(from, id);
      else trace.toggle(id);
      panel.paint();
      emit();
    }
    stage.addEventListener('dblclick', function () { if (!story.isPresenting()) camera.fit(); });
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = stage.getBoundingClientRect();
      var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      camera.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    svg.addEventListener('pointerover', function (e) {
      if (dragging) return;
      var id = trace.idAt(e.target);
      var p = stagePoint(e);
      trace.hover(id);
      panel.tipFor(id, p.x, p.y);
    });
    svg.addEventListener('pointermove', function (e) { if (!dragging) { var p = stagePoint(e); panel.tipMove(p.x, p.y); } });
    svg.addEventListener('pointerleave', function () { trace.hover(null); panel.tipFor(null); });
    svg.addEventListener('focusin', function (e) {
      var id = trace.idAt(e.target);
      if (!id) return;
      if (!story.isPresenting()) camera.ensureVisible(id);
      trace.focus(id);
    });
    svg.addEventListener('focusout', function () { trace.focus(null); });

    // ---- keyboard --------------------------------------------------------------------------
    // Space plays and pauses (on the canvas and on every transport control; a
    // button elsewhere keeps Space for itself); arrows, PageUp/PageDown, Home
    // and End move between beats; P enters Play, E leaves it; F is full screen;
    // 0 fits; A toggles the edge animation; / focuses Find; Escape closes the
    // panel, else leaves full screen, else leaves Play, else clears the Find
    // filter, else clears the trace. In Play any key but Space and F (full screen moves no camera) pauses, in a form
    // field too.
    var ARROWS = { ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true };
    var KEEPS_PLAYING = { ' ': true, Tab: true, Shift: true, CapsLock: true, f: true, F: true };
    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      var k = e.key;
      var inPlay = story.isPresenting();
      var inTransport = within(t, options.caption) || within(t, options.chapters);
      var onPlay = k === 'Enter' && t && t.hasAttribute && t.hasAttribute('data-pa-play'); // its own click toggles
      // Space is the play/pause key itself; Tab and lone modifiers act on nothing; a form field pauses too
      if (inPlay && !KEEPS_PLAYING[k] && !onPlay) story.pause();
      if (isField(t) && !(k === ' ' && inTransport && t.type === 'range')) return; // a range has no Space action
      var handled = true;
      if (k === '0') camera.fit();
      else if (k === 'f' || k === 'F') fs.toggle();
      else if (k === '+' || k === '=') camera.zoomBy(KEY_ZOOM);
      else if (k === '-' || k === '_') camera.zoomBy(1 / KEY_ZOOM);
      else if (k === 'p' || k === 'P') { if (!inPlay) story.present(0); }
      else if (k === 'e' || k === 'E') story.exit();
      else if (k === 'a' || k === 'A') { if (!camera.reduced()) toggleAnimate(); }
      else if (k === '/' && findEl) findEl.focus();
      else if (k === 'Escape') {
        if (trace.selected() || trace.routed()) closeSelection(t, true);
        else if (fs.isOn()) fs.exit();
        else if (inPlay) story.exit();
        else if (findEl && findEl.value.trim()) clearFind();
        else if (trace.active()) {
          var hadFocus = trace.hasFocus();
          trace.clear();
          if (hadFocus && t && t.blur) t.blur(); // focusout clears the focus trace
          emit();
        } else handled = false;
      } else if (inPlay && k === ' ' && (!(t && t.tagName === 'BUTTON') || inTransport)) story.togglePlay();
      else if (inPlay && (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown')) story.next();
      else if (inPlay && (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp')) story.prev();
      else if (inPlay && k === 'Home') story.first();
      else if (inPlay && k === 'End') story.last();
      else if (ARROWS[k] && within(t, options.panel) && panelScrolls(options.panel, k)) handled = false; // the details panel scrolls with them
      else if (k === 'ArrowLeft') camera.panBy(-PAN_PX, 0);
      else if (k === 'ArrowRight') camera.panBy(PAN_PX, 0);
      else if (k === 'ArrowUp') camera.panBy(0, -PAN_PX);
      else if (k === 'ArrowDown') camera.panBy(0, PAN_PX);
      else if ((k === 'Enter' || k === ' ') && t && t.classList && t.classList.contains('pa-node')) click(t, e.shiftKey);
      else handled = false;
      if (handled) e.preventDefault();
    }
    (options.keys || stage).addEventListener('keydown', onKey);

    // ---- resize ----------------------------------------------------------------------------
    // A resize reframes a running beat where it stands; outside Play a fitted view refits.
    function onResize() {
      if (story.isPresenting()) story.reframe(); else camera.onResize();
    }
    if (global.ResizeObserver) new global.ResizeObserver(onResize).observe(stage);
    else global.addEventListener('resize', onResize);

    syncAnimate();
    camera.refit();

    return {
      svg: svg, stage: stage, state: state,
      fit: camera.fit, zoomBy: camera.zoomBy, panBy: camera.panBy,
      select: pick, closePanel: function () { closeSelection(null, false); }, reset: reset,
      present: story.present, goTo: story.goTo, next: story.next, prev: story.prev, first: story.first, last: story.last,
      nextChapter: story.nextChapter, prevChapter: story.prevChapter, exit: story.exit, togglePresent: story.togglePresent,
      play: story.play, pause: story.pause, togglePlay: story.togglePlay, setSpeed: story.setSpeed, cycleSpeed: story.cycleSpeed,
      setLoop: story.setLoop, toggleLoop: story.toggleLoop,
      setAnimate: setAnimate, toggleAnimate: toggleAnimate,
      enterFullscreen: fs.enter, exitFullscreen: fs.exit, toggleFullscreen: fs.toggle,
    };
  }

  PADiagram.mount = mount;
})(window);
