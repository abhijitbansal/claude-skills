// make-diagram viewer, transport: paints the player controls an embedder passes
// (`caption`: the bar with the line, chips and buttons; `chapters`: where the
// chapter chips go), each child found by its data-pa-* attribute and every one
// optional, and wires the buttons. Registered as PADiagram.transport.
//
//   var transport = PADiagram.transport({ caption, chapters }, data, story);
//
// Hooks: data-pa-line ("06 / 13 · CHAPTER · Title — caption"), data-pa-count
// ("n / N"), data-pa-title and data-pa-note (the older caption parts),
// data-pa-beats and data-pa-chapters (chip rows, filled here with buttons that
// jump), data-pa-scrub (an <input type="range">) and data-pa-ticks (its
// <datalist>), data-pa-prev, data-pa-next, data-pa-prev-chapter,
// data-pa-next-chapter, data-pa-exit, data-pa-play (aria-pressed; Play / Pause),
// data-pa-speed (0.5× ... 2×), data-pa-loop (aria-pressed). Text goes in as
// textContent, never markup.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  PADiagram.transport = function (holders, data, story) {
    var caption = holders.caption || null;
    var chaptersEl = holders.chapters || null;
    var doc = global.document;
    var beats = data.beats || [];
    var chapters = data.chapters || [];
    var part = function (name) { return caption ? caption.querySelector('[' + name + ']') : null; };
    var text = function (el, value) { if (el) el.textContent = value; };

    // One chip per beat or chapter: a button that jumps there. Built once.
    function chip(attr, i, label, onClick) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'pa-chip';
      b.setAttribute(attr, String(i));
      b.textContent = label;
      b.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
      return b;
    }
    var beatRow = part('data-pa-beats');
    var beatChips = beatRow ? beats.map(function (b, i) { return beatRow.appendChild(chip('data-pa-beat', i, pad2(i + 1) + ' ' + b.title, function () { story.goTo(i); })); }) : [];
    var chapterChips = chaptersEl ? chapters.map(function (ch, i) { return chaptersEl.appendChild(chip('data-pa-chapter', i, ch.title, function () { story.goTo(ch.start); })); }) : [];
    var ticks = part('data-pa-ticks');
    if (ticks) beats.forEach(function (_, i) { var o = doc.createElement('option'); o.value = String(i); ticks.appendChild(o); });
    var scrub = part('data-pa-scrub');
    if (scrub) { scrub.min = '0'; scrub.max = String(Math.max(0, beats.length - 1)); scrub.step = '1'; }

    function line(beat, i, n) {
      var ch = chapters[story.chapter()];
      var head = pad2(i + 1) + ' / ' + pad2(n) + (ch ? ' · ' + ch.title.toUpperCase() : '') + ' · ' + beat.title;
      return beat.caption ? head + ' — ' + beat.caption : head;
    }
    function mark(chips, active) {
      chips.forEach(function (c, i) {
        if (i === active) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
      });
      if (chips[active] && chips[active].scrollIntoView) chips[active].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    function paint() {
      var presenting = story.isPresenting();
      if (caption) caption.hidden = !presenting;
      if (chaptersEl) chaptersEl.hidden = !presenting;
      if (!presenting) return;
      var beat = story.current();
      var i = story.index();
      var n = story.count();
      text(part('data-pa-count'), (i + 1) + ' / ' + n);
      text(part('data-pa-title'), beat.title);
      var note = part('data-pa-note');
      if (note) { note.textContent = beat.caption || ''; note.hidden = !beat.caption; }
      text(part('data-pa-line'), line(beat, i, n));
      var prev = part('data-pa-prev');
      if (prev) prev.disabled = i === 0;
      var next = part('data-pa-next');
      if (next) next.disabled = i === n - 1;
      var play = part('data-pa-play');
      if (play) {
        play.setAttribute('aria-pressed', String(story.isPlaying()));
        play.textContent = story.isPlaying() ? 'Pause' : 'Play';
      }
      var speed = part('data-pa-speed');
      if (speed) {
        speed.textContent = story.speed() + '×';
        speed.setAttribute('aria-label', 'Speed ' + story.speed() + '×; change speed');
      }
      var loopButton = part('data-pa-loop');
      if (loopButton) loopButton.setAttribute('aria-pressed', String(story.loop()));
      if (scrub && scrub.value !== String(i)) scrub.value = String(i);
      mark(beatChips, i);
      mark(chapterChips, story.chapter());
    }
    function wire(name, fn) {
      var b = part(name);
      if (b) b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    }
    wire('data-pa-prev', story.prev);
    wire('data-pa-next', story.next);
    wire('data-pa-exit', story.exit);
    wire('data-pa-prev-chapter', story.prevChapter);
    wire('data-pa-next-chapter', story.nextChapter);
    wire('data-pa-play', story.togglePlay);
    wire('data-pa-speed', story.cycleSpeed);
    wire('data-pa-loop', story.toggleLoop);
    if (scrub) scrub.addEventListener('input', function () { story.goTo(Number(scrub.value)); });
    paint();
    return { paint: paint };
  };
})(window);
