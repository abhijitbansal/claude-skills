// Scene sections: mounts make-scene's runtime (PAScene, inlined just before this script) on each scene
// host, but only once it is about to scroll into view, so a long page does not start every WebGL
// context at load. Without the runtime, or when WebGL is unavailable, the host keeps showing its table.
// The runtime itself pauses a scene that has scrolled out of view again.
(function () {
  var PS = window.PAScene;
  var hosts = [].slice.call(document.querySelectorAll('.sc-frame [data-pa-scene]'));
  if (!PS || hosts.length === 0) return;

  function mount(host) {
    if (host.getAttribute('data-scene-init')) return;
    host.setAttribute('data-scene-init', '1');
    try {
      // embedded: the page scrolls, so the wheel and a vertical swipe pass through the scene (like a diagram figure); full screen takes them.
      PS.mountScene(host, JSON.parse(host.querySelector('script[type="application/json"]').textContent), { embedded: true });
    } catch (e) {
      console.warn('make-scene: showing the table instead of the 3D view (' + (e && e.message ? e.message : e) + ')');
    }
  }

  if (typeof window.IntersectionObserver !== 'function') {
    hosts.forEach(mount);
    return;
  }
  var observer = new window.IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      observer.unobserve(entry.target);
      mount(entry.target);
    });
  }, { rootMargin: '200px 0px' });
  hosts.forEach(function (host) { observer.observe(host); });
})();
