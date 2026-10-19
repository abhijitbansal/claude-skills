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
// jump), data-pa-scrub (an <input type="range"> with aria-valuetext
// "Beat n of N") and data-pa-ticks (its <datalist>), data-pa-prev,
// data-pa-next, data-pa-prev-chapter, data-pa-next-chapter, data-pa-exit,
// data-pa-play (an icon button: aria-label reads Play or Pause, and its
// span.pa-playicon holds the svg paint() swaps),
// data-pa-speed (0.5× ... 2×), data-pa-loop (aria-pressed). Text goes in as
// textContent, never markup (the play icon's svg is the one constant exception).
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  // The play button's icon: a triangle while paused, two bars while playing.
  // Both use currentColor, so every theme and the light/dark toggle recolor them.
  var PLAY_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" focusable="false"><path d="M7 4.5v15l13-7.5z"/></svg>';
  var PAUSE_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" focusable="false"><rect x="6" y="4.5" width="4.2" height="15" rx="1"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1"/></svg>';

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
    // Scroll the chip's row so the chip sits in the middle. Only the row moves:
    // scrollIntoView would scroll every ancestor, the page included.
    function reveal(row, chip) {
      if (!row || !chip || !row.getBoundingClientRect) return;
      var r = row.getBoundingClientRect();
      var c = chip.getBoundingClientRect();
      row.scrollLeft = Math.max(0, row.scrollLeft + (c.left + c.width / 2) - (r.left + r.width / 2));
    }
    // `row` is the element the chips were appended to (the Node harness has no parentNode).
    function mark(chips, row, active) {
      chips.forEach(function (c, i) {
        if (i === active) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current');
      });
      if (chips[active]) reveal(row, chips[active]);
    }

    // A button disabled while it has focus drops focus to the page (and, in
    // make-explainer's overlay, out of the element that takes the keys): focus
    // goes to Play first, else to the scrubber.
    function disable(button, off) {
      if (!button) return;
      if (off && !button.disabled && doc.activeElement === button) {
        var to = part('data-pa-play') || scrub;
        if (to && to.focus) to.focus();
      }
      button.disabled = off;
    }

    // The icon span ships in the page's markup; one is added if an embedder left it out.
    function paintPlay(button, playing) {
      var icon = button.querySelector('.pa-playicon');
      if (!icon) {
        icon = doc.createElement('span');
        icon.className = 'pa-playicon';
        icon.setAttribute('aria-hidden', 'true');
        button.appendChild(icon);
      }
      icon.innerHTML = playing ? PAUSE_SVG : PLAY_SVG;
      button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
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
      disable(part('data-pa-prev'), i === 0);
      disable(part('data-pa-next'), i === n - 1);
      var play = part('data-pa-play');
      if (play) paintPlay(play, story.isPlaying());
      var speed = part('data-pa-speed');
      if (speed) {
        speed.textContent = story.speed() + '×';
        speed.setAttribute('aria-label', 'Speed ' + story.speed() + '×; change speed');
      }
      var loopButton = part('data-pa-loop');
      if (loopButton) loopButton.setAttribute('aria-pressed', String(story.loop()));
      if (scrub) {
        if (scrub.value !== String(i)) scrub.value = String(i);
        scrub.setAttribute('aria-valuetext', 'Beat ' + (i + 1) + ' of ' + n);
      }
      mark(beatChips, beatRow, i);
      mark(chapterChips, chaptersEl, story.chapter());
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
    // A scrub, by pointer or arrow key, lands on a beat and holds there: it pauses
    // first. Pausing repaints the scrubber at the old beat, so read the target before.
    if (scrub) {
      scrub.addEventListener('input', function () {
        var target = Number(scrub.value);
        story.pause();
        story.goTo(target);
      });
    }
    paint();
    return { paint: paint };
  };
})(window);
