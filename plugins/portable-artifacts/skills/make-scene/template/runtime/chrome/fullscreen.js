// Full screen for the scene host: the browser's own, or (where it is refused or absent, as in a sandboxed
// iframe or on iPhone Safari) a window-filling layer the page styles with .sc-fill.

/** createFullscreen(root, onChange) -> { enter, exit, toggle, isOn, destroy } */
export function createFullscreen(root, onChange) {
  const doc = root.ownerDocument;
  let fill = false;
  const real = () => doc.fullscreenElement === root;
  const isOn = () => fill || real();

  function useFill() {
    if (isOn()) return;
    fill = true;
    root.classList.add('sc-fill');
    onChange();
  }
  function enter() {
    if (isOn()) return;
    if (!doc.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return useFill();
    let request;
    try {
      request = root.requestFullscreen();
    } catch {
      return useFill();
    }
    if (request && typeof request.then === 'function') request.then(null, useFill);
    else setTimeout(() => (real() ? undefined : useFill()), 0); // no promise (an old browser): look again after a tick
  }
  function exit() {
    if (fill) {
      fill = false;
      root.classList.remove('sc-fill');
      onChange();
    }
    if (real() && typeof doc.exitFullscreen === 'function') {
      try {
        const done = doc.exitFullscreen();
        if (done && typeof done.then === 'function') done.then(null, () => {});
      } catch {
        // already out
      }
    }
  }
  // Esc in real full screen never reaches the page as a key; fullscreenchange does.
  doc.addEventListener('fullscreenchange', onChange);

  return {
    enter,
    exit,
    toggle: () => (isOn() ? exit() : enter()),
    isOn,
    destroy() {
      doc.removeEventListener('fullscreenchange', onChange);
      if (isOn()) exit();
    },
  };
}
