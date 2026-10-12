// Slides behaviour: keyboard, deep links, saved position, progress, outline dialog.
// Runs before runtime.js on slides pages only. Slide numbers are 1-based; the pure
// parts (key map, hash and resume parsing, scroll maths) live in pa-lib.js.
(function () {
  var PA = window.PA;
  var deck = document.querySelector('[data-deck]');
  if (!PA || !deck) return;

  var local = PA.safeStorage('localStorage');
  var slides = [].slice.call(deck.querySelectorAll('section.slide'));
  var total = slides.length;
  var storeKey = 'pa-slides:' + deck.getAttribute('data-slug');
  // Chrome lookups stay inside the deck bar: a slide's own markup (a checklist's
  // progressbar, say) must never match them.
  var bar = document.querySelector('.deck-bar');
  var meter = bar.querySelector('[role=progressbar]');
  var fill = bar.querySelector('[data-progress]');
  var count = bar.querySelector('[data-count]');
  var live = bar.querySelector('[data-live]');
  var dialog = document.querySelector('[data-outline]');
  var links = [].slice.call(dialog.querySelectorAll('a[data-slide]'));
  var current = 0;

  var calm = function () { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); };
  var behavior = function () { return calm() ? 'auto' : 'smooth'; };

  // ---- state -----------------------------------------------------------------
  // Everything that shows the current slide, in one place. Only the current slide
  // is reachable by Tab and by screen readers; the others are inert.
  function show(n, options) {
    var changed = n !== current;
    current = n;
    deck.setAttribute('data-current', String(n));
    slides.forEach(function (slide, i) { slide.inert = i + 1 !== n; });
    count.textContent = String(n);
    fill.style.width = Math.round((n * 1000) / total) / 10 + '%';
    meter.setAttribute('aria-valuenow', String(n));
    meter.setAttribute('aria-valuetext', 'Slide ' + n + ' of ' + total);
    links.forEach(function (a, i) { if (i + 1 === n) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    if (!changed || !options) return;
    if (options.announce) speak(slides[n - 1].getAttribute('aria-label'));
    if (options.persist) {
      setHash(n);
      PA.writeStore(local, storeKey, String(n));
    }
  }

  // runtime.js owns the live region's behaviour; if its hook is missing, write to the region directly.
  function speak(text) {
    if (PA.announce) PA.announce(text); else live.textContent = text;
  }

  function setHash(n) {
    try { window.history.replaceState(null, '', '#slide-' + n); } catch (e) { /* the address bar stays as it was */ }
  }

  function align(n, smooth) {
    deck.scrollTo({ top: slides[n - 1].offsetTop, behavior: smooth ? behavior() : 'auto' });
  }

  // Focus rests on the current slide so the arrow keys scroll it when it is tall.
  function focusSlide(n) {
    slides[n - 1].focus({ preventScroll: true });
  }

  // Move focus along with the slide, unless it sits on a control outside the slides
  // (the theme toggle, the Outline button, the open outline) and should stay there.
  function followFocus(n) {
    var here = document.activeElement;
    if (!here || here === document.body || (here.closest && here.closest('.slide'))) focusSlide(n);
  }

  function go(n) {
    n = PA.clampSlide(n, total);
    show(n, { announce: true, persist: true });
    followFocus(n);
    align(n, true);
  }

  // Wheel, touch and find-in-page scroll the deck on their own; once it settles, follow it.
  var settleTimer = 0;
  deck.addEventListener('scroll', function () {
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(function () {
      var n = PA.slideAtScroll(deck.scrollTop, deck.clientHeight, total);
      if (n === current) return;
      show(n, { announce: true, persist: true });
      followFocus(n);
    }, 90);
  }, { passive: true });
  window.addEventListener('resize', function () { align(current, false); });

  window.addEventListener('hashchange', function () {
    var n = PA.parseSlideHash(window.location.hash, total);
    if (n !== null && n !== current) go(n);
  });

  // A deep link beats the saved position, which beats the first slide.
  var linked = PA.parseSlideHash(window.location.hash, total);
  var start = linked !== null ? linked : PA.parseResume(PA.readStore(local, storeKey), total);
  if (start === null) start = 1;
  show(start, null);
  align(start, false);
  focusSlide(start); // a screen reader starts at the slide; no scroll, so a deep link keeps its place
  if (linked !== null) setHash(start);

  // ---- outline ---------------------------------------------------------------
  var opener = null;
  function openOutline() {
    if (dialog.open) return;
    opener = document.activeElement;
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    var here = dialog.querySelector('a[aria-current]') || links[0];
    if (here) { here.focus(); here.scrollIntoView({ block: 'nearest' }); }
  }
  function closeOutline() {
    if (!dialog.open) return;
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
  }
  dialog.addEventListener('close', function () {
    var back = opener;
    opener = null;
    // Back to where focus was; if that is gone or inert (a slide we jumped away from), to the current slide.
    if (back && back.focus && document.contains(back) && !back.closest('[inert]')) back.focus();
    else focusSlide(current);
  });
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) { closeOutline(); return; }
    var link = event.target.closest ? event.target.closest('a[data-slide]') : null;
    if (!link) return;
    event.preventDefault();
    go(Number(link.getAttribute('data-slide')));
    closeOutline();
  });
  // Tab and Shift+Tab wrap inside the dialog instead of leaving the page.
  dialog.addEventListener('keydown', function (event) {
    if (event.key !== 'Tab') return;
    var items = [].slice.call(dialog.querySelectorAll('a[href], button'));
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  document.querySelector('[data-outline-open]').addEventListener('click', openOutline);
  document.querySelector('[data-outline-close]').addEventListener('click', closeOutline);

  // ---- keyboard --------------------------------------------------------------
  var TEXT_ENTRY = 'input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select, [contenteditable]:not([contenteditable=false])';
  var CONTROL = 'button, input, summary, select, textarea';
  var REGION = '.tablewrap, pre';
  var match = function (el, selector) { return el && el.closest ? el.closest(selector) : null; };
  var scrollsSideways = function (el) { return el.scrollWidth > el.clientWidth + 1; };
  var scrollsDown = function (el) { return el.scrollHeight > el.clientHeight + 1; };

  document.addEventListener('keydown', function (event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    // A diagram's Present overlay owns every key while it is open.
    if (document.querySelector('.dg-overlay[open]')) return;
    var act = PA.slideKey(event.key, event.shiftKey);
    if (!act) return;
    var target = event.target;
    if (act.to === 'outline') {
      if (match(target, TEXT_ENTRY)) return;
      event.preventDefault();
      if (dialog.open) closeOutline(); else openOutline();
      return;
    }
    if (dialog.open || match(target, TEXT_ENTRY)) return;

    // A focused code block or table keeps the keys it can use: the arrows when it
    // scrolls sideways, every other key when it scrolls vertically.
    var region = match(target, REGION);
    var key = event.key;
    if (region && ((key === 'ArrowLeft' || key === 'ArrowRight') ? scrollsSideways(region) : scrollsDown(region))) return;

    if (act.paged) {
      // Space on a button, checkbox or summary belongs to that control.
      if (key === ' ' && match(target, CONTROL)) return;
      var dir = act.to === 'next' ? 1 : -1;
      var slide = slides[current - 1];
      event.preventDefault();
      // A tall slide scrolls inside itself first; only at its end does the next slide come.
      if (PA.canScroll(slide, dir)) {
        slide.scrollBy({ top: dir * Math.round(slide.clientHeight * 0.85), behavior: behavior() });
        return;
      }
    } else {
      event.preventDefault();
    }
    go(PA.moveTarget(act.to, current, total));
  });
})();
