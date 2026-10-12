// Explainer page behaviour: theme toggle, contents highlight, copy buttons,
// one rise-in per section, print-friendly details. Nothing is fetched.
(function () {
  var PA = window.PA;
  var root = document.documentElement;
  var safeStorage = function (name) { try { return window[name]; } catch (e) { return undefined; } };
  var local = safeStorage('localStorage');
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var live = null;
  function announce(text) {
    if (!live) {
      live = document.createElement('div');
      live.className = 'sr-only';
      live.setAttribute('role', 'status');
      document.body.appendChild(live);
    }
    live.textContent = text;
  }

  // ---- theme ---------------------------------------------------------------
  var LABEL = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  var toggle = document.querySelector('[data-theme-toggle]');
  function currentTheme() { return root.getAttribute('data-theme') || 'auto'; }
  function applyTheme(mode) {
    if (mode === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', mode);
    if (toggle) { toggle.textContent = 'Theme: ' + LABEL[mode]; toggle.setAttribute('aria-label', 'Theme: ' + LABEL[mode] + '. Change theme'); }
  }
  applyTheme(currentTheme());
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = PA.nextTheme(currentTheme());
      PA.writeStore(local, 'pa-theme', next);
      applyTheme(next);
    });
  }

  // ---- contents ------------------------------------------------------------
  var toc = document.querySelector('.toc');
  if (toc) {
    var box = toc.querySelector('details');
    var wide = window.matchMedia ? window.matchMedia('(min-width: 1100px)') : null;
    var fit = function () { if (box && wide) box.open = wide.matches; };
    fit();
    if (wide && wide.addEventListener) wide.addEventListener('change', fit);
    var links = [].slice.call(toc.querySelectorAll('a[href^="#"]'));
    var targets = links.map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); });
    var current = -1;
    var mark = function () {
      var tops = targets.map(function (el) { return el ? el.getBoundingClientRect().top : Infinity; });
      var atEnd = window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2 && window.pageYOffset > 0;
      var i = PA.activeIndex(tops, window.innerHeight * 0.3, atEnd);
      if (i === current) return;
      current = i;
      links.forEach(function (a, k) { if (k === i) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
    };
    if ('IntersectionObserver' in window) {
      var seen = new IntersectionObserver(mark, { rootMargin: '-30% 0px -60% 0px', threshold: [0, 1] });
      targets.forEach(function (el) { if (el) seen.observe(el); });
    }
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () { queued = false; mark(); });
    }, { passive: true });
    window.addEventListener('resize', mark);
    links.forEach(function (a) {
      a.addEventListener('click', function () { if (box && wide && !wide.matches) box.open = false; });
    });
    mark();
  }

  // ---- copy ----------------------------------------------------------------
  function selectText(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function copyFallback(el) {
    selectText(el);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    return ok;
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest ? event.target.closest('[data-copy]') : null;
    if (!button) return;
    var code = button.closest('figure').querySelector('pre code');
    var done = function (label, message) {
      button.textContent = label;
      announce(message);
      window.setTimeout(function () { button.textContent = 'Copy'; }, 1800);
    };
    var text = code.textContent;
    var viaClipboard = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
    viaClipboard.then(
      function () { done('Copied', 'Code copied to the clipboard'); },
      function () {
        if (copyFallback(code)) done('Copied', 'Code copied to the clipboard');
        else done('Selected', 'Code selected; press Ctrl or Command C to copy');
      }
    );
  });

  // ---- one rise-in per section ----------------------------------------------
  var sections = [].slice.call(document.querySelectorAll('.sec'));
  if (!reduced && 'IntersectionObserver' in window && sections.length) {
    root.classList.add('rise-ready');
    var rise = new IntersectionObserver(function (entries) {
      // The furthest section now on screen: it and everything above it counts as
      // seen, so a deep link or a jump to the end leaves nothing hidden behind it.
      var furthest = -1;
      entries.forEach(function (e) { if (e.isIntersecting) furthest = Math.max(furthest, sections.indexOf(e.target)); });
      for (var i = 0; i <= furthest; i++) {
        sections[i].classList.add('in');
        rise.unobserve(sections[i]);
      }
    }, { rootMargin: '0px 0px -4% 0px', threshold: 0.01 });
    sections.forEach(function (el) { rise.observe(el); });
  }

  // ---- print: show everything -----------------------------------------------
  var reopened = [];
  window.addEventListener('beforeprint', function () {
    reopened = [].slice.call(document.querySelectorAll('details:not([open])'));
    reopened.forEach(function (d) { d.open = true; });
    sections.forEach(function (el) { el.classList.add('in'); });
  });
  window.addEventListener('afterprint', function () {
    reopened.forEach(function (d) { d.open = false; });
    reopened = [];
  });

  window.paReady = true;
})();
