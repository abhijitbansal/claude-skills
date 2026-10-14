// Diagram sections: mounts make-diagram's viewer (PADiagram, inlined just
// before this script) on each inline figure and runs the Present overlay.
//
// One SVG and one controller per figure. Inline, the viewer gives hover and
// focus tracing and click-to-select; wheel and drag are held back so the page
// still scrolls. Present opens a modal <dialog>, moves the stage into it and
// starts the story on its first beat. The dialog holds the whole viewer (the
// Play story / Explore tabs, Find, full screen, the transport with its chips,
// the side panel), on the same data-pa-* hooks make-diagram's own page uses;
// the viewer's keys element is that dialog, so its shortcuts exist only while
// it is open (and never reach a slide deck underneath). Full screen is asked for on the wrapper div
// inside the dialog (data-dg-root): browsers refuse it on a <dialog> itself. Esc closes the panel,
// then leaves full screen, then closes the dialog; focus goes back to the
// Present button.
(function () {
  var PAD = window.PADiagram;

  function setup(figure) {
    var stage = figure.querySelector('[data-dg-stage]');
    var slot = figure.querySelector('[data-dg-slot]');
    var dialog = figure.querySelector('[data-dg-dialog]');
    var body = dialog.querySelector('[data-dg-body]');
    var presentButton = figure.querySelector('[data-dg-present]');
    var closeButton = dialog.querySelector('[data-dg-close]');
    var playButton = dialog.querySelector('[data-pa-play]');
    var fullButton = dialog.querySelector('[data-pa-full]');
    var findBox = dialog.querySelector('[data-pa-find]');
    var modes = {};
    [].forEach.call(dialog.querySelectorAll('[data-pa-mode]'), function (b) { modes[b.getAttribute('data-pa-mode')] = b; });
    // Present does nothing without a mounted viewer, so it is hidden unless mounting succeeds.
    presentButton.hidden = true;
    if (!PAD) return;
    var data;
    try { data = JSON.parse(figure.querySelector('script[data-dg-data]').textContent); } catch (e) { return; }
    var isOpen = false;
    var controller = null;

    // Capture phase on the figure, before the viewer's own listeners on the stage run. This also hides
    // wheel and pointermove over a figure from any listener further up the page (none exists today; the
    // viewer's listeners sit on the stage itself, so the hold-back cannot be narrower than a stop here).
    function holdBack(event) { if (!isOpen) event.stopPropagation(); }
    figure.addEventListener('wheel', holdBack, true);
    figure.addEventListener('pointermove', holdBack, true);

    // Registered before the viewer's key handler, so it runs first. Esc closes the overlay only when the
    // viewer has nothing of its own to close: a selection or route (the panel) and full screen come
    // first and the viewer handles them; the Find box handles its own Esc (defaultPrevented by then).
    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      var s = controller ? controller.state() : {};
      if (s.selected || s.route || s.fullscreen) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeOverlay();
    });
    // The browser's cancel (Esc with focus on the body, e.g. after Find) follows the same rule as the
    // keydown guard: close the panel or leave full screen first, the overlay last.
    dialog.addEventListener('cancel', function (event) {
      event.preventDefault();
      var s = controller ? controller.state() : {};
      if (s.selected || s.route) controller.closePanel();
      else if (s.fullscreen) controller.exitFullscreen();
      else closeOverlay();
    });

    // The tabs and the full-screen button mirror the controller.
    function sync(state) {
      if (modes.play) { modes.play.setAttribute('aria-pressed', String(state.presenting)); modes.play.disabled = state.steps === 0; }
      if (modes.explore) modes.explore.setAttribute('aria-pressed', String(!state.presenting));
      if (fullButton) {
        fullButton.textContent = state.fullscreen ? 'Exit full screen' : 'Full screen';
        fullButton.setAttribute('aria-pressed', String(state.fullscreen));
      }
    }
    controller = PAD.mount(stage, data, {
      keys: dialog, root: dialog.querySelector('[data-dg-root]'), onChange: sync,
      caption: dialog.querySelector('[data-pa-caption]'), chapters: dialog.querySelector('[data-pa-chapters]'),
      panel: dialog.querySelector('[data-pa-panel]'), tip: dialog.querySelector('[data-pa-tip]'),
      find: findBox, found: dialog.querySelector('[data-pa-found]'),
    });
    if (!controller) return;
    presentButton.hidden = false;
    if (modes.play) modes.play.addEventListener('click', function () { if (!controller.state().presenting) controller.present(0); });
    if (modes.explore) modes.explore.addEventListener('click', function () { controller.exit(); });
    if (fullButton) fullButton.addEventListener('click', function () { controller.toggleFullscreen(); });

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

    // Play when there is a story to play, else Close; keys work at once either way.
    function focusEntry() {
      var hasStory = controller.state().steps > 0 && playButton;
      (hasStory ? playButton : closeButton).focus();
    }
    // Find's Esc blurs the box to the body, outside the dialog: the dialog's keys go dead and the next
    // Esc arrives as a cancel. Hand focus back to the dialog.
    if (findBox) findBox.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && isOpen && document.activeElement !== findBox) focusEntry();
    });

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
      focusEntry();
    }
    // The stage goes home before the presentation ends, so the final fit is measured inline. Full
    // screen and the Find text go too, so the next Present starts clean (entering Play drops the
    // selection by itself).
    function restore() {
      if (!isOpen) return;
      isOpen = false;
      controller.exitFullscreen();
      if (findBox) { findBox.value = ''; findBox.dispatchEvent(new Event('input')); }
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
