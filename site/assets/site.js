/* claude-skills — shared site behaviour. Vanilla JS, no deps.
   Powers: reveal-on-scroll, count-up stats, copy buttons,
   TOC scroll-spy, and the catalog search/filter. All degrade gracefully. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;
  var $ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── theme switch: auto (OS) → light → dark, remembered per browser ── */
  var root = document.documentElement, THEME_KEY = 'theme', THEMES = ['auto', 'light', 'dark'];
  function themeNow() { try { var t = localStorage.getItem(THEME_KEY); return (t === 'light' || t === 'dark') ? t : 'auto'; } catch (e) { return 'auto'; } }
  function applyTheme(t) {
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    $('[data-theme-toggle]').forEach(function (b) { b.textContent = 'theme: ' + t; b.setAttribute('aria-label', 'Theme: ' + t + '. Press to change.'); });
  }
  $('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var t = THEMES[(THEMES.indexOf(themeNow()) + 1) % THEMES.length];
      try { if (t === 'auto') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, t); } catch (e) {}
      applyTheme(t);
    });
  });
  applyTheme(themeNow());

  /* ── reveal on scroll ── */
  var revealEls = $('.reveal');
  if (reduce || !hasIO) {
    revealEls.forEach(function (el) { el.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  }

  /* ── count-up ── */
  var counters = $('[data-count]');
  function run(el) {
    var target = parseInt(el.getAttribute('data-count'), 10) || 0;
    if (reduce) { el.textContent = target; return; }
    var start = null, dur = 900;
    function tick(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick); else el.textContent = target;
    }
    requestAnimationFrame(tick);
  }
  if (reduce || !hasIO) {
    counters.forEach(function (el) { el.textContent = el.getAttribute('data-count'); });
  } else {
    var cio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { run(e.target); cio.unobserve(e.target); } });
    }, { threshold: 0.5 });
    counters.forEach(function (el) { cio.observe(el); });
  }

  /* ── copy buttons ── */
  var live = document.createElement('div');
  live.setAttribute('aria-live', 'polite'); live.className = 'sr-live';
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)';
  document.body.appendChild(live);
  $('.copy').forEach(function (btn) {
    var text = btn.getAttribute('data-copy') || '';
    if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Copy: ' + text);
    btn.addEventListener('click', function () {
      var o = btn.textContent;
      var flash = function (word, cls) {
        btn.textContent = word; btn.classList.add(cls);
        live.textContent = (cls === 'ok' ? 'Copied: ' : 'Copy failed: ') + text;
        setTimeout(function () { btn.textContent = o; btn.classList.remove(cls); }, 1400);
      };
      var ok = function () { flash('copied', 'ok'); };
      var fail = function () { flash('failed', 'err'); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, fail);
      } else {
        var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
        var copied = false;
        try { copied = document.execCommand('copy'); } catch (e) {} document.body.removeChild(t);
        if (copied) ok(); else fail();
      }
    });
  });

  /* ── TOC scroll-spy (feature pages) ── */
  var tocLinks = $('.toc a');
  if (tocLinks.length && hasIO) {
    var byId = {};
    tocLinks.forEach(function (a) {
      var id = (a.getAttribute('href') || '').replace(/^#/, '');
      if (id) byId[id] = a;
    });
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var a = byId[e.target.id];
        if (!a) return;
        if (e.isIntersecting) {
          tocLinks.forEach(function (x) { x.classList.remove('active'); });
          a.classList.add('active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    $('.doc-section[id]').forEach(function (s) { spy.observe(s); });
  }

  /* ── catalog search + filter ── */
  var search = document.getElementById('search');
  var fchips = $('.fchip');
  var rows = $('.crow');
  if (rows.length && (search || fchips.length)) {
    var activeType = 'all';
    var empty = document.querySelector('.cat-empty');
    var countEl = document.querySelector('.cat-count');
    function apply() {
      var q = (search && search.value || '').trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (r) {
        var matchType = activeType === 'all' || (r.getAttribute('data-type') || '').toLowerCase() === activeType;
        var matchText = !q || (r.getAttribute('data-search') || r.textContent).toLowerCase().indexOf(q) !== -1;
        var on = matchType && matchText;
        r.style.display = on ? '' : 'none';
        if (on) shown++;
      });
      // hide empty groups
      $('.cat-group').forEach(function (g) {
        var any = $('.crow', g).some(function (r) { return r.style.display !== 'none'; });
        g.style.display = any ? '' : 'none';
      });
      if (empty) empty.style.display = shown ? 'none' : 'block';
      if (countEl) countEl.textContent = shown + (shown === 1 ? ' result' : ' results');
    }
    if (search) search.addEventListener('input', apply);
    fchips.forEach(function (c) {
      c.addEventListener('click', function () {
        fchips.forEach(function (x) { x.classList.remove('active'); });
        c.classList.add('active');
        activeType = (c.getAttribute('data-filter') || 'all').toLowerCase();
        apply();
      });
    });
    apply();
  }
})();
