// make-diagram viewer, story: the step-by-step presentation over data.steps.
// A step reveals its show, focus and highlight ids (plus each node's ancestor
// groups and the participants of a revealed message), hides the rest, and the
// camera fits what it focuses. Registered as PADiagram.story and composed by
// viewer.js. (scripts/lib/steps.mjs applies the same reveal rules when it
// builds the closing "Everything" step.)
//
//   var story = PADiagram.story(stage, svg, data, els, camera, { onStep });
//
// onStep runs after every change of step or mode, before the camera moves.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };

  PADiagram.story = function (stage, svg, data, els, camera, hooks) {
    hooks = hooks || {};
    var steps = data.steps || [];
    var edgeEnds = PADiagram.dict(data.edges);
    var parents = PADiagram.dict(data.parents);
    var frameData = data.frames || [];
    var isSequence = data.type === 'sequence';
    var words = function (el, name) { var v = el.getAttribute(name); return v ? v.split(' ') : []; };
    var presenting = false;
    var stepIndex = 0;

    // What the steps up to `n` reveal.
    function revealedThrough(n) {
      var seen = PADiagram.dict();
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
      Object.keys(els.nodes).forEach(function (id) { hide(els.nodes[id], !seen[id]); });
      Object.keys(els.groups).forEach(function (id) { hide(els.groups[id], !seen[id]); });
      Object.keys(els.edges).forEach(function (id) {
        var ends = edgeEnds[id] || [];
        var shown = isSequence ? !!seen[id] : !!seen[ends[0]] && !!seen[ends[1]];
        hide(els.edges[id], !shown);
        hide(els.labels[id], !shown);
      });
      els.lifelines.forEach(function (el) { hide(el, !seen[el.getAttribute('data-for')]); });
      els.frames.forEach(function (el) { hide(el, !words(el, 'data-messages').some(function (m) { return seen[m]; })); });
      els.notes.forEach(function (el) {
        var after = el.getAttribute('data-after');
        hide(el, after ? !seen[after] : !words(el, 'data-over').every(function (p) { return seen[p]; }));
      });
      var hl = PADiagram.dict();
      (step.highlight || []).forEach(function (id) { hl[id] = true; });
      [els.nodes, els.groups, els.edges, els.labels].forEach(function (group) {
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
      if (step.focus && step.focus.length) box = camera.boxOf(step.focus);
      else {
        var d = defaultFocus(step);
        box = camera.boxOf(d.ids);
        d.boxes.forEach(function (b) { box = camera.unionBox(box, { x: b[0], y: b[1], w: b[2], h: b[3] }); });
      }
      if (!box) box = camera.boxOf(step.highlight);
      return box || camera.boxOf(Object.keys(seen));
    }
    // A step that frames every id (the closing "Everything" step) shows the whole
    // diagram, which is the fit camera, not a padded focus box.
    function framesEverything(step) {
      var named = step.focus && step.focus.length ? step.focus : (step.show || []);
      var all = data.ids || [];
      return all.length > 0 && all.every(function (id) { return named.indexOf(id) >= 0; });
    }

    function goTo(i) {
      if (!steps.length) return;
      presenting = true;
      stepIndex = clamp(Math.round(finite(i, 0)), 0, steps.length - 1);
      stage.classList.add('pa-presenting');
      var seen = applyReveal();
      camera.unfit();
      if (hooks.onStep) hooks.onStep();
      camera.moveTo(framesEverything(steps[stepIndex]) ? camera.fitCamera() : camera.cameraFor(stepFocusBox(seen)));
    }
    function present(i) { goTo(i || 0); }
    function next() { if (presenting) goTo(stepIndex + 1); }
    function prev() { if (presenting) goTo(stepIndex - 1); }
    function exit() {
      if (!presenting) return;
      presenting = false;
      stage.classList.remove('pa-presenting');
      clearReveal();
      if (hooks.onStep) hooks.onStep();
      camera.fit();
    }
    function togglePresent() { if (presenting) exit(); else present(0); }

    return {
      isPresenting: function () { return presenting; },
      index: function () { return stepIndex; },
      count: function () { return steps.length; },
      current: function () { return steps[stepIndex] || null; },
      goTo: goTo, present: present, next: next, prev: prev, exit: exit, togglePresent: togglePresent,
    };
  };
})(window);
