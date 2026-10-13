// Diagram sections: mounts make-diagram's viewer (PADiagram, inlined just
// before this script) on each inline figure and runs the Present overlay.
//
// One SVG and one controller per figure. Inline, the viewer gives hover and
// focus tracing and click-to-pin; wheel and drag are held back so the page
// still scrolls. Present opens a modal <dialog> and moves the stage into it;
// the viewer's keys element is that dialog, so its shortcuts exist only while
// it is open (and never reach a slide deck underneath). Esc closes the dialog
// and focus goes back to the Present button.
(function () {
  var PAD = window.PADiagram;

  function setup(figure) {
    var stage = figure.querySelector('[data-dg-stage]');
    var slot = figure.querySelector('[data-dg-slot]');
    var dialog = figure.querySelector('[data-dg-dialog]');
    var body = dialog.querySelector('[data-dg-body]');
    var presentButton = figure.querySelector('[data-dg-present]');
    var closeButton = dialog.querySelector('[data-dg-close]');
    var nextButton = dialog.querySelector('[data-pa-next]');
    // Present does nothing without a mounted viewer, so it is hidden unless mounting succeeds.
    presentButton.hidden = true;
    if (!PAD) return;
    var data;
    try { data = JSON.parse(figure.querySelector('script[data-dg-data]').textContent); } catch (e) { return; }
    var isOpen = false;

    // Capture phase on the figure, before the viewer's own listeners on the stage run. This also hides
    // wheel and pointermove over a figure from any listener further up the page (none exists today; the
    // viewer's listeners sit on the stage itself, so the hold-back cannot be narrower than a stop here).
    function holdBack(event) { if (!isOpen) event.stopPropagation(); }
    figure.addEventListener('wheel', holdBack, true);
    figure.addEventListener('pointermove', holdBack, true);

    // Registered before the viewer's key handler (which also swallows Esc to leave the presentation): Esc closes the overlay.
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeOverlay();
    });
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeOverlay(); });

    var controller = PAD.mount(stage, data, { keys: dialog, caption: dialog.querySelector('[data-pa-caption]') });
    if (!controller) return;
    presentButton.hidden = false;

    // Inline, nodes trace on hover and click but are not tab stops (a big diagram would add dozens
    // before the next section); in Present they are.
    var nodes = [].slice.call(stage.querySelectorAll('.pa-node'));
    function tabStops(on) { nodes.forEach(function (n) { n.tabIndex = on ? 0 : -1; }); }
    tabStops(false);

    // A diagram wider than the column keeps its text size and scrolls inside its slot: then the slot is a
    // labelled, focusable region (so the arrow keys scroll it, in a deck too).
    function syncRegion() {
      var scrolls = slot.scrollWidth > slot.clientWidth + 1;
      if (scrolls) {
        slot.setAttribute('role', 'region');
        slot.setAttribute('aria-label', slot.getAttribute('data-dg-label') + ' (scrolls sideways)');
        slot.tabIndex = 0;
      } else {
        slot.removeAttribute('role');
        slot.removeAttribute('aria-label');
        slot.tabIndex = -1;
      }
    }
    syncRegion();
    if (window.ResizeObserver) new window.ResizeObserver(syncRegion).observe(slot);
    else window.addEventListener('resize', syncRegion);

    var sideways = 0; // the slot's scrollLeft while the stage is away
    function openOverlay() {
      if (isOpen) return;
      dialog.showModal();
      isOpen = true;
      sideways = slot.scrollLeft;
      slot.style.height = slot.offsetHeight + 'px'; // the page below does not jump while the stage is away
      body.appendChild(stage);
      tabStops(true);
      controller.present(0);
      (nextButton.disabled ? closeButton : nextButton).focus();
    }
    // The stage goes home before the presentation ends, so the final fit is measured inline.
    function restore() {
      if (!isOpen) return;
      isOpen = false;
      slot.appendChild(stage);
      slot.style.height = '';
      tabStops(false);
      controller.exit();
      syncRegion();
      slot.scrollLeft = sideways; // an empty slot scrolled back to 0; the reader's place is restored
    }
    function closeOverlay() {
      restore();
      if (dialog.open) dialog.close();
    }
    dialog.addEventListener('close', function () {
      restore();
      presentButton.focus();
    });
    presentButton.addEventListener('click', openOverlay);
    closeButton.addEventListener('click', closeOverlay);
  }

  [].forEach.call(document.querySelectorAll('[data-diagram]'), setup);
})();
