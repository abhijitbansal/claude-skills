// make-diagram viewer, story: the timeline of beats (data.beats, grouped into
// data.chapters) the player steps through. A hop beat fits both ends of its
// edge and lights the edge; a focus beat fits and lights its ids (a group
// lights its members); everything else dims. A step beat (from the older
// steps[] form) reveals what it shows and hides the rest, as before, with no
// dimming. Playing runs each beat as glide (600 ms for a story beat, the
// camera's own glide for a step beat), then (a hop, motion allowed) the dot,
// then a hold, and moves on; every duration divides by the speed; reduced
// motion drops the dot and the glide. Registered as PADiagram.story and
// composed by viewer.js.
//
//   var story = PADiagram.story(stage, svg, data, els, camera, { onStep });
//
// onStep runs after every change of beat or mode, before the camera moves.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var GLIDE_MS = 600; // the camera's glide to a story (hop or focus) beat
  var DOT_MS = 1200; // the dot along a hop's edge
  var HOLD_MS = 2500; // then the caption holds...
  var HOLD_PER_CHAR_MS = 40; // ...longer for a longer caption...
  var HOLD_MAX_MS = 6000; // ...up to this
  var SPEEDS = [0.5, 1, 1.5, 2];
  var DOT_RADIUS = 5;

  var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
  var finite = function (v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; };

  PADiagram.story = function (stage, svg, data, els, camera, hooks) {
    hooks = hooks || {};
    var beats = data.beats || [];
    var chapters = data.chapters || [];
    var edgeEnds = PADiagram.dict(data.edges);
    var parents = PADiagram.dict(data.parents);
    var frameData = data.frames || [];
    var isSequence = data.type === 'sequence';
    var stepMode = beats.length > 0 && beats[0].kind === 'step'; // a timeline is all steps or no steps
    var words = function (el, name) { var v = el.getAttribute(name); return v ? v.split(' ') : []; };
    var presenting = false;
    var stepIndex = 0;
    var playing = false;
    var speed = 1;
    var loop = !!data.autoplay; // a page that starts by itself keeps going

    // ---- step beats: reveal, hide, emphasise (the older steps[] form) ---------------------
    // What the beats up to `n` reveal: their reveal, ids and highlight lists, each
    // node's ancestor groups, and the participants of a revealed message
    // (scripts/lib/steps.mjs applies the same rules for the closing "Everything" step).
    function revealedThrough(n) {
      var seen = PADiagram.dict();
      var add = function (id) {
        for (var at = id; at !== undefined && !seen[at]; at = parents[at]) seen[at] = true;
      };
      for (var i = 0; i <= n; i++) {
        var b = beats[i];
        [].concat(b.reveal, b.ids, b.highlight).forEach(add);
      }
      Object.keys(edgeEnds).forEach(function (e) {
        if (isSequence && seen[e]) { add(edgeEnds[e][0]); add(edgeEnds[e][1]); }
      });
      return seen;
    }
    function applyReveal() {
      var seen = revealedThrough(stepIndex);
      var beat = beats[stepIndex];
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
      beat.highlight.forEach(function (id) { hl[id] = true; });
      [els.nodes, els.groups, els.edges, els.labels].forEach(function (group) {
        Object.keys(group).forEach(function (id) { group[id].classList.toggle('pa-hl', !!hl[id]); });
      });
      return seen;
    }
    function clearReveal() {
      svg.querySelectorAll('.pa-hidden,.pa-hl').forEach(function (el) { el.classList.remove('pa-hidden', 'pa-hl'); });
    }
    // A step beat with no focus fits what it reveals. In a sequence that also keeps
    // the headers of every shown message's participants and the frames around the
    // messages in view, so the reader still knows who is talking.
    function defaultFocus(beat) {
      var ids = beat.reveal.slice();
      if (!isSequence) return { ids: ids, boxes: [] };
      var framed = [];
      beat.reveal.forEach(function (id) {
        if (edgeEnds[id]) ids.push(edgeEnds[id][0], edgeEnds[id][1]);
        frameData.forEach(function (f) { if (f.messages.indexOf(id) >= 0) framed.push(f.box); });
      });
      return { ids: ids, boxes: framed };
    }
    function stepFocusBox(beat, seen) {
      var box;
      if (beat.ids.length) box = camera.boxOf(beat.ids);
      else {
        var d = defaultFocus(beat);
        box = camera.boxOf(d.ids);
        d.boxes.forEach(function (b) { box = camera.unionBox(box, { x: b[0], y: b[1], w: b[2], h: b[3] }); });
      }
      if (!box) box = camera.boxOf(beat.highlight);
      return box || camera.boxOf(Object.keys(seen));
    }
    // A step beat that frames every id (the closing "Everything" step) shows the
    // whole diagram, which is the fit camera, not a padded focus box.
    function framesEverything(beat) {
      var named = beat.ids.length ? beat.ids : beat.reveal;
      var all = data.ids || [];
      return all.length > 0 && all.every(function (id) { return named.indexOf(id) >= 0; });
    }

    // ---- story beats: light the beat, dim the rest -------------------------------------------
    var styled = []; // elements carrying pa-dim / pa-hl / pa-active, to reset cheaply
    function unlight() {
      styled.forEach(function (el) { el.classList.remove('pa-dim', 'pa-hl', 'pa-active'); });
      styled = [];
    }
    function light(beat) {
      unlight();
      var lit = PADiagram.dict();
      beat.ids.forEach(function (id) { lit[id] = true; });
      var inLit = function (id) { // the id itself, or a group around it, is lit
        for (var at = id; at !== undefined; at = parents[at]) if (lit[at]) return true;
        return false;
      };
      var set = function (el, on, cls) {
        el.classList.toggle('pa-dim', !on);
        if (on && cls) el.classList.add(cls);
        styled.push(el);
      };
      Object.keys(els.nodes).forEach(function (id) { set(els.nodes[id], inLit(id), beat.kind === 'focus' ? 'pa-hl' : null); });
      var holds = PADiagram.dict(); // groups around a lit id stay lit; the rest dim with the nodes
      beat.ids.forEach(function (id) { for (var at = parents[id]; at !== undefined; at = parents[at]) holds[at] = true; });
      Object.keys(els.groups).forEach(function (id) { set(els.groups[id], holds[id] || inLit(id), lit[id] ? 'pa-hl' : null); });
      Object.keys(els.edges).forEach(function (id) {
        var ends = edgeEnds[id] || [];
        // a hop lights its own edge only; a focus shot lights the edges between lit ends
        var on = beat.kind === 'hop' ? id === beat.edge : inLit(ends[0]) && inLit(ends[1]);
        set(els.edges[id], on, beat.kind === 'hop' ? 'pa-active' : null);
        if (els.labels[id]) set(els.labels[id], on, null);
      });
    }

    // ---- the dot ---------------------------------------------------------------------------
    var dot = null;
    var dotFrame = 0;
    function dotEl() {
      if (!dot) {
        dot = global.document.createElementNS(svg.namespaceURI, 'circle'); // the page names no URL but the xmlns on <svg>
        dot.setAttribute('class', 'pa-dot');
        dot.setAttribute('r', String(DOT_RADIUS));
        svg.appendChild(dot); // last child: drawn over everything
      }
      return dot;
    }
    function hideDot() {
      if (dotFrame && global.cancelAnimationFrame) global.cancelAnimationFrame(dotFrame);
      dotFrame = 0;
      if (dot) dot.classList.remove('pa-dot-on');
    }
    // Slide the dot along the beat's edge over `ms` (backwards for a reverse hop), then call done.
    function travel(beat, ms, done) {
      var path = els.edges[beat.edge] ? els.edges[beat.edge].querySelector('path') : null;
      if (!path || !path.getTotalLength || !global.requestAnimationFrame) { done(); return; }
      var length = path.getTotalLength();
      var el = dotEl();
      // Park the dot on the edge's first point before it shows: left where the
      // last beat ended, it would flash there for one frame.
      var start = path.getPointAtLength(beat.reverse ? length : 0);
      el.setAttribute('cx', String(start.x));
      el.setAttribute('cy', String(start.y));
      el.classList.add('pa-dot-on');
      var t0 = null;
      var tick = function (now) {
        if (t0 === null) t0 = now;
        var k = Math.min(1, (now - t0) / ms);
        var e = k * k * (3 - 2 * k); // smoothstep: the dot leaves and arrives softly
        var p = path.getPointAtLength((beat.reverse ? 1 - e : e) * length);
        el.setAttribute('cx', String(p.x));
        el.setAttribute('cy', String(p.y));
        if (k < 1) { dotFrame = global.requestAnimationFrame(tick); return; }
        dotFrame = 0;
        done();
      };
      dotFrame = global.requestAnimationFrame(tick);
    }

    // ---- running a beat --------------------------------------------------------------------
    var run = 0; // bumps on every goTo, pause and exit, so a stale timer or frame does nothing
    var timer = 0;
    function cancelRun() {
      run += 1;
      if (timer) global.clearTimeout(timer);
      timer = 0;
      hideDot();
    }
    var later = function (token, ms, fn) {
      timer = global.setTimeout(function () { timer = 0; if (token === run) fn(); }, ms);
    };
    function holdMs(beat) {
      var chars = beat.caption ? beat.caption.length : 0;
      return Math.min(HOLD_MAX_MS, HOLD_MS + HOLD_PER_CHAR_MS * chars) / speed;
    }

    // ---- moving between beats -----------------------------------------------------------------
    function targetOf(beat, seen) {
      if (beat.kind === 'step') return framesEverything(beat) ? camera.fitCamera() : camera.cameraFor(stepFocusBox(beat, seen));
      // a hop also frames its own edge: a sequence message sits below its participants' headers
      return camera.cameraFor(camera.boxOf(beat.edge ? beat.ids.concat(beat.edge) : beat.ids));
    }
    // Show the beat: glide, then (a hop, motion allowed) the dot, then hold. While
    // playing, the hold ends in the next beat, the first again on loop, or a pause.
    function show(beat, seen) {
      var token = run;
      var instant = camera.reduced();
      // A story beat glides GLIDE_MS; a step beat (the older steps[] form) keeps the camera's own pace.
      var glide = (beat.kind === 'step' ? camera.glideMs() : GLIDE_MS) / speed;
      camera.unfit();
      camera.moveTo(targetOf(beat, seen), { ms: glide });
      var hold = function () {
        later(token, holdMs(beat), function () {
          if (!playing) return;
          if (stepIndex < beats.length - 1) goTo(stepIndex + 1);
          else if (loop) goTo(0);
          else pause();
        });
      };
      later(token, instant ? 0 : glide, function () {
        if (beat.kind === 'hop' && !instant) travel(beat, DOT_MS / speed, hold); else hold();
      });
    }
    // onStep runs before the beat paints: the trace (off in Play) drops its own
    // pa-dim marks first, so the beat's dimming is not undone by it.
    function goTo(i) {
      if (!beats.length) return;
      cancelRun();
      presenting = true;
      stepIndex = clamp(Math.round(finite(i, 0)), 0, beats.length - 1);
      stage.classList.add('pa-presenting');
      var beat = beats[stepIndex];
      if (hooks.onStep) hooks.onStep();
      var seen = stepMode ? applyReveal() : null;
      if (!stepMode) light(beat);
      show(beat, seen);
    }
    function present(i) { goTo(i || 0); }
    function next() { if (presenting) goTo(stepIndex + 1); }
    function prev() { if (presenting) goTo(stepIndex - 1); }
    function first() { if (presenting) goTo(0); }
    function last() { if (presenting) goTo(beats.length - 1); }
    function chapterAt(i) {
      for (var c = 0; c < chapters.length; c++) if (i >= chapters[c].start && i < chapters[c].end) return c;
      return 0;
    }
    function nextChapter() {
      if (!presenting) return;
      var c = chapterAt(stepIndex);
      goTo(c + 1 < chapters.length ? chapters[c + 1].start : beats.length - 1);
    }
    // From inside a chapter, back to its first beat; from its first beat, to the
    // chapter before. A timeline with no chapters acts as one chapter.
    function prevChapter() {
      if (!presenting) return;
      var c = chapterAt(stepIndex);
      var start = chapters[c] ? chapters[c].start : 0;
      goTo(stepIndex > start || c === 0 ? start : chapters[c - 1].start);
    }
    function exit() {
      if (!presenting) return;
      cancelRun();
      presenting = false;
      playing = false;
      stage.classList.remove('pa-presenting', 'pa-playing');
      clearReveal();
      unlight();
      if (hooks.onStep) hooks.onStep();
      camera.fit();
    }
    function togglePresent() { if (presenting) exit(); else present(0); }

    // ---- play, pause, speed, loop ---------------------------------------------------------------
    function play() {
      if (!beats.length || playing) return;
      playing = true;
      stage.classList.add('pa-playing');
      goTo(presenting ? stepIndex : 0); // runs the beat again from its glide
    }
    function pause() {
      if (!playing) return;
      cancelRun();
      playing = false;
      stage.classList.remove('pa-playing');
      if (hooks.onStep) hooks.onStep();
    }
    function togglePlay() { if (playing) pause(); else play(); }
    // A new speed applies from the next glide, dot or hold; the one under way keeps its clock.
    function setSpeed(v) { speed = SPEEDS.indexOf(v) >= 0 ? v : 1; if (hooks.onStep) hooks.onStep(); }
    function cycleSpeed() { setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]); }
    function setLoop(on) { loop = !!on; if (hooks.onStep) hooks.onStep(); }
    function toggleLoop() { setLoop(!loop); }

    return {
      isPresenting: function () { return presenting; },
      index: function () { return stepIndex; },
      count: function () { return beats.length; },
      current: function () { return beats[stepIndex] || null; },
      chapter: function () { return chapterAt(stepIndex); },
      isPlaying: function () { return playing; },
      speed: function () { return speed; },
      loop: function () { return loop; },
      play: play, pause: pause, togglePlay: togglePlay,
      setSpeed: setSpeed, cycleSpeed: cycleSpeed, setLoop: setLoop, toggleLoop: toggleLoop,
      goTo: goTo, present: present, next: next, prev: prev, first: first, last: last,
      nextChapter: nextChapter, prevChapter: prevChapter, exit: exit, togglePresent: togglePresent,
    };
  };
})(window);
