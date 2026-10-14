// make-diagram viewer, transport: paints the caption element an embedder passes
// (children found by their data-pa-* attributes, every one optional) and wires
// its buttons. Registered as PADiagram.transport and composed by viewer.js.
//
//   var transport = PADiagram.transport({ caption }, data, story);
//
// Hooks: data-pa-count ("n / N"), data-pa-title, data-pa-note (hidden when the
// step has none), data-pa-prev and data-pa-next (disabled at the ends), data-pa-exit.
(function (global) {
  'use strict';
  var PADiagram = global.PADiagram || (global.PADiagram = {});

  PADiagram.transport = function (holders, data, story) {
    var caption = holders.caption || null;
    var part = function (name) { return caption ? caption.querySelector('[' + name + ']') : null; };

    function paint() {
      if (!caption) return;
      var presenting = story.isPresenting();
      caption.hidden = !presenting;
      if (!presenting) return;
      var step = story.current();
      var i = story.index();
      var n = story.count();
      var title = part('data-pa-title');
      var note = part('data-pa-note');
      var count = part('data-pa-count');
      var prev = part('data-pa-prev');
      var next = part('data-pa-next');
      if (title) title.textContent = step.title || '';
      if (note) { note.textContent = step.note || ''; note.hidden = !step.note; }
      if (count) count.textContent = (i + 1) + ' / ' + n;
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === n - 1;
    }
    function wire(name, fn) {
      var b = part(name);
      if (b) b.addEventListener('click', function (e) { e.stopPropagation(); fn(); });
    }
    wire('data-pa-prev', story.prev);
    wire('data-pa-next', story.next);
    wire('data-pa-exit', story.exit);
    paint();
    return { paint: paint };
  };
})(window);
