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
  if (!PAD) return;

  function setup(figure) {
    var stage = figure.querySelector('[data-dg-stage]');
    var slot = figure.querySelector('[data-dg-slot]');
    var dialog = figure.querySelector('[data-dg-dialog]');
    var body = dialog.querySelector('[data-dg-body]');
    var presentButton = figure.querySelector('[data-dg-present]');
    var closeButton = dialog.querySelector('[data-dg-close]');
    var nextButton = dialog.querySelector('[data-pa-next]');
    var data;
    try { data = JSON.parse(figure.querySelector('script[data-dg-data]').textContent); } catch (e) { return; }
    var isOpen = false;

    // Capture phase on the figure, before the viewer's own listeners on the stage run.
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

    function openOverlay() {
      if (isOpen) return;
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      isOpen = true;
      body.appendChild(stage);
      controller.present(0);
      (nextButton.disabled ? closeButton : nextButton).focus();
    }
    // The stage goes home before the presentation ends, so the final fit is measured inline.
    function restore() {
      if (!isOpen) return;
      isOpen = false;
      slot.appendChild(stage);
      controller.exit();
    }
    function closeOverlay() {
      restore();
      if (dialog.close) { if (dialog.open) dialog.close(); } else dialog.removeAttribute('open');
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
