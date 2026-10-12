// Explainer page behaviour: theme toggle, contents highlight, copy buttons,
// checklists, one rise-in per section, print-friendly details. Nothing is fetched.
(function () {
  var PA = window.PA;
  var root = document.documentElement;
  var local = PA.safeStorage('localStorage');
  var live = null;
  function announce(text) {
    if (!live) live = document.querySelector('[data-live]'); // slides pages ship their own region
    if (!live) {
      live = document.createElement('div');
      live.className = 'sr-only';
      live.setAttribute('role', 'status');
      document.body.appendChild(live);
    }
    live.textContent = text;
  }
  PA.announce = announce; // slides.js speaks through the same region

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
    var figure = button.closest('figure');
    var code = figure ? figure.querySelector('pre code') : null;
    if (!code) return;
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

  // ---- checklists -----------------------------------------------------------
  // Ticks are saved as {id: true} under pa-checklist:<key>. Storage can be missing or
  // refuse writes; then ticking still works for this visit and a quiet note says so.
  function setupChecklist(box) {
    var storeKey = 'pa-checklist:' + box.getAttribute('data-key');
    var inputs = [].slice.call(box.querySelectorAll('input[data-id]'));
    var ids = inputs.map(function (input) { return input.getAttribute('data-id'); });
    var part = function (name) { return box.querySelector('[' + name + ']'); };
    var groups = [].slice.call(box.querySelectorAll('[data-group]'));
    var meter = box.querySelector('[role=progressbar]');
    var reset = part('data-reset');
    var confirmBox = part('data-confirm');
    var unsaved = part('data-unsaved');
    var saved = PA.saveStore(local, 'pa-probe', '1') && PA.saveStore(local, 'pa-probe', null);
    var checked = saved ? PA.readChecks(PA.readStore(local, storeKey), ids) : PA.readChecks(null, ids);

    // Merge into what is stored now, so another tab's (or page's) ticks are never lost.
    function persist() {
      var ok = PA.saveStore(local, storeKey, PA.mergeChecks(PA.readStore(local, storeKey), ids, checked));
      if (!ok) unsaved.hidden = false;
    }
    function refresh() {
      var done = 0;
      inputs.forEach(function (input) {
        var on = checked[input.getAttribute('data-id')] === true;
        input.checked = on;
        input.closest('.cl-item').classList.toggle('is-done', on);
        if (on) done++;
      });
      groups.forEach(function (group) {
        var boxes = group.querySelectorAll('input[data-id]');
        var n = group.querySelectorAll('input[data-id]:checked').length;
        group.querySelector('[data-group-done]').textContent = n;
        group.classList.toggle('is-complete', n === boxes.length);
      });
      var p = PA.checkProgress(done, inputs.length);
      part('data-done').textContent = p.done;
      part('data-pct').textContent = p.pct + '%';
      part('data-fill').style.width = p.pct + '%';
      part('data-complete').hidden = !(p.total > 0 && p.done === p.total);
      meter.setAttribute('aria-valuenow', p.done);
      meter.setAttribute('aria-valuetext', p.done + ' of ' + p.total + ' done');
      // aria-disabled, not disabled: focus can rest on the button after a reset empties it.
      reset.setAttribute('aria-disabled', p.done === 0 ? 'true' : 'false');
      if (!confirmBox.hidden) {
        if (p.done === 0) closeConfirm(false); else showCount(p.done);
      }
      return p.done;
    }
    function showCount(n) {
      part('data-confirm-text').textContent = 'Reset all ' + n + (n === 1 ? ' tick?' : ' ticks?');
    }
    function closeConfirm(refocus) {
      confirmBox.hidden = true;
      reset.hidden = false;
      if (refocus) reset.focus();
    }

    if (!saved) unsaved.hidden = false;
    refresh();

    box.addEventListener('change', function (event) {
      var input = event.target;
      if (!input.matches || !input.matches('input[data-id]')) return;
      var id = input.getAttribute('data-id');
      if (input.checked) checked[id] = true; else delete checked[id];
      persist();
      refresh();
    });
    reset.addEventListener('click', function () {
      var n = refresh();
      if (n === 0) return;
      showCount(n);
      reset.hidden = true;
      confirmBox.hidden = false;
      part('data-reset-no').focus();
    });
    part('data-reset-no').addEventListener('click', function () { closeConfirm(true); });
    part('data-reset-yes').addEventListener('click', function () {
      checked = Object.create(null);
      persist();
      refresh();
      closeConfirm(true);
      announce('Checklist reset');
    });
    // Another tab or page changed this key: take its ticks, keep showing ours consistent.
    window.addEventListener('storage', function (event) {
      if (event.storageArea !== local || (event.key !== null && event.key !== storeKey)) return;
      checked = PA.readChecks(PA.readStore(local, storeKey), ids);
      refresh();
    });
    confirmBox.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.stopPropagation(); closeConfirm(true); }
    });
  }
  [].forEach.call(document.querySelectorAll('[data-checklist]'), setupChecklist);

  // ---- one rise-in per section ----------------------------------------------
  // The page head armed it (class rise-ready) when motion is allowed; here sections
  // are revealed as they come into view.
  var sections = [].slice.call(document.querySelectorAll('.sec'));
  if (root.classList.contains('rise-ready')) {
    if ('IntersectionObserver' in window && sections.length) {
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
    } else {
      root.classList.remove('rise-ready');
    }
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
