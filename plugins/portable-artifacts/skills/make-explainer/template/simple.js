// Simple English toggle. Shipped in the page head, only on a page that has simple text.
// A section with `simple` holds its body twice: data-text="normal" and data-text="simple" (hidden). This script
// reads the saved choice before first paint (no flash), then keeps the two copies and the button in step. Without
// script the normal text shows. Storage can be missing or refuse writes; the toggle still works for this visit then.
(function () {
  if (window.__paSimple) return;
  window.__paSimple = true;
  var KEY = 'pa-simple';
  var root = document.documentElement;

  function saved() {
    try { return window.localStorage.getItem(KEY) === 'on'; } catch (e) { return false; }
  }
  function save(on) {
    try { window.localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) { /* the choice lasts for this visit */ }
  }
  function isOn() { return root.getAttribute('data-simple') === 'on'; }

  // A slide is named after its heading (aria-label); data-simple-label is the name for the simple view.
  function rename(on) {
    var slides = document.querySelectorAll('[data-simple-label]');
    for (var i = 0; i < slides.length; i++) {
      if (!slides[i].hasAttribute('data-normal-label')) slides[i].setAttribute('data-normal-label', slides[i].getAttribute('aria-label'));
      slides[i].setAttribute('aria-label', slides[i].getAttribute(on ? 'data-simple-label' : 'data-normal-label'));
    }
  }

  function paint(on) {
    var normal = document.querySelectorAll('[data-text="normal"]');
    var simple = document.querySelectorAll('[data-text="simple"]');
    var buttons = document.querySelectorAll('[data-simple-toggle]');
    var i;
    for (i = 0; i < normal.length; i++) normal[i].hidden = on;
    for (i = 0; i < simple.length; i++) simple[i].hidden = !on;
    for (i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      buttons[i].setAttribute('title', on ? 'Simple English is on. Switch back to the normal text' : 'Show the simple English text');
    }
    rename(on);
  }

  function apply(on) {
    if (on) root.setAttribute('data-simple', 'on'); else root.removeAttribute('data-simple');
    paint(on);
  }

  // A saved copy of the page may carry the last reader's state; the stored choice (off when none) wins.
  if (saved()) root.setAttribute('data-simple', 'on'); else root.removeAttribute('data-simple');
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-simple-toggle]');
    if (!b) return;
    var on = !isOn();
    save(on);
    apply(on);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { paint(isOn()); });
  else paint(isOn());
})();
