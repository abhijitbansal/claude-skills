// Live-reload client. Injected by serve.mjs --watch into the SERVED copy only;
// the dist/index.html on disk never contains it.
(function () {
  var TOKEN = __PA_TOKEN__;
  var bar = document.createElement('div');
  bar.className = 'pa-live';
  bar.innerHTML = '<span id="pa-live-badge">Live</span> <button type="button" id="pa-live-rebuild">Rebuild now</button>'
    + '<div id="pa-live-banner" role="alert" hidden></div>';
  document.body.insertBefore(bar, document.body.firstChild);
  var badge = document.getElementById('pa-live-badge');
  var banner = document.getElementById('pa-live-banner');
  var session;
  try { session = window.sessionStorage; } catch (e) { session = null; }

  // Restore scroll after a live reload; charts render late, so once more when ready.
  var y = window.PA ? window.PA.readStore(session, 'pa-scroll') : null;
  if (y !== null) {
    window.scrollTo(0, Number(y) || 0);
    var tries = 0;
    var wait = setInterval(function () {
      if (window.paReady || ++tries > 50) {
        clearInterval(wait);
        window.scrollTo(0, Number(y) || 0);
        if (session) try { session.removeItem('pa-scroll'); } catch (e) {}
      }
    }, 100);
  }

  var stamp = function (iso) { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
  var es = new EventSource('/events');
  es.addEventListener('rebuilt', function (e) {
    if (window.PA) window.PA.writeStore(session, 'pa-scroll', String(window.scrollY));
    badge.textContent = 'Live · rebuilt ' + stamp(JSON.parse(e.data).at);
    location.reload();
  });
  es.addEventListener('build-error', function (e) {
    var errors = JSON.parse(e.data);
    banner.textContent = 'Build failed — showing last good. ' + errors.map(function (x) { return (x.path || '(root)') + ': ' + x.message; }).join(' | ');
    banner.hidden = false;
    badge.textContent = 'Live · build failed';
  });
  document.getElementById('pa-live-rebuild').addEventListener('click', function () {
    badge.textContent = 'Live · rebuilding…';
    fetch('/rebuild', { method: 'POST', headers: { 'x-pa-token': TOKEN } });
  });
  badge.textContent = 'Live · loaded ' + stamp(new Date().toISOString());
})();
